import { stable, validatePublicBackup, type PublicBackup } from "./merge-public-snapshots";

export type PcCatalog = Record<string, { columns: unknown[]; pk: string[] }>;
export type PcTracking = { instance: string; cursor: string; catalogHash: string; catalog: PcCatalog };
export type PcTrackedBackup = PublicBackup & { pcTracking: PcTracking };
type Change = { keys: Record<string, unknown>[]; rows: Record<string, unknown>[] };
export type PcDelta = { reset: boolean; cursor?: string; tables?: Record<string, Change>; sequences?: PublicBackup["sequences"] | null };
function plain(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }
function rowKey(row: Record<string, unknown>, pk: string[]): string {
  if (!pk.length || pk.some(k => !Object.hasOwn(row, k) || row[k] === null || row[k] === undefined)) throw new Error("Некорректный первичный ключ в изменениях.");
  return stable(pk.map(k => row[k]));
}
export function validateTrackedBackup(raw: unknown): PcTrackedBackup {
  const backup = validatePublicBackup(raw);
  const tracking = (raw as PcTrackedBackup).pcTracking;
  if (!plain(tracking) || typeof tracking.instance !== "string" || !/^[a-f0-9]{32}$/.test(tracking.instance) || typeof tracking.cursor !== "string" || !/^\d{1,19}$/.test(tracking.cursor) || typeof tracking.catalogHash !== "string" || !/^[a-f0-9]{32}$/.test(tracking.catalogHash) || !plain(tracking.catalog)) throw new Error("Отсутствуют или повреждены метаданные отслеживания; файл не будет перезаписан.");
  const names = Object.keys(backup.tables).sort();
  if (stable(names) !== stable(Object.keys(tracking.catalog).sort())) throw new Error("Список таблиц отслеживания не совпадает с файлом.");
  for (const name of names) {
    const c = tracking.catalog[name];
    if (!plain(c) || !Array.isArray(c.pk) || !Array.isArray(c.columns) || c.pk.some(k => typeof k !== "string" || !k) || new Set(c.pk).size !== c.pk.length || stable(c.columns) !== stable(backup.columns[name])) throw new Error(`Схема отслеживания таблицы ${name} не совпадает с файлом.`);
  }
  return raw as PcTrackedBackup;
}
export function trackedFromInitial(raw: unknown): PcTrackedBackup {
  if (!plain(raw) || !plain(raw.snapshot)) throw new Error("Некорректный начальный снимок.");
  return validateTrackedBackup({ ...raw.snapshot, pcTracking: { instance: raw.instance, cursor: raw.cursor, catalogHash: raw.catalogHash, catalog: raw.catalog } });
}
export function applyPcDelta(current: PcTrackedBackup, delta: PcDelta): { backup: PcTrackedBackup; changed: boolean } {
  if (!plain(delta) || delta.reset !== false || typeof delta.cursor !== "string" || !/^\d{1,19}$/.test(delta.cursor) || !plain(delta.tables)) throw new Error("Некорректный ответ сервера об изменениях.");
  if (BigInt(delta.cursor) < BigInt(current.pcTracking.cursor)) throw new Error("Курсор изменений отступил назад.");
  const tables = { ...current.tables };
  let changed = false;
  for (const [name, change] of Object.entries(delta.tables)) {
    const schema = current.pcTracking.catalog[name];
    if (!schema || !Object.hasOwn(tables, name) || !plain(change) || !Array.isArray(change.keys) || !Array.isArray(change.rows) || !schema.pk.length) throw new Error(`Некорректные изменения таблицы ${name}.`);
    const keys = new Set<string>();
    for (const key of change.keys) {
      if (!plain(key) || Object.keys(key).length !== schema.pk.length) throw new Error(`Некорректные ключи таблицы ${name}.`);
      keys.add(rowKey(key, schema.pk));
    }
    const existing = new Map<string, Record<string, unknown>>();
    const untouched: Record<string, unknown>[] = [];
    for (const row of tables[name]) {
      const key = rowKey(row, schema.pk);
      if (existing.has(key)) throw new Error(`Повторный ключ в таблице ${name}.`);
      existing.set(key, row);
      if (!keys.has(key)) untouched.push(row);
    }
    const incoming = new Map<string, Record<string, unknown>>();
    const colNames = current.columns[name].map(c => plain(c) && typeof c.name === "string" ? c.name : "");
    for (const row of change.rows) {
      if (!plain(row) || Object.keys(row).length !== colNames.length || colNames.some(k => !Object.hasOwn(row,k))) throw new Error(`Неполная строка таблицы ${name}.`);
      stable(row); // Reject unsafe JS numbers, including nested JSON values.
      const key = rowKey(row, schema.pk);
      if (!keys.has(key) || incoming.has(key)) throw new Error(`Непредусмотренная или повторная строка таблицы ${name}.`);
      incoming.set(key, row);
    }
    for (const key of keys) {
      const old = existing.get(key), next = incoming.get(key);
      if (!!old !== !!next || (old && next && stable(old) !== stable(next))) changed = true;
    }
    tables[name] = [...untouched, ...incoming.values()];
  }
  const sequences = delta.sequences == null ? current.sequences : delta.sequences;
  if (!plain(sequences) || stable(Object.keys(sequences).sort()) !== stable(Object.keys(current.sequences).sort()) || Object.values(sequences).some(seq => !plain(seq))) throw new Error("Состояние последовательностей повреждено.");
  if (stable(sequences) !== stable(current.sequences)) changed = true;
  const backup: PcTrackedBackup = { ...current, tables, sequences, totalRows: Object.values(tables).reduce((n, rows) => n + rows.length, 0), pcTracking: { ...current.pcTracking, cursor: delta.cursor } };
  return { backup, changed };
}
