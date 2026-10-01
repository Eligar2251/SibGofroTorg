// =========================================================
// FILE: src/lib/rent-shared.ts
// Управленческий учёт аренды: типы и ЧИСТЫЕ расчёты.
// Модуль полностью отдельный от складского учёта: свои
// организации, арендаторы, начисления и банк аренды.
// Файл без server-only зависимостей → безопасен для клиентских
// компонентов (как warehouse-shared.ts).
// =========================================================

// ── Справочники ──────────────────────────────────────────

export const RENT_ORG_LABELS: Record<string, string> = {
  bau: "БАУ",
  sit: "СибИнвестТорг",
  pakin: "ИП Пакин",
};

/** Организации, у которых есть свой счёт (на них ведутся балансы). */
export const RENT_ACCOUNT_ORGS = ["bau", "pakin"] as const;

export const RENT_PERIOD_OPTIONS = [
  { months: 1, label: "Ежемесячно" },
  { months: 3, label: "Квартал" },
  { months: 6, label: "Полгода" },
  { months: 12, label: "Год" },
] as const;

export function rentPeriodLabel(months: number): string {
  const known = RENT_PERIOD_OPTIONS.find((o) => o.months === months);
  if (known) return known.label;
  return `Раз в ${months} мес.`;
}

export const RENT_PAY_METHOD_LABELS = {
  bank: "Безнал",
  cash: "Наличка",
  any: "Безнал / наличка",
} as const;
export type RentPayMethod = keyof typeof RENT_PAY_METHOD_LABELS;

export const RENT_INVOICE_STATUS_LABELS = {
  awaiting: "Ждёт оплаты",
  paid: "Оплачен",
  cancelled: "Отменён",
} as const;
export type RentInvoiceStatus = keyof typeof RENT_INVOICE_STATUS_LABELS;

export const RENT_PAYMENT_KIND_LABELS: Record<string, string> = {
  rent: "Аренда",
  deposit: "Депозит / залог",
  utility: "Коммунальные услуги",
  other: "Прочий приход",
  expense_utility: "Коммунальные расходы",
  expense_salary: "Зарплата / охрана",
  expense_repair: "Ремонт / хоз. нужды",
  expense_tax: "Налоги",
  expense_other: "Прочий расход",
};

// ── Типы данных (сериализованные для клиента) ────────────

export interface RentOrg {
  id: string;
  name: string;
  shortName: string;
  legalName: string | null;
  inn: string | null;
  bankAccount: string | null;
  bankName: string | null;
  bik: string | null;
  correspondentAccount: string | null;
  payDay: number;
  invoiceDay: number;
  /** NULL = деньги идут на собственный счёт; иначе id организации-счёта. */
  paysToOrgId: string | null;
  comment: string | null;
}

/** Стандартный тариф за электроэнергию (руб./кВт⋅ч) по умолчанию. */
export const DEFAULT_ELECTRICITY_TARIFF = 9;

export const ELECTRICITY_INVOICE_TAG = "[ЭЭ]";

export interface RentTenant {
  id: string;
  orgId: string;
  name: string;
  office: string | null;
  contractNumber: string | null;
  contractDate: string | null;
  monthlyRent: number;
  /** Индивидуальный тариф за электроэнергию (руб./кВт⋅ч), по стандарту 9 ₽. */
  electricityTariff: number;
  periodMonths: number;
  dueDay: number | null;
  invoiceDay: number | null;
  deferralDays: number;
  payMethod: "bank" | "cash" | "any";
  contactName: string | null;
  phone: string | null;
  email: string | null;
  inn: string | null;
  comment: string | null;
  status: "active" | "archived";
}

export interface RentInvoice {
  id: string;
  number: number;
  tenantId: string;
  orgId: string;
  accountOrgId: string;
  /** Тип счёта: аренда или электроэнергия (по счётчику). */
  kind?: "rent" | "electricity";
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  status: RentInvoiceStatus;
  paidAt: string | null;
  payMethod: "bank" | "cash" | null;
  comment: string | null;
}

export interface RentMeterReading {
  id: string;
  tenantId: string;
  /** Первое число месяца расчёта: YYYY-MM-01 */
  period: string;
  /** Тариф руб./кВт⋅ч за данный период */
  tariff: number;
  /** Начальное показание счётчика (кВт⋅ч) */
  readingStart: number | null;
  /** Конечное показание счётчика (кВт⋅ч) */
  readingEnd: number | null;
  /** Расход = readingEnd - readingStart (кВт⋅ч) */
  consumption: number;
  /** Сумма = consumption * tariff (руб.) */
  amount: number;
  /** Связанный счёт за ЭЭ в rent_invoices (если выставлен) */
  invoiceId: string | null;
  comment: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface RentPayment {
  id: string;
  number: number;
  accountOrgId: string;
  tenantId: string | null;
  invoiceId: string | null;
  direction: "incoming" | "outgoing";
  kind: string;
  method: "bank" | "cash";
  counterparty: string;
  amount: number;
  date: string;
  invoiceNumber: string | null;
  isPaid: boolean;
  paidAt: string | null;
  excludeFromBalance: boolean;
  comment: string | null;
}

// ── Даты ─────────────────────────────────────────────────

export function rentTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** YYYY-MM-DD → Date (локальная полночь). */
export function rentParseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function rentToIso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Прибавить месяцы, прижимая день к концу месяца при переполнении. */
export function rentAddMonths(iso: string, months: number): Date {
  const base = rentParseDate(iso);
  const day = base.getDate();
  const moved = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const lastDay = new Date(moved.getFullYear(), moved.getMonth() + 1, 0).getDate();
  moved.setDate(Math.min(day, lastDay));
  return moved;
}

export function rentDaysBetween(fromIso: string, toIso: string): number {
  const a = rentParseDate(fromIso).getTime();
  const b = rentParseDate(toIso).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function rentFmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = rentParseDate(iso.slice(0, 10));
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function rentFmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = rentParseDate(iso.slice(0, 10));
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export function rentMonthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

export function rentMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const names = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  return `${names[(m || 1) - 1]} ${y}`;
}

/** Крайняя дата месяца: например день 31 для февраля станет 28/29. */
export function rentClampDay(year: number, monthIdx: number, day: number): string {
  const lastDay = new Date(year, monthIdx + 1, 0).getDate();
  return rentToIso(new Date(year, monthIdx, Math.min(day, lastDay)));
}

// ── Правила начислений ───────────────────────────────────

/** Организация, на счёт которой приходят деньги арендатора (СИТ→БАУ). */
export function rentAccountOrgId(org: RentOrg | undefined, orgs: RentOrg[]): string {
  if (!org) return "bau";
  if (org.paysToOrgId) return org.paysToOrgId;
  return orgs.some((o) => o.id === org.id) ? org.id : "bau";
}

/** Крайний день оплаты: исключение арендатора или общий день организации. */
export function rentDueDay(tenant: RentTenant, orgs: RentOrg[]): number {
  if (tenant.dueDay) return tenant.dueDay;
  const org = orgs.find((o) => o.id === tenant.orgId);
  return org?.payDay ?? 3;
}

/** День выставления счёта: исключение арендатора или день организации. */
export function rentInvoiceDay(tenant: RentTenant, orgs: RentOrg[]): number {
  if (tenant.invoiceDay) return tenant.invoiceDay;
  const org = orgs.find((o) => o.id === tenant.orgId);
  return org?.invoiceDay ?? 25;
}

/** У арендатора деньги приходят не в «свою» организацию (СИТ → БАУ). */
export function rentHasPayeeNote(tenant: RentTenant, orgs: RentOrg[]): boolean {
  const org = orgs.find((o) => o.id === tenant.orgId);
  return !!org?.paysToOrgId;
}

// ── Состояние начисления ─────────────────────────────────

export type RentInvoiceState =
  | "paid"
  | "cancelled"
  | "overdue"
  | "grace"
  | "due_today"
  | "upcoming"
  | "awaiting";

/**
 * Производное состояние счёта с учётом отсрочки арендатора:
 * после крайнего дня включается отсрочка (grace), и только после
 * due_date + deferral_days начинается просрочка.
 */
export function rentInvoiceState(
  invoice: RentInvoice,
  deferralDays: number,
  todayIso: string
): RentInvoiceState {
  if (invoice.status === "paid") return "paid";
  if (invoice.status === "cancelled") return "cancelled";
  const limit = rentToIso(
    new Date(
      rentParseDate(invoice.dueDate).getTime() + deferralDays * 86_400_000
    )
  );
  if (todayIso > limit) return "overdue";
  // Срок прошёл, но отсрочка ещё действует.
  if (todayIso > invoice.dueDate) return "grace";
  if (todayIso === invoice.dueDate) return "due_today";
  const daysToDue = rentDaysBetween(todayIso, invoice.dueDate);
  if (daysToDue <= 7) return "upcoming";
  return "awaiting";
}

export const RENT_INVOICE_STATE_LABELS: Record<RentInvoiceState, string> = {
  paid: "Оплачен",
  cancelled: "Отменён",
  overdue: "Просрочен",
  grace: "Отсрочка",
  due_today: "Оплата сегодня",
  upcoming: "Скоро оплата",
  awaiting: "Ждёт оплаты",
};

// ── Состояние арендатора ─────────────────────────────────

export interface RentTenantState {
  tenant: RentTenant;
  /** Оплачено по (конец последнего оплаченного периода). */
  paidUntil: string | null;
  /** Сумма неоплаченных неотменённых начислений. */
  debt: number;
  overdue: number;
  overdueDays: number;
  nextDueDate: string | null;
  nextDueAmount: number;
  invoiceCount: number;
}

export function computeTenantState(
  tenant: RentTenant,
  invoices: RentInvoice[],
  todayIso: string
): RentTenantState {
  const own = invoices.filter((i) => i.tenantId === tenant.id);
  const active = own.filter((i) => i.status !== "cancelled");
  const awaiting = active.filter((i) => i.status === "awaiting");
  const paid = active.filter((i) => i.status === "paid");

  const paidUntil = paid.length
    ? paid.map((i) => i.periodEnd).sort().slice(-1)[0]
    : null;

  let debt = 0;
  let overdue = 0;
  let overdueDays = 0;
  let nextDueDate: string | null = null;
  let nextDueAmount = 0;

  for (const inv of awaiting) {
    debt += inv.amount;
    const st = rentInvoiceState(inv, tenant.deferralDays, todayIso);
    if (st === "overdue") {
      overdue += inv.amount;
      const limit = rentToIso(
        new Date(rentParseDate(inv.dueDate).getTime() + tenant.deferralDays * 86_400_000)
      );
      overdueDays = Math.max(overdueDays, rentDaysBetween(limit, todayIso));
    }
  }
  const upcoming = awaiting
    .filter((i) => i.dueDate >= todayIso)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (upcoming.length) {
    nextDueDate = upcoming[0].dueDate;
    nextDueAmount = upcoming.reduce((s, i) => s + i.amount, 0);
  }

  return {
    tenant,
    paidUntil,
    debt,
    overdue,
    overdueDays,
    nextDueDate,
    nextDueAmount,
    invoiceCount: active.length,
  };
}

/** Сколько уже внесено по счёту проведёнными входящими платежами. */
export function rentInvoicePaidSum(
  invoiceId: string,
  payments: RentPayment[]
): number {
  let sum = 0;
  for (const p of payments) {
    if (p.isPaid && p.direction === "incoming" && p.invoiceId === invoiceId) {
      sum += p.amount;
    }
  }
  return sum;
}

/** Есть ли у счёта привязанные платежи (оплата идёт через банк). */
export function rentInvoiceHasPayments(
  invoiceId: string,
  payments: RentPayment[]
): boolean {
  return payments.some((p) => p.invoiceId === invoiceId);
}

/**
 * Аванс арендатора: проведённые платежи без привязки к счёту
 * (приход в плюс, расход в минус). Управленческая «переплата».
 */
export function rentTenantAdvance(
  tenantId: string,
  payments: RentPayment[]
): number {
  let sum = 0;
  for (const p of payments) {
    if (!p.isPaid || p.tenantId !== tenantId || p.invoiceId) continue;
    sum += p.direction === "incoming" ? p.amount : -p.amount;
  }
  return sum;
}

// ── Балансы банка аренды ─────────────────────────────────

export interface RentOrgBalance {
  orgId: string;
  bankBalance: number;
  cashBalance: number;
  balance: number;
  expectedIn: number;
  expectedOut: number;
  monthIn: number;
  monthOut: number;
}

/** Балансы по счетам (только проведённые платежи, без исключённых). */
export function computeRentBalances(
  payments: RentPayment[],
  todayIso: string
): Record<string, RentOrgBalance> {
  const result: Record<string, RentOrgBalance> = {};
  const empty = (orgId: string): RentOrgBalance => ({
    orgId,
    bankBalance: 0,
    cashBalance: 0,
    balance: 0,
    expectedIn: 0,
    expectedOut: 0,
    monthIn: 0,
    monthOut: 0,
  });
  for (const orgId of RENT_ACCOUNT_ORGS) result[orgId] = empty(orgId);
  const monthKey = rentMonthKey(todayIso);

  for (const p of payments) {
    const b = result[p.accountOrgId] || (result[p.accountOrgId] = empty(p.accountOrgId));
    const sign = p.direction === "incoming" ? 1 : -1;
    if (p.isPaid && !p.excludeFromBalance) {
      if (p.method === "cash") b.cashBalance += sign * p.amount;
      else b.bankBalance += sign * p.amount;
      b.balance += sign * p.amount;
      if (rentMonthKey(p.date) === monthKey) {
        if (sign > 0) b.monthIn += p.amount;
        else b.monthOut += p.amount;
      }
    } else if (!p.isPaid && !p.excludeFromBalance) {
      if (sign > 0) b.expectedIn += p.amount;
      else b.expectedOut += p.amount;
    }
  }
  return result;
}

// ── Форматирование сумм ──────────────────────────────────

export function rentFmt(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

export function rentFmtDec(
  n: number | null | undefined,
  maxFrac = 1
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
}

// ── Электроэнергия (показания счётчиков и счета за ЭЭ) ───

/** Определяет, относится ли счёт (начисление) к электроэнергии. */
export function isElectricityInvoice(
  inv: Pick<RentInvoice, "comment"> & { kind?: string | null }
): boolean {
  if (inv.kind === "electricity") return true;
  const c = String(inv.comment || "").trim();
  return (
    c.startsWith(ELECTRICITY_INVOICE_TAG) ||
    /^электроэнергия\b/i.test(c)
  );
}

/** Убирает служебный префикс [ЭЭ] из комментария счёта для отображения. */
export function stripElectricityTag(comment: string | null | undefined): string {
  if (!comment) return "";
  return comment.replace(/^\[ЭЭ\]\s*/i, "").trim();
}

/** Нормализует период к виду YYYY-MM-01. */
export function normalizeElectricityPeriod(raw: string): string {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) {
    const today = rentTodayIso();
    return `${today.slice(0, 7)}-01`;
  }
  return `${m[1]}-${m[2]}-01`;
}

/** Возвращает ключ месяца YYYY-MM из периода YYYY-MM-01. */
export function electricityPeriodMonthKey(period: string): string {
  return normalizeElectricityPeriod(period).slice(0, 7);
}

/** Сдвигает месяц YYYY-MM на deltaMonths. */
export function shiftElectricityMonth(
  monthKey: string,
  deltaMonths: number
): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y || 2026, (m || 1) - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Конец месяца YYYY-MM-DD для периода YYYY-MM-01. */
export function electricityPeriodEndIso(period: string): string {
  const norm = normalizeElectricityPeriod(period);
  const [y, m] = norm.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/** Округление показаний до 1 знака после запятой. */
export function roundReading1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Округление суммы до 2 знаков после запятой (копеек). */
export function roundMoney2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Чистый расчёт расхода и суммы по показаниям счётчика:
 *   consumption = reading_end − reading_start
 *   amount      = consumption × tariff
 */
export function calcElectricityReading(
  readingStart: number | null | undefined,
  readingEnd: number | null | undefined,
  tariff: number | null | undefined
): {
  consumption: number;
  amount: number;
  valid: boolean;
  error: string | null;
} {
  const t = Number(tariff);
  if (!Number.isFinite(t) || t <= 0) {
    return {
      consumption: 0,
      amount: 0,
      valid: false,
      error: "Тариф должен быть больше 0",
    };
  }
  if (
    readingStart == null ||
    readingEnd == null ||
    !Number.isFinite(readingStart) ||
    !Number.isFinite(readingEnd)
  ) {
    return {
      consumption: 0,
      amount: 0,
      valid: false,
      error: null,
    };
  }
  const start = roundReading1(readingStart);
  const end = roundReading1(readingEnd);
  if (end < start) {
    return {
      consumption: roundReading1(end - start),
      amount: 0,
      valid: false,
      error: "Конечное показание меньше начального",
    };
  }
  const consumption = roundReading1(end - start);
  const amount = roundMoney2(consumption * t);
  return {
    consumption,
    amount,
    valid: true,
    error: null,
  };
}

/** Формирует информативный комментарий для счёта за электроэнергию. */
export function composeElectricityInvoiceComment(opts: {
  period: string;
  readingStart: number;
  readingEnd: number;
  consumption: number;
  tariff: number;
  extra?: string | null;
}): string {
  const mKey = electricityPeriodMonthKey(opts.period);
  const base = `${ELECTRICITY_INVOICE_TAG} Электроэнергия за ${rentMonthLabel(mKey).toLocaleLowerCase("ru-RU")}: ${rentFmtDec(opts.consumption, 1)} кВт⋅ч × ${rentFmtDec(opts.tariff, 2)} ₽ (${rentFmtDec(opts.readingStart, 1)} → ${rentFmtDec(opts.readingEnd, 1)})`;
  const cleanExtra = stripElectricityTag(opts.extra).trim();
  return cleanExtra ? `${base} · ${cleanExtra}` : base;
}

/**
 * Находит предыдущую запись показаний арендатора перед указанным периодом
 * (с заполненным конечным показанием).
 */
export function findPreviousReading(
  readings: RentMeterReading[],
  tenantId: string,
  period: string
): RentMeterReading | null {
  const targetPeriod = normalizeElectricityPeriod(period);
  const prev = readings
    .filter(
      (r) =>
        r.tenantId === tenantId &&
        normalizeElectricityPeriod(r.period) < targetPeriod &&
        r.readingEnd != null
    )
    .sort((a, b) =>
      normalizeElectricityPeriod(b.period).localeCompare(
        normalizeElectricityPeriod(a.period)
      )
    );
  return prev[0] || null;
}

