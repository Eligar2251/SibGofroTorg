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
import {
  getLocalDbSummary,
  pushLocalDbToRemoteSupabase,
  replayPendingMutationsToRemoteSupabase,
  syncBidirectionalSupabaseAndLocal,
  syncRemoteSupabaseToLocal,
} from "@/lib/local-json-db";
import { getMaskedSecretAccessCodeInfo } from "@/lib/local-db-secret";
import {
  ensureAutoBackupSchedulerStarted,
  getAutoBackupStatus,
  restartAutoBackupScheduler,
  restoreDiskBackupSnapshot,
  runServerAutoBackupNow,
  validateBackupDirectory,
} from "@/lib/auto-backup-scheduler";
import {
  createDirectSupabaseClient,
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
    secretCodeInfo: getMaskedSecretAccessCodeInfo(),
    ...(probes ? { probes } : {}),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await checkAccess();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();

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
      activeBackend = body.activeBackend;
    }

    if (activeBackend && (activeBackend !== getDbRuntimeConfig().activeBackend || getDbFailoverState().activeFallbackBackend)) {
      if (activeBackend !== "local" && getLocalDbSummary().pendingMutationsCount > 0) {
        return NextResponse.json({ error: "В локальной БД есть несинхронизированные изменения. Сначала выполните синхронизацию с нужной базой и проверьте результат." }, { status: 409 });
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

    if (action === "run_backup_now") {
      const result = await runServerAutoBackupNow({ force: true });
      if (!result.ok) {
        return NextResponse.json(
          {
            error: result.error || "Ошибка записи резервной копии на диск",
            autoBackupStatus: getAutoBackupStatus(),
          },
          { status: 500 }
        );
      }
      return NextResponse.json({
        ok: true,
        result,
        localSummary: getLocalDbSummary(),
        autoBackupStatus: getAutoBackupStatus(),
      });
    }

    if (action === "restore_disk_snapshot") {
      const filename = String(body?.filename || "").trim();
      const mode: "replace" | "merge" =
        body?.mode === "merge" ? "merge" : "replace";
      const localSummary = restoreDiskBackupSnapshot(filename, mode);

      invalidateDatabaseSchemaCache();
      invalidateProductsCache();

      await logActivity({
        adminName: auth.displayName || auth.username || "Администратор",
        adminRole: auth.role || "admin",
        action: "update",
        entityType: "settings",
        entityId: "disk-snapshot-restore",
        entityLabel: `Восстановление БД из снимка диска «${filename}» (${localSummary.totalRows} записей)`,
      }).catch(() => {});

      return NextResponse.json({
        ok: true,
        localSummary,
        autoBackupStatus: getAutoBackupStatus(),
      });
    }

    if (action === "sync_bidirectional") {
      const cfg = getDbRuntimeConfig();
      const rawTarget = String(body?.target || "").trim();
      const remoteTarget: "primary" | "secondary" =
        rawTarget === "secondary"
          ? "secondary"
          : rawTarget === "primary"
            ? "primary"
            : cfg.activeBackend === "secondary"
              ? "secondary"
              : "primary";

      const creds = resolveSupabaseCredentials(remoteTarget);
      if (!creds.configured) {
        return NextResponse.json(
          {
            error: `${creds.label}: укажите URL и service_role ключ для двусторонней синхронизации`,
          },
          { status: 400 }
        );
      }

      const remoteClient = createDirectSupabaseClient(
        creds.url,
        creds.serviceRoleKey,
        25_000
      );
      const biResult = await syncBidirectionalSupabaseAndLocal(
        remoteClient,
        creds.label
      );

      // Записываем факт синхронизации в таблицу аудита db_sync_runs (если она создана в Supabase)
      try {
        await remoteClient.from("db_sync_runs").insert({
          direction: "bidirectional",
          status: biResult.failedTables.length > 0 ? "partial" : "success",
          target_label: creds.label,
          synced_tables: biResult.syncedTables,
          synced_rows: biResult.totalRows,
          replayed_mutations:
            biResult.replayedUpserts + biResult.replayedDeletes,
          local_file_path: biResult.summary.filePath,
          initiated_by: auth.displayName || auth.username || "Администратор",
        });
      } catch {
        /* ignore if table not yet migrated */
      }

      await runServerAutoBackupNow({ force: true, skipRemoteSync: true }).catch(
        () => {}
      );
      invalidateDatabaseSchemaCache();
      invalidateProductsCache();

      // Не создавать новую офлайн-мутацию сразу после очистки очереди.
      if (getDbRuntimeConfig().activeBackend !== "local" && getDbFailoverState().activeFallbackBackend !== "local") {
      await logActivity({
        adminName: auth.displayName || auth.username || "Администратор",
        adminRole: auth.role || "admin",
        action: "update",
        entityType: "settings",
        entityId: "bidirectional-db-sync",
        entityLabel: `Двусторонняя синхронизация «${creds.label}» ↔ Локальная БД (отправлено офлайн-правок: ${
          biResult.replayedUpserts + biResult.replayedDeletes
        }, принято записей: ${biResult.totalRows})`,
      }).catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        targetLabel: creds.label,
        ...biResult,
        localSummary: biResult.summary,
        autoBackupStatus: getAutoBackupStatus(),
      });
    }

    if (action === "replay_pending") {
      const cfg = getDbRuntimeConfig();
      const remoteTarget: "primary" | "secondary" =
        body?.target === "secondary"
          ? "secondary"
          : cfg.activeBackend === "secondary"
            ? "secondary"
            : "primary";

      const creds = resolveSupabaseCredentials(remoteTarget);
      if (!creds.configured) {
        return NextResponse.json(
          { error: `${creds.label}: не настроен URL или service_role ключ` },
          { status: 400 }
        );
      }
      const remoteClient = createDirectSupabaseClient(
        creds.url,
        creds.serviceRoleKey,
        20_000
      );
      const replayRes =
        await replayPendingMutationsToRemoteSupabase(remoteClient);

      return NextResponse.json({
        ok: true,
        targetLabel: creds.label,
        ...replayRes,
        localSummary: getLocalDbSummary(),
      });
    }

    if (action === "sync_to_local") {
      const cfg = getDbRuntimeConfig();
      const rawSource = String(body?.source || "").trim();
      const sourceTarget: "primary" | "secondary" =
        rawSource === "secondary"
          ? "secondary"
          : rawSource === "primary"
            ? "primary"
            : cfg.activeBackend === "secondary"
              ? "secondary"
              : "primary";

      const creds = resolveSupabaseCredentials(sourceTarget);
      if (!creds.configured) {
        return NextResponse.json(
          {
            error: `${creds.label}: не заполнены SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY`,
          },
          { status: 400 }
        );
      }

      const remoteClient = createDirectSupabaseClient(
        creds.url,
        creds.serviceRoleKey,
        20_000
      );
      const syncResult = await syncRemoteSupabaseToLocal(
        remoteClient,
        creds.label
      );

      invalidateProductsCache();

      // Не создавать новую офлайн-мутацию сразу после очистки очереди.
      if (getDbRuntimeConfig().activeBackend !== "local" && getDbFailoverState().activeFallbackBackend !== "local") {
      await logActivity({
        adminName: auth.displayName || auth.username || "Администратор",
        adminRole: auth.role || "admin",
        action: "update",
        entityType: "settings",
        entityId: "local-db-sync",
        entityLabel: `Снимок БД из «${creds.label}» в локальную JSON-БД (${syncResult.totalRows} записей)`,
      }).catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        ...syncResult,
        localSummary: syncResult.summary,
        autoBackupStatus: getAutoBackupStatus(),
      });
    }

    if (action === "push_to_remote") {
      const target: "primary" | "secondary" =
        body?.target === "primary" ? "primary" : "secondary";
      const creds = resolveSupabaseCredentials(target);
      if (!creds.configured) {
        return NextResponse.json(
          {
            error: `${creds.label}: укажите URL проекта и service_role ключ перед выгрузкой данных`,
          },
          { status: 400 }
        );
      }

      const remoteClient = createDirectSupabaseClient(
        creds.url,
        creds.serviceRoleKey,
        25_000
      );
      const pushResult = await pushLocalDbToRemoteSupabase(remoteClient);

      try {
        await remoteClient.from("db_sync_runs").insert({
          direction: "local_to_supabase",
          status: pushResult.failedTables.length > 0 ? "partial" : "success",
          target_label: creds.label,
          synced_tables: pushResult.pushedTables,
          synced_rows: pushResult.pushedRows,
          replayed_mutations: pushResult.replayedDeletes,
          local_file_path: getLocalDbSummary().filePath,
          initiated_by: auth.displayName || auth.username || "Администратор",
        });
      } catch {
        /* ignore */
      }

      // Не создавать новую офлайн-мутацию сразу после очистки очереди.
      if (getDbRuntimeConfig().activeBackend !== "local" && getDbFailoverState().activeFallbackBackend !== "local") {
      await logActivity({
        adminName: auth.displayName || auth.username || "Администратор",
        adminRole: auth.role || "admin",
        action: "update",
        entityType: "settings",
        entityId: "local-db-push",
        entityLabel: `Импорт из локальной БД → «${creds.label}» (${pushResult.pushedRows} записей в ${pushResult.pushedTables} табл.)`,
      }).catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        targetLabel: creds.label,
        ...pushResult,
        localSummary: getLocalDbSummary(),
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
