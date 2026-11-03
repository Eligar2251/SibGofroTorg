// =========================================================
// FILE: src/lib/db-runtime-config.ts
// Оперативная конфигурация источника БД и расписания автобэкапа:
//   • primary   — Supabase #1 (основной / Бегет / из переменных окружения)
//   • secondary — Supabase #2 (облачный / резервный Supabase, настраивается в админке)
//   • local     — Локальная JSON-БД (.sgt-data/local-db.json, 100% автономная работа)
//   • Автобэкап каждые 2–3 минуты (по умолчанию 150 сек = 2,5 мин) на указанный диск/папку
// =========================================================

import fs from "node:fs";
import path from "node:path";

export type DbBackendMode = "primary" | "secondary" | "local";

/** Интервал автобэкапа по умолчанию: 150 секунд (2,5 минуты). */
export const DEFAULT_AUTO_BACKUP_INTERVAL_SEC = 150;
export const DEFAULT_MAX_BACKUP_SNAPSHOTS = 30;

export interface SupabaseEndpointConfig {
  label: string;
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export interface DbRuntimeConfig {
  activeBackend: DbBackendMode;
  /** Автоматический переход на резервный Supabase / локальную JSON-БД при падении активного сервера. */
  autoFailover: boolean;
  /** Дублировать все изменения (insert/update/upsert/delete) в локальную JSON-БД. */
  mirrorWritesToLocal: boolean;
  /** Включено ли автоматическое резервное копирование по таймеру (каждые 2–3 мин). */
  autoBackupEnabled: boolean;
  /** Интервал автокопирования в секундах (по умолчанию 150 сек = 2,5 мин). */
  autoBackupIntervalSec: number;
  /** Пользовательский путь / диск для сохранения резервных копий (напр. D:\Backups\SGT или /mnt/backup/sgt). */
  customBackupDir: string;
  /** Сколько последних версий снимков по времени хранить на диске (ротация). */
  maxBackupSnapshots: number;
  /** Полный путь к локальному файлу БД, по которому был выполнен аварийный вход. */
  lastEmergencyDbFilePath: string;
  /** Дата/время последнего аварийного входа по локальному файлу БД. */
  lastEmergencyLoginAt: string | null;
  primary: SupabaseEndpointConfig;
  secondary: SupabaseEndpointConfig;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface DbFailoverState {
  activeFallbackBackend: DbBackendMode | null;
  lastError: string | null;
  failedAt: string | null;
}

export function getSgtDataDir(): string {
  const custom = String(process.env.SGT_DATA_DIR || "").trim();
  if (custom) return path.resolve(/*turbopackIgnore: true*/ custom);
  return path.join(/*turbopackIgnore: true*/ process.cwd(), ".sgt-data");
}

export function getDbConfigFilePath(): string {
  return path.join(
    /*turbopackIgnore: true*/ getSgtDataDir(),
    "db-runtime-config.json"
  );
}

export function getLocalDbFilePath(): string {
  return path.join(/*turbopackIgnore: true*/ getSgtDataDir(), "local-db.json");
}

function clampIntervalSec(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_AUTO_BACKUP_INTERVAL_SEC;
  return Math.min(86_400, Math.max(30, n));
}

function clampMaxSnapshots(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_BACKUP_SNAPSHOTS;
  return Math.min(500, Math.max(3, n));
}

function ensureDataDir(): void {
  const dir = getSgtDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function defaultConfig(): DbRuntimeConfig {
  return {
    activeBackend: "primary",
    autoFailover: true,
    mirrorWritesToLocal: true,
    autoBackupEnabled: true,
    autoBackupIntervalSec: clampIntervalSec(
      process.env.SGT_AUTO_BACKUP_INTERVAL_SEC
    ),
    customBackupDir: String(process.env.SGT_BACKUP_DIR || "").trim(),
    maxBackupSnapshots: DEFAULT_MAX_BACKUP_SNAPSHOTS,
    lastEmergencyDbFilePath: "",
    lastEmergencyLoginAt: null,
    primary: {
      label: "Supabase #1 (Основной / .env)",
      url: "",
      anonKey: "",
      serviceRoleKey: "",
    },
    secondary: {
      label: "Supabase #2 (Облачный / Резервный)",
      url: String(process.env.SUPABASE_SECONDARY_URL || "").trim(),
      anonKey: String(process.env.SUPABASE_SECONDARY_ANON_KEY || "").trim(),
      serviceRoleKey: String(
        process.env.SUPABASE_SECONDARY_SERVICE_ROLE_KEY || ""
      ).trim(),
    },
    updatedAt: null,
    updatedBy: null,
  };
}

interface ConfigCache {
  configPath: string;
  mtimeMs: number;
  config: DbRuntimeConfig;
}

const globalRef = globalThis as unknown as {
  __sgtDbRuntimeConfigCache?: ConfigCache | null;
  __sgtDbFailoverState?: DbFailoverState;
};

function sanitizeEndpoint(
  raw: any,
  fallback: SupabaseEndpointConfig
): SupabaseEndpointConfig {
  if (!raw || typeof raw !== "object") return { ...fallback };
  return {
    label: String(raw.label ?? fallback.label).trim() || fallback.label,
    url: String(raw.url ?? fallback.url)
      .trim()
      .replace(/\/+$/, ""),
    anonKey: String(raw.anonKey ?? fallback.anonKey).trim(),
    serviceRoleKey: String(
      raw.serviceRoleKey ?? fallback.serviceRoleKey
    ).trim(),
  };
}

function normalizeConfig(raw: any): DbRuntimeConfig {
  const base = defaultConfig();
  if (!raw || typeof raw !== "object") return base;
  const mode: DbBackendMode =
    raw.activeBackend === "secondary" || raw.activeBackend === "local"
      ? raw.activeBackend
      : "primary";

  return {
    activeBackend: mode,
    autoFailover:
      raw.autoFailover !== undefined ? Boolean(raw.autoFailover) : true,
    mirrorWritesToLocal:
      raw.mirrorWritesToLocal !== undefined
        ? Boolean(raw.mirrorWritesToLocal)
        : true,
    autoBackupEnabled:
      raw.autoBackupEnabled !== undefined
        ? Boolean(raw.autoBackupEnabled)
        : true,
    autoBackupIntervalSec: clampIntervalSec(raw.autoBackupIntervalSec),
    customBackupDir:
      raw.customBackupDir !== undefined
        ? String(raw.customBackupDir).trim()
        : base.customBackupDir,
    maxBackupSnapshots: clampMaxSnapshots(raw.maxBackupSnapshots),
    lastEmergencyDbFilePath: raw.lastEmergencyDbFilePath
      ? String(raw.lastEmergencyDbFilePath).trim()
      : "",
    lastEmergencyLoginAt: raw.lastEmergencyLoginAt
      ? String(raw.lastEmergencyLoginAt)
      : null,
    primary: sanitizeEndpoint(raw.primary, base.primary),
    secondary: sanitizeEndpoint(raw.secondary, base.secondary),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : null,
  };
}

/**
 * Читает актуальную конфигурацию переключения БД и автобэкапа (с кэшем по mtime).
 */
export function getDbRuntimeConfig(): DbRuntimeConfig {
  const configPath = getDbConfigFilePath();
  try {
    const stat = fs.statSync(configPath);
    const cached = globalRef.__sgtDbRuntimeConfigCache;
    if (
      cached &&
      cached.configPath === configPath &&
      cached.mtimeMs === stat.mtimeMs
    ) {
      return cached.config;
    }
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const config = normalizeConfig(raw);
    globalRef.__sgtDbRuntimeConfigCache = {
      configPath,
      mtimeMs: stat.mtimeMs,
      config,
    };
    return config;
  } catch {
    return defaultConfig();
  }
}

/**
 * Разрешает целевую папку на диске для сохранения резервных копий:
 * либо указанный пользователем диск/путь (`customBackupDir`), либо `.sgt-data/backups`.
 */
export function resolveServerBackupDir(cfg?: DbRuntimeConfig): string {
  const active = cfg || getDbRuntimeConfig();
  const custom = String(active.customBackupDir || "").trim();
  if (custom) {
    return path.resolve(/*turbopackIgnore: true*/ custom);
  }
  return path.join(/*turbopackIgnore: true*/ getSgtDataDir(), "backups");
}

/**
 * Сохраняет обновлённую конфигурацию переключения БД и автобэкапа атомарно на диск.
 */
export function saveDbRuntimeConfig(
  patch: Partial<{
    activeBackend: DbBackendMode;
    autoFailover: boolean;
    mirrorWritesToLocal: boolean;
    autoBackupEnabled: boolean;
    autoBackupIntervalSec: number;
    customBackupDir: string;
    maxBackupSnapshots: number;
    lastEmergencyDbFilePath: string;
    lastEmergencyLoginAt: string | null;
    primary: Partial<SupabaseEndpointConfig>;
    secondary: Partial<SupabaseEndpointConfig>;
    updatedBy: string | null;
  }>
): DbRuntimeConfig {
  ensureDataDir();
  const current = getDbRuntimeConfig();

  const mergeEndpoint = (
    prev: SupabaseEndpointConfig,
    next?: Partial<SupabaseEndpointConfig>
  ): SupabaseEndpointConfig => {
    if (!next) return prev;
    return {
      label:
        next.label !== undefined
          ? String(next.label).trim() || prev.label
          : prev.label,
      url:
        next.url !== undefined
          ? String(next.url).trim().replace(/\/+$/, "")
          : prev.url,
      anonKey:
        next.anonKey !== undefined && !isMaskedSecret(next.anonKey)
          ? String(next.anonKey).trim()
          : prev.anonKey,
      serviceRoleKey:
        next.serviceRoleKey !== undefined &&
        !isMaskedSecret(next.serviceRoleKey)
          ? String(next.serviceRoleKey).trim()
          : prev.serviceRoleKey,
    };
  };

  const updated: DbRuntimeConfig = normalizeConfig({
    ...current,
    ...(patch.activeBackend !== undefined
      ? { activeBackend: patch.activeBackend }
      : {}),
    ...(patch.autoFailover !== undefined
      ? { autoFailover: patch.autoFailover }
      : {}),
    ...(patch.mirrorWritesToLocal !== undefined
      ? { mirrorWritesToLocal: patch.mirrorWritesToLocal }
      : {}),
    ...(patch.autoBackupEnabled !== undefined
      ? { autoBackupEnabled: patch.autoBackupEnabled }
      : {}),
    ...(patch.autoBackupIntervalSec !== undefined
      ? { autoBackupIntervalSec: patch.autoBackupIntervalSec }
      : {}),
    ...(patch.customBackupDir !== undefined
      ? { customBackupDir: patch.customBackupDir }
      : {}),
    ...(patch.maxBackupSnapshots !== undefined
      ? { maxBackupSnapshots: patch.maxBackupSnapshots }
      : {}),
    ...(patch.lastEmergencyDbFilePath !== undefined
      ? { lastEmergencyDbFilePath: patch.lastEmergencyDbFilePath }
      : {}),
    ...(patch.lastEmergencyLoginAt !== undefined
      ? { lastEmergencyLoginAt: patch.lastEmergencyLoginAt }
      : {}),
    primary: mergeEndpoint(current.primary, patch.primary),
    secondary: mergeEndpoint(current.secondary, patch.secondary),
    updatedAt: new Date().toISOString(),
    updatedBy:
      patch.updatedBy !== undefined ? patch.updatedBy : current.updatedBy,
  });

  const configPath = getDbConfigFilePath();
  const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmpPath, configPath);

  const stat = fs.statSync(configPath);
  globalRef.__sgtDbRuntimeConfigCache = {
    configPath,
    mtimeMs: stat.mtimeMs,
    config: updated,
  };

  if (patch.activeBackend !== undefined) {
    clearDbFailoverState();
  }

  return updated;
}

export function resetDbRuntimeConfigCache(): void {
  globalRef.__sgtDbRuntimeConfigCache = null;
}

export function resolveSupabaseCredentials(target: "primary" | "secondary"): {
  label: string;
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  configured: boolean;
  usingEnvFallback: boolean;
} {
  const cfg = getDbRuntimeConfig();
  if (target === "primary") {
    const envUrl = String(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
    )
      .trim()
      .replace(/\/+$/, "");
    const envAnon = String(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    ).trim();
    const envService = String(
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    ).trim();

    const url = cfg.primary.url || envUrl;
    const anonKey = cfg.primary.anonKey || envAnon;
    const serviceRoleKey = cfg.primary.serviceRoleKey || envService;
    return {
      label: cfg.primary.label || "Supabase #1 (Основной)",
      url,
      anonKey,
      serviceRoleKey,
      configured: Boolean(url && serviceRoleKey),
      usingEnvFallback: !cfg.primary.url && Boolean(envUrl),
    };
  }

  const url = cfg.secondary.url;
  const anonKey = cfg.secondary.anonKey;
  const serviceRoleKey = cfg.secondary.serviceRoleKey;
  return {
    label: cfg.secondary.label || "Supabase #2 (Облачный)",
    url,
    anonKey,
    serviceRoleKey,
    configured: Boolean(url && serviceRoleKey),
    usingEnvFallback: false,
  };
}

export function maskSecret(secret: string | null | undefined): string {
  const s = String(secret || "").trim();
  if (!s) return "";
  if (s.length <= 12) return "••••••••";
  return `${s.slice(0, 6)}••••••••${s.slice(-4)}`;
}

export function isMaskedSecret(value: string | null | undefined): boolean {
  return String(value || "").includes("••••");
}

export function getDbFailoverState(): DbFailoverState {
  if (!globalRef.__sgtDbFailoverState) {
    globalRef.__sgtDbFailoverState = {
      activeFallbackBackend: null,
      lastError: null,
      failedAt: null,
    };
  }
  return globalRef.__sgtDbFailoverState;
}

export function recordDbFailover(
  fallbackBackend: DbBackendMode,
  reason: string
): void {
  globalRef.__sgtDbFailoverState = {
    activeFallbackBackend: fallbackBackend,
    lastError: reason,
    failedAt: new Date().toISOString(),
  };
}

export function clearDbFailoverState(): void {
  globalRef.__sgtDbFailoverState = {
    activeFallbackBackend: null,
    lastError: null,
    failedAt: null,
  };
}

export function toPublicDbConfigView() {
  const cfg = getDbRuntimeConfig();
  const primary = resolveSupabaseCredentials("primary");
  const secondary = resolveSupabaseCredentials("secondary");
  const failover = getDbFailoverState();

  return {
    activeBackend: cfg.activeBackend,
    autoFailover: cfg.autoFailover,
    mirrorWritesToLocal: cfg.mirrorWritesToLocal,
    autoBackupEnabled: cfg.autoBackupEnabled,
    autoBackupIntervalSec: cfg.autoBackupIntervalSec,
    customBackupDir: cfg.customBackupDir,
    resolvedBackupDir: resolveServerBackupDir(cfg),
    maxBackupSnapshots: cfg.maxBackupSnapshots,
    lastEmergencyDbFilePath: cfg.lastEmergencyDbFilePath,
    lastEmergencyLoginAt: cfg.lastEmergencyLoginAt,
    updatedAt: cfg.updatedAt,
    updatedBy: cfg.updatedBy,
    failover,
    primary: {
      label: primary.label,
      url: primary.url,
      customUrl: cfg.primary.url,
      hasAnonKey: Boolean(primary.anonKey),
      hasServiceRoleKey: Boolean(primary.serviceRoleKey),
      anonKeyMasked: maskSecret(primary.anonKey),
      serviceRoleKeyMasked: maskSecret(primary.serviceRoleKey),
      configured: primary.configured,
      usingEnvFallback: primary.usingEnvFallback,
    },
    secondary: {
      label: secondary.label,
      url: secondary.url,
      hasAnonKey: Boolean(secondary.anonKey),
      hasServiceRoleKey: Boolean(secondary.serviceRoleKey),
      anonKeyMasked: maskSecret(secondary.anonKey),
      serviceRoleKeyMasked: maskSecret(secondary.serviceRoleKey),
      configured: secondary.configured,
    },
  };
}
