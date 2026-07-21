// src/lib/warehouse-shared.ts
// Shared types and pure logic functions for warehouse/bank.
// Safe for both Client and Server components.

import { includedVat, VAT_RATE, VAT_RATES } from "./vat";
export { includedVat, VAT_RATE, VAT_RATES } from "./vat";

export interface StockDocItem {
  productId: string;
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
}

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

export interface CounterpartyBalance {
  name: string;
  type: "customer" | "supplier";
  docsTotal: number;
  paidTotal: number;
  balance: number;
  lastPaymentDate: string | null;
  docsCount: number;
}

function normalizeName(name: string): string {
  return (name || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[«»"']/g, "")
    .replace(/\s+/g, " ");
}

/** Сводка по банку */
export function getBankSummary(payments: BankPayment[]) {
  let bankBalance = 0;
  let cashBalance = 0;
  let expectedIn = 0;
  let expectedOut = 0;
  for (const p of payments) {
    if (p.isPaid) {
      if (p.excludeFromBalance) continue;
      const amt = p.direction === "incoming" ? p.amount : -p.amount;
      if (p.type === "cash") cashBalance += amt;
      else bankBalance += amt;
    } else {
      if (p.direction === "incoming") expectedIn += p.amount;
      else expectedOut += p.amount;
    }
  }
  return {
    balance: bankBalance + cashBalance,
    bankBalance,
    cashBalance,
    expectedIn,
    expectedOut,
  };
}

/** Оплачено по каждому заказу (id → сумма оплаченных входящих платежей) */
export function getDealPaidMap(payments: BankPayment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    if (!p.isPaid || p.direction !== "incoming") continue;
    // We only map payments that are explicitly linked to a deal
    if (!p.dealIds || p.dealIds.length === 0) continue;
    
    const share = p.amount / p.dealIds.length;
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
    // We only map payments that are explicitly linked to a receipt
    if (!p.receiptIds || p.receiptIds.length === 0) continue;
    
    const share = p.amount / p.receiptIds.length;
    for (const receiptId of p.receiptIds) {
      map.set(receiptId, (map.get(receiptId) || 0) + share);
    }
  }
  return map;
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

  // 1. Process documents
  for (const d of deals) {
    if (d.status === "cancelled") continue;
    const row = getRow(d.customerName, "customer");
    if (row) {
      row.docsTotal += d.total;
      row.docsCount += 1;
    }
  }
  for (const r of receipts) {
    if (!r.supplier) continue;
    const row = getRow(r.supplier, "supplier");
    if (row) {
      row.docsTotal += r.total;
      row.docsCount += 1;
    }
  }

  // 2. Process payments
  for (const p of payments) {
    if (!p.isPaid || p.excludeFromBalance) continue;
    const payDate = p.paidAt || p.date;
    const normName = normalizeName(p.counterparty);
    if (!normName) continue;

    // Determine target role
    let type: "customer" | "supplier";
    if (p.dealIds && p.dealIds.length > 0) {
      type = "customer";
    } else if (p.receiptIds && p.receiptIds.length > 0) {
      type = "supplier";
    } else {
      // Automatic detection by existing roles or direction
      if (result.has(`supplier:${normName}`)) {
        type = "supplier";
      } else if (result.has(`customer:${normName}`)) {
        type = "customer";
      } else {
        type = p.direction === "incoming" ? "customer" : "supplier";
      }
    }

    const row = getRow(p.counterparty, type);
    if (!row) continue;

    if (type === "customer") {
      row.paidTotal += (p.direction === "incoming" ? p.amount : -p.amount);
    } else {
      row.paidTotal += (p.direction === "outgoing" ? p.amount : -p.amount);
    }

    if (!row.lastPaymentDate || payDate > row.lastPaymentDate) {
      row.lastPaymentDate = payDate;
    }
  }

  const list = [...result.values()].map((row) => ({
    ...row,
    docsTotal: Math.round(row.docsTotal * 100) / 100,
    paidTotal: Math.round(row.paidTotal * 100) / 100,
    balance: Math.round((row.docsTotal - row.paidTotal) * 100) / 100,
  }));

  // Sort: Debtors first (balance > 0), then by name
  list.sort((a, b) => {
    const aOpen = a.balance > 0.009 ? 1 : 0;
    const bOpen = b.balance > 0.009 ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    return a.name.localeCompare(b.name, "ru");
  });
  
  return list;
}
