// =========================================================
// FILE: src/lib/warehouse.ts
// Учёт: склад (приходные ордера), заказы покупателей, банк.
// Коллекции Firestore:
//   warehouseReceipts — поступления товаров (+остаток)
//   customerDeals    — заказы покупателей (−остаток при проведении)
//   bankPayments     — входящие/исходящие платежи
//   counters/warehouse — сквозная нумерация документов
// =========================================================

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./firebase-admin";
import type { FirestoreProduct } from "./types";
import { getProductEffectivePrice } from "./types";

// ─── Типы ────────────────────────────────────────────────

export interface StockDocItem {
  productId: string;
  name: string;
  sku?: string | null;
  quantity: number;
  price: number;
}

export interface WarehouseReceipt {
  id: string;
  number: number;
  date: string; // YYYY-MM-DD
  supplier: string;
  comment?: string | null;
  items: StockDocItem[];
  total: number;
  createdAt?: string | null;
}

export type DealStatus = "new" | "completed" | "cancelled";

export interface CustomerDeal {
  id: string;
  number: number;
  date: string;
  customerName: string;
  customerPhone?: string | null;
  comment?: string | null;
  items: StockDocItem[];
  total: number;
  status: DealStatus;
  cancelReason?: string | null;
  createdAt?: string | null;
}

export interface BankPayment {
  id: string;
  number: number;
  date: string;
  direction: "incoming" | "outgoing";
  counterparty: string;
  /** Привязанные заказы покупателей (может быть несколько —
   *  например фура с товаром под несколько заказов) */
  dealIds: string[];
  dealNumbers: number[];
  amount: number;
  isPaid: boolean;
  comment?: string | null;
  createdAt?: string | null;
}

// ─── Утилиты ─────────────────────────────────────────────

function serializeTimestamp(ts: any): string | null {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  if (ts._seconds !== undefined)
    return new Date(ts._seconds * 1000).toISOString();
  if (ts.seconds !== undefined)
    return new Date(ts.seconds * 1000).toISOString();
  if (typeof ts === "string") return ts;
  return null;
}

function cleanItems(items: any[]): StockDocItem[] {
  return (Array.isArray(items) ? items : [])
    .map((it: any) => ({
      productId: String(it.productId || ""),
      name: String(it.name || "").slice(0, 300),
      sku: it.sku ? String(it.sku).slice(0, 60) : null,
      quantity: Math.max(0, Number(it.quantity) || 0),
      price: Math.max(0, Number(it.price) || 0),
    }))
    .filter((it) => it.productId && it.quantity > 0);
}

function itemsTotal(items: StockDocItem[]): number {
  return items.reduce((s, it) => s + it.quantity * it.price, 0);
}

/** Сквозной номер документа через счётчик в транзакции */
async function nextNumber(
  field: "receipt" | "deal" | "payment"
): Promise<number> {
  const db = getAdminDb();
  const ref = db.collection("counters").doc("warehouse");
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? Number((snap.data() as any)?.[field] || 0) : 0;
    const next = cur + 1;
    tx.set(ref, { [field]: next }, { merge: true });
    return next;
  });
}

/** Пакетное изменение остатков (qty со знаком) */
async function applyStockDelta(
  items: StockDocItem[],
  sign: 1 | -1
): Promise<void> {
  const db = getAdminDb();
  // Агрегируем, если один товар встречается в нескольких строках
  const byProduct = new Map<string, number>();
  for (const it of items) {
    byProduct.set(
      it.productId,
      (byProduct.get(it.productId) || 0) + it.quantity * sign
    );
  }
  const batch = db.batch();
  for (const [productId, delta] of byProduct) {
    const ref = db.collection("products").doc(productId);
    batch.set(ref, { stockQty: FieldValue.increment(delta) }, { merge: true });
  }
  await batch.commit();
}

// ─── Остатки ─────────────────────────────────────────────

export interface WarehouseStockRow {
  id: string;
  name: string;
  sku: string | null;
  stockQty: number;
  inStock: boolean;
  price: number | null; // эффективная цена продажи
  priceWholesale: number | null;
  isVisible: boolean;
}

/** Все товары (включая скрытые) — для учёта склада */
export async function getWarehouseStock(): Promise<WarehouseStockRow[]> {
  const db = getAdminDb();
  const snap = await db.collection("products").get();
  const rows: WarehouseStockRow[] = snap.docs.map((d) => {
    const data = d.data() as any;
    const price =
      data.price !== undefined && data.price !== null
        ? Number(data.price)
        : null;
    const effective = getProductEffectivePrice({
      price,
      discountType: data.discountType ?? null,
      discountValue: data.discountValue ?? null,
    });
    return {
      id: d.id,
      name: String(data.name || ""),
      sku: data.sku ? String(data.sku) : null,
      stockQty:
        data.stockQty !== undefined && data.stockQty !== null
          ? Number(data.stockQty)
          : 0,
      inStock: data.inStock !== false,
      price: effective,
      priceWholesale:
        data.priceWholesale !== undefined && data.priceWholesale !== null
          ? Number(data.priceWholesale)
          : null,
      isVisible: data.isVisible !== false,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return rows;
}

// ─── Поступления (приходные ордера) ─────────────────────

function mapReceipt(id: string, data: any): WarehouseReceipt {
  return {
    id,
    number: Number(data.number) || 0,
    date: String(data.date || ""),
    supplier: String(data.supplier || ""),
    comment: data.comment ?? null,
    items: cleanItems(data.items),
    total: Number(data.total) || 0,
    createdAt: serializeTimestamp(data.createdAt),
  };
}

export async function getReceipts(): Promise<WarehouseReceipt[]> {
  const db = getAdminDb();
  const snap = await db
    .collection("warehouseReceipts")
    .orderBy("number", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => mapReceipt(d.id, d.data()));
}

export async function createReceipt(data: {
  date: string;
  supplier: string;
  comment?: string | null;
  items: StockDocItem[];
}): Promise<{ id: string; number: number }> {
  const items = cleanItems(data.items);
  if (items.length === 0) {
    throw new Error("Добавьте хотя бы одну позицию");
  }
  const db = getAdminDb();
  const number = await nextNumber("receipt");
  const docRef = await db.collection("warehouseReceipts").add({
    number,
    date: data.date || new Date().toISOString().slice(0, 10),
    supplier: String(data.supplier || "").slice(0, 200),
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    items,
    total: itemsTotal(items),
    createdAt: FieldValue.serverTimestamp(),
  });
  // Проведение: товар приходит на склад
  await applyStockDelta(items, 1);
  return { id: docRef.id, number };
}

export async function deleteReceipt(id: string): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("warehouseReceipts").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  const receipt = mapReceipt(id, snap.data());
  // Откат остатков — сторно поступления
  await applyStockDelta(receipt.items, -1);
  await ref.delete();
}

// ─── Заказы покупателей ─────────────────────────────────

function mapDeal(id: string, data: any): CustomerDeal {
  return {
    id,
    number: Number(data.number) || 0,
    date: String(data.date || ""),
    customerName: String(data.customerName || ""),
    customerPhone: data.customerPhone ?? null,
    comment: data.comment ?? null,
    items: cleanItems(data.items),
    total: Number(data.total) || 0,
    status: (data.status as DealStatus) || "new",
    cancelReason: data.cancelReason ?? null,
    createdAt: serializeTimestamp(data.createdAt),
  };
}

export async function getDeals(): Promise<CustomerDeal[]> {
  const db = getAdminDb();
  const snap = await db
    .collection("customerDeals")
    .orderBy("number", "desc")
    .limit(300)
    .get();
  return snap.docs.map((d) => mapDeal(d.id, d.data()));
}

export async function createDeal(data: {
  date: string;
  customerName: string;
  customerPhone?: string | null;
  comment?: string | null;
  items: StockDocItem[];
}): Promise<{ id: string; number: number }> {
  const items = cleanItems(data.items);
  if (!data.customerName?.trim()) {
    throw new Error("Укажите покупателя");
  }
  if (items.length === 0) {
    throw new Error("Добавьте хотя бы одну позицию");
  }
  const db = getAdminDb();
  const number = await nextNumber("deal");
  const docRef = await db.collection("customerDeals").add({
    number,
    date: data.date || new Date().toISOString().slice(0, 10),
    customerName: String(data.customerName).slice(0, 200),
    customerPhone: data.customerPhone
      ? String(data.customerPhone).slice(0, 40)
      : null,
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    items,
    total: itemsTotal(items),
    status: "new",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: docRef.id, number };
}

/** Провести заказ — списать товар со склада */
export async function postDeal(id: string): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("customerDeals").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Заказ не найден");
  const deal = mapDeal(id, snap.data());
  if (deal.status === "completed") return;
  if (deal.status === "cancelled") throw new Error("Заказ отменён");
  await applyStockDelta(deal.items, -1);
  await ref.update({
    status: "completed",
    cancelReason: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Отменить заказ — вернуть товар на склад, если был проведён */
export async function cancelDeal(id: string, reason?: string | null): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("customerDeals").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  const deal = mapDeal(id, snap.data());
  if (deal.status === "completed") {
    await applyStockDelta(deal.items, 1);
  }
  await ref.update({
    status: "cancelled",
    cancelReason: reason ? String(reason).slice(0, 300) : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteDeal(id: string): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("customerDeals").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  const deal = mapDeal(id, snap.data());
  if (deal.status === "completed") {
    // Сторно списания
    await applyStockDelta(deal.items, 1);
  }
  await ref.delete();
}

// ─── Банк (платежи) ─────────────────────────────────────

function mapPayment(id: string, data: any): BankPayment {
  return {
    id,
    number: Number(data.number) || 0,
    date: String(data.date || ""),
    direction: data.direction === "outgoing" ? "outgoing" : "incoming",
    counterparty: String(data.counterparty || ""),
    dealIds: Array.isArray(data.dealIds) ? data.dealIds.map(String) : [],
    dealNumbers: Array.isArray(data.dealNumbers)
      ? data.dealNumbers.map((n: any) => Number(n) || 0)
      : [],
    amount: Math.max(0, Number(data.amount) || 0),
    isPaid: data.isPaid === true,
    comment: data.comment ?? null,
    createdAt: serializeTimestamp(data.createdAt),
  };
}

export async function getPayments(): Promise<BankPayment[]> {
  const db = getAdminDb();
  const snap = await db
    .collection("bankPayments")
    .orderBy("number", "desc")
    .limit(300)
    .get();
  return snap.docs.map((d) => mapPayment(d.id, d.data()));
}

export async function createPayment(data: {
  date: string;
  direction: "incoming" | "outgoing";
  counterparty: string;
  dealIds: string[];
  amount: number;
  isPaid: boolean;
  comment?: string | null;
}): Promise<{ id: string; number: number }> {
  const amount = Math.max(0, Number(data.amount) || 0);
  if (amount <= 0) throw new Error("Укажите сумму платежа");
  if (!data.counterparty?.trim()) throw new Error("Укажите контрагента");
  const db = getAdminDb();

  // Номера привязанных заказов — для отображения
  const dealIds = Array.isArray(data.dealIds) ? data.dealIds.map(String) : [];
  const dealNumbers: number[] = [];
  for (const dealId of dealIds) {
    const snap = await db.collection("customerDeals").doc(dealId).get();
    if (snap.exists) dealNumbers.push(Number((snap.data() as any)?.number) || 0);
  }

  const number = await nextNumber("payment");
  const docRef = await db.collection("bankPayments").add({
    number,
    date: data.date || new Date().toISOString().slice(0, 10),
    direction: data.direction === "outgoing" ? "outgoing" : "incoming",
    counterparty: String(data.counterparty).slice(0, 200),
    dealIds,
    dealNumbers,
    amount,
    isPaid: data.isPaid === true,
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: docRef.id, number };
}

export async function updatePayment(
  id: string,
  data: {
    isPaid?: boolean;
    amount?: number;
    comment?: string | null;
    date?: string;
    counterparty?: string;
  }
): Promise<void> {
  const db = getAdminDb();
  const patch: Record<string, any> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (data.isPaid !== undefined) patch.isPaid = data.isPaid === true;
  if (data.amount !== undefined)
    patch.amount = Math.max(0, Number(data.amount) || 0);
  if (data.comment !== undefined)
    patch.comment = data.comment ? String(data.comment).slice(0, 500) : null;
  if (data.date !== undefined) patch.date = String(data.date);
  if (data.counterparty !== undefined)
    patch.counterparty = String(data.counterparty).slice(0, 200);
  await db.collection("bankPayments").doc(id).update(patch);
}

export async function deletePayment(id: string): Promise<void> {
  const db = getAdminDb();
  await db.collection("bankPayments").doc(id).delete();
}

/** Сводка по банку */
export function getBankSummary(payments: BankPayment[]) {
  let balance = 0;
  let expectedIn = 0;
  let expectedOut = 0;
  for (const p of payments) {
    if (p.isPaid) {
      balance += p.direction === "incoming" ? p.amount : -p.amount;
    } else if (p.direction === "incoming") {
      expectedIn += p.amount;
    } else {
      expectedOut += p.amount;
    }
  }
  return { balance, expectedIn, expectedOut };
}

/** Сколько оплачено по каждому заказу (id → сумма оплаченных входящих платежей) */
export function getDealPaidMap(payments: BankPayment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    if (!p.isPaid || p.direction !== "incoming") continue;
    const ids = p.dealIds.length > 0 ? p.dealIds : [];
    // Если платёж привязан к нескольким заказам — распределяем поровну,
    // чтобы итог по всем заказам сходился с суммой платежа
    const share = ids.length > 0 ? p.amount / ids.length : 0;
    for (const dealId of ids) {
      map.set(dealId, (map.get(dealId) || 0) + share);
    }
  }
  return map;
}
