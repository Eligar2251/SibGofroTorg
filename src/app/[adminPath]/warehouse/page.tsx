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
  getEmployees,
  getSalaries,
  getCounterparties,
} from "@/lib/warehouse";
import { WarehouseManager } from "@/components/admin/WarehouseManager";
import { getAdminDb } from "@/lib/supabase";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import type {
  CounterpartyDocument,
  CounterpartyOption,
} from "@/components/admin/WarehouseCounterparties";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw?.toDate === "function") return raw.toDate().toISOString();
  if (raw._seconds != null) return new Date(raw._seconds * 1000).toISOString();
  if (raw.seconds != null) return new Date(raw.seconds * 1000).toISOString();
  if (typeof raw === "string") return raw;
  return null;
}

async function getClientsForWarehouse() {
  const db = getAdminDb();
  const [usersSnap, ordersSnap] = await Promise.all([
    db.collection("users").orderBy("createdAt", "desc").limit(200).get(),
    db.collection("orders").orderBy("createdAt", "desc").limit(500).get(),
  ]);
  const orders = ordersSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      userId: data.userId ?? null,
      customerPhoneDigits: data.customerPhoneDigits ?? null,
      customerName: data.customerName ?? null,
      customerPhone: data.customerPhone ?? null,
      type: data.type ?? "inquiry",
      status: data.status ?? "new",
      totalSum: data.totalSum ?? null,
      productInfo: data.productInfo ?? null,
      items: data.items ?? null,
      createdAt: toIso(data.createdAt),
    };
  });
  return usersSnap.docs.map((d) => {
    const data = d.data();
    const uid = d.id;
    const userOrders = orders.filter(
      (o) => o.userId === uid || (data.phoneDigits && o.customerPhoneDigits === data.phoneDigits)
    );
    return {
      id: uid,
      name: data.name ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      customerType: data.customerType ?? "individual",
      companyName: data.companyName ?? null,
      inn: data.inn ?? null,
      createdAt: toIso(data.createdAt),
      ordersCount: userOrders.length,
      completedCount: userOrders.filter((o) => o.status === "completed").length,
      totalSpent: userOrders.filter((o) => o.status === "completed").reduce((s, o) => s + (o.totalSum || 0), 0),
      lastOrderAt: userOrders[0]?.createdAt ?? null,
      orders: userOrders,
    };
  });
}

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
    deal?: string;
    payment?: string;
  }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const sp = await searchParams;
  const initialTab: any = sp.tab || "stock";
  const initialSub: any = sp.sub || "stock";

  // Экономия квоты Firestore: вкладки учёта грузятся лениво по URL.
  // Раньше при открытии «Склад» читались сразу поставки, заказы, банк,
  // зарплаты, клиенты и контрагенты. Теперь каждая верхняя вкладка тянет
  // только необходимые ей коллекции.
  const needStock = ["stock", "receipts", "deals", "suppliers"].includes(initialTab) || !!sp.product;
  const needReceipts = ["receipts", "bank", "counterparties"].includes(initialTab) || !!sp.receipt;
  const needDeals = ["deals", "bank", "counterparties", "receipts"].includes(initialTab) || !!sp.deal;
  const needPayments = ["bank", "deals", "receipts"].includes(initialTab) || !!sp.payment;
  const needEmployees = initialTab === "salaries";
  const needSalaries = initialTab === "salaries" || initialTab === "bank";
  const needCounterparties = ["counterparties", "suppliers", "deals", "receipts", "bank"].includes(initialTab);
  const needClients = initialTab === "clients";

  const [
    stock,
    loadedReceipts,
    deals,
    payments,
    employees,
    salaries,
    counterpartyRows,
    focusedReceipt,
    clients,
  ] = await Promise.all([
    needStock ? getWarehouseStock() : Promise.resolve([]),
    needReceipts ? getReceipts() : Promise.resolve([]),
    needDeals ? getDeals() : Promise.resolve([]),
    needPayments ? getPayments() : Promise.resolve([]),
    needEmployees ? getEmployees() : Promise.resolve([]),
    needSalaries ? getSalaries() : Promise.resolve([]),
    needCounterparties ? getCounterparties({ includeSupplierPrices: initialTab === "suppliers" || initialTab === "receipts" || initialTab === "deals" || initialTab === "bank" }) : Promise.resolve([]),
    sp.receipt ? getReceiptById(sp.receipt) : Promise.resolve(null),
    needClients ? getClientsForWarehouse() : Promise.resolve([]),
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
      ogrn: item.ogrn ?? null,
      fullName: item.fullName ?? null,
      shortName: item.shortName ?? null,
      legalAddress: item.legalAddress ?? null,
      taxSystem: item.taxSystem ?? null,
      bankAccount: item.bankAccount ?? null,
      bankName: item.bankName ?? null,
      bik: item.bik ?? null,
      correspondentAccount: item.correspondentAccount ?? null,
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
      focusDealId={sp.deal || null}
      focusReceiptId={sp.receipt || null}
      focusProductId={sp.product || null}
      focusPaymentId={sp.payment || null}
      stock={stock}
      receipts={receipts}
      deals={deals}
      payments={payments}
      employees={employees}
      salaries={salaries}
      counterpartyRows={counterpartyRows}
      pickerProducts={pickerProducts}
      counterpartyOptions={counterpartyOptions}
      counterpartyDocuments={counterpartyDocuments}
      clients={clients}
    />
  );
}
