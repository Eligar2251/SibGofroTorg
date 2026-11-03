// =========================================================
// Тестовый двойник @/lib/supabase: in-memory «база» с цепочкой
// .from().select().eq().gte().lte().order() и await, как у supabase-js.
// Нужен, чтобы вызывать настоящие обработчики route.ts без Supabase.
// =========================================================

export interface StubTable {
  rows: Record<string, unknown>[];
}

/** Таблицы, которые подкладывает тест. */
export const STUB_DB: Record<string, StubTable> = {
  bank_payments: { rows: [] },
  counterparties: { rows: [] },
  warehouse_receipts: { rows: [] },
};

/** Журнал update-запросов — по нему тест проверяет exported_at. */
export const STUB_UPDATES: Array<{ table: string; values: Record<string, unknown>; filters: Record<string, unknown> }> = [];

/** Журнал insert-запросов (журнал действий админки и пр.). */
export const STUB_INSERTS: Array<{ table: string; values: Record<string, unknown> }> = [];

/**
 * Колонки, на которых «база» должна отвечать ошибкой PGRST204
 * («column does not exist»). Нужно, чтобы проверить работу с базой без
 * миграций: обработчик обязан повторить запись без отсутствующей колонки.
 * По умолчанию список пуст — на остальные тесты не влияет.
 */
export const STUB_FAIL_ON_COLUMNS: string[] = [];

/** Таблицы, для которых имитируется PGRST205 («таблицы ещё нет — миграция не применена»). */
export const STUB_MISSING_TABLES: string[] = [];

export function resetStubDb(data: Record<string, Record<string, unknown>[]>) {
  for (const key of Object.keys(STUB_DB)) STUB_DB[key].rows = [];
  for (const [table, rows] of Object.entries(data)) {
    if (!STUB_DB[table]) STUB_DB[table] = { rows: [] };
    STUB_DB[table].rows = rows.map((r) => ({ ...r }));
  }
  STUB_UPDATES.length = 0;
  STUB_INSERTS.length = 0;
  STUB_FAIL_ON_COLUMNS.length = 0;
  STUB_MISSING_TABLES.length = 0;
}

type Predicate = (row: Record<string, unknown>) => boolean;

/** Ошибка «колонки нет в схеме» — как отдаёт PostgREST. */
export interface StubDbError {
  code: string;
  message: string;
}

/** Результат запроса в виде supabase-js: { data, error }. */
type StubResult = { data: any; error: StubDbError | null };

class StubQuery implements PromiseLike<StubResult> {
  private table: string;
  private predicates: Predicate[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private mode: "select" | "update" | "insert" | "upsert" | "delete" = "select";
  private values: Record<string, unknown> = {};
  private inserted: Record<string, unknown>[] = [];
  private returnSingle = false;

  constructor(table: string) {
    this.table = table;
  }

  select(): this {
    // В supabase-js update(...).select(...) — это «обнови и верни строки»,
    // поэтому режим update не сбрасываем.
    if (
      this.mode !== "update" &&
      this.mode !== "insert" &&
      this.mode !== "upsert" &&
      this.mode !== "delete"
    ) {
      this.mode = "select";
    }
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.mode = "update";
    this.values = values;
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.mode = "insert";
    this.inserted = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.mode = "upsert";
    this.inserted = Array.isArray(values) ? values : [values];
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  /** Колонка из STUB_FAIL_ON_COLUMNS → PGRST204, как у PostgREST. */
  private missingColumn(): StubDbError | null {
    for (const column of STUB_FAIL_ON_COLUMNS) {
      if (column in this.values) {
        return {
          code: "PGRST204",
          message: `Could not find the '${column}' column of '${this.table}' in the schema cache`,
        };
      }
    }
    return null;
  }

  eq(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] !== value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    const set = new Set(values);
    this.predicates.push((row) => set.has(row[column]));
    return this;
  }

  ilike(column: string, pattern: string): this {
    const escaped = String(pattern)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/%/g, ".*")
      .replace(/_/g, ".");
    const re = new RegExp(`^${escaped}$`, "i");
    this.predicates.push((row) => re.test(String(row[column] ?? "")));
    return this;
  }

  limit(_n: number): this {
    return this;
  }

  gte(column: string, value: unknown): this {
    this.predicates.push((row) => String(row[column] ?? "") >= String(value));
    return this;
  }

  lte(column: string, value: unknown): this {
    this.predicates.push((row) => String(row[column] ?? "") <= String(value));
    return this;
  }

  is(column: string, value: unknown): this {
    this.predicates.push((row) => (row[column] ?? null) === (value ?? null));
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator === "is") {
      this.predicates.push((row) => (row[column] ?? null) !== (value ?? null));
    } else {
      this.predicates.push((row) => row[column] !== value);
    }
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  single(): this {
    this.returnSingle = true;
    return this;
  }

  maybeSingle(): this {
    this.returnSingle = true;
    return this;
  }

  private matches(): Record<string, unknown>[] {
    const rows = STUB_DB[this.table]?.rows ?? [];
    return rows.filter((row) => this.predicates.every((p) => p(row)));
  }

  private run(): StubResult {
    if (STUB_MISSING_TABLES.includes(this.table)) {
      return {
        data: null,
        error: {
          code: "PGRST205",
          message: `Could not find the table 'public.${this.table}' in the schema cache`,
        },
      };
    }
    if (this.mode === "insert") {
      const table = (STUB_DB[this.table] ||= { rows: [] });
      const out: Record<string, unknown>[] = [];
      for (const row of this.inserted) {
        const stored = {
          id: row.id ?? `stub_${table.rows.length + 1}_${Math.random().toString(36).slice(2, 7)}`,
          ...row,
        };
        table.rows.push(stored);
        STUB_INSERTS.push({ table: this.table, values: { ...stored } });
        out.push({ ...stored });
      }
      return { data: this.returnSingle ? out[0] ?? null : out, error: null };
    }
    if (this.mode === "upsert") {
      const table = (STUB_DB[this.table] ||= { rows: [] });
      const pkCols =
        this.table === "settings" || this.table === "doc_counters"
          ? ["key"]
          : this.table === "supplier_prices"
            ? ["counterparty_id", "product_id"]
            : ["id"];
      for (const row of this.inserted) {
        const idx = table.rows.findIndex((existing) =>
          pkCols.every((pk) => existing[pk] === row[pk])
        );
        if (idx >= 0) table.rows[idx] = { ...table.rows[idx], ...row };
        else table.rows.push({ ...row });
      }
      const out = this.inserted.map((row) => ({ ...row }));
      return { data: this.returnSingle ? out[0] ?? null : out, error: null };
    }
    if (this.mode === "delete") {
      const table = STUB_DB[this.table];
      const matched = this.matches();
      if (table) {
        table.rows = table.rows.filter((row) => !this.predicates.every((p) => p(row)));
      }
      return { data: matched, error: null };
    }
    if (this.mode === "update") {
      const missing = this.missingColumn();
      if (missing) return { data: null, error: missing };
      const matched = this.matches();
      for (const row of matched) Object.assign(row, this.values);
      STUB_UPDATES.push({
        table: this.table,
        values: { ...this.values },
        filters: {},
      });
      return { data: this.returnSingle ? matched[0] ?? null : matched, error: null };
    }
    const rows = this.matches().map((r) => ({ ...r }));
    for (const { column, ascending } of [...this.orders].reverse()) {
      rows.sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av === bv) return 0;
        const cmp = Number(av) > Number(bv) || String(av) > String(bv) ? 1 : -1;
        return ascending ? cmp : -cmp;
      });
    }
    return { data: this.returnSingle ? rows[0] ?? null : rows, error: null };
  }

  then<TResult1 = StubResult, TResult2 = never>(
    onFulfilled?: ((value: StubResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

class StubClient {
  from(table: string): StubQuery {
    return new StubQuery(table);
  }

  async rpc(fnName: string, args?: Record<string, unknown>): Promise<StubResult> {
    if (fnName === "fn_next_counter") {
      const key = String(args?.p_key || "default");
      const table = (STUB_DB.doc_counters ||= { rows: [] });
      const existing = table.rows.find((r) => r.key === key);
      const nextVal = Number(existing?.value || 0) + 1;
      if (existing) existing.value = nextVal;
      else table.rows.push({ key, value: nextVal });
      return { data: nextVal, error: null };
    }
    return { data: null, error: null };
  }
}

const client = new StubClient();

export function getAdminDb(): StubClient {
  return client;
}

export function getPublicDb(): StubClient {
  return client;
}
