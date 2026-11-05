// =========================================================
// FILE: src/app/api/admin/database/backend/route.ts
// API оперативного переключения источника БД и автобэкапа в админке:
//   • GET  — текущая конфигурация (маскированная), сводка локальной JSON-БД,
//            статус автобэкапа (2–3 мин) и список снимков на диске
//   • PUT  — переключение активной БД (primary / secondary / local), ключи
//            и настройки автоматического копирования на выбранный диск
//   • POST — проверка связи (probe), снимок Supabase → JSON, выгрузка JSON → Supabase,
//            немедленная запись на диск (run_backup_now) и восстановление снимка с диска
// Доступ: только владелец (owner) и администратор (admin).
// =========================================================

import { invalidateFullReplicaReadiness, isFullBackupRunning, isFullReplicaReady } from "@/lib/full-backup";
import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { canAccessDatabase } from "@/lib/admin-rbac";
import { logActivity } from "@/lib/activity-log";
import {
  getDbRuntimeConfig,
  getDbFailoverState,
  resolveSupabaseCredentials,
  saveDbRuntimeConfig,
  toPublicDbConfigView,
  type DbBackendMode,
} from "@/lib/db-runtime-config";
import { getLocalDbSummary } from "@/lib/local-json-db";
import {
  ensureAutoBackupSchedulerStarted,
  getAutoBackupStatus,
  restartAutoBackupScheduler,
  runServerAutoBackupNow,
  validateBackupDirectory,
} from "@/lib/auto-backup-scheduler";
import {
  probeDatabaseBackend,
} from "@/lib/supabase";
import { invalidateDatabaseSchemaCache } from "@/lib/admin-database";
import { invalidateProductsCache } from "@/lib/supabase-queries";
import { reconnectRealtimeHub } from "@/lib/realtime-hub";

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

  ensureAutoBackupSchedulerStarted();

  const wantProbe = request.nextUrl.searchParams.get("probe") === "1";

  const config = toPublicDbConfigView();
  const localSummary = getLocalDbSummary();
  const autoBackupStatus = getAutoBackupStatus();

  let probes: Record<string, any> | undefined;
  if (wantProbe) {
    const [primary, secondary, local] = await Promise.all([
      probeDatabaseBackend("primary"),
      probeDatabaseBackend("secondary"),
      probeDatabaseBackend("local"),
    ]);
    probes = { primary, secondary, local };
  }

  return NextResponse.json({
    config,
    localSummary,
    autoBackupStatus,
    ...(probes ? { probes } : {}),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await checkAccess();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    if (isFullBackupRunning()) return NextResponse.json({ error: "Дождитесь завершения полного копирования." }, { status: 409 });

    if (body?.autoBackupEnabled === true || body?.runBackupNow === true || body?.mirrorWritesToLocal === true || body?.customBackupDir !== undefined) {
      return NextResponse.json({ error: "Серверные резервные копии и зеркалирование отключены. Настройте архивы на ПК." }, { status: 410 });
    }
    let activeBackend: DbBackendMode | undefined;
    if (body?.activeBackend !== undefined) {
      if (
        body.activeBackend !== "primary" &&
        body.activeBackend !== "secondary" &&
        body.activeBackend !== "local"
      ) {
        return NextResponse.json(
          { error: "Недопустимый режим базы данных" },
          { status: 400 }
        );
      }
      if (body.activeBackend === "local") return NextResponse.json({ error: "Рабочая JSON-БД на ПК ещё не реализована; серверный локальный режим отключён." }, { status: 410 });
      activeBackend = body.activeBackend;
    }

    if (activeBackend && isFullBackupRunning()) {
      return NextResponse.json({ error: "Дождитесь завершения полного копирования перед переключением базы." }, { status: 409 });
    }
    if (activeBackend && (activeBackend !== getDbRuntimeConfig().activeBackend || getDbFailoverState().activeFallbackBackend)) {
      if (!isFullReplicaReady(activeBackend)) {
        return NextResponse.json({ error: "Сначала успешно скопируйте текущую рабочую базу в выбранный резерв. Переключение на неподтверждённую копию остановлено." }, { status: 409 });
      }
      if (activeBackend !== "local" && getLocalDbSummary().pendingMutationsCount > 0) {
        return NextResponse.json({ error: "В старой серверной JSON-БД есть несинхронизированные изменения. Скачайте и сохраните старый файл для ручной проверки; переключение заблокировано." }, { status: 409 });
      }
      const probe = await probeDatabaseBackend(activeBackend);
      if (!probe.reachable) {
        return NextResponse.json({ error: `Переключение отменено: ${probe.label} недоступна. ${probe.error || ""}` }, { status: 409 });
      }
    }

    // Если пользователь указал путь к диску/папке для бэкапов — сразу проверяем права записи
    if (
      body?.customBackupDir !== undefined &&
      String(body.customBackupDir).trim() !== ""
    ) {
      const check = validateBackupDirectory(String(body.customBackupDir));
      if (!check.ok) {
        return NextResponse.json(
          {
            error: `Не удалось получить доступ к указанному диску/папке (${check.resolvedPath}): ${check.error}`,
          },
          { status: 400 }
        );
      }
    }

    // The connectivity probe above is asynchronous; a snapshot may have
    // started while it was in flight.
    if (isFullBackupRunning()) return NextResponse.json({ error: "Дождитесь завершения полного копирования." }, { status: 409 });
    if (activeBackend && !isFullReplicaReady(activeBackend)) return NextResponse.json({ error: "Копия больше не подтверждена; повторите синхронизацию." }, { status: 409 });
    const updated = saveDbRuntimeConfig({
      activeBackend,
      autoFailover:
        body?.autoFailover !== undefined
          ? Boolean(body.autoFailover)
          : undefined,
      mirrorWritesToLocal:
        body?.mirrorWritesToLocal !== undefined
          ? Boolean(body.mirrorWritesToLocal)
          : undefined,
      autoBackupEnabled:
        body?.autoBackupEnabled !== undefined
          ? Boolean(body.autoBackupEnabled)
          : undefined,
      autoBackupIntervalSec:
        body?.autoBackupIntervalSec !== undefined
          ? Number(body.autoBackupIntervalSec)
          : undefined,
      customBackupDir:
        body?.customBackupDir !== undefined
          ? String(body.customBackupDir)
          : undefined,
      maxBackupSnapshots:
        body?.maxBackupSnapshots !== undefined
          ? Number(body.maxBackupSnapshots)
          : undefined,
      primary:
        body?.primary && typeof body.primary === "object"
          ? body.primary
          : undefined,
      secondary:
        body?.secondary && typeof body.secondary === "object"
          ? body.secondary
          : undefined,
      updatedBy: auth.displayName || auth.username || "Администратор",
    });

    if (activeBackend || body?.primary || body?.secondary) invalidateFullReplicaReadiness();

    // Перезапускаем планировщик автобэкапа с новым интервалом / путём диска
    restartAutoBackupScheduler();

    // Если попросили сразу сохранить первую копию на новый диск — делаем!
    let immediateBackupResult: any = null;
    if (body?.runBackupNow === true) {
      immediateBackupResult = await runServerAutoBackupNow({ force: true });
    }

    // Сразу переключаем кэши и Realtime-канал на новый источник БД
    invalidateDatabaseSchemaCache();
    invalidateProductsCache();
    reconnectRealtimeHub();

    const modeTitle =
      updated.activeBackend === "local"
        ? "Локальная JSON-БД"
        : updated.activeBackend === "secondary"
          ? updated.secondary.label || "Supabase #2"
          : updated.primary.label || "Supabase #1";

    await logActivity({
      adminName: auth.displayName || auth.username || "Администратор",
      adminRole: auth.role || "admin",
      action: "update",
      entityType: "settings",
      entityId: "db-runtime-config",
      entityLabel: `Настройки БД / автобэкапа (${modeTitle})`,
      details: {
        activeBackend: updated.activeBackend,
        autoFailover: updated.autoFailover,
        mirrorWritesToLocal: updated.mirrorWritesToLocal,
        autoBackupEnabled: updated.autoBackupEnabled,
        autoBackupIntervalSec: updated.autoBackupIntervalSec,
        customBackupDir: updated.customBackupDir || "(по умолчанию)",
      },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      config: toPublicDbConfigView(),
      localSummary: getLocalDbSummary(),
      autoBackupStatus: getAutoBackupStatus(),
      ...(immediateBackupResult ? { immediateBackupResult } : {}),
    });
  } catch (e: any) {
    console.error("[database/backend PUT]", e);
    return NextResponse.json(
      { error: e?.message || "Не удалось сохранить конфигурацию БД" },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await checkAccess();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const action = String(body?.action || "").trim();
    if (["run_backup_now", "restore_disk_snapshot", "sync_bidirectional", "sync_to_local", "push_to_remote", "replay_pending"].includes(action)) {
      return NextResponse.json({ error: "Старые серверные операции с JSON и резервными копиями отключены. Старые файлы не удалены." }, { status: 410 });
    }
    if (action === "probe") {
      const [primary, secondary, local] = await Promise.all([
        probeDatabaseBackend("primary"),
        probeDatabaseBackend("secondary"),
        probeDatabaseBackend("local"),
      ]);
      return NextResponse.json({
        ok: true,
        probes: { primary, secondary, local },
        config: toPublicDbConfigView(),
        localSummary: getLocalDbSummary(),
        autoBackupStatus: getAutoBackupStatus(),
      });
    }

    return NextResponse.json(
      { error: `Неизвестное действие: ${action}` },
      { status: 400 }
    );
  } catch (e: any) {
    console.error("[database/backend POST]", e);
    return NextResponse.json(
      { error: e?.message || "Ошибка выполнения операции БД" },
      { status: 500 }
    );
  }
}
