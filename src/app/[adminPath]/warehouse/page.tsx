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
  getTransports,
  getCashCollections,
} from "@/lib/warehouse";
import { WarehouseManager } from "@/components/admin/WarehouseManager";
import { WarehouseRealtime } from "@/components/admin/WarehouseRealtime";
import { getAdminDb } from "@/lib/supabase";
import { getSettings } from "@/lib/supabase-queries";
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
  const [usersRes, ordersRes] = await Promise.all([
    db.from("users").select("*").order("created_at", { ascending: false }).limit(200),
    db.from("orders").select("*").order("created_at", { ascending: false }).limit(500),
  ]);
  const orders = (ordersRes.data || []).map((d: any) => ({
    id: d.id,
    userId: d.user_id ?? null,
    customerPhoneDigits: d.customer_phone_digits ?? null,
    customerName: d.customer_name ?? null,
    customerPhone: d.customer_phone ?? null,
    type: d.type ?? "inquiry",
    status: d.status ?? "new",
    totalSum: d.total_sum ?? null,
    productInfo: d.product_info ?? null,
    items: d.items ?? null,
    createdAt: toIso(d.created_at),
  }));
  return (usersRes.data || []).map((d: any) => {
    const uid = d.id;
    const userOrders = orders.filter(
      (o: any) => o.userId === uid || (d.phone_digits && o.customerPhoneDigits === d.phone_digits)
    );
    return {
      id: uid,
      name: d.name ?? null,
      phone: d.phone ?? null,
      email: d.email ?? null,
      customerType: d.customer_type ?? "individual",
      companyName: d.company_name ?? null,
      inn: d.inn ?? null,
      createdAt: toIso(d.created_at),
      ordersCount: userOrders.length,
      completedCount: userOrders.filter((o: any) => o.status === "completed").length,
      totalSpent: userOrders.filter((o: any) => o.status === "completed").reduce((s: number, o: any) => s + (o.totalSum || 0), 0),
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
  const needStock = ["stock", "deals", "supplies", "receipts"].includes(initialTab) || !!sp.product;
  const needReceipts = ["supplies", "receipts", "bank", "counterparties"].includes(initialTab) || !!sp.receipt;
  const needDeals = ["deals", "bank", "counterparties", "supplies", "deliveries"].includes(initialTab) || !!sp.deal;
  const needPayments = ["bank", "deals", "supplies"].includes(initialTab) || !!sp.payment;
  const needEmployees = initialTab === "salaries" || initialTab === "deliveries";
  const needSalaries = initialTab === "salaries" || initialTab === "bank";
  const needCounterparties = ["counterparties", "supplies", "deals", "receipts", "bank"].includes(initialTab);
  const needClients = initialTab === "counterparties";
  const needTransports = initialTab === "deliveries";
  const needCashCollections = initialTab === "bank";

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
    transportsData,
    cashCollections,
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
    needTransports ? getTransports({ limit: 200 }) : Promise.resolve([]),
    needCashCollections ? getCashCollections() : Promise.resolve([]),
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

  // Подготовка данных для перевозок
  const activeTransportDealIds = new Set(
    (transportsData || [])
      .filter((t: any) => t.status === "draft" || t.status === "active")
      .flatMap((t: any) => (t.items || []).map((it: any) => it.dealId))
  );

  const pendingDeals = deals
    .filter((d) => d.hasDelivery && !activeTransportDealIds.has(d.id))
    .map((d) => ({
      id: d.id,
      number: d.number,
      customerName: d.customerName || "Без имени",
      contactName: d.contactName ?? null,
      customerPhone: d.customerPhone ?? d.phone ?? null,
      deliveryAddress: d.deliveryAddress ?? d.address ?? null,
      deliveryNote: d.deliveryNote ?? null,
      deliveryType: d.deliveryType ?? null,
      deliveryCost: d.deliveryCost ?? null,
      items: (d.items || []).map((it: any) => ({ productId: it.productId, name: it.name, quantity: it.quantity })),
      totalSum: d.total ?? null,
      shippedItems: Array.isArray(d.shippedItems) ? d.shippedItems : [],
      deliveryItems: Array.isArray(d.deliveryItems) ? d.deliveryItems : [],
    }));

  const drivers = employees.map((e) => ({ id: e.id, name: e.name, phone: e.phone ?? null }));

  const settings = await getSettings().catch(() => ({} as Record<string, string>));
  const deliveryPriceRaw = Number(settings.delivery_price);
  const freeThresholdRaw = Number(settings.free_delivery_threshold);
  const deliveryPrice =
    Number.isFinite(deliveryPriceRaw) && deliveryPriceRaw >= 0
      ? deliveryPriceRaw
      : 800;
  const freeDeliveryThreshold =
    Number.isFinite(freeThresholdRaw) && freeThresholdRaw >= 0
      ? freeThresholdRaw
      : 30000;

  return (
    <div>
      <WarehouseRealtime />
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
      deliveryPrice={deliveryPrice}
      freeDeliveryThreshold={freeDeliveryThreshold}
      transports={transportsData}
      pendingDeals={pendingDeals}
      drivers={drivers}
      cashCollections={cashCollections}
      companyPhone={settings.phone || undefined}
      companyAddress={settings.address || undefined}
    />
    </div>
  );
}
