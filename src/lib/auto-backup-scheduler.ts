// =========================================================
// FILE: src/lib/auto-backup-scheduler.ts
// Фоновый планировщик автоматического резервного копирования БД
// каждые 2–3 минуты (по умолчанию 150 сек = 2,5 мин) на указанный
// пользователем диск / директорию.
//
// При каждом тике:
//   1. Если активен внешний Supabase (#1 или #2) — стягивает актуальный
//      постраничный снимок всех таблиц в локальную JSON-БД (если сервер
//      недоступен — сохраняет текущее состояние локальной БД без затирания).
//   2. Атомарно записывает на выбранный диск:
//      • `<backupDir>/sibgofrotorg-latest.json` — свежая полная копия
//      • `<backupDir>/local-db.json`            — зеркало рабочей JSON-БД
//      • `<backupDir>/snapshots/sibgofrotorg-YYYY-MM-DD_HH-mm-ss.json` — архив
//   3. Выполняет ротацию папки `snapshots/`, оставляя последние N копий.
// =========================================================

import fs from "node:fs";
import path from "node:path";
import {
  getDbRuntimeConfig,
  getDbFailoverState,
  getSgtDataDir,
  resolveServerBackupDir,
  resolveSupabaseCredentials,
} from "./db-runtime-config";
import {
  exportLocalDbSnapshot,
  importLocalDbSnapshot,
  syncRemoteSupabaseToLocal,
  type LocalDbSummary,
} from "./local-json-db";
import { createDirectSupabaseClient } from "./supabase-server-engine";

export interface DiskSnapshotItem {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AutoBackupRuntimeStatus {
  enabled: boolean;
  intervalSec: number;
  targetDir: string;
  maxSnapshots: number;
  schedulerActive: boolean;
  isRunning: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  lastSavedFilePath: string | null;
  lastTotalRows: number | null;
  lastSource: string | null;
  lastError: string | null;
  nextScheduledAt: string | null;
  snapshotsCount: number;
  recentSnapshots: DiskSnapshotItem[];
}

interface SchedulerState {
  timer: ReturnType<typeof setTimeout> | null;
  isRunning: boolean;
  started: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  lastSavedFilePath: string | null;
  lastTotalRows: number | null;
  lastSource: string | null;
  lastError: string | null;
  nextScheduledAt: string | null;
}

const globalRef = globalThis as unknown as {
  __sgtAutoBackupScheduler?: SchedulerState;
};

function getStatusFilePath(): string {
  return path.join(
    /*turbopackIgnore: true*/ getSgtDataDir(),
    "auto-backup-status.json"
  );
}

function getState(): SchedulerState {
  if (!globalRef.__sgtAutoBackupScheduler) {
    let persisted: Partial<SchedulerState> = {};
    try {
      const p = getStatusFilePath();
      if (fs.existsSync(p)) {
        persisted = JSON.parse(fs.readFileSync(p, "utf8")) || {};
      }
    } catch {
      /* ignore */
    }
    globalRef.__sgtAutoBackupScheduler = {
      timer: null,
      isRunning: false,
      started: false,
      lastAttemptAt: persisted.lastAttemptAt ?? null,
      lastSuccessAt: persisted.lastSuccessAt ?? null,
      lastDurationMs: persisted.lastDurationMs ?? null,
      lastSavedFilePath: persisted.lastSavedFilePath ?? null,
      lastTotalRows: persisted.lastTotalRows ?? null,
      lastSource: persisted.lastSource ?? null,
      lastError: persisted.lastError ?? null,
      nextScheduledAt: null,
    };
  }
  return globalRef.__sgtAutoBackupScheduler;
}

function persistStatusMeta(state: SchedulerState): void {
  try {
    const dir = getSgtDataDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const statusPath = getStatusFilePath();
    const payload = {
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      lastDurationMs: state.lastDurationMs,
      lastSavedFilePath: state.lastSavedFilePath,
      lastTotalRows: state.lastTotalRows,
      lastSource: state.lastSource,
      lastError: state.lastError,
    };
    fs.writeFileSync(statusPath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    /* ignore */
  }
}

function formatSnapshotFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(
    date.getSeconds()
  )}`;
  return `sibgofrotorg-${stamp}.json`;
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmpPath, filePath);
}

/**
 * Проверяет, что указанный пользователем диск / папка доступны для записи.
 */
export function validateBackupDirectory(rawDir: string): {
  ok: boolean;
  resolvedPath: string;
  error?: string;
} {
  const clean = String(rawDir || "").trim();
  const resolvedPath = clean
    ? path.resolve(/*turbopackIgnore: true*/ clean)
    : resolveServerBackupDir();

  try {
    fs.mkdirSync(path.join(/*turbopackIgnore: true*/ resolvedPath, "snapshots"), {
      recursive: true,
    });
    const probeFile = path.join(
      /*turbopackIgnore: true*/ resolvedPath,
      `.sgt-write-test-${process.pid}-${Date.now()}.tmp`
    );
    fs.writeFileSync(probeFile, "ok", "utf8");
    fs.unlinkSync(probeFile);
    return { ok: true, resolvedPath };
  } catch (err: any) {
    return {
      ok: false,
      resolvedPath,
      error:
        err?.message ||
        `Нет прав на запись или диск не найден: ${resolvedPath}`,
    };
  }
}

export function listDiskBackupSnapshots(limit = 20): {
  total: number;
  items: DiskSnapshotItem[];
} {
  const targetDir = resolveServerBackupDir();
  const snapshotsDir = path.join(/*turbopackIgnore: true*/ targetDir, "snapshots");
  try {
    if (!fs.existsSync(snapshotsDir)) return { total: 0, items: [] };
    const entries = fs
      .readdirSync(snapshotsDir)
      .filter((f) => f.startsWith("sibgofrotorg-") && f.endsWith(".json"))
      .map((filename) => {
        const full = path.join(/*turbopackIgnore: true*/ snapshotsDir, filename);
        const st = fs.statSync(full);
        return {
          filename,
          sizeBytes: st.size,
          createdAt: st.mtime.toISOString(),
          mtimeMs: st.mtimeMs,
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return {
      total: entries.length,
      items: entries.slice(0, limit).map(({ filename, sizeBytes, createdAt }) => ({
        filename,
        sizeBytes,
        createdAt,
      })),
    };
  } catch {
    return { total: 0, items: [] };
  }
}

function rotateOldSnapshots(snapshotsDir: string, maxKeep: number): void {
  try {
    const files = fs
      .readdirSync(snapshotsDir)
      .filter((f) => f.startsWith("sibgofrotorg-") && f.endsWith(".json"))
      .map((name) => {
        const full = path.join(/*turbopackIgnore: true*/ snapshotsDir, name);
        const st = fs.statSync(full);
        return { full, mtimeMs: st.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (let i = maxKeep; i < files.length; i++) {
      try {
        fs.unlinkSync(files[i].full);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Выполняет сохранение локальной резервной копии на указанный диск прямо сейчас.
 */
export async function runServerAutoBackupNow(options?: {
  force?: boolean;
  skipRemoteSync?: boolean;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  savedFilePath?: string;
  snapshotFilename?: string;
  totalRows?: number;
  source?: string;
  syncWarning?: string | null;
  error?: string;
}> {
  const state = getState();
  const cfg = getDbRuntimeConfig();

  if (!options?.force && !cfg.autoBackupEnabled) {
    return { ok: true, skipped: true };
  }
  if (state.isRunning) {
    return { ok: true, skipped: true };
  }

  state.isRunning = true;
  const startedMs = Date.now();
  state.lastAttemptAt = new Date().toISOString();
  let syncWarning: string | null = null;
  let sourceLabel = "Локальная JSON-БД";

  try {
    // 1. Если сейчас активен внешний Supabase (#1 или #2), сначала освежаем снимок из него
    if (
      !options?.skipRemoteSync &&
      !getDbFailoverState().activeFallbackBackend &&
      (cfg.activeBackend === "primary" || cfg.activeBackend === "secondary")
    ) {
      const creds = resolveSupabaseCredentials(cfg.activeBackend);
      if (creds.configured) {
        try {
          const remoteClient = createDirectSupabaseClient(
            creds.url,
            creds.serviceRoleKey,
            18_000
          );
          await syncRemoteSupabaseToLocal(remoteClient, creds.label);
          sourceLabel = creds.label;
        } catch (syncErr: any) {
          // Если сервер БД упал — НЕ прерываем сохранение локального резерва на диск!
          syncWarning = syncErr?.message || String(syncErr);
          sourceLabel = "Локальная JSON-БД (внешний сервер недоступен)";
        }
      }
    }

    // 2. Записываем актуальную копию на целевой диск
    const targetDir = resolveServerBackupDir(cfg);
    const snapshotsDir = path.join(/*turbopackIgnore: true*/ targetDir, "snapshots");
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const latestPath = path.join(
      /*turbopackIgnore: true*/ targetDir,
      "sibgofrotorg-latest.json"
    );
    const liveMirrorPath = path.join(
      /*turbopackIgnore: true*/ targetDir,
      "local-db.json"
    );
    const snapshotFilename = formatSnapshotFilename();
    const timestampedPath = path.join(
      /*turbopackIgnore: true*/ snapshotsDir,
      snapshotFilename
    );

    const snapshot = exportLocalDbSnapshot(timestampedPath);
    writeJsonAtomic(latestPath, {
      ...snapshot,
      fileFullPath: latestPath,
      sgtEmergencyAuth: {
        ...snapshot.sgtEmergencyAuth,
        fileFullPath: latestPath,
      },
    });
    writeJsonAtomic(liveMirrorPath, {
      ...snapshot,
      fileFullPath: liveMirrorPath,
      sgtEmergencyAuth: {
        ...snapshot.sgtEmergencyAuth,
        fileFullPath: liveMirrorPath,
      },
    });
    writeJsonAtomic(timestampedPath, snapshot);

    // 3. Ротация старых копий, чтобы диск не переполнялся при интервале 2–3 минуты
    rotateOldSnapshots(snapshotsDir, cfg.maxBackupSnapshots);

    state.lastSuccessAt = new Date().toISOString();
    state.lastDurationMs = Date.now() - startedMs;
    state.lastSavedFilePath = timestampedPath;
    state.lastTotalRows = snapshot.totalRows;
    state.lastSource = sourceLabel;
    state.lastError = syncWarning
      ? `Копия локальной БД сохранена, но внешний сервер не ответил: ${syncWarning}`
      : null;
    persistStatusMeta(state);

    return {
      ok: true,
      savedFilePath: timestampedPath,
      snapshotFilename,
      totalRows: snapshot.totalRows,
      source: sourceLabel,
      syncWarning,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    state.lastDurationMs = Date.now() - startedMs;
    state.lastError = msg;
    persistStatusMeta(state);
    return {
      ok: false,
      error: msg,
    };
  } finally {
    state.isRunning = false;
  }
}

/**
 * Восстанавливает локальную JSON-БД из конкретного файла снимка с диска.
 */
export function restoreDiskBackupSnapshot(
  filename: string,
  mode: "replace" | "merge" = "replace"
): LocalDbSummary {
  const safeName = path.basename(String(filename || "").trim());
  if (!safeName || !safeName.endsWith(".json")) {
    throw new Error("Некорректное имя файла снимка");
  }
  const targetDir = resolveServerBackupDir();
  const candidatePaths = [
    path.join(/*turbopackIgnore: true*/ targetDir, "snapshots", safeName),
    path.join(/*turbopackIgnore: true*/ targetDir, safeName),
  ];
  const existingPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!existingPath) {
    throw new Error(`Файл снимка не найден на диске: ${safeName}`);
  }
  const parsed = JSON.parse(fs.readFileSync(existingPath, "utf8"));
  return importLocalDbSnapshot(parsed, mode);
}

function scheduleNextTick(): void {
  const state = getState();
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  const cfg = getDbRuntimeConfig();
  if (!cfg.autoBackupEnabled) {
    state.nextScheduledAt = null;
    return;
  }

  const delayMs = Math.max(30, cfg.autoBackupIntervalSec) * 1000;
  state.nextScheduledAt = new Date(Date.now() + delayMs).toISOString();

  state.timer = setTimeout(async () => {
    await runServerAutoBackupNow().catch((e) => {
      console.warn("[auto-backup] tick error:", e);
    });
    scheduleNextTick();
  }, delayMs);

  // Не блокируем штатное завершение процесса Node в тестах / CLI
  if (typeof (state.timer as any)?.unref === "function") {
    (state.timer as any).unref();
  }
}

/**
 * Запускает или перезапускает фоновый таймер автобэкапа с актуальными настройками.
 */
export function restartAutoBackupScheduler(options?: {
  runInitialSoon?: boolean;
}): void {
  const state = getState();
  state.started = true;
  scheduleNextTick();

  // При первом старте сервера делаем стартовую копию через 15 секунд,
  // чтобы пользователю не приходилось ждать первые 2,5 минуты.
  if (options?.runInitialSoon) {
    const cfg = getDbRuntimeConfig();
    if (cfg.autoBackupEnabled && !state.lastSuccessAt) {
      const warmup = setTimeout(() => {
        runServerAutoBackupNow().catch(() => {});
      }, 15_000);
      if (typeof (warmup as any)?.unref === "function") {
        (warmup as any).unref();
      }
    }
  }
}

export function stopAutoBackupScheduler(): void {
  const state = getState();
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.started = false;
  state.nextScheduledAt = null;
}

export function ensureAutoBackupSchedulerStarted(): void {
  const state = getState();
  if (state.started) return;
  restartAutoBackupScheduler({ runInitialSoon: true });
}

export function getAutoBackupStatus(): AutoBackupRuntimeStatus {
  const cfg = getDbRuntimeConfig();
  const state = getState();
  const { total, items } = listDiskBackupSnapshots(15);

  return {
    enabled: cfg.autoBackupEnabled,
    intervalSec: cfg.autoBackupIntervalSec,
    targetDir: resolveServerBackupDir(cfg),
    maxSnapshots: cfg.maxBackupSnapshots,
    schedulerActive: Boolean(state.timer),
    isRunning: state.isRunning,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastDurationMs: state.lastDurationMs,
    lastSavedFilePath: state.lastSavedFilePath,
    lastTotalRows: state.lastTotalRows,
    lastSource: state.lastSource,
    lastError: state.lastError,
    nextScheduledAt: state.nextScheduledAt,
    snapshotsCount: total,
    recentSnapshots: items,
  };
}
