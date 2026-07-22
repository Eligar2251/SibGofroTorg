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
import { revalidateTag, unstable_cache } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./firebase-admin";
import { getProductEffectivePrice } from "./types";
import {
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
    "ogrn",
    "fullName",
    "shortName",
    "legalAddress",
    "taxSystem",
    "bankAccount",
    "bankName",
    "bik",
    "correspondentAccount",
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
  const counterpartyRef = db.collection("counterparties").doc(id);
  batch.set(counterpartyRef, counterpartyPayload(name, role, details), {
    merge: true,
  });
  // Отдельные документы гарантируют, что новая поставка обновит цены только
  // своих позиций и не затрёт ранее сохранённый прайс этого поставщика.
  for (const [productId, value] of Object.entries(
    details.supplierPrices || {}
  )) {
    const price = Math.max(0, Number(value) || 0);
    if (!productId || price <= 0) continue;
    batch.set(
      counterpartyRef.collection("supplierPrices").doc(productId),
      {
        productId,
        price,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
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
    ogrn: data.ogrn ?? null,
    fullName: data.fullName ?? null,
    shortName: data.shortName ?? null,
    legalAddress: data.legalAddress ?? null,
    taxSystem: data.taxSystem ?? null,
    bankAccount: data.bankAccount ?? null,
    bankName: data.bankName ?? null,
    bik: data.bik ?? null,
    correspondentAccount: data.correspondentAccount ?? null,
    address: data.address ?? null,
    contactName: data.contactName ?? null,
    comment: data.comment ?? null,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

async function fetchCounterpartyRows(): Promise<Counterparty[]> {
  const snap = await getAdminDb().collection("counterparties").get();
  return snap.docs.map((doc) => mapCounterparty(doc.id, doc.data()));
}

async function fetchSupplierPriceRows(): Promise<
  { counterpartyId: string; productId: string; price: number }[]
> {
  const snap = await getAdminDb().collectionGroup("supplierPrices").get();
  return snap.docs
    .map((doc) => ({
      counterpartyId: doc.ref.parent.parent?.id || "",
      productId: String(doc.data().productId || doc.id),
      price: Math.max(0, Number(doc.data().price) || 0),
    }))
    .filter((row) => row.counterpartyId && row.productId && row.price > 0);
}

const getCachedCounterpartyRows = unstable_cache(
  fetchCounterpartyRows,
  ["warehouse-counterparties"],
  { revalidate: 60, tags: ["warehouse-counterparties"] }
);

const getCachedSupplierPriceRows = unstable_cache(
  fetchSupplierPriceRows,
  ["warehouse-supplier-prices"],
  { revalidate: 60, tags: ["warehouse-supplier-prices"] }
);

function invalidateCounterpartyCache(includeSupplierPrices = false) {
  revalidateTag("warehouse-counterparties", { expire: 0 });
  if (includeSupplierPrices) {
    revalidateTag("warehouse-supplier-prices", { expire: 0 });
  }
}

export async function getCounterparties(options?: {
  includeSupplierPrices?: boolean;
}): Promise<Counterparty[]> {
  const [baseRows, priceRows] = await Promise.all([
    getCachedCounterpartyRows(),
    options?.includeSupplierPrices
      ? getCachedSupplierPriceRows()
      : Promise.resolve([]),
  ]);
  // Кэшированный массив не мутируем: один запрос с ценами не должен менять
  // результат другого запроса без цен.
  const rows = baseRows.map((row) => ({
    ...row,
    roles: [...row.roles],
    supplierPrices: { ...(row.supplierPrices || {}) },
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const priceRow of priceRows) {
    const counterparty = byId.get(priceRow.counterpartyId);
    if (!counterparty) continue;
    counterparty.supplierPrices = {
      ...(counterparty.supplierPrices || {}),
      [priceRow.productId]: priceRow.price,
    };
  }
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
        ogrn: cleanText(data.ogrn, 20),
        fullName: cleanText(data.fullName, 200),
        shortName: cleanText(data.shortName, 200),
        legalAddress: cleanText(data.legalAddress, 400),
        taxSystem: cleanText(data.taxSystem, 40),
        bankAccount: cleanText(data.bankAccount, 40),
        bankName: cleanText(data.bankName, 200),
        bik: cleanText(data.bik, 20),
        correspondentAccount: cleanText(data.correspondentAccount, 40),
        address: cleanText(data.address, 400),
        contactName: cleanText(data.contactName, 160),
        comment: cleanText(data.comment, 1000),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  invalidateCounterpartyCache();
  return { id };
}

export async function deleteCounterparty(id: string): Promise<void> {
  await getAdminDb().collection("counterparties").doc(id).delete();
  invalidateCounterpartyCache(true);
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

export interface StockOrigin {
  id: string;
  productId: string;
  receiptId: string;
  receiptNumber: number;
  date: string;
  supplier: string;
  counterpartyId?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

function stockOriginId(receiptId: string, productId: string): string {
  return `${receiptId}_${productId}`;
}

function stockOriginData(
  receipt: Pick<
    WarehouseReceipt,
    "id" | "number" | "date" | "supplier" | "counterpartyId"
  >,
  item: StockDocItem
) {
  return {
    productId: item.productId,
    receiptId: receipt.id,
    receiptNumber: receipt.number,
    date: receipt.date,
    supplier: receipt.supplier,
    counterpartyId: receipt.counterpartyId ?? null,
    quantity: item.quantity,
    unitPrice: item.price,
    lineTotal: item.lineTotal,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function mapStockOrigin(id: string, data: any): StockOrigin {
  return {
    id,
    productId: String(data.productId || ""),
    receiptId: String(data.receiptId || ""),
    receiptNumber: Number(data.receiptNumber) || 0,
    date: String(data.date || ""),
    supplier: String(data.supplier || ""),
    counterpartyId: data.counterpartyId ?? null,
    quantity: Number(data.quantity) || 0,
    unitPrice: Number(data.unitPrice) || 0,
    lineTotal: Number(data.lineTotal) || 0,
  };
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
      stockWarnQty:
        data.stockWarnQty !== undefined && data.stockWarnQty !== null
          ? Number(data.stockWarnQty)
          : null,
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

export async function getProductStockOrigins(
  productId: string
): Promise<StockOrigin[]> {
  if (!productId) return [];
  const db = getAdminDb();
  const markerRef = db.collection("stockOriginLookups").doc(productId);
  const [originSnap, markerSnap] = await Promise.all([
    db.collection("stockOrigins").where("productId", "==", productId).get(),
    markerRef.get(),
  ]);
  if (!originSnap.empty) {
    return originSnap.docs
      .map((doc) => mapStockOrigin(doc.id, doc.data()))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.receiptNumber - a.receiptNumber
      );
  }
  if (markerSnap.exists) return [];

  // Одноразовый ленивый перенос старых проведённых поступлений. Дорогой
  // просмотр выполняется только при первом открытии истории конкретного
  // товара; дальше читается компактная индексная коллекция stockOrigins.
  const receiptSnap = await db
    .collection("warehouseReceipts")
    .orderBy("number", "desc")
    .limit(500)
    .get();
  const origins: StockOrigin[] = [];
  const batch = db.batch();
  for (const doc of receiptSnap.docs) {
    const receipt = mapReceipt(doc.id, doc.data());
    if (receipt.status !== "posted") continue;
    for (const item of receipt.items) {
      if (item.productId !== productId) continue;
      const id = stockOriginId(receipt.id, productId);
      origins.push(
        mapStockOrigin(id, stockOriginData(receipt, item))
      );
      batch.set(
        db.collection("stockOrigins").doc(id),
        stockOriginData(receipt, item),
        { merge: true }
      );
    }
  }
  batch.set(markerRef, {
    migratedAt: FieldValue.serverTimestamp(),
    originsCount: origins.length,
  });
  await batch.commit();
  return origins.sort(
    (a, b) => b.date.localeCompare(a.date) || b.receiptNumber - a.receiptNumber
  );
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
    ogrn: data.ogrn ?? null,
    fullName: data.fullName ?? null,
    shortName: data.shortName ?? null,
    legalAddress: data.legalAddress ?? null,
    taxSystem: data.taxSystem ?? null,
    bankAccount: data.bankAccount ?? null,
    bankName: data.bankName ?? null,
    bik: data.bik ?? null,
    correspondentAccount: data.correspondentAccount ?? null,
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
    linkedDealIds: Array.isArray(data.linkedDealIds) ? data.linkedDealIds : [],
    linkedDealNumbers: Array.isArray(data.linkedDealNumbers) ? data.linkedDealNumbers : [],
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

export async function getReceiptById(
  id: string
): Promise<WarehouseReceipt | null> {
  if (!id) return null;
  const snap = await getAdminDb().collection("warehouseReceipts").doc(id).get();
  return snap.exists ? mapReceipt(snap.id, snap.data()) : null;
}

export async function createReceipt(data: {
  date: string;
  supplier: string;
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
  items: StockDocItem[];
  vatRate?: number;
  linkedDealIds?: string[];
  linkedPaymentIds?: string[];
  paymentSplits?: number[]; // Array of payment amounts
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
  
  const linkedDealIds = Array.isArray(data.linkedDealIds) ? data.linkedDealIds : [];
  const linkedPaymentIds = Array.isArray(data.linkedPaymentIds) ? data.linkedPaymentIds : [];
  // Разбивка оплаты на части: оставляем только положительные суммы.
  // Если корректных частей нет (пустые/нулевые/отрицательные) — создаём
  // один платёж на весь итог, чтобы в банк не уходил «общий» мусор.
  const paymentSplits = (
    Array.isArray(data.paymentSplits) ? data.paymentSplits : []
  )
    .map((n) => round2(Number(n) || 0))
    .filter((n) => n > 0);
  if (paymentSplits.length === 0) paymentSplits.push(total);

  const linkedDealNumbers: number[] = [];
  for (const dealId of linkedDealIds) {
    const snap = await db.collection("customerDeals").doc(dealId).get();
    if (snap.exists) linkedDealNumbers.push(Number((snap.data() as any)?.number) || 0);
  }

  const number = await nextNumber("receipt");
  const date = data.date || new Date().toISOString().slice(0, 10);
  const supplier = String(data.supplier || "").slice(0, 200);
  const vatRate = data.vatRate !== undefined ? Number(data.vatRate) : VAT_RATE;
  const vatAmount = includedVat(total, vatRate);
  
  const docRef = db.collection("warehouseReceipts").doc();
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
    vatRate,
    vatAmount,
    linkedDealIds,
    linkedDealNumbers,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Create one or more payments based on splits
  for (let i = 0; i < paymentSplits.length; i++) {
    const splitAmount = Number(paymentSplits[i]) || 0;
    if (splitAmount <= 0) continue;
    
    const payNumber = await nextNumber("payment");
    const paymentRef = db.collection("bankPayments").doc();
    
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
      amount: splitAmount,
      invoiceNumber: null,
      vatRate,
      vatAmount: includedVat(splitAmount, vatRate),
      isPaid: false,
      paidAt: null,
      comment: `Оплата поставщику по приходному ордеру ПО-${number}${paymentSplits.length > 1 ? ` (часть ${i+1})` : ""}`,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const payId of linkedPaymentIds) {
    const payRef = db.collection("bankPayments").doc(payId);
    batch.update(payRef, {
      receiptIds: FieldValue.arrayUnion(docRef.id),
      receiptNumbers: FieldValue.arrayUnion(number),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  invalidateCounterpartyCache(true);
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
    vatRate?: number;
    linkedDealIds?: string[];
    linkedPaymentIds?: string[];
    paymentSplits?: number[];
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

  const vatRate = data.vatRate !== undefined ? Number(data.vatRate) : previous.vatRate;
  
  const linkedDealIds = Array.isArray(data.linkedDealIds) ? data.linkedDealIds : previous.linkedDealIds || [];
  const linkedPaymentIds = Array.isArray(data.linkedPaymentIds) ? data.linkedPaymentIds : [];
  
  const linkedDealNumbers: number[] = [];
  for (const dealId of linkedDealIds) {
    const snap = await db.collection("customerDeals").doc(dealId).get();
    if (snap.exists) linkedDealNumbers.push(Number((snap.data() as any)?.number) || 0);
  }

  const paymentSnap = await db
    .collection("bankPayments")
    .where("receiptIds", "array-contains", id)
    .get();
  const paidTotal = paymentSnap.docs.reduce((sum, doc) => {
    const payment = doc.data();
    const links = Array.isArray(payment.receiptIds)
      ? Math.max(1, payment.receiptIds.length)
      : 1;
    return payment.isPaid === true && payment.direction === "outgoing"
      ? sum + (Number(payment.amount) || 0) / links
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
      const currentProductIds = new Set(items.map((item) => item.productId));
      for (const oldItem of previous.items) {
        if (currentProductIds.has(oldItem.productId)) continue;
        transaction.delete(
          db
            .collection("stockOrigins")
            .doc(stockOriginId(id, oldItem.productId))
        );
      }
      const originReceipt = {
        id,
        number: previous.number,
        date: data.date,
        supplier,
        counterpartyId: counterpartyIdForName(supplier),
      };
      for (const item of items) {
        transaction.set(
          db.collection("stockOrigins").doc(stockOriginId(id, item.productId)),
          stockOriginData(originReceipt, item),
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
        vatRate,
        vatAmount: includedVat(total, vatRate),
        linkedDealIds,
        linkedDealNumbers,
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
      vatRate,
      vatAmount: includedVat(total, vatRate),
      linkedDealIds,
      linkedDealNumbers,
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

  // Синхронизация платежей с поступлением.
  //  • Оплаченные не трогаем (это история денег).
  //  • Неоплаченные приводим к запрошенной разбивке (paymentSplits из формы):
    //    если количество совпало — правим суммы на месте (сохраняя номера),
  //    иначе удаляем старые и создаём новые. Заодно это пересоздаёт
  //    платёж, который удалили в банке, а поступление пересохраняют.
  //  • Сумма неоплаченных частей всегда соответствует остатку долга
  //    (итог − уже оплачено), поэтому задвоений не бывает.
  const unpaidSoloDocs = paymentSnap.docs.filter((d) => {
    const p = d.data();
    if (p.isPaid === true) return false;
    const receiptLinks = Array.isArray(p.receiptIds) ? p.receiptIds.length : 0;
    const dealLinks = Array.isArray(p.dealIds) ? p.dealIds.length : 0;
    return receiptLinks === 1 && dealLinks === 0;
  });
  const remaining = Math.max(0, round2(linesTotal - paidTotal));

  const requested = (
    Array.isArray(data.paymentSplits) ? data.paymentSplits : []
  )
    .map((n) => round2(Number(n) || 0))
    .filter((n) => n > 0);

  // Целевые суммы неоплаченных платежей (в сумме дают ровно остаток долга)
  let targets: number[];
  if (remaining <= 0) {
    targets = [];
  } else if (requested.length > 0) {
    const reqSum = requested.reduce((s, n) => s + n, 0);
    const factor = reqSum > 0 ? remaining / reqSum : 1;
    targets = requested.map((n) => round2(n * factor));
    const headSum = targets.slice(0, -1).reduce((s, n) => s + n, 0);
    targets[targets.length - 1] = round2(remaining - headSum);
    targets = targets.filter((n) => n > 0);
  } else {
    targets = [remaining];
  }

  if (targets.length > 0 && unpaidSoloDocs.length === targets.length) {
    // Количество частей не изменилось — обновляем суммы, сохраняя номера
    unpaidSoloDocs.forEach((d, idx) => {
      batch.update(d.ref, {
        counterparty: supplier,
        counterpartyId,
        amount: targets[idx],
        vatRate,
        vatAmount: includedVat(targets[idx], vatRate),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } else {
    // Количество изменилось (включая «платёж удалили») — пересоздаём
    for (const d of unpaidSoloDocs) batch.delete(d.ref);
    for (let i = 0; i < targets.length; i++) {
      const amt = targets[i];
      const payNumber = await nextNumber("payment");
      const payRef = db.collection("bankPayments").doc();
      batch.set(payRef, {
        number: payNumber,
        date: data.date,
        direction: "outgoing",
        counterparty: supplier || "Поставщик",
        counterpartyId,
        dealIds: [],
        dealNumbers: [],
        receiptIds: [id],
        receiptNumbers: [previous.number],
        amount: amt,
        invoiceNumber: null,
        vatRate,
        vatAmount: includedVat(amt, vatRate),
        isPaid: false,
        paidAt: null,
        comment: `Оплата поставщику по приходному ордеру ПО-${previous.number}${
          targets.length > 1 ? ` (часть ${i + 1})` : ""
        }`,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  for (const payId of linkedPaymentIds) {
    const payRef = db.collection("bankPayments").doc(payId);
    batch.update(payRef, {
      receiptIds: FieldValue.arrayUnion(id),
      receiptNumbers: FieldValue.arrayUnion(previous.number),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  invalidateCounterpartyCache(true);
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
        const links = Array.isArray(payment.receiptIds)
          ? Math.max(1, payment.receiptIds.length)
          : 1;
        paid += (Number(payment.amount) || 0) / links;
      }
    }
    // Проверка оплаты теперь не блокирует проведение, разрешаем постоплату.

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
    for (const item of receipt.items) {
      const originRef = db
        .collection("stockOrigins")
        .doc(stockOriginId(receipt.id, item.productId));
      transaction.set(originRef, stockOriginData(receipt, item), {
        merge: true,
      });
    }
    transaction.update(receiptRef, {
      status: "posted",
      postedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function cancelReceipt(id: string): Promise<void> {
  const db = getAdminDb();
  const receiptRef = db.collection("warehouseReceipts").doc(id);

  await db.runTransaction(async (transaction) => {
    const receiptSnap = await transaction.get(receiptRef);
    if (!receiptSnap.exists) throw new Error("Поступление не найдено");
    const receipt = mapReceipt(id, receiptSnap.data());
    if (receipt.status !== "posted") return;

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
    // Удаляем записи о происхождении
    for (const item of receipt.items) {
      const originRef = db
        .collection("stockOrigins")
        .doc(stockOriginId(receipt.id, item.productId));
      transaction.delete(originRef);
    }
    transaction.update(receiptRef, {
      status: "draft",
      postedAt: null,
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
  const originSnap = await db
    .collection("stockOrigins")
    .where("receiptId", "==", id)
    .get();
  if (!originSnap.empty) {
    const originBatch = db.batch();
    originSnap.docs.forEach((doc) => originBatch.delete(doc.ref));
    await originBatch.commit();
  }
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
  items: StockDocItem[];
  linkedPaymentIds?: string[];
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
  
  const linkedPaymentIds = Array.isArray(data.linkedPaymentIds) ? data.linkedPaymentIds : [];

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

  for (const payId of linkedPaymentIds) {
    const payRef = db.collection("bankPayments").doc(payId);
    batch.update(payRef, {
      dealIds: FieldValue.arrayUnion(docRef.id),
      dealNumbers: FieldValue.arrayUnion(number),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  invalidateCounterpartyCache();
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
    linkedPaymentIds?: string[];
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
  
  const linkedPaymentIds = Array.isArray(data.linkedPaymentIds) ? data.linkedPaymentIds : [];

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
    const links = Array.isArray(payment.dealIds)
      ? Math.max(1, payment.dealIds.length)
      : 1;
    return payment.isPaid === true && payment.direction === "incoming"
      ? sum + (Number(payment.amount) || 0) / links
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

  // Аналогично поступлениям: оплаченные платежи не трогаем, а остаток долга
  // распределяем между неоплаченными (иначе при нескольких счетах каждому
  // записался бы весь итог).
  const unpaidDocs = paymentSnap.docs.filter(
    (d) => d.data().isPaid !== true
  );
  const remaining = Math.max(0, round2(linesTotal - paidTotal));
  if (unpaidDocs.length === 1) {
    batch.update(unpaidDocs[0].ref, {
      counterparty: customerName,
      counterpartyId,
      amount: remaining,
      vatRate: VAT_RATE,
      vatAmount: includedVat(remaining),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else if (unpaidDocs.length > 1) {
    const currentSum = unpaidDocs.reduce(
      (s, d) => s + (Number(d.data().amount) || 0),
      0
    );
    let allocated = 0;
    unpaidDocs.forEach((d, idx) => {
      const current = Number(d.data().amount) || 0;
      const share =
        currentSum > 0 ? current / currentSum : 1 / unpaidDocs.length;
      const amt =
        idx === unpaidDocs.length - 1
          ? round2(remaining - allocated)
          : round2(remaining * share);
      allocated = round2(allocated + amt);
      const safe = Math.max(0, amt);
      batch.update(d.ref, {
        counterparty: customerName,
        counterpartyId,
        amount: safe,
        vatRate: VAT_RATE,
        vatAmount: includedVat(safe),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  for (const payId of linkedPaymentIds) {
    const payRef = db.collection("bankPayments").doc(payId);
    batch.update(payRef, {
      dealIds: FieldValue.arrayUnion(id),
      dealNumbers: FieldValue.arrayUnion(previous.number),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  invalidateCounterpartyCache();
}

/** Отпустить заказ — списать товар со склада после оплаты */
export async function postDeal(id: string): Promise<void> {
  const db = getAdminDb();
  const dealRef = db.collection("customerDeals").doc(id);
  const paymentQuery = await db
    .collection("bankPayments")
    .where("dealIds", "array-contains", id)
    .get();
  await db.runTransaction(async (transaction) => {
    const dealSnap = await transaction.get(dealRef);
    if (!dealSnap.exists) throw new Error("Заказ не найден");
    const deal = mapDeal(id, dealSnap.data());
    if (deal.status === "completed") return;
    if (deal.status === "cancelled") throw new Error("Заказ отменён");

    let paid = 0;
    for (const paymentDoc of paymentQuery.docs) {
      const paymentSnap = await transaction.get(paymentDoc.ref);
      const payment = paymentSnap.data();
      if (payment?.isPaid === true && payment.direction === "incoming") {
        const links = Array.isArray(payment.dealIds)
          ? Math.max(1, payment.dealIds.length)
          : 1;
        paid += (Number(payment.amount) || 0) / links;
      }
    }
    // Снята блокировка проведения без оплаты по требованию пользователя.

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
    // Все чтения выполняются до записей. Повторное нажатие «Отпустить» не
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

/** Отменить заказ — вернуть товар на склад, если он был отпущен */
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
  const rawDeal = snap.data() || {};
  const deal = mapDeal(id, rawDeal);
  if (deal.status === "completed") {
    await applyStockDelta(deal.items, 1);
  }
  await ref.delete();
  await cleanupPendingDealPayments(id, db);

  // Если заказ в учёте был создан из заявки сайта, после удаления отвязываем
  // его от заявки: убираем надпись «В учёте: ЗК-…» и возвращаем заявку в обычные новые.
  const sourceOrderId = rawDeal.sourceOrderId ? String(rawDeal.sourceOrderId) : "";
  if (sourceOrderId) {
    await db.collection("orders").doc(sourceOrderId).set(
      {
        status: "new",
        dealId: null,
        dealNumber: null,
        paymentId: null,
        closeReason: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

// ─── Банк (платежи) ─────────────────────────────────────

function mapPayment(id: string, data: any): BankPayment {
  return {
    id,
    number: Number(data.number) || 0,
    date: String(data.date || ""),
    direction: data.direction === "outgoing" ? "outgoing" : "incoming",
    type: (data.type as BankPaymentType) || "regular",
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
    excludeFromBalance: data.excludeFromBalance === true,
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
  type?: BankPaymentType;
  counterparty: string;
  dealIds?: string[];
  receiptIds?: string[];
  amount: number;
  invoiceNumber?: string | null;
  isPaid?: boolean;
  excludeFromBalance?: boolean;
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
  const excludeFromBalance = data.excludeFromBalance === true;
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
    type: data.type || "regular",
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
    excludeFromBalance,
    paidAt: isPaid ? date : null,
    comment: data.comment ? String(data.comment).slice(0, 500) : null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  invalidateCounterpartyCache();
  return { id: docRef.id, number };
}

async function syncPaymentAmountToDocuments(
  payment: BankPayment,
  amount: number
): Promise<void> {
  // We no longer sync payment amount to document total because it masks overpayments/underpayments
  // and makes the counterparty balance always zero.
  // The document total should stay as the sum of its items.
  return;
}

export async function updatePayment(
  id: string,
  data: {
    isPaid?: boolean;
    excludeFromBalance?: boolean;
    type?: BankPaymentType;
    amount?: number;
    comment?: string | null;
    date?: string;
    counterparty?: string;
    invoiceNumber?: string | null;
    dealIds?: string[];
    receiptIds?: string[];
  }
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("bankPayments").doc(id);
  const existingSnap = await ref.get();
  if (!existingSnap.exists) throw new Error("Платёж не найден");
  
  const existingData = existingSnap.data();
  const existing = mapPayment(id, existingData);

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
    patch.paidAt = data.isPaid ? new Date().toISOString().slice(0, 10) : null;
  }
  if (data.excludeFromBalance !== undefined) {
    patch.excludeFromBalance = data.excludeFromBalance === true;
  }
  if (data.type !== undefined) {
    patch.type = data.type;
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

  // Updating links
  if (data.dealIds !== undefined) {
    patch.dealIds = data.dealIds;
    const dealNumbers: number[] = [];
    for (const dealId of data.dealIds) {
      const dSnap = await db.collection("customerDeals").doc(dealId).get();
      if (dSnap.exists) dealNumbers.push(Number(dSnap.data()?.number) || 0);
    }
    patch.dealNumbers = dealNumbers;
  }
  if (data.receiptIds !== undefined) {
    patch.receiptIds = data.receiptIds;
    const receiptNumbers: number[] = [];
    for (const rId of data.receiptIds) {
      const rSnap = await db.collection("warehouseReceipts").doc(rId).get();
      if (rSnap.exists) receiptNumbers.push(Number(rSnap.data()?.number) || 0);
    }
    patch.receiptNumbers = receiptNumbers;
  }

  await ref.update(patch);
  
  if (data.amount !== undefined || data.dealIds !== undefined || data.receiptIds !== undefined) {
    // If we updated links or amount, sync to documents
    const updatedPayment = mapPayment(id, { ...existingData, ...patch });
    await syncPaymentAmountToDocuments(updatedPayment, updatedPayment.amount);
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

// ─── Сотрудники ────────────────────────────────────

function mapEmployee(id: string, data: any): Employee {
  return {
    id,
    name: String(data.name || ""),
    position: data.position ?? null,
    phone: data.phone ?? null,
    comment: data.comment ?? null,
    createdAt: serializeTimestamp(data.createdAt),
  };
}

export async function getEmployees(): Promise<Employee[]> {
  const db = getAdminDb();
  const snap = await db.collection("employees").get();
  const rows = snap.docs.map((d) => mapEmployee(d.id, d.data()));
  rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return rows;
}

export async function saveEmployee(data: {
  id?: string | null;
  name: string;
  position?: string | null;
  phone?: string | null;
  comment?: string | null;
}): Promise<{ id: string }> {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("Укажите имя сотрудника");
  const db = getAdminDb();
  const ref = data.id
    ? db.collection("employees").doc(data.id)
    : db.collection("employees").doc();
  await ref.set(
    {
      name: name.slice(0, 200),
      normalizedName: normalizeCounterpartyName(name),
      position: cleanText(data.position, 160),
      phone: cleanText(data.phone, 60),
      comment: cleanText(data.comment, 500),
      updatedAt: FieldValue.serverTimestamp(),
      ...(data.id ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
  return { id: ref.id };
}

export async function deleteEmployee(id: string): Promise<void> {
  // Начисления зарплаты хранят employeeName, поэтому история не теряется
  await getAdminDb().collection("employees").doc(id).delete();
}

// ─── Зарплаты ──────────────────────────────────────

function mapSalary(id: string, data: any): Salary {
  return {
    id,
    employeeId: data.employeeId ?? null,
    employeeName: String(data.employeeName || ""),
    amount: Math.max(0, Number(data.amount) || 0),
    date: String(data.date || ""),
    source: data.source === "cash" ? "cash" : "bank",
    isPaid: data.isPaid === true,
    paidAt: data.paidAt ? String(data.paidAt) : null,
    comment: data.comment ?? null,
    createdAt: serializeTimestamp(data.createdAt),
  };
}

export async function getSalaries(): Promise<Salary[]> {
  const db = getAdminDb();
  const snap = await db
    .collection("salaries")
    .orderBy("date", "desc")
    .limit(500)
    .get();
  return snap.docs.map((d) => mapSalary(d.id, d.data()));
}

export async function createSalary(data: {
  employeeId?: string | null;
  employeeName: string;
  amount: number;
  date: string;
  source: SalarySource;
  isPaid?: boolean;
  comment?: string | null;
}): Promise<{ id: string; employeeId: string | null }> {
  const amount = Math.max(0, Number(data.amount) || 0);
  if (amount <= 0) throw new Error("Укажите сумму зарплаты");
  const employeeName = String(data.employeeName || "").trim();
  if (!employeeName) throw new Error("Укажите сотрудника");
  const db = getAdminDb();

  // Новый сотрудник (без id) — сохраняем в справочник.
  // Сначала ищем по имени, чтобы не плодить дубликаты.
  let employeeId = data.employeeId || null;
  if (!employeeId) {
    const existing = await db
      .collection("employees")
      .where("normalizedName", "==", normalizeCounterpartyName(employeeName))
      .limit(1)
      .get();
    if (!existing.empty) {
      employeeId = existing.docs[0].id;
    } else {
      const empRef = db.collection("employees").doc();
      await empRef.set({
        name: employeeName.slice(0, 200),
        normalizedName: normalizeCounterpartyName(employeeName),
        position: null,
        phone: null,
        comment: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      employeeId = empRef.id;
    }
  }

  const isPaid = data.isPaid === true;
  const date = data.date || new Date().toISOString().slice(0, 10);
  const ref = db.collection("salaries").doc();
  await ref.set({
    employeeId,
    employeeName: employeeName.slice(0, 200),
    amount,
    date,
    source: data.source === "cash" ? "cash" : "bank",
    isPaid,
    paidAt: isPaid ? date : null,
    comment: cleanText(data.comment, 500),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, employeeId };
}

export async function updateSalary(
  id: string,
  data: {
    employeeId?: string | null;
    employeeName?: string;
    amount?: number;
    date?: string;
    source?: SalarySource;
    isPaid?: boolean;
    comment?: string | null;
  }
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("salaries").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Начисление не найдено");

  const patch: Record<string, any> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (data.employeeName !== undefined)
    patch.employeeName = String(data.employeeName).trim().slice(0, 200);
  if (data.employeeId !== undefined) patch.employeeId = data.employeeId;
  if (data.amount !== undefined)
    patch.amount = Math.max(0, Number(data.amount) || 0);
  if (data.date !== undefined) patch.date = String(data.date);
  if (data.source !== undefined)
    patch.source = data.source === "cash" ? "cash" : "bank";
  if (data.isPaid !== undefined) {
    patch.isPaid = data.isPaid === true;
    patch.paidAt = data.isPaid
      ? String(data.date || snap.data()?.date || new Date().toISOString().slice(0, 10))
      : null;
  }
  if (data.comment !== undefined) patch.comment = cleanText(data.comment, 500);

  await ref.update(patch);
}

export async function deleteSalary(id: string): Promise<void> {
  await getAdminDb().collection("salaries").doc(id).delete();
}


// ─── Передача заявки с сайта в учёт ────────────────────

/**
 * Передаёт заявку (заказ с сайта) в учёт: создаёт заказ покупателя
 * (customerDeals) и входящий счёт в банке (bankPayments) на сумму заявки.
 * Идемпотентно: если заявка уже передана (order.dealId), повторно не создаёт.
 */
export async function convertOrderToDeal(orderId: string): Promise<{
  dealId: string | null;
  dealNumber: number | null;
  paymentId: string | null;
  skipped: boolean;
  reason?: string;
}> {
  const db = getAdminDb();
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new Error("Заявка не найдена");
  const order = orderSnap.data() as any;

  // Уже передана в учёт — не дублируем
  if (order.dealId) {
    return {
      dealId: order.dealId,
      dealNumber: order.dealNumber ?? null,
      paymentId: order.paymentId ?? null,
      skipped: true,
      reason: "already",
    };
  }

  const rawItems = Array.isArray(order.items) ? order.items : [];
  const items = cleanItems(
    rawItems.map((it: any) => ({
      productId: String(it.productId || ""),
      name: String(it.name || ""),
      sku: it.sku ?? null,
      quantity: Math.max(1, Number(it.quantity) || 1),
      price: Math.max(0, Number(it.price) || 0),
      lineTotal: 0,
    }))
  );
  if (items.length === 0) {
    return { dealId: null, dealNumber: null, paymentId: null, skipped: true, reason: "no-items" };
  }

  const linesSum = itemsTotal(items);
  // Сумма заявки (итог клиента). Если нет — берём сумму позиций.
  const total = Math.max(0, round2(Number(order.totalSum) || 0)) || linesSum;
  const customerName = String(
    order.companyName || order.shortName || order.customerName || order.customerPhone || "Клиент"
  ).slice(0, 200);

  const number = await nextNumber("deal");
  const paymentNumber = await nextNumber("payment");
  const date = new Date().toISOString().slice(0, 10);
  const vatAmount = includedVat(total);

  const dealRef = db.collection("customerDeals").doc();
  const paymentRef = db.collection("bankPayments").doc();
  const batch = db.batch();

  const details: CounterpartyDetails = {
    phone: order.customerPhone ? String(order.customerPhone).slice(0, 60) : null,
    email: order.customerEmail ? String(order.customerEmail).slice(0, 160) : null,
    inn: order.inn ? String(order.inn).slice(0, 20) : null,
    kpp: order.kpp ? String(order.kpp).slice(0, 20) : null,
    ogrn: order.ogrn ? String(order.ogrn).slice(0, 20) : null,
    fullName: order.companyName ? String(order.companyName).slice(0, 200) : null,
    shortName: order.shortName ? String(order.shortName).slice(0, 200) : null,
    legalAddress: order.legalAddress ? String(order.legalAddress).slice(0, 400) : null,
    address: order.actualAddress || order.legalAddress ? String(order.actualAddress || order.legalAddress).slice(0, 400) : null,
    taxSystem: order.taxSystem ? String(order.taxSystem).slice(0, 40) : null,
    bankAccount: order.bankAccount ? String(order.bankAccount).slice(0, 40) : null,
    bankName: order.bankName ? String(order.bankName).slice(0, 200) : null,
    bik: order.bik ? String(order.bik).slice(0, 20) : null,
    correspondentAccount: order.correspondentAccount ? String(order.correspondentAccount).slice(0, 40) : null,
    contactName: order.customerName ? String(order.customerName).slice(0, 160) : null,
  };
  const counterpartyId = addCounterpartyToBatch(batch, "customer", customerName, {
    ...details,
    comment: order.comment ? String(order.comment).slice(0, 500) : null,
  });

  const orderComment = order.comment
    ? `Из заявки с сайта. ${String(order.comment).slice(0, 400)}`
    : "Из заявки с сайта";

  batch.set(dealRef, {
    number,
    date,
    customerName,
    counterpartyId,
    customerPhone: details.phone,
    ...details,
    comment: orderComment,
    items,
    total,
    bankAdjustment: round2(total - linesSum),
    vatRate: VAT_RATE,
    vatAmount,
    status: "new",
    sourceOrderId: orderId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Входящий счёт в банке на сумму заявки, привязан к созданному заказу
  batch.set(paymentRef, {
    number: paymentNumber,
    date,
    direction: "incoming",
    type: "regular",
    counterparty: customerName,
    counterpartyId,
    dealIds: [dealRef.id],
    dealNumbers: [number],
    receiptIds: [],
    receiptNumbers: [],
    amount: total,
    invoiceNumber: null,
    vatRate: VAT_RATE,
    vatAmount,
    isPaid: false,
    paidAt: null,
    excludeFromBalance: false,
    comment: `Счёт покупателю по заказу ЗК-${number} (из заявки с сайта)`,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Связываем заявку с созданными заказом и платежом
  batch.update(orderRef, {
    dealId: dealRef.id,
    dealNumber: number,
    paymentId: paymentRef.id,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  invalidateCounterpartyCache();
  return { dealId: dealRef.id, dealNumber: number, paymentId: paymentRef.id, skipped: false };
}

// ─── Правки заказа клиентом из личного кабинета ─────────────

async function buildOrderItemsFromProducts(
  rawItems: { productId?: string; quantity?: number }[]
): Promise<StockDocItem[]> {
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
    const snap = await db.collection("products").doc(productId).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    if (data.isVisible === false) continue;
    const price = getProductEffectivePrice({
      price: data.price !== undefined && data.price !== null ? Number(data.price) : null,
      discountType: data.discountType ?? null,
      discountValue: data.discountValue ?? null,
    });
    const safePrice = Math.max(0, Number(price) || 0);
    result.push({
      productId,
      name: String(data.name || "Товар").slice(0, 200),
      sku: data.sku ? String(data.sku).slice(0, 80) : "—",
      quantity,
      price: safePrice,
      lineTotal: round2(quantity * safePrice),
    });
  }
  return result;
}

async function paidTotalForDeal(db: FirebaseFirestore.Firestore, dealId: string) {
  const paymentSnap = await db
    .collection("bankPayments")
    .where("dealIds", "array-contains", dealId)
    .get();
  let paidTotal = 0;
  const unpaidDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const doc of paymentSnap.docs) {
    const payment = doc.data();
    const links = Array.isArray(payment.dealIds) ? Math.max(1, payment.dealIds.length) : 1;
    if (payment.isPaid === true && payment.direction === "incoming") {
      paidTotal += (Number(payment.amount) || 0) / links;
    } else if (payment.direction === "incoming") {
      unpaidDocs.push(doc);
    }
  }
  return { paidTotal: round2(paidTotal), unpaidDocs };
}

/**
 * Клиент может менять заказ на любом этапе. Заказ и связанный ЗК снова
 * возвращаются в обработку. Если уже была оплата — создаётся/обновляется
 * счёт на доплату только на недостающую сумму.
 */
export async function reviseWebsiteOrderByCustomer(
  orderId: string,
  data: { items: { productId?: string; quantity?: number }[]; comment?: string | null }
): Promise<{ totalSum: number; paidTotal: number; additionalDue: number }> {
  const db = getAdminDb();
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new Error("Заказ не найден");
  const order = orderSnap.data() as any;
  if (order.type !== "order") throw new Error("Можно менять только заказ из корзины");

  const items = await buildOrderItemsFromProducts(data.items);
  if (items.length === 0) throw new Error("В заказе должен быть хотя бы один товар");
  const total = itemsTotal(items);
  const now = FieldValue.serverTimestamp();
  const comment = cleanText(data.comment, 2000);

  let paidTotal = 0;
  let additionalDue = total;

  const dealId = order.dealId ? String(order.dealId) : "";
  if (dealId) {
    const dealRef = db.collection("customerDeals").doc(dealId);
    const dealSnap = await dealRef.get();
    if (dealSnap.exists) {
      const deal = mapDeal(dealId, dealSnap.data());
      if (deal.status === "completed") {
        // Заказ был готов/отпущен — возвращаем старый состав на склад.
        await applyStockDelta(deal.items, 1);
      }
      const payInfo = await paidTotalForDeal(db, dealId);
      paidTotal = payInfo.paidTotal;
      additionalDue = Math.max(0, round2(total - paidTotal));

      const batch = db.batch();
      batch.update(dealRef, {
        items,
        total,
        bankAdjustment: 0,
        vatRate: VAT_RATE,
        vatAmount: includedVat(total),
        status: "new",
        comment: [deal.comment, "Клиент изменил заказ из личного кабинета"].filter(Boolean).join(". ").slice(0, 500),
        updatedAt: now,
      });

      if (payInfo.unpaidDocs.length > 0) {
        payInfo.unpaidDocs.forEach((doc, idx) => {
          const amount = idx === 0 ? additionalDue : 0;
          batch.update(doc.ref, {
            amount,
            vatRate: VAT_RATE,
            vatAmount: includedVat(amount),
            comment: additionalDue > 0
              ? `Доплата по изменённому заказу ЗК-${deal.number}`
              : `Доплата не требуется по изменённому заказу ЗК-${deal.number}`,
            updatedAt: now,
          });
        });
      } else if (additionalDue > 0) {
        const paymentNumber = await nextNumber("payment");
        const paymentRef = db.collection("bankPayments").doc();
        batch.set(paymentRef, {
          number: paymentNumber,
          date: new Date().toISOString().slice(0, 10),
          direction: "incoming",
          type: "regular",
          counterparty: deal.customerName || order.customerName || "Клиент",
          counterpartyId: deal.counterpartyId ?? null,
          dealIds: [dealId],
          dealNumbers: [deal.number],
          receiptIds: [],
          receiptNumbers: [],
          amount: additionalDue,
          invoiceNumber: null,
          vatRate: VAT_RATE,
          vatAmount: includedVat(additionalDue),
          isPaid: false,
          paidAt: null,
          excludeFromBalance: false,
          comment: `Доплата по изменённому заказу ЗК-${deal.number}`,
          createdAt: now,
          updatedAt: now,
        });
      }
      await batch.commit();
    }
  }

  if (!dealId) {
    additionalDue = total;
  }

  await orderRef.update({
    items: items.map(({ productId, name, sku, quantity, price }) => ({
      productId,
      name,
      sku: sku ?? "—",
      quantity,
      price,
    })),
    totalSum: total,
    status: "new",
    closeReason: null,
    comment: comment || order.comment || null,
    customerEditedAt: now,
    updatedAt: now,
  });

  return { totalSum: total, paidTotal, additionalDue };
}

/** Клиентская отмена заказа на любом этапе. */
export async function cancelWebsiteOrderByCustomer(orderId: string): Promise<void> {
  const db = getAdminDb();
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new Error("Заказ не найден");
  const order = orderSnap.data() as any;
  if (order.dealId) {
    await cancelDeal(String(order.dealId), "Клиент отменил заказ из личного кабинета");
  }
  await orderRef.update({
    status: "rejected",
    closeReason: "Клиент отменил заказ из личного кабинета",
    customerCancelledAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
