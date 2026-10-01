// =========================================================
// FILE: src/lib/duty-schedule-store.ts
// Серверное хранилище табеля охраны в Supabase.
//
// Две таблицы:
//   • duty_schedule_state     — текущий рабочий снимок (одна строка id='main'):
//     сотрудники, графики всех месяцев, ручные суммы, начисления, дни и
//     суммы выплат, сдвиг расчёта зп;
//   • duty_schedule_revisions — история версий: каждое сохранение кладёт
//     снимок в журнал, поэтому прежние значения зарплаты и выплат можно
//     пролистать и при необходимости восстановить.
//
// Инвариант истории: самая свежая запись журнала всегда совпадает с
// рабочим снимком. Перед перезаписью журнал «догоняется» текущим
// состоянием, поэтому состояние «до правки» никогда не теряется.
//
// История — вспомогательная: если таблицы версий ещё нет (миграция не
// применена), сохранение табеля продолжает работать, а интерфейс
// показывает подсказку.
// =========================================================

import { getAdminDb } from "@/lib/supabase";
import { dutyScheduleHash } from "@/lib/duty-schedule-hash";
import type {
  DutyScheduleRevisionMeta,
  DutyScheduleRevisionPeriod,
  DutyScheduleRevisionSnapshot,
  DutyScheduleRevisionSummary,
  DutyScheduleSnapshot,
  DutyScheduleStoredState,
  SalaryAccrual,
} from "@/components/admin/duty-schedule/types";

const TABLE = "duty_schedule_state";
const REVISIONS_TABLE = "duty_schedule_revisions";
const SINGLETON_ID = "main";

/** Сколько версий храним. Старые вытесняются автоматически. */
const KEEP_REVISIONS = 200;
/** Правки внутри этого окна объединяются в одну версию (одна «сессия»):
 *  короткая пауза, чтобы список не превращался в поток по каждому нажатию. */
const COALESCE_WINDOW_MS = 2 * 60 * 1000;
/** За сколько месяцев считаем итоги для карточки версии. */
const SUMMARY_PERIODS = 3;

export const DUTY_SCHEDULE_MIGRATION_HINT =
  "Выполните supabase/migration_duty_schedule_storage.sql в Supabase → SQL Editor (файл идемпотентен, его можно запускать повторно).";

export const DUTY_SCHEDULE_HISTORY_HINT =
  "История версий ещё не подключена к базе. Запустите supabase/migration_duty_schedule_storage.sql в Supabase → SQL Editor — текущий табель сохраняется и без неё.";

function normalizePayOffset(value: unknown): number {
  const offset = Number(value);
  return offset === 0 || offset === 1 || offset === 2 ? offset : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Ошибка «таблицы/колонки нет» — типовой признак неприменённой миграции. */
function isMissingSchemaError(error: unknown): boolean {
  const raw = String((error as { message?: unknown })?.message || error || "");
  const lower = raw.toLowerCase();
  return (
    lower.includes("schema cache") ||
    lower.includes("does not exist") ||
    lower.includes("could not find the table") ||
    lower.includes("undefined column") ||
    lower.includes("undefined_table") ||
    lower.includes("undefined_column")
  );
}

function isMissingColumnError(error: unknown, column: string): boolean {
  const raw = String((error as { message?: unknown })?.message || error || "");
  const lower = raw.toLowerCase();
  return lower.includes(column.toLowerCase()) && isMissingSchemaError(error);
}

function isMissingTableError(error: unknown): boolean {
  return isMissingSchemaError(error);
}

// ── Сводка версии для списка истории ────────────────────────────────

function monthShift(periodKey: string, delta: number): string {
  const [year, month] = periodKey.split("-").map(Number);
  if (!year || !month) return periodKey;
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Начисления периода так же, как их показывает интерфейс: если для
 *  месяца ничего не сохраняли — берём всех активных охранников. */
function accrualsOfPeriod(
  state: DutyScheduleStoredState,
  periodKey: string
): SalaryAccrual[] {
  const stored = state.salaryAccruals?.[periodKey];
  if (Array.isArray(stored)) return stored;
  return (state.employees || [])
    .filter((employee) => employee.active)
    .map((employee) => ({
      id: employee.id,
      employeeId: employee.id,
      employeeName: employee.name,
      amount: null,
    }));
}

function periodSummary(
  state: DutyScheduleStoredState,
  periodKey: string,
  payOffset: number
): DutyScheduleRevisionPeriod {
  const accruals = accrualsOfPeriod(state, periodKey);
  const payouts = state.salaryPayouts?.[periodKey] ?? [];
  const basisKey = monthShift(periodKey, -payOffset);
  const schedule = state.schedules?.[basisKey] ?? [];
  const overrides = state.amountOverrides?.[basisKey] ?? {};

  let accrualTotal = 0;
  for (const accrual of accruals) {
    if (accrual.amount != null) {
      accrualTotal += accrual.amount;
      continue;
    }
    if (!accrual.employeeId || accrual.employeeId === "custom") continue;
    const employee = (state.employees || []).find(
      (item) => item.id === accrual.employeeId
    );
    if (!employee) continue;
    const hours = schedule
      .filter(
        (day) => day.employeeId === employee.id && day.status !== "missed"
      )
      .reduce((sum, day) => sum + (day.hours || 0), 0);
    accrualTotal += overrides[employee.id] ?? Math.round(hours * employee.rate);
  }

  const paidPayouts = payouts.filter((item) => (item.amount || 0) > 0);
  return {
    month: periodKey,
    people: accruals.length,
    accrualTotal: Math.round(accrualTotal),
    payoutRows: paidPayouts.length,
    payoutTotal: Math.round(
      payouts.reduce((sum, item) => sum + (item.amount || 0), 0)
    ),
  };
}

/** Все месяцы, которые встречаются в снимке (графики, суммы, зп). */
function snapshotMonths(state: DutyScheduleStoredState): string[] {
  const keys = new Set<string>();
  const collect = (value: unknown) => {
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) {
      if (/^\d{4}-\d{2}$/.test(key)) keys.add(key);
    }
  };
  collect(state.schedules);
  collect(state.amountOverrides);
  collect(state.salaryAccruals);
  collect(state.salaryPayouts);
  collect(state.payoutTitles);
  return [...keys].sort();
}

/** Краткая сводка снимка — храним вместе с версией, чтобы список
 *  истории не тянул из базы сами снимки целиком. */
export function summarizeDutyScheduleState(
  state: DutyScheduleStoredState,
  payOffset: number
): DutyScheduleRevisionSummary {
  const months = snapshotMonths(state);
  const employees = state.employees || [];
  const scheduleDays = Object.values(state.schedules || {}).reduce(
    (sum, list) =>
      sum + (Array.isArray(list) ? list.filter((day) => day.employeeId).length : 0),
    0
  );

  return {
    employees: employees.length,
    activeEmployees: employees.filter((employee) => employee.active).length,
    months: months.length,
    firstMonth: months[0] ?? null,
    lastMonth: months[months.length - 1] ?? null,
    scheduleDays,
    periods: months
      .slice(-SUMMARY_PERIODS)
      .map((month) => periodSummary(state, month, payOffset)),
  };
}

// ── Чтение текущего снимка ──────────────────────────────────────────

/** Возвращает общий снимок табелей. null означает, что запись ещё не создана. */
export async function getDutyScheduleSnapshot(): Promise<DutyScheduleSnapshot | null> {
  const db = getAdminDb();
  // select("*") — чтобы чтение работало и в базе без колонки content_hash
  // (миграция истории могла быть ещё не применена).
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("id", SINGLETON_ID)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as {
    snapshot: DutyScheduleStoredState;
    pay_offset: unknown;
    updated_at: unknown;
    content_hash?: unknown;
  };

  const state = row.snapshot as DutyScheduleStoredState;
  const payOffset = normalizePayOffset(row.pay_offset);
  return {
    state,
    payOffset,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    hash: typeof row.content_hash === "string" && row.content_hash
      ? row.content_hash
      : dutyScheduleHash(state),
  };
}

// ── История версий ──────────────────────────────────────────────────

interface RevisionRow {
  id: number | string;
  created_at?: unknown;
  updated_at?: unknown;
  created_by?: unknown;
  note?: unknown;
  content_hash?: unknown;
  summary?: unknown;
}

interface CurrentRow {
  content_hash?: unknown;
  updated_at?: unknown;
}

/** Сводку из базы приводим к своим типам: в JSONB мог попасть любой
 *  мусор (старая версия, ручная правка через «Базу Данных»). */
function mapRevisionSummary(value: unknown): DutyScheduleRevisionSummary | null {
  if (!isRecord(value) || Object.keys(value).length === 0) return null;
  const num = (input: unknown) => (Number.isFinite(Number(input)) ? Number(input) : 0);
  const str = (input: unknown) => (typeof input === "string" && input ? input : null);
  const periods: DutyScheduleRevisionPeriod[] = Array.isArray(value.periods)
    ? (value.periods as unknown[])
        .filter(isRecord)
        .map((period) => ({
          month: String(period.month ?? ""),
          people: num(period.people),
          accrualTotal: num(period.accrualTotal),
          payoutRows: num(period.payoutRows),
          payoutTotal: num(period.payoutTotal),
        }))
    : [];
  return {
    employees: num(value.employees),
    activeEmployees: num(value.activeEmployees),
    months: num(value.months),
    firstMonth: str(value.firstMonth),
    lastMonth: str(value.lastMonth),
    scheduleDays: num(value.scheduleDays),
    periods,
  };
}

function mapRevision(row: RevisionRow): DutyScheduleRevisionMeta {
  const summary = mapRevisionSummary(row.summary);
  const createdAt = row.created_at ? String(row.created_at) : "";
  return {
    id: Number(row.id),
    createdAt,
    updatedAt: row.updated_at ? String(row.updated_at) : createdAt,
    createdBy: row.created_by ? String(row.created_by) : null,
    note: row.note ? String(row.note) : null,
    hash: row.content_hash ? String(row.content_hash) : "",
    summary,
  };
}

async function readCurrentRowHash(): Promise<string | null> {
  const row = await readCurrentRow();
  return row?.content_hash ? String(row.content_hash) : null;
}

/** Строка текущего снимка. Если колонки content_hash в базе ещё нет
 *  (миграцию истории не применяли) — читаем без неё: сохранение
 *  табеля важнее, чем отпечаток содержимого. */
async function readCurrentRow(): Promise<CurrentRow | null> {
  const db = getAdminDb();
  const withHash = await db
    .from(TABLE)
    .select("content_hash, updated_at")
    .eq("id", SINGLETON_ID)
    .maybeSingle();
  if (!withHash.error) return (withHash.data as CurrentRow | null) ?? null;
  if (!isMissingColumnError(withHash.error, "content_hash")) throw withHash.error;

  const withoutHash = await db
    .from(TABLE)
    .select("updated_at")
    .eq("id", SINGLETON_ID)
    .maybeSingle();
  if (withoutHash.error) {
    if (isMissingTableError(withoutHash.error)) return null;
    throw withoutHash.error;
  }
  return (withoutHash.data as CurrentRow | null) ?? null;
}

async function readNewestRevision(): Promise<RevisionRow | null> {
  const db = getAdminDb();
  const { data, error } = await db
    .from(REVISIONS_TABLE)
    .select("id, content_hash, note, updated_at")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw error;
  const list = (data || []) as RevisionRow[];
  return list[0] ?? null;
}

/** Кладёт в журнал текущее состояние строки, если его там ещё нет.
 *  Так «состояние до правки» всегда можно посмотреть и вернуть. */
async function backfillCurrentState(): Promise<void> {
  const db = getAdminDb();
  const { data, error } = await db
    .from(TABLE)
    .select("snapshot, pay_offset, content_hash, updated_by")
    .eq("id", SINGLETON_ID)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error, "content_hash")) {
      const fallback = await db
        .from(TABLE)
        .select("snapshot, pay_offset, updated_by")
        .eq("id", SINGLETON_ID)
        .maybeSingle();
      if (fallback.error || !fallback.data) return;
      const row = fallback.data as {
        snapshot: DutyScheduleStoredState;
        pay_offset: unknown;
        updated_by?: unknown;
      };
      await insertRevision({
        state: row.snapshot,
        payOffset: normalizePayOffset(row.pay_offset),
        hash: dutyScheduleHash(row.snapshot),
        updatedBy: row.updated_by ? String(row.updated_by) : null,
        note: null,
      });
      return;
    }
    throw error;
  }
  if (!data) return;

  const row = data as {
    snapshot: DutyScheduleStoredState;
    pay_offset: unknown;
    content_hash?: unknown;
    updated_by?: unknown;
  };
  const hash =
    typeof row.content_hash === "string" && row.content_hash
      ? row.content_hash
      : dutyScheduleHash(row.snapshot);

  await insertRevision({
    state: row.snapshot,
    payOffset: normalizePayOffset(row.pay_offset),
    hash,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    note: null,
  });
}

/** Вставка версии в журнал (без объединения). Ошибки истории не должны
 *  ломать сохранение самого табеля. */
async function insertRevision(args: {
  state: DutyScheduleStoredState;
  payOffset: number;
  hash: string;
  updatedBy?: string | null;
  note?: string | null;
  coalesce?: boolean;
}): Promise<boolean> {
  const db = getAdminDb();
  const summary = summarizeDutyScheduleState(args.state, args.payOffset);

  // Объединение правок одной сессии: дописываем последнюю версию, а не
  // создаём новую строку на каждое движение. Ручные пометки (откат,
  // восстановление) никогда не объединяются — это отдельные события.
  if (args.coalesce !== false && !args.note) {
    try {
      const newest = await readNewestRevision();
      if (newest && !newest.note) {
        const newestAt = Date.parse(String(newest.updated_at || ""));
        const fresh =
          Number.isFinite(newestAt) && Date.now() - newestAt < COALESCE_WINDOW_MS;
        const sameContent = String(newest.content_hash || "") === args.hash;
        if (fresh && !sameContent) {
          const { error } = await db
            .from(REVISIONS_TABLE)
            .update({
              snapshot: args.state,
              pay_offset: args.payOffset,
              content_hash: args.hash,
              summary,
              created_by: args.updatedBy || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", newest.id);
          if (error) throw error;
          return true;
        }
        if (fresh && sameContent) {
          return true;
        }
      }
    } catch (error) {
      if (isMissingTableError(error)) throw error;
      console.warn("Duty schedule revision coalesce failed:", error);
    }
  }

  const { error } = await db.from(REVISIONS_TABLE).insert({
    snapshot: args.state,
    pay_offset: args.payOffset,
    content_hash: args.hash,
    summary,
    note: args.note || null,
    created_by: args.updatedBy || null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return true;
}

/** Убираем самые старые версии, чтобы журнал не разрастался. */
async function trimRevisions(): Promise<void> {
  const db = getAdminDb();
  const { data, error } = await db
    .from(REVISIONS_TABLE)
    .select("id")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(KEEP_REVISIONS, KEEP_REVISIONS + 99);
  if (error || !data || data.length === 0) return;
  const ids = (data as { id: number }[]).map((row) => row.id);
  await db.from(REVISIONS_TABLE).delete().in("id", ids);
}

// ── Сохранение снимка ───────────────────────────────────────────────

/**
 * Атомарно заменяет общий снимок и добавляет версию в историю.
 * upsert по постоянному id не создаёт новый табель при повторной
 * генерации — обновляется та же строка базы.
 */
export async function saveDutyScheduleSnapshot(
  snapshot: Pick<DutyScheduleSnapshot, "state" | "payOffset">,
  updatedBy?: string | null,
  options?: { note?: string | null; forceRevision?: boolean }
): Promise<{
  updatedAt: string | null;
  hash: string;
  unchanged: boolean;
  historyEnabled: boolean;
}> {
  const db = getAdminDb();
  const state = snapshot.state;
  const payOffset = normalizePayOffset(snapshot.payOffset);
  const hash = dutyScheduleHash(state);
  const forceRevision = Boolean(options?.forceRevision);

  const current = await readCurrentRow();
  const currentHash = current?.content_hash ? String(current.content_hash) : null;

  if (currentHash && currentHash === hash && !forceRevision) {
    // Ничего не поменялось — лишний запрос и версию не создаём.
    return {
      updatedAt: current?.updated_at ? String(current.updated_at) : null,
      hash,
      unchanged: true,
      historyEnabled: await isHistoryEnabled(),
    };
  }

  // 1. Состояние «до правки» должно быть в истории до перезаписи строки.
  let historyEnabled = true;
  let backfilled = false;
  if (current && currentHash !== hash) {
    try {
      const newest = await readNewestRevision();
      const newestHash = newest ? String(newest.content_hash || "") : "";
      if (!currentHash || newestHash !== currentHash) {
        await backfillCurrentState();
        backfilled = true;
      }
    } catch (error) {
      if (isMissingTableError(error)) {
        historyEnabled = false;
      } else {
        console.warn("Duty schedule history backfill failed:", error);
      }
    }
  }

  // 2. Запись рабочего снимка. content_hash пишем только если колонка есть.
  const payload: Record<string, unknown> = {
    id: SINGLETON_ID,
    snapshot: state,
    pay_offset: payOffset,
    updated_by: updatedBy || null,
  };
  let writeResult = await db
    .from(TABLE)
    .upsert({ ...payload, content_hash: hash }, { onConflict: "id" })
    .select("updated_at")
    .single();
  if (
    writeResult.error &&
    isMissingColumnError(writeResult.error, "content_hash")
  ) {
    writeResult = await db
      .from(TABLE)
      .upsert(payload, { onConflict: "id" })
      .select("updated_at")
      .single();
  }
  if (writeResult.error) throw writeResult.error;

  const updatedAt = writeResult.data?.updated_at
    ? String(writeResult.data.updated_at)
    : null;

  // 3. Версия в журнале (вспомогательная операция).
  if (!forceRevision && currentHash === hash) {
    return { updatedAt, hash, unchanged: true, historyEnabled };
  }

  if (historyEnabled) {
    try {
      await insertRevision({
        state,
        payOffset,
        hash,
        updatedBy,
        note: options?.note || null,
        // Только что добавленную в журнал «версию до правки» нельзя
        // перезаписывать этой же правкой — иначе она снова исчезнет.
        coalesce: !forceRevision && !options?.note && !backfilled,
      });
      await trimRevisions();
    } catch (error) {
      if (isMissingTableError(error)) {
        historyEnabled = false;
      } else {
        console.warn("Duty schedule revision insert failed:", error);
      }
    }
  }

  return { updatedAt, hash, unchanged: false, historyEnabled };
}

/** Есть ли в базе таблица истории (без обращения к снимкам). */
export async function isHistoryEnabled(): Promise<boolean> {
  try {
    const db = getAdminDb();
    const { error } = await db
      .from(REVISIONS_TABLE)
      .select("id")
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Список сохранённых версий (без самих снимков), свежие сверху. */
export async function getDutyScheduleRevisions(
  limit = 100
): Promise<{
  revisions: DutyScheduleRevisionMeta[];
  currentHash: string | null;
  historyEnabled: boolean;
  hint: string | null;
}> {
  const db = getAdminDb();
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 300);

  const currentHash = await readCurrentRowHash().catch(() => null);

  const { data, error } = await db
    .from(REVISIONS_TABLE)
    .select("id, created_at, updated_at, created_by, note, content_hash, summary")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);

  if (error) {
    if (isMissingTableError(error)) {
      return {
        revisions: [],
        currentHash,
        historyEnabled: false,
        hint: DUTY_SCHEDULE_HISTORY_HINT,
      };
    }
    throw error;
  }

  return {
    revisions: ((data || []) as RevisionRow[]).map(mapRevision),
    currentHash,
    historyEnabled: true,
    hint: null,
  };
}

/** Полный снимок одной версии — для просмотра «как было» и отката. */
export async function getDutyScheduleRevision(
  id: number
): Promise<DutyScheduleRevisionSnapshot | null> {
  const db = getAdminDb();
  const { data, error } = await db
    .from(REVISIONS_TABLE)
    .select(
      "id, snapshot, pay_offset, content_hash, created_at, updated_at, created_by, note"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as RevisionRow & {
    snapshot: DutyScheduleStoredState;
    pay_offset: unknown;
  };
  const createdAt = row.created_at ? String(row.created_at) : "";
  return {
    id: Number(row.id),
    state: row.snapshot as DutyScheduleStoredState,
    payOffset: normalizePayOffset(row.pay_offset),
    createdAt,
    updatedAt: row.updated_at ? String(row.updated_at) : createdAt,
    createdBy: row.created_by ? String(row.created_by) : null,
    note: row.note ? String(row.note) : null,
    hash: row.content_hash ? String(row.content_hash) : null,
  };
}

/** Возвращает версию в работу: её снимок становится текущим, а в журнал
 *  добавляется запись о восстановлении. */
export async function restoreDutyScheduleRevision(
  id: number,
  updatedBy?: string | null
): Promise<DutyScheduleSnapshot | null> {
  const revision = await getDutyScheduleRevision(id);
  if (!revision) return null;

  const label = formatRevisionMoment(revision.updatedAt || revision.createdAt);
  const result = await saveDutyScheduleSnapshot(
    { state: revision.state, payOffset: revision.payOffset },
    updatedBy,
    { note: `Восстановлена версия от ${label}`, forceRevision: true }
  );

  return {
    state: revision.state,
    payOffset: revision.payOffset,
    updatedAt: result.updatedAt,
    hash: result.hash,
  };
}

/** «01.10.2026, 14:35» в московском времени. */
export function formatRevisionMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return parts.replace(",", " в");
}

/** Понятная подсказка, если код уже развёрнут, а SQL-миграция ещё нет. */
export function dutyScheduleStoreErrorMessage(error: unknown): string {
  if (isMissingSchemaError(error)) {
    return `Хранилище табелей ещё не создано. ${DUTY_SCHEDULE_MIGRATION_HINT}`;
  }
  return "Не удалось обратиться к базе табелей. Проверьте соединение и повторите попытку.";
}
