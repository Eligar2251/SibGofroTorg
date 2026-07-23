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
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
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
  return round2(items.reduce((s, i) => s + (i.lineTotal || round2(i.quantity * i.price)), 0));
}

function buildItems(data: any): StockDocItem[] {
  return (Array.isArray(data.items) ? data.items : []).map((i: any) => {
    const qty = Math.max(0, Math.min(100_000, Number(i.quantity) || 0));
    const price = Math.max(0, Number(i.price) || 0);
    return {
      productId: String(i.productId || "").slice(0, 80),
      name: String(i.name || "Товар").slice(0, 200),
      sku: i.sku ? String(i.sku).slice(0, 80) : "—",
      quantity: qty, price, lineTotal: round2(qty * price),
    };
  }).filter((i: StockDocItem) => i.productId);
}

// ─── Receipts CRUD ─────────────────────────────────────────

export async function createReceipt(data: any): Promise<{ id: string; number: number }> {
  const db = getAdminDb();
  const number = await nextNumber("receipt");
  const items = buildItems(data);
  const total = itemsTotal(items);
  const vatRate = data.vatRate != null ? Number(data.vatRate) : VAT_RATE;
  const vatAmount = includedVat(total, vatRate);
  const supplier = String(data.supplier || "").slice(0, 200);
  const counterpartyId = await ensureCounterparty(supplier, "supplier", {
    phone: data.phone, email: data.email, inn: data.inn, kpp: data.kpp,
    address: data.address, contactName: data.contactName,
    comment: data.comment,
  });

  const { data: result, error } = await db.from("warehouse_receipts").insert({
    number, date: String(data.date || "").slice(0, 10),
    supplier, counterparty_id: counterpartyId, status: "draft",
    phone: cleanText(data.phone, 60), email: cleanText(data.email, 120),
    inn: cleanText(data.inn, 30), kpp: cleanText(data.kpp, 30),
    address: cleanText(data.address, 400), contact_name: cleanText(data.contactName, 160),
    comment: cleanText(data.comment, 500),
    items, total, bank_adjustment: 0, vat_rate: vatRate, vat_amount: vatAmount,
    linked_deal_ids: data.linkedDealIds || [], linked_deal_numbers: [],
  }).select("id").single();
  if (error) throw error;
  revalidateTag("warehouse-receipts");
  return { id: result.id, number };
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
  const { data: existing } = await db.from("warehouse_receipts").select("*").eq("id", id).single();
  if (!existing) throw new Error("Поступление не найдено");
  if (existing.status === "posted") throw new Error("Нельзя редактировать проведённое поступление");
  const items = buildItems(data);
  const total = itemsTotal(items);
  const vatRate = data.vatRate != null ? Number(data.vatRate) : VAT_RATE;
  await db.from("warehouse_receipts").update({
    date: String(data.date || "").slice(0, 10),
    supplier: String(data.supplier || "").slice(0, 200),
    phone: cleanText(data.phone, 60), email: cleanText(data.email, 120),
    inn: cleanText(data.inn, 30), kpp: cleanText(data.kpp, 30),
    address: cleanText(data.address, 400), contact_name: cleanText(data.contactName, 160),
    comment: cleanText(data.comment, 500),
    items, total, vat_rate: vatRate, vat_amount: includedVat(total, vatRate),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidateTag("warehouse-receipts");
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
  const db = getAdminDb();
  const number = await nextNumber("deal");
  const items = buildItems(data);
  const total = itemsTotal(items);
  const vatRate = data.vatRate != null ? Number(data.vatRate) : VAT_RATE;
  const vatAmount = includedVat(total, vatRate);
  const customerName = String(data.customerName || "").slice(0, 200);

  // Создаём/обновляем контрагента-покупателя
  const counterpartyId = await ensureCounterparty(customerName, "customer", {
    phone: data.customerPhone, email: data.email, inn: data.inn, kpp: data.kpp,
    address: data.address, contactName: data.contactName, comment: data.comment,
  });

  const { data: result, error } = await db.from("customer_deals").insert({
    number, date: String(data.date || "").slice(0, 10),
    customer_name: customerName, counterparty_id: counterpartyId,
    customer_phone: cleanText(data.customerPhone, 60),
    phone: cleanText(data.phone, 60), email: cleanText(data.email, 120),
    inn: cleanText(data.inn, 30), kpp: cleanText(data.kpp, 30),
    address: cleanText(data.address, 400), contact_name: cleanText(data.contactName, 160),
    comment: cleanText(data.comment, 500),
    items, total, bank_adjustment: 0, vat_rate: vatRate, vat_amount: vatAmount,
    status: "new",
  }).select("id").single();
  if (error) throw error;
  revalidateTag("warehouse-deals");
  return { id: result.id, number };
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
  const { data: existing } = await db.from("customer_deals").select("*").eq("id", id).single();
  if (!existing) throw new Error("Заказ не найден");
  if (existing.status === "completed") throw new Error("Нельзя редактировать проведённый заказ");
  const items = buildItems(data);
  const total = itemsTotal(items);
  const vatRate = data.vatRate != null ? Number(data.vatRate) : VAT_RATE;
  await db.from("customer_deals").update({
    date: String(data.date || "").slice(0, 10),
    customer_name: String(data.customerName || "").slice(0, 200),
    customer_phone: cleanText(data.customerPhone, 60),
    phone: cleanText(data.phone, 60), email: cleanText(data.email, 120),
    inn: cleanText(data.inn, 30), kpp: cleanText(data.kpp, 30),
    address: cleanText(data.address, 400), contact_name: cleanText(data.contactName, 160),
    comment: cleanText(data.comment, 500),
    items, total, vat_rate: vatRate, vat_amount: includedVat(total, vatRate),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidateTag("warehouse-deals");
}

export async function deleteDeal(id: string): Promise<void> {
  const db = getAdminDb();
  const { data: existing } = await db.from("customer_deals").select("*").eq("id", id).single();
  if (!existing) throw new Error("Заказ не найден");
  if (existing.status === "completed") throw new Error("Нельзя удалить проведённый заказ");
  await db.from("customer_deals").delete().eq("id", id);
  revalidateTag("warehouse-deals");
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

  const total = itemsTotal(items);
  const number = await nextNumber("deal");
  const date = new Date().toISOString().slice(0, 10);
  const customerName = order.customer_name || "Клиент";
  const vatAmount = includedVat(total, VAT_RATE);

  // ★ Создаём/обновляем контрагента-покупателя
  const counterpartyId = await ensureCounterparty(customerName, "customer", {
    phone: order.customer_phone,
    email: order.customer_email,
    inn: order.inn,
    kpp: order.kpp,
    comment: order.comment,
  });

  // ★ Создаём заказ покупателя с привязкой к контрагенту
  const { data: dealResult, error: dealError } = await db.from("customer_deals").insert({
    number, date, customer_name: customerName, counterparty_id: counterpartyId,
    customer_phone: order.customer_phone,
    comment: order.comment ? `Из заявки с сайта. ${String(order.comment).slice(0, 400)}` : "Из заявки с сайта",
    items, total, bank_adjustment: 0,
    vat_rate: VAT_RATE, vat_amount: vatAmount,
    status: "new", source_order_id: orderId,
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
    comment: `Счёт покупателю по заказу ЗК-${number} (из заявки с сайта)`,
  }).select("id").single();
  if (paymentError) throw paymentError;

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
