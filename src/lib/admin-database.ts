// =========================================================
// FILE: src/lib/admin-database.ts
// Раздел «База Данных»: список таблиц, чтение строк и правка ячеек
// БЕЗ SQL. Никаких INSERT/DELETE — только просмотр уже существующих
// данных и редактирование значений.
//
// Список таблиц берём из описания REST-схемы Supabase (PostgREST
// отдаёт OpenAPI), поэтому новые таблицы появляются в разделе сами.
// Если описание недоступно — используем резервный список известных
// таблиц из миграций.
// =========================================================

import { getAdminDb } from "./supabase";

export interface DatabaseTableMeta {
  name: string;
  label: string;
  group: string;
  /** Таблицу можно править (есть колонка-идентификатор строки). */
  editable: boolean;
  /** Таблица доступна только владельцу (денежные правки). */
  ownerOnly?: boolean;
}

export interface DatabaseColumn {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "json" | "unknown";
  editable: boolean;
  primaryKey: boolean;
}

export interface DatabaseTableSchema {
  name: string;
  label: string;
  group: string;
  editable: boolean;
  ownerOnly: boolean;
  primaryKey: string | null;
  columns: DatabaseColumn[];
}

/** Колонки, которые нельзя показывать и менять никому. */
const SENSITIVE_COLUMN_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
];

/** Таблицы, доступные только владельцу. */
const OWNER_ONLY_TABLES = new Set(["money_adjustments"]);

/**
 * Таблицы, которые в разделе «База Данных» открыты только для чтения.
 * Правки денег владелец делает через свою панель в настройках — там они
 * логируются, а прямая правка ячейки журнала обошла бы этот контроль.
 */
const READ_ONLY_TABLES = new Set(["money_adjustments", "activity_logs"]);

/**
 * Колонки, которые нельзя менять через «Базу Данных», даже если таблица
 * в целом редактируемая. Иначе администратор поднял бы себе роль
 * владельца или отключил пароль — это делается только в «Пользователях».
 */
const READ_ONLY_COLUMNS: Record<string, readonly string[]> = {
  admins: ["role", "username", "is_active", "password_hash", "id"],
};

type TableMeta = {
  label: string;
  group: string;
  pk?: string;
};

/**
 * Человекочитаемые подписи и группы. Таблицы, которых здесь нет,
 * попадают в группу «Прочее» под своим техническим именем —
 * раздел остаётся полным, даже если в базе появилось что-то новое.
 */
const TABLE_META: Record<string, TableMeta> = {
  orders: { label: "Заявки с сайта", group: "Заказы и клиенты" },
  customer_deals: { label: "Заказы учёта", group: "Заказы и клиенты" },
  client_requests: { label: "Заявки клиентов", group: "Заказы и клиенты" },
  users: { label: "Клиенты", group: "Заказы и клиенты" },
  admins: { label: "Сотрудники админки", group: "Пользователи" },
  activity_logs: { label: "Журнал действий", group: "Пользователи" },
  money_adjustments: {
    label: "Правки денежных счетов (владелец)",
    group: "Пользователи",
  },
  categories: { label: "Категории", group: "Каталог" },
  products: { label: "Товары", group: "Каталог" },
  product_variants: { label: "Варианты товаров", group: "Каталог" },
  product_reviews: { label: "Отзывы", group: "Каталог" },
  review_helpful_votes: { label: "Отзывы: полезность", group: "Каталог" },
  product_questions: { label: "Вопросы о товарах", group: "Каталог" },
  product_ratings: { label: "Оценки товаров", group: "Каталог" },
  product_views: { label: "Просмотры товаров", group: "Каталог" },
  promotions: { label: "Акции", group: "Каталог" },
  popup_campaigns: { label: "Всплывающие окна", group: "Каталог" },
  home_tiles: { label: "Плитки на главной", group: "Каталог" },
  settings: { label: "Настройки сайта", group: "Сайт", pk: "key" },
  wastepaper_requests: { label: "Заявки на макулатуру", group: "Сайт" },
  counterparties: { label: "Контрагенты", group: "Склад и продажи" },
  supplier_prices: { label: "Цены поставщиков", group: "Склад и продажи" },
  warehouse_receipts: { label: "Поступления", group: "Склад и продажи" },
  warehouse_stock: { label: "Остатки склада", group: "Склад и продажи" },
  warehouse_supply_plans: { label: "Планы поставок", group: "Склад и продажи" },
  warehouse_purchase_plans: { label: "Планы закупок", group: "Склад и продажи" },
  purchase_payments: { label: "Оплаты закупок", group: "Склад и продажи" },
  transports: { label: "Перевозки", group: "Склад и продажи" },
  deliveries: { label: "Доставки", group: "Склад и продажи" },
  delivery_items: { label: "Позиции доставок", group: "Склад и продажи" },
  bank_payments: { label: "Платежи", group: "Деньги" },
  bank_account_transfers: { label: "Переводы между счетами", group: "Деньги" },
  cash_collections: { label: "Сдачи кассы", group: "Деньги" },
  salaries: { label: "Зарплаты и выплаты", group: "Деньги" },
  employees: { label: "Сотрудники", group: "Деньги" },
  doc_counters: { label: "Счётчики документов", group: "Служебные" },
  duty_schedule_state: { label: "Табели охраны", group: "Служебные" },
  rent_orgs: { label: "Аренда: организации", group: "Аренда" },
  rent_tenants: { label: "Аренда: арендаторы", group: "Аренда" },
  rent_invoices: { label: "Аренда: счета", group: "Аренда" },
  rent_payments: { label: "Аренда: платежи", group: "Аренда" },
  wp_intakes: { label: "Макулатура: приёмы", group: "Макулатура" },
  wp_shipments: { label: "Макулатура: продажи", group: "Макулатура" },
  wp_payments: { label: "Макулатура: платежи", group: "Макулатура" },
  wp_counterparties: { label: "Макулатура: контрагенты", group: "Макулатура" },
  wp_products: { label: "Макулатура: виды сырья", group: "Макулатура" },
  wp_employees: { label: "Макулатура: сотрудники", group: "Макулатура" },
  wp_salaries: { label: "Макулатура: зарплаты", group: "Макулатура" },
  wp_account_transfers: {
    label: "Макулатура: переводы счетов",
    group: "Макулатура",
  },
  wp_stock_adjustments: {
    label: "Макулатура: правки остатков",
    group: "Макулатура",
  },
};

const FALLBACK_TABLES = Object.keys(TABLE_META);

/** Колонки, которые заведомо есть у большинства таблиц-идентификаторов. */
const PK_CANDIDATES = ["id", "key"];

function titleFromName(name: string): string {
  return name
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function tableLabel(name: string): string {
  return TABLE_META[name]?.label || titleFromName(name);
}

export function tableGroup(name: string): string {
  return TABLE_META[name]?.group || "Прочее";
}

export function isOwnerOnlyTable(name: string): boolean {
  return OWNER_ONLY_TABLES.has(name);
}

export function isSensitiveColumn(name: string): boolean {
  return SENSITIVE_COLUMN_PATTERNS.some((pattern) => pattern.test(name));
}

function columnType(raw: any): DatabaseColumn["type"] {
  const type = String(raw?.type || "").toLowerCase();
  const format = String(raw?.format || "").toLowerCase();
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array" || type === "object") return "json";
  if (type === "string") {
    if (["date", "date-time", "timestamp", "timestamptz", "time"].includes(format)) {
      return "string";
    }
    return "string";
  }
  return "unknown";
}

type SchemaCache = {
  fetchedAt: number;
  tables: Map<string, { columns: DatabaseColumn[]; pk: string | null }>;
};

let schemaCache: SchemaCache | null = null;
const SCHEMA_TTL_MS = 5 * 60 * 1000;

/**
 * Забираем описание схемы у PostgREST. Это единственный «сетевой»
 * источник списка таблиц: он отдаёт и таблицы, и представления, и типы
 * колонок — без SQL-доступа из приложения.
 */
async function fetchRemoteSchema(): Promise<SchemaCache | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/openapi+json",
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const spec: any = await response.json();
    const definitions =
      spec?.definitions || spec?.components?.schemas || spec?.consumes?.definitions;
    if (!definitions || typeof definitions !== "object") return null;

    const tables = new Map<string, { columns: DatabaseColumn[]; pk: string | null }>();
    for (const [tableName, definition] of Object.entries<any>(definitions)) {
      const properties = definition?.properties;
      if (!properties || typeof properties !== "object") continue;
      const names = Object.keys(properties);
      if (names.length === 0) continue;
      const pkFromSpec =
        Array.isArray(definition?.["x-primary-key"]) && definition["x-primary-key"].length === 1
          ? String(definition["x-primary-key"][0])
          : null;
      const pk =
        pkFromSpec ||
        TABLE_META[tableName]?.pk ||
        PK_CANDIDATES.find((candidate) => names.includes(candidate)) ||
        null;
      const columns: DatabaseColumn[] = names.map((name) => ({
        name,
        label: name,
        type: columnType((properties as any)[name]),
        editable:
          !isSensitiveColumn(name) &&
          !READ_ONLY_COLUMNS[tableName]?.includes(name) &&
          !READ_ONLY_TABLES.has(tableName),
        primaryKey: name === pk,
      }));
      tables.set(tableName, { columns, pk });
    }
    return { fetchedAt: Date.now(), tables };
  } catch (error) {
    console.warn("[db] Не удалось получить схему PostgREST:", (error as any)?.message || error);
    return null;
  }
}

/** Схема таблиц с кэшем на 5 минут (и резервным списком). */
export async function loadDatabaseSchema(): Promise<SchemaCache> {
  if (schemaCache && Date.now() - schemaCache.fetchedAt < SCHEMA_TTL_MS) {
    return schemaCache;
  }
  const remote = await fetchRemoteSchema();
  schemaCache = remote || {
    fetchedAt: Date.now(),
    tables: new Map(
      FALLBACK_TABLES.map((name) => [
        name,
        { columns: [], pk: TABLE_META[name]?.pk || "id" },
      ])
    ),
  };
  return schemaCache;
}

/** Список таблиц для интерфейса (без владельческих — их отфильтрует API). */
export async function listDatabaseTables(): Promise<DatabaseTableMeta[]> {
  const schema = await loadDatabaseSchema();
  return [...schema.tables.keys()]
    .sort((a, b) => {
      const groupA = tableGroup(a);
      const groupB = tableGroup(b);
      if (groupA !== groupB) return groupA.localeCompare(groupB, "ru");
      return tableLabel(a).localeCompare(tableLabel(b), "ru");
    })
    .map((name) => ({
      name,
      label: tableLabel(name),
      group: tableGroup(name),
      editable: Boolean(schema.tables.get(name)?.pk),
      ownerOnly: isOwnerOnlyTable(name),
    }));
}

export async function getTableSchema(name: string): Promise<DatabaseTableSchema | null> {
  const schema = await loadDatabaseSchema();
  const entry = schema.tables.get(name);
  if (!entry) return null;
  const readOnlyTable = READ_ONLY_TABLES.has(name);
  return {
    name,
    label: tableLabel(name),
    group: tableGroup(name),
    editable: Boolean(entry.pk) && !readOnlyTable,
    ownerOnly: isOwnerOnlyTable(name),
    primaryKey: readOnlyTable ? null : entry.pk,
    columns:
      entry.columns.length > 0
        ? entry.columns
        : // Схема недоступна: показываем строки без подсказок по типам.
          buildColumnsFromRows([]),
  };
}

/**
 * Если OpenAPI-описание не подошло (например, таблица появилась только
 * что), колонки соберём из самой строки данных.
 */
export function buildColumnsFromRows(rows: Record<string, unknown>[]): DatabaseColumn[] {
  const names = new Set<string>();
  for (const row of rows.slice(0, 5)) {
    for (const key of Object.keys(row || {})) names.add(key);
  }
  return [...names].map((name) => ({
    name,
    label: name,
    type: "unknown" as const,
    editable: !isSensitiveColumn(name),
    primaryKey: false,
  }));
}

export function stripSensitiveColumns<T extends Record<string, unknown>>(row: T): T {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (isSensitiveColumn(key)) continue;
    clone[key] = value;
  }
  return clone as T;
}

export interface DatabaseRowsResult {
  schema: DatabaseTableSchema;
  rows: Record<string, unknown>[];
  total: number;
}

/**
 * Чтение строк таблицы: постранично, с поиском по текстовым колонкам и
 * сортировкой. Никаких SQL-запросов от пользователя — только параметры
 * из фиксированного набора.
 */
export async function fetchTableRows(options: {
  table: string;
  schema: DatabaseTableSchema;
  limit: number;
  offset: number;
  search?: string;
  sort?: string | null;
  dir?: "asc" | "desc";
  /**
   * Прятать записи журнала о прямых правках денег владельцем.
   * Включается для всех ролей, кроме owner.
   */
  hideOwnerMoneyLogs?: boolean;
}): Promise<DatabaseRowsResult> {
  const db = getAdminDb();
  const { table, schema } = options;
  let query = db.from(table).select("*", { count: "exact" });

  // Приватность: движения владельца по счетам не показываем остальным.
  // Условие «entity_type is null» оставляем — у старых записей журнала
  // тип объекта пустой, и они не должны исчезать из-за фильтра.
  if (table === "activity_logs" && options.hideOwnerMoneyLogs) {
    query = query.or("entity_type.is.null,entity_type.neq.money-adjustment");
  }

  const search = (options.search || "").trim().slice(0, 120);
  if (search && schema.columns.length > 0) {
    const textColumns = schema.columns
      .filter((column) => !isSensitiveColumn(column.name))
      .filter((column) => column.type === "string" || column.type === "unknown")
      .slice(0, 8)
      .map((column) => column.name);
    if (textColumns.length > 0) {
      const escaped = search.replace(/[",()\\]/g, " ").trim();
      if (escaped) {
        query = query.or(
          textColumns.map((column) => `${column}.ilike."%${escaped}%"`).join(",")
        );
      }
    }
  }

  const sortColumn =
    options.sort && schema.columns.some((column) => column.name === options.sort)
      ? options.sort
      : schema.columns.some((column) => column.name === "created_at")
        ? "created_at"
        : schema.primaryKey;
  if (sortColumn) {
    query = query.order(sortColumn, { ascending: options.dir !== "desc" });
  }
  query = query.range(options.offset, options.offset + options.limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = ((data || []) as Record<string, unknown>[]).map(stripSensitiveColumns);
  const schemaWithColumns =
    schema.columns.length > 0
      ? schema
      : { ...schema, columns: buildColumnsFromRows(rows) };

  return { schema: schemaWithColumns, rows, total: count ?? rows.length };
}

export interface CellUpdateInput {
  table: string;
  schema: DatabaseTableSchema;
  keyColumn: string;
  keyValue: string;
  column: string;
  value: unknown;
}

/** Приведение введённого значения к типу колонки. */
export function coerceCellValue(
  column: DatabaseColumn,
  raw: unknown
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null };
  const text = typeof raw === "string" ? raw : String(raw);
  if (text.trim() === "" && column.type !== "string") {
    return { ok: true, value: null };
  }
  switch (column.type) {
    case "number": {
      const parsed = Number(text.replace(/\s+/g, "").replace(",", "."));
      if (!Number.isFinite(parsed)) {
        return { ok: false, error: "Нужно число" };
      }
      return { ok: true, value: parsed };
    }
    case "boolean": {
      const normalized = text.trim().toLowerCase();
      if (["true", "1", "да", "on"].includes(normalized)) return { ok: true, value: true };
      if (["false", "0", "нет", "off", ""].includes(normalized)) return { ok: true, value: false };
      return { ok: false, error: "Нужно да/нет" };
    }
    case "json": {
      try {
        return { ok: true, value: text.trim() === "" ? null : JSON.parse(text) };
      } catch {
        return { ok: false, error: "Некорректный JSON" };
      }
    }
    default:
      return { ok: true, value: text };
  }
}

/** Обновление одной ячейки существующей строки. */
export async function updateTableCell(input: CellUpdateInput): Promise<Record<string, unknown>> {
  const db = getAdminDb();
  const { error } = await db
    .from(input.table)
    .update({ [input.column]: input.value })
    .eq(input.keyColumn, input.keyValue);
  if (error) throw error;

  const { data, error: readError } = await db
    .from(input.table)
    .select("*")
    .eq(input.keyColumn, input.keyValue)
    .maybeSingle();
  if (readError) throw readError;
  return stripSensitiveColumns((data || {}) as Record<string, unknown>);
}
