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

import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./firebase-admin";
import { getProductEffectivePrice } from "./types";
import { includedVat, VAT_RATE } from "./vat";

export { includedVat, VAT_RATE } from "./vat";

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

export type CounterpartyRole = "supplier" | "customer";

export interface CounterpartyDetails {
  phone?: string | null;
  email?: string | null;
  inn?: string | null;
  kpp?: string | null;
  address?: string | null;
  contactName?: string | null;
}

export interface Counterparty extends CounterpartyDetails {
  id: string;
  name: string;
  normalizedName: string;
  roles: CounterpartyRole[];
  /** Последняя закупочная цена по каждому товару для этого поставщика. */
  supplierPrices?: Record<string, number>;
  comment?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type ReceiptStatus = "draft" | "posted";

export interface WarehouseReceipt extends CounterpartyDetails {
  id: string;
  number: number;
  date: string; // YYYY-MM-DD
  supplier: string;
  status: ReceiptStatus;
  counterpartyId?: string | null;
  comment?: string | null;
  items: StockDocItem[];
  total: number;
  /** Разница между суммой строк и фактическим банковским платежом. */
  bankAdjustment: number;
  vatRate: number;
  vatAmount: number;
  createdAt?: string | null;
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
  createdAt?: string | null;
}

export interface BankPayment {
  id: string;
  number: number;
  date: string;
  direction: "incoming" | "outgoing";
  counterparty: string;
  counterpartyId?: string | null;
  /** Привязка к заказам покупателей (может несколько) */
  dealIds: string[];
  dealNumbers: number[];
  /** Привязка к поступлениям — для расходов поставщику */
  receiptIds: string[];
  receiptNumbers: number[];
  amount: number;
  /** Пользовательский номер счёта из внешней учётной программы. */
  invoiceNumber?: string | null;
  vatRate: number;
  vatAmount: number;
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

function cleanText(value: unknown, max: number): string | null {
  const result = String(value ?? "").trim().slice(0, max);
  return result || null;
}

function normalizeCounterpartyName(name: string): string {
  return String(name || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[«»"']/g, "")
    .replace(/\s+/g, " ");
}

function counterpartyIdForName(name: string): string {
  return `cp_${createHash("sha256")
    .update(normalizeCounterpartyName(name))
    .digest("hex")
    .slice(0, 32)}`;
}

function counterpartyPayload(
  name: string,
  role: CounterpartyRole,
  details: CounterpartyDetails & {
    comment?: string | null;
    supplierPrices?: Record<string, number>;
  }
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: name.trim().slice(0, 200),
    normalizedName: normalizeCounterpartyName(name),
    roles: FieldValue.arrayUnion(role),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const fields: (keyof CounterpartyDetails)[] = [
    "phone",
    "email",
    "inn",
    "kpp",
    "address",
    "contactName",
  ];
  for (const field of fields) {
    const value = cleanText(details[field], field === "address" ? 400 : 160);
    if (value) payload[field] = value;
  }
  const comment = cleanText(details.comment, 1000);
  if (comment) payload.comment = comment;
  if (details.supplierPrices) {
    payload.supplierPrices = details.supplierPrices;
  }
  return payload;
}

function addCounterpartyToBatch(
  batch: FirebaseFirestore.WriteBatch,
  role: CounterpartyRole,
  name: string,
  details: CounterpartyDetails & {
    comment?: string | null;
    supplierPrices?: Record<string, number>;
  }
): string {
  const db = getAdminDb();
  const id = counterpartyIdForName(name);
  batch.set(
    db.collection("counterparties").doc(id),
    counterpartyPayload(name, role, details),
    { merge: true }
  );
  return id;
}

function mapCounterparty(id: string, data: any): Counterparty {
  return {
    id,
    name: String(data.name || ""),
    normalizedName:
      String(data.normalizedName || "") || normalizeCounterpartyName(data.name),
    roles: Array.isArray(data.roles)
      ? data.roles.filter(
          (role: unknown): role is CounterpartyRole =>
            role === "supplier" || role === "customer"
        )
      : [],
    supplierPrices:
      data.supplierPrices && typeof data.supplierPrices === "object"
        ? Object.fromEntries(
            Object.entries(data.supplierPrices).map(([id, price]) => [
              id,
              Math.max(0, Number(price) || 0),
            ])
          )
        : {},
    phone: data.phone ?? null,
    email: data.email ?? null,
    inn: data.inn ?? null,
    kpp: data.kpp ?? null,
    address: data.address ?? null,
    contactName: data.contactName ?? null,
    comment: data.comment ?? null,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

export async function getCounterparties(): Promise<Counterparty[]> {
  const db = getAdminDb();
  const [counterpartySnap, receiptSnap, dealSnap] = await Promise.all([
    db.collection("counterparties").get(),
    db.collection("warehouseReceipts").get(),
    db.collection("customerDeals").get(),
  ]);
  const map = new Map<string, Counterparty>();
  for (const doc of counterpartySnap.docs) {
    map.set(doc.id, mapCounterparty(doc.id, doc.data()));
  }

  function mergeLegacy(
    role: CounterpartyRole,
    nameValue: unknown,
    data: any
  ) {
    const name = String(nameValue || "").trim();
    if (!name) return;
    const id = String(data.counterpartyId || counterpartyIdForName(name));
    const existing = map.get(id);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      for (const field of [
        "phone",
        "email",
        "inn",
        "kpp",
        "address",
        "contactName",
      ] as (keyof CounterpartyDetails)[]) {
        if (!existing[field] && data[field]) existing[field] = String(data[field]);
      }
      return;
    }
    map.set(id, {
      id,
      name,
      normalizedName: normalizeCounterpartyName(name),
      roles: [role],
      supplierPrices: {},
      phone: data.phone || data.customerPhone || null,
      email: data.email || null,
      inn: data.inn || null,
      kpp: data.kpp || null,
      address: data.address || null,
      contactName: data.contactName || null,
      comment: null,
      createdAt: null,
      updatedAt: null,
    });
  }

  for (const doc of receiptSnap.docs) {
    const data = doc.data();
    mergeLegacy("supplier", data.supplier, data);
  }
  for (const doc of dealSnap.docs) {
    const data = doc.data();
    mergeLegacy("customer", data.customerName, data);
  }

  const rows = [...map.values()];
  rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return rows;
}

export async function saveCounterparty(data: {
  id?: string;
  name: string;
  roles: CounterpartyRole[];
  phone?: string | null;
  email?: string | null;
  inn?: string | null;
  kpp?: string | null;
  address?: string | null;
  contactName?: string | null;
  comment?: string | null;
}): Promise<{ id: string }> {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Укажите название контрагента");
  const roles = data.roles.filter(
    (role): role is CounterpartyRole =>
      role === "supplier" || role === "customer"
  );
  if (roles.length === 0) throw new Error("Выберите тип контрагента");
  const db = getAdminDb();
  const id = data.id || counterpartyIdForName(name);
  await db
    .collection("counterparties")
    .doc(id)
    .set(
      {
        name: name.slice(0, 200),
        normalizedName: normalizeCounterpartyName(name),
        roles,
        phone: cleanText(data.phone, 60),
        email: cleanText(data.email, 160),
        inn: cleanText(data.inn, 20),
        kpp: cleanText(data.kpp, 20),
        address: cleanText(data.address, 400),
        contactName: cleanText(data.contactName, 160),
        comment: cleanText(data.comment, 1000),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  return { id };
}

export async function deleteCounterparty(id: string): Promise<void> {
  await getAdminDb().collection("counterparties").doc(id).delete();
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
  await db.runTransaction(async (transaction) => {
    const rows: {
      ref: FirebaseFirestore.DocumentReference;
      current: number;
      delta: number;
    }[] = [];
    for (const [productId, delta] of byProduct) {
      const ref = db.collection("products").doc(productId);
      const snap = await transaction.get(ref);
      rows.push({
        ref,
        current: snap.exists ? Number(snap.data()?.stockQty) || 0 : 0,
        delta,
      });
    }
    for (const row of rows) {
      const next = row.current + row.delta;
      transaction.set(
        row.ref,
        {
          stockQty: next,
          inStock: next > 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });
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

export async function setWarehouseStock(
  productId: string,
  quantity: number
): Promise<void> {
  const stockQty = Math.max(0, Math.floor(Number(quantity) || 0));
  await getAdminDb()
    .collection("products")
    .doc(productId)
    .update({
      stockQty,
      inStock: stockQty > 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
}

// ─── Поступления (приходные ордера) ─────────────────────

function mapReceipt(id: string, data: any): WarehouseReceipt {
  return {
    id,
    number: Number(data.number) || 0,
    date: String(data.date || ""),
    supplier: String(data.supplier || ""),
    status: data.status === "draft" ? "draft" : "posted",
    counterpartyId: data.counterpartyId ?? null,
    phone: data.phone ?? null,
    email: data.email ?? null,
    inn: data.inn ?? null,
    kpp: data.kpp ?? null,
    address: data.address ?? null,
    contactName: data.contactName ?? null,
    comment: data.comment ?? null,
    items: cleanItems(data.items),
    total: Number(data.total) || 0,
    bankAdjustment: Number(data.bankAdjustment) || 0,
    vatRate: Number(data.vatRate) || VAT_RATE,
    vatAmount:
      data.vatAmount !== undefined
        ? Number(data.vatAmount) || 0
        : includedVat(Number(data.total) || 0),
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
  phone?: string | null;
  email?: string | null;
  inn?: string | null;
  kpp?: string | null;
  address?: string | null;
  contactName?: string | null;
  comment?: string | null;
  items: StockDocItem[];
}): Promise<{ id: string; number: number }> {
  const items = cleanItems(data.items);
  if (!data.supplier?.trim()) {
    throw new Error("Укажите поставщика");
  }
  if (items.length === 0) {
    throw new Error("Добавьте хотя бы одну позицию");
  }
  const total = itemsTotal(items);
  if (total <= 0) {
    throw new Error("Укажите сумму поступления больше нуля");
  }
  const db = getAdminDb();
  const number = await nextNumber("receipt");
  const date = data.date || new Date().toISOString().slice(0, 10);
  const supplier = String(data.supplier || "").slice(0, 200);
  const vatAmount = includedVat(total);
  const payNumber = await nextNumber("payment");
  const docRef = db.collection("warehouseReceipts").doc();
  const paymentRef = db.collection("bankPayments").doc();
  const batch = db.batch();
  const details: CounterpartyDetails = {
    phone: cleanText(data.phone, 60),
    email: cleanText(data.email, 160),
    inn: cleanText(data.inn, 20),
    kpp: cleanText(data.kpp, 20),
    address: cleanText(data.address, 400),
    contactName: cleanText(data.contactName, 160),
  };
  const counterpartyId = addCounterpartyToBatch(
    batch,
    "supplier",
    supplier,
    {
      ...details,
      comment: data.comment,
      supplierPrices: Object.fromEntries(
        items.map((item) => [item.productId, item.price])
      ),
    }
  );

  batch.set(docRef, {
    number,
    date,
    supplier,
    status: "draft",
    counterpartyId,
    ...details,
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    items,
    total,
    bankAdjustment: 0,
    vatRate: VAT_RATE,
    vatAmount,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Новый документ остаётся черновиком: товар попадёт на склад только
  // после оплаты связанного счёта и отдельного ручного проведения.

  batch.set(paymentRef, {
    number: payNumber,
    date,
    direction: "outgoing",
    counterparty: supplier || "Поставщик",
    counterpartyId,
    dealIds: [],
    dealNumbers: [],
    receiptIds: [docRef.id],
    receiptNumbers: [number],
    amount: total,
    invoiceNumber: null,
    vatRate: VAT_RATE,
    vatAmount,
    isPaid: false,
    paidAt: null,
    comment: `Оплата поставщику по приходному ордеру ПО-${number}`,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { id: docRef.id, number };
}

export async function updateReceipt(
  id: string,
  data: {
    date: string;
    supplier: string;
    phone?: string | null;
    email?: string | null;
    inn?: string | null;
    kpp?: string | null;
    address?: string | null;
    contactName?: string | null;
    comment?: string | null;
    items: StockDocItem[];
  }
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("warehouseReceipts").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Поступление не найдено");
  const previous = mapReceipt(id, snap.data());
  const items = cleanItems(data.items);
  if (!data.supplier?.trim()) throw new Error("Укажите поставщика");
  if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");
  const linesTotal = itemsTotal(items);
  if (linesTotal <= 0) throw new Error("Укажите сумму поступления больше нуля");

  const paymentSnap = await db
    .collection("bankPayments")
    .where("receiptIds", "array-contains", id)
    .get();
  const paidTotal = paymentSnap.docs.reduce((sum, doc) => {
    const payment = doc.data();
    return payment.isPaid === true && payment.direction === "outgoing"
      ? sum + (Number(payment.amount) || 0)
      : sum;
  }, 0);
  const total = paidTotal > 0 ? paidTotal : linesTotal;
  const bankAdjustment = round2(total - linesTotal);
  const details: CounterpartyDetails = {
    phone: cleanText(data.phone, 60),
    email: cleanText(data.email, 160),
    inn: cleanText(data.inn, 20),
    kpp: cleanText(data.kpp, 20),
    address: cleanText(data.address, 400),
    contactName: cleanText(data.contactName, 160),
  };
  const supplier = data.supplier.trim().slice(0, 200);

  if (previous.status === "posted") {
    const delta = new Map<string, number>();
    for (const item of previous.items) {
      delta.set(item.productId, (delta.get(item.productId) || 0) - item.quantity);
    }
    for (const item of items) {
      delta.set(item.productId, (delta.get(item.productId) || 0) + item.quantity);
    }
    await db.runTransaction(async (transaction) => {
      const stocks: {
        ref: FirebaseFirestore.DocumentReference;
        next: number;
      }[] = [];
      for (const [productId, change] of delta) {
        if (change === 0) continue;
        const productRef = db.collection("products").doc(productId);
        const productSnap = await transaction.get(productRef);
        const current = productSnap.exists
          ? Number(productSnap.data()?.stockQty) || 0
          : 0;
        stocks.push({ ref: productRef, next: current + change });
      }
      for (const stock of stocks) {
        transaction.set(
          stock.ref,
          {
            stockQty: stock.next,
            inStock: stock.next > 0,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      transaction.update(ref, {
        date: data.date,
        supplier,
        ...details,
        comment: cleanText(data.comment, 500),
        items,
        total,
        bankAdjustment,
        vatRate: VAT_RATE,
        vatAmount: includedVat(total),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } else {
    await ref.update({
      date: data.date,
      supplier,
      ...details,
      comment: cleanText(data.comment, 500),
      items,
      total,
      bankAdjustment,
      vatRate: VAT_RATE,
      vatAmount: includedVat(total),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const batch = db.batch();
  const counterpartyId = addCounterpartyToBatch(batch, "supplier", supplier, {
    ...details,
    comment: data.comment,
    supplierPrices: Object.fromEntries(
      items.map((item) => [item.productId, item.price])
    ),
  });
  batch.update(ref, { counterpartyId });
  for (const payment of paymentSnap.docs) {
    if (payment.data().isPaid === true) continue;
    batch.update(payment.ref, {
      counterparty: supplier,
      counterpartyId,
      amount: linesTotal,
      vatRate: VAT_RATE,
      vatAmount: includedVat(linesTotal),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function postReceipt(id: string): Promise<void> {
  const db = getAdminDb();
  const receiptRef = db.collection("warehouseReceipts").doc(id);
  const paymentQuery = await db
    .collection("bankPayments")
    .where("receiptIds", "array-contains", id)
    .get();

  await db.runTransaction(async (transaction) => {
    const receiptSnap = await transaction.get(receiptRef);
    if (!receiptSnap.exists) throw new Error("Поступление не найдено");
    const receipt = mapReceipt(id, receiptSnap.data());
    if (receipt.status === "posted") return;

    let paid = 0;
    for (const paymentDoc of paymentQuery.docs) {
      const paymentSnap = await transaction.get(paymentDoc.ref);
      const payment = paymentSnap.data();
      if (payment?.isPaid === true && payment.direction === "outgoing") {
        paid += Number(payment.amount) || 0;
      }
    }
    if (paid + 0.009 < receipt.total) {
      throw new Error(
        `Сначала проведите оплату счёта в банке. Оплачено ${paid.toLocaleString("ru-RU")} из ${receipt.total.toLocaleString("ru-RU")} ₽`
      );
    }

    const quantities = new Map<string, number>();
    for (const item of receipt.items) {
      quantities.set(
        item.productId,
        (quantities.get(item.productId) || 0) + item.quantity
      );
    }
    const stockRows: {
      ref: FirebaseFirestore.DocumentReference;
      next: number;
    }[] = [];
    for (const [productId, quantity] of quantities) {
      const productRef = db.collection("products").doc(productId);
      const productSnap = await transaction.get(productRef);
      const current = productSnap.exists
        ? Number(productSnap.data()?.stockQty) || 0
        : 0;
      stockRows.push({ ref: productRef, next: current + quantity });
    }
    for (const stock of stockRows) {
      transaction.set(
        stock.ref,
        {
          stockQty: stock.next,
          inStock: stock.next > 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    transaction.update(receiptRef, {
      status: "posted",
      postedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function deleteReceipt(id: string): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("warehouseReceipts").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  const receipt = mapReceipt(id, snap.data());
  if (receipt.status === "posted") {
    await applyStockDelta(receipt.items, -1);
  }
  await ref.delete();
  // Чистим привязанные платежи: «в ожидании» только с этим поступлением —
  // удаляем; с несколькими ордерами — просто отвязываем это поступление.
  // Проведённые платежи (история денег) не трогаем.
  const paySnap = await db
    .collection("bankPayments")
    .where("receiptIds", "array-contains", id)
    .get();
  for (const doc of paySnap.docs) {
    const p = doc.data() as any;
    if (p.isPaid === true) continue;
    const ids: string[] = Array.isArray(p.receiptIds) ? [...p.receiptIds] : [];
    const nums: number[] = Array.isArray(p.receiptNumbers)
      ? [...p.receiptNumbers]
      : [];
    const idx = ids.indexOf(id);
    if (idx >= 0) {
      ids.splice(idx, 1);
      nums.splice(idx, 1);
    }
    const hasLinks = ids.length > 0 || (p.dealIds || []).length > 0;
    if (!hasLinks) {
      await doc.ref.delete();
    } else if (idx >= 0) {
      await doc.ref.update({
        receiptIds: ids,
        receiptNumbers: nums,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
}

// ─── Заказы покупателей ─────────────────────────────────

function mapDeal(id: string, data: any): CustomerDeal {
  return {
    id,
    number: Number(data.number) || 0,
    date: String(data.date || ""),
    customerName: String(data.customerName || ""),
    counterpartyId: data.counterpartyId ?? null,
    customerPhone: data.customerPhone ?? data.phone ?? null,
    phone: data.phone ?? data.customerPhone ?? null,
    email: data.email ?? null,
    inn: data.inn ?? null,
    kpp: data.kpp ?? null,
    address: data.address ?? null,
    contactName: data.contactName ?? null,
    comment: data.comment ?? null,
    items: cleanItems(data.items),
    total: Number(data.total) || 0,
    bankAdjustment: Number(data.bankAdjustment) || 0,
    vatRate: Number(data.vatRate) || VAT_RATE,
    vatAmount:
      data.vatAmount !== undefined
        ? Number(data.vatAmount) || 0
        : includedVat(Number(data.total) || 0),
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
  email?: string | null;
  inn?: string | null;
  kpp?: string | null;
  address?: string | null;
  contactName?: string | null;
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
  const total = itemsTotal(items);
  if (total <= 0) {
    throw new Error("Укажите цену товаров, итог заказа должен быть больше нуля");
  }
  const db = getAdminDb();
  const number = await nextNumber("deal");
  const paymentNumber = await nextNumber("payment");
  const date = data.date || new Date().toISOString().slice(0, 10);
  const customerName = String(data.customerName).slice(0, 200);
  const vatAmount = includedVat(total);
  const docRef = db.collection("customerDeals").doc();
  const paymentRef = db.collection("bankPayments").doc();
  const batch = db.batch();
  const details: CounterpartyDetails = {
    phone: cleanText(data.customerPhone, 60),
    email: cleanText(data.email, 160),
    inn: cleanText(data.inn, 20),
    kpp: cleanText(data.kpp, 20),
    address: cleanText(data.address, 400),
    contactName: cleanText(data.contactName, 160),
  };
  const counterpartyId = addCounterpartyToBatch(
    batch,
    "customer",
    customerName,
    { ...details, comment: data.comment }
  );

  batch.set(docRef, {
    number,
    date,
    customerName,
    counterpartyId,
    customerPhone: details.phone,
    ...details,
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    items,
    total,
    bankAdjustment: 0,
    vatRate: VAT_RATE,
    vatAmount,
    status: "new",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Счёт покупателю появляется в банке одновременно с заказом. Он ещё не
  // проведён и начнёт влиять на баланс только после фактической оплаты.
  batch.set(paymentRef, {
    number: paymentNumber,
    date,
    direction: "incoming",
    counterparty: customerName,
    counterpartyId,
    dealIds: [docRef.id],
    dealNumbers: [number],
    receiptIds: [],
    receiptNumbers: [],
    amount: total,
    invoiceNumber: null,
    vatRate: VAT_RATE,
    vatAmount,
    isPaid: false,
    paidAt: null,
    comment: `Счёт покупателю по заказу ЗК-${number}`,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { id: docRef.id, number };
}

export async function updateDeal(
  id: string,
  data: {
    date: string;
    customerName: string;
    customerPhone?: string | null;
    email?: string | null;
    inn?: string | null;
    kpp?: string | null;
    address?: string | null;
    contactName?: string | null;
    comment?: string | null;
    items: StockDocItem[];
  }
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("customerDeals").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Заказ не найден");
  const previous = mapDeal(id, snap.data());
  if (previous.status === "cancelled") {
    throw new Error("Отменённый заказ нельзя редактировать");
  }

  const items = cleanItems(data.items);
  const customerName = String(data.customerName || "").trim().slice(0, 200);
  if (!customerName) throw new Error("Укажите покупателя");
  if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");
  const linesTotal = itemsTotal(items);
  if (linesTotal <= 0) {
    throw new Error("Укажите цену товаров, итог заказа должен быть больше нуля");
  }

  const paymentSnap = await db
    .collection("bankPayments")
    .where("dealIds", "array-contains", id)
    .get();
  const paidTotal = paymentSnap.docs.reduce((sum, doc) => {
    const payment = doc.data();
    return payment.isPaid === true && payment.direction === "incoming"
      ? sum + (Number(payment.amount) || 0)
      : sum;
  }, 0);
  const total = paidTotal > 0 ? paidTotal : linesTotal;
  const bankAdjustment = round2(total - linesTotal);
  const details: CounterpartyDetails = {
    phone: cleanText(data.customerPhone, 60),
    email: cleanText(data.email, 160),
    inn: cleanText(data.inn, 20),
    kpp: cleanText(data.kpp, 20),
    address: cleanText(data.address, 400),
    contactName: cleanText(data.contactName, 160),
  };
  const dealPatch = {
    date: data.date,
    customerName,
    customerPhone: details.phone,
    ...details,
    comment: cleanText(data.comment, 500),
    items,
    total,
    bankAdjustment,
    vatRate: VAT_RATE,
    vatAmount: includedVat(total),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (previous.status === "completed") {
    const delta = new Map<string, number>();
    // Старый состав возвращаем, новый состав снова списываем.
    for (const item of previous.items) {
      delta.set(item.productId, (delta.get(item.productId) || 0) + item.quantity);
    }
    for (const item of items) {
      delta.set(item.productId, (delta.get(item.productId) || 0) - item.quantity);
    }
    await db.runTransaction(async (transaction) => {
      const stocks: {
        ref: FirebaseFirestore.DocumentReference;
        next: number;
      }[] = [];
      for (const [productId, change] of delta) {
        if (change === 0) continue;
        const productRef = db.collection("products").doc(productId);
        const productSnap = await transaction.get(productRef);
        const current = productSnap.exists
          ? Number(productSnap.data()?.stockQty) || 0
          : 0;
        stocks.push({ ref: productRef, next: current + change });
      }
      for (const stock of stocks) {
        transaction.set(
          stock.ref,
          {
            stockQty: stock.next,
            inStock: stock.next > 0,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      transaction.update(ref, dealPatch);
    });
  } else {
    await ref.update(dealPatch);
  }

  const batch = db.batch();
  const counterpartyId = addCounterpartyToBatch(
    batch,
    "customer",
    customerName,
    { ...details, comment: data.comment }
  );
  batch.update(ref, { counterpartyId });
  for (const payment of paymentSnap.docs) {
    if (payment.data().isPaid === true) continue;
    batch.update(payment.ref, {
      counterparty: customerName,
      counterpartyId,
      amount: linesTotal,
      vatRate: VAT_RATE,
      vatAmount: includedVat(linesTotal),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

/** Провести заказ — списать товар со склада */
export async function postDeal(id: string): Promise<void> {
  const db = getAdminDb();
  const dealRef = db.collection("customerDeals").doc(id);
  await db.runTransaction(async (transaction) => {
    const dealSnap = await transaction.get(dealRef);
    if (!dealSnap.exists) throw new Error("Заказ не найден");
    const deal = mapDeal(id, dealSnap.data());
    if (deal.status === "completed") return;
    if (deal.status === "cancelled") throw new Error("Заказ отменён");

    const quantities = new Map<string, number>();
    for (const item of deal.items) {
      quantities.set(
        item.productId,
        (quantities.get(item.productId) || 0) + item.quantity
      );
    }
    const stockRows: {
      ref: FirebaseFirestore.DocumentReference;
      next: number;
    }[] = [];
    // Все чтения выполняются до записей. Повторное нажатие «Провести» не
    // спишет товар дважды: статус заказа проверяется в той же транзакции.
    for (const [productId, quantity] of quantities) {
      const productRef = db.collection("products").doc(productId);
      const productSnap = await transaction.get(productRef);
      const current = productSnap.exists
        ? Number(productSnap.data()?.stockQty) || 0
        : 0;
      stockRows.push({ ref: productRef, next: current - quantity });
    }
    for (const row of stockRows) {
      transaction.set(
        row.ref,
        {
          stockQty: row.next,
          inStock: row.next > 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    transaction.update(dealRef, {
      status: "completed",
      postedAt: FieldValue.serverTimestamp(),
      cancelReason: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/** Удалить/отвязать неоплаченные счета, связанные с отменённым заказом. */
async function cleanupPendingDealPayments(
  dealId: string,
  db = getAdminDb()
): Promise<void> {
  const paySnap = await db
    .collection("bankPayments")
    .where("dealIds", "array-contains", dealId)
    .get();
  for (const doc of paySnap.docs) {
    const payment = doc.data() as any;
    if (payment.isPaid === true) continue;
    const ids: string[] = Array.isArray(payment.dealIds)
      ? [...payment.dealIds]
      : [];
    const numbers: number[] = Array.isArray(payment.dealNumbers)
      ? [...payment.dealNumbers]
      : [];
    const index = ids.indexOf(dealId);
    if (index < 0) continue;
    ids.splice(index, 1);
    numbers.splice(index, 1);
    const hasLinks = ids.length > 0 || (payment.receiptIds || []).length > 0;
    if (!hasLinks) {
      await doc.ref.delete();
    } else {
      await doc.ref.update({
        dealIds: ids,
        dealNumbers: numbers,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
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
  await cleanupPendingDealPayments(id, db);
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
  await cleanupPendingDealPayments(id, db);
}

// ─── Банк (платежи) ─────────────────────────────────────

function mapPayment(id: string, data: any): BankPayment {
  return {
    id,
    number: Number(data.number) || 0,
    date: String(data.date || ""),
    direction: data.direction === "outgoing" ? "outgoing" : "incoming",
    counterparty: String(data.counterparty || ""),
    counterpartyId: data.counterpartyId ?? null,
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
    invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : null,
    vatRate: Number(data.vatRate) || VAT_RATE,
    vatAmount:
      data.vatAmount !== undefined
        ? Math.max(0, Number(data.vatAmount) || 0)
        : includedVat(Number(data.amount) || 0),
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
  invoiceNumber?: string | null;
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
  const docRef = db.collection("bankPayments").doc();
  const batch = db.batch();
  const counterparty = String(data.counterparty).trim().slice(0, 200);
  const counterpartyId = addCounterpartyToBatch(
    batch,
    data.direction === "outgoing" ? "supplier" : "customer",
    counterparty,
    {}
  );
  batch.set(docRef, {
    number,
    date,
    direction: data.direction === "outgoing" ? "outgoing" : "incoming",
    counterparty,
    counterpartyId,
    dealIds,
    dealNumbers,
    receiptIds,
    receiptNumbers,
    amount,
    invoiceNumber: cleanText(data.invoiceNumber, 100),
    vatRate: VAT_RATE,
    vatAmount: includedVat(amount),
    // По умолчанию платёж создаётся «в ожидании» — баланс не меняется,
    // проводится позже отдельной кнопкой
    isPaid,
    paidAt: isPaid ? date : null,
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { id: docRef.id, number };
}

async function syncPaymentAmountToDocuments(
  payment: BankPayment,
  amount: number
): Promise<void> {
  const db = getAdminDb();
  const links = [
    ...payment.dealIds.map((id) => ({ id, collection: "customerDeals" })),
    ...payment.receiptIds.map((id) => ({ id, collection: "warehouseReceipts" })),
  ];
  if (links.length === 0) return;
  const documents = await Promise.all(
    links.map((link) => db.collection(link.collection).doc(link.id).get())
  );
  const currentTotals = documents.map((doc) =>
    doc.exists ? Math.max(0, Number(doc.data()?.total) || 0) : 0
  );
  const sum = currentTotals.reduce((total, value) => total + value, 0);
  const batch = db.batch();
  documents.forEach((doc, index) => {
    if (!doc.exists) return;
    const share =
      documents.length === 1
        ? amount
        : sum > 0
          ? round2((amount * currentTotals[index]) / sum)
          : round2(amount / documents.length);
    const lines = itemsTotal(cleanItems(doc.data()?.items || []));
    batch.update(doc.ref, {
      total: share,
      bankAdjustment: round2(share - lines),
      vatRate: VAT_RATE,
      vatAmount: includedVat(share),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
}

export async function updatePayment(
  id: string,
  data: {
    isPaid?: boolean;
    amount?: number;
    comment?: string | null;
    date?: string;
    counterparty?: string;
    invoiceNumber?: string | null;
  }
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("bankPayments").doc(id);
  const existingSnap = await ref.get();
  if (!existingSnap.exists) throw new Error("Платёж не найден");
  const existing = mapPayment(id, existingSnap.data());

  if (data.isPaid === false && existing.receiptIds.length > 0) {
    const receipts = await Promise.all(
      existing.receiptIds.map((receiptId) =>
        db.collection("warehouseReceipts").doc(receiptId).get()
      )
    );
    if (receipts.some(
      (receipt) => receipt.exists && receipt.data()?.status !== "draft"
    )) {
      throw new Error(
        "Нельзя отменить оплату: связанное поступление уже проведено на склад"
      );
    }
  }

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
  if (data.amount !== undefined) {
    patch.amount = Math.max(0, Number(data.amount) || 0);
    patch.vatRate = VAT_RATE;
    patch.vatAmount = includedVat(patch.amount);
  }
  if (data.comment !== undefined)
    patch.comment = data.comment ? String(data.comment).slice(0, 500) : null;
  if (data.date !== undefined) patch.date = String(data.date);
  if (data.counterparty !== undefined)
    patch.counterparty = String(data.counterparty).slice(0, 200);
  if (data.invoiceNumber !== undefined)
    patch.invoiceNumber = cleanText(data.invoiceNumber, 100);
  await ref.update(patch);
  if (data.amount !== undefined) {
    await syncPaymentAmountToDocuments(existing, patch.amount);
  }
}

export async function deletePayment(id: string): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("bankPayments").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  const payment = mapPayment(id, snap.data());
  if (payment.receiptIds.length > 0) {
    const receipts = await Promise.all(
      payment.receiptIds.map((receiptId) =>
        db.collection("warehouseReceipts").doc(receiptId).get()
      )
    );
    if (receipts.some(
      (receipt) => receipt.exists && receipt.data()?.status !== "draft"
    )) {
      throw new Error(
        "Нельзя удалить оплату: связанное поступление уже проведено на склад"
      );
    }
  }
  await ref.delete();
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
