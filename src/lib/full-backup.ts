// Full public-table snapshot/restore; remote operations require the dedicated
// service-role-only migration. Automatic replica refresh is explicit opt-in.
import fs from "node:fs";
import path from "node:path";
import { getDbFailoverState, getDbRuntimeConfig, getSgtDataDir, resolveServerBackupDir, resolveSupabaseCredentials, type DbBackendMode } from "./db-runtime-config";
import { readFullBackupSettings, type FullBackupSettings } from "./full-backup-settings";
import { createDirectSupabaseClient } from "./supabase-server-engine";
import { exportLocalDbSnapshot, getLocalDbSummary, importLocalDbSnapshot, ORDERED_BACKUP_TABLES } from "./local-json-db";

export interface FullSnapshot {
  app: "SibGofroTorg";
  backupFormat: "sgt-public-v1";
  version: number;
  exportedAt: string;
  totalRows: number;
  tables: Record<string, Record<string, unknown>[]>;
  columns: Record<string, Array<{ name: string; type: string; generated: string; identity: string }>>;
  sequences: Record<string, Record<string, unknown>>;
}

export function validateFullSnapshot(input: unknown): FullSnapshot {
  if (!input || typeof input !== "object") throw new Error("Некорректный файл резервной копии");
  const s = input as FullSnapshot;
  if (s.app !== "SibGofroTorg" || s.backupFormat !== "sgt-public-v1" || !s.tables || !s.columns || !s.sequences ||
      typeof s.tables !== "object" || typeof s.columns !== "object" || typeof s.sequences !== "object") {
    throw new Error("Нужен полный бэкап public нового формата, а не старый частичный JSON-снимок");
  }
  const names = Object.keys(s.tables).sort();
  if (!names.length || JSON.stringify(names) !== JSON.stringify(Object.keys(s.columns).sort()) || JSON.stringify(names) !== JSON.stringify(Object.keys(s.sequences).sort())) {
    throw new Error("В бэкапе отсутствует список таблиц или их схема");
  }
  let total = 0;
  for (const name of names) {
    if (["__proto__", "constructor", "prototype"].includes(name)) throw new Error(`Неподдерживаемое имя таблицы: ${name}`);
    const rows = s.tables[name]; const cols = s.columns[name];
    if (!Array.isArray(rows) || !Array.isArray(cols) || !cols.length || !s.sequences[name] || typeof s.sequences[name] !== "object") throw new Error(`Повреждена таблица ${name}`);
    const required = cols.map(c => c?.name);
    if (required.some(c => typeof c !== "string" || !c) || rows.some(r => !r || typeof r !== "object" || Array.isArray(r) || required.some(c => !Object.hasOwn(r, c)) || Object.keys(r).some(key => !required.includes(key)))) {
      throw new Error(`В таблице ${name} есть неполные строки или описание колонок`);
    }
    total += rows.length;
  }
  if (Number(s.totalRows) !== total) throw new Error("Количество строк в файле бэкапа не совпадает с содержимым");
  // JS cannot represent integers beyond 2^53 exactly; refuse to present such a
  // JSON snapshot as a lossless backup instead of silently rounding values.
  const checkNumbers = (value: unknown): void => {
    if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw new Error("В данных есть числа вне точного диапазона JSON/JavaScript; используйте PostgreSQL backup.");
    if (Array.isArray(value)) value.forEach(checkNumbers);
    else if (value && typeof value === "object") Object.values(value).forEach(checkNumbers);
  };
  checkNumbers(s.tables);
  return s;
}

function manifestPath() { return path.join(getSgtDataDir(), "full-backup-manifest.json"); }
function saveManifest(snapshot: FullSnapshot) {
  const file = manifestPath(); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ app: snapshot.app, backupFormat: snapshot.backupFormat, version: snapshot.version, columns: snapshot.columns, sequences: snapshot.sequences }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function effectiveSource(): DbBackendMode {
  return getDbFailoverState().activeFallbackBackend || getDbRuntimeConfig().activeBackend;
}

function direct(target: "primary" | "secondary") {
  const c = resolveSupabaseCredentials(target);
  if (!c.configured) throw new Error(`${c.label}: не заданы URL и секретный ключ`);
  return createDirectSupabaseClient(c.url, c.serviceRoleKey, 60_000);
}

export async function captureFullSnapshot(source: DbBackendMode): Promise<FullSnapshot> {
  if (source !== "local") {
    const { data, error } = await direct(source).rpc("sgt_export_app_data");
    if (error) throw new Error(`Не удалось получить полный снимок (${error.message}). Установите migration_complete_app_backup.sql на источнике.`);
    return validateFullSnapshot(data);
  }
  let manifest: Pick<FullSnapshot, "columns" | "sequences">;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath(), "utf8")); }
  catch { throw new Error("Для полного бэкапа локальной БД сначала создайте её полную копию из Supabase с новой миграцией или импортируйте полный бэкап."); }
  const local = exportLocalDbSnapshot();
  const names = Object.keys(manifest.columns || {});
  const extras = Object.keys(local.tables).filter(n => !names.includes(n) && local.tables[n]?.length);
  if (extras.length) throw new Error(`Нет описания локальных таблиц: ${extras.join(", ")}`);
  const tables = Object.fromEntries(names.map(name => [name, local.tables[name] || []]));
  return validateFullSnapshot({ app: "SibGofroTorg", backupFormat: "sgt-public-v1", version: 1, exportedAt: new Date().toISOString(), totalRows: Object.values(tables).reduce((n, rows) => n + rows.length, 0), tables, columns: manifest.columns, sequences: manifest.sequences });
}

export async function restoreFullSnapshot(snapshotInput: unknown, target: DbBackendMode, allowPendingLocal = false): Promise<void> {
  const snapshot = validateFullSnapshot(snapshotInput);
  if (target === "local") {
    if (!allowPendingLocal && getLocalDbSummary().pendingMutationsCount > 0) throw new Error("В локальной БД есть неотправленные изменения; автоматическая замена остановлена.");
    // Do not let the legacy normalizer seed default rows for tables absent
    // from a legitimate public snapshot.
    const emptyKnownTables = Object.fromEntries(ORDERED_BACKUP_TABLES.map(name => [name, []]));
    importLocalDbSnapshot({ ...snapshot, tables: { ...emptyKnownTables, ...snapshot.tables } }, "replace");
    saveManifest(snapshot);
    return;
  }
  const { error } = await direct(target).rpc("sgt_restore_app_data", { p_snapshot: snapshot });
  if (error) throw new Error(`Восстановление ${target} не выполнено: ${error.message}. Проверьте миграцию, совпадение схем и ограничения.`);
}

interface ReplicaResult { state: "ok" | "error" | "paused" | "source"; at: string; message: string; source?: DbBackendMode }
interface Runtime { timer?: ReturnType<typeof setTimeout>; running: boolean; lastRunAt: string | null; error: string | null; targets: Partial<Record<DbBackendMode, ReplicaResult>> }
const g = globalThis as unknown as { __sgtFullBackup?: Runtime };
function runtime(): Runtime {
  if (!g.__sgtFullBackup) {
    let saved: Partial<Runtime> = {};
    try { saved = JSON.parse(fs.readFileSync(path.join(getSgtDataDir(), "full-backup-status.json"), "utf8")); } catch { /* first run */ }
    g.__sgtFullBackup = { running: false, lastRunAt: saved.lastRunAt || null, error: saved.error || null, targets: saved.targets || {} };
  }
  return g.__sgtFullBackup;
}
function persistStatus(r: Runtime) {
  try {
    const dir = getSgtDataDir(); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, "full-backup-status.json"), tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ lastRunAt: r.lastRunAt, error: r.error, targets: r.targets }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) { console.error("[full-backup] could not persist status", e); }
}
export function fullBackupStatus() { const r = runtime(); return { running: r.running, lastRunAt: r.lastRunAt, error: r.error, targets: r.targets, source: effectiveSource(), settings: readFullBackupSettings() }; }
export function isFullBackupRunning() { return runtime().running; }
export function invalidateFullReplicaReadiness() {
  const r = runtime();
  r.targets = {};
  persistStatus(r);
}

// Use the same process-local exclusion for old asynchronous sync operations.
export function beginLegacyDbSync(): boolean {
  const r = runtime();
  if (r.running || readFullBackupSettings().enabled) return false;
  r.running = true;
  return true;
}
export function endLegacyDbSync() { runtime().running = false; }

/** A replica can only be promoted if it has completed a copy from the current writer. */
export function isFullReplicaReady(target: DbBackendMode): boolean {
  if (!readFullBackupSettings().enabled || target === effectiveSource()) return true;
  const result = runtime().targets[target];
  return result?.state === "ok" && result.source === effectiveSource();
}

function archiveSnapshot(snapshot: FullSnapshot) {
  const dir = path.join(resolveServerBackupDir(), "full-snapshots");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `sgt-full-${stamp}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
  const keep = getDbRuntimeConfig().maxBackupSnapshots;
  const snapshots = fs.readdirSync(dir).filter(name => name.startsWith("sgt-full-") && name.endsWith(".json")).sort().reverse();
  for (const old of snapshots.slice(keep)) fs.unlinkSync(path.join(dir, old));
}

function localFingerprint() { const s = exportLocalDbSnapshot(); return JSON.stringify({ tables: s.tables, pending: s.pendingMutations }); }
function sameSource(source: DbBackendMode) { return effectiveSource() === source; }

export async function runFullReplication(force = false) {
  const r = runtime();
  if (r.running) throw new Error("Синхронизация уже выполняется");
  const settings = readFullBackupSettings();
  if (!settings.enabled && !force) throw new Error("Автоматическая синхронизация остановлена");
  r.running = true; r.error = null;
  const source = effectiveSource();
  try {
    const before = localFingerprint();
    const snapshot = await captureFullSnapshot(source);
    if (snapshot.totalRows === 0) throw new Error("Источник пуст: автоматическая замена резервных баз остановлена. Для намеренного восстановления используйте импорт файла.");
    if (!sameSource(source)) throw new Error("Рабочая база изменилась во время снимка; синхронизация прервана");
    archiveSnapshot(snapshot);
    for (const target of ["local", "primary", "secondary"] as const) {
      const at = new Date().toISOString();
      if (target === source) { r.targets[target] = { state: "source", at, message: "Рабочая база", source }; continue; }
      if (!settings.targets[target]) { r.targets[target] = { state: "paused", at, message: "Копирование выключено", source }; continue; }
      try {
        if (!sameSource(source)) throw new Error("Рабочая база изменилась; повторите синхронизацию");
        if (source !== "local" && target !== "local" && resolveSupabaseCredentials(source).url === resolveSupabaseCredentials(target).url) throw new Error("Источник и резерв указывают на один сервер; копирование остановлено");
        if (target === "local" && localFingerprint() !== before) throw new Error("Локальная БД изменилась во время снимка; повторите синхронизацию");
        await restoreFullSnapshot(snapshot, target);
        r.targets[target] = { state: "ok", at, message: `Скопировано ${snapshot.totalRows} строк`, source };
      } catch (e) { r.targets[target] = { state: "error", at, message: e instanceof Error ? e.message : String(e), source }; }
    }
    r.lastRunAt = new Date().toISOString();
    r.running = false;
    return fullBackupStatus();
  } catch (e) { r.error = e instanceof Error ? e.message : String(e); throw e; }
  finally { r.running = false; persistStatus(r); }
}

function schedule() {
  const r = runtime(); if (r.timer) clearTimeout(r.timer);
  const cfg = readFullBackupSettings();
  if (!cfg.enabled) { r.timer = undefined; return; }
  r.timer = setTimeout(async () => { try { await runFullReplication(); } catch (e) { console.error("[full-backup]", e); } finally { schedule(); } }, cfg.intervalSec * 1000);
  r.timer.unref?.();
}
export function restartFullBackupScheduler() { schedule(); }
export function ensureFullBackupSchedulerStarted() { schedule(); }

/** Serialises owner-initiated restore against scheduled sync and backend switches. */
export async function restoreFullSnapshotTargets(input: unknown, targets: DbBackendMode[]) {
  const r = runtime();
  if (r.running) throw new Error("Дождитесь завершения копирования");
  r.running = true;
  try {
    const snapshot = validateFullSnapshot(input);
    // Even a partial restore changes the assumptions behind previous copy status.
    invalidateFullReplicaReadiness();
    const results: Array<{ target: DbBackendMode; ok: boolean; error?: string }> = [];
    for (const target of targets) {
      try { await restoreFullSnapshot(snapshot, target, true); results.push({ target, ok: true }); }
      catch (e) { results.push({ target, ok: false, error: e instanceof Error ? e.message : String(e) }); }
    }
    return results;
  } finally { r.running = false; }
}
