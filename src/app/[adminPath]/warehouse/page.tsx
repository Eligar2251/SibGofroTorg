// =========================================================
// FILE: src/app/[adminPath]/warehouse/page.tsx
// Учёт: Склад (остатки + поступления), Заказы, Банк
// =========================================================

import { notFound } from "next/navigation";
import {
  getWarehouseStock,
  getReceipts,
  getReceiptById,
  getDeals,
  getPayments,
  getCounterparties,
} from "@/lib/warehouse";
import { WarehouseManager } from "@/components/admin/WarehouseManager";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import type {
  CounterpartyDocument,
  CounterpartyOption,
} from "@/components/admin/WarehouseCounterparties";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function AdminWarehousePage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{
    tab?: string;
    sub?: string;
    product?: string;
    receipt?: string;
  }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const sp = await searchParams;
  const initialTab: any = sp.tab || "stock";
  const initialSub: any = sp.sub || "stock";

  const [
    stock,
    loadedReceipts,
    deals,
    payments,
    counterpartyRows,
    focusedReceipt,
  ] = await Promise.all([
    getWarehouseStock(),
    getReceipts(),
    getDeals(),
    getPayments(),
    getCounterparties({ includeSupplierPrices: true }),
    sp.receipt ? getReceiptById(sp.receipt) : Promise.resolve(null),
  ]);

  const receipts =
    focusedReceipt &&
    !loadedReceipts.some((receipt) => receipt.id === focusedReceipt.id)
      ? [focusedReceipt, ...loadedReceipts]
      : loadedReceipts;

  const pickerProducts: PickerProduct[] = stock.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    priceWholesale: p.priceWholesale,
    stockQty: p.stockQty,
  }));

  const counterpartyOptions: CounterpartyOption[] = counterpartyRows.map(
    (item) => ({
      id: item.id,
      name: item.name,
      roles: item.roles,
      supplierPrices: item.supplierPrices ?? {},
      phone: item.phone ?? null,
      email: item.email ?? null,
      inn: item.inn ?? null,
      kpp: item.kpp ?? null,
      address: item.address ?? null,
      contactName: item.contactName ?? null,
      comment: item.comment ?? null,
    })
  );

  const counterpartyDocuments: Record<string, CounterpartyDocument[]> = {};
  const normalizeName = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase("ru-RU")
      .replace(/[«»"']/g, "")
      .replace(/\s+/g, " ");

  const dealStatusLabel: Record<string, string> = {
    new: "Новый",
    completed: "Отпущен",
    cancelled: "Отменён",
  };

  for (const item of counterpartyRows) {
    counterpartyDocuments[item.id] = [
      ...deals
        .filter(
          (deal) =>
            deal.counterpartyId === item.id ||
            normalizeName(deal.customerName) === item.normalizedName
        )
        .map((deal) => ({
          id: deal.id,
          kind: "deal" as const,
          number: deal.number,
          date: deal.date,
          total: deal.total,
          status: dealStatusLabel[deal.status] || deal.status,
          itemCount: deal.items.length,
        })),
      ...receipts
        .filter(
          (receipt) =>
            receipt.counterpartyId === item.id ||
            normalizeName(receipt.supplier) === item.normalizedName
        )
        .map((receipt) => ({
          id: receipt.id,
          kind: "receipt" as const,
          number: receipt.number,
          date: receipt.date,
          total: receipt.total,
          status: null,
          itemCount: receipt.items.length,
        })),
    ].sort((a, b) => b.date.localeCompare(a.date));
  }

  return (
    <WarehouseManager
      adminPath={ADMIN_PATH}
      initialTab={initialTab}
      initialSub={initialSub}
      stock={stock}
      receipts={receipts}
      deals={deals}
      payments={payments}
      counterpartyRows={counterpartyRows}
      pickerProducts={pickerProducts}
      counterpartyOptions={counterpartyOptions}
      counterpartyDocuments={counterpartyDocuments}
    />
  );
}
