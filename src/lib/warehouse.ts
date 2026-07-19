// =========================================================
// FILE: src/lib/warehouse.ts
// Учёт: склад (приходные ордера), заказы покупателей, банк.
// Коллекции Firestore:
//   warehouseReceipts — поступления товаров (+остаток)
//   customerDeals    — заказы покупателей (−остаток при проведении)
//   bankPayments     — входящие/исходящие платежи (создаются «в ожидании»,
//                      проводятся кнопкой — тогда меняют баланс банка)
//   counters/warehouse — сквозная нумерация документов
// =========================================================

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./firebase-admin";
import { getProductEffectivePrice } from "./types";

// ─── Типы ────────────────────────────────────────────────

export interface StockDocItem {
  productId: string;
  name: string;
  sku?: string | null;
  quantity: number;
  /** Цена за единицу (вычисляется из суммы строки для поступлений) */
  price: number;
  /** Сумма строки за всю партию (для поступлений — как ввели, с НДС) */
  lineTotal: number;
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
  /** Привязка к заказам покупателей (может несколько) */
  dealIds: string[];
  dealNumbers: number[];
  /** Привязка к поступлениям — для расходов поставщику */
  receiptIds: string[];
  receiptNumbers: number[];
  amount: number;
  isPaid: boolean;
  /** Дата фактического проведения платежа (YYYY-MM-DD) */
  paidAt?: string | null;
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cleanItems(items: any[]): StockDocItem[] {
  return (Array.isArray(items) ? items : [])
    .map((it: any) => {
      const quantity = Math.max(0, Number(it.quantity) || 0);
      let lineTotal = Math.max(0, Number(it.lineTotal) || 0);
      let price = Math.max(0, Number(it.price) || 0);
      if (lineTotal > 0 && quantity > 0) {
        // Введена общая сумма партии — цена за единицу вычисляется
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

function itemsTotal(items: StockDocItem[]): number {
  return round2(items.reduce((s, it) => s + it.lineTotal, 0));
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
  price: number | null;
  priceWholesale: number | null;
  isVisible: boolean;
}

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
export async function cancelDeal(
  id: string,
  reason?: string | null
): Promise<void> {
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
    receiptIds: Array.isArray(data.receiptIds)
      ? data.receiptIds.map(String)
      : [],
    receiptNumbers: Array.isArray(data.receiptNumbers)
      ? data.receiptNumbers.map((n: any) => Number(n) || 0)
      : [],
    amount: Math.max(0, Number(data.amount) || 0),
    isPaid: data.isPaid === true,
    paidAt: data.paidAt ? String(data.paidAt) : null,
    comment: data.comment ?? null,
    createdAt: serializeTimestamp(data.createdAt),
  };
}

export async function getPayments(): Promise<BankPayment[]> {
  const db = getAdminDb();
  const snap = await db
    .collection("bankPayments")
    .orderBy("number", "desc")
    .limit(500)
    .get();
  return snap.docs.map((d) => mapPayment(d.id, d.data()));
}

export async function createPayment(data: {
  date: string;
  direction: "incoming" | "outgoing";
  counterparty: string;
  dealIds?: string[];
  receiptIds?: string[];
  amount: number;
  isPaid?: boolean;
  comment?: string | null;
}): Promise<{ id: string; number: number }> {
  const amount = Math.max(0, Number(data.amount) || 0);
  if (amount <= 0) throw new Error("Укажите сумму платежа");
  if (!data.counterparty?.trim()) throw new Error("Укажите контрагента");
  const db = getAdminDb();

  // Номера привязанных документов — для отображения
  const dealIds = Array.isArray(data.dealIds) ? data.dealIds.map(String) : [];
  const dealNumbers: number[] = [];
  for (const dealId of dealIds) {
    const snap = await db.collection("customerDeals").doc(dealId).get();
    if (snap.exists) dealNumbers.push(Number((snap.data() as any)?.number) || 0);
  }

  const receiptIds = Array.isArray(data.receiptIds)
    ? data.receiptIds.map(String)
    : [];
  const receiptNumbers: number[] = [];
  for (const receiptId of receiptIds) {
    const snap = await db.collection("warehouseReceipts").doc(receiptId).get();
    if (snap.exists)
      receiptNumbers.push(Number((snap.data() as any)?.number) || 0);
  }

  const isPaid = data.isPaid === true;
  const date = data.date || new Date().toISOString().slice(0, 10);
  const number = await nextNumber("payment");
  const docRef = await db.collection("bankPayments").add({
    number,
    date,
    direction: data.direction === "outgoing" ? "outgoing" : "incoming",
    counterparty: String(data.counterparty).slice(0, 200),
    dealIds,
    dealNumbers,
    receiptIds,
    receiptNumbers,
    amount,
    // По умолчанию платёж создаётся «в ожидании» — баланс не меняется,
    // проводится позже отдельной кнопкой
    isPaid,
    paidAt: isPaid ? date : null,
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
  const ref = db.collection("bankPayments").doc(id);
  const patch: Record<string, any> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (data.isPaid !== undefined) {
    patch.isPaid = data.isPaid === true;
    // Проведение фиксирует дату факта; возврат в ожидание её снимает
    patch.paidAt = data.isPaid
      ? new Date().toISOString().slice(0, 10)
      : null;
  }
  if (data.amount !== undefined)
    patch.amount = Math.max(0, Number(data.amount) || 0);
  if (data.comment !== undefined)
    patch.comment = data.comment ? String(data.comment).slice(0, 500) : null;
  if (data.date !== undefined) patch.date = String(data.date);
  if (data.counterparty !== undefined)
    patch.counterparty = String(data.counterparty).slice(0, 200);
  await ref.update(patch);
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

/** Оплачено по каждому заказу (id → сумма оплаченных входящих платежей) */
export function getDealPaidMap(payments: BankPayment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    if (!p.isPaid || p.direction !== "incoming") continue;
    const share = p.dealIds.length > 0 ? p.amount / p.dealIds.length : 0;
    for (const dealId of p.dealIds) {
      map.set(dealId, (map.get(dealId) || 0) + share);
    }
  }
  return map;
}

/** Оплачено по каждому поступлению (id → сумма оплаченных исходящих) */
export function getReceiptPaidMap(payments: BankPayment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    if (!p.isPaid || p.direction !== "outgoing") continue;
    const share =
      p.receiptIds.length > 0 ? p.amount / p.receiptIds.length : 0;
    for (const receiptId of p.receiptIds) {
      map.set(receiptId, (map.get(receiptId) || 0) + share);
    }
  }
  return map;
}

// ─── Баланс по контрагентам ─────────────────────────────

export interface CounterpartyBalance {
  name: string;
  type: "customer" | "supplier";
  /** Сумма документов (заказов/поступлений) */
  docsTotal: number;
  /** Оплачено проведёнными платежами */
  paidTotal: number;
  /** Долг: положительный — нам должны (покупатель), мы должны (поставщик) */
  balance: number;
  /** Дата последнего проведённого платежа */
  lastPaymentDate: string | null;
  docsCount: number;
}

export function getCounterpartyBalances(
  deals: CustomerDeal[],
  receipts: WarehouseReceipt[],
  payments: BankPayment[]
): CounterpartyBalance[] {
  const result = new Map<string, CounterpartyBalance>();

  // Покупатели — из неотменённых заказов
  const dealCustomer = new Map<string, string>();
  for (const d of deals) {
    if (d.status === "cancelled") continue;
    dealCustomer.set(d.id, d.customerName);
    const key = `customer:${d.customerName}`;
    const row =
      result.get(key) ??
      ({
        name: d.customerName,
        type: "customer",
        docsTotal: 0,
        paidTotal: 0,
        balance: 0,
        lastPaymentDate: null,
        docsCount: 0,
      } satisfies CounterpartyBalance);
    row.docsTotal += d.total;
    row.docsCount += 1;
    result.set(key, row);
  }

  // Поставщики — из поступлений
  const receiptSupplier = new Map<string, string>();
  for (const r of receipts) {
    if (!r.supplier) continue;
    receiptSupplier.set(r.id, r.supplier);
    const key = `supplier:${r.supplier}`;
    const row =
      result.get(key) ??
      ({
        name: r.supplier,
        type: "supplier",
        docsTotal: 0,
        paidTotal: 0,
        balance: 0,
        lastPaymentDate: null,
        docsCount: 0,
      } satisfies CounterpartyBalance);
    row.docsTotal += r.total;
    row.docsCount += 1;
    result.set(key, row);
  }

  // Проведённые платежи распределяем по привязанным документам
  for (const p of payments) {
    if (!p.isPaid) continue;
    const payDate = p.paidAt || p.date;

    if (p.direction === "incoming" && p.dealIds.length > 0) {
      const share = p.amount / p.dealIds.length;
      for (const dealId of p.dealIds) {
        const name = dealCustomer.get(dealId);
        if (!name) continue;
        const row = result.get(`customer:${name}`);
        if (!row) continue;
        row.paidTotal += share;
        if (!row.lastPaymentDate || payDate > row.lastPaymentDate) {
          row.lastPaymentDate = payDate;
        }
      }
    }

    if (p.direction === "outgoing" && p.receiptIds.length > 0) {
      const share = p.amount / p.receiptIds.length;
      for (const receiptId of p.receiptIds) {
        const name = receiptSupplier.get(receiptId);
        if (!name) continue;
        const row = result.get(`supplier:${name}`);
        if (!row) continue;
        row.paidTotal += share;
        if (!row.lastPaymentDate || payDate > row.lastPaymentDate) {
          row.lastPaymentDate = payDate;
        }
      }
    }
  }

  const list = [...result.values()].map((row) => ({
    ...row,
    docsTotal: round2(row.docsTotal),
    paidTotal: round2(row.paidTotal),
    balance: round2(row.docsTotal - row.paidTotal),
  }));
  // Сначала с открытым долгом, потом по имени
  list.sort((a, b) => {
    const aOpen = Math.abs(a.balance) > 0.009 ? 1 : 0;
    const bOpen = Math.abs(b.balance) > 0.009 ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    return a.name.localeCompare(b.name, "ru");
  });
  return list;
}
