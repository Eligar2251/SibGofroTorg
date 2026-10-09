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

export function resetStubDb(data: Record<string, Record<string, unknown>[]>) {
  for (const key of Object.keys(STUB_DB)) STUB_DB[key].rows = [];
  for (const [table, rows] of Object.entries(data)) {
    if (!STUB_DB[table]) STUB_DB[table] = { rows: [] };
    STUB_DB[table].rows = rows.map((r) => ({ ...r }));
  }
  STUB_UPDATES.length = 0;
}

type Predicate = (row: Record<string, unknown>) => boolean;

/** Результат запроса в виде supabase-js: { data, error }. */
type StubResult = { data: Record<string, unknown>[] | null; error: null };

class StubQuery implements PromiseLike<StubResult> {
  private table: string;
  private predicates: Predicate[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private mode: "select" | "update" = "select";
  private values: Record<string, unknown> = {};

  constructor(table: string) {
    this.table = table;
  }

  select(): this {
    this.mode = "select";
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.mode = "update";
    this.values = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] === value);
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

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  single(): this {
    return this;
  }

  maybeSingle(): this {
    return this;
  }

  private matches(): Record<string, unknown>[] {
    const rows = STUB_DB[this.table]?.rows ?? [];
    return rows.filter((row) => this.predicates.every((p) => p(row)));
  }

  private run(): StubResult {
    if (this.mode === "update") {
      const matched = this.matches();
      for (const row of matched) Object.assign(row, this.values);
      STUB_UPDATES.push({
        table: this.table,
        values: { ...this.values },
        filters: {},
      });
      return { data: matched, error: null };
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
    return { data: rows, error: null };
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
}

const client = new StubClient();

export function getAdminDb(): StubClient {
  return client;
}

export function getPublicDb(): StubClient {
  return client;
}
