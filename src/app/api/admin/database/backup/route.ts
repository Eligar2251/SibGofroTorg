// =========================================================
// FILE: src/app/api/admin/database/backup/route.ts
// API резервного копирования и миграции базы данных:
//   • GET  ?format=json            — скачать полный JSON-бэкап локальной БД
//   • GET  ?format=json&sync=auto  — освежить снимок из активной БД (если прошло
//                                    >45 сек) и отдать полный JSON для автозаписи
//                                    на локальный диск ПК администратора
//   • GET  ?format=sql             — скачать / получить полный SQL-скрипт миграции
//                                    `supabase/FULL_DATABASE_MIGRATION.sql`
//   • POST                         — загрузить/восстановить JSON-бэкап в локальную БД
// Доступ: только владелец (owner) и администратор (admin).
// =========================================================

import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { canAccessDatabase } from "@/lib/admin-rbac";
import { logActivity } from "@/lib/activity-log";
import {
  getDbRuntimeConfig,
  resolveSupabaseCredentials,
} from "@/lib/db-runtime-config";
import {
  exportLocalDbSnapshot,
  getLocalDbSummary,
  importLocalDbSnapshot,
  syncRemoteSupabaseToLocal,
} from "@/lib/local-json-db";
import { createDirectSupabaseClient } from "@/lib/supabase";
import { invalidateProductsCache } from "@/lib/supabase-queries";
import { invalidateDatabaseSchemaCache } from "@/lib/admin-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function checkAccess() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!canAccessDatabase(auth.role) || !hasPermission(auth, "view_database")) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }
  return auth;
}

export async function GET(request: NextRequest) {
  const auth = await checkAccess();
  if (auth instanceof NextResponse) return auth;

  const format = request.nextUrl.searchParams.get("format") || "json";
  const inline = request.nextUrl.searchParams.get("inline") === "1";
  const syncMode = request.nextUrl.searchParams.get("sync");

  if (format === "sql") {
    const sqlPath = path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "supabase",
      "FULL_DATABASE_MIGRATION.sql"
    );
    if (!fs.existsSync(sqlPath)) {
      return NextResponse.json(
        { error: "Файл FULL_DATABASE_MIGRATION.sql не найден" },
        { status: 404 }
      );
    }
    const sqlContent = fs.readFileSync(sqlPath, "utf8");
    return new NextResponse(sqlContent, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        ...(inline
          ? {}
          : {
              "Content-Disposition":
                'attachment; filename="FULL_DATABASE_MIGRATION.sql"',
            }),
      },
    });
  }

  // При автоматическом сохранении на ПК администратора (sync=auto)
  // предварительно освежаем локальное зеркало из активного Supabase,
  // если последняя синхронизация была больше 45 секунд назад.
  if (syncMode === "auto") {
    const cfg = getDbRuntimeConfig();
    if (
      cfg.activeBackend === "primary" ||
      cfg.activeBackend === "secondary"
    ) {
      const summary = getLocalDbSummary();
      const lastSyncMs = summary.lastSyncedAt
        ? new Date(summary.lastSyncedAt).getTime()
        : 0;
      if (!lastSyncMs || Date.now() - lastSyncMs > 45_000) {
        const creds = resolveSupabaseCredentials(cfg.activeBackend);
        if (creds.configured) {
          try {
            const remoteClient = createDirectSupabaseClient(
              creds.url,
              creds.serviceRoleKey,
              15_000
            );
            await syncRemoteSupabaseToLocal(remoteClient, creds.label);
          } catch {
            // Если внешний сервер недоступен — отдаём текущую локальную JSON-БД
          }
        }
      }
    }
  }

  const snapshot = exportLocalDbSnapshot();
  const datePart = new Date().toISOString().slice(0, 10);
  const filename = `sibgofrotorg-local-db-${datePart}.json`;

  return new NextResponse(JSON.stringify(snapshot, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Sgt-Total-Rows": String(snapshot.totalRows),
      ...(inline
        ? {}
        : {
            "Content-Disposition": `attachment; filename="${filename}"`,
          }),
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await checkAccess();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const mode: "replace" | "merge" =
      body?.mode === "merge" ? "merge" : "replace";
    const snapshot = body?.snapshot ?? body;

    const localSummary = importLocalDbSnapshot(snapshot, mode);
    invalidateDatabaseSchemaCache();
    invalidateProductsCache();

    await logActivity({
      adminName: auth.displayName || auth.username || "Администратор",
      adminRole: auth.role || "admin",
      action: "update",
      entityType: "settings",
      entityId: "local-db-restore",
      entityLabel: `Восстановление локальной JSON-БД (${
        mode === "merge" ? "объединение" : "полная замена"
      }, ${localSummary.totalRows} записей)`,
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      localSummary,
    });
  } catch (e: any) {
    console.error("[database/backup POST]", e);
    return NextResponse.json(
      { error: e?.message || "Не удалось импортировать резервную копию" },
      { status: 400 }
    );
  }
}
