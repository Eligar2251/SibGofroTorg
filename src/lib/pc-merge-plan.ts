/**
 * A comparison plan only: no file or database is changed by this module.
 * A future executor must use a database transaction with a compare-and-swap
 * check of every before value, and validate all PostgreSQL constraints.
 */
import { stable, validatePublicBackup, type PublicBackup } from "./merge-public-snapshots";
import type { PcCatalog } from "./pc-incremental";

export type PcRowChange = { table: string; key: Record<string, unknown>; base: Record<string, unknown> | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
export type PcMergeConflict = { table: string; key: Record<string, unknown> | null; reason: "both_changed" | "no_primary_key" | "sequence_changed" };
export type PcMergePlan = { changes: PcRowChange[]; conflicts: PcMergeConflict[]; sequenceChanges: string[]; needsDatabaseValidation: true };
function plain(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function keyFor(row: Record<string, unknown>, pk: string[], table: string) {
  const value: Record<string, unknown> = Object.create(null);
  for (const col of pk) {
    if (!Object.hasOwn(row,col) || row[col] === null || row[col] === undefined) throw new Error(`В таблице ${table} отсутствует первичный ключ.`);
    value[col] = row[col];
  }
  return { id:stable(pk.map(c=>value[c])), value };
}
function rowsByKey(rows: Record<string, unknown>[], pk: string[], table: string) {
  const result = new Map<string, { key:Record<string, unknown>; row:Record<string, unknown> }>();
  for (const row of rows) {
    const {id,value} = keyFor(row,pk,table);
    if (result.has(id)) throw new Error(`В таблице ${table} повторяется первичный ключ.`);
    result.set(id,{key:value,row});
  }
  return result;
}
function equal(a: unknown, b: unknown) { return stable(a) === stable(b); }
function content(rows: Record<string, unknown>[]) { return rows.map(stable).sort().join("\n"); }
/** Catalog must come from the same actual source schema, not be guessed by table name. */
export function planPcMerge(baseInput: unknown, localInput: unknown, remoteInput: unknown, catalog: PcCatalog): PcMergePlan {
  const base = validatePublicBackup(baseInput), local = validatePublicBackup(localInput), remote = validatePublicBackup(remoteInput);
  if (!plain(catalog) || !equal(base.columns,local.columns) || !equal(base.columns,remote.columns) || !equal(Object.keys(catalog).sort(),Object.keys(base.tables).sort())) throw new Error("Схемы файлов или каталог первичных ключей не совпадают.");
  const result: PcMergePlan = {changes:[],conflicts:[],sequenceChanges:[],needsDatabaseValidation:true};
  for (const table of Object.keys(base.tables).sort()) {
    const meta = catalog[table];
    const pk = meta?.pk;
    if (!plain(meta) || !Array.isArray(meta.columns) || !equal(meta.columns,base.columns[table]) || !Array.isArray(pk) || pk.some(x=>typeof x !== "string" || !x) || new Set(pk).size !== pk.length || pk.some(k=>!base.columns[table].some(c=>plain(c) && c.name === k))) throw new Error(`Каталог первичных ключей таблицы ${table} повреждён.`);
    if (!equal(base.sequences[table],local.sequences[table])) {
      result.sequenceChanges.push(table);
      // setval is non-transactional and independent PCs can allocate the same
      // number: never silently apply sequence changes.
      result.conflicts.push({table,key:null,reason:"sequence_changed"});
    }
    if (!pk.length) {
      if (content(base.tables[table]) !== content(local.tables[table])) result.conflicts.push({table,key:null,reason:"no_primary_key"});
      continue;
    }
    const b=rowsByKey(base.tables[table],pk,table), l=rowsByKey(local.tables[table],pk,table), r=rowsByKey(remote.tables[table],pk,table);
    for (const id of Array.from(new Set([...b.keys(),...l.keys()])).sort()) {
      const baseRow=b.get(id)?.row ?? null, localRow=l.get(id)?.row ?? null, remoteRow=r.get(id)?.row ?? null;
      if (equal(baseRow,localRow) || equal(localRow,remoteRow)) continue;
      const key=(l.get(id) || b.get(id))!.key;
      if (!equal(baseRow,remoteRow)) { result.conflicts.push({table,key,reason:"both_changed"}); continue; }
      result.changes.push({table,key,base:baseRow,before:remoteRow,after:localRow});
    }
  }
  // Isolate the plan from the three inputs; modifying a preview must not mutate them.
  return JSON.parse(JSON.stringify(result)) as PcMergePlan;
}
