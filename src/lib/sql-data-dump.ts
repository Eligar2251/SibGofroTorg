// =========================================================
// FILE: src/lib/sql-data-dump.ts
// Полный SQL-дамп ДАННЫХ всех таблиц public из полного снимка
// `sgt-public-v1` (того же файла, который сохраняется в JSON-бэкап).
//
// Зачем: файл можно целиком вставить в Supabase → SQL Editor и получить
// те же товары и данные, что лежали в базе на момент снимка. Восстановление
// не требует работающего сайта и не зависит от RPC.
//
// Почему файл безопасен для пулера transaction pooling:
//   • ни временных таблиц, ни курсоров, ни `SET LOCAL`, ни advisory locks;
//   • ни `BEGIN;`/`COMMIT;` — редактор оборачивает скрипт сам;
//   • порядок вставки таблиц — от родительских к дочерним, поэтому внешние
//     ключи не мешают загрузке;
//   • повторный запуск даёт тот же результат: очистка всех таблиц одной
//     командой, затем вставка снимка.
// Зависимостей от Node нет: модуль пригоден и для автономной HTML-админки.
// =========================================================

/** Колонка снимка: метаданные приходят из `sgt_export_app_data()` (pg_attribute). */
export type SqlDumpColumn = { name?: string; type?: string; generated?: string; identity?: string };
export type SqlDumpSequence = { last?: string | number; called?: boolean };

/** Формат полного снимка `sgt-public-v1` (совпадает с JSON-бэкапом). */
export type SqlDumpSnapshot = {
  app: string;
  backupFormat: string;
  version: number;
  exportedAt: string;
  totalRows: number;
  tables: Record<string, Record<string, unknown>[]>;
  columns: Record<string, SqlDumpColumn[]>;
  sequences: Record<string, Record<string, SqlDumpSequence | unknown>>;
};

export type SqlDumpOptions = {
  /** Сколько строк в один `INSERT`. По умолчанию 400. */
  rowsPerStatement?: number;
  /** Предельный размер одного оператора в символах. По умолчанию 700 000. */
  maxStatementChars?: number;
  /** Добавить в конце запрос сверки «Ожидалось / Стало» по каждой таблице. */
  verify?: boolean;
  /** Подпись источника в шапке (например «Supabase №1»). */
  sourceLabel?: string;
  /**
   * Дочерняя таблица → имена родительских. Нужен для порядка вставки.
   * Без него берётся SCHEMA_FOREIGN_KEY_PARENTS — статическая карта проекта.
   */
  foreignKeyParents?: Record<string, string[]>;
  /** Отключать пользовательские триггеры на время загрузки. По умолчанию true. */
  triggerControl?: boolean;
};

export type SqlDumpResult = {
  sql: string;
  filename: string;
  totalRows: number;
  tables: Array<{ name: string; rows: number }>;
  warnings: string[];
  bytes: number;
};

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

/**
 * Внешние ключи схемы на 2026-11 (совпадают с supabase/FULL_DATABASE_MIGRATION.sql,
 * что проверяет тест tests/full-backup.test.mjs). Нужны только для порядка вставки,
 * когда файл схемы недоступен — например, дамп собирается в браузере из JSON-копии.
 */
export const SCHEMA_FOREIGN_KEY_PARENTS: Record<string, string[]> = {
  bank_payments: ["warehouse_purchase_plans"],
  consignment_manual_sales: ["warehouse_receipts"],
  rent_office_units: ["rent_buildings"],
  rent_meter_readings: ["rent_tenants"],
};
const JSON_TYPES = new Set(["json", "jsonb"]);
const ROWS_PER_STATEMENT_DEFAULT = 400;
const MAX_STATEMENT_CHARS_DEFAULT = 700_000;

function quoteIdent(name: string, what: string): string {
  if (typeof name !== "string" || !IDENT.test(name)) throw new Error(`Неподдерживаемое имя ${what}: ${String(name).slice(0, 80)}`);
  return `"${name}"`;
}

/** `public."products"` — всегда с явной схемой, чтобы не зависеть от search_path. */
function qualified(name: string): string {
  return `public.${quoteIdent(name, "таблицы")}`;
}

/** Имя файла одинаково для одного и того же снимка, чтобы копии совпадали. */
export function sqlDumpFilename(input?: string | Date): string {
  const parsed = input instanceof Date ? input : input ? new Date(input) : new Date();
  const when = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `sgt-full-data-${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}.sql`;
}

/**
 * Литерал PostgreSQL из готового текста. При `standard_conforming_strings=on`
 * (так в Supabase) косая черта в `'...'` — обычный символ; если она есть или
 * встретился управляющий символ, переходим на `E'...'` и удваиваем косые черты.
 */
export function sqlStringLiteral(text: string): string {
  const doubled = text.replace(/'/g, "''");
  if (!/[\u0000-\u001f\u007f\\]/.test(text)) return `'${doubled}'`;
  const escaped = doubled
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\u0000-\u001f\u007f]/g, ch => `\\${ch.charCodeAt(0).toString(8).padStart(3, "0")}`);
  return `E'${escaped}'`;
}

function jsonText(value: unknown): string {
  try { return JSON.stringify(value) ?? "null"; }
  catch { throw new Error("В данных есть значение, которое нельзя сериализовать в JSON; снимок повреждён."); }
}

/** Массив PostgreSQL (`text[]`, `integer[]`) в литерале `{…}`; вложенность поддерживается. */
function pgArrayLiteral(value: unknown[]): string {
  const parts = value.map(item => {
    if (item === null || item === undefined) return "NULL";
    if (Array.isArray(item)) return pgArrayLiteral(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item) || Math.abs(item) > Number.MAX_SAFE_INTEGER) throw new Error("В данных есть число вне точного диапазона JSON; используйте штатный бэкап PostgreSQL.");
      return String(item);
    }
    if (typeof item === "boolean") return item ? "true" : "false";
    // Кавычки и косые черты внутри элемента экранирует сам парсер массивов.
    return `"${String(item).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
  return `{${parts.join(",")}}`;
}

/** Один SQL-литерал значения колонки с учётом типа из pg_attribute. */
export function sqlValueLiteral(value: unknown, type: string, where: string): string {
  if (value === null || value === undefined) return "NULL";
  const base = String(type || "").trim().toLowerCase();
  if (JSON_TYPES.has(base)) return `${sqlStringLiteral(jsonText(value))}::${base}`;
  if (base.endsWith("[]")) {
    if (!Array.isArray(value)) throw new Error(`Ожидался массив в ${where}, получен ${typeof value}.`);
    return `${sqlStringLiteral(pgArrayLiteral(value))}::${base}`;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error(`Число вне точного диапазона JSON в ${where}.`);
    return String(value);
  }
  if (typeof value === "string") return sqlStringLiteral(value);
  // Объект в колонке не json/jsonb означает рассинхрон снимка со схемой:
  // текстовое представление составного типа угадывать нельзя.
  throw new Error(`Неподдерживаемый тип ${base || "unknown"} в ${where}; обновите снимок после изменения схемы.`);
}

/**
 * Порядок таблиц для вставки: сначала родительские, затем дочерние.
 * Без внешних ключей порядок просто алфавитный — детерминированный, чтобы два
 * дампа одного и того же снимка совпадали побайтово.
 * Цикл размыкается алфавитно и попадёт в warnings: такие таблицы в Supabase
 * всё равно нельзя очистить поштучно, а общий TRUNCATE всех таблиц цикла не боится.
 */
export function tableInsertOrder(names: string[], parents: Record<string, string[]> = {}): { order: string[]; cycles: string[] } {
  const known = new Set(names);
  const pending = new Set(names);
  const edges = new Map<string, Set<string>>();
  for (const name of names) {
    const deps = new Set((parents[name] || []).filter(p => known.has(p) && p !== name));
    edges.set(name, deps);
  }
  const order: string[] = [];
  const sorted = [...names].sort();
  while (pending.size) {
    const ready = sorted.filter(name => pending.has(name) && [...(edges.get(name) || [])].every(dep => !pending.has(dep)));
    if (ready.length) {
      for (const name of ready) { order.push(name); pending.delete(name); }
      continue;
    }
    // Цикл: берём первую алфавитную таблицу и больше не ждём её родителей.
    const broken = sorted.find(name => pending.has(name))!;
    order.push(broken);
    pending.delete(broken);
    edges.set(broken, new Set());
  }
  const cycles = sorted.filter(name => [...(parents[name] || [])].some(p => p !== name && known.has(p) && (parents[p] || []).includes(name)));
  return { order, cycles };
}

/**
 * Внешние ключи из SQL-скрипта схемы (`supabase/FULL_DATABASE_MIGRATION.sql`):
 * дочерняя таблица → список родительских. Нужен только для порядка вставки.
 * Разбор построчный и консервативный: строки комментариев и текстовые литералы
 * игнорируются, поэтому лишней связи не появится. Если что-то не распознано,
 * порядок просто станет алфавитным — в `public` проекта внешних ключей четыре.
 */
export function foreignKeyParentsFromSql(sql: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const bare = (name: string) => name.replace(/"/g, "");
  const add = (child: string, parent: string) => {
    if (!IDENT.test(child) || !IDENT.test(parent) || child === parent) return;
    const list = result[child] || (result[child] = []);
    if (!list.includes(parent)) list.push(parent);
  };
  // Комментарий и строковые литералы в строке не участвуют.
  const clean = (line: string) => line
    .replace(/'([^']|'')*'/g, "''")
    .replace(/--.*$/, "")
    .replace(/\/\*[^]*?\*\//g, "");
  const reference = /REFERENCES\s+(?:public\.)?("?[a-zA-Z_][a-zA-Z0-9_$]*"?)\s*\(/gi;
  const lines = sql.split("\n");
  let current: string | null = null;
  for (const raw of lines) {
    const line = clean(raw).trim();
    if (!line) continue;
    if (current === null) {
      const open = /^(?:CREATE|CREATE\s+TEMP)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("?[a-zA-Z_][a-zA-Z0-9_$]*"?)\s*\(/i.exec(line);
      if (open) current = bare(open[1]);
    }
    if (current !== null) {
      for (const match of line.matchAll(reference)) add(current, bare(match[1]));
      // Таблица закрылась строкой, начинающейся со скобки.
      if (/^\)/.test(line)) current = null;
    }
    // Отдельные ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES ...
    const alter = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?("?[a-zA-Z_][a-zA-Z0-9_$]*"?)\s+ADD\s+CONSTRAINT/i.test(line);
    if (alter) for (const match of line.matchAll(reference)) add(bare(line.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?("?[a-zA-Z_][a-zA-Z0-9_$]*"?)/i)![1]), bare(match[1]));
  }
  // ALTER TABLE часто пишется несколькими строками: собираем их в одну.
  const joined = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
  const alterMulti = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?("?[a-zA-Z_][a-zA-Z0-9_$]*"?)\s+ADD\s+CONSTRAINT[^;]*?FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+(?:public\.)?("?[a-zA-Z_][a-zA-Z0-9_$]*"?)/gi;
  for (const match of joined.matchAll(alterMulti)) add(bare(match[1]), bare(match[2]));
  return result;
}

function normalizeColumns(value: unknown): SqlDumpColumn[] {
  if (!Array.isArray(value)) throw new Error("Описание колонок в снимке отсутствует или повреждено.");
  return value.map(c => (c && typeof c === "object" ? c as SqlDumpColumn : { name: typeof c === "string" ? c : undefined }));
}

/**
 * Дамп данных из полного снимка. Чистая функция: тот же файл на входе — тот же
 * текст на выходе, поэтому две копии одного снимка совпадают побайтово.
 */
export function buildSqlDataDump(input: unknown, options: SqlDumpOptions = {}): SqlDumpResult {
  if (!input || typeof input !== "object") throw new Error("Некорректный снимок: ожидался JSON полного бэкапа.");
  const snapshot = input as SqlDumpSnapshot;
  if (snapshot.app !== "SibGofroTorg" || snapshot.backupFormat !== "sgt-public-v1") {
    throw new Error("Нужен полный бэкап public формата sgt-public-v1, а не частичный снимок.");
  }
  if (!snapshot.tables || typeof snapshot.tables !== "object" || !snapshot.columns || typeof snapshot.columns !== "object") {
    throw new Error("В снимке нет разделов tables или columns.");
  }
  const names = Object.keys(snapshot.tables).filter(name => Array.isArray(snapshot.tables[name]));
  if (!names.length) throw new Error("В снимке нет ни одной таблицы с данными.");
  for (const name of names) quoteIdent(name, "таблицы");

  const warnings: string[] = [];
  const rowsPerStatement = Math.max(1, Math.floor(Number(options.rowsPerStatement) || ROWS_PER_STATEMENT_DEFAULT));
  const maxStatementChars = Math.max(10_000, Math.floor(Number(options.maxStatementChars) || MAX_STATEMENT_CHARS_DEFAULT));
  const parents = options.foreignKeyParents ?? SCHEMA_FOREIGN_KEY_PARENTS;
  const { order, cycles } = tableInsertOrder(names, parents);
  if (cycles.length) warnings.push(`Циклические внешние ключи между ${cycles.join(", ")}: порядок вставки выбран алфавитный, при ошибке FK примените секции этих таблиц повторно.`);
  const missing = names.filter(name => !Array.isArray(snapshot.columns[name]));
  if (missing.length) throw new Error(`В снимке нет описания колонок для ${missing.slice(0, 5).join(", ")}. Обновите резервную копию.`);

  const filename = sqlDumpFilename(snapshot.exportedAt);
  const tables: Array<{ name: string; rows: number }> = [];
  const body: string[] = [];
  const sequenceRows: string[] = [];
  let totalRows = 0;

  for (const name of order) {
    const rows = snapshot.tables[name] || [];
    tables.push({ name, rows: rows.length });
    totalRows += rows.length;
    const cols = normalizeColumns(snapshot.columns[name]);
    const writable = cols.filter(c => c && typeof c.name === "string" && c.name && c.generated !== "s");
    if (!writable.length) { warnings.push(`${name}: все колонки вычисляемые — строки не выгружаются.`); continue; }
    const needsOverriding = writable.some(c => c.identity === "a" || c.identity === "d");
    const colList = writable.map(c => quoteIdent(c.name as string, "колонки")).join(", ");
    const target = qualified(name);
    const header = `-- ${name}: ${rows.length} ${plural(rows.length)}`;
    if (!rows.length) { body.push(`${header}\n-- (таблица пуста, вставки не нужны)`); continue; }
    const section: string[] = [header];
    const prefix = `INSERT INTO ${target} (${colList})${needsOverriding ? " OVERRIDING SYSTEM VALUE" : ""} VALUES`;
    let values: string[] = [];
    let size = prefix.length;
    const flush = () => {
      if (!values.length) return;
      section.push(`${prefix}\n${values.join(",\n")};`);
      values = [];
      size = prefix.length;
    };
    for (const row of rows) {
      const parts = writable.map(c => {
        const key = c.name as string;
        // Пропустить колонку молча — значит тихо записать NULL вместо данных.
        if (!row || !Object.hasOwn(row, key)) throw new Error(`В строке таблицы ${name} нет колонки ${key}; снимок неполный, дамп остановлен.`);
        return sqlValueLiteral(row[key], String(c.type || ""), `${name}.${key}`);
      });
      const line = ` (${parts.join(", ")})`;
      if (values.length && (values.length >= rowsPerStatement || size + line.length > maxStatementChars)) flush();
      values.push(line);
      size += line.length + 2;
    }
    flush();
    body.push(section.join("\n"));

    const seq = snapshot.sequences && typeof snapshot.sequences === "object" ? (snapshot.sequences as Record<string, unknown>)[name] : null;
    if (seq && typeof seq === "object") {
      for (const col of Object.keys(seq)) {
        const meta = (seq as Record<string, SqlDumpSequence>)[col];
        const last = String(meta?.last ?? "");
        if (!IDENT.test(col)) continue;
        if (!/^\d{1,19}$/.test(last)) continue;
        sequenceRows.push(`  ('${name}', '${col}', ${last}::bigint)`);
      }
    }
  }

  const truncateList = order.map(qualified).join(", ");
  const tableArray = `ARRAY[${order.map(n => `'${n}'`).join(", ")}]::text[]`;
  const out: string[] = [];
  out.push([
    "-- =====================================================================",
    "-- СИБГОФРОТОРГ — ПОЛНЫЙ SQL-ДАМП ДАННЫХ (все таблицы public, все строки)",
    `-- Файл: ${filename}`,
    `-- Источник: ${options.sourceLabel || "полный снимок Supabase"} · снимок от ${snapshot.exportedAt || "неизвестно"}`,
    `-- Строки: ${totalRows} в ${order.length} таблицах`,
    "--",
    "-- Как восстановить:",
    "--   1. Supabase → SQL Editor → новая вкладка.",
    "--   2. Сначала схема: FULL_DATABASE_MIGRATION.sql (если база пустая или схема обновлялась).",
    "--   3. Затем ВЕСЬ этот файл целиком → Run. Пустых мест и частей не оставляйте.",
    "--   4. Последний запрос в файле — сверка: «Ожидалось» и «Стало» должны совпасть.",
    "--",
    "-- Что делает файл:",
    "--   • очищает перечисленные таблицы одной командой TRUNCATE, затем вставляет строки снимка;",
    "--   • выключает на время загрузки пользовательские триггеры (и возвращает их в конце),",
    "--     чтобы updated_at и служебные триггеры не переписали восстановленные данные;",
    "--   • поднимает последовательности выше максимального id, чтобы новые записи не пересекались;",
    "--   • отмечает сброс журнала для копий на ПК, если журнал отслеживания установлен.",
    "--",
    "-- Важно:",
    "--   • данные заменяются полностью: строки, добавленные в базу после снимка, исчезнут;",
    "--   • снимок должен соответствовать текущей схеме, иначе TRUNCATE или вставки упадут;",
    "--   • файл не использует временные таблицы, курсоры и транзакционные настройки,",
    "--     поэтому проходит через пулер Supabase (transaction pooling);",
    "--   • повторный запуск безопасен и даёт тот же результат.",
    "-- =====================================================================",
    "",
  ].join("\n"));

  if (options.triggerControl !== false) {
    out.push(
      "-- Триггеры пользователя отключаем на время загрузки (RLS и внешние ключи работают как обычно).",
      `DO $sgt_triggers_off$ DECLARE r record; BEGIN`,
      `  FOR r IN SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace`,
      `    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY (${tableArray})`,
      `  LOOP`,
      `    BEGIN EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', r.name);`,
      `    EXCEPTION WHEN insufficient_privilege OR undefined_table THEN NULL; END;`,
      `  END LOOP;`,
      `END $sgt_triggers_off$;`,
      "",
    );
  }

  out.push(
    "-- Очистка: все таблицы сразу, поэтому порядок строк от внешних ключей здесь не важен.",
    "-- Последовательности не сбрасываем: следующий шаг поднимет их فوق восстановленных id.",
    `TRUNCATE TABLE ${truncateList};`,
    "",
  );
  out.push(body.join("\n\n"));
  out.push("");

  if (options.triggerControl !== false) {
    out.push(
      "-- Включаем триггеры обратно.",
      `DO $sgt_triggers_on$ DECLARE r record; BEGIN`,
      `  FOR r IN SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace`,
      `    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY (${tableArray})`,
      `  LOOP`,
      `    BEGIN EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', r.name);`,
      `    EXCEPTION WHEN insufficient_privilege OR undefined_table THEN NULL; END;`,
      `  END LOOP;`,
      `END $sgt_triggers_on$;`,
      "",
    );
  }

  if (sequenceRows.length) {
    out.push(
      "-- Последовательности: следующий id не должен пересечься с восстановленными строками.",
      `DO $sgt_sequences$ DECLARE r record; seq text; nxt bigint; BEGIN`,
      `  FOR r IN SELECT * FROM (VALUES`,
      sequenceRows.join(",\n"),
      `  ) AS v(tbl, col, backup_last) LOOP`,
      `    seq := pg_get_serial_sequence(format('public.%I', r.tbl), r.col);`,
      `    IF seq IS NULL THEN CONTINUE; END IF;`,
      `    EXECUTE format('SELECT greatest(coalesce(max(%I), 0), %s) FROM public.%I', r.col, r.backup_last, r.tbl) INTO nxt;`,
      `    IF nxt IS NOT NULL THEN PERFORM setval(seq::regclass, nxt, true); END IF;`,
      `  END LOOP;`,
      `END $sgt_sequences$;`,
      "",
    );
  }

  out.push(
    "-- Копии на ПК после замены данных должны снять полный снимок заново: журнал отслеживания сброшен.",
    `DO $sgt_pc_reset$ BEGIN`,
    `  IF to_regprocedure('public.sgt_pc_backup_mark_reset()') IS NOT NULL THEN PERFORM public.sgt_pc_backup_mark_reset(); END IF;`,
    `END $sgt_pc_reset$;`,
    "",
  );

  if (options.verify !== false) {
    out.push("-- Сверка: счётчики ниже возвращают построчно, поэтому пустая таблица тоже видна (0).");
    out.push("SELECT q.tbl AS \"Таблица\", q.expected AS \"Ожидалось\", q.actual AS \"Стало\", (q.expected = q.actual) AS \"Совпало\" FROM (");
    out.push(order.map(name => {
      const rows = (snapshot.tables[name] || []).length;
      return `  SELECT '${name}' AS tbl, ${rows}::bigint AS expected, count(*)::bigint AS actual FROM ${qualified(name)}`;
    }).join("\n  UNION ALL\n"));
    out.push(") q ORDER BY (q.expected = q.actual) DESC, q.tbl;");
  }

  const sql = `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
  if (sql.length > 2_000_000) warnings.push(`Файл занимает ${(sql.length / 1024 / 1024).toFixed(1)} МБ: в SQL Editor может не поместиться — тогда выполняйте его секциями по таблицам.`);
  return { sql, filename, totalRows, tables: tables.sort((a, b) => a.name.localeCompare(b.name)), warnings, bytes: sql.length };
}

function plural(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "строка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "строки";
  return "строк";
}
