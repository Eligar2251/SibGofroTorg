// =========================================================
// FILE: src/lib/local-json-db.ts
// Автономная локальная JSON-база данных СибГофроТорг (.sgt-data/local-db.json)
// с полной совместимостью цепочек запросов @supabase/supabase-js (PostgREST)
// + резервное копирование (экспорт/импорт JSON) + двусторонняя синхронизация
// с любым сервером Supabase.
//
// Обеспечивает 100% независимую работу всей админки и сайта при полном
// отказе внешнего сервера БД (Supabase / PostgreSQL).
// =========================================================

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getLocalDbFilePath,
  getSgtDataDir,
  resolveServerBackupDir,
} from "./db-runtime-config";
import {
  buildLocalDbAuthEnvelope,
  type LocalDbEmergencyAuthBlock,
} from "./local-db-secret";

export type LocalRow = Record<string, any>;

export interface LocalPendingMutation {
  key: string;
  table: string;
  op: "upsert" | "delete";
  pkValues: Record<string, any>;
  row: LocalRow | null;
  recordedAt: string;
}

export interface LocalDbFileEnvelope {
  version: 1;
  app: "SibGofroTorg";
  secretAccessCode?: string;
  fileFullPath?: string;
  sgtEmergencyAuth?: LocalDbEmergencyAuthBlock;
  updatedAt: string;
  lastSyncedAt: string | null;
  lastSyncSource: string | null;
  pendingMutations?: LocalPendingMutation[];
  tables: Record<string, LocalRow[]>;
}

/**
 * Все 57 таблиц проекта в топологическом порядке внешних ключей
 * (родительские таблицы идут раньше дочерних — важно для переноса в новый Supabase).
 */
export const ORDERED_BACKUP_TABLES: readonly string[] = [
  // Пользователи, настройки и служебные
  "admins",
  "admin_nav_layouts",
  "users",
  "settings",
  "doc_counters",
  "activity_logs",
  "db_sync_runs",
  "consent_logs",
  "money_adjustments",
  "duty_schedule_state",
  "duty_schedule_revisions",

  // Каталог и витрина
  "product_dimension_profiles",
  "categories",
  "products",
  "product_link_groups",
  "promotions",
  "home_tiles",
  "popup_campaigns",
  "product_reviews",
  "review_helpful_votes",
  "product_questions",
  "product_ratings",
  "product_views",

  // Заявки сайта
  "orders",
  "client_requests",
  "wastepaper_requests",

  // Склад, контрагенты, поставки, заказы учёта, комплектации, перевозки
  "counterparties",
  "supplier_prices",
  "warehouse_supply_plans",
  "warehouse_purchase_plans",
  "warehouse_receipts",
  "consignment_manual_sales",
  "customer_deals",
  "warehouse_assemblies",
  "transports",

  // Банк, касса, сотрудники и зарплаты
  "employees",
  "salaries",
  "bank_payments",
  "bank_account_transfers",
  "cash_collections",

  // Калькулятор штанцформ
  "die_calc_settings",
  "die_calc_models",
  "die_calc_jobs",

  // Управленческий учёт аренды
  "rent_orgs",
  "rent_buildings",
  "rent_office_units",
  "rent_tenants",
  "rent_invoices",
  "rent_payments",
  "rent_meter_readings",

  // Отдельный учёт макулатуры
  "wp_products",
  "wp_counterparties",
  "wp_intakes",
  "wp_shipments",
  "wp_payments",
  "wp_transports",
  "wp_account_transfers",
  "wp_stock_adjustments",
] as const;

/** Первичные / уникальные ключи таблиц для корректного upsert. */
export const TABLE_PRIMARY_KEYS: Record<string, readonly string[]> = {
  settings: ["key"],
  doc_counters: ["key"],
  die_calc_settings: ["key"],
  admin_nav_layouts: ["username"],
  product_ratings: ["product_id"],
  supplier_prices: ["counterparty_id", "product_id"],
  wp_stock_adjustments: ["paper_type"],
};

const COUNTER_TABLE_MAP: Record<string, string> = {
  receipt: "warehouse_receipts",
  deal: "customer_deals",
  payment: "bank_payments",
  transport: "transports",
  warehouse_assembly: "warehouse_assemblies",
  wp_intake: "wp_intakes",
  wp_shipment: "wp_shipments",
  wp_payment: "wp_payments",
  wp_transport: "wp_transports",
};

const DEFAULT_RENT_ORGS: LocalRow[] = [
  {
    id: "bau",
    name: "БАУ",
    short_name: "БАУ",
    legal_name: "СибИнвестТорг",
    pay_day: 3,
    invoice_day: 25,
    pays_to_org_id: null,
    comment: "Основной счёт: сюда приходят деньги арендаторов БАУ и СибИнвестТорга",
  },
  {
    id: "sit",
    name: "СибИнвестТорг",
    short_name: "СИТ",
    legal_name: "СибИнвестТорг",
    pay_day: 3,
    invoice_day: 25,
    pays_to_org_id: "bau",
    comment: "Своего счёта нет — деньги приходят на счёт БАУ",
  },
  {
    id: "pakin",
    name: "ИП Пакин",
    short_name: "ИП Пакин",
    legal_name: null,
    pay_day: 3,
    invoice_day: 25,
    pays_to_org_id: null,
    comment: "Отдельный счёт ИП Пакин",
  },
];

function createEmptyStore(): LocalDbFileEnvelope {
  const now = new Date().toISOString();
  const tables: Record<string, LocalRow[]> = {};
  for (const t of ORDERED_BACKUP_TABLES) {
    tables[t] = [];
  }
  tables.rent_orgs = DEFAULT_RENT_ORGS.map((r) => ({
    ...r,
    created_at: now,
    updated_at: now,
  }));
  tables.doc_counters = Object.keys(COUNTER_TABLE_MAP).map((key) => ({
    key,
    value: 0,
  }));
  return {
    version: 1,
    app: "SibGofroTorg",
    updatedAt: now,
    lastSyncedAt: null,
    lastSyncSource: null,
    tables,
  };
}

function deepClone<T>(val: T): T {
  if (val === null || typeof val !== "object") return val;
  return JSON.parse(JSON.stringify(val));
}

interface LocalDbMemoryCache {
  filePath: string;
  mtimeMs: number;
  store: LocalDbFileEnvelope;
}

type MutationNotifyHook = (input: {
  table: string;
  type: "INSERT" | "UPDATE" | "DELETE";
  record: LocalRow | null;
}) => void;

const globalRef = globalThis as unknown as {
  __sgtLocalJsonDbCache?: LocalDbMemoryCache | null;
  __sgtLocalDbMutationHook?: MutationNotifyHook | null;
};

export function setLocalDbMutationHook(hook: MutationNotifyHook | null): void {
  globalRef.__sgtLocalDbMutationHook = hook;
}

function notifyMutation(
  table: string,
  type: "INSERT" | "UPDATE" | "DELETE",
  record: LocalRow | null
): void {
  try {
    globalRef.__sgtLocalDbMutationHook?.({ table, type, record });
  } catch {
    /* ignore */
  }
}

function normalizeStore(raw: any): LocalDbFileEnvelope {
  const base = createEmptyStore();
  if (!raw || typeof raw !== "object") return base;
  const srcTables =
    raw.tables && typeof raw.tables === "object" ? raw.tables : raw;
  const tables: Record<string, LocalRow[]> = { ...base.tables };

  for (const [tableName, rows] of Object.entries(srcTables)) {
    if (
      tableName === "version" ||
      tableName === "app" ||
      tableName === "updatedAt" ||
      tableName === "lastSyncedAt" ||
      tableName === "lastSyncSource" ||
      tableName === "tableCounts" ||
      tableName === "exportedAt" ||
      tableName === "secretAccessCode" ||
      tableName === "fileFullPath" ||
      tableName === "sgtEmergencyAuth" ||
      tableName === "pendingMutations" ||
      tableName === "totalRows"
    ) {
      continue;
    }
    if (Array.isArray(rows)) {
      tables[tableName] = rows.filter(
        (r): r is LocalRow => Boolean(r) && typeof r === "object"
      );
    }
  }

  const pendingMutations: LocalPendingMutation[] = Array.isArray(
    raw.pendingMutations
  )
    ? raw.pendingMutations.filter(
        (m: any): m is LocalPendingMutation =>
          Boolean(m) &&
          typeof m === "object" &&
          typeof m.table === "string" &&
          (m.op === "upsert" || m.op === "delete")
      )
    : [];

  return {
    version: 1,
    app: "SibGofroTorg",
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : new Date().toISOString(),
    lastSyncedAt: raw.lastSyncedAt ? String(raw.lastSyncedAt) : null,
    lastSyncSource: raw.lastSyncSource ? String(raw.lastSyncSource) : null,
    pendingMutations,
    tables,
  };
}

function loadStore(): LocalDbFileEnvelope {
  const filePath = getLocalDbFilePath();
  try {
    const stat = fs.statSync(filePath);
    const cached = globalRef.__sgtLocalJsonDbCache;
    if (
      cached &&
      cached.filePath === filePath &&
      cached.mtimeMs === stat.mtimeMs
    ) {
      return cached.store;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const store = normalizeStore(parsed);
    globalRef.__sgtLocalJsonDbCache = {
      filePath,
      mtimeMs: stat.mtimeMs,
      store,
    };
    return store;
  } catch {
    // Если основной файл .sgt-data/local-db.json ещё не создан (например, после
    // пересборки контейнера), проверяем внешний диск автобэкапа пользователя!
    try {
      const backupDir = resolveServerBackupDir();
      for (const candidateName of [
        "sibgofrotorg-latest.json",
        "local-db.json",
      ]) {
        const candidatePath = path.join(
          /*turbopackIgnore: true*/ backupDir,
          candidateName
        );
        if (fs.existsSync(candidatePath)) {
          const recoveredRaw = JSON.parse(
            fs.readFileSync(candidatePath, "utf8")
          );
          const recovered = normalizeStore(recoveredRaw);
          persistStore(recovered);
          return recovered;
        }
      }
    } catch {
      /* ignore recovery errors */
    }
    const fresh = createEmptyStore();
    persistStore(fresh);
    return fresh;
  }
}

function persistStore(store: LocalDbFileEnvelope): void {
  const dir = getSgtDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const filePath = getLocalDbFilePath();
  const authEnvelope = buildLocalDbAuthEnvelope(
    filePath,
    store.sgtEmergencyAuth?.issuedAt || null
  );
  store.secretAccessCode = authEnvelope.secretAccessCode;
  store.fileFullPath = authEnvelope.fileFullPath;
  store.sgtEmergencyAuth = authEnvelope.sgtEmergencyAuth;
  store.updatedAt = new Date().toISOString();
  if (!Array.isArray(store.pendingMutations)) {
    store.pendingMutations = [];
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmpPath, filePath);
  const stat = fs.statSync(filePath);
  globalRef.__sgtLocalJsonDbCache = {
    filePath,
    mtimeMs: stat.mtimeMs,
    store,
  };
}

function recordOfflineMutations(
  store: LocalDbFileEnvelope,
  table: string,
  op: "upsert" | "delete",
  rows: LocalRow[],
  skip = false
): void {
  if (skip || !rows.length || table === "die_calc_job_stats") return;
  if (!Array.isArray(store.pendingMutations)) {
    store.pendingMutations = [];
  }
  const pkCols = TABLE_PRIMARY_KEYS[table] || ["id"];
  const now = new Date().toISOString();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const pkValues: Record<string, any> = {};
    let validPk = true;
    for (const col of pkCols) {
      if (row[col] === undefined || row[col] === null || row[col] === "") {
        validPk = false;
        break;
      }
      pkValues[col] = row[col];
    }
    if (!validPk) continue;
    const sig = pkCols.map((c) => `${c}=${String(pkValues[c])}`).join("&");
    const key = `${table}::${sig}`;

    const existingIdx = store.pendingMutations.findIndex((m) => m.key === key);
    const entry: LocalPendingMutation = {
      key,
      table,
      op,
      pkValues,
      row: op === "upsert" ? deepClone(row) : null,
      recordedAt: now,
    };
    if (existingIdx >= 0) {
      store.pendingMutations[existingIdx] = entry;
    } else {
      store.pendingMutations.push(entry);
    }
  }

  // Разумный лимит очереди, чтобы файл не раздувался годами без синхронизации
  if (store.pendingMutations.length > 10_000) {
    store.pendingMutations = store.pendingMutations.slice(-10_000);
  }
}

export function resetLocalJsonDbCache(): void {
  globalRef.__sgtLocalJsonDbCache = null;
}

// ─── Эмуляция триггеров и представлений PostgreSQL ───────────────────────────

function applyTableTriggers(
  table: string,
  row: LocalRow,
  isInsert: boolean
): LocalRow {
  const now = new Date().toISOString();
  const next: LocalRow = { ...row };

  const pkCols = TABLE_PRIMARY_KEYS[table] || ["id"];
  if (isInsert && pkCols.length === 1 && pkCols[0] === "id") {
    if (next.id === undefined || next.id === null || next.id === "") {
      next.id = randomUUID();
    }
  }

  if (isInsert && next.created_at === undefined) {
    next.created_at = now;
  }
  if (table !== "doc_counters" && next.updated_at === undefined) {
    next.updated_at = now;
  }

  if (table === "products") {
    // 1. sync_product_in_stock()
    const qty = Number(next.stock_qty ?? 0);
    next.stock_qty = Number.isFinite(qty) ? qty : 0;
    next.in_stock = Math.floor(next.stock_qty) >= 1;

    // 2. calculate_product_box_volume()
    const l = Number(next.dimension_length);
    const w = Number(next.dimension_width);
    const h = Number(next.dimension_height);
    if (l > 0 && w > 0 && h > 0) {
      const cubic = l * w * h;
      const unit = String(next.dimension_unit || "мм")
        .trim()
        .toLowerCase();
      const rawVol =
        unit === "м" || unit === "m"
          ? cubic * 1000
          : unit === "см" || unit === "cm"
            ? cubic / 1000
            : cubic / 1_000_000;
      next.volume = Math.round(rawVol * 1000) / 1000;
    } else if (
      "dimension_length" in row ||
      "dimension_width" in row ||
      "dimension_height" in row
    ) {
      next.volume = null;
    }
  }

  return next;
}

function computeDieCalcJobStatsView(store: LocalDbFileEnvelope): LocalRow[] {
  const jobs = store.tables.die_calc_jobs || [];
  let learnedCount = 0;
  let unlearnedWithFact = 0;
  for (const j of jobs) {
    if (j.is_learned) learnedCount++;
    else if (j.actual_price_rub != null && Number(j.actual_price_rub) > 0) {
      unlearnedWithFact++;
    }
  }
  return [
    {
      total_jobs: jobs.length,
      learned_jobs: learnedCount,
      pending_training_jobs: unlearnedWithFact,
    },
  ];
}

// ─── Предикаты и парсинг выражений PostgREST ────────────────────────────────

type RowPredicate = (row: LocalRow) => boolean;

function sqlLikeToRegex(pattern: string, caseInsensitive: boolean): RegExp {
  const escaped = String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, caseInsensitive ? "i" : "");
}

function compareValues(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  const na = Number(a);
  const nb = Number(b);
  if (
    typeof a === "number" ||
    typeof b === "number" ||
    (!Number.isNaN(na) &&
      !Number.isNaN(nb) &&
      String(a).trim() !== "" &&
      String(b).trim() !== "")
  ) {
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      return na < nb ? -1 : na > nb ? 1 : 0;
    }
  }
  return String(a).localeCompare(String(b));
}

function deepContains(container: any, needle: any): boolean {
  let target = needle;
  if (typeof target === "string") {
    const trimmed = target.trim();
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        target = JSON.parse(trimmed);
      } catch {
        /* keep string */
      }
    }
  }

  let host = container;
  if (typeof host === "string") {
    try {
      host = JSON.parse(host);
    } catch {
      return host.includes(String(target));
    }
  }

  if (Array.isArray(target)) {
    if (!Array.isArray(host)) return false;
    return target.every((wantedItem) =>
      host.some((hostItem) => deepContains(hostItem, wantedItem))
    );
  }

  if (target !== null && typeof target === "object") {
    if (host === null || typeof host !== "object" || Array.isArray(host)) {
      return false;
    }
    return Object.entries(target).every(([k, v]) => deepContains(host[k], v));
  }

  return String(host) === String(target);
}

/** Разбивает выражение `.or("a.eq.1,b.ilike.%x%")` по верхнеуровневым запятым. */
function splitTopLevelCommas(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '"' && expr[i - 1] !== "\\") inQuotes = !inQuotes;
    if (!inQuotes) {
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (ch === "," && depth === 0) {
        parts.push(expr.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  const tail = expr.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function unquotePostgrestVal(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replace(/\\"/g, '"');
  }
  return s;
}

function buildSingleConditionPredicate(
  col: string,
  op: string,
  rawVal: string
): RowPredicate {
  const cleanOp = op.toLowerCase();
  if (cleanOp === "is") {
    const v = rawVal.trim().toLowerCase();
    const target =
      v === "null" ? null : v === "true" ? true : v === "false" ? false : rawVal;
    return (row) => (row[col] ?? null) === target;
  }
  if (cleanOp === "in") {
    const inner = rawVal.trim().replace(/^\(/, "").replace(/\)$/, "");
    const set = new Set(splitTopLevelCommas(inner).map(unquotePostgrestVal));
    return (row) => set.has(String(row[col] ?? ""));
  }
  const val = unquotePostgrestVal(rawVal);
  switch (cleanOp) {
    case "eq":
      return (row) => String(row[col] ?? "") === val;
    case "neq":
      return (row) => String(row[col] ?? "") !== val;
    case "gt":
      return (row) => compareValues(row[col], val) > 0;
    case "gte":
      return (row) => compareValues(row[col], val) >= 0;
    case "lt":
      return (row) => compareValues(row[col], val) < 0;
    case "lte":
      return (row) => compareValues(row[col], val) <= 0;
    case "like": {
      const re = sqlLikeToRegex(val, false);
      return (row) => re.test(String(row[col] ?? ""));
    }
    case "ilike": {
      const re = sqlLikeToRegex(val, true);
      return (row) => re.test(String(row[col] ?? ""));
    }
    case "cs":
      return (row) => deepContains(row[col], val);
    default:
      return () => true;
  }
}

function parseOrExpression(expr: string): RowPredicate {
  const clauses = splitTopLevelCommas(expr);
  const predicates: RowPredicate[] = clauses.map((clause) => {
    const trimmed = clause.trim();
    if (trimmed.toLowerCase().startsWith("and(") && trimmed.endsWith(")")) {
      const inner = trimmed.slice(4, -1);
      const subPreds = splitTopLevelCommas(inner).map((s) =>
        parseOrExpression(s)
      );
      return (row: LocalRow) => subPreds.every((p) => p(row));
    }
    if (trimmed.toLowerCase().startsWith("or(") && trimmed.endsWith(")")) {
      return parseOrExpression(trimmed.slice(3, -1));
    }
    const firstDot = trimmed.indexOf(".");
    if (firstDot <= 0) return () => false;
    const col = trimmed.slice(0, firstDot);
    const rest = trimmed.slice(firstDot + 1);
    if (rest.toLowerCase().startsWith("not.")) {
      const afterNot = rest.slice(4);
      const secondDot = afterNot.indexOf(".");
      if (secondDot <= 0) return () => false;
      const op = afterNot.slice(0, secondDot);
      const val = afterNot.slice(secondDot + 1);
      const innerPred = buildSingleConditionPredicate(col, op, val);
      return (row: LocalRow) => !innerPred(row);
    }
    const secondDot = rest.indexOf(".");
    if (secondDot <= 0) return () => false;
    const op = rest.slice(0, secondDot);
    const val = rest.slice(secondDot + 1);
    return buildSingleConditionPredicate(col, op, val);
  });

  return (row: LocalRow) => predicates.some((p) => p(row));
}

function projectRow(row: LocalRow, columnsSpec: string | null): LocalRow {
  const copy = deepClone(row);
  if (!columnsSpec || columnsSpec.trim() === "" || columnsSpec.trim() === "*") {
    return copy;
  }
  const cols = columnsSpec
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (cols.includes("*")) return copy;

  const projected: LocalRow = {};
  for (const colExpr of cols) {
    const colonIdx = colExpr.indexOf(":");
    if (colonIdx > 0) {
      const alias = colExpr.slice(0, colonIdx).trim();
      const srcCol = colExpr.slice(colonIdx + 1).trim();
      projected[alias] = copy[srcCol];
    } else {
      projected[colExpr] = copy[colExpr];
    }
  }
  return projected;
}

// ─── PostgREST-совместимый конструктор запросов ─────────────────────────────

export interface PostgrestLikeResult<T = any> {
  data: T;
  error: { code: string; message: string; details?: string } | null;
  count?: number | null;
  status?: number;
  statusText?: string;
}

export class LocalJsonQueryBuilder implements PromiseLike<PostgrestLikeResult> {
  private table: string;
  private operation: "select" | "insert" | "update" | "upsert" | "delete" =
    "select";
  private selectColumns: string | null = "*";
  private wantCount: boolean = false;
  private headOnly: boolean = false;
  private returnSelectAfterMutate: boolean = false;
  private payloadRows: LocalRow[] = [];
  private updateValues: LocalRow = {};
  private upsertConflictCols: string[] | null = null;
  private upsertIgnoreDuplicates: boolean = false;
  private predicates: RowPredicate[] = [];
  private orders: Array<{
    column: string;
    ascending: boolean;
    nullsFirst?: boolean;
  }> = [];
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private limitCount: number | null = null;
  private singleMode: "none" | "single" | "maybeSingle" = "none";
  private isMirrorReplay = false;

  constructor(table: string) {
    this.table = table;
  }

  /** Помечает запрос как фоновое зеркалирование из уже сохранённого Supabase-ответа. */
  markMirrorReplay(): this {
    this.isMirrorReplay = true;
    return this;
  }

  select(
    columns = "*",
    options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }
  ): this {
    this.selectColumns = columns || "*";
    if (options?.count) this.wantCount = true;
    if (options?.head) this.headOnly = true;
    if (this.operation !== "select") {
      this.returnSelectAfterMutate = true;
    }
    return this;
  }

  insert(
    values: LocalRow | LocalRow[],
    options?: { count?: "exact" | "planned" | "estimated" }
  ): this {
    this.operation = "insert";
    this.payloadRows = Array.isArray(values) ? values : [values];
    if (options?.count) this.wantCount = true;
    return this;
  }

  update(
    values: LocalRow,
    options?: { count?: "exact" | "planned" | "estimated" }
  ): this {
    this.operation = "update";
    this.updateValues = values || {};
    if (options?.count) this.wantCount = true;
    return this;
  }

  upsert(
    values: LocalRow | LocalRow[],
    options?: {
      onConflict?: string;
      ignoreDuplicates?: boolean;
      count?: "exact" | "planned" | "estimated";
    }
  ): this {
    this.operation = "upsert";
    this.payloadRows = Array.isArray(values) ? values : [values];
    if (options?.onConflict) {
      this.upsertConflictCols = options.onConflict
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (options?.ignoreDuplicates) {
      this.upsertIgnoreDuplicates = true;
    }
    if (options?.count) this.wantCount = true;
    return this;
  }

  delete(options?: { count?: "exact" | "planned" | "estimated" }): this {
    this.operation = "delete";
    if (options?.count) this.wantCount = true;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.predicates.push((row) => {
      const rv = row[column];
      if (rv === value) return true;
      if (rv == null || value == null) return false;
      return String(rv) === String(value);
    });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.predicates.push((row) => {
      const rv = row[column];
      if (rv === value) return false;
      if (rv == null && value == null) return false;
      if (rv == null || value == null) return true;
      return String(rv) !== String(value);
    });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.predicates.push((row) => compareValues(row[column], value) > 0);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.predicates.push((row) => compareValues(row[column], value) >= 0);
    return this;
  }

  lt(column: string, value: unknown): this {
    this.predicates.push((row) => compareValues(row[column], value) < 0);
    return this;
  }

  lte(column: string, value: unknown): this {
    this.predicates.push((row) => compareValues(row[column], value) <= 0);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    const strSet = new Set((values || []).map((v) => String(v)));
    const hasNull = (values || []).some((v) => v === null);
    this.predicates.push((row) => {
      const rv = row[column];
      if (rv === null || rv === undefined) return hasNull;
      return strSet.has(String(rv));
    });
    return this;
  }

  is(column: string, value: unknown): this {
    this.predicates.push((row) => (row[column] ?? null) === (value ?? null));
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    const inner = buildSingleConditionPredicate(
      column,
      operator,
      value === null ? "null" : String(value)
    );
    this.predicates.push((row) => !inner(row));
    return this;
  }

  like(column: string, pattern: string): this {
    const re = sqlLikeToRegex(pattern, false);
    this.predicates.push((row) => re.test(String(row[column] ?? "")));
    return this;
  }

  ilike(column: string, pattern: string): this {
    const re = sqlLikeToRegex(pattern, true);
    this.predicates.push((row) => re.test(String(row[column] ?? "")));
    return this;
  }

  contains(column: string, value: unknown): this {
    this.predicates.push((row) => deepContains(row[column], value));
    return this;
  }

  or(filters: string): this {
    const pred = parseOrExpression(filters);
    this.predicates.push(pred);
    return this;
  }

  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean }
  ): this {
    this.orders.push({
      column,
      ascending: options?.ascending !== false,
      nullsFirst: options?.nullsFirst,
    });
    return this;
  }

  limit(count: number): this {
    this.limitCount = Math.max(0, Math.floor(Number(count) || 0));
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = Math.max(0, Math.floor(Number(from) || 0));
    this.rangeTo = Math.max(this.rangeFrom, Math.floor(Number(to) || 0));
    return this;
  }

  single(): this {
    this.singleMode = "single";
    return this;
  }

  maybeSingle(): this {
    this.singleMode = "maybeSingle";
    return this;
  }

  private sortAndSlice(rows: LocalRow[]): LocalRow[] {
    let result = [...rows];
    if (this.orders.length > 0) {
      result.sort((a, b) => {
        for (const ord of this.orders) {
          const av = a[ord.column];
          const bv = b[ord.column];
          if (av == null && bv == null) continue;
          if (av == null) {
            return ord.nullsFirst ? -1 : 1;
          }
          if (bv == null) {
            return ord.nullsFirst ? 1 : -1;
          }
          const cmp = compareValues(av, bv);
          if (cmp !== 0) return ord.ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      result = result.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.limitCount !== null) {
      result = result.slice(0, this.limitCount);
    }
    return result;
  }

  private formatOutput(
    rows: LocalRow[],
    exactCount: number
  ): PostgrestLikeResult {
    const projected = rows.map((r) => projectRow(r, this.selectColumns));

    if (this.headOnly) {
      return {
        data: null,
        error: null,
        count: this.wantCount ? exactCount : null,
        status: 200,
        statusText: "OK",
      };
    }

    if (this.singleMode === "single") {
      if (projected.length === 0) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message:
              "JSON object requested, multiple (or no) rows returned (0 rows)",
          },
          count: this.wantCount ? exactCount : undefined,
          status: 406,
          statusText: "Not Acceptable",
        };
      }
      return {
        data: projected[0],
        error: null,
        count: this.wantCount ? exactCount : undefined,
        status: 200,
        statusText: "OK",
      };
    }

    if (this.singleMode === "maybeSingle") {
      return {
        data: projected[0] ?? null,
        error: null,
        count: this.wantCount ? exactCount : undefined,
        status: 200,
        statusText: "OK",
      };
    }

    return {
      data: projected,
      error: null,
      count: this.wantCount ? exactCount : undefined,
      status: 200,
      statusText: "OK",
    };
  }

  executeSync(): PostgrestLikeResult {
    const store = loadStore();

    if (this.table === "die_calc_job_stats" && this.operation === "select") {
      const viewRows = computeDieCalcJobStatsView(store).filter((r) =>
        this.predicates.every((p) => p(r))
      );
      const sliced = this.sortAndSlice(viewRows);
      return this.formatOutput(sliced, viewRows.length);
    }

    if (!store.tables[this.table]) {
      store.tables[this.table] = [];
    }
    const tableRows = store.tables[this.table];

    if (this.operation === "select") {
      const matched = tableRows.filter((r) =>
        this.predicates.every((p) => p(r))
      );
      const sliced = this.sortAndSlice(matched);
      return this.formatOutput(sliced, matched.length);
    }

    if (this.operation === "insert") {
      const created: LocalRow[] = [];
      for (const raw of this.payloadRows) {
        const prepared = applyTableTriggers(this.table, deepClone(raw), true);
        tableRows.push(prepared);
        created.push(prepared);
      }
      recordOfflineMutations(
        store,
        this.table,
        "upsert",
        created,
        this.isMirrorReplay
      );
      persistStore(store);
      for (const rec of created) {
        notifyMutation(this.table, "INSERT", rec);
      }
      if (!this.returnSelectAfterMutate && this.singleMode === "none") {
        return {
          data: created.map((r) => deepClone(r)),
          error: null,
          count: this.wantCount ? created.length : undefined,
          status: 201,
          statusText: "Created",
        };
      }
      return this.formatOutput(created, created.length);
    }

    if (this.operation === "upsert") {
      const conflictCols =
        this.upsertConflictCols && this.upsertConflictCols.length > 0
          ? this.upsertConflictCols
          : [...(TABLE_PRIMARY_KEYS[this.table] || ["id"])];

      const touched: LocalRow[] = [];
      for (const raw of this.payloadRows) {
        const incoming = deepClone(raw);
        const existingIdx = tableRows.findIndex((existing) =>
          conflictCols.every(
            (col) =>
              incoming[col] !== undefined &&
              incoming[col] !== null &&
              String(existing[col] ?? "") === String(incoming[col])
          )
        );
        if (existingIdx >= 0) {
          if (this.upsertIgnoreDuplicates) {
            touched.push(tableRows[existingIdx]);
            continue;
          }
          const merged = applyTableTriggers(
            this.table,
            {
              ...tableRows[existingIdx],
              ...incoming,
              updated_at:
                incoming.updated_at ?? new Date().toISOString(),
            },
            false
          );
          tableRows[existingIdx] = merged;
          touched.push(merged);
          notifyMutation(this.table, "UPDATE", merged);
        } else {
          const inserted = applyTableTriggers(this.table, incoming, true);
          tableRows.push(inserted);
          touched.push(inserted);
          notifyMutation(this.table, "INSERT", inserted);
        }
      }
      recordOfflineMutations(
        store,
        this.table,
        "upsert",
        touched,
        this.isMirrorReplay
      );
      persistStore(store);
      return this.formatOutput(touched, touched.length);
    }

    if (this.operation === "update") {
      const updatedRows: LocalRow[] = [];
      for (let i = 0; i < tableRows.length; i++) {
        const row = tableRows[i];
        if (!this.predicates.every((p) => p(row))) continue;
        const merged = applyTableTriggers(
          this.table,
          {
            ...row,
            ...deepClone(this.updateValues),
            updated_at:
              this.updateValues.updated_at ?? new Date().toISOString(),
          },
          false
        );
        tableRows[i] = merged;
        updatedRows.push(merged);
      }
      if (updatedRows.length > 0) {
        recordOfflineMutations(
          store,
          this.table,
          "upsert",
          updatedRows,
          this.isMirrorReplay
        );
        persistStore(store);
        for (const rec of updatedRows) {
          notifyMutation(this.table, "UPDATE", rec);
        }
      }
      const sliced = this.sortAndSlice(updatedRows);
      return this.formatOutput(sliced, updatedRows.length);
    }

    // delete
    const deleted: LocalRow[] = [];
    const kept: LocalRow[] = [];
    for (const row of tableRows) {
      if (this.predicates.every((p) => p(row))) {
        deleted.push(row);
      } else {
        kept.push(row);
      }
    }
    if (deleted.length > 0) {
      store.tables[this.table] = kept;
      recordOfflineMutations(
        store,
        this.table,
        "delete",
        deleted,
        this.isMirrorReplay
      );
      persistStore(store);
      for (const rec of deleted) {
        notifyMutation(this.table, "DELETE", rec);
      }
    }
    return this.formatOutput(deleted, deleted.length);
  }

  then<TResult1 = PostgrestLikeResult, TResult2 = never>(
    onFulfilled?:
      | ((value: PostgrestLikeResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
  ): Promise<TResult1 | TResult2> {
    try {
      const res = this.executeSync();
      return Promise.resolve(res).then(onFulfilled, onRejected);
    } catch (err: any) {
      const errRes: PostgrestLikeResult = {
        data: null,
        error: {
          code: "LOCAL_DB_ERR",
          message: err?.message || String(err),
        },
      };
      return Promise.resolve(errRes).then(onFulfilled, onRejected);
    }
  }
}

export class LocalJsonSupabaseClient {
  from(table: string): LocalJsonQueryBuilder {
    return new LocalJsonQueryBuilder(table);
  }

  async rpc(
    fnName: string,
    args?: Record<string, any>
  ): Promise<PostgrestLikeResult> {
    const store = loadStore();

    if (fnName === "fn_next_counter") {
      const key = String(args?.p_key || "").trim();
      if (!key) {
        return {
          data: null,
          error: { code: "P0001", message: "p_key is required" },
        };
      }
      if (!store.tables.doc_counters) store.tables.doc_counters = [];
      let counterRow = store.tables.doc_counters.find((r) => r.key === key);

      // Защита от коллизии номеров при работе поверх импортированного бэкапа
      const linkedTable = COUNTER_TABLE_MAP[key];
      let maxExistingInTable = 0;
      if (linkedTable && Array.isArray(store.tables[linkedTable])) {
        for (const docRow of store.tables[linkedTable]) {
          const n = Number(docRow?.number) || 0;
          if (n > maxExistingInTable) maxExistingInTable = n;
        }
      }

      const prevVal = Math.max(
        Number(counterRow?.value || 0),
        maxExistingInTable
      );
      const nextVal = prevVal + 1;
      if (counterRow) {
        counterRow.value = nextVal;
      } else {
        counterRow = { key, value: nextVal };
        store.tables.doc_counters.push(counterRow);
      }
      recordOfflineMutations(store, "doc_counters", "upsert", [counterRow]);
      persistStore(store);
      return { data: nextVal, error: null };
    }

    if (fnName === "increment_review_helpful") {
      const reviewId = String(args?.review_id_param || "").trim();
      const reviews = store.tables.product_reviews || [];
      const row = reviews.find((r) => String(r.id) === reviewId);
      if (!row) return { data: 0, error: null };
      const nextCount = (Number(row.helpful_count) || 0) + 1;
      row.helpful_count = nextCount;
      persistStore(store);
      return { data: nextCount, error: null };
    }

    return {
      data: null,
      error: {
        code: "PGRST202",
        message: `Local JSON DB: RPC '${fnName}' is not registered`,
      },
    };
  }
}

const singletonLocalClient = new LocalJsonSupabaseClient();

export function getLocalJsonDbClient(): LocalJsonSupabaseClient {
  return singletonLocalClient;
}

// ─── Статистика, экспорт/импорт бэкапов и синхронизация с Supabase ──────────

export interface LocalDbSummary {
  filePath: string;
  exists: boolean;
  fileSizeBytes: number;
  updatedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncSource: string | null;
  pendingMutationsCount: number;
  hasSecretAccessCode: boolean;
  totalTables: number;
  nonEmptyTables: number;
  totalRows: number;
  tableCounts: Record<string, number>;
}

export function getLocalDbSummary(): LocalDbSummary {
  const filePath = getLocalDbFilePath();
  const exists = fs.existsSync(filePath);
  const store = loadStore();
  let fileSizeBytes = 0;
  try {
    fileSizeBytes = fs.statSync(filePath).size;
  } catch {
    fileSizeBytes = 0;
  }

  const tableCounts: Record<string, number> = {};
  let totalRows = 0;
  let nonEmptyTables = 0;
  for (const [t, rows] of Object.entries(store.tables)) {
    const count = Array.isArray(rows) ? rows.length : 0;
    tableCounts[t] = count;
    totalRows += count;
    if (count > 0) nonEmptyTables++;
  }

  return {
    filePath,
    exists,
    fileSizeBytes,
    updatedAt: store.updatedAt,
    lastSyncedAt: store.lastSyncedAt,
    lastSyncSource: store.lastSyncSource,
    pendingMutationsCount: Array.isArray(store.pendingMutations)
      ? store.pendingMutations.length
      : 0,
    hasSecretAccessCode: Boolean(store.secretAccessCode),
    totalTables: Object.keys(store.tables).length,
    nonEmptyTables,
    totalRows,
    tableCounts,
  };
}

export function exportLocalDbSnapshot(targetFileFullPath?: string) {
  const store = loadStore();
  const resolvedPath = String(
    targetFileFullPath || getLocalDbFilePath()
  ).trim();
  const authEnvelope = buildLocalDbAuthEnvelope(resolvedPath);

  const tableCounts: Record<string, number> = {};
  let totalRows = 0;
  for (const [t, rows] of Object.entries(store.tables)) {
    const count = Array.isArray(rows) ? rows.length : 0;
    tableCounts[t] = count;
    totalRows += count;
  }
  return {
    version: 1 as const,
    app: "SibGofroTorg" as const,
    secretAccessCode: authEnvelope.secretAccessCode,
    fileFullPath: authEnvelope.fileFullPath,
    sgtEmergencyAuth: authEnvelope.sgtEmergencyAuth,
    exportedAt: new Date().toISOString(),
    lastSyncedAt: store.lastSyncedAt,
    lastSyncSource: store.lastSyncSource,
    pendingMutations: deepClone(store.pendingMutations || []),
    totalRows,
    tableCounts,
    tables: deepClone(store.tables),
  };
}

export function importLocalDbSnapshot(
  rawPayload: unknown,
  mode: "replace" | "merge" = "replace"
): LocalDbSummary {
  if (!rawPayload || typeof rawPayload !== "object") {
    throw new Error("Некорректный JSON-файл резервной копии");
  }
  const incoming = normalizeStore(rawPayload);

  if (mode === "replace") {
    incoming.lastSyncedAt = new Date().toISOString();
    incoming.lastSyncSource = "Импорт JSON-резерва";
    persistStore(incoming);
    return getLocalDbSummary();
  }

  const current = loadStore();
  for (const [table, incomingRows] of Object.entries(incoming.tables)) {
    if (!Array.isArray(incomingRows) || incomingRows.length === 0) continue;
    if (!current.tables[table] || current.tables[table].length === 0) {
      current.tables[table] = deepClone(incomingRows);
      continue;
    }
    const pkCols = TABLE_PRIMARY_KEYS[table] || ["id"];
    const existing = current.tables[table];
    for (const row of incomingRows) {
      const idx = existing.findIndex((ex) =>
        pkCols.every(
          (col) =>
            row[col] !== undefined &&
            row[col] !== null &&
            String(ex[col] ?? "") === String(row[col])
        )
      );
      if (idx >= 0) {
        existing[idx] = { ...existing[idx], ...deepClone(row) };
      } else {
        existing.push(deepClone(row));
      }
    }
  }
  current.lastSyncedAt = new Date().toISOString();
  current.lastSyncSource = "Объединение с JSON-резервом";
  persistStore(current);
  return getLocalDbSummary();
}

/**
 * Кэширует прочитанные строки в локальную JSON-БД (например, учётную запись
 * администратора при успешном входе, чтобы логин работал и после падения БД).
 */
export function cacheRowsIntoLocalDb(table: string, rows: LocalRow[]): void {
  if (!Array.isArray(rows) || rows.length === 0) return;
  try {
    const store = loadStore();
    if (!store.tables[table]) store.tables[table] = [];
    const pkCols = TABLE_PRIMARY_KEYS[table] || ["id"];
    const target = store.tables[table];
    let changed = false;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const idx = target.findIndex((ex) =>
        pkCols.every(
          (col) =>
            row[col] !== undefined &&
            row[col] !== null &&
            String(ex[col] ?? "") === String(row[col])
        )
      );
      if (idx >= 0) {
        target[idx] = { ...target[idx], ...deepClone(row) };
        changed = true;
      } else {
        target.push(deepClone(row));
        changed = true;
      }
    }
    if (changed) persistStore(store);
  } catch {
    /* ignore background cache errors */
  }
}

/**
 * Проигрывает очередь офлайн-изменений (`pendingMutations`), накопленных во время
 * работы на локальной БД / во время падения Supabase, обратно в удалённый Supabase.
 */
export async function replayPendingMutationsToRemoteSupabase(
  remoteDb: { from: (table: string) => any }
): Promise<{
  replayedUpserts: number;
  replayedDeletes: number;
  remainingMutations: number;
  failedMutations: Array<{ key: string; table: string; error: string }>;
}> {
  const store = loadStore();
  const queue = Array.isArray(store.pendingMutations)
    ? [...store.pendingMutations]
    : [];

  if (queue.length === 0) {
    return {
      replayedUpserts: 0,
      replayedDeletes: 0,
      remainingMutations: 0,
      failedMutations: [],
    };
  }

  const succeededKeys = new Set<string>();
  const failedMutations: Array<{ key: string; table: string; error: string }> =
    [];
  let replayedUpserts = 0;
  let replayedDeletes = 0;

  const orderIndex = (t: string) => {
    const idx = ORDERED_BACKUP_TABLES.indexOf(t);
    return idx >= 0 ? idx : 999;
  };

  // 1. Сначала вставляем/обновляем в порядке внешних ключей (родители → дети)
  const upserts = queue
    .filter((m) => m.op === "upsert" && m.row)
    .sort((a, b) => orderIndex(a.table) - orderIndex(b.table));

  for (const item of upserts) {
    try {
      const pkCols = TABLE_PRIMARY_KEYS[item.table] || ["id"];
      const onConflict = pkCols.join(",");
      let payloadRow = item.row!;

      // Для счётчиков документов никогда не уменьшаем значение в Supabase
      if (item.table === "doc_counters" && payloadRow.key) {
        try {
          const { data: remRow } = await remoteDb
            .from("doc_counters")
            .select("value")
            .eq("key", payloadRow.key)
            .maybeSingle();
          const maxVal = Math.max(
            Number(payloadRow.value || 0),
            Number(remRow?.value || 0)
          );
          payloadRow = { ...payloadRow, value: maxVal };
        } catch {
          /* ignore */
        }
      }

      const { error } = await remoteDb
        .from(item.table)
        .upsert([payloadRow], { onConflict });
      if (error) {
        const code = String(error.code || "");
        const msg = String(error.message || "");
        // Если таблицы пока нет в удалённой схеме — не блокируем остальные
        if (
          code === "42P01" ||
          code === "PGRST205" ||
          /does not exist|Could not find the table/i.test(msg)
        ) {
          succeededKeys.add(item.key);
          continue;
        }
        failedMutations.push({
          key: item.key,
          table: item.table,
          error: msg || code || "Upsert failed",
        });
      } else {
        succeededKeys.add(item.key);
        replayedUpserts++;
      }
    } catch (err: any) {
      failedMutations.push({
        key: item.key,
        table: item.table,
        error: err?.message || String(err),
      });
    }
  }

  // 2. Затем удаляем записи в обратном порядке FK (дети → родители)
  const deletes = queue
    .filter((m) => m.op === "delete")
    .sort((a, b) => orderIndex(b.table) - orderIndex(a.table));

  for (const item of deletes) {
    try {
      let q = remoteDb.from(item.table).delete();
      for (const [col, val] of Object.entries(item.pkValues || {})) {
        q = q.eq(col, val);
      }
      const { error } = await q;
      if (error) {
        const code = String(error.code || "");
        const msg = String(error.message || "");
        if (
          code === "42P01" ||
          code === "PGRST205" ||
          /does not exist|Could not find the table/i.test(msg)
        ) {
          succeededKeys.add(item.key);
          continue;
        }
        failedMutations.push({
          key: item.key,
          table: item.table,
          error: msg || code || "Delete failed",
        });
      } else {
        succeededKeys.add(item.key);
        replayedDeletes++;
      }
    } catch (err: any) {
      failedMutations.push({
        key: item.key,
        table: item.table,
        error: err?.message || String(err),
      });
    }
  }

  store.pendingMutations = queue.filter((m) => !succeededKeys.has(m.key));
  persistStore(store);

  return {
    replayedUpserts,
    replayedDeletes,
    remainingMutations: store.pendingMutations.length,
    failedMutations,
  };
}

/**
 * Экспорт из Supabase в локальную JSON-БД (полное постраничное чтение всех таблиц).
 * По умолчанию перед перезаписью локальной БД сначала выгружает накопленные
 * офлайн-изменения (`pendingMutations`) в Supabase, чтобы ничего не потерялось!
 */
export async function syncRemoteSupabaseToLocal(
  remoteDb: { from: (table: string) => any },
  sourceLabel: string,
  options?: { replayPendingFirst?: boolean }
): Promise<{
  syncedTables: number;
  skippedMissingTables: string[];
  failedTables: Array<{ table: string; error: string }>;
  totalRows: number;
  replayedUpserts: number;
  replayedDeletes: number;
  summary: LocalDbSummary;
}> {
  let replayedUpserts = 0;
  let replayedDeletes = 0;

  if (options?.replayPendingFirst !== false) {
    const preSync = await replayPendingMutationsToRemoteSupabase(remoteDb);
    replayedUpserts = preSync.replayedUpserts;
    replayedDeletes = preSync.replayedDeletes;
  }

  const current = loadStore();
  const nextTables: Record<string, LocalRow[]> = { ...current.tables };
  const skippedMissingTables: string[] = [];
  const failedTables: Array<{ table: string; error: string }> = [];
  let syncedTables = 0;
  let totalRows = 0;

  const PAGE_SIZE = 1000;

  for (const table of ORDERED_BACKUP_TABLES) {
    try {
      const collected: LocalRow[] = [];
      let offset = 0;
      let tableMissing = false;
      let tableError: string | null = null;

      while (true) {
        const { data, error } = await remoteDb
          .from(table)
          .select("*")
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          const msg = String(error.message || error.details || "");
          const code = String(error.code || "");
          if (
            code === "42P01" ||
            code === "PGRST205" ||
            /does not exist|schema cache|Could not find the table/i.test(msg)
          ) {
            tableMissing = true;
          } else {
            tableError = msg || code || "Unknown error";
          }
          break;
        }

        const page = Array.isArray(data) ? data : [];
        collected.push(...page);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        if (offset > 250_000) break; // разумный предохранитель
      }

      if (tableMissing) {
        skippedMissingTables.push(table);
        if (!nextTables[table]) nextTables[table] = [];
        continue;
      }

      if (tableError) {
        failedTables.push({ table, error: tableError });
        continue;
      }

      nextTables[table] = collected;
      syncedTables++;
      totalRows += collected.length;
    } catch (err: any) {
      failedTables.push({
        table,
        error: err?.message || String(err),
      });
    }
  }

  // Если ни одной таблицы не удалось прочитать (например, сервер упал),
  // НЕ затираем существующий локальный бэкап!
  if (syncedTables === 0 && failedTables.length > 0) {
    throw new Error(
      `Сервер БД недоступен (${failedTables[0].error}). Локальная резервная копия сохранена без изменений.`
    );
  }

  const nextStore: LocalDbFileEnvelope = {
    version: 1,
    app: "SibGofroTorg",
    updatedAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
    lastSyncSource: sourceLabel,
    pendingMutations:
      options?.replayPendingFirst === false ? [] : current.pendingMutations || [],
    tables: nextTables,
  };
  persistStore(nextStore);

  return {
    syncedTables,
    skippedMissingTables,
    failedTables,
    totalRows,
    replayedUpserts,
    replayedDeletes,
    summary: getLocalDbSummary(),
  };
}

/**
 * Импорт данных из локальной JSON-БД в целевой сервер Supabase
 * (выгрузка всех таблиц в порядке внешних ключей + применение офлайн-удалений).
 */
export async function pushLocalDbToRemoteSupabase(
  remoteDb: { from: (table: string) => any }
): Promise<{
  pushedTables: number;
  pushedRows: number;
  replayedDeletes: number;
  skippedEmptyTables: number;
  failedTables: Array<{ table: string; error: string }>;
}> {
  const store = loadStore();
  let pushedTables = 0;
  let pushedRows = 0;
  let replayedDeletes = 0;
  let skippedEmptyTables = 0;
  const failedTables: Array<{ table: string; error: string }> = [];

  const BATCH_SIZE = 200;

  // Сначала все известные таблицы в порядке FK, затем возможные кастомные таблицы
  const allTableNames = [
    ...ORDERED_BACKUP_TABLES,
    ...Object.keys(store.tables).filter(
      (t) => !ORDERED_BACKUP_TABLES.includes(t)
    ),
  ];

  for (const table of allTableNames) {
    if (table === "die_calc_job_stats") continue; // это VIEW
    let rows = store.tables[table];
    if (!Array.isArray(rows) || rows.length === 0) {
      skippedEmptyTables++;
      continue;
    }

    // Защищаем счётчики документов от отката назад
    if (table === "doc_counters") {
      try {
        const { data: remCounters } = await remoteDb
          .from("doc_counters")
          .select("*");
        if (Array.isArray(remCounters) && remCounters.length > 0) {
          const remMap = new Map<string, number>();
          for (const rc of remCounters) {
            if (rc?.key) remMap.set(String(rc.key), Number(rc.value || 0));
          }
          rows = rows.map((lr) => ({
            ...lr,
            value: Math.max(
              Number(lr.value || 0),
              remMap.get(String(lr.key)) || 0
            ),
          }));
        }
      } catch {
        /* ignore */
      }
    }

    const pkCols = TABLE_PRIMARY_KEYS[table] || ["id"];
    const onConflict = pkCols.join(",");
    let tableFailed = false;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      try {
        const { error } = await remoteDb
          .from(table)
          .upsert(batch, { onConflict });
        if (error) {
          const code = String(error.code || "");
          const msg = String(error.message || "");
          if (
            code === "42P01" ||
            code === "PGRST205" ||
            /does not exist|Could not find the table/i.test(msg)
          ) {
            tableFailed = true;
            break;
          }
          failedTables.push({
            table,
            error: msg || String(error.code || "Upsert error"),
          });
          tableFailed = true;
          break;
        }
      } catch (err: any) {
        failedTables.push({
          table,
          error: err?.message || String(err),
        });
        tableFailed = true;
        break;
      }
    }

    if (!tableFailed) {
      pushedTables++;
      pushedRows += rows.length;
    }
  }

  // Также воспроизводим накопленные офлайн-удаления в обратном порядке FK
  const pendingDeletes = (store.pendingMutations || []).filter(
    (m) => m.op === "delete"
  );
  if (pendingDeletes.length > 0) {
    const orderIndex = (t: string) => {
      const idx = ORDERED_BACKUP_TABLES.indexOf(t);
      return idx >= 0 ? idx : 999;
    };
    const sortedDeletes = [...pendingDeletes].sort(
      (a, b) => orderIndex(b.table) - orderIndex(a.table)
    );
    for (const del of sortedDeletes) {
      try {
        let q = remoteDb.from(del.table).delete();
        for (const [col, val] of Object.entries(del.pkValues || {})) {
          q = q.eq(col, val);
        }
        const { error } = await q;
        if (!error) replayedDeletes++;
      } catch {
        /* ignore */
      }
    }
  }

  if (failedTables.length === 0) {
    store.pendingMutations = [];
    store.lastSyncedAt = new Date().toISOString();
    persistStore(store);
  }

  return {
    pushedTables,
    pushedRows,
    replayedDeletes,
    skippedEmptyTables,
    failedTables,
  };
}

/**
 * Полноценная двусторонняя синхронизация Supabase ↔ Локальная JSON-БД:
 *   1. Все изменения, сделанные в локальной БД во время падения сервера,
 *      выгружаются в Supabase (включая вставки, правки, удаления и счётчики).
 *   2. Затем актуальный снимок всех таблиц из Supabase скачивается в локальную БД.
 */
export async function syncBidirectionalSupabaseAndLocal(
  remoteDb: { from: (table: string) => any },
  sourceLabel: string
): Promise<{
  replayedUpserts: number;
  replayedDeletes: number;
  syncedTables: number;
  totalRows: number;
  failedTables: Array<{ table: string; error: string }>;
  summary: LocalDbSummary;
}> {
  const replay = await replayPendingMutationsToRemoteSupabase(remoteDb);
  const pull = await syncRemoteSupabaseToLocal(remoteDb, sourceLabel, {
    replayPendingFirst: false,
  });

  // Сохраняем неизрасходованные мутации, если по какой-то таблице была ошибка
  if (replay.remainingMutations > 0) {
    const store = loadStore();
    persistStore(store);
  }

  return {
    replayedUpserts: replay.replayedUpserts,
    replayedDeletes: replay.replayedDeletes,
    syncedTables: pull.syncedTables,
    totalRows: pull.totalRows,
    failedTables: pull.failedTables,
    summary: pull.summary,
  };
}
