// =========================================================
// FILE: src/lib/deal-archive.ts
// Архив заказов учёта: на какие счета ушли деньги по заказу,
// фильтры по счетам и сортировка по ТОЧНОМУ времени добавления.
//
// Раньше архив сортировали по `CustomerDeal.date` — это только день
// документа («YYYY-MM-DD»). Из-за этого заказы, добавленные в разное
// время одного дня (или задним числом), выстраивались по номеру, а не
// по моменту создания. Здесь источником порядка служит `createdAt`
// (TIMESTAMPTZ из БД, с минутами и секундами), а счёт выводится из
// привязанных к заказу входящих платежей.
//
// Модуль чистый (без next/react) — его можно проверять node:test.
// =========================================================

import type { BankPayment, CustomerDeal } from "@/lib/warehouse-shared";

/** Денежные счета, на которые может прийти оплата заказа. */
export type DealAccountId = "cash" | "vm_card" | "ym_card" | "bank";

/** Значение фильтра архива: все счета / конкретный счёт / без платежа. */
export type DealAccountFilter = "all" | DealAccountId | "unknown";

export type DealSortKey = "created" | "account";
export type DealSortDirection = "asc" | "desc";

/** Порядок счетов в бейджах, фильтрах и сортировке «по счёту». */
export const DEAL_ACCOUNT_IDS: readonly DealAccountId[] = [
  "cash",
  "vm_card",
  "ym_card",
  "bank",
];

export const DEAL_ACCOUNT_LABELS: Record<DealAccountId, string> = {
  cash: "Касса (наличные)",
  vm_card: "Карта В.М.",
  ym_card: "Карта ЮМ",
  bank: "Расчётный счёт",
};

/** Короткая подпись для бейджа в шапке заказа. */
export const DEAL_ACCOUNT_SHORT_LABELS: Record<DealAccountId, string> = {
  cash: "Наличные",
  vm_card: "Карта В.М.",
  ym_card: "Карта ЮМ",
  bank: "Р/с",
};

export const DEAL_ACCOUNT_FILTERS: readonly {
  value: DealAccountFilter;
  label: string;
}[] = [
  { value: "all", label: "Все счета" },
  { value: "cash", label: "Касса" },
  { value: "vm_card", label: "Карта В.М." },
  { value: "ym_card", label: "Карта ЮМ" },
  { value: "bank", label: "Р/с" },
  { value: "unknown", label: "Без счёта" },
];

/** Один счёт в разбивке оплаты заказа. */
export interface DealAccountEntry {
  account: DealAccountId;
  /** Сумма привязанных входящих платежей на этом счёте. */
  amount: number;
  /** Номера ПЛ, из которых получилась сумма. */
  paymentNumbers: number[];
  /** Есть ли среди платежей ещё не проведённые. */
  hasPending: boolean;
  /**
   * Счёт не из платежа, а выведен из галочки контрагента «за наличку».
   * Нужно для старых/импортированных заказов без движений в банке.
   */
  inferred?: boolean;
}

/**
 * Счёт платежа (любого направления). Правила повторяют расчёт балансов
 * в `warehouse-shared.ts`: переводы (`transfer`) и наличка с
 * `cashDestination=card` идут сразу на карту ЮМ, `vm_card` — на вторую
 * карту, регулярные платежи — на расчётный счёт.
 */
export function paymentAccount(
  payment: Pick<BankPayment, "type" | "cashDestination">
): DealAccountId {
  if (payment.type === "vm_card" || payment.cashDestination === "vm_card") {
    return "vm_card";
  }
  if (
    payment.type === "ym_card" ||
    payment.type === "transfer" ||
    payment.cashDestination === "card"
  ) {
    return "ym_card";
  }
  if (payment.type === "cash") return "cash";
  return "bank";
}

/** Счёт именно входящего платежа (для разбивки оплат заказа). */
export function paymentDealAccount(
  payment: Pick<BankPayment, "direction" | "type" | "cashDestination">
): DealAccountId | null {
  if (payment.direction !== "incoming") return null;
  return paymentAccount(payment);
}

/**
 * Разбивка оплат по заказам: `dealId → счета`. Учитываются только
 * входящие платежи с привязкой к заказу. Частичные оплаты на разных
 * счетах не перетирают друг друга — заказ получит несколько записей.
 *
 * `cashDealIds` — заказы контрагентов с галочкой «за наличку», к
 * которым нет ни одного платежа: для них показываем кассу по метке
 * контрагента (старые архивные заказы из массовой загрузки).
 */
export function buildDealAccountsMap(
  payments: readonly BankPayment[],
  cashDealIds: ReadonlySet<string> = new Set()
): Map<string, DealAccountEntry[]> {
  const byDeal = new Map<string, Map<DealAccountId, DealAccountEntry>>();

  for (const payment of payments) {
    const account = paymentDealAccount(payment);
    if (!account) continue;
    for (const rawId of payment.dealIds || []) {
      const id = String(rawId);
      let perAccount = byDeal.get(id);
      if (!perAccount) {
        perAccount = new Map();
        byDeal.set(id, perAccount);
      }
      let entry = perAccount.get(account);
      if (!entry) {
        entry = { account, amount: 0, paymentNumbers: [], hasPending: false };
        perAccount.set(account, entry);
      }
      entry.amount += Number(payment.amount) || 0;
      if (Number.isFinite(Number(payment.number))) {
        entry.paymentNumbers.push(Number(payment.number));
      }
      if (!payment.isPaid) entry.hasPending = true;
    }
  }

  const result = new Map<string, DealAccountEntry[]>();
  for (const [id, perAccount] of byDeal) {
    const entries = DEAL_ACCOUNT_IDS.filter((key) => perAccount.has(key)).map(
      (key) => {
        const entry = perAccount.get(key)!;
        entry.amount = Math.round(entry.amount * 100) / 100;
        entry.paymentNumbers.sort((a, b) => a - b);
        return entry;
      }
    );
    result.set(id, entries);
  }

  for (const rawId of cashDealIds) {
    const id = String(rawId);
    if (byDeal.has(id)) continue;
    result.set(id, [
      {
        account: "cash",
        amount: 0,
        paymentNumbers: [],
        hasPending: false,
        inferred: true,
      },
    ]);
  }

  return result;
}

export function getDealAccounts(
  dealId: string | number | null | undefined,
  accounts: ReadonlyMap<string, DealAccountEntry[]>
): DealAccountEntry[] {
  if (dealId == null) return [];
  return accounts.get(String(dealId)) || [];
}

/** Основной счёт заказа — тот, куда пришла бо́льшая сумма. */
export function dealPrimaryAccount(
  entries: readonly DealAccountEntry[]
): DealAccountId | null {
  let best: DealAccountEntry | undefined;
  for (const entry of entries) {
    if (!best) {
      best = entry;
      continue;
    }
    const bestRank = DEAL_ACCOUNT_IDS.indexOf(best.account);
    const rank = DEAL_ACCOUNT_IDS.indexOf(entry.account);
    if (entry.amount > best.amount || (entry.amount === best.amount && rank < bestRank)) {
      best = entry;
    }
  }
  return best?.account ?? null;
}

export function dealMatchesAccount(
  filter: DealAccountFilter,
  entries: readonly DealAccountEntry[]
): boolean {
  if (filter === "all") return true;
  if (filter === "unknown") return entries.length === 0;
  return entries.some((entry) => entry.account === filter);
}

/**
 * Момент добавления заказа в миллисекундах. `createdAt` содержит минуты
 * и секунды; если его нет (старые записи), fallback — полуночь даты
 * документа, чтобы порядок оставался детерминированным.
 */
export function dealCreationTime(
  deal: Pick<CustomerDeal, "date" | "createdAt">
): number {
  const created = Date.parse(String(deal.createdAt || ""));
  if (Number.isFinite(created)) return created;
  const day = String(deal.date || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    // Полуночь по Новосибирску, чтобы fallback не «уезжал» на 7 часов
    // относительно остальных заказов с полным createdAt.
    const dayMs = Date.parse(`${day}T00:00:00+07:00`);
    if (Number.isFinite(dayMs)) return dayMs;
  }
  return 0;
}

function dealAccountRank(
  deal: CustomerDeal,
  accounts: ReadonlyMap<string, DealAccountEntry[]>
): number {
  const primary = dealPrimaryAccount(getDealAccounts(deal.id, accounts));
  const index = primary ? DEAL_ACCOUNT_IDS.indexOf(primary) : -1;
  return index < 0 ? DEAL_ACCOUNT_IDS.length : index;
}

/**
 * Сортировка архива. По умолчанию — по времени создания с секундами.
 * При `key="account"` группы счетов всегда идут в фиксированном
 * порядке (касса → В.М. → ЮМ → р/с → без счёта), а направление
 * меняет порядок заказов только внутри группы.
 */
export function sortDeals(
  deals: readonly CustomerDeal[],
  options: {
    key: DealSortKey;
    direction: DealSortDirection;
    accounts: ReadonlyMap<string, DealAccountEntry[]>;
  }
): CustomerDeal[] {
  const rows = [...deals];
  const sign = options.direction === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    if (options.key === "account") {
      const rankDiff = dealAccountRank(a, options.accounts) - dealAccountRank(b, options.accounts);
      if (rankDiff !== 0) return rankDiff;
    }
    const timeDiff = dealCreationTime(a) - dealCreationTime(b);
    if (timeDiff !== 0) return sign * timeDiff;
    const numberDiff = (Number(a.number) || 0) - (Number(b.number) || 0);
    if (numberDiff !== 0) return sign * numberDiff;
    return String(a.id).localeCompare(String(b.id));
  });
  return rows;
}

/** Время добавления заказа для интерфейса: Новосибирск, с секундами. */
export function formatDealCreatedAt(raw: string | null | undefined): string {
  const value = String(raw || "").trim();
  if (!value) return "—";
  // Дата без времени (fallback для старых записей): не выдумываем часы.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}.${month}.${year}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Novosibirsk",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
