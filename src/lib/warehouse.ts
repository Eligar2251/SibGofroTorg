// =========================================================
// FILE: src/lib/warehouse.ts
// Складской учёт — Supabase (PostgreSQL).
// Полная версия с созданием контрагентов, связями и кэшем.
// =========================================================

import { createHash } from "crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { getAdminDb } from "./supabase";
import { getProductEffectivePrice } from "./types";
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
} from "./warehouse-shared";
import {
  includedVat,
  VAT_RATE,
  getBankSummary,
  getDealPaidMap,
  getReceiptPaidMap,
  getCounterpartyBalances,
} from "./warehouse-shared";

export {
  includedVat,
  VAT_RATE,
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
  getBankSummary,
  getDealPaidMap,
  getReceiptPaidMap,
  getCounterpartyBalances,
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
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
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
  let deliveryType: "free" | "paid" | null = null;
  if (hasDelivery) {
    deliveryType = data.deliveryType === "paid" ? "paid" : "free";
  }
  const deliveryCost =
    deliveryType === "paid"
      ? Math.max(0, Number(data.deliveryCost) || 0)
      : 0;
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

async function applyStockDelta(items: StockDocItem[], direction: 1 | -1): Promise<void> {
  const db = getAdminDb();
  for (const item of items) {
    const { data: product } = await db.from("products").select("stock_qty, in_stock").eq("id", item.productId).maybeSingle();
    if (!product) continue;
    const current = Number(product.stock_qty || 0);
    const newQty = Math.max(0, current + direction * item.quantity);
    await db.from("products").update({
      stock_qty: newQty, in_stock: newQty > 0, updated_at: new Date().toISOString(),
    }).eq("id", item.productId);
  }
}

export async function setWarehouseStock(productId: string, quantity: number): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("products").update({
    stock_qty: Math.floor(quantity), in_stock: Math.floor(quantity) > 0,
    updated_at: new Date().toISOString(),
  }).eq("id", productId);
  if (error) throw error;
  revalidateTag("products");
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

  revalidateTag("warehouse-receipts");
  revalidateTag("warehouse-payments");
  revalidateTag("warehouse-counterparties");
  revalidateTag("products");
  return { id: receiptId, number };
}

export async function postReceipt(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: receipt } = await db.from("warehouse_receipts").select("*").eq("id", id).single();
  if (!receipt) throw new Error("Поступление не найдено");
  if (receipt.status === "posted") throw new Error("Уже проведено");
  await applyStockDelta(receipt.items as StockDocItem[], 1);
  await db.from("warehouse_receipts").update({ status: "posted", updated_at: new Date().toISOString() }).eq("id", id);
  revalidateTag("warehouse-receipts");
  revalidateTag("products");
}

export async function cancelReceipt(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: receipt } = await db.from("warehouse_receipts").select("*").eq("id", id).single();
  if (!receipt) throw new Error("Поступление не найдено");
  if (receipt.status !== "posted") throw new Error("Можно отменить только проведённое");
  await applyStockDelta(receipt.items as StockDocItem[], -1);
  await db.from("warehouse_receipts").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", id);
  revalidateTag("warehouse-receipts");
  revalidateTag("products");
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
  revalidateTag("warehouse-receipts");
  revalidateTag("warehouse-payments");
  revalidateTag("products");
}

export async function deleteReceipt(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: existing } = await db.from("warehouse_receipts").select("*").eq("id", id).single();
  if (!existing) throw new Error("Поступление не найдено");
  if (existing.status === "posted") throw new Error("Нельзя удалить проведённое поступление");
  await db.from("warehouse_receipts").delete().eq("id", id);
  revalidateTag("warehouse-receipts");
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

  // ★ Создаём входящий счёт (не проведён — влияет на баланс после оплаты)
  await db.from("bank_payments").insert({
    number: paymentNumber, date,
    direction: "incoming", type: "regular",
    counterparty: customerName, counterparty_id: counterpartyId,
    deal_ids: [dealResult.id], deal_numbers: [number],
    receipt_ids: [], receipt_numbers: [],
    amount: total, invoice_number: null,
    vat_rate: vatRate, vat_amount: vatAmount,
    is_paid: false, paid_at: null,
    exclude_from_balance: false,
    comment: `Счёт покупателю по заказу ЗК-${number}`,
  });

  // Привязываем существующие платежи
  for (const payId of linkedPaymentIds) {
    const { data: pay } = await db.from("bank_payments").select("deal_ids, deal_numbers").eq("id", payId).maybeSingle();
    if (pay) {
      const dealIds = Array.isArray(pay.deal_ids) ? [...pay.deal_ids, dealResult.id] : [dealResult.id];
      const dealNumbers = Array.isArray(pay.deal_numbers) ? [...pay.deal_numbers, number] : [number];
      await db.from("bank_payments").update({ deal_ids: dealIds, deal_numbers: dealNumbers }).eq("id", payId);
    }
  }

  revalidateTag("warehouse-deals");
  revalidateTag("warehouse-payments");
  revalidateTag("warehouse-counterparties");
  return { id: dealResult.id, number };
}

export async function postDeal(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: deal } = await db.from("customer_deals").select("*").eq("id", id).single();
  if (!deal) throw new Error("Заказ не найден");
  if (deal.status === "completed") throw new Error("Уже проведён");
  await applyStockDelta(deal.items as StockDocItem[], -1);
  await db.from("customer_deals").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", id);
  revalidateTag("warehouse-deals");
  revalidateTag("products");
}

export async function cancelDeal(id: string, reason: string | null = null): Promise<void> {
  const db = getAdminDb();
  const { data: deal } = await db.from("customer_deals").select("*").eq("id", id).single();
  if (!deal) throw new Error("Заказ не найден");
  if (deal.status === "cancelled") throw new Error("Уже отменён");
  if (deal.status === "completed") {
    await applyStockDelta(deal.items as StockDocItem[], 1);
  }
  await db.from("customer_deals").update({
    status: "cancelled", cancel_reason: reason, updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidateTag("warehouse-deals");
  revalidateTag("products");
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

  const remaining = Math.max(0, round2(total - paidTotal));

  if (remaining > 0) {
    if (unpaidSoloPayments.length === 1) {
      // Обновляем сумму существующего платежа
      await db.from("bank_payments").update({
        counterparty: customerName, counterparty_id: counterpartyId,
        amount: remaining, vat_rate: vatRate, vat_amount: includedVat(remaining, vatRate),
      }).eq("id", unpaidSoloPayments[0].id);
    } else if (unpaidSoloPayments.length === 0) {
      // Создаём новый платёж
      const paymentNumber = await nextNumber("payment");
      await db.from("bank_payments").insert({
        number: paymentNumber, date,
        direction: "incoming", type: "regular",
        counterparty: customerName, counterparty_id: counterpartyId,
        deal_ids: [id], deal_numbers: [existing.number],
        receipt_ids: [], receipt_numbers: [],
        amount: remaining, invoice_number: null,
        vat_rate: vatRate, vat_amount: includedVat(remaining, vatRate),
        is_paid: false, paid_at: null,
        exclude_from_balance: false,
        comment: `Счёт покупателю по заказу ЗК-${existing.number}`,
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
  revalidateTag("warehouse-deals");
  revalidateTag("warehouse-payments");
}

export async function deleteDeal(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: existing } = await db.from("customer_deals").select("*").eq("id", id).single();
  if (!existing) throw new Error("Заказ не найден");
  if (existing.status === "completed") throw new Error("Нельзя удалить проведённый заказ");
  await db.from("customer_deals").delete().eq("id", id);
  revalidateTag("warehouse-deals");
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
    clearRelease?: boolean;
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
    payload.delivery_cost =
      data.deliveryCost == null ? 0 : Math.max(0, Number(data.deliveryCost) || 0);
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

  if (data.hasDelivery === false) {
    payload.delivery_type = null;
    payload.delivery_cost = 0;
    payload.delivery_planned_date = null;
    payload.delivery_released_at = null;
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
  const willType =
    payload.delivery_type !== undefined
      ? payload.delivery_type
      : existing.delivery_type;
  const willCost =
    willHave && willType === "paid"
      ? payload.delivery_cost !== undefined
        ? Number(payload.delivery_cost) || 0
        : Number(existing.delivery_cost) || 0
      : 0;
  if (willHave) {
    const addr =
      payload.delivery_address !== undefined
        ? payload.delivery_address
        : existing.delivery_address || existing.address;
    if (!addr) throw new Error("Адрес доставки обязателен");
    if (!willType) payload.delivery_type = "free";
  }
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
  return (data || []).map(mapDealRow);
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
  revalidateTag("warehouse-payments");
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
  revalidateTag("warehouse-payments");
}

export async function deletePayment(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: existing } = await db.from("bank_payments").select("*").eq("id", id).single();
  if (!existing) throw new Error("Платёж не найден");
  if (existing.is_paid) throw new Error("Нельзя удалить проведённый платёж");
  await db.from("bank_payments").delete().eq("id", id);
  revalidateTag("warehouse-payments");
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
    revalidateTag("warehouse-employees");
    return { id: data.id };
  }
  const { data: result, error } = await db.from("employees").insert({
    name: data.name, position: data.position ?? null, phone: data.phone ?? null, comment: data.comment ?? null,
  }).select("id").single();
  if (error) throw error;
  revalidateTag("warehouse-employees");
  return { id: result.id };
}

export async function deleteEmployee(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("employees").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("warehouse-employees");
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
  revalidateTag("warehouse-salaries");
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
  revalidateTag("warehouse-salaries");
}

export async function deleteSalary(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("salaries").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("warehouse-salaries");
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
  const customerName = order.customer_name || "Клиент";
  // Адрес из заявки сайта (клиент указал при оформлении)
  const orderAddress = cleanText(
    order.delivery_address || order.actual_address || order.legal_address,
    400
  );

  // ★ Создаём/обновляем контрагента-покупателя
  const counterpartyId = await ensureCounterparty(customerName, "customer", {
    phone: order.customer_phone,
    email: order.customer_email,
    inn: order.inn,
    kpp: order.kpp,
    address: orderAddress,
    legalAddress: cleanText(order.legal_address, 400),
    comment: order.comment,
  });

  // Доставка в заказ учёта не включается автоматически —
  // менеджер ставит её в форме ЗК. Адрес клиента переносим в address.
  const total = linesTotal;
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
    comment: order.comment ? `Из заявки с сайта. ${String(order.comment).slice(0, 400)}` : "Из заявки с сайта",
    items, total, bank_adjustment: 0,
    vat_rate: VAT_RATE, vat_amount: vatAmount,
    status: "new", source_order_id: orderId,
    has_delivery: false,
  }).select("id").single();
  if (dealError) throw dealError;

  // ★ Создаём входящий счёт с привязкой к контрагенту
  const paymentNumber = await nextNumber("payment");
  const { data: paymentResult, error: paymentError } = await db.from("bank_payments").insert({
    number: paymentNumber, date,
    direction: "incoming", type: "regular",
    counterparty: customerName, counterparty_id: counterpartyId,
    deal_ids: [dealResult.id], deal_numbers: [number],
    receipt_ids: [], receipt_numbers: [],
    amount: total, vat_rate: VAT_RATE, vat_amount: vatAmount,
    is_paid: false,
    paid_at: null,
    exclude_from_balance: false,
    comment: `Счёт покупателю по заказу ЗК-${number} (из заявки с сайта)`,
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

  revalidateTag("warehouse-deals");
  revalidateTag("warehouse-payments");
  revalidateTag("orders");
  revalidateTag("warehouse-counterparties");
  return { dealId: dealResult.id, dealNumber: number, paymentId: paymentResult.id, skipped: false };
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

  revalidateTag("orders");
  revalidateTag("warehouse-deals");
  revalidateTag("warehouse-payments");
  return { totalSum: total, paidTotal, additionalDue };
}

export async function cancelWebsiteOrderByCustomer(orderId: string): Promise<void> {
  const db = getAdminDb();
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order) throw new Error("Заказ не найден");
  if (order.deal_id) {
    await cancelDeal(String(order.deal_id), "Клиент отменил заказ из личного кабинета");
  }
  await db.from("orders").update({
    status: "rejected", close_reason: "Клиент отменил заказ из личного кабинета",
    customer_cancelled_at: new Date().toISOString(),
  }).eq("id", orderId);
  revalidateTag("orders");
  revalidateTag("warehouse-deals");
}

// ─── Warehouse stock view ──────────────────────────────────

export async function getWarehouseStock(): Promise<WarehouseStockRow[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("products")
    .select("id, name, sku, stock_qty, stock_warn_qty, in_stock, price, price_wholesale, is_visible")
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
  }));
}

export async function getReceiptById(id: string): Promise<WarehouseReceipt | null> {
  const db = getAdminDb();
  const { data, error } = await db.from("warehouse_receipts").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapReceiptRow(data);
}
