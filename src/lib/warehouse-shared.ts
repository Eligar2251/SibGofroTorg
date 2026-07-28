// src/lib/warehouse-shared.ts
// Shared types and pure logic functions for warehouse/bank.
// Safe for both Client and Server components.

import { includedVat, VAT_RATE, VAT_RATES } from "./vat";
export { includedVat, VAT_RATE, VAT_RATES } from "./vat";

export interface StockDocItem {
  productId: string;
  /** id варианта (если выбран в заказе/поступлении). NULL — без варианта. */
  variantId?: string | null;
  /** Snapshot имени варианта (на случай, если админ переименует). */
  variantName?: string | null;
  name: string;
  sku?: string | null;
  quantity: number;
  price: number;
  lineTotal: number;
}

export type CounterpartyRole = "supplier" | "customer";

export interface CounterpartyDetails {
  phone?: string | null;
  email?: string | null;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  fullName?: string | null;
  shortName?: string | null;
  legalAddress?: string | null;
  taxSystem?: string | null;
  bankAccount?: string | null;
  bankName?: string | null;
  bik?: string | null;
  correspondentAccount?: string | null;
  address?: string | null;
  contactName?: string | null;
}

export interface Counterparty extends CounterpartyDetails {
  id: string;
  name: string;
  normalizedName: string;
  roles: CounterpartyRole[];
  supplierPrices?: Record<string, number>;
  comment?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type ReceiptStatus = "draft" | "posted";

export interface WarehouseReceipt extends CounterpartyDetails {
  id: string;
  number: number;
  date: string;
  supplier: string;
  status: ReceiptStatus;
  counterpartyId?: string | null;
  comment?: string | null;
  items: StockDocItem[];
  total: number;
  bankAdjustment: number;
  vatRate: number;
  vatAmount: number;
  linkedDealIds?: string[];
  linkedDealNumbers?: number[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type DealStatus = "new" | "completed" | "cancelled";

export interface CustomerDeal extends CounterpartyDetails {
  id: string;
  number: number;
  date: string;
  customerName: string;
  counterpartyId?: string | null;
  customerPhone?: string | null;
  comment?: string | null;
  items: StockDocItem[];
  total: number;
  bankAdjustment: number;
  vatRate: number;
  vatAmount: number;
  status: DealStatus;
  cancelReason?: string | null;
  /** Есть ли доставка у заказа учёта */
  hasDelivery?: boolean;
  deliveryType?: "free" | "paid" | null;
  deliveryCost?: number | null;
  deliveryAddress?: string | null;
  deliveryPlannedDate?: string | null;
  deliveryReleasedAt?: string | null;
  deliveryNote?: string | null;
  /** Водитель, назначенный на доставку */
  deliveryDriverId?: string | null;
  deliveryDriverName?: string | null;
  /** Частично отгруженные товары: [{productId, name, shippedQty}] */
  shippedItems?: { productId: string; name?: string; shippedQty: number }[];
  /** Количество товара, запланированное к доставке: [{productId, name, quantity}] */
  deliveryItems?: { productId: string; name: string; quantity: number }[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type BankPaymentType =
  | "regular"
  | "refund"
  | "cash"
  | "transfer"
  | "deposit";

export interface BankPayment {
  id: string;
  number: number;
  date: string;
  direction: "incoming" | "outgoing";
  type?: BankPaymentType;
  counterparty: string;
  counterpartyId?: string | null;
  dealIds: string[];
  dealNumbers: number[];
  receiptIds: string[];
  receiptNumbers: number[];
  amount: number;
  invoiceNumber?: string | null;
  vatRate: number;
  vatAmount: number;
  isPaid: boolean;
  /** Если true, платёж проведён, но не учитывается в текущем балансе (старый учёт) */
  excludeFromBalance?: boolean;
  paidAt?: string | null;
  comment?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface WarehouseStockRow {
  id: string;
  name: string;
  sku: string | null;
  stockQty: number;
  stockWarnQty?: number | null;
  inStock: boolean;
  price: number | null;
  priceWholesale: number | null;
  isVisible: boolean;
  /** Габариты товара в мм (или в иных единицах из dimensionUnit).
   *  Подхватываются в ревизию склада, чтобы кладовщик мог
   *  пересчитать остатки по позициям и сразу видеть, что именно
   *  он считает — ящик 670×370×370, а не абстрактный SKU. */
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
}

export interface CounterpartyBalance {
  name: string;
  type: "customer" | "supplier";
  docsTotal: number;
  paidTotal: number;
  balance: number;
  lastPaymentDate: string | null;
  docsCount: number;
}

/** Сотрудник для учёта зарплат */
export interface Employee {
  id: string;
  name: string;
  position?: string | null;
  phone?: string | null;
  comment?: string | null;
  createdAt?: string | null;
}

/** Счёт, с которого выплачивается зарплата */
export type SalarySource = "cash" | "bank";

/** Начисление/выплата зарплаты сотруднику */
export interface Salary {
  id: string;
  employeeId: string | null;
  employeeName: string;
  amount: number;
  date: string;
  /** cash = касса (наличные), bank = расчётный счёт (безнал) */
  source: SalarySource;
  isPaid: boolean;
  paidAt?: string | null;
  comment?: string | null;
  createdAt?: string | null;
}

/** Служебные теги в комментарии зарплаты. */
export const SALARY_RENT_TAG = "[Аренда]";
export const SALARY_EXCLUDE_BALANCE_TAG = "[Вне баланса]";
export const SALARY_DEBT_PAYMENT_TAG = "[Долг]";

function salaryHasTag(comment: string | null | undefined, tag: string): boolean {
  return (comment || "").includes(tag);
}

/** Выплата прошла по схеме «с аренды на карту». */
export function isRentSalaryComment(comment: string | null | undefined): boolean {
  return salaryHasTag(comment, SALARY_RENT_TAG);
}

/** Историческая выплата: показывается в ЗП, но не влияет на текущий баланс. */
export function isSalaryExcludedFromBalance(comment: string | null | undefined): boolean {
  return salaryHasTag(comment, SALARY_EXCLUDE_BALANCE_TAG);
}

/** Выплата относится к долгу, а не к зарплате текущего месяца. */
export function isDebtSalaryComment(comment: string | null | undefined): boolean {
  return salaryHasTag(comment, SALARY_DEBT_PAYMENT_TAG);
}

/** Убирает служебные теги из комментария для отображения в UI. */
export function stripSalaryMetaTags(comment: string | null | undefined): string {
  return String(comment || "")
    .replaceAll(SALARY_RENT_TAG, "")
    .replaceAll(SALARY_EXCLUDE_BALANCE_TAG, "")
    .replaceAll(SALARY_DEBT_PAYMENT_TAG, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Собирает комментарий зарплаты с нужными служебными тегами. */
export function composeSalaryComment(options: {
  comment?: string | null;
  rent?: boolean;
  excludeFromBalance?: boolean;
  debtPayment?: boolean;
}): string | null {
  const tags: string[] = [];
  if (options.rent) tags.push(SALARY_RENT_TAG);
  if (options.excludeFromBalance) tags.push(SALARY_EXCLUDE_BALANCE_TAG);
  if (options.debtPayment) tags.push(SALARY_DEBT_PAYMENT_TAG);
  const clean = stripSalaryMetaTags(options.comment);
  const joined = [...tags, clean].filter(Boolean).join(" ").trim();
  return joined || null;
}

/**
 * Куда уходит наличный платёж при сдаче кассы:
 *  - "card" — инкассация на карту (по умолчанию Юлия Марковна);
 *  - "cash" — наличными (виртуальная карта «наличка», куда уходит сданная касса).
 *
 * Это НЕ способ поступления денег и НЕ основной расчётный счёт: безналичный
 * счёт в банке к кассе не относится и в сдаче не участвует вообще.
 * Значение "transfer" — устаревший псевдоним "card" (старые записи в БД).
 */
export type CashKind = "cash" | "card";

/** Ключ настройки с ФИО получателя инкассации на карту. */
export const CASH_CARD_HOLDER_SETTING_KEY = "cash_collection_card_holder";

/** Получатель инкассации на карту по умолчанию (меняется в настройках). */
export const DEFAULT_CASH_CARD_HOLDER = "Юлия Марковна";

/** Приводит значение из БД/клиента к актуальному виду направления сдачи. */
export function normalizeCashKind(raw: unknown): CashKind {
  return raw === "card" || raw === "transfer" ? "card" : "cash";
}

/** Платёж, вошедший в сдачу кассы, с пометкой «куда ушёл». */
export interface CashCollectionItem {
  paymentId: string;
  number?: number | null;
  counterparty?: string | null;
  /** Полная сумма платежа */
  amount: number;
  /** Преобладающее направление (для совместимости со старыми записями) */
  kind: CashKind;
  /** Сколько из платежа осталось наличными */
  cashAmount?: number;
  /** Сколько из платежа ушло инкассацией на карту */
  cardAmount?: number;
  /** Сколько из платежа забрали на расходы (ЗП и прочее) */
  expenseAmount?: number;
}

/** Наличный расход, вычтенный при сдаче кассы (ЗП или платёж налом). */
export interface CashCollectionExpense {
  kind: "salary" | "payment";
  id: string;
  title: string;
  amount: number;
  comment?: string | null;
}

/** Сдача кассы (инкассация): списание остатка наличных из кассы */
export interface CashCollection {
  id: string;
  /** Дата сдачи (YYYY-MM-DD) */
  date: string;
  /** Общая сумма, сданная из кассы (наличные + перевод) */
  amount: number;
  /** Часть, сданная наличными (виртуальная карта «наличка») */
  cashAmount?: number;
  /** Часть, сданная инкассацией на карту (к расчётному счёту не относится) */
  transferAmount?: number;
  /** Разметка платежей, вошедших в сдачу */
  items?: CashCollectionItem[];
  /** Наличные траты этого дня, вычтенные из суммы сдачи */
  expenses?: CashCollectionExpense[];
  /** Приход за день до вычета трат */
  incomeAmount?: number;
  /** Сумма трат налом, вычтенная из прихода */
  expensesAmount?: number;
  note?: string | null;
  createdAt?: string | null;
}

function normalizeName(name: string): string {
  return (name || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[«»"']/g, "")
    .replace(/\s+/g, " ");
}

// ─── Отгрузка: единые расчёты «заказано / отгружено / остаток» ──────
// Используются и на сервере (списание склада, синхронизация перевозок),
// и на клиенте (списки доставок, модалка перевозки), чтобы цифры везде
// совпадали.

export interface ShippedEntry {
  productId: string;
  name?: string;
  shippedQty: number;
}

/** productId → сколько всего уже отгружено по заказу (кумулятивно). */
export function shippedQtyMap(
  shippedItems: ShippedEntry[] | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of Array.isArray(shippedItems) ? shippedItems : []) {
    const id = String(s?.productId || "");
    if (!id) continue;
    map.set(id, (map.get(id) || 0) + (Number(s?.shippedQty) || 0));
  }
  return map;
}

/** productId → сколько всего заказано (дубли строк складываются). */
export function orderedQtyMap(
  items: { productId: string; quantity: number }[] | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of Array.isArray(items) ? items : []) {
    const id = String(it?.productId || "");
    if (!id) continue;
    map.set(id, (map.get(id) || 0) + (Number(it?.quantity) || 0));
  }
  return map;
}

/** Остаток к отгрузке по каждой позиции заказа. */
export function dealRemainingItems(
  items: { productId: string; name?: string; quantity: number }[] | null | undefined,
  shippedItems: ShippedEntry[] | null | undefined
): { productId: string; name: string; ordered: number; shipped: number; remaining: number }[] {
  const ordered = orderedQtyMap(items);
  const shipped = shippedQtyMap(shippedItems);
  const names = new Map<string, string>();
  for (const it of Array.isArray(items) ? items : []) {
    const id = String(it?.productId || "");
    if (id && !names.has(id)) names.set(id, String(it?.name || ""));
  }
  return [...ordered.entries()].map(([productId, orderedQty]) => {
    const shippedQty = shipped.get(productId) || 0;
    return {
      productId,
      name: names.get(productId) || "",
      ordered: orderedQty,
      shipped: shippedQty,
      remaining: Math.max(0, orderedQty - shippedQty),
    };
  });
}

/** Сколько единиц товара по заказу ещё не отгружено (долг перед клиентом). */
export function dealRemainingQty(
  items: { productId: string; quantity: number }[] | null | undefined,
  shippedItems: ShippedEntry[] | null | undefined
): number {
  return dealRemainingItems(items, shippedItems).reduce(
    (sum, row) => sum + row.remaining,
    0
  );
}

/**
 * Заказ отгружен полностью — долга перед клиентом нет.
 * Заказ без позиций полностью отгруженным не считается.
 */
export function isDealFullyShipped(
  items: { productId: string; quantity: number }[] | null | undefined,
  shippedItems: ShippedEntry[] | null | undefined
): boolean {
  const rows = dealRemainingItems(items, shippedItems);
  if (rows.length === 0) return false;
  return rows.every((row) => row.remaining <= 0);
}

/**
 * Нужно ли ещё везти заказ — единый критерий для всех списков доставки.
 *
 * Показываем, только пока есть долг по товару:
 *   • полностью отгружен (остатков нет) → заказ закрыт, в доставке не нужен;
 *   • отгружен частично                 → остаётся, надо довезти остаток;
 *   • отменён                           → не нужен.
 *
 * Важно: этим предикатом обязаны пользоваться ВСЕ места, где строится
 * список доставок. Раньше вкладка «Учёт → Доставки» фильтровала заказы
 * сама (`d.hasDelivery && …`) и показывала уже отпущенные.
 */
export function dealNeedsDelivery(deal: {
  hasDelivery?: boolean | null;
  status?: string | null;
  items?: { productId: string; quantity: number }[] | null;
  shippedItems?: ShippedEntry[] | null;
}): boolean {
  if (!deal.hasDelivery) return false;
  if (deal.status === "cancelled") return false;

  const items = Array.isArray(deal.items) ? deal.items : [];
  // Заказ без позиций (например, только услуга доставки): ориентируемся
  // на статус — проведённый считаем закрытым.
  if (items.length === 0) return deal.status !== "completed";

  return dealRemainingQty(items, deal.shippedItems) > 0;
}

/** Сводка по банку (и кассе). Выплаченные зарплаты списываются с того
 *  счёта, откуда платили (касса/безнал); ожидающие — в «к оплате». */
export function getBankSummary(
  payments: BankPayment[],
  salaries: Salary[] = [],
  collections: CashCollection[] = []
) {
  let bankBalance = 0;
  let cashBalance = 0;
  let expectedIn = 0;
  let expectedOut = 0;
  for (const p of payments) {
    // Платёж «вне баланса» не имеет отношения к текущему банку/кассе:
    // не учитываем его ни в факте, ни в ожидаемых оплатах.
    if (p.excludeFromBalance) continue;

    if (p.isPaid) {
      const amt = p.direction === "incoming" ? p.amount : -p.amount;
      if (p.type === "cash") cashBalance += amt;
      else bankBalance += amt;
    } else {
      if (p.direction === "incoming") expectedIn += p.amount;
      else expectedOut += p.amount;
    }
  }
  // Зарплаты — это расход: выплаченные уменьшают кассу/банк,
  // начисленные, но ещё не выплаченные — это долг «к оплате».
  for (const s of salaries) {
    const bypassBalance = isSalaryExcludedFromBalance(s.comment);
    if (s.isPaid) {
      if (bypassBalance) continue;
      if (s.source === "cash") cashBalance -= s.amount;
      else bankBalance -= s.amount;
    } else {
      if (bypassBalance) continue;
      expectedOut += s.amount;
    }
  }
  // Сдача кассы: деньги уходят из текущей кассы в отдельный журнал сдач.
  // В безналичный банковский счёт их НЕ прибавляем — ни наличную часть,
  // ни инкассацию на карту: расчётный счёт к кассе отношения не имеет.
  let collectedCash = 0;
  let collectedCashOnly = 0;
  let collectedTransfer = 0;
  for (const c of collections) {
    cashBalance -= c.amount;
    collectedCash += c.amount;
    // Старые записи без разбивки считаем полностью наличными.
    const transfer = Number(c.transferAmount) || 0;
    const cashPart =
      c.cashAmount != null ? Number(c.cashAmount) || 0 : c.amount - transfer;
    collectedCashOnly += cashPart;
    collectedTransfer += transfer;
  }
  return {
    balance: bankBalance + cashBalance,
    bankBalance,
    cashBalance,
    /**
     * Касса ушла в минус — так быть не должно. Обычно это значит, что
     * приход, который покрывала старая сдача кассы, сменил тип на
     * безналичный: сдача продолжает вычитать сумму, а прихода в кассе
     * уже нет. Показываем предупреждение вместо тихой поломки цифр.
     */
    cashBalanceNegative: cashBalance < -0.009,
    collectedCash,
    /** Из сданного — наличными (виртуальная карта «наличка») */
    collectedCashOnly,
    /** Из сданного — инкассацией на карту (вне расчётного счёта) */
    collectedTransfer,
    expectedIn,
    expectedOut,
  };
}

/**
 * Сводка по уже сданной кассе: сколько ушло наличными, сколько на карту.
 *
 * Важно: направление сдачи (карта/наличка) проставляется вручную в момент
 * сдачи кассы, а не берётся из типа платежа. Тип "transfer" в банке
 * означает другое — исходящий перевод физлицу с расчётного счёта.
 * Поле `transfer` здесь = инкассация на карту.
 */
export function getCollectedBreakdown(
  collections: CashCollection[] = []
): { cash: number; transfer: number; total: number } {
  let cash = 0;
  let transfer = 0;
  for (const c of collections) {
    const t = Number(c.transferAmount) || 0;
    // Старые сдачи без разбивки считаем полностью наличными.
    const cashPart =
      c.cashAmount != null ? Number(c.cashAmount) || 0 : (c.amount || 0) - t;
    cash += cashPart;
    transfer += t;
  }
  return {
    cash: Math.round(cash * 100) / 100,
    transfer: Math.round(transfer * 100) / 100,
    total: Math.round((cash + transfer) * 100) / 100,
  };
}

/**
 * Оплачено по каждому заказу (id → сумма проведённых входящих платежей).
 * Платежи «вне баланса» тоже закрывают документ, но не влияют на банк/кассу
 * в getBankSummary. Так старые/архивные оплаты не создают ложный долг и
 * экстренные уведомления «отпущено без оплаты».
 */
export function getDealPaidMap(payments: BankPayment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    if (!p.isPaid || p.direction !== "incoming") continue;
    if (!p.dealIds || p.dealIds.length === 0) continue;
    
    const share = p.amount / p.dealIds.length;
    for (const dealId of p.dealIds) {
      map.set(dealId, (map.get(dealId) || 0) + share);
    }
  }
  return map;
}

/**
 * Оплачено по каждому поступлению (id → сумма проведённых исходящих).
 * «Вне баланса» закрывает документ, но не меняет текущий банк/кассу.
 */
export function getReceiptPaidMap(payments: BankPayment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    if (!p.isPaid || p.direction !== "outgoing") continue;
    if (!p.receiptIds || p.receiptIds.length === 0) continue;
    
    const share = p.amount / p.receiptIds.length;
    for (const receiptId of p.receiptIds) {
      map.set(receiptId, (map.get(receiptId) || 0) + share);
    }
  }
  return map;
}

/** Долги по контрагентам на основании непроведённых платежей банка. */
export function getPendingPaymentCounterpartyBalances(
  payments: BankPayment[]
): CounterpartyBalance[] {
  const result = new Map<string, CounterpartyBalance>();

  const getRow = (name: string, type: "customer" | "supplier") => {
    const norm = normalizeName(name);
    if (!norm) return null;
    const key = `${type}:${norm}`;
    if (!result.has(key)) {
      result.set(key, {
        name: name.trim(),
        type,
        docsTotal: 0,
        paidTotal: 0,
        balance: 0,
        lastPaymentDate: null,
        docsCount: 0,
      });
    }
    return result.get(key)!;
  };

  for (const p of payments) {
    if (p.isPaid) continue;
    if (p.excludeFromBalance) continue;
    if (!p.counterparty || p.amount <= 0) continue;

    const hasDealLink = p.dealIds && p.dealIds.length > 0;
    const hasReceiptLink = p.receiptIds && p.receiptIds.length > 0;
    let type: "customer" | "supplier";
    if (hasDealLink) type = "customer";
    else if (hasReceiptLink) type = "supplier";
    else type = p.direction === "outgoing" ? "supplier" : "customer";

    const row = getRow(p.counterparty, type);
    if (!row) continue;

    // Для покупателей положительный баланс = должны нам (ожидаемый приход).
    // Для поставщиков положительный баланс = мы должны (ожидаемый расход).
    if (type === "customer") {
      if (p.direction === "incoming") row.docsTotal += p.amount;
      else row.paidTotal += p.amount;
    } else {
      if (p.direction === "outgoing") row.docsTotal += p.amount;
      else row.paidTotal += p.amount;
    }

    row.docsCount += 1;
    if (!row.lastPaymentDate || p.date > row.lastPaymentDate) {
      row.lastPaymentDate = p.date;
    }
  }

  const list = [...result.values()].map((row) => ({
    ...row,
    docsTotal: Math.round(row.docsTotal * 100) / 100,
    paidTotal: Math.round(row.paidTotal * 100) / 100,
    balance: Math.round((row.docsTotal - row.paidTotal) * 100) / 100,
  }));

  list.sort((a, b) => {
    const aDebt = a.balance > 0.009 ? 1 : 0;
    const bDebt = b.balance > 0.009 ? 1 : 0;
    if (aDebt !== bDebt) return bDebt - aDebt;
    return a.name.localeCompare(b.name, "ru");
  });

  return list;
}

export function getCounterpartyBalances(
  deals: CustomerDeal[],
  receipts: WarehouseReceipt[],
  payments: BankPayment[]
): CounterpartyBalance[] {
  const result = new Map<string, CounterpartyBalance>();

  const getRow = (name: string, type: "customer" | "supplier") => {
    const norm = normalizeName(name);
    if (!norm) return null;
    const key = `${type}:${norm}`;
    if (!result.has(key)) {
      result.set(key, {
        name: name.trim(),
        type,
        docsTotal: 0,
        paidTotal: 0,
        balance: 0,
        lastPaymentDate: null,
        docsCount: 0,
      });
    }
    return result.get(key)!;
  };

  const activeDealIds = new Set<string>();
  const receiptIds = new Set<string>();

  // 1. Process all documents
  for (const d of deals) {
    if (d.status === "cancelled") continue;
    activeDealIds.add(d.id);
    const row = getRow(d.customerName, "customer");
    if (row) {
      row.docsTotal += d.total;
      row.docsCount += 1;
    }
  }
  for (const r of receipts) {
    receiptIds.add(r.id);
    if (!r.supplier) continue;
    const row = getRow(r.supplier, "supplier");
    if (row) {
      row.docsTotal += r.total;
      row.docsCount += 1;
    }
  }

  // 2. Process ALL paid payments for debt balance.
  // В долг контрагента идут ВСЕ проведённые платежи, в том числе не
  // привязанные к документам (расходы, прочие выплаты). Платежи с пометкой
  // «вне баланса» (excludeFromBalance) исключаем — это старый/архивный учёт,
  // который не должен влиять на текущий долг.
  for (const p of payments) {
    if (!p.isPaid) continue;
    if (p.excludeFromBalance) continue;

    const hasDealLink = p.dealIds && p.dealIds.length > 0;
    const hasReceiptLink = p.receiptIds && p.receiptIds.length > 0;

    const normName = normalizeName(p.counterparty);
    if (!normName) continue;

    // Роль контрагента: по привязке, иначе по направлению платежа.
    // Исходящий без привязки — это расход у поставщика;
    // входящий без привязки — поступление от покупателя.
    let type: "customer" | "supplier";
    if (hasDealLink) type = "customer";
    else if (hasReceiptLink) type = "supplier";
    else type = p.direction === "outgoing" ? "supplier" : "customer";

    const row = getRow(p.counterparty, type);
    if (!row) continue;

    const amount = p.amount;
    if (type === "customer") {
      row.paidTotal += (p.direction === "incoming" ? amount : -amount);
    } else {
      row.paidTotal += (p.direction === "outgoing" ? amount : -amount);
    }

    const payDate = p.paidAt || p.date;
    if (!row.lastPaymentDate || payDate > row.lastPaymentDate) {
      row.lastPaymentDate = payDate;
    }
  }

  // 3. Добавляем непроведённые платежи без действующего документа.
  // Документы уже дают долг (docsTotal - paidTotal), поэтому платежи,
  // привязанные к существующему заказу/поступлению, второй раз не считаем.
  // А вот самостоятельные ожидающие оплаты должны быть видны в блоках
  // «Покупатели должны нам» / «Поставщики мы должны».
  for (const p of payments) {
    if (p.isPaid) continue;
    if (p.excludeFromBalance) continue;

    const hasActiveDealLink =
      Array.isArray(p.dealIds) && p.dealIds.some((id) => activeDealIds.has(id));
    const hasReceiptLink =
      Array.isArray(p.receiptIds) && p.receiptIds.some((id) => receiptIds.has(id));
    if (hasActiveDealLink || hasReceiptLink) continue;

    const normName = normalizeName(p.counterparty);
    if (!normName) continue;

    const hasAnyDealLink = p.dealIds && p.dealIds.length > 0;
    const hasAnyReceiptLink = p.receiptIds && p.receiptIds.length > 0;
    let type: "customer" | "supplier";
    if (hasAnyDealLink) type = "customer";
    else if (hasAnyReceiptLink) type = "supplier";
    else type = p.direction === "outgoing" ? "supplier" : "customer";

    const row = getRow(p.counterparty, type);
    if (!row) continue;

    const amount = p.amount;
    if (type === "customer") {
      if (p.direction === "incoming") row.docsTotal += amount;
      else row.paidTotal += amount;
    } else {
      if (p.direction === "outgoing") row.docsTotal += amount;
      else row.paidTotal += amount;
    }
    row.docsCount += 1;
    if (!row.lastPaymentDate || p.date > row.lastPaymentDate) {
      row.lastPaymentDate = p.date;
    }
  }

  const list = [...result.values()].map((row) => ({
    ...row,
    docsTotal: Math.round(row.docsTotal * 100) / 100,
    paidTotal: Math.round(row.paidTotal * 100) / 100,
    balance: Math.round((row.docsTotal - row.paidTotal) * 100) / 100,
  }));

  // Sort: Debtors first (balance > 0.009), then name
  list.sort((a, b) => {
    const aDebt = a.balance > 0.009 ? 1 : 0;
    const bDebt = b.balance > 0.009 ? 1 : 0;
    if (aDebt !== bDebt) return bDebt - aDebt;
    return a.name.localeCompare(b.name, "ru");
  });
  
  return list;
}
