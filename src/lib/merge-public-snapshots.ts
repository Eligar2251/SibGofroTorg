/**
 * Conservative three-way merge of full public-table backups, entirely in the
 * browser. A true common ancestor is required. No database is modified.
 * Concurrent changes in the same table or sequence stop the merge.
 */
export type PublicBackup = {
  app: string;
  backupFormat: string;
  version: number;
  exportedAt: string;
  totalRows: number;
  tables: Record<string, Record<string, unknown>[]>;
  columns: Record<string, unknown[]>;
  sequences: Record<string, Record<string, unknown>>;
};

export function stable(value: unknown): string {
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw new Error("Недопустимое или слишком большое число в файле; используйте штатный бэкап PostgreSQL.");
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  throw new Error("Некорректное значение в JSON-бэкапе.");
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export function validatePublicBackup(value: unknown): PublicBackup {
  if (!object(value) || value.app !== "SibGofroTorg" || value.backupFormat !== "sgt-public-v1" || value.version !== 1 ||
      !object(value.tables) || !object(value.columns) || !object(value.sequences)) throw new Error("Для объединения нужны три полных файла формата sgt-public-v1.");
  const names = Object.keys(value.tables).sort();
  if (!names.length || stable(names) !== stable(Object.keys(value.columns).sort()) || stable(names) !== stable(Object.keys(value.sequences).sort())) throw new Error("Список таблиц или схема в файле повреждены.");
  let total = 0;
  for (const name of names) {
    if (["__proto__", "constructor", "prototype"].includes(name)) throw new Error(`Неподдерживаемое имя таблицы: ${name}`);
    const rows = value.tables[name], cols = value.columns[name], seq = value.sequences[name];
    if (!Array.isArray(rows) || !Array.isArray(cols) || !cols.length || !object(seq)) throw new Error(`Повреждена таблица ${name}.`);
    const colNames = cols.map(c => object(c) && typeof c.name === "string" ? c.name : "");
    if (colNames.some(x => !x) || new Set(colNames).size !== colNames.length) throw new Error(`Повреждена схема ${name}.`);
    for (const row of rows) {
      if (!object(row) || Object.keys(row).length !== colNames.length || colNames.some(c => !Object.hasOwn(row, c))) throw new Error(`Неполная строка таблицы ${name}.`);
    }
    stable(rows); stable(cols); stable(seq);
    total += rows.length;
  }
  if (value.totalRows !== total) throw new Error("Количество строк в файле не совпадает с содержимым.");
  return value as PublicBackup;
}
function tableContents(rows: Record<string, unknown>[]): string {
  // A PostgreSQL aggregate has no promised row order. Sorting the serialized
  // rows avoids treating reordering alone as a change, without assuming a PK.
  return stable(rows.map(stable).sort());
}
function changedValue(base: unknown, left: unknown, right: unknown): { value?: unknown; conflict: boolean } {
  const a = stable(base), b = stable(left), c = stable(right);
  if (b === c) return { value: left, conflict: false };
  if (a === b) return { value: right, conflict: false };
  if (a === c) return { value: left, conflict: false };
  return { conflict: true };
}
export function mergePublicSnapshots(baseInput: unknown, leftInput: unknown, rightInput: unknown): PublicBackup {
  const base = validatePublicBackup(baseInput), left = validatePublicBackup(leftInput), right = validatePublicBackup(rightInput);
  if (stable(base.columns) !== stable(left.columns) || stable(base.columns) !== stable(right.columns)) throw new Error("Схемы файлов отличаются. Объединение остановлено.");
  const names = Object.keys(base.tables).sort();
  if (stable(names) !== stable(Object.keys(left.tables).sort()) || stable(names) !== stable(Object.keys(right.tables).sort())) throw new Error("Списки таблиц отличаются. Объединение остановлено.");
  const tables: PublicBackup["tables"] = Object.create(null);
  const sequences: PublicBackup["sequences"] = Object.create(null);
  const conflicts: string[] = [];
  for (const name of names) {
    const a = tableContents(base.tables[name]), b = tableContents(left.tables[name]), c = tableContents(right.tables[name]);
    if (b === c || a === c) tables[name] = left.tables[name];
    else if (a === b) tables[name] = right.tables[name];
    else conflicts.push(`таблица ${name}`);
    const seqNames = Object.keys(base.sequences[name]).sort();
    if (stable(seqNames) !== stable(Object.keys(left.sequences[name]).sort()) || stable(seqNames) !== stable(Object.keys(right.sequences[name]).sort())) {
      conflicts.push(`состав последовательностей ${name}`); continue;
    }
    const seq: Record<string, unknown> = Object.create(null);
    for (const key of seqNames) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(`Неподдерживаемое имя последовательности: ${key}`);
      const choice = changedValue(base.sequences[name][key], left.sequences[name][key], right.sequences[name][key]);
      if (choice.conflict) conflicts.push(`последовательность ${name}.${key}`);
      else seq[key] = choice.value;
    }
    sequences[name] = seq;
  }
  if (conflicts.length) throw new Error(`Объединение остановлено: обе копии изменили ${conflicts.join(", ")}. Нужна ручная проверка; ни один файл не изменён.`);
  return { app: "SibGofroTorg", backupFormat: "sgt-public-v1", version: 1, exportedAt: new Date().toISOString(),
    totalRows: Object.values(tables).reduce((n, rows) => n + rows.length, 0), tables, columns: structuredClone(base.columns), sequences };
}
