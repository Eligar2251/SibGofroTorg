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
  /** 
   * Базовое кол-во для списания склада — в рулонах/шт (может быть дробным 5.9).
   * Для резаных товаров: если продажа в метрах, сюда попадает base = meters / metersPerRoll
   */
  quantity: number;
  price: number;
  lineTotal: number;
  // ── Вариативность рулон / метры ──
  /** Единица продажи: roll | meter | piece (по умолчанию roll/piece) */
  unit?: 'roll' | 'meter' | 'piece' | null;
  /** Метров в рулоне на момент продажи (снапшот) */
  metersPerRoll?: number | null;
  /** Исходное кол-во в единице продажи (напр. 10 метров) */
  saleQuantity?: number | null;
  /** Цена за единицу продажи (напр. за метр) */
  salePrice?: number | null;
  /** Единица отмотки подпись, напр. 'м' */
  cutUnitName?: string | null;
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
  /** Вариант цены контрагента: обычный / спец (скидка) / эксклюзив (скидка больше). */
  priceTier?: PriceTier;
  comment?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// ── Варианты цен (ценовые уровни контрагентов) ──────────────
// «Обычная» — цена как в карточке товара (все по умолчанию).
// «Спец» и «Эксклюзив» — скидка от цены продажи; проценты задаются
// в настройках админки (price_tier_special_discount /
// price_tier_exclusive_discount) и применяются при оформлении заказа.
export type PriceTier = "regular" | "special" | "exclusive";

export const PRICE_TIER_IDS: readonly PriceTier[] = ["regular", "special", "exclusive"];

export function normalizePriceTier(value: unknown): PriceTier {
  return value === "special" || value === "exclusive" ? value : "regular";
}

/** Скидки уровней из настроек (дефолты: спец 5%, эксклюзив 10%). */
export function getPriceTierDiscounts(
  settings: Record<string, string | undefined> | null | undefined
): { special: number; exclusive: number } {
  const parse = (raw: string | undefined, fallback: number) => {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return fallback;
    const n = Number(trimmed.replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : fallback;
  };
  return {
    special: parse(settings?.price_tier_special_discount, 5),
    exclusive: parse(settings?.price_tier_exclusive_discount, 10),
  };
}

export function priceTierDiscountPercent(
  tier: PriceTier | null | undefined,
  discounts: { special: number; exclusive: number }
): number {
  if (tier === "special") return discounts.special;
  if (tier === "exclusive") return discounts.exclusive;
  return 0;
}

/** Цена со скидкой уровня (округление до копеек). */
export function applyTierDiscount(price: number, discountPercent: number): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  const pct = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}

export type ReceiptStatus = "draft" | "posted";

/** Ручная продажа товара на реализации (плюс к автоподсчёту по отгрузкам). */
export interface ConsignmentManualSale {
  id: string;
  receiptId: string;
  productId: string;
  productName: string;
  quantity: number;
  comment?: string | null;
  updatedAt?: string | null;
}

export interface WarehouseReceipt extends CounterpartyDetails {
  id: string;
  number: number;
  date: string;
  supplier: string;
  status: ReceiptStatus;
  counterpartyId?: string | null;
  comment?: string | null;
  /** Поставка товара на реализацию: продажи учитываются по закупочной цене. */
  isConsignment?: boolean;
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
  /** Выставлен счёт / товар зарезервирован за клиентом. */
  isReserved?: boolean;
  /** Есть ли доставка у заказа учёта */
  hasDelivery?: boolean;
  deliveryType?: "free" | "paid" | null;
  deliveryCost?: number | null;
  deliveryAddress?: string | null;
  deliveryPlannedDate?: string | null;
  deliveryReleasedAt?: string | null;
  deliveryNote?: string | null;
  deliveryContact?: string | null;
  deliveryPhone?: string | null;
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
  | "deposit"
  | "ym_card";

export interface BankPayment {
  id: string;
  number: number;
  date: string;
  direction: "incoming" | "outgoing";
  type?: BankPaymentType;
  /** Предвыбор сдачи кассы для наличного входящего платежа. */
  cashDestination?: CashKind | null;
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
  purchasePrice?: number | null;
  isVisible: boolean;
  // Вариативность
  isCuttable?: boolean | null;
  cutMetersPerRoll?: number | null;
  cutPricePerMeter?: number | null;
  cutUnitName?: string | null;
  /** Габариты товара в мм (или в иных единицах из dimensionUnit).
   *  Подхватываются в ревизию склада, чтобы кладовщик мог
   *  пересчитать остатки по позициям и сразу видеть, что именно
   *  он считает — ящик 670×370×370, а не абстрактный SKU. */
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
}

 // ── Хелперы для резаных товаров ──
export function getCuttableBreakdown(stockRolls: number, metersPerRoll: number | null | undefined) {
  const rolls = Math.max(0, Number(stockRolls) || 0);
  const mpr = Math.max(0, Number(metersPerRoll) || 0);
  if (!mpr) return { fullRolls: Math.floor(rolls), remainderMeters: 0, totalMeters: rolls, rolls };
  const fullRolls = Math.floor(rolls + 1e-9);
  const remainderMeters = Math.round((rolls - fullRolls) * mpr * 100) / 100;
  const totalMeters = Math.round(rolls * mpr * 100) / 100;
  return { fullRolls, remainderMeters, totalMeters, rolls };
}

export function formatCuttableStock(stockRolls: number, metersPerRoll: number | null | undefined, unitName?: string | null) {
  const { fullRolls, remainderMeters, totalMeters } = getCuttableBreakdown(stockRolls, metersPerRoll);
  const u = unitName || 'м';
  if (!metersPerRoll) return `${Number(stockRolls || 0).toLocaleString('ru-RU')} шт.`;
  if (remainderMeters > 0.009) return `${fullRolls} рул. + ${remainderMeters} ${u} (${totalMeters} ${u} всего)`;
  return `${fullRolls} рул. · ${totalMeters} ${u}`;
}

export function getStockItemBaseQuantity(item: { quantity?: number; baseQuantity?: number; saleQuantity?: number; unit?: string | null; metersPerRoll?: number | null } & any): number {
  if (item == null) return 0;
  // quantity уже base
  const q = Number(item.quantity);
  if (Number.isFinite(q) && q > 0) return q;
  // fallback: saleQuantity / mpr
  if (item.unit === 'meter' && item.metersPerRoll) {
    const sale = Number(item.saleQuantity);
    const mpr = Number(item.metersPerRoll);
    if (sale > 0 && mpr > 0) return sale / mpr;
  }
  return 0;
}

export function getStockItemDisplaySale(item: StockDocItem): { saleQty: number; unit: 'roll'|'meter'|'piece'; pricePerSale: number; metersPerRoll?: number | null } {
  const base = Number(item.quantity) || 0;
  const isRoll = (item.unit as any) === 'roll' && Boolean((item as any).isCuttable || item.metersPerRoll);
  const unit = (item.unit as any) === 'meter' ? 'meter' : isRoll ? 'roll' : 'piece';
  const mpr = item.metersPerRoll != null ? Number(item.metersPerRoll) : null;
  const saleQty = item.saleQuantity != null ? Number(item.saleQuantity) : (unit === 'meter' && mpr ? base * mpr : base);
  const pricePerSale = item.salePrice != null ? Number(item.salePrice) : Number(item.price) || 0;
  return { saleQty, unit, pricePerSale, metersPerRoll: mpr };
}


/** Строка поступления в расширенной складской сводке товара. */
export interface ProductStockReceiptHistory {
  id: string;
  number: number;
  date: string;
  supplier: string;
  status: ReceiptStatus;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** Строка заказа в расширенной складской сводке товара. */
export interface ProductStockDealHistory {
  id: string;
  number: number;
  date: string;
  customerName: string;
  status: DealStatus;
  orderedQty: number;
  shippedQty: number;
  /** Сколько ещё нужно отгрузить. Для отменённого заказа всегда 0. */
  remainingQty: number;
  unitPrice: number;
}

/**
 * Полная история одной складской позиции.
 *
 * `ownStockQty` — расчётный остаток, который не объясняется проведёнными
 * поступлениями: текущий остаток + все отгрузки − проведённые поступления.
 * Положительное значение показываем как «Наши остатки» (товар внесли
 * вручную/он был до начала учёта), отрицательное — как недостачу по учёту.
 */
export interface ProductStockSummary {
  productId: string;
  productName: string;
  sku: string | null;
  /** Общая закупочная цена из карточки товара — фолбэк для маржи,
      когда поставок по товару ещё нет. */
  purchasePrice?: number | null;
  currentStockQty: number;
  receipts: ProductStockReceiptHistory[];
  deals: ProductStockDealHistory[];
  postedReceiptQty: number;
  draftReceiptQty: number;
  orderedQty: number;
  shippedQty: number;
  pendingOrderQty: number;
  /** Нехватка текущего остатка для всех ещё не отгруженных заказов. */
  shortageQty: number;
  /** Ручной/начальный остаток; отрицательное значение = расхождение. */
  ownStockQty: number;
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
export type SalarySource = "cash" | "bank" | "ym_card";

/** Начисление/выплата зарплаты сотруднику */
export interface Salary {
  id: string;
  employeeId: string | null;
  employeeName: string;
  amount: number;
  /** Плановая/фактическая дата выплаты. */
  date: string;
  /** Расчётный месяц зарплаты (YYYY-MM), может отличаться от даты выплаты. */
  periodMonth?: string | null;
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
export const SALARY_YM_CARD_TAG = "[Карта ЮМ]";
export const SALARY_YM_CARD_TAG_SHORT = "[ЮМ]";
/** Расчётный месяц хранится служебной пометкой — миграция БД не нужна. */
export const SALARY_PERIOD_TAG_PREFIX = "Период:";
const SALARY_PERIOD_TAG_RE = /\[Период:(\d{4}-\d{2})\]/g;

function salaryHasTag(comment: string | null | undefined, tag: string): boolean {
  return (comment || "").includes(tag);
}

/** Выплата прошла по схеме «с аренды на карту» или с source="bank" (зп с р/с банка не платится, только аренда). */
export function isRentSalaryComment(comment: string | null | undefined, source?: string | null): boolean {
  return salaryHasTag(comment, SALARY_RENT_TAG) || source === "bank";
}

/** Историческая выплата: показывается в ЗП, но не влияет на текущий баланс. */
export function isSalaryExcludedFromBalance(comment: string | null | undefined): boolean {
  return salaryHasTag(comment, SALARY_EXCLUDE_BALANCE_TAG);
}

/** Выплата относится к долгу, а не к зарплате текущего месяца. */
export function isDebtSalaryComment(comment: string | null | undefined): boolean {
  return salaryHasTag(comment, SALARY_DEBT_PAYMENT_TAG);
}

/**
 * Расчётный месяц зарплаты. Для старых записей без пометки совпадает с
 * месяцем даты — их учёт остаётся ровно таким, каким был раньше.
 */
export function getSalaryPeriodMonth(
  comment: string | null | undefined,
  fallbackDate?: string | null
): string {
  const match = String(comment || "").match(/\[Период:(\d{4}-\d{2})\]/);
  if (match?.[1]) return match[1];
  return String(fallbackDate || "").slice(0, 7);
}

/** Убирает служебные теги из комментария для отображения в UI. */
export function stripSalaryMetaTags(comment: string | null | undefined): string {
  return String(comment || "")
    .replaceAll(SALARY_RENT_TAG, "")
    .replaceAll(SALARY_EXCLUDE_BALANCE_TAG, "")
    .replaceAll(SALARY_DEBT_PAYMENT_TAG, "")
    .replaceAll(SALARY_YM_CARD_TAG, "")
    .replaceAll(SALARY_YM_CARD_TAG_SHORT, "")
    .replace(SALARY_PERIOD_TAG_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Собирает комментарий зарплаты с нужными служебными тегами. */
export function composeSalaryComment(options: {
  comment?: string | null;
  rent?: boolean;
  excludeFromBalance?: boolean;
  debtPayment?: boolean;
  ymCard?: boolean;
  /** Расчётный месяц YYYY-MM: например, выплата в июле за июнь. */
  periodMonth?: string | null;
}): string | null {
  const tags: string[] = [];
  if (options.rent) tags.push(SALARY_RENT_TAG);
  if (options.excludeFromBalance) tags.push(SALARY_EXCLUDE_BALANCE_TAG);
  if (options.debtPayment) tags.push(SALARY_DEBT_PAYMENT_TAG);
  if (options.ymCard) tags.push(SALARY_YM_CARD_TAG);
  if (/^\d{4}-\d{2}$/.test(options.periodMonth || "")) {
    tags.push(`[${SALARY_PERIOD_TAG_PREFIX}${options.periodMonth}]`);
  }
  const clean = stripSalaryMetaTags(options.comment);
  const joined = [...tags, clean].filter(Boolean).join(" ").trim();
  return joined || null;
}

/**
 * Куда относится наличный платёж при закрытии смены:
 *  - "card" — инкассация на карту (по умолчанию Юлия Марковна), эта часть
 *    физически уходит из кассы;
 *  - "cash" — остаётся наличными в кассе и переносится на следующий день.
 *
 * Это НЕ способ поступления денег и НЕ основной расчётный счёт: безналичный
 * счёт в банке к кассе не относится и в закрытии смены не участвует.
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
  /** Старый платёж скрыт из сдачи без движения по кассе. */
  noAccounting?: boolean;
}

/** Наличный расход, вычтенный при сдаче кассы (ЗП или платёж налом). */
export interface CashCollectionExpense {
  kind: "salary" | "payment";
  id: string;
  title: string;
  amount: number;
  comment?: string | null;
}

/** Закрытие смены кассы: инкассация на карту + перенос наличного остатка */
export interface CashCollection {
  id: string;
  /** Дата закрытия смены (YYYY-MM-DD) */
  date: string;
  /** Общая размеченная сумма смены (перенос наличных + инкассация) */
  amount: number;
  /** Часть, оставленная наличными в кассе для переноса на следующий день */
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

export function normalizeName(name: string): string {
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

export interface CashCarryoverOrigin {
  paymentId: string;
  number: number;
  date: string;
  counterparty: string;
  originalAmount: number;
  remainingAmount: number;
}

export interface CashCarryoverSummary {
  date: string;
  /** Остаток на начало выбранного дня. */
  openingBalance: number;
  todayIncoming: number;
  todayOutgoing: number;
  todayCardTransfers: number;
  /** Текущий остаток кассы по всем проведённым движениям. */
  currentBalance: number;
  /** Сколько текущего остатка пришло до выбранного дня. */
  previousDaysRemaining: number;
  origins: CashCarryoverOrigin[];
}

function collectionCashOutflow(collection: CashCollection): number {
  // У новых смен из кассы уходит только перевод на карту. У действительно
  // старых записей без поля разбивки сохраняем прежнее списание всей суммы.
  return collection.cashAmount != null
    ? Math.max(0, Number(collection.transferAmount) || 0)
    : Math.max(0, Number(collection.amount) || 0);
}

/** Платеж, который сразу должен попадать в карту ЮМ, минуя кассу. */
export function isImmediateYmPayment(p: BankPayment | null | undefined): boolean {
  if (!p) return false;
  if (p.type === "transfer") return true;
  if (p.type === "cash" && p.cashDestination === "card") return true;
  return false;
}

/** Платеж, который считается наличкой в кассе (только регулярная наличка). */
function isRegularCashForCashDesk(p: BankPayment): boolean {
  if (!p.isPaid || p.excludeFromBalance) return false;
  if (p.type !== "cash") return false;
  if (p.amount <= 0) return false;
  if (p.direction === "incoming" && p.cashDestination === "card") return false;
  return true;
}

/** Рабочая дата компании — Новосибирск, а не UTC сервера/Vercel. */
export function getWarehouseBusinessDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Novosibirsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/**
 * Детальный кассовый регистр: остаток, перенос с прошлых дней и источники.
 *
 * Инкассация по возможности гасит именно те платежи, которые в закрытии
 * смены помечены «на карту». Остальные расходы списываются FIFO. Поэтому
 * перенесённая наличка не только входит в баланс, но и сохраняет ссылку на
 * исходный ПЛ и контрагента.
 *
 * ВАЖНО (2026): переводы (type=transfer и cashDestination=card) в кассу
 * НЕ входят, а сразу отображаются в карте ЮМ. Здесь учитывается только
 * регулярная наличка (cash + destination != card).
 */
export function getCashCarryoverSummary(
  payments: BankPayment[],
  salaries: Salary[] = [],
  collections: CashCollection[] = [],
  date = getWarehouseBusinessDate()
): CashCarryoverSummary {
  type CashLot = CashCarryoverOrigin;
  type CashEvent =
    | { date: string; priority: number; type: "in"; amount: number; lot: CashLot }
    | {
        date: string;
        priority: number;
        type: "out" | "card";
        amount: number;
        targets?: { paymentId: string; amount: number }[];
      };

  const paymentById = new Map<string, BankPayment>();
  for (const p of payments) paymentById.set(String(p.id), p);

  const events: CashEvent[] = [];
  for (const payment of payments) {
    if (!payment.isPaid || payment.excludeFromBalance) continue;
    // В кассу попадает только регулярная наличка, без переводов на ЮМ
    if (payment.type !== "cash") continue;
    if (payment.direction === "incoming" && payment.cashDestination === "card") continue;
    const amount = Math.max(0, Number(payment.amount) || 0);
    if (amount <= 0) continue;
    // Именно дата платежа определяет, в какой дневной баланс он входит.
    // paidAt — техническая дата проведения и не должна возвращать платёж
    // в сегодняшний остаток после ручного переноса документа на завтра.
    const operationDate = String(payment.date || "").slice(0, 10);
    if (payment.direction === "incoming") {
      events.push({
        date: operationDate,
        priority: 0,
        type: "in",
        amount,
        lot: {
          paymentId: String(payment.id),
          number: payment.number,
          date: operationDate,
          counterparty: payment.counterparty || "Без контрагента",
          originalAmount: amount,
          remainingAmount: amount,
        },
      });
    } else {
      events.push({ date: operationDate, priority: 1, type: "out", amount });
    }
  }

  for (const salary of salaries) {
    if (
      !salary.isPaid ||
      salary.source !== "cash" ||
      salary.amount <= 0 ||
      isSalaryExcludedFromBalance(salary.comment) ||
      isRentSalaryComment(salary.comment)
    ) {
      continue;
    }
    events.push({
      date: String(salary.paidAt || salary.date || "").slice(0, 10),
      priority: 1,
      type: "out",
      amount: Math.max(0, Number(salary.amount) || 0),
    });
  }

  for (const collection of collections) {
    // Для кассы учитываем только ту часть инкассации, которая относится
    // к регулярной наличке. Переводы (transfer / cashDestination=card)
    // никогда не были в кассе, поэтому из кассы не вычитаются.
    const eligibleCardItems: { paymentId: string; amount: number }[] = [];
    let eligibleCardTotal = 0;
    for (const item of collection.items || []) {
      const pid = String(item.paymentId || "");
      if (!pid) continue;
      if (pid.startsWith("manual:")) {
        const card = Math.max(0, Number(item.cardAmount != null ? item.cardAmount : item.kind === "card" ? item.amount : 0) || 0);
        if (card > 0) {
          eligibleCardItems.push({ paymentId: pid, amount: card });
          eligibleCardTotal += card;
        }
        continue;
      }
      const pay = paymentById.get(pid);
      if (pay && isImmediateYmPayment(pay)) {
        // перевод — никогда не был в кассе, пропускаем
        continue;
      }
      const card = Math.max(
        0,
        Number(
          item.cardAmount != null
            ? item.cardAmount
            : item.kind === "card"
              ? item.amount
              : 0
        ) || 0
      );
      if (card > 0) {
        eligibleCardItems.push({ paymentId: pid, amount: card });
        eligibleCardTotal += card;
      }
    }
    if (eligibleCardTotal <= 0) continue;
    const rawTotal = eligibleCardItems.reduce((sum, it) => sum + it.amount, 0);
    const factor = rawTotal > 0 ? Math.min(1, eligibleCardTotal / rawTotal) : 0;
    events.push({
      date: String(collection.date || "").slice(0, 10),
      priority: 2,
      type: "card",
      amount: eligibleCardTotal,
      targets: eligibleCardItems.map((item) => ({
        paymentId: item.paymentId,
        amount: item.amount * factor,
      })),
    });
  }

  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.priority - b.priority
  );

  const lots: CashLot[] = [];
  let openingBalance = 0;
  let currentBalance = 0;
  let todayIncoming = 0;
  let todayOutgoing = 0;
  let todayCardTransfers = 0;

  const consumeLot = (lot: CashLot, requested: number): number => {
    const used = Math.min(lot.remainingAmount, Math.max(0, requested));
    lot.remainingAmount = Math.round((lot.remainingAmount - used) * 100) / 100;
    return used;
  };

  const consumeFifo = (requested: number): void => {
    let left = Math.max(0, requested);
    for (const lot of lots) {
      if (left <= 0.009) break;
      left -= consumeLot(lot, left);
    }
  };

  for (const event of events) {
    // Будущие документы могут быть уже проведены, но в фактический баланс
    // на выбранную дату попадут только в свой день. Это защищает кассу от
    // случайного платежа «за 30-е», пока сегодня ещё 29-е.
    if (!event.date || event.date > date) continue;

    const signed = event.type === "in" ? event.amount : -event.amount;
    currentBalance += signed;
    if (event.date < date) openingBalance += signed;
    if (event.date === date) {
      if (event.type === "in") todayIncoming += event.amount;
      else if (event.type === "card") todayCardTransfers += event.amount;
      else todayOutgoing += event.amount;
    }

    if (event.type === "in") {
      lots.push({ ...event.lot });
      continue;
    }

    let targeted = 0;
    for (const target of event.targets || []) {
      const lot = lots.find(
        (item) => item.paymentId === target.paymentId && item.remainingAmount > 0
      );
      if (lot) targeted += consumeLot(lot, target.amount);
    }
    consumeFifo(Math.max(0, event.amount - targeted));
  }

  const origins = lots
    .filter((lot) => lot.remainingAmount > 0.009)
    .map((lot) => ({
      ...lot,
      originalAmount: Math.round(lot.originalAmount * 100) / 100,
      remainingAmount: Math.round(lot.remainingAmount * 100) / 100,
    }));
  const previousDaysRemaining = origins
    .filter((origin) => origin.date < date)
    .reduce((sum, origin) => sum + origin.remainingAmount, 0);

  return {
    date,
    openingBalance: Math.round(openingBalance * 100) / 100,
    todayIncoming: Math.round(todayIncoming * 100) / 100,
    todayOutgoing: Math.round(todayOutgoing * 100) / 100,
    todayCardTransfers: Math.round(todayCardTransfers * 100) / 100,
    currentBalance: Math.round(currentBalance * 100) / 100,
    previousDaysRemaining: Math.round(previousDaysRemaining * 100) / 100,
    origins,
  };
}

export interface PendingTransfersSummary {
  /** Неразмеченные к переводу поступления за выбранную дату. */
  today: number;
  /** То же за прошлые дни (если смену давно не закрывали). */
  older: number;
  total: number;
}

/**
 * Раньше наличка, которую предстояло перевести на карту, считалась
 * отдельно (type=transfer / cashDestination=card). Теперь переводы сразу
 * отображаются в карте ЮМ, минуя кассу, поэтому pending = 0.
 * Оставлено для обратной совместимости, чтобы UI не ломался.
 */
export function getPendingTransfersSummary(
  _payments: BankPayment[] = [],
  _collections: CashCollection[] = [],
  _date = getWarehouseBusinessDate()
): PendingTransfersSummary {
  return { today: 0, older: 0, total: 0 };
}

/** Сводка по банку и кассе. Зарплата влияет только после фактической
 *  выплаты; начисленная зарплата не является ожидаемым банковским платежом. */
export function isYmCardSalaryComment(comment: string | null | undefined): boolean {
  const c = String(comment || "");
  return c.includes(SALARY_YM_CARD_TAG) || c.includes(SALARY_YM_CARD_TAG_SHORT);
}

/** Сводка по банку, кассе и карте ЮМ.
 * ИЗМЕНЕНИЕ 2026: переводы (type=transfer и cash с cashDestination=card)
 * в кассе НЕ учитываются, а сразу отображаются в карте ЮМ. При этом
 * после сдачи кассы они не начисляются повторно — коллекции с
 * такими платежами игнорируются для кассы и для ЮМ (они уже учтены
 * напрямую как immediate YM).
 */
export function getBankSummary(
  payments: BankPayment[],
  salaries: Salary[] = [],
  collections: CashCollection[] = [],
  asOfDate = getWarehouseBusinessDate(),
  deals?: CustomerDeal[]
) {
  let bankBalance = 0;
  let cashBalance = 0;
  let ymCardBalance = 0;
  let rentBalance = 0;
  let expectedIn = 0;
  let expectedOut = 0;
  let ymExpectedIn = 0;
  let ymExpectedOut = 0;
  let rentExpectedIn = 0;
  let rentExpectedOut = 0;
  const debtPool = deals ? getDealDebtPool(deals, payments) : null;
  const paymentById = new Map<string, BankPayment>();
  for (const p of payments) paymentById.set(String(p.id), p);

  for (const p of payments) {
    if (p.excludeFromBalance) continue;
    const isYm = p.type === "ym_card";
    const isImmediateYm = isImmediateYmPayment(p);
    if (p.isPaid) {
      const paymentDate = String(p.date || "").slice(0, 10);
      if (!paymentDate || paymentDate > asOfDate) continue;
      const amt = p.direction === "incoming" ? p.amount : -p.amount;
      if (isImmediateYm) {
        // переводы сразу в ЮМ, минуя кассу
        ymCardBalance += amt;
      } else if (p.type === "cash") {
        // регулярная наличка — считается отдельно через getCashCarryoverSummary
      } else if (isYm) {
        ymCardBalance += amt;
      } else {
        bankBalance += amt;
      }
    } else {
      if (isImmediateYm || isYm) {
        if (p.direction === "incoming") ymExpectedIn += p.amount;
        else ymExpectedOut += p.amount;
      } else if (p.type === "cash") {
        // наличка ожидаемая не влияет на р/с прогноз (по новому ТЗ)
      } else {
        if (p.direction === "incoming") {
          expectedIn += offsetIncomingByDealPayments(p, debtPool);
        } else expectedOut += p.amount;
      }
    }
  }
  for (const s of salaries) {
    const bypassBalance = isSalaryExcludedFromBalance(s.comment);
    if (bypassBalance) continue;
    const isYm = s.source === "ym_card" || isYmCardSalaryComment(s.comment);
    const isRent = isRentSalaryComment(s.comment);
    if (isRent) {
      // аренда — отдельный счёт, не трогает основной р/с и кассу
      if (s.isPaid) {
        const salaryDate = String(s.paidAt || s.date || "").slice(0, 10);
        if (!salaryDate || salaryDate > asOfDate) continue;
        rentBalance -= s.amount;
      } else {
        // ожидаемая аренда — к выплате
        rentExpectedOut += s.amount;
      }
      continue;
    }
    if (isYm) {
      // карта ЮМ — перевод / выплата с карты
      if (s.isPaid) {
        const salaryDate = String(s.paidAt || s.date || "").slice(0, 10);
        if (!salaryDate || salaryDate > asOfDate) continue;
        ymCardBalance -= s.amount;
      } else {
        ymExpectedOut += s.amount;
      }
      continue;
    }
    if (s.source === "bank") {
      // ЗП с расчётного счёта вообще не платится, только аренда.
      // Поэтому обычные ЗП с source=bank игнорируем — они не должны
      // списывать основной банк. Если такая ЗП всё-таки заведена
      // по ошибке, она просто не повлияет на баланс (админ её
      // переведёт в аренду или в кассу/ЮМ).
      continue;
    }
    // cash — учитывается через getCashCarryoverSummary, здесь не трогаем
  }
  cashBalance = getCashCarryoverSummary(
    payments,
    salaries,
    collections,
    asOfDate
  ).currentBalance;

  let collectedCash = 0;
  let collectedCashOnly = 0;
  let collectedTransfer = 0;
  // Переводы из кассы в ЮМ теперь учитываются только для регулярной налички,
  // которая была переведена через сдачу. Immediate YM платежи (transfer /
  // cashDestination=card) уже учтены напрямую, чтобы не было двойного начисления.
  for (const c of collections) {
    const collectionDate = String(c.date || "").slice(0, 10);
    if (!collectionDate || collectionDate > asOfDate) continue;
    collectedCash += c.amount;
    collectedCashOnly += Math.max(0, Number(c.cashAmount) || 0);
    // Считаем только eligible переводы (регулярная наличка, переведённая через сдачу)
    let eligibleTransfer = 0;
    for (const item of c.items || []) {
      const pid = String(item.paymentId || "");
      if (!pid) continue;
      if (pid.startsWith("manual:")) {
        eligibleTransfer += Math.max(0, Number(item.cardAmount != null ? item.cardAmount : item.kind === "card" ? item.amount : 0) || 0);
        continue;
      }
      const pay = paymentById.get(pid);
      if (pay && isImmediateYmPayment(pay)) {
        // уже учтён напрямую как immediate YM — не добавляем второй раз
        continue;
      }
      eligibleTransfer += Math.max(0, Number(item.cardAmount != null ? item.cardAmount : item.kind === "card" ? item.amount : 0) || 0);
    }
    collectedTransfer += eligibleTransfer;
    ymCardBalance += eligibleTransfer;
  }
  const bankForecast = bankBalance + expectedIn - expectedOut;
  const bankIncomeTotal = bankBalance + expectedIn;
  const ymForecast = ymCardBalance + ymExpectedIn - ymExpectedOut;
  const rentForecast = rentBalance + rentExpectedIn - rentExpectedOut;
  const totalForecast = bankBalance + cashBalance + ymCardBalance + expectedIn - expectedOut + ymExpectedIn - ymExpectedOut;
  const totalWithRentForecast = totalForecast + rentBalance + rentExpectedIn - rentExpectedOut;
  return {
    balance: bankBalance + cashBalance + ymCardBalance,
    bankBalance,
    cashBalance,
    ymCardBalance,
    rentBalance,
    cashBalanceNegative: cashBalance < -0.009,
    collectedCash,
    collectedCashOnly,
    collectedTransfer,
    expectedIn,
    expectedOut,
    ymExpectedIn,
    ymExpectedOut,
    ymForecast,
    rentExpectedIn,
    rentExpectedOut,
    rentForecast,
    bankForecast,
    bankIncomeTotal,
    forecast: totalForecast,
    forecastCashPlusBank: bankForecast + cashBalance,
    forecastWithYm: totalForecast,
    forecastWithRent: totalWithRentForecast,
    totalWithoutCash: bankBalance + ymCardBalance,
    totalWithoutCashForecast: bankForecast + ymForecast,
  };
}

export function getCollectedBreakdown(
  collections: CashCollection[] = []
): { cash: number; transfer: number; total: number } {
  let cash = 0;
  let transfer = 0;
  for (const c of collections) {
    const hasSplit = c.cashAmount != null;
    // Старые записи целиком уменьшали кассу. В новой расшифровке относим их
    // к выбывшей части, а не к перенесённой наличке.
    const t = hasSplit
      ? Number(c.transferAmount) || 0
      : Number(c.amount) || 0;
    const cashPart = hasSplit ? Number(c.cashAmount) || 0 : 0;
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
 * Остаток долга по каждому заказу: итог заказа минус оплаты, уже
 * полученные проведёнными платежами (в т.ч. «вне баланса» — деньги
 * по заказу получены, даже если платёж архивный). Отменённые заказы
 * ничего не должны.
 */
export function getDealDebtPool(
  deals: CustomerDeal[],
  payments: BankPayment[]
): Map<string, number> {
  const received = getDealPaidMap(payments);
  const pool = new Map<string, number>();
  for (const d of deals) {
    if (d.status === "cancelled") continue;
    const debt = (Number(d.total) || 0) - (received.get(d.id) || 0);
    if (debt > 0.009) pool.set(d.id, debt);
  }
  return pool;
}

/**
 * Ожидаемая сумма непроведённого входящего платежа с учётом уже
 * полученных оплат по тем же заказам.
 *
 * Контрагент оплатил 90 000 из 213 000 отдельным проведённым платежом —
 * ожидающий платёж по этому заказу попадает в «ожидаем» не на 213 000,
 * а на остаток долга 123 000. Ограничение идёт через остаток долга
 * заказа (getDealDebtPool), поэтому схема «ожидающий платёж уменьшили
 * вручную и создали новый на остаток» тоже считается верно.
 * Долг «съедается» последовательно, чтобы несколько ожидающих платежей
 * по одному заказу не задваивали сумму. Если заказы не переданы
 * (пустой список) — ведём себя как раньше: ожидаем полную сумму платежа.
 */
export function offsetIncomingByDealPayments(
  payment: BankPayment,
  debtPool: Map<string, number> | null
): number {
  if (payment.direction !== "incoming") return payment.amount;
  // Заказы не переданы (например, расчёт только по платежам) —
  // ожидаем полную сумму платежа, как раньше.
  if (debtPool === null) return payment.amount;
  if (!payment.dealIds || payment.dealIds.length === 0) return payment.amount;
  let left = payment.amount;
  for (const dealId of payment.dealIds) {
    if (left <= 0.009) break;
    const debt = debtPool.get(dealId) || 0;
    if (debt <= 0.009) continue;
    const take = Math.min(left, debt);
    left -= take;
    debtPool.set(dealId, debt - take);
  }
  return Math.max(0, payment.amount - left);
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
  payments: BankPayment[],
  deals?: CustomerDeal[]
): CounterpartyBalance[] {
  const result = new Map<string, CounterpartyBalance>();
  // Остатки долгов по заказам — частичные оплаты, пришедшие отдельными
  // платежами, уменьшают ожидаемое по контрагенту (см. getBankSummary).
  const debtPool = deals ? getDealDebtPool(deals, payments) : null;

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
      if (p.direction === "incoming") {
        row.docsTotal += offsetIncomingByDealPayments(p, debtPool);
      } else row.paidTotal += p.amount;
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
