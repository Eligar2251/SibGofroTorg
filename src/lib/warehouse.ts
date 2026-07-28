// =========================================================
// FILE: src/lib/warehouse.ts
// Складской учёт — Supabase (PostgreSQL).
// Полная версия с созданием контрагентов, связями и кэшем.
// =========================================================

import { createHash } from "crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { getAdminDb } from "./supabase";
import { getProductEffectivePrice } from "./types";
// Ревизия пишет остатки напрямую — нужно сбросить memory-кеш товаров,
// иначе витрина ещё до двух минут отдаёт старые значения.
import { invalidateProductsCache } from "./supabase-queries";
import type {
  StockDocItem,
  CounterpartyRole,
  CounterpartyDetails,
  Counterparty,
  ReceiptStatus,
  WarehouseReceipt,
  DealStatus,
  CustomerDeal,
  BankPaymentType,
  BankPayment,
  WarehouseStockRow,
  CounterpartyBalance,
  Employee,
  Salary,
  SalarySource,
  CashKind,
  CashCollectionItem,
  CashCollectionExpense,
} from "./warehouse-shared";
import {
  includedVat,
  VAT_RATE,
  normalizeCashKind,
  CASH_CARD_HOLDER_SETTING_KEY,
  DEFAULT_CASH_CARD_HOLDER,
  getBankSummary,
  getDealPaidMap,
  getReceiptPaidMap,
  getCounterpartyBalances,
  getPendingPaymentCounterpartyBalances,
  shippedQtyMap,
  orderedQtyMap,
  dealRemainingItems,
  dealRemainingQty,
  isDealFullyShipped,
  dealNeedsDelivery,
} from "./warehouse-shared";

export {
  includedVat,
  VAT_RATE,
  normalizeCashKind,
  CASH_CARD_HOLDER_SETTING_KEY,
  DEFAULT_CASH_CARD_HOLDER,
  type StockDocItem,
  type CounterpartyRole,
  type CounterpartyDetails,
  type Counterparty,
  type ReceiptStatus,
  type WarehouseReceipt,
  type DealStatus,
  type CustomerDeal,
  type BankPaymentType,
  type BankPayment,
  type WarehouseStockRow,
  type CounterpartyBalance,
  type Employee,
  type Salary,
  type SalarySource,
  type CashKind,
  type CashCollectionItem,
  type CashCollectionExpense,
  getCollectedBreakdown,
  getBankSummary,
  getDealPaidMap,
  getReceiptPaidMap,
  getCounterpartyBalances,
  getPendingPaymentCounterpartyBalances,
  shippedQtyMap,
  orderedQtyMap,
  dealRemainingItems,
  dealRemainingQty,
  isDealFullyShipped,
  dealNeedsDelivery,
} from "./warehouse-shared";

// ─── Утилиты ───────────────────────────────────────────────

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cleanText(value: unknown, max: number): string | null {
  const result = String(value ?? "").trim().slice(0, max);
  return result || null;
}

function normalizeCounterpartyName(name: string): string {
  return String(name || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[«»\"']/g, "")
    .replace(/\s+/g, " ");
}

function counterpartyIdForName(name: string): string {
  return `cp_${createHash("sha256")
    .update(normalizeCounterpartyName(name))
    .digest("hex")
    .slice(0, 32)}`;
}

function mapCounterpartyRow(row: any): Counterparty {
  return {
    id: row.id,
    name: String(row.name || ""),
    normalizedName: String(row.normalized_name || "") || normalizeCounterpartyName(row.name),
    roles: Array.isArray(row.roles) ? row.roles.filter((r: unknown) => r === "supplier" || r === "customer") : [],
    supplierPrices: row.supplier_prices && typeof row.supplier_prices === "object"
      ? Object.fromEntries(Object.entries(row.supplier_prices).map(([id, price]) => [id, Math.max(0, Number(price) || 0)]))
      : {},
    phone: row.phone ?? null,
    email: row.email ?? null,
    inn: row.inn ?? null,
    kpp: row.kpp ?? null,
    ogrn: row.ogrn ?? null,
    fullName: row.full_name ?? null,
    shortName: row.short_name ?? null,
    legalAddress: row.legal_address ?? null,
    taxSystem: row.tax_system ?? null,
    bankAccount: row.bank_account ?? null,
    bankName: row.bank_name ?? null,
    bik: row.bik ?? null,
    correspondentAccount: row.correspondent_account ?? null,
    address: row.address ?? null,
    contactName: row.contact_name ?? null,
    comment: row.comment ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapReceiptRow(row: any): WarehouseReceipt {
  return {
    id: row.id,
    number: Number(row.number),
    date: row.date,
    supplier: row.supplier,
    status: row.status,
    counterpartyId: row.counterparty_id || null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    inn: row.inn ?? null,
    kpp: row.kpp ?? null,
    address: row.address ?? null,
    contactName: row.contact_name ?? null,
    comment: row.comment ?? null,
    items: Array.isArray(row.items) ? row.items : [],
    total: Number(row.total || 0),
    bankAdjustment: Number(row.bank_adjustment || 0),
    vatRate: Number(row.vat_rate ?? VAT_RATE),
    vatAmount: Number(row.vat_amount || 0),
    linkedDealIds: Array.isArray(row.linked_deal_ids) ? row.linked_deal_ids : [],
    linkedDealNumbers: Array.isArray(row.linked_deal_numbers) ? row.linked_deal_numbers : [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapDealRow(row: any): CustomerDeal {
  return {
    id: row.id,
    number: Number(row.number),
    date: row.date,
    customerName: row.customer_name,
    counterpartyId: row.counterparty_id || null,
    customerPhone: row.customer_phone ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    inn: row.inn ?? null,
    kpp: row.kpp ?? null,
    address: row.address ?? null,
    contactName: row.contact_name ?? null,
    comment: row.comment ?? null,
    items: Array.isArray(row.items) ? row.items : [],
    total: Number(row.total || 0),
    bankAdjustment: Number(row.bank_adjustment || 0),
    vatRate: Number(row.vat_rate ?? VAT_RATE),
    vatAmount: Number(row.vat_amount || 0),
    status: row.status,
    cancelReason: row.cancel_reason ?? null,
    hasDelivery: row.has_delivery ?? false,
    deliveryType: row.delivery_type || null,
    deliveryCost: row.delivery_cost != null ? Number(row.delivery_cost) : null,
    deliveryAddress: row.delivery_address || row.address || null,
    deliveryPlannedDate: row.delivery_planned_date || null,
    deliveryReleasedAt: toIso(row.delivery_released_at),
    deliveryNote: row.delivery_note || null,
    deliveryDriverId: row.delivery_driver_id || null,
    deliveryDriverName: row.delivery_driver_name || null,
    shippedItems: Array.isArray(row.shipped_items) ? row.shipped_items : [],
    deliveryItems: Array.isArray(row.delivery_items) ? row.delivery_items : [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/**
 * Нормализует тариф доставки: сумма — единственный источник правды.
 *
 * 0 ₽ (или пусто) → доставка бесплатная, даже если тип пришёл как "paid".
 * Это позволяет вручную поставить 0 конкретному клиенту, когда заказ ниже
 * порога бесплатной доставки, и такой «нулевой тариф» корректно сохранится.
 */
export function normalizeDeliveryTariff(
  hasDelivery: boolean,
  rawCost: unknown
): { type: "free" | "paid" | null; cost: number } {
  if (!hasDelivery) return { type: null, cost: 0 };
  const cost = Math.max(0, Number(rawCost) || 0);
  return cost > 0 ? { type: "paid", cost: round2(cost) } : { type: "free", cost: 0 };
}

function parseDealDelivery(data: any): {
  has_delivery: boolean;
  delivery_type: "free" | "paid" | null;
  delivery_cost: number;
  delivery_address: string | null;
  delivery_planned_date: string | null;
  delivery_note: string | null;
  delivery_released_at?: string | null;
} {
  const hasDelivery = Boolean(data.hasDelivery);
  // Тип доставки выводим из суммы: 0 ₽ = бесплатная, >0 ₽ = платная.
  const tariff = normalizeDeliveryTariff(hasDelivery, data.deliveryCost);
  const deliveryType = tariff.type;
  const deliveryCost = tariff.cost;
  const deliveryAddress = hasDelivery
    ? cleanText(data.deliveryAddress ?? data.address, 400)
    : cleanText(data.deliveryAddress, 400);
  return {
    has_delivery: hasDelivery,
    delivery_type: deliveryType,
    delivery_cost: deliveryCost,
    delivery_address: deliveryAddress,
    delivery_planned_date:
      hasDelivery && data.deliveryPlannedDate
        ? String(data.deliveryPlannedDate).slice(0, 10)
        : null,
    delivery_note: hasDelivery
      ? cleanText(data.deliveryNote, 1000)
      : null,
  };
}

function mapPaymentRow(row: any): BankPayment {
  return {
    id: row.id,
    number: Number(row.number),
    date: row.date,
    direction: row.direction,
    type: row.type || "regular",
    counterparty: row.counterparty,
    counterpartyId: row.counterparty_id || null,
    dealIds: Array.isArray(row.deal_ids) ? row.deal_ids : [],
    dealNumbers: Array.isArray(row.deal_numbers) ? row.deal_numbers : [],
    receiptIds: Array.isArray(row.receipt_ids) ? row.receipt_ids : [],
    receiptNumbers: Array.isArray(row.receipt_numbers) ? row.receipt_numbers : [],
    amount: Number(row.amount || 0),
    invoiceNumber: row.invoice_number ?? null,
    vatRate: Number(row.vat_rate ?? VAT_RATE),
    vatAmount: Number(row.vat_amount || 0),
    isPaid: row.is_paid ?? false,
    paidAt: row.paid_at ?? null,
    excludeFromBalance: row.exclude_from_balance ?? false,
    comment: row.comment ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapEmployeeRow(row: any): Employee {
  return {
    id: row.id,
    name: row.name,
    position: row.position ?? null,
    phone: row.phone ?? null,
    comment: row.comment ?? null,
    createdAt: toIso(row.created_at),
  };
}

function mapSalaryRow(row: any): Salary {
  return {
    id: row.id,
    employeeId: row.employee_id ?? null,
    employeeName: row.employee_name,
    amount: Number(row.amount || 0),
    date: row.date,
    source: row.source,
    isPaid: row.is_paid ?? false,
    paidAt: row.paid_at ?? null,
    comment: row.comment ?? null,
    createdAt: toIso(row.created_at),
  };
}

// ─── Следующий номер документа ─────────────────────────────

async function nextNumber(key: string): Promise<number> {
  const db = getAdminDb();
  const { data, error } = await db.rpc("fn_next_counter", { p_key: key });
  if (error) {
    const { data: counter } = await db.from("doc_counters").select("value").eq("key", key).maybeSingle();
    const newVal = (counter?.value || 0) + 1;
    await db.from("doc_counters").upsert({ key, value: newVal });
    return newVal;
  }
  return Number(data);
}

// ─── Кэш контрагентов ──────────────────────────────────────

let memoryCounterpartiesCache: { at: number; data: Counterparty[] } | null = null;

async function fetchCounterpartyRows(): Promise<Counterparty[]> {
  const now = Date.now();
  if (memoryCounterpartiesCache && now - memoryCounterpartiesCache.at < 60_000) {
    return memoryCounterpartiesCache.data;
  }
  try {
    const db = getAdminDb();
    const { data, error } = await db.from("counterparties").select("*");
    if (error) throw error;
    const mapped = (data || []).map(mapCounterpartyRow);
    memoryCounterpartiesCache = { at: now, data: mapped };
    return mapped;
  } catch (error: any) {
    console.error("fetchCounterpartyRows error:", error?.message || error);
    return memoryCounterpartiesCache?.data || [];
  }
}

let memorySupplierPricesCache: { at: number; data: { counterpartyId: string; productId: string; price: number }[] } | null = null;

async function fetchSupplierPriceRows(): Promise<{ counterpartyId: string; productId: string; price: number }[]> {
  const now = Date.now();
  if (memorySupplierPricesCache && now - memorySupplierPricesCache.at < 60_000) {
    return memorySupplierPricesCache.data;
  }
  try {
    const db = getAdminDb();
    const { data: priceData } = await db.from("supplier_prices").select("*");
    const { data: receiptData } = await db.from("warehouse_receipts").select("id, supplier, counterparty_id, items").limit(1000);

    const rows: { counterpartyId: string; productId: string; price: number }[] = [];

    for (const row of priceData || []) {
      rows.push({
        counterpartyId: row.counterparty_id,
        productId: String(row.product_id),
        price: Math.max(0, Number(row.price) || 0),
      });
    }

    for (const receipt of receiptData || []) {
      const counterpartyId = receipt.counterparty_id || counterpartyIdForName(String(receipt.supplier || ""));
      const items = Array.isArray(receipt.items) ? receipt.items : [];
      for (const item of items) {
        const productId = String(item.productId || "");
        if (!counterpartyId || !productId) continue;
        rows.push({ counterpartyId, productId, price: Math.max(0, Number(item.price) || 0) });
      }
    }

    const filtered = rows.filter((r) => r.counterpartyId && r.productId);
    memorySupplierPricesCache = { at: now, data: filtered };
    return filtered;
  } catch (error: any) {
    console.error("fetchSupplierPriceRows error:", error?.message || error);
    return memorySupplierPricesCache?.data || [];
  }
}

const getCachedCounterpartyRows = unstable_cache(
  fetchCounterpartyRows, ["warehouse-counterparties"],
  { revalidate: 60, tags: ["warehouse-counterparties"] }
);

const getCachedSupplierPriceRows = unstable_cache(
  fetchSupplierPriceRows, ["warehouse-supplier-prices"],
  { revalidate: 60, tags: ["warehouse-supplier-prices"] }
);

function invalidateCounterpartyCache(includeSupplierPrices = false) {
  revalidateTag("warehouse-counterparties", { expire: 0 });
  if (includeSupplierPrices) {
    revalidateTag("warehouse-supplier-prices", { expire: 0 });
  }
}

// ─── Counterparties CRUD ───────────────────────────────────

export async function getCounterparties(options?: { includeSupplierPrices?: boolean }): Promise<Counterparty[]> {
  const [baseRows, priceRows] = await Promise.all([
    getCachedCounterpartyRows(),
    options?.includeSupplierPrices ? getCachedSupplierPriceRows() : Promise.resolve([]),
  ]);
  if (!priceRows.length) return baseRows;
  const priceMap = new Map<string, Record<string, number>>();
  for (const row of priceRows) {
    if (!priceMap.has(row.counterpartyId)) priceMap.set(row.counterpartyId, {});
    priceMap.get(row.counterpartyId)![row.productId] = row.price;
  }
  return baseRows.map((c) => ({
    ...c,
    supplierPrices: priceMap.get(c.id) || c.supplierPrices || {},
  }));
}

/**
 * Создаёт или обновляет контрагента. Возвращает ID.
 * Автоматически добавляет роль (customer/supplier) если её нет.
 */
async function ensureCounterparty(
  name: string,
  role: CounterpartyRole,
  details: CounterpartyDetails & { comment?: string | null } = {}
): Promise<string> {
  const db = getAdminDb();
  const id = counterpartyIdForName(name);
  const normalizedName = normalizeCounterpartyName(name);

  // Проверяем существование
  const { data: existing } = await db.from("counterparties").select("roles").eq("id", id).maybeSingle();

  let roles: string[] = [];
  if (existing && Array.isArray(existing.roles)) {
    roles = existing.roles;
    if (!roles.includes(role)) roles.push(role);
  } else {
    roles = [role];
  }

  const payload: Record<string, any> = {
    id,
    name: name.trim().slice(0, 200),
    normalized_name: normalizedName,
    roles,
    updated_at: new Date().toISOString(),
  };

  // Заполняем детали
  const fields: Record<string, string> = {
    phone: "phone", email: "email", inn: "inn", kpp: "kpp", ogrn: "ogrn",
    fullName: "full_name", shortName: "short_name", legalAddress: "legal_address",
    taxSystem: "tax_system", bankAccount: "bank_account", bankName: "bank_name",
    bik: "bik", correspondentAccount: "correspondent_account",
    address: "address", contactName: "contact_name",
  };
  for (const [jsKey, dbKey] of Object.entries(fields)) {
    const val = details[jsKey as keyof typeof details];
    if (val != null && val !== "") payload[dbKey] = String(val).slice(0, dbKey === "address" ? 400 : 160);
  }
  if (details.comment) payload.comment = cleanText(details.comment, 1000);

  await db.from("counterparties").upsert(payload);
  invalidateCounterpartyCache();
  return id;
}

export async function saveCounterparty(data: {
  id?: string | null;
  name: string;
  roles: CounterpartyRole[];
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
  comment?: string | null;
}): Promise<{ id: string }> {
  const db = getAdminDb();
  const name = data.name.trim().slice(0, 200);
  const id = data.id || counterpartyIdForName(name);
  const normalizedName = normalizeCounterpartyName(name);

  const payload: Record<string, any> = {
    id, name, normalized_name: normalizedName, roles: data.roles,
    phone: data.phone ?? null, email: data.email ?? null,
    inn: data.inn ?? null, kpp: data.kpp ?? null, ogrn: data.ogrn ?? null,
    full_name: data.fullName ?? null, short_name: data.shortName ?? null,
    legal_address: data.legalAddress ?? null, tax_system: data.taxSystem ?? null,
    bank_account: data.bankAccount ?? null, bank_name: data.bankName ?? null,
    bik: data.bik ?? null, correspondent_account: data.correspondentAccount ?? null,
    address: data.address ?? null, contact_name: data.contactName ?? null,
    comment: data.comment ?? null,
  };

  const { error } = await db.from("counterparties").upsert(payload);
  if (error) throw error;
  invalidateCounterpartyCache();
  return { id };
}

export async function deleteCounterparty(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("counterparties").delete().eq("id", id);
  if (error) throw error;
  invalidateCounterpartyCache(true);
}

// ─── Stock operations ──────────────────────────────────────

/**
 * Единая точка изменения остатка товара.
 *
 * Важно: остаток НЕ обрезается по нулю. Раньше списание обрезалось
 * (`Math.max(0, …)`), из-за чего при отгрузке «в минус» часть количества
 * просто терялась, и при отмене/возврате на склад возвращалось меньше,
 * чем было списано. Теперь склад может уйти в минус — это честно
 * показывает нехватку и гарантирует, что возврат восстановит остаток
 * ровно до исходного значения.
 */
async function adjustStock(productId: string, delta: number): Promise<void> {
  const id = String(productId || "");
  const qty = Number(delta) || 0;
  if (!id || qty === 0) return;
  const db = getAdminDb();
  const { data: product } = await db
    .from("products")
    .select("stock_qty")
    .eq("id", id)
    .maybeSingle();
  if (!product) return;
  const newQty = Number(product.stock_qty || 0) + qty;
  await db
    .from("products")
    .update({
      stock_qty: newQty,
      in_stock: newQty > 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function applyStockDelta(items: StockDocItem[], direction: 1 | -1): Promise<void> {
  for (const item of Array.isArray(items) ? items : []) {
    await adjustStock(item.productId, direction * (Number(item.quantity) || 0));
  }
}

/**
 * Вернуть на склад всё, что было отгружено по заказу (сторно отгрузки).
 * Возвращает ровно те количества, которые были списаны, — по shipped_items.
 * Для старых заказов (проведён, но shipped_items пуст) — по позициям заказа.
 */
async function returnShippedToStock(deal: {
  items?: unknown;
  shipped_items?: unknown;
  status?: string | null;
}): Promise<void> {
  const shipped = shippedQtyMap(
    (Array.isArray(deal.shipped_items) ? deal.shipped_items : []) as {
      productId: string;
      shippedQty: number;
    }[]
  );
  const shippedTotal = [...shipped.values()].reduce((s, q) => s + q, 0);

  if (shippedTotal > 0) {
    for (const [productId, qty] of shipped) {
      if (qty > 0) await adjustStock(productId, qty);
    }
    return;
  }

  // Старое поведение: проведённый заказ без shipped_items — возвращаем всё.
  if (deal.status === "completed") {
    await applyStockDelta((deal.items || []) as StockDocItem[], 1);
  }
}

export async function setWarehouseStock(productId: string, quantity: number): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("products").update({
    stock_qty: Math.floor(quantity), in_stock: Math.floor(quantity) > 0,
    updated_at: new Date().toISOString(),
  }).eq("id", productId);
  if (error) throw error;
  revalidateTag("products", { expire: 0 });
}

export interface StockRevisionItem {
  productId: string;
  name?: string;
  /** Остаток по учёту на момент печати бланка */
  accountedQty: number;
  /** Фактический остаток, посчитанный на складе */
  actualQty: number;
}

/**
 * Применить ревизию: записать фактические остатки.
 *
 * Пишем именно факт (а не дельту): пересчёт на складе — это истина в
 * последней инстанции. Возвращаем список реальных изменений для журнала
 * действий, сравнивая с текущим значением в БД, а не с тем, что было
 * напечатано в бланке (остаток мог измениться, пока шёл пересчёт).
 */
export async function applyStockRevision(items: StockRevisionItem[]): Promise<{
  updated: number;
  skipped: number;
  changes: { productId: string; name: string; from: number; to: number; diff: number }[];
}> {
  const db = getAdminDb();
  const changes: { productId: string; name: string; from: number; to: number; diff: number }[] = [];
  let skipped = 0;

  for (const item of items) {
    const productId = String(item.productId || "").trim();
    if (!productId) {
      skipped += 1;
      continue;
    }
    const actual = Math.max(0, Math.floor(Number(item.actualQty) || 0));

    const { data: product } = await db
      .from("products")
      .select("id, name, stock_qty")
      .eq("id", productId)
      .maybeSingle();
    if (!product) {
      skipped += 1;
      continue;
    }

    const current = Number(product.stock_qty || 0);
    if (current === actual) {
      skipped += 1;
      continue;
    }

    const { error } = await db
      .from("products")
      .update({
        stock_qty: actual,
        in_stock: actual > 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", productId);
    if (error) throw error;

    changes.push({
      productId,
      name: product.name || item.name || "",
      from: current,
      to: actual,
      diff: actual - current,
    });
  }

  invalidateProductsCache();
  revalidateTag("products", { expire: 0 });
  return { updated: changes.length, skipped, changes };
}

// ─── Items helpers ─────────────────────────────────────────

function itemsTotal(items: StockDocItem[]): number {
  return round2(items.reduce((s, it) => s + it.lineTotal, 0));
}

function cleanItems(rawItems: any[]): StockDocItem[] {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((it: any) => {
      const quantity = Math.max(0, Math.min(100_000, Number(it.quantity) || 0));
      let lineTotal = Math.max(0, Number(it.lineTotal) || 0);
      let price = Math.max(0, Number(it.price) || 0);
      if (lineTotal > 0 && quantity > 0) {
        price = round2(lineTotal / quantity);
      } else {
        lineTotal = round2(price * quantity);
      }
      return {
        productId: String(it.productId || ""),
        name: String(it.name || "").slice(0, 300),
        sku: it.sku ? String(it.sku).slice(0, 60) : null,
        quantity,
        price,
        lineTotal: round2(lineTotal),
      };
    })
    .filter((it) => it.productId && it.quantity > 0);
}

// ─── Receipts CRUD ─────────────────────────────────────────

export async function createReceipt(data: any): Promise<{ id: string; number: number }> {
  const items = cleanItems(data.items);
  if (!data.supplier?.trim()) throw new Error("Укажите поставщика");
  if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");

  const total = itemsTotal(items);
  if (total <= 0) throw new Error("Укажите сумму поступления больше нуля");

  const db = getAdminDb();

  const linkedDealIds = Array.isArray(data.linkedDealIds) ? data.linkedDealIds : [];
  const linkedPaymentIds = Array.isArray(data.linkedPaymentIds) ? data.linkedPaymentIds : [];

  // Разбивка оплаты на части
  const paymentSplits = (Array.isArray(data.paymentSplits) ? data.paymentSplits : [])
    .map((n: any) => round2(Number(n) || 0))
    .filter((n: number) => n > 0);
  if (paymentSplits.length === 0) paymentSplits.push(total);

  // Номера связанных заказов
  const linkedDealNumbers: number[] = [];
  for (const dealId of linkedDealIds) {
    const { data: deal } = await db.from("customer_deals").select("number").eq("id", dealId).maybeSingle();
    if (deal) linkedDealNumbers.push(Number(deal.number) || 0);
  }

  const number = await nextNumber("receipt");
  const date = data.date || new Date().toISOString().slice(0, 10);
  const supplier = String(data.supplier || "").slice(0, 200);
  const vatRate = data.vatRate !== undefined ? Number(data.vatRate) : VAT_RATE;
  const vatAmount = includedVat(total, vatRate);

  // ★ Создаём контрагента-поставщика И сохраняем цены поставки
  const supplierPrices: Record<string, number> = {};
  for (const item of items) {
    if (item.productId && item.price > 0) {
      supplierPrices[item.productId] = item.price;
    }
  }
  const counterpartyId = await ensureCounterparty(supplier, "supplier", {
    phone: cleanText(data.phone, 60),
    email: cleanText(data.email, 160),
    inn: cleanText(data.inn, 20),
    kpp: cleanText(data.kpp, 20),
    address: cleanText(data.address, 400),
    contactName: cleanText(data.contactName, 160),
    comment: data.comment,
  });

  // Сохраняем цены поставщика
  if (Object.keys(supplierPrices).length > 0) {
    // Обновляем supplier_prices в таблице counterparties
    const { data: cp } = await db.from("counterparties").select("supplier_prices").eq("id", counterpartyId).maybeSingle();
    const existingPrices = cp?.supplier_prices || {};
    const mergedPrices = { ...existingPrices, ...supplierPrices };
    await db.from("counterparties").update({ supplier_prices: mergedPrices }).eq("id", counterpartyId);

    // Также записываем в таблицу supplier_prices
    for (const [productId, price] of Object.entries(supplierPrices)) {
      await db.from("supplier_prices").upsert({
        counterparty_id: counterpartyId, product_id: productId, price,
      });
    }
    invalidateCounterpartyCache(true);
  }

  // ★ Создаём поступление
  const { data: receiptResult, error: receiptError } = await db.from("warehouse_receipts").insert({
    number, date, supplier, counterparty_id: counterpartyId, status: "draft",
    phone: cleanText(data.phone, 60), email: cleanText(data.email, 160),
    inn: cleanText(data.inn, 20), kpp: cleanText(data.kpp, 20),
    address: cleanText(data.address, 400), contact_name: cleanText(data.contactName, 160),
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    items, total, bank_adjustment: 0, vat_rate: vatRate, vat_amount: vatAmount,
    linked_deal_ids: linkedDealIds, linked_deal_numbers: linkedDealNumbers,
  }).select("id").single();
  if (receiptError) throw receiptError;
  const receiptId = receiptResult.id;

  // ★ Создаём исходящие платежи (по разбивке)
  for (let i = 0; i < paymentSplits.length; i++) {
    const splitAmount = paymentSplits[i];
    if (splitAmount <= 0) continue;
    const payNumber = await nextNumber("payment");
    await db.from("bank_payments").insert({
      number: payNumber, date,
      direction: "outgoing", type: "regular",
      counterparty: supplier || "Поставщик", counterparty_id: counterpartyId,
      deal_ids: [], deal_numbers: [],
      receipt_ids: [receiptId], receipt_numbers: [number],
      amount: splitAmount, invoice_number: null,
      vat_rate: vatRate, vat_amount: includedVat(splitAmount, vatRate),
      is_paid: false, paid_at: null,
      exclude_from_balance: false,
      comment: `Оплата поставщику по приходному ордеру ПО-${number}${paymentSplits.length > 1 ? ` (часть ${i+1})` : ""}`,
    });
  }

  // Привязываем существующие платежи к поступлению
  for (const payId of linkedPaymentIds) {
    const { data: pay } = await db.from("bank_payments").select("receipt_ids, receipt_numbers").eq("id", payId).maybeSingle();
    if (pay) {
      const receiptIds = Array.isArray(pay.receipt_ids) ? [...pay.receipt_ids, receiptId] : [receiptId];
      const receiptNumbers = Array.isArray(pay.receipt_numbers) ? [...pay.receipt_numbers, number] : [number];
      await db.from("bank_payments").update({ receipt_ids: receiptIds, receipt_numbers: receiptNumbers }).eq("id", payId);
    }
  }

  revalidateTag("warehouse-receipts", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("warehouse-counterparties", { expire: 0 });
  revalidateTag("products", { expire: 0 });
  return { id: receiptId, number };
}

export async function postReceipt(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: receipt } = await db.from("warehouse_receipts").select("*").eq("id", id).single();
  if (!receipt) throw new Error("Поступление не найдено");
  if (receipt.status === "posted") throw new Error("Уже проведено");
  await applyStockDelta(receipt.items as StockDocItem[], 1);
  await db.from("warehouse_receipts").update({ status: "posted", updated_at: new Date().toISOString() }).eq("id", id);
  revalidateTag("warehouse-receipts", { expire: 0 });
  revalidateTag("products", { expire: 0 });
}

export async function cancelReceipt(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: receipt } = await db.from("warehouse_receipts").select("*").eq("id", id).single();
  if (!receipt) throw new Error("Поступление не найдено");
  if (receipt.status !== "posted") throw new Error("Можно отменить только проведённое");
  await applyStockDelta(receipt.items as StockDocItem[], -1);
  await db.from("warehouse_receipts").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", id);
  revalidateTag("warehouse-receipts", { expire: 0 });
  revalidateTag("products", { expire: 0 });
}

export async function updateReceipt(id: string, data: any): Promise<void> {
  const db = getAdminDb();
  const { data: existing, error: existErr } = await db.from("warehouse_receipts").select("*").eq("id", id).single();
  if (existErr || !existing) throw new Error("Поступление не найдено");
  if (existing.status === "posted") throw new Error("Нельзя редактировать проведённое поступление");

  const items = cleanItems(data.items);
  if (!data.supplier?.trim()) throw new Error("Укажите поставщика");
  if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");
  const linesTotal = itemsTotal(items);
  if (linesTotal <= 0) throw new Error("Укажите сумму поступления больше нуля");

  const vatRate = data.vatRate !== undefined ? Number(data.vatRate) : Number(existing.vat_rate ?? VAT_RATE);
  const linkedDealIds = Array.isArray(data.linkedDealIds) ? data.linkedDealIds : (Array.isArray(existing.linked_deal_ids) ? existing.linked_deal_ids : []);
  const linkedPaymentIds = Array.isArray(data.linkedPaymentIds) ? data.linkedPaymentIds : [];

  // Номера связанных заказов
  const linkedDealNumbers: number[] = [];
  for (const dealId of linkedDealIds) {
    const { data: deal } = await db.from("customer_deals").select("number").eq("id", dealId).maybeSingle();
    if (deal) linkedDealNumbers.push(Number(deal.number) || 0);
  }

  // Считаем оплаченную сумму по существующим платежам
  const { data: existingPayments } = await db.from("bank_payments")
    .select("*");
  const receiptPayments = (existingPayments || []).filter((p: any) =>
    Array.isArray(p.receipt_ids) && p.receipt_ids.includes(id)
  );
  const paidTotal = receiptPayments.reduce((sum: number, p: any) => {
    const links = Math.max(1, (p.receipt_ids || []).length);
    return p.is_paid === true && p.direction === "outgoing"
      ? sum + (Number(p.amount) || 0) / links
      : sum;
  }, 0);
  const total = paidTotal > 0 ? paidTotal : linesTotal;
  const bankAdjustment = round2(total - linesTotal);

  const supplier = data.supplier.trim().slice(0, 200);
  const details = {
    phone: cleanText(data.phone, 60),
    email: cleanText(data.email, 160),
    inn: cleanText(data.inn, 20),
    kpp: cleanText(data.kpp, 20),
    address: cleanText(data.address, 400),
    contactName: cleanText(data.contactName, 160),
  };

  // Обновляем поступление
  await db.from("warehouse_receipts").update({
    date: String(data.date || "").slice(0, 10),
    supplier,
    phone: details.phone, email: details.email,
    inn: details.inn, kpp: details.kpp,
    address: details.address, contact_name: details.contactName,
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    items, total, bank_adjustment: bankAdjustment,
    vat_rate: vatRate, vat_amount: includedVat(total, vatRate),
    linked_deal_ids: linkedDealIds, linked_deal_numbers: linkedDealNumbers,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  // ★ Создаём/обновляем контрагента с ценами
  const counterpartyId = await ensureCounterparty(supplier, "supplier", {
    ...details,
    comment: data.comment,
  });
  const supplierPrices: Record<string, number> = {};
  for (const item of items) {
    if (item.productId && item.price > 0) supplierPrices[item.productId] = item.price;
  }
  if (Object.keys(supplierPrices).length > 0) {
    const { data: cp } = await db.from("counterparties").select("supplier_prices").eq("id", counterpartyId).maybeSingle();
    const mergedPrices = { ...(cp?.supplier_prices || {}), ...supplierPrices };
    await db.from("counterparties").update({ supplier_prices: mergedPrices }).eq("id", counterpartyId);
    for (const [productId, price] of Object.entries(supplierPrices)) {
      await db.from("supplier_prices").upsert({ counterparty_id: counterpartyId, product_id: productId, price });
    }
  }
  // Обновляем counterparty_id на поступлении
  await db.from("warehouse_receipts").update({ counterparty_id: counterpartyId }).eq("id", id);

  // ★ Синхронизация платежей
  const unpaidSoloPayments = receiptPayments.filter((p: any) => {
    if (p.is_paid === true) return false;
    const receiptLinks = (p.receipt_ids || []).length;
    const dealLinks = (p.deal_ids || []).length;
    return receiptLinks === 1 && dealLinks === 0;
  });
  const remaining = Math.max(0, round2(linesTotal - paidTotal));

  const requested = (Array.isArray(data.paymentSplits) ? data.paymentSplits : [])
    .map((n: any) => round2(Number(n) || 0))
    .filter((n: number) => n > 0);

  // Целевые суммы
  let targets: number[];
  if (remaining <= 0) {
    targets = [];
  } else if (requested.length > 0) {
    const reqSum = requested.reduce((s: number, n: number) => s + n, 0);
    const factor = reqSum > 0 ? remaining / reqSum : 1;
    targets = requested.map((n: number) => round2(n * factor));
    const headSum = targets.slice(0, -1).reduce((s: number, n: number) => s + n, 0);
    targets[targets.length - 1] = round2(remaining - headSum);
    targets = targets.filter((n: number) => n > 0);
  } else {
    targets = [remaining];
  }

  if (targets.length > 0 && unpaidSoloPayments.length === targets.length) {
    // Количество совпало — обновляем суммы, сохраняя номера
    for (let i = 0; i < unpaidSoloPayments.length; i++) {
      await db.from("bank_payments").update({
        counterparty: supplier, counterparty_id: counterpartyId,
        amount: targets[i], vat_rate: vatRate,
        vat_amount: includedVat(targets[i], vatRate),
      }).eq("id", unpaidSoloPayments[i].id);
    }
  } else {
    // Количество изменилось — удаляем старые неоплаченные и создаём новые
    for (const p of unpaidSoloPayments) {
      await db.from("bank_payments").delete().eq("id", p.id);
    }
    for (let i = 0; i < targets.length; i++) {
      const payNumber = await nextNumber("payment");
      await db.from("bank_payments").insert({
        number: payNumber,
        date: String(data.date || "").slice(0, 10),
        direction: "outgoing", type: "regular",
        counterparty: supplier || "Поставщик", counterparty_id: counterpartyId,
        deal_ids: [], deal_numbers: [],
        receipt_ids: [id], receipt_numbers: [existing.number],
        amount: targets[i], invoice_number: null,
        vat_rate: vatRate, vat_amount: includedVat(targets[i], vatRate),
        is_paid: false, paid_at: null,
        exclude_from_balance: false,
        comment: `Оплата поставщику по приходному ордеру ПО-${existing.number}${targets.length > 1 ? ` (часть ${i + 1})` : ""}`,
      });
    }
  }

  // Привязываем существующие платежи
  for (const payId of linkedPaymentIds) {
    const { data: pay } = await db.from("bank_payments").select("receipt_ids, receipt_numbers").eq("id", payId).maybeSingle();
    if (pay) {
      const receiptIds = Array.isArray(pay.receipt_ids) ? [...new Set([...pay.receipt_ids, id])] : [id];
      const receiptNumbers = Array.isArray(pay.receipt_numbers) ? [...new Set([...pay.receipt_numbers, existing.number])] : [existing.number];
      await db.from("bank_payments").update({ receipt_ids: receiptIds, receipt_numbers: receiptNumbers }).eq("id", payId);
    }
  }

  invalidateCounterpartyCache(true);
  revalidateTag("warehouse-receipts", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("products", { expire: 0 });
}

export async function deleteReceipt(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: existing } = await db.from("warehouse_receipts").select("*").eq("id", id).single();
  if (!existing) throw new Error("Поступление не найдено");
  if (existing.status === "posted") throw new Error("Нельзя удалить проведённое поступление");

  // Удаляем ВСЕ связанные платежи (оплаченные и неоплаченные)
  try {
    const { data: allPayments } = await db.from("bank_payments").select("*");
    const linked = (allPayments || []).filter((p: any) =>
      Array.isArray(p.receipt_ids) && p.receipt_ids.includes(id)
    );
    for (const payment of linked) {
      // Оплаченные — только отвязываем, неоплаченные — удаляем
      if (payment.is_paid) {
        const newIds = (payment.receipt_ids || []).filter((rid: string) => rid !== id);
        const newNums = (payment.receipt_numbers || []).filter((_: any, i: number) =>
          (payment.receipt_ids || [])[i] !== id
        );
        await db.from("bank_payments").update({
          receipt_ids: newIds,
          receipt_numbers: newNums,
        }).eq("id", payment.id);
      } else {
        await db.from("bank_payments").delete().eq("id", payment.id);
      }
    }
  } catch (e) {
    console.error("deleteReceipt: ошибка удаления платежей:", e);
  }

  await db.from("warehouse_receipts").delete().eq("id", id);
  revalidateTag("warehouse-receipts", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
}

// ─── Deals CRUD ────────────────────────────────────────────

export async function createDeal(data: any): Promise<{ id: string; number: number }> {
  const items = cleanItems(data.items);
  if (!data.customerName?.trim()) throw new Error("Укажите покупателя");
  if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");

  const linesTotal = itemsTotal(items);
  if (linesTotal <= 0) throw new Error("Укажите цену товаров, итог заказа должен быть больше нуля");

  const db = getAdminDb();
  const linkedPaymentIds = Array.isArray(data.linkedPaymentIds) ? data.linkedPaymentIds : [];

  const number = await nextNumber("deal");
  const paymentNumber = await nextNumber("payment");
  const date = data.date || new Date().toISOString().slice(0, 10);
  const customerName = String(data.customerName).slice(0, 200);
  const vatRate =
    data.vatRate !== undefined && data.vatRate !== null
      ? Number(data.vatRate)
      : VAT_RATE;
  const delivery = parseDealDelivery(data);
  if (delivery.has_delivery && !delivery.delivery_address) {
    throw new Error("Укажите адрес доставки");
  }
  if (delivery.has_delivery && delivery.delivery_type === "paid" && delivery.delivery_cost <= 0) {
    throw new Error("Укажите сумму платной доставки");
  }
  // Итог заказа = товары + платная доставка
  const total = round2(linesTotal + (delivery.delivery_cost || 0));
  const vatAmount = includedVat(total, vatRate);

  const details = {
    phone: cleanText(data.customerPhone, 60),
    email: cleanText(data.email, 160),
    inn: cleanText(data.inn, 20),
    kpp: cleanText(data.kpp, 20),
    address: cleanText(data.address, 400) || delivery.delivery_address,
    contactName: cleanText(data.contactName, 160),
  };

  // ★ Создаём контрагента-покупателя
  const counterpartyId = await ensureCounterparty(customerName, "customer", {
    ...details, comment: data.comment,
  });

  // ★ Создаём заказ покупателя
  const { data: dealResult, error: dealError } = await db.from("customer_deals").insert({
    number, date, customer_name: customerName, counterparty_id: counterpartyId,
    customer_phone: details.phone,
    phone: details.phone, email: details.email,
    inn: details.inn, kpp: details.kpp,
    address: details.address, contact_name: details.contactName,
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    items, total, bank_adjustment: round2(total - linesTotal),
    vat_rate: vatRate, vat_amount: vatAmount,
    status: "new",
    ...delivery,
  }).select("id").single();
  if (dealError) throw dealError;

  // ★ Создаём входящий счёт(ы) — с учётом разбиения на части
  const paymentSplits = (Array.isArray(data.paymentSplits) ? data.paymentSplits : [])
    .map((n: any) => round2(Number(n) || 0))
    .filter((n: number) => n > 0);

  const targets: number[] = [];
  if (paymentSplits.length > 1) {
    // Масштабируем части, чтобы их сумма = total
    const reqSum = paymentSplits.reduce((s: number, n: number) => s + n, 0);
    const factor = reqSum > 0 ? total / reqSum : 1;
    for (let i = 0; i < paymentSplits.length; i++) {
      targets.push(i === paymentSplits.length - 1
        ? round2(total - targets.reduce((s, v) => round2(s + v), 0))
        : round2(paymentSplits[i] * factor)
      );
    }
  } else {
    targets.push(total);
  }

  // Способ оплаты: "cash" = наличные в кассу, иначе — безнал (счёт)
  const payMethod = String(data.paymentMethod || "regular");
  const isCash = payMethod === "cash";
  // paid_at — текстовая дата YYYY-MM-DD (как во всех остальных местах).
  // Раньше сюда писался полный ISO-таймстамп, из-за чего дата оплаты
  // выпадала из общего формата.
  const paidDate = date || new Date().toISOString().slice(0, 10);

  for (let i = 0; i < targets.length; i++) {
    const payNum = targets.length > 1 ? await nextNumber("payment") : paymentNumber;
    // Ошибку вставки не глотаем: иначе заказ создавался бы без платежа,
    // и оплата «пропадала» бы молча.
    const { error: payError } = await db.from("bank_payments").insert({
      number: payNum, date,
      direction: "incoming",
      type: isCash ? "cash" : "regular",
      counterparty: customerName, counterparty_id: counterpartyId,
      deal_ids: [dealResult.id], deal_numbers: [number],
      receipt_ids: [], receipt_numbers: [],
      amount: targets[i], invoice_number: null,
      vat_rate: vatRate, vat_amount: includedVat(targets[i], vatRate),
      is_paid: isCash, paid_at: isCash ? paidDate : null,
      exclude_from_balance: false,
      comment: isCash
        ? `Оплата наличными по заказу ЗК-${number}${targets.length > 1 ? ` (часть ${i + 1})` : ""}`
        : `Счёт покупателю по заказу ЗК-${number}${targets.length > 1 ? ` (часть ${i + 1})` : ""}`,
    });
    if (payError) {
      console.error("createDeal: не удалось создать платёж:", payError);
      throw new Error(`Не удалось создать платёж: ${payError.message}`);
    }
  }

  // Привязываем существующие платежи
  for (const payId of linkedPaymentIds) {
    const { data: pay } = await db.from("bank_payments").select("deal_ids, deal_numbers").eq("id", payId).maybeSingle();
    if (pay) {
      const dealIds = Array.isArray(pay.deal_ids) ? [...pay.deal_ids, dealResult.id] : [dealResult.id];
      const dealNumbers = Array.isArray(pay.deal_numbers) ? [...pay.deal_numbers, number] : [number];
      await db.from("bank_payments").update({ deal_ids: dealIds, deal_numbers: dealNumbers }).eq("id", payId);
    }
  }

  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("warehouse-counterparties", { expire: 0 });
  return { id: dealResult.id, number };
}

export async function postDeal(id: string, shippedItems?: { productId: string; quantity: number }[]): Promise<{ fullyShipped: boolean }> {
  const db = getAdminDb();
  const { data: deal } = await db.from("customer_deals").select("*").eq("id", id).single();
  if (!deal) throw new Error("Заказ не найден");
  if (deal.status === "completed") throw new Error("Уже проведён");
  if (deal.status === "cancelled") throw new Error("Заказ отменён");

  const dealItems = (deal.items || []) as StockDocItem[];
  // Остаток к отгрузке с учётом уже отгруженного (в т.ч. перевозками).
  const remainingRows = dealRemainingItems(dealItems, deal.shipped_items);
  const remainingMap = new Map(remainingRows.map((r) => [r.productId, r.remaining]));

  // ★ Считаем, сколько списываем ИМЕННО СЕЙЧАС.
  //   Раньше «полная отгрузка» списывала весь заказ повторно, даже если часть
  //   уже ушла перевозкой, — склад уходил в минус на величину дубля, а при
  //   отмене возвращалось только количество из shipped_items. Отсюда и
  //   пропадавшие ящики. Теперь списываем строго остаток.
  let toShip: { productId: string; quantity: number }[];
  if (!shippedItems || shippedItems.length === 0) {
    toShip = remainingRows
      .filter((r) => r.remaining > 0)
      .map((r) => ({ productId: r.productId, quantity: r.remaining }));
  } else {
    const requested = new Map<string, number>();
    for (const si of shippedItems) {
      const pid = String(si?.productId || "");
      const qty = Math.max(0, Number(si?.quantity) || 0);
      if (!pid || qty <= 0) continue;
      requested.set(pid, (requested.get(pid) || 0) + qty);
    }
    toShip = [];
    for (const [pid, qty] of requested) {
      // Больше остатка отгрузить нельзя — иначе shipped_items разойдётся
      // со складом и возврат при отмене будет неполным.
      const capped = Math.min(qty, remainingMap.get(pid) ?? 0);
      if (capped > 0) toShip.push({ productId: pid, quantity: capped });
    }
  }

  // Списываем со склада ровно то, что отгружаем
  for (const s of toShip) await adjustStock(s.productId, -s.quantity);

  // Обновляем кумулятивный shipped_items (по одной строке на товар)
  const shippedMap = shippedQtyMap(deal.shipped_items);
  for (const s of toShip) {
    shippedMap.set(s.productId, (shippedMap.get(s.productId) || 0) + s.quantity);
  }
  const orderedIds = orderedQtyMap(dealItems);
  const names = new Map<string, string>();
  for (const it of dealItems) {
    const pid = String(it.productId || "");
    if (pid && !names.has(pid)) names.set(pid, String(it.name || ""));
  }
  const newShipped = [...orderedIds.keys()].map((productId) => ({
    productId,
    name: names.get(productId) || "",
    shippedQty: shippedMap.get(productId) || 0,
  }));

  // Заказ без позиций закрываем сразу — списывать нечего.
  const fullyShipped =
    dealItems.length === 0 ? true : isDealFullyShipped(dealItems, newShipped);

  const updatePayload: any = {
    shipped_items: newShipped,
    updated_at: new Date().toISOString(),
  };

  if (fullyShipped) {
    updatePayload.status = "completed";
    updatePayload.delivery_released_at = new Date().toISOString();
  }

  await db.from("customer_deals").update(updatePayload).eq("id", id);
  // Перевозки должны видеть новый остаток: уменьшаем плановые количества,
  // а полностью отгруженный заказ убираем из активных перевозок.
  await syncDealTransportState(id);
  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("products", { expire: 0 });
  revalidateTag("deliveries", { expire: 0 });
  return { fullyShipped };
}

/** Отменить отгрузку (вернуть товары на склад, очистить shipped_items) */
export async function unshipDeal(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: deal } = await db.from("customer_deals").select("*").eq("id", id).single();
  if (!deal) throw new Error("Заказ не найден");

  // Возвращаем на склад ровно то, что было списано (по shipped_items,
  // а для старых проведённых заказов без них — все позиции заказа).
  await returnShippedToStock(deal);

  await db.from("customer_deals").update({
    shipped_items: [],
    // Отгрузка отменена — заказ снова активен и должен вернуться в доставки.
    status: "new",
    delivery_released_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  await syncDealTransportState(id);
  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("products", { expire: 0 });
  revalidateTag("deliveries", { expire: 0 });
}

export async function cancelDeal(id: string, reason: string | null = null): Promise<void> {
  const db = getAdminDb();
  const { data: deal } = await db.from("customer_deals").select("*").eq("id", id).single();
  if (!deal) throw new Error("Заказ не найден");
  if (deal.status === "cancelled") throw new Error("Уже отменён");

  // Если были отгрузки — возвращаем на склад ровно списанные количества.
  await returnShippedToStock(deal);

  await db.from("customer_deals").update({
    status: "cancelled", cancel_reason: reason,
    shipped_items: [],
    delivery_released_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  // Отменённый заказ убираем из активных перевозок.
  await removeDealFromActiveTransports(id);
  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("products", { expire: 0 });
  revalidateTag("deliveries", { expire: 0 });
}

export async function updateDeal(id: string, data: any): Promise<void> {
  const db = getAdminDb();
  const { data: existing, error: existErr } = await db.from("customer_deals").select("*").eq("id", id).single();
  if (existErr || !existing) throw new Error("Заказ не найден");
  if (existing.status === "completed") throw new Error("Нельзя редактировать проведённый заказ");

  const items = cleanItems(data.items);
  if (!data.customerName?.trim()) throw new Error("Укажите покупателя");
  if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");
  const linesTotal = itemsTotal(items);
  if (linesTotal <= 0) throw new Error("Укажите цену товаров, итог заказа должен быть больше нуля");

  const vatRate =
    data.vatRate !== undefined && data.vatRate !== null
      ? Number(data.vatRate)
      : Number(existing.vat_rate ?? VAT_RATE);
  const delivery = parseDealDelivery({
    hasDelivery:
      data.hasDelivery !== undefined
        ? data.hasDelivery
        : existing.has_delivery,
    deliveryType:
      data.deliveryType !== undefined
        ? data.deliveryType
        : existing.delivery_type,
    deliveryCost:
      data.deliveryCost !== undefined
        ? data.deliveryCost
        : existing.delivery_cost,
    deliveryAddress:
      data.deliveryAddress !== undefined
        ? data.deliveryAddress
        : existing.delivery_address,
    deliveryPlannedDate:
      data.deliveryPlannedDate !== undefined
        ? data.deliveryPlannedDate
        : existing.delivery_planned_date,
    deliveryNote:
      data.deliveryNote !== undefined
        ? data.deliveryNote
        : existing.delivery_note,
    address: data.address ?? existing.address,
  });
  if (delivery.has_delivery && !delivery.delivery_address) {
    throw new Error("Укажите адрес доставки");
  }
  if (delivery.has_delivery && delivery.delivery_type === "paid" && delivery.delivery_cost <= 0) {
    throw new Error("Укажите сумму платной доставки");
  }
  const total = round2(linesTotal + (delivery.delivery_cost || 0));
  const vatAmount = includedVat(total, vatRate);
  const customerName = String(data.customerName).slice(0, 200);
  const date = String(data.date || "").slice(0, 10);

  const details = {
    phone: cleanText(data.customerPhone, 60),
    email: cleanText(data.email, 160),
    inn: cleanText(data.inn, 20),
    kpp: cleanText(data.kpp, 20),
    address: cleanText(data.address, 400) || delivery.delivery_address,
    contactName: cleanText(data.contactName, 160),
  };

  // ★ Создаём/обновляем контрагента
  const counterpartyId = await ensureCounterparty(customerName, "customer", {
    ...details, comment: data.comment,
  });

  // Считаем оплаченную сумму по существующим платежам
  const { data: existingPayments } = await db.from("bank_payments").select("*");
  const dealPayments = (existingPayments || []).filter((p: any) =>
    Array.isArray(p.deal_ids) && p.deal_ids.includes(id)
  );
  const paidTotal = dealPayments.reduce((sum: number, p: any) => {
    const links = Math.max(1, (p.deal_ids || []).length);
    return p.is_paid === true && p.direction === "incoming"
      ? sum + (Number(p.amount) || 0) / links
      : sum;
  }, 0);
  const bankAdjustment = round2(total - linesTotal);

  // Обновляем заказ
  await db.from("customer_deals").update({
    date, customer_name: customerName, counterparty_id: counterpartyId,
    customer_phone: details.phone,
    phone: details.phone, email: details.email,
    inn: details.inn, kpp: details.kpp,
    address: details.address, contact_name: details.contactName,
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    items, total, bank_adjustment: bankAdjustment,
    vat_rate: vatRate, vat_amount: vatAmount,
    ...delivery,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  // ★ Синхронизация входящих платежей
  const unpaidSoloPayments = dealPayments.filter((p: any) => {
    if (p.is_paid === true) return false;
    const dealLinks = (p.deal_ids || []).length;
    const receiptLinks = (p.receipt_ids || []).length;
    return dealLinks === 1 && receiptLinks === 0;
  });

  // Способ оплаты заказа. Если явно не передан — наследуем от уже
  // существующих платежей: наличный заказ должен остаться наличным,
  // иначе при любом редактировании оплата превращалась в обычный счёт
  // и слетала отметка «оплачено».
  const inheritedCash = dealPayments.some(
    (p: any) => p.type === "cash" && p.direction === "incoming"
  );
  const dealIsCash =
    data.paymentMethod !== undefined
      ? String(data.paymentMethod) === "cash"
      : inheritedCash;
  const payType = dealIsCash ? "cash" : "regular";

  const remaining = Math.max(0, round2(total - paidTotal));

  // Разбиение на части (аналогично receipts)
  const paymentSplits = (Array.isArray(data.paymentSplits) ? data.paymentSplits : [])
    .map((n: any) => round2(Number(n) || 0))
    .filter((n: number) => n > 0);

  let targets: number[];
  if (remaining <= 0) {
    targets = [];
  } else if (paymentSplits.length > 1) {
    const reqSum = paymentSplits.reduce((s: number, n: number) => s + n, 0);
    const factor = reqSum > 0 ? remaining / reqSum : 1;
    targets = paymentSplits.map((n: number) => round2(n * factor));
    const headSum = targets.slice(0, -1).reduce((s: number, n: number) => s + n, 0);
    targets[targets.length - 1] = round2(remaining - headSum);
    targets = targets.filter((n: number) => n > 0);
  } else {
    targets = [remaining];
  }

  const payDate = date || new Date().toISOString().slice(0, 10);

  if (targets.length > 0 && unpaidSoloPayments.length === targets.length) {
    // Количество совпало — обновляем суммы (и тип, если заказ наличный)
    for (let i = 0; i < unpaidSoloPayments.length; i++) {
      await db.from("bank_payments").update({
        counterparty: customerName, counterparty_id: counterpartyId,
        type: payType,
        amount: targets[i], vat_rate: vatRate, vat_amount: includedVat(targets[i], vatRate),
        // Наличные считаются полученными сразу — деньги уже в кассе.
        is_paid: dealIsCash,
        paid_at: dealIsCash ? payDate : null,
      }).eq("id", unpaidSoloPayments[i].id);
    }
  } else {
    // Количество изменилось — удаляем старые неоплаченные и создаём новые
    for (const p of unpaidSoloPayments) {
      await db.from("bank_payments").delete().eq("id", p.id);
    }
    for (let i = 0; i < targets.length; i++) {
      const payNumber = await nextNumber("payment");
      await db.from("bank_payments").insert({
        number: payNumber, date,
        direction: "incoming", type: payType,
        counterparty: customerName, counterparty_id: counterpartyId,
        deal_ids: [id], deal_numbers: [existing.number],
        receipt_ids: [], receipt_numbers: [],
        amount: targets[i], invoice_number: null,
        vat_rate: vatRate, vat_amount: includedVat(targets[i], vatRate),
        // Наличные сразу помечаем оплаченными, безнал ждёт поступления.
        is_paid: dealIsCash,
        paid_at: dealIsCash ? payDate : null,
        exclude_from_balance: false,
        comment: dealIsCash
          ? `Оплата наличными по заказу ЗК-${existing.number}${targets.length > 1 ? ` (часть ${i + 1})` : ""}`
          : `Счёт покупателю по заказу ЗК-${existing.number}${targets.length > 1 ? ` (часть ${i + 1})` : ""}`,
      });
    }
  }

  // Привязываем существующие платежи
  const linkedPaymentIds = Array.isArray(data.linkedPaymentIds) ? data.linkedPaymentIds : [];
  for (const payId of linkedPaymentIds) {
    const { data: pay } = await db.from("bank_payments").select("deal_ids, deal_numbers").eq("id", payId).maybeSingle();
    if (pay) {
      const dealIds = Array.isArray(pay.deal_ids) ? [...new Set([...pay.deal_ids, id])] : [id];
      const dealNumbers = Array.isArray(pay.deal_numbers) ? [...new Set([...pay.deal_numbers, existing.number])] : [existing.number];
      await db.from("bank_payments").update({ deal_ids: dealIds, deal_numbers: dealNumbers }).eq("id", payId);
    }
  }

  invalidateCounterpartyCache();
  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
}

export async function deleteDeal(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: existing } = await db.from("customer_deals").select("*").eq("id", id).single();
  if (!existing) throw new Error("Заказ не найден");

  // Если были отгрузки — возвращаем на склад ровно списанные количества.
  await returnShippedToStock(existing);
  // Заказа больше нет — убираем его из активных перевозок.
  await removeDealFromActiveTransports(id);

  // ★ Удаляем связанные НЕПРОВЕДЁННЫЕ платежи, чтобы не приходилось
  //   чистить их руками в банке. Проведённые (is_paid) не трогаем —
  //   они уже повлияли на баланс; только отвязываем удаляемый заказ.
  try {
    const { data: payments } = await db
      .from("bank_payments")
      .select("*")
      .contains("deal_ids", [id]);

    for (const payment of payments || []) {
      const dealIds = Array.isArray(payment.deal_ids)
        ? payment.deal_ids.map((d: unknown) => String(d))
        : [];
      const dealNumbers = Array.isArray(payment.deal_numbers)
        ? payment.deal_numbers
        : [];
      const receiptLinks = Array.isArray(payment.receipt_ids) ? payment.receipt_ids : [];
      const onlyThisDeal = dealIds.length === 1 && dealIds[0] === String(id) && receiptLinks.length === 0;

      if (!payment.is_paid && onlyThisDeal) {
        // Непроведённый платёж, привязанный только к этому заказу — удаляем.
        await db.from("bank_payments").delete().eq("id", payment.id);
        continue;
      }

      // Остальные (проведённые или общие) — отвязываем заказ, платёж живёт.
      const newDealIds: string[] = [];
      const newDealNumbers: unknown[] = [];
      for (let i = 0; i < dealIds.length; i++) {
        if (dealIds[i] === String(id)) continue;
        newDealIds.push(dealIds[i]);
        if (i < dealNumbers.length) newDealNumbers.push(dealNumbers[i]);
      }
      await db
        .from("bank_payments")
        .update({ deal_ids: newDealIds, deal_numbers: newDealNumbers })
        .eq("id", payment.id);
    }
  } catch (e) {
    console.error("deleteDeal: ошибка удаления/отвязки платежей:", e);
  }

  // ★ Если заказ был создан из заявки с сайта — отвязываем заявку,
  //   чтобы не остался битый бейдж «В учёте: ЗК-…» и заявку можно было
  //   снова передать в работу.
  try {
    const sourceOrderId = existing.source_order_id ? String(existing.source_order_id) : null;
    if (sourceOrderId) {
      await db
        .from("orders")
        .update({
          deal_id: null,
          deal_number: null,
          payment_id: null,
          status: "new",
          updated_at: new Date().toISOString(),
        })
        .eq("id", sourceOrderId)
        .eq("deal_id", id);
    }
  } catch (e) {
    console.error("deleteDeal: ошибка отвязки исходной заявки:", e);
  }

  await db.from("customer_deals").delete().eq("id", id);
  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("orders", { expire: 0 });
  revalidateTag("products", { expire: 0 });
}

/** Обновить только поля доставки заказа учёта */
export async function updateDealDelivery(
  id: string,
  data: {
    hasDelivery?: boolean;
    deliveryType?: "free" | "paid" | null;
    deliveryCost?: number | null;
    deliveryAddress?: string | null;
    deliveryPlannedDate?: string | null;
    deliveryReleasedAt?: string | null;
    deliveryNote?: string | null;
    deliveryDriverId?: string | null;
    deliveryDriverName?: string | null;
    deliveryItems?: { productId: string; name: string; quantity: number }[];
    clearRelease?: boolean;
    clearDriver?: boolean;
  }
): Promise<CustomerDeal> {
  const db = getAdminDb();
  const { data: existing, error: existErr } = await db
    .from("customer_deals")
    .select("*")
    .eq("id", id)
    .single();
  if (existErr || !existing) throw new Error("Заказ не найден");

  const payload: Record<string, any> = { updated_at: new Date().toISOString() };

  if (data.hasDelivery !== undefined) payload.has_delivery = data.hasDelivery;
  if (data.deliveryType !== undefined) payload.delivery_type = data.deliveryType;
  if (data.deliveryCost !== undefined) {
    // ★ Сумма — источник правды для тарифа. Указали 0 (например, доставка
    //   бесплатна именно для этого клиента, хотя заказ ниже порога) —
    //   доставка становится бесплатной, а не «платной за 0 ₽».
    const willHaveDelivery =
      data.hasDelivery !== undefined ? data.hasDelivery : Boolean(existing.has_delivery);
    const tariff = normalizeDeliveryTariff(willHaveDelivery, data.deliveryCost);
    payload.delivery_cost = tariff.cost;
    payload.delivery_type = tariff.type;
  }
  if (data.deliveryAddress !== undefined) {
    payload.delivery_address = data.deliveryAddress
      ? String(data.deliveryAddress).trim().slice(0, 400)
      : null;
  }
  if (data.deliveryPlannedDate !== undefined) {
    payload.delivery_planned_date = data.deliveryPlannedDate || null;
  }
  if (data.clearRelease) {
    payload.delivery_released_at = null;
  } else if (data.deliveryReleasedAt !== undefined) {
    payload.delivery_released_at = data.deliveryReleasedAt;
  }
  if (data.deliveryNote !== undefined) {
    payload.delivery_note = data.deliveryNote
      ? String(data.deliveryNote).trim().slice(0, 1000)
      : null;
  }
  if (data.clearDriver) {
    payload.delivery_driver_id = null;
    payload.delivery_driver_name = null;
  } else {
    if (data.deliveryDriverId !== undefined) {
      payload.delivery_driver_id = data.deliveryDriverId || null;
    }
    if (data.deliveryDriverName !== undefined) {
      payload.delivery_driver_name = data.deliveryDriverName
        ? String(data.deliveryDriverName).trim().slice(0, 200)
        : null;
    }
  }

  if (data.deliveryItems !== undefined) {
    payload.delivery_items = data.deliveryItems;
  }

  if (data.hasDelivery === false) {
    payload.delivery_type = null;
    payload.delivery_cost = 0;
    payload.delivery_planned_date = null;
    payload.delivery_released_at = null;
    payload.delivery_driver_id = null;
    payload.delivery_driver_name = null;
    payload.delivery_items = [];
  }

  // Пересчёт total: позиции + платная доставка
  const items = Array.isArray(existing.items) ? existing.items : [];
  const linesTotal = round2(
    items.reduce((s: number, it: any) => s + (Number(it.lineTotal) || 0), 0)
  );
  const willHave =
    payload.has_delivery !== undefined
      ? payload.has_delivery
      : existing.has_delivery;
  const rawCost =
    payload.delivery_cost !== undefined
      ? payload.delivery_cost
      : existing.delivery_cost;
  // Тип и сумма всегда согласованы: 0 ₽ → бесплатная, > 0 ₽ → платная.
  const tariff = normalizeDeliveryTariff(Boolean(willHave), rawCost);
  const willCost = tariff.cost;
  if (willHave) {
    const addr =
      payload.delivery_address !== undefined
        ? payload.delivery_address
        : existing.delivery_address || existing.address;
    if (!addr) throw new Error("Адрес доставки обязателен");
  }
  payload.delivery_type = tariff.type;
  payload.delivery_cost = willCost;
  const total = round2(linesTotal + willCost);
  payload.total = total;
  payload.bank_adjustment = round2(total - linesTotal);
  payload.vat_amount = includedVat(total, Number(existing.vat_rate ?? VAT_RATE));
  // синхронизируем address если пуст
  if (payload.delivery_address && !existing.address) {
    payload.address = payload.delivery_address;
  }

  const { data: result, error } = await db
    .from("customer_deals")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  // Подтянуть сумму неоплаченного входящего счёта (solo)
  const { data: payments } = await db.from("bank_payments").select("*");
  const dealPayments = (payments || []).filter(
    (p: any) => Array.isArray(p.deal_ids) && p.deal_ids.includes(id)
  );
  const unpaidSolo = dealPayments.filter((p: any) => {
    if (p.is_paid) return false;
    return (p.deal_ids || []).length === 1 && (p.receipt_ids || []).length === 0;
  });
  if (unpaidSolo.length === 1) {
    await db
      .from("bank_payments")
      .update({
        amount: total,
        vat_amount: includedVat(total, Number(existing.vat_rate ?? VAT_RATE)),
      })
      .eq("id", unpaidSolo[0].id);
  }

  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("deliveries", { expire: 0 });
  return mapDealRow(result);
}

/** Заказы учёта с доставкой */
export async function getDealDeliveries(opts: {
  filter?: "unreleased" | "released" | "all";
  limit?: number;
  /**
   * true (по умолчанию) — отдавать только заказы, по которым остался долг.
   * Полностью отгруженные и отменённые заказы в доставке не нужны:
   * везти нечего, заказ закрыт.
   */
  onlyPending?: boolean;
} = {}): Promise<CustomerDeal[]> {
  const db = getAdminDb();
  let q = db
    .from("customer_deals")
    .select("*")
    .eq("has_delivery", true)
    .order("delivery_planned_date", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(opts.limit || 500);
  if (opts.filter === "unreleased") q = q.is("delivery_released_at", null);
  else if (opts.filter === "released") q = q.not("delivery_released_at", "is", null);
  const { data, error } = await q;
  if (error) throw error;
  const deals = (data || []).map(mapDealRow);
  if (opts.onlyPending === false) return deals;
  // Тот же предикат, что и на вкладке «Учёт → Доставки», — списки не расходятся.
  return deals.filter(dealNeedsDelivery);
}

// ─── Payments CRUD ─────────────────────────────────────────

export async function createPayment(data: any): Promise<{ id: string; number: number }> {
  const db = getAdminDb();
  const number = await nextNumber("payment");
  const vatRate = data.vatRate != null ? Number(data.vatRate) : VAT_RATE;
  const vatAmount = includedVat(data.amount || 0, vatRate);

  const { data: result, error } = await db.from("bank_payments").insert({
    number, date: String(data.date || "").slice(0, 10),
    direction: data.direction, type: data.type || "regular",
    counterparty: String(data.counterparty || "").slice(0, 200),
    counterparty_id: data.counterpartyId || null,
    deal_ids: data.dealIds || [], deal_numbers: [],
    receipt_ids: data.receiptIds || [], receipt_numbers: [],
    amount: Number(data.amount || 0), invoice_number: data.invoiceNumber ?? null,
    vat_rate: vatRate, vat_amount: vatAmount,
    is_paid: data.isPaid ?? false,
    paid_at: data.isPaid ? new Date().toISOString().slice(0, 10) : null,
    exclude_from_balance: data.excludeFromBalance ?? false,
    comment: cleanText(data.comment, 500),
  }).select("id").single();
  if (error) throw error;
  revalidateTag("warehouse-payments", { expire: 0 });
  return { id: result.id, number };
}

export async function updatePayment(id: string, data: any): Promise<void> {
  const db = getAdminDb();
  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  if (data.isPaid !== undefined) {
    payload.is_paid = data.isPaid;
    payload.paid_at = data.isPaid ? (data.date || new Date().toISOString().slice(0, 10)) : null;
  }
  if (data.excludeFromBalance !== undefined) payload.exclude_from_balance = data.excludeFromBalance;
  if (data.type !== undefined) payload.type = data.type;
  if (data.amount !== undefined) payload.amount = Number(data.amount);
  if (data.comment !== undefined) payload.comment = cleanText(data.comment, 500);
  if (data.date !== undefined) payload.date = String(data.date).slice(0, 10);
  if (data.counterparty !== undefined) payload.counterparty = String(data.counterparty).slice(0, 200);
  if (data.invoiceNumber !== undefined) payload.invoice_number = data.invoiceNumber;
  if (data.dealIds !== undefined) payload.deal_ids = data.dealIds;
  if (data.receiptIds !== undefined) payload.receipt_ids = data.receiptIds;
  const { error } = await db.from("bank_payments").update(payload).eq("id", id);
  if (error) throw error;
  revalidateTag("warehouse-payments", { expire: 0 });
}

export async function deletePayment(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: existing } = await db.from("bank_payments").select("*").eq("id", id).single();
  if (!existing) throw new Error("Платёж не найден");
  if (existing.is_paid) throw new Error("Нельзя удалить проведённый платёж");
  await db.from("bank_payments").delete().eq("id", id);
  revalidateTag("warehouse-payments", { expire: 0 });
}

// ─── Warehouse data loaders ────────────────────────────────

async function fetchReceipts(): Promise<WarehouseReceipt[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("warehouse_receipts").select("*").order("date", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapReceiptRow);
}
async function fetchDeals(): Promise<CustomerDeal[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("customer_deals").select("*").order("date", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapDealRow);
}
async function fetchPayments(): Promise<BankPayment[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("bank_payments").select("*").order("date", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapPaymentRow);
}
async function fetchEmployees(): Promise<Employee[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("employees").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapEmployeeRow);
}
async function fetchSalaries(): Promise<Salary[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("salaries").select("*").order("date", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapSalaryRow);
}

export const getCachedReceipts = () => unstable_cache(fetchReceipts, ["warehouse-receipts"], { revalidate: 60, tags: ["warehouse-receipts"] })();
export const getCachedDeals = () => unstable_cache(fetchDeals, ["warehouse-deals"], { revalidate: 60, tags: ["warehouse-deals"] })();
export const getCachedPayments = () => unstable_cache(fetchPayments, ["warehouse-payments"], { revalidate: 60, tags: ["warehouse-payments"] })();
export const getCachedEmployees = () => unstable_cache(fetchEmployees, ["warehouse-employees"], { revalidate: 60, tags: ["warehouse-employees"] })();
export const getCachedSalaries = () => unstable_cache(fetchSalaries, ["warehouse-salaries"], { revalidate: 60, tags: ["warehouse-salaries"] })();

// Aliases
export const getReceipts = getCachedReceipts;
export const getDeals = getCachedDeals;
export const getPayments = getCachedPayments;
export const getEmployees = getCachedEmployees;
export const getSalaries = getCachedSalaries;

// ─── Employees & Salaries ──────────────────────────────────

export async function saveEmployee(data: { id?: string | null; name: string; position?: string | null; phone?: string | null; comment?: string | null }): Promise<{ id: string }> {
  const db = getAdminDb();
  if (data.id) {
    const { error } = await db.from("employees").update({
      name: data.name, position: data.position ?? null, phone: data.phone ?? null, comment: data.comment ?? null,
    }).eq("id", data.id);
    if (error) throw error;
    revalidateTag("warehouse-employees", { expire: 0 });
    return { id: data.id };
  }
  const { data: result, error } = await db.from("employees").insert({
    name: data.name, position: data.position ?? null, phone: data.phone ?? null, comment: data.comment ?? null,
  }).select("id").single();
  if (error) throw error;
  revalidateTag("warehouse-employees", { expire: 0 });
  return { id: result.id };
}

export async function deleteEmployee(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("employees").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("warehouse-employees", { expire: 0 });
}

export async function createSalary(data: { employeeId?: string | null; employeeName: string; amount: number; date: string; source: SalarySource; isPaid?: boolean; comment?: string | null }): Promise<{ id: string }> {
  const db = getAdminDb();
  const { data: result, error } = await db.from("salaries").insert({
    employee_id: data.employeeId ?? null, employee_name: data.employeeName,
    amount: data.amount, date: data.date.slice(0, 10), source: data.source,
    is_paid: data.isPaid ?? false, paid_at: data.isPaid ? data.date.slice(0, 10) : null,
    comment: data.comment ?? null,
  }).select("id").single();
  if (error) throw error;
  revalidateTag("warehouse-salaries", { expire: 0 });
  return { id: result.id };
}

export async function updateSalary(id: string, data: Partial<Salary>): Promise<void> {
  const db = getAdminDb();
  const payload: Record<string, any> = {};
  if (data.amount !== undefined) payload.amount = data.amount;
  if (data.date) payload.date = data.date.slice(0, 10);
  if (data.source) payload.source = data.source;
  if (data.isPaid !== undefined) { payload.is_paid = data.isPaid; payload.paid_at = data.isPaid ? (data.paidAt || data.date?.slice(0, 10) || null) : null; }
  if (data.comment !== undefined) payload.comment = data.comment;
  const { error } = await db.from("salaries").update(payload).eq("id", id);
  if (error) throw error;
  revalidateTag("warehouse-salaries", { expire: 0 });
}

export async function deleteSalary(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("salaries").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("warehouse-salaries", { expire: 0 });
}

// ─── Cash collections (сдача кассы / инкассация) ──────────

export interface CashCollectionRow {
  id: string;
  date: string;
  amount: number;
  /** Часть, сданная наличными (виртуальная карта «наличка») */
  cashAmount: number;
  /** Часть, сданная инкассацией на карту (вне расчётного счёта) */
  transferAmount: number;
  /** Разметка платежей, вошедших в сдачу */
  items: CashCollectionItem[];
  /** Наличные траты дня, вычтенные из прихода */
  expenses: CashCollectionExpense[];
  /** Сумма трат налом */
  expensesAmount: number;
  /** Приход за день до вычета трат */
  incomeAmount: number;
  note?: string | null;
  createdAt?: string | null;
}

async function fetchCashCollections(): Promise<CashCollectionRow[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("cash_collections")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => {
    const amount = Number(row.amount) || 0;
    const transferAmount = Number(row.transfer_amount) || 0;
    // Старые записи (до разделения) считаем полностью наличными.
    const cashAmount =
      row.cash_amount != null
        ? Number(row.cash_amount) || 0
        : amount - transferAmount;
    return {
      id: row.id,
      date: row.date,
      amount,
      cashAmount,
      transferAmount,
      items: (Array.isArray(row.items) ? row.items : []).map((it: any) => ({
        ...it,
        // "transfer" — устаревшее имя для инкассации на карту.
        kind: normalizeCashKind(it?.kind),
      })),
      // Траты и приход появились позже; у старых сдач их нет —
      // тогда приходом считаем саму сумму сдачи, трат нет.
      expenses: Array.isArray(row.expenses) ? row.expenses : [],
      expensesAmount: Number(row.expenses_amount) || 0,
      incomeAmount:
        row.income_amount != null ? Number(row.income_amount) || 0 : amount,
      note: row.note ?? null,
      createdAt: toIso(row.created_at),
    };
  });
}

export const getCashCollections = () =>
  unstable_cache(fetchCashCollections, ["warehouse-cash-collections"], {
    revalidate: 60,
    tags: ["warehouse-cash-collections"],
  })();

/** Текущий остаток кассы по серверным данным (правило getBankSummary). */
function computeCashBalance(
  payments: BankPayment[],
  salaries: Salary[],
  collections: CashCollectionRow[]
): number {
  let cashBalance = 0;
  for (const p of payments) {
    if (!p.isPaid || p.excludeFromBalance) continue;
    const amt = p.direction === "incoming" ? p.amount : -p.amount;
    if (p.type === "cash") cashBalance += amt;
  }
  for (const s of salaries) {
    if (s.isPaid && s.source === "cash") cashBalance -= s.amount;
  }
  for (const c of collections) cashBalance -= c.amount;
  return Math.round(cashBalance * 100) / 100;
}

/**
 * Наличные поступления, ещё не вошедшие ни в одну сдачу кассы.
 *
 * В список попадают ТОЛЬКО проведённые входящие платежи с типом "cash" —
 * то есть деньги, которые физически лежат в кассе. Безналичные платежи по
 * расчётному счёту (type "regular"/"transfer"/"deposit"/"refund") к кассе
 * отношения не имеют и здесь не показываются, чтобы сдача кассы не списывала
 * деньги с расчётного счёта.
 *
 * Менеджер размечает каждый платёж: уходит он инкассацией на карту или
 * остаётся наличными (виртуальная карта «наличка»).
 */
export async function getPendingCashPayments(): Promise<{
  pending: {
    paymentId: string;
    number: number;
    date: string;
    counterparty: string;
    amount: number;
    comment: string | null;
  }[];
  expenses: CashExpenseRow[];
}> {
  const [payments, salaries, collections] = await Promise.all([
    fetchPayments(),
    fetchSalaries(),
    fetchCashCollections(),
  ]);
  return {
    pending: listPendingCashPayments(payments, collections).map((p) => ({
      paymentId: String(p.id),
      number: p.number,
      date: p.date,
      counterparty: p.counterparty,
      amount: p.amount,
      comment: p.comment ?? null,
    })),
    // Наличные траты (ЗП и прочие расходы налом) — их вычитаем из
    // прихода, потому что эти деньги уже ушли из кассы.
    expenses: listCashExpenses(payments, salaries),
  };
}

/** Платёж относится к кассе: наличное поступление, влияющее на остаток. */
function isCashDeskIncome(p: BankPayment): boolean {
  return (
    p.isPaid &&
    !p.excludeFromBalance &&
    p.type === "cash" &&
    p.direction === "incoming" &&
    p.amount > 0
  );
}

/** Наличный расход из кассы: зарплата или исходящий платёж налом. */
export interface CashExpenseRow {
  kind: "salary" | "payment";
  id: string;
  date: string;
  title: string;
  amount: number;
  comment: string | null;
}

/**
 * Наличные расходы, уменьшившие кассу: выплаченные налом зарплаты и
 * проведённые исходящие платежи с типом "cash".
 *
 * Эти деньги физически ушли из кассы до сдачи, поэтому сдавать нужно
 * приход МИНУС расходы. Безнала здесь нет: только type='cash' и
 * source='cash'.
 */
function listCashExpenses(
  payments: BankPayment[],
  salaries: Salary[]
): CashExpenseRow[] {
  const rows: CashExpenseRow[] = [];

  for (const s of salaries) {
    if (!s.isPaid || s.source !== "cash" || s.amount <= 0) continue;
    rows.push({
      kind: "salary",
      id: String(s.id),
      date: (s.paidAt || s.date || "").slice(0, 10),
      title: `Зарплата — ${s.employeeName || "сотрудник"}`,
      amount: s.amount,
      comment: s.comment ?? null,
    });
  }

  for (const p of payments) {
    if (
      !p.isPaid ||
      p.excludeFromBalance ||
      p.type !== "cash" ||
      p.direction !== "outgoing" ||
      p.amount <= 0
    ) {
      continue;
    }
    rows.push({
      kind: "payment",
      id: String(p.id),
      date: (p.paidAt || p.date || "").slice(0, 10),
      title: `ПЛ-${p.number} — ${p.counterparty || "расход"}`,
      amount: p.amount,
      comment: p.comment ?? null,
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Наличные поступления, ещё не размеченные ни в одной сдаче кассы. */
function listPendingCashPayments(
  payments: BankPayment[],
  collections: CashCollectionRow[]
): BankPayment[] {
  const collected = new Set<string>();
  for (const c of collections) {
    for (const it of c.items || []) {
      if (it?.paymentId) collected.add(String(it.paymentId));
    }
  }
  return payments
    .filter((p) => isCashDeskIncome(p) && !collected.has(String(p.id)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
}

/**
 * Сдача кассы (инкассация).
 *
 * Из кассы уходят ТОЛЬКО наличные платежи. Основной безналичный счёт в банке
 * при этом не затрагивается ни в какую сторону: он к кассе не относится.
 * Каждый наличный платёж размечается, куда он ушёл:
 *   - "card" — инкассация на карту (Юлия Марковна / кто указан в настройках);
 *   - "cash" — наличные (виртуальная карта, куда уходит сданная касса).
 *
 * Суммы считаются на сервере из самих платежей, чтобы исключить гонку
 * с клиентом и «сдачу» денег, которых в кассе нет.
 */
export async function collectCash(
  note?: string | null,
  items?: {
    paymentId: string;
    kind?: CashKind | "transfer";
    /** Ручная разбивка: сколько оставить наличными */
    cashAmount?: number;
    /** Ручная разбивка: сколько инкассировать на карту */
    cardAmount?: number;
    /** Ручная разбивка: сколько забрать на расходы (ЗП и прочее) */
    expenseAmount?: number;
  }[]
): Promise<{ amount: number; cashAmount: number; transferAmount: number }> {
  const db = getAdminDb();
  const [payments, salaries, collections] = await Promise.all([
    fetchPayments(),
    fetchSalaries(),
    fetchCashCollections(),
  ]);

  const cashBalance = computeCashBalance(payments, salaries, collections);
  if (cashBalance < -0.009) {
    // Отрицательная касса = учёт разошёлся (обычно приход, покрытый старой
    // сдачей, стал безналичным). Новая сдача только усугубит расхождение.
    throw new Error(
      `Остаток кассы отрицательный (${cashBalance} ₽) — учёт разошёлся. ` +
        "Сдача заблокирована: сначала проверьте типы платежей и суммы прошлых сдач."
    );
  }
  if (cashBalance <= 0.009) {
    throw new Error("Касса пуста — нечего сдавать");
  }

  const cleanNote = note ? cleanText(note, 500) : null;
  const pending = listPendingCashPayments(payments, collections);

  // ── Без разметки: сдаём все неразмеченные наличные платежи как «наличные».
  // Раньше здесь списывался весь остаток кассы одной суммой без привязки
  // к платежам — из-за этого сдача могла «съесть» деньги, к наличке
  // отношения не имеющие. Теперь сдаются строго конкретные платежи.
  type RequestedItem = {
    paymentId: string;
    kind?: CashKind | "transfer";
    cashAmount?: number;
    cardAmount?: number;
    expenseAmount?: number;
  };
  const requested: RequestedItem[] =
    items && items.length > 0
      ? items
      : pending.map((p) => ({ paymentId: String(p.id), kind: "cash" as const }));

  if (requested.length === 0) {
    throw new Error(
      "Нет наличных поступлений для сдачи: все наличные платежи уже сданы"
    );
  }

  const alreadyCollected = new Set<string>();
  for (const c of collections) {
    for (const it of c.items || []) {
      if (it?.paymentId) alreadyCollected.add(String(it.paymentId));
    }
  }
  const payById = new Map(payments.map((p) => [String(p.id), p]));

  const rows: CashCollectionItem[] = [];
  const seen = new Set<string>();
  let cashAmount = 0;
  let cardAmount = 0;
  // Сколько денег забрали на расходы прямо с платежей (ручная разбивка).
  let coveredByItems = 0;

  for (const raw of requested) {
    const id = String(raw?.paymentId || "");
    if (!id || seen.has(id)) continue;
    if (alreadyCollected.has(id)) {
      throw new Error("Один из платежей уже вошёл в предыдущую сдачу кассы");
    }
    const p = payById.get(id);
    if (!p) throw new Error("Платёж не найден");
    // Ключевая защита: в сдачу кассы попадают только наличные поступления.
    // Безналичные платежи расчётного счёта сюда не пускаем.
    if (!isCashDeskIncome(p)) {
      throw new Error(
        `Платёж ПЛ-${p.number} нельзя сдать: это не наличное поступление в кассу`
      );
    }
    seen.add(id);

    // Ручная разбивка платежа: сколько наличными, сколько на карту,
    // сколько забрали на расходы (например, 1000 из 1500 в счёт ЗП).
    // Если разбивки нет — работает старое правило «весь платёж одним видом».
    const hasSplit =
      raw?.cashAmount != null ||
      raw?.cardAmount != null ||
      raw?.expenseAmount != null;

    let itemCash: number;
    let itemCard: number;
    let itemExpense: number;

    if (hasSplit) {
      itemCash = round2(Math.max(0, Number(raw?.cashAmount) || 0));
      itemCard = round2(Math.max(0, Number(raw?.cardAmount) || 0));
      itemExpense = round2(Math.max(0, Number(raw?.expenseAmount) || 0));
      const sum = round2(itemCash + itemCard + itemExpense);
      if (Math.abs(sum - p.amount) > 0.01) {
        throw new Error(
          `ПЛ-${p.number}: разбивка ${sum} ₽ не совпадает с суммой платежа ${p.amount} ₽`
        );
      }
    } else {
      const kind = normalizeCashKind(raw?.kind);
      itemCash = kind === "cash" ? p.amount : 0;
      itemCard = kind === "card" ? p.amount : 0;
      itemExpense = 0;
    }

    cashAmount += itemCash;
    cardAmount += itemCard;
    coveredByItems += itemExpense;

    rows.push({
      paymentId: id,
      number: p.number,
      counterparty: p.counterparty,
      amount: p.amount,
      // Преобладающее направление — для совместимости со старым чтением.
      kind: itemCard > itemCash ? "card" : "cash",
      cashAmount: itemCash,
      cardAmount: itemCard,
      expenseAmount: itemExpense,
    });
  }
  coveredByItems = round2(coveredByItems);

  if (rows.length === 0) {
    throw new Error("Выберите хотя бы один платёж для сдачи");
  }

  // Сдача кассы идёт за конкретный день, поэтому дата записи — это дата
  // самих платежей, а не «сегодня». Иначе отчёт за 27.07 попадал бы в 28.07.
  const payDates = [
    ...new Set(rows.map((r) => payById.get(String(r.paymentId))?.date || "")),
  ].filter(Boolean);
  if (payDates.length > 1) {
    throw new Error(
      "В одну сдачу можно включать платежи только за один день. Сдайте каждый день отдельно."
    );
  }
  const date = payDates[0] || new Date().toISOString().slice(0, 10);

  cashAmount = Math.round(cashAmount * 100) / 100;
  cardAmount = Math.round(cardAmount * 100) / 100;

  // ── Наличные траты этого дня (ЗП и прочие расходы налом) ──
  // Эти деньги физически ушли из кассы до сдачи, поэтому сдаётся
  // приход МИНУС траты. Иначе сдали бы больше, чем есть, и остаток
  // кассы ушёл бы в минус ровно на сумму трат.
  const expensesOfDay = listCashExpenses(payments, salaries).filter(
    (e) => e.date === date
  );
  const expensesTotal =
    Math.round(expensesOfDay.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;

  // Часть трат кассир мог расписать вручную прямо по платежам
  // (например, 1000 из ПЛ-5 в счёт ЗП). Эти деньги уже вычтены из
  // cashAmount/cardAmount, поэтому второй раз их вычитать нельзя.
  const remainingExpenses = Math.max(0, round2(expensesTotal - coveredByItems));

  // Остаток трат покрывается физической наличкой; если её не хватило —
  // списывается с инкассируемой на карту части.
  let cashPart = round2(cashAmount - remainingExpenses);
  let cardPart = cardAmount;
  if (cashPart < 0) {
    cardPart = round2(cardPart + cashPart);
    cashPart = 0;
  }
  if (cardPart < 0) cardPart = 0;

  const amount = Math.round((cashPart + cardPart) * 100) / 100;

  if (amount <= 0.009) {
    throw new Error(
      `Наличные траты за ${date} (${expensesTotal} ₽) покрывают весь приход — сдавать нечего`
    );
  }

  if (amount > cashBalance + 0.009) {
    throw new Error(
      `Сумма сдачи (${amount} ₽) больше остатка кассы (${cashBalance} ₽)`
    );
  }

  cashAmount = cashPart;
  cardAmount = cardPart;

  // Траты сохраняем в самой записи сдачи: тогда детализация останется
  // верной, даже если зарплату или платёж потом отредактируют.
  const expenseRows: CashCollectionExpense[] = expensesOfDay.map((e) => ({
    kind: e.kind,
    id: e.id,
    title: e.title,
    amount: e.amount,
    comment: e.comment,
  }));

  const { error } = await db.from("cash_collections").insert({
    date,
    amount,
    cash_amount: cashAmount,
    // transfer_amount исторически хранит инкассацию на карту.
    transfer_amount: cardAmount,
    items: rows,
    expenses: expenseRows,
    income_amount: round2(cashPart + cardPart + expensesTotal),
    expenses_amount: expensesTotal,
    note: cleanNote,
  });
  if (error) throw error;
  revalidateTag("warehouse-cash-collections", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("warehouse-salaries", { expire: 0 });
  return { amount, cashAmount, transferAmount: cardAmount };
}

/**
 * Закрыть старые наличные платежи без инкассации.
 *
 * Инкассация ведётся с определённой даты, а в кассе висят более ранние
 * платежи — их не нужно сдавать, нужно просто убрать из списка и из
 * остатка кассы. Помечаем их exclude_from_balance: документ остаётся
 * в истории, но на баланс не влияет.
 *
 * Затрагиваются ТОЛЬКО наличные приходы (type='cash'). Безналичный
 * расчётный счёт не трогается.
 */
export async function closeOldCashPayments(
  paymentIds: string[]
): Promise<{ closed: number; amount: number }> {
  const db = getAdminDb();
  const ids = [...new Set(paymentIds.map((x) => String(x || "").trim()))].filter(
    Boolean
  );
  if (ids.length === 0) throw new Error("Не выбрано ни одного платежа");

  const payments = await fetchPayments();
  const byId = new Map(payments.map((p) => [String(p.id), p]));

  let amount = 0;
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) throw new Error("Платёж не найден");
    if (!isCashDeskIncome(p)) {
      throw new Error(
        `ПЛ-${p.number} нельзя закрыть: это не наличное поступление в кассу`
      );
    }
    amount += p.amount;
  }

  const { error } = await db
    .from("bank_payments")
    .update({ exclude_from_balance: true })
    .in("id", ids);
  if (error) throw error;

  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("warehouse-cash-collections", { expire: 0 });
  return { closed: ids.length, amount: round2(amount) };
}

export async function deleteCashCollection(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("cash_collections").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("warehouse-cash-collections", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("warehouse-salaries", { expire: 0 });
}

// ─── Convert order to deal (КЛЮЧЕВАЯ ФУНКЦИЯ) ──────────────

export async function convertOrderToDeal(orderId: string): Promise<{ dealId: string; dealNumber: number; paymentId: string; skipped: boolean }> {
  const db = getAdminDb();
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order) throw new Error("Заявка не найдена");
  if (order.deal_id) return { dealId: order.deal_id, dealNumber: order.deal_number || 0, paymentId: order.payment_id || "", skipped: true };

  const items: StockDocItem[] = Array.isArray(order.items)
    ? order.items.map((i: any) => ({
        productId: String(i.productId || ""),
        name: String(i.name || "").slice(0, 200),
        sku: i.sku ? String(i.sku).slice(0, 80) : "—",
        quantity: Math.max(0, Math.min(100_000, Number(i.quantity) || 0)),
        price: Math.max(0, Number(i.price) || 0),
        lineTotal: round2(Math.max(0, Number(i.quantity) || 0) * Math.max(0, Number(i.price) || 0)),
      }))
    : [];

  if (items.length === 0) throw new Error("В заявке нет товаров");

  const linesTotal = itemsTotal(items);
  const number = await nextNumber("deal");
  const date = new Date().toISOString().slice(0, 10);
  const personName = order.customer_name || "Клиент";
  // Для юрлиц главный идентификатор в учёте — карточка предприятия
  // (наименование организации из заявки), а не имя контакта из ЛК.
  const isLegalEntity = order.customer_type === "legal";
  const companyName = cleanText(order.company_name, 200);
  const customerName = isLegalEntity && companyName ? companyName : personName;
  // Адрес из заявки сайта (клиент указал при оформлении)
  const orderAddress = cleanText(
    order.delivery_address || order.actual_address || order.legal_address,
    400
  );

  // ★ Создаём/обновляем контрагента-покупателя.
  //   Юрлицо → контрагент с наименованием организации и полными
  //   реквизитами из карточки предприятия (ИНН/КПП/ОГРН/адреса/банк),
  //   контактное лицо сохраняется отдельно.
  const counterpartyId = await ensureCounterparty(customerName, "customer", {
    phone: order.customer_phone,
    email: order.customer_email,
    inn: order.inn,
    kpp: order.kpp,
    ogrn: order.ogrn,
    fullName: isLegalEntity ? companyName ?? undefined : undefined,
    shortName: cleanText(order.short_name, 200) ?? undefined,
    legalAddress: cleanText(order.legal_address, 400),
    taxSystem: order.tax_system,
    bankAccount: order.bank_account,
    bankName: order.bank_name,
    bik: order.bik,
    correspondentAccount: order.correspondent_account,
    address: orderAddress,
    contactName: isLegalEntity ? personName : undefined,
    comment: order.comment,
  });

  // Сумму берём из заявки сайта: она уже включает выбранную клиентом
  // доставку и возможные скидки корзины. Если по старым заявкам total_sum
  // не заполнен, используем сумму товарных строк.
  const requestedTotal = round2(Number(order.total_sum) || 0);
  const total = requestedTotal > 0 ? requestedTotal : linesTotal;
  const bankAdjustment = round2(total - linesTotal);
  const deliveryCostFromOrder = Math.max(0, Number(order.delivery_cost) || 0);
  const inferredDeliveryCost =
    deliveryCostFromOrder > 0
      ? round2(deliveryCostFromOrder)
      : bankAdjustment > 0
        ? bankAdjustment
        : 0;
  const hasDelivery = Boolean(
    order.has_delivery || order.delivery_address || inferredDeliveryCost > 0
  );
  const deliveryType = hasDelivery
    ? order.delivery_type === "paid" || inferredDeliveryCost > 0
      ? "paid"
      : "free"
    : null;
  const deliveryCost = deliveryType === "paid" ? inferredDeliveryCost : 0;
  const vatAmount = includedVat(total, VAT_RATE);

  // ★ Создаём заказ покупателя с привязкой к контрагенту
  const { data: dealResult, error: dealError } = await db.from("customer_deals").insert({
    number, date, customer_name: customerName, counterparty_id: counterpartyId,
    customer_phone: order.customer_phone,
    phone: order.customer_phone,
    email: order.customer_email || null,
    inn: order.inn || null,
    kpp: order.kpp || null,
    address: orderAddress,
    contact_name: isLegalEntity ? personName : null,
    comment: order.comment ? `Из заявки с сайта. ${String(order.comment).slice(0, 400)}` : "Из заявки с сайта",
    items, total, bank_adjustment: bankAdjustment,
    vat_rate: VAT_RATE, vat_amount: vatAmount,
    status: "new", source_order_id: orderId,
    has_delivery: hasDelivery,
    delivery_type: deliveryType,
    delivery_cost: deliveryCost,
    delivery_address: hasDelivery ? orderAddress : null,
    delivery_note: cleanText(order.delivery_note, 1000),
  }).select("id").single();
  if (dealError) throw dealError;

  // ★ Создаём входящий платёж — тип зависит от способа оплаты из заявки
  const paymentNumber = await nextNumber("payment");
  const orderPayMethod = String(order.payment_method || "");
  const isCash = orderPayMethod === "cash";
  const isTransfer = orderPayMethod === "transfer";
  // paid_at — текстовая дата YYYY-MM-DD, как и в остальных местах учёта.
  const paidDate = date || new Date().toISOString().slice(0, 10);
  const payComment = isCash
    ? `Оплата наличными по заказу ЗК-${number} (из заявки с сайта)`
    : isTransfer
    ? `Перевод по заказу ЗК-${number} (из заявки с сайта)`
    : `Счёт покупателю по заказу ЗК-${number} (из заявки с сайта)`;

  const { data: paymentResult, error: paymentError } = await db.from("bank_payments").insert({
    number: paymentNumber, date,
    direction: "incoming",
    type: isCash ? "cash" : "regular",
    counterparty: customerName, counterparty_id: counterpartyId,
    deal_ids: [dealResult.id], deal_numbers: [number],
    receipt_ids: [], receipt_numbers: [],
    amount: total, vat_rate: VAT_RATE, vat_amount: vatAmount,
    is_paid: isCash,
    paid_at: isCash ? paidDate : null,
    exclude_from_balance: false,
    comment: payComment,
  }).select("id").single();
  if (paymentError) {
    console.error("Payment creation error:", paymentError);
    throw new Error(`Не удалось создать платёж: ${paymentError.message}`);
  }
  if (!paymentResult) {
    throw new Error("Платёж не был создан (пустой результат)");
  }

  // ★ Связываем заявку с созданными документами
  await db.from("orders").update({
    deal_id: dealResult.id, deal_number: number,
    payment_id: paymentResult.id, updated_at: new Date().toISOString(),
  }).eq("id", orderId);

  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("orders", { expire: 0 });
  revalidateTag("warehouse-counterparties", { expire: 0 });
  return { dealId: dealResult.id, dealNumber: number, paymentId: paymentResult.id, skipped: false };
}

/**
 * Убрать заявку из работы: удаляем созданный из неё заказ учёта и
 * автоматически созданный платёж, затем возвращаем заявку в статус «Новая».
 * Ручные платежи не удаляем — только отвязываем их от удаляемого ЗК.
 */
export async function returnOrderFromWork(orderId: string): Promise<{
  dealId: string | null;
  paymentIds: string[];
}> {
  const db = getAdminDb();
  const { data: order, error: orderError } = await db
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (orderError || !order) throw new Error("Заявка не найдена");

  const dealId = order.deal_id ? String(order.deal_id) : null;
  const paymentIds: string[] = [];

  if (dealId) {
    const { data: deal } = await db
      .from("customer_deals")
      .select("*")
      .eq("id", dealId)
      .maybeSingle();

    if (deal) {
      const shipped = (Array.isArray(deal.shipped_items) ? deal.shipped_items : []) as {
        shippedQty?: number;
      }[];
      const shippedTotal = shipped.reduce((sum, item) => sum + (Number(item.shippedQty) || 0), 0);
      if (deal.status === "completed" || shippedTotal > 0) {
        throw new Error(
          "Нельзя убрать из работы: заказ в учёте уже отгружен. Сначала отмените отгрузку в учёте."
        );
      }

      const { data: payments } = await db
        .from("bank_payments")
        .select("*")
        .contains("deal_ids", [dealId]);

      for (const payment of payments || []) {
        const dealIds = Array.isArray(payment.deal_ids)
          ? payment.deal_ids.map((id: unknown) => String(id))
          : [];
        const dealNumbers = Array.isArray(payment.deal_numbers)
          ? payment.deal_numbers
          : [];
        const receiptIds = Array.isArray(payment.receipt_ids) ? payment.receipt_ids : [];
        const isAutoPayment =
          order.payment_id && String(payment.id) === String(order.payment_id);
        const hasOnlyThisDeal =
          dealIds.length === 1 && dealIds[0] === dealId && receiptIds.length === 0;

        if (isAutoPayment && hasOnlyThisDeal) {
          const { error } = await db.from("bank_payments").delete().eq("id", payment.id);
          if (error) throw error;
          paymentIds.push(String(payment.id));
          continue;
        }

        const newDealIds: string[] = [];
        const newDealNumbers: unknown[] = [];
        for (let i = 0; i < dealIds.length; i++) {
          if (dealIds[i] === dealId) continue;
          newDealIds.push(dealIds[i]);
          if (i < dealNumbers.length) newDealNumbers.push(dealNumbers[i]);
        }
        const { error } = await db
          .from("bank_payments")
          .update({ deal_ids: newDealIds, deal_numbers: newDealNumbers })
          .eq("id", payment.id);
        if (error) throw error;
      }

      const { error: deleteDealError } = await db
        .from("customer_deals")
        .delete()
        .eq("id", dealId);
      if (deleteDealError) throw deleteDealError;
    }
  }

  const { error: updateOrderError } = await db.from("orders").update({
    status: "new",
    close_reason: null,
    deal_id: null,
    deal_number: null,
    payment_id: null,
    updated_at: new Date().toISOString(),
  }).eq("id", orderId);
  if (updateOrderError) throw updateOrderError;

  revalidateTag("orders", { expire: 0 });
  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  return { dealId, paymentIds };
}

// ─── Supplier prices ───────────────────────────────────────

export async function updateSupplierPriceList(
  counterpartyId: string,
  prices: { productId: string; price: number }[]
): Promise<void> {
  const db = getAdminDb();
  const { data: cp } = await db.from("counterparties").select("roles, supplier_prices").eq("id", counterpartyId).maybeSingle();
  if (!cp) throw new Error("Поставщик не найден");
  const roles = Array.isArray(cp.roles) ? cp.roles : [];
  if (!roles.includes("supplier")) {
    await db.from("counterparties").update({ roles: [...roles, "supplier"] }).eq("id", counterpartyId);
  }
  const inline: Record<string, number> = { ...(cp.supplier_prices || {}) };
  for (const row of prices) {
    const productId = String(row.productId || "").trim();
    if (!productId) continue;
    const price = Math.max(0, Number(row.price) || 0);
    inline[productId] = price;
    await db.from("supplier_prices").upsert({ counterparty_id: counterpartyId, product_id: productId, price });
  }
  await db.from("counterparties").update({ supplier_prices: inline }).eq("id", counterpartyId);
  invalidateCounterpartyCache(true);
}

// ─── Customer cabinet operations ───────────────────────────

async function buildOrderItemsFromProducts(rawItems: { productId?: string; quantity?: number }[]): Promise<StockDocItem[]> {
  const db = getAdminDb();
  const merged = new Map<string, number>();
  for (const item of Array.isArray(rawItems) ? rawItems : []) {
    const productId = String(item.productId || "").trim();
    const quantity = Math.max(0, Math.min(100_000, Number(item.quantity) || 0));
    if (!productId || quantity <= 0) continue;
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }
  const result: StockDocItem[] = [];
  for (const [productId, quantity] of merged) {
    const { data: product } = await db.from("products").select("*").eq("id", productId).maybeSingle();
    if (!product || product.is_visible === false) continue;
    const price = getProductEffectivePrice({
      price: product.price != null ? Number(product.price) : null,
      discountType: product.discount_type ?? null,
      discountValue: product.discount_value ?? null,
    });
    const safePrice = Math.max(0, Number(price) || 0);
    result.push({
      productId, name: String(product.name || "Товар").slice(0, 200),
      sku: product.sku ? String(product.sku).slice(0, 80) : "—",
      quantity, price: safePrice, lineTotal: round2(quantity * safePrice),
    });
  }
  return result;
}

export async function reviseWebsiteOrderByCustomer(
  orderId: string,
  data: { items: { productId?: string; quantity?: number }[]; comment?: string | null }
): Promise<{ totalSum: number; paidTotal: number; additionalDue: number }> {
  const db = getAdminDb();
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order) throw new Error("Заказ не найден");
  if (order.type !== "order") throw new Error("Можно менять только заказ из корзины");

  const items = await buildOrderItemsFromProducts(data.items);
  if (items.length === 0) throw new Error("В заказе должен быть хотя бы один товар");
  const total = itemsTotal(items);
  const comment = cleanText(data.comment, 2000);

  let paidTotal = 0;
  let additionalDue = total;
  const dealId = order.deal_id ? String(order.deal_id) : "";

  if (dealId) {
    const { data: deal } = await db.from("customer_deals").select("*").eq("id", dealId).single();
    if (deal) {
      if (deal.status === "completed") await applyStockDelta(deal.items as StockDocItem[], 1);
      const { data: payments } = await db.from("bank_payments").select("*").contains("deal_ids", [dealId]);
      for (const p of payments || []) {
        if (p.is_paid && p.direction === "incoming") {
          const links = Math.max(1, (p.deal_ids || []).length);
          paidTotal += Number(p.amount || 0) / links;
        }
      }
      paidTotal = round2(paidTotal);
      additionalDue = Math.max(0, round2(total - paidTotal));
      await db.from("customer_deals").update({
        items, total, bank_adjustment: 0, vat_rate: VAT_RATE,
        vat_amount: includedVat(total, VAT_RATE), status: "new",
        comment: [deal.comment, "Клиент изменил заказ из личного кабинета"].filter(Boolean).join(". ").slice(0, 500),
      }).eq("id", dealId);
    }
  }

  if (!dealId) additionalDue = total;

  await db.from("orders").update({
    items: items.map(({ productId, name, sku, quantity, price }) => ({ productId, name, sku: sku ?? "—", quantity, price })),
    total_sum: total, status: "new", close_reason: null,
    comment: comment || order.comment || null,
    customer_edited_at: new Date().toISOString(),
  }).eq("id", orderId);

  revalidateTag("orders", { expire: 0 });
  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  return { totalSum: total, paidTotal, additionalDue };
}

export async function cancelWebsiteOrderByCustomer(orderId: string): Promise<void> {
  const db = getAdminDb();
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) throw new Error("Заказ не найден");
  
  // Если есть связанный deal — отменяем его
  if (order.deal_id) {
    try {
      await cancelDeal(String(order.deal_id), "Клиент отменил заказ из личного кабинета");
    } catch (e) {
      console.error("cancelWebsiteOrderByCustomer: ошибка отмены deal:", e);
    }
  }
  
  // Полностью удаляем заказ из БД
  const { error } = await db.from("orders").delete().eq("id", orderId);
  if (error) throw error;
  
  revalidateTag("orders", { expire: 0 });
  revalidateTag("warehouse-deals", { expire: 0 });
}

// ─── Warehouse stock view ──────────────────────────────────

export async function getWarehouseStock(): Promise<WarehouseStockRow[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("products")
    .select("id, name, sku, stock_qty, stock_warn_qty, in_stock, price, price_wholesale, is_visible, dimension_length, dimension_width, dimension_height, dimension_unit")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id, name: row.name, sku: row.sku || null,
    stockQty: Number(row.stock_qty || 0),
    stockWarnQty: row.stock_warn_qty != null ? Number(row.stock_warn_qty) : null,
    inStock: row.in_stock ?? (Number(row.stock_qty || 0) > 0),
    price: row.price != null ? Number(row.price) : null,
    priceWholesale: row.price_wholesale != null ? Number(row.price_wholesale) : null,
    isVisible: row.is_visible ?? true,
    // Габариты — нужны в бланке/акте ревизии, чтобы кладовщик сразу видел
    // «670×370×370» и не пересчитывал «абстрактный» SKU наугад.
    dimensionLength: row.dimension_length != null ? Number(row.dimension_length) : null,
    dimensionWidth: row.dimension_width != null ? Number(row.dimension_width) : null,
    dimensionHeight: row.dimension_height != null ? Number(row.dimension_height) : null,
    dimensionUnit: row.dimension_unit ?? null,
  }));
}

export async function getReceiptById(id: string): Promise<WarehouseReceipt | null> {
  const db = getAdminDb();
  const { data, error } = await db.from("warehouse_receipts").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapReceiptRow(data);
}

// ══════════════════════════════════════
//   ПЕРЕВОЗКИ (TRANSPORTS)
// ══════════════════════════════════════

export interface TransportItem {
  dealId: string;
  dealNumber: number;
  customerName: string;
  contactName?: string | null;
  address: string | null;
  phone: string | null;
  deliveryNote?: string | null;
  items: { productId: string; name: string; orderedQty: number; transportQty: number }[];
  totalSum: number | null;
}

export interface Transport {
  id: string;
  number: number;
  date: string;
  plannedDate: string | null;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  status: "draft" | "active" | "completed" | "archived";
  note: string | null;
  items: TransportItem[];
  totalItems: number;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function mapTransportRow(row: any): Transport {
  return {
    id: row.id,
    number: Number(row.number),
    date: row.date || "",
    plannedDate: row.planned_date || null,
    driverId: row.driver_id || null,
    driverName: row.driver_name || null,
    driverPhone: row.driver_phone || null,
    status: row.status || "draft",
    note: row.note || null,
    items: Array.isArray(row.items) ? row.items : [],
    totalItems: Number(row.total_items || 0),
    completedAt: toIso(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const ACTIVE_TRANSPORT_STATUSES = ["draft", "active"];

/** Остаток к отгрузке по заказу: productId → сколько ещё не отгружено. */
async function dealRemainingMap(dealId: string): Promise<Map<string, number> | null> {
  const db = getAdminDb();
  const { data: deal } = await db
    .from("customer_deals")
    .select("id, items, shipped_items, status")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return null;
  // Отменённый заказ везти нечего.
  if (deal.status === "cancelled") return new Map();
  return new Map(
    dealRemainingItems(deal.items as any[], deal.shipped_items as any[]).map((r) => [
      r.productId,
      r.remaining,
    ])
  );
}

/**
 * Приводит позиции перевозки к фактическому остатку заказа.
 * Возвращает обновлённую позицию либо null, если везти уже нечего
 * (заказ полностью отгружен / отменён / удалён).
 */
function capTransportItem(
  item: TransportItem,
  remaining: Map<string, number> | null
): TransportItem | null {
  if (!remaining) return null;
  const left = new Map(remaining);
  const items = item.items.map((line) => {
    const available = left.get(line.productId) ?? 0;
    const transportQty = Math.max(0, Math.min(Number(line.transportQty) || 0, available));
    left.set(line.productId, available - transportQty);
    return {
      ...line,
      // «Заказано» показываем как актуальный долг по заказу: то, что уже
      // отпущено вручную, из перевозки уходит.
      orderedQty: available,
      transportQty,
    };
  });
  const total = items.reduce((s, l) => s + l.transportQty, 0);
  if (total <= 0) return null;
  return { ...item, items };
}

/**
 * Синхронизирует активные перевозки с фактическим состоянием заказа:
 * плановые количества урезаются до реального остатка, а полностью
 * отгруженный (или отменённый) заказ убирается из перевозки.
 */
async function syncDealTransportState(dealId: string): Promise<void> {
  const db = getAdminDb();
  try {
    const { data: rows } = await db
      .from("transports")
      .select("*")
      .in("status", ACTIVE_TRANSPORT_STATUSES);
    const affected = (rows || []).filter((row: any) =>
      (Array.isArray(row.items) ? row.items : []).some(
        (it: any) => String(it?.dealId) === String(dealId)
      )
    );
    if (affected.length === 0) return;

    const remaining = await dealRemainingMap(dealId);

    for (const row of affected) {
      const items = (Array.isArray(row.items) ? row.items : []) as TransportItem[];
      const next: TransportItem[] = [];
      for (const item of items) {
        if (String(item.dealId) !== String(dealId)) {
          next.push(item);
          continue;
        }
        const capped = capTransportItem(item, remaining);
        if (capped) next.push(capped);
      }
      await writeTransportItems(row, next);
    }
  } catch (e) {
    console.error("syncDealTransportState:", e);
  }
}

/** Убрать заказ из всех активных перевозок (отмена/удаление заказа). */
async function removeDealFromActiveTransports(dealId: string): Promise<void> {
  const db = getAdminDb();
  try {
    const { data: rows } = await db
      .from("transports")
      .select("*")
      .in("status", ACTIVE_TRANSPORT_STATUSES);
    for (const row of rows || []) {
      const items = (Array.isArray(row.items) ? row.items : []) as TransportItem[];
      const next = items.filter((it) => String(it.dealId) !== String(dealId));
      if (next.length === items.length) continue;
      await writeTransportItems(row, next);
    }
  } catch (e) {
    console.error("removeDealFromActiveTransports:", e);
  }
}

/**
 * Записывает пересчитанный состав перевозки. Опустевшая перевозка больше
 * не висит в активных: всё, что в ней было, уже отпущено (или отменено),
 * поэтому помечаем её завершённой.
 */
async function writeTransportItems(row: any, items: TransportItem[]): Promise<void> {
  const db = getAdminDb();
  const totalItems = items.reduce(
    (s, it) => s + it.items.reduce((s2, i) => s2 + (Number(i.transportQty) || 0), 0),
    0
  );
  const payload: Record<string, any> = {
    items,
    total_items: totalItems,
    updated_at: new Date().toISOString(),
  };
  if (items.length === 0) {
    payload.status = "completed";
    payload.completed_at = row.completed_at || new Date().toISOString();
  }
  await db.from("transports").update(payload).eq("id", row.id);
}

/**
 * Дотягивает из сделки (customer_deals) контактное лицо и заметку
 * курьеру для позиций перевозки, у которых они не сохранены (старые
 * перевозки, созданные до появления этих полей). Пакетный запрос.
 *
 * Здесь же активные перевозки показываются с актуальными количествами:
 * если товар отпустили вручную в «Заказах», в перевозке остаётся только
 * реальный долг, а закрытые заказы из неё исчезают.
 */
async function enrichTransportItems(transports: Transport[]): Promise<void> {
  const dealIds = [
    ...new Set(
      transports.flatMap((t) => t.items.map((i) => String(i.dealId))).filter(Boolean)
    ),
  ];
  if (dealIds.length === 0) return;
  const db = getAdminDb();
  const { data: deals } = await db
    .from("customer_deals")
    .select("id, contact_name, delivery_note, items, shipped_items, status")
    .in("id", dealIds);
  if (!deals || deals.length === 0) return;
  const dealMap = new Map<string, any>(deals.map((d: any) => [String(d.id), d]));

  for (const t of transports) {
    // Завершённые и архивные перевозки — исторические документы,
    // их состав не пересчитываем.
    const isActive = t.status === "draft" || t.status === "active";
    const items: TransportItem[] = [];
    for (const i of t.items) {
      const deal = dealMap.get(String(i.dealId));
      const enriched: TransportItem = {
        ...i,
        contactName: i.contactName ?? deal?.contact_name ?? null,
        deliveryNote: i.deliveryNote ?? deal?.delivery_note ?? null,
      };
      if (!isActive) {
        items.push(enriched);
        continue;
      }
      if (!deal || deal.status === "cancelled") continue;
      const remaining = new Map(
        dealRemainingItems(deal.items, deal.shipped_items).map((r) => [
          r.productId,
          r.remaining,
        ])
      );
      const capped = capTransportItem(enriched, remaining);
      if (capped) items.push(capped);
    }
    t.items = items;
    if (isActive) {
      t.totalItems = items.reduce(
        (s, it) => s + it.items.reduce((s2, i) => s2 + (Number(i.transportQty) || 0), 0),
        0
      );
    }
  }
}

export async function getTransports(opts: { status?: string; limit?: number } = {}): Promise<Transport[]> {
  const db = getAdminDb();
  let q = db.from("transports").select("*").order("created_at", { ascending: false });
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  q = q.limit(opts.limit || 200);
  const { data, error } = await q;
  if (error) throw error;
  const transports = (data || []).map(mapTransportRow);
  await enrichTransportItems(transports);
  return transports;
}

export async function getTransportById(id: string): Promise<Transport | null> {
  const db = getAdminDb();
  const { data, error } = await db.from("transports").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const transport = mapTransportRow(data);
  await enrichTransportItems([transport]);
  return transport;
}

export async function createTransport(data: {
  date: string;
  plannedDate?: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  note?: string;
  items: TransportItem[];
}): Promise<{ id: string; number: number }> {
  const db = getAdminDb();
  if (!data.items || data.items.length === 0) throw new Error("Добавьте хотя бы один заказ");

  const number = await nextNumber("deal"); // Используем тот же счётчик
  const totalItems = data.items.reduce((s, it) => s + it.items.reduce((s2, i) => s2 + i.transportQty, 0), 0);

  const { data: result, error } = await db.from("transports").insert({
    number,
    date: data.date,
    planned_date: data.plannedDate || null,
    driver_id: data.driverId || null,
    driver_name: data.driverName || null,
    driver_phone: data.driverPhone || null,
    status: "draft",
    note: data.note || null,
    items: data.items,
    total_items: totalItems,
  }).select("id, number").single();
  if (error) throw error;

  revalidateTag("warehouse-deals", { expire: 0 });
  return { id: result.id, number };
}

export async function updateTransport(id: string, data: {
  date?: string;
  plannedDate?: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  note?: string;
  items?: TransportItem[];
  status?: string;
}): Promise<void> {
  const db = getAdminDb();
  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  if (data.date !== undefined) payload.date = data.date;
  if (data.plannedDate !== undefined) payload.planned_date = data.plannedDate || null;
  if (data.driverId !== undefined) payload.driver_id = data.driverId || null;
  if (data.driverName !== undefined) payload.driver_name = data.driverName || null;
  if (data.driverPhone !== undefined) payload.driver_phone = data.driverPhone || null;
  if (data.note !== undefined) payload.note = data.note || null;
  if (data.items !== undefined) {
    payload.items = data.items;
    payload.total_items = data.items.reduce((s, it) => s + it.items.reduce((s2, i) => s2 + i.transportQty, 0), 0);
  }
  if (data.status !== undefined) payload.status = data.status;
  const { error } = await db.from("transports").update(payload).eq("id", id);
  if (error) throw error;
  revalidateTag("warehouse-deals", { expire: 0 });
}

/** Завершить перевозку: списать отгруженные количества, обновить shipped_items заказов */
export async function completeTransport(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: transport } = await db.from("transports").select("*").eq("id", id).single();
  if (!transport) throw new Error("Перевозка не найдена");
  if (transport.status === "completed" || transport.status === "archived") throw new Error("Перевозка уже завершена");

  const items = (transport.items || []) as TransportItem[];
  // Фактически отгруженный состав (после урезки по остаткам) сохраняем
  // в документ перевозки, чтобы бланк и архив совпадали со складом.
  const postedItems: TransportItem[] = [];

  // Обновляем shipped_items для каждого заказа
  for (const ti of items) {
    const { data: deal } = await db
      .from("customer_deals")
      .select("shipped_items, items, status")
      .eq("id", ti.dealId)
      .maybeSingle();
    if (!deal || deal.status === "cancelled") continue;

    const dealItems = (deal.items || []) as StockDocItem[];
    // ★ Списываем не больше остатка: часть заказа могли уже отпустить
    //   вручную в «Заказах» после формирования перевозки.
    const remaining = new Map(
      dealRemainingItems(dealItems, deal.shipped_items as any[]).map((r) => [
        r.productId,
        r.remaining,
      ])
    );
    const shippedMap = shippedQtyMap(deal.shipped_items as any[]);
    const postedLines: TransportItem["items"] = [];

    for (const item of ti.items) {
      const available = remaining.get(item.productId) ?? 0;
      const qty = Math.max(0, Math.min(Number(item.transportQty) || 0, available));
      if (qty <= 0) continue;
      remaining.set(item.productId, available - qty);
      shippedMap.set(item.productId, (shippedMap.get(item.productId) || 0) + qty);
      await adjustStock(item.productId, -qty);
      postedLines.push({ ...item, transportQty: qty });
    }

    if (postedLines.length > 0) {
      postedItems.push({ ...ti, items: postedLines });
    }

    const names = new Map<string, string>();
    for (const it of dealItems) {
      const pid = String(it.productId || "");
      if (pid && !names.has(pid)) names.set(pid, String(it.name || ""));
    }
    const newShipped = [...orderedQtyMap(dealItems).keys()].map((productId) => ({
      productId,
      name: names.get(productId) || "",
      shippedQty: shippedMap.get(productId) || 0,
    }));

    const updatePayload: any = { shipped_items: newShipped, updated_at: new Date().toISOString() };
    if (isDealFullyShipped(dealItems, newShipped)) {
      updatePayload.status = "completed";
      updatePayload.delivery_released_at = new Date().toISOString();
    }
    await db.from("customer_deals").update(updatePayload).eq("id", ti.dealId);
  }

  await db.from("transports").update({
    status: "completed",
    items: postedItems,
    total_items: postedItems.reduce(
      (s, it) => s + it.items.reduce((s2, i) => s2 + i.transportQty, 0),
      0
    ),
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("products", { expire: 0 });
  revalidateTag("deliveries", { expire: 0 });
}

/** Удалить перевозку (только draft/active) */
export async function deleteTransport(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: transport } = await db.from("transports").select("status").eq("id", id).maybeSingle();
  if (!transport) throw new Error("Перевозка не найдена");
  if (transport.status === "completed") throw new Error("Нельзя удалить завершённую перевозку");
  await db.from("transports").delete().eq("id", id);
  revalidateTag("warehouse-deals", { expire: 0 });
}

/** Архивировать перевозку */
export async function archiveTransport(id: string): Promise<void> {
  const db = getAdminDb();
  await db.from("transports").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", id);
  revalidateTag("warehouse-deals", { expire: 0 });
}
