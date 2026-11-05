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

import { beginLegacyDbSync, endLegacyDbSync } from "./full-backup";
import { readFullBackupSettings } from "./full-backup-settings";
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
  void options;
  return { ok: false, error: "Серверные резервные копии отключены. Настройте архивы на ПК." };
}

/**
 * Восстанавливает локальную JSON-БД из конкретного файла снимка с диска.
 */
export function restoreDiskBackupSnapshot(
  filename: string,
  mode: "replace" | "merge" = "replace"
): LocalDbSummary {
  void filename; void mode;
  throw new Error("Восстановление серверных файлов отключено. Существующие файлы не удалены.");
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
  void options;
  stopAutoBackupScheduler();
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
    enabled: false,
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
