// =========================================================
// FILE: src/app/[adminPath]/api/login/local-file/route.ts
// Аварийный беспарольный вход в админ-панель по локальному файлу БД,
// когда основная база данных (Supabase) не отвечает.
//
// Правила безопасности:
//   1. Беспарольный вход разрешён ТОЛЬКО тогда, когда основная БД
//      действительно недоступна (не отвечает по сети / 5xx / не настроена).
//      Пока основная БД работает штатно — маршрут отклоняет вход (403).
//   2. Выбранный пользователем JSON-файл БД обязан содержать стандартный
//      криптографический секретный код этого сайта (`secretAccessCode` +
//      подпись `sgtEmergencyAuth`), проверяемый через `timingSafeEqual`.
//      Чужой или вручную созданный JSON-файл не пройдёт проверку.
//   3. Считывается и сохраняется полный путь файла БД (`fileFullPath`) —
//      как из дескриптора/пути выбора файла, так и из метаданных документа.
//   4. После успешной проверки данные из выбранного файла монтируются в
//      локальную JSON-БД и выдаётся полноценная админ-сессия без пароля.
// =========================================================

import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/admin-path";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { noStoreJson } from "@/lib/api-errors";
import { logActivity } from "@/lib/activity-log";
import {
  getDbRuntimeConfig,
  saveDbRuntimeConfig,
} from "@/lib/db-runtime-config";
import { verifyLocalDbEmergencyDocument } from "@/lib/local-db-secret";
import { importLocalDbSnapshot } from "@/lib/local-json-db";
import { probeDatabaseBackend } from "@/lib/supabase";
import { invalidateDatabaseSchemaCache } from "@/lib/admin-database";
import { invalidateProductsCache } from "@/lib/supabase-queries";
import { reconnectRealtimeHub } from "@/lib/realtime-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeFullPath(rawPath: string | null | undefined): string {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  // Отсекаем браузерную заглушку C:\fakepath\..., чтобы не записывать фиктивный путь
  if (/^[A-Za-z]:\\fakepath\\/i.test(trimmed)) {
    return "";
  }
  return trimmed;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ adminPath: string }> }
) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const primaryProbe = await probeDatabaseBackend("primary");
  const cfg = getDbRuntimeConfig();

  return noStoreJson({
    primaryConfigured: primaryProbe.configured,
    primaryReachable: primaryProbe.reachable,
    primaryError: primaryProbe.reachable ? null : primaryProbe.error,
    emergencyLoginAllowed: !primaryProbe.reachable,
    activeBackend: cfg.activeBackend,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ adminPath: string }> }
) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip = clientIp(request);
  const rl = rateLimit(`admin-local-file-login:${ip}`, 8, 15 * 60 * 1000);
  if (!rl.ok) {
    return noStoreJson(
      { error: "Слишком много попыток входа. Подождите и попробуйте снова." },
      429
    );
  }

  // 1. Проверяем, действительно ли основная БД сейчас не отвечает
  const primaryProbe = await probeDatabaseBackend("primary");
  if (primaryProbe.reachable) {
    return noStoreJson(
      {
        error:
          "Основная база данных работает штатно — аварийный вход без пароля по файлу БД отключён. Используйте обычный логин и пароль.",
        code: "primary_db_online",
      },
      403
    );
  }

  try {
    const body = await request.json();
    const rawUserPath = sanitizeFullPath(body?.fileFullPath);
    const rawFileName = String(body?.fileName || "").trim();
    let rawContent = body?.fileContent;

    // Если файл не передан телом, но указан полный путь к файлу на диске сервера/ПК — читаем напрямую!
    let readDirectlyFromServerDisk = false;
    if (!rawContent && rawUserPath) {
      const candidateDiskPath = path.resolve(
        /*turbopackIgnore: true*/ rawUserPath
      );
      if (
        candidateDiskPath.endsWith(".json") &&
        fs.existsSync(candidateDiskPath)
      ) {
        rawContent = fs.readFileSync(candidateDiskPath, "utf8");
        readDirectlyFromServerDisk = true;
      } else {
        return noStoreJson(
          {
            error: `Файл по указанному пути не найден: ${rawUserPath}. Выберите файл через кнопку обзора.`,
          },
          400
        );
      }
    }

    if (!rawContent) {
      return noStoreJson(
        { error: "Выберите локальный файл базы данных (.json)" },
        400
      );
    }

    let parsedDoc: unknown;
    try {
      parsedDoc =
        typeof rawContent === "string" ? JSON.parse(rawContent) : rawContent;
    } catch {
      return noStoreJson(
        { error: "Выбранный файл повреждён или не является корректным JSON" },
        400
      );
    }

    // 2. Криптографическая проверка стандартного секретного кода внутри документа БД
    const verification = verifyLocalDbEmergencyDocument(parsedDoc);
    if (!verification.valid) {
      return noStoreJson(
        {
          error:
            verification.error ||
            "Секретный код в документе БД недействителен — вход запрещён",
          code: "invalid_secret_code",
        },
        403
      );
    }

    // 3. Считываем и фиксируем полный путь локального файла БД
    const resolvedFullPath =
      (readDirectlyFromServerDisk && rawUserPath
        ? path.resolve(/*turbopackIgnore: true*/ rawUserPath)
        : rawUserPath) ||
      sanitizeFullPath(verification.embeddedFullPath) ||
      rawFileName;

    if (!resolvedFullPath) {
      return noStoreJson(
        {
          error:
            "Не удалось считать полный путь файла БД. Укажите или подтвердите полный путь к файлу.",
        },
        400
      );
    }

    // 4. Загружаем данные из выбранного файла в активную локальную JSON-БД
    //    и переключаем админку в автономный режим, чтобы всё спокойно работало
    const summary = importLocalDbSnapshot(parsedDoc, "replace");

    saveDbRuntimeConfig({
      activeBackend: "local",
      lastEmergencyDbFilePath: resolvedFullPath,
      lastEmergencyLoginAt: new Date().toISOString(),
      updatedBy: `${verification.adminAccount.displayName} (вход по файлу БД)`,
    });

    invalidateDatabaseSchemaCache();
    invalidateProductsCache();
    reconnectRealtimeHub();

    // 5. Создаём админскую сессию БЕЗ пароля
    await createSession({
      username: verification.adminAccount.username,
      role: verification.adminAccount.role,
      displayName: verification.adminAccount.displayName,
    });

    await logActivity({
      adminName: verification.adminAccount.displayName,
      adminRole: verification.adminAccount.role,
      action: "login",
      entityType: "settings",
      entityId: "emergency-local-db-login",
      entityLabel: `Аварийный вход по файлу локальной БД без пароля (${resolvedFullPath})`,
      details: {
        fileFullPath: resolvedFullPath,
        totalRows: summary.totalRows,
        primaryDbError: primaryProbe.error,
      },
      ipAddress: ip,
    }).catch(() => {});

    return noStoreJson({
      success: true,
      role: verification.adminAccount.role,
      username: verification.adminAccount.username,
      displayName: verification.adminAccount.displayName,
      fileFullPath: resolvedFullPath,
      totalRows: summary.totalRows,
    });
  } catch (err: any) {
    console.error("[login/local-file POST]", err);
    return noStoreJson(
      {
        error: err?.message || "Не удалось выполнить вход по файлу локальной БД",
      },
      500
    );
  }
}
