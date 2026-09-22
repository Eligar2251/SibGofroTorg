// src/app/[adminPath]/deliveries/page.tsx
import { notFound } from "next/navigation";
import {
  getDealDeliveries,
  getEmployees,
  getReceipts,
  getTransports,
  getWarehouseStock,
} from "@/lib/warehouse";
import {
  buildReceiptTransportQueue,
  receiptTakenIdsFromTransports,
} from "@/lib/warehouse-shared";
import { getWpIntakes, getWpProducts, getWpShipments } from "@/lib/wastepaper-account";
import {
  buildWpTypeLabels,
  buildWpTransportQueue,
  wpTakenKeysFromTransports,
} from "@/lib/wastepaper-account-shared";
import { getSettings } from "@/lib/supabase-queries";
import { TransportManager, type TransportDeal } from "@/components/admin/TransportManager";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import { DeliveriesRealtime } from "@/components/admin/DeliveriesRealtime";
import { SITE_ADDRESS, SITE_PHONE } from "@/lib/site-config";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export default async function AdminDeliveriesPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  let loadError: string | null = null;
  let transports: Awaited<ReturnType<typeof getTransports>> = [];
  let dealOrders: Awaited<ReturnType<typeof getDealDeliveries>> = [];
  let employees: Awaited<ReturnType<typeof getEmployees>> = [];
  let products: PickerProduct[] = [];
  let wpIntakes: Awaited<ReturnType<typeof getWpIntakes>> = [];
  let wpShipments: Awaited<ReturnType<typeof getWpShipments>> = [];
  let wpProducts: Awaited<ReturnType<typeof getWpProducts>> = [];
  let receipts: Awaited<ReturnType<typeof getReceipts>> = [];

  try {
    const [trs, deals, emps, stock, wpi, wps, wpp, rcs] = await Promise.all([
      getTransports({ limit: 200 }),
      getDealDeliveries({ filter: "all", limit: 500 }),
      getEmployees().catch(() => []),
      getWarehouseStock().catch(() => []),
      // Очередь макулатуры для тех же рейсов (пусто, если модуль не настроен).
      getWpIntakes(500).catch(() => []),
      getWpShipments(300).catch(() => []),
      getWpProducts().catch(() => []),
      // Поставки с пометкой «Заберём сами» — привозим на свой склад.
      getReceipts().catch(() => []),
    ]);
    transports = trs;
    dealOrders = deals;
    employees = emps;
    wpIntakes = wpi;
    wpShipments = wps;
    wpProducts = wpp;
    receipts = rcs;
    products = stock.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: p.price,
      priceWholesale: p.priceWholesale,
      stockQty: p.stockQty,
    }));
  } catch (e) {
    console.error("deliveries page:", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/column|does not exist|schema cache|transports/i.test(msg)) {
      loadError = "Таблица transports ещё не создана. Выполните supabase/migration_transports.sql";
    } else {
      loadError = "Не удалось загрузить данные. Попробуйте обновить страницу.";
    }
  }

  const settings = await getSettings().catch(() => ({} as Record<string, string>));
  const companyPhone = settings.phone || SITE_PHONE;
  const companyAddress = settings.address || SITE_ADDRESS;

  if (loadError) {
    return (
      <div>
        <div className="admin-page-head">
          <div>
            <h1 className="admin-h1">Перевозки</h1>
            <p className="admin-sub">Формирование, печать бланков, отгрузка и архив</p>
          </div>
        </div>
        <div className="admin-card" style={{ padding: 24 }}>
          <p style={{ color: "var(--adm-kraft)", fontWeight: 600, margin: 0 }}>{loadError}</p>
        </div>
      </div>
    );
  }

  const drivers = employees.map((e) => ({
    id: e.id,
    name: e.name,
    phone: e.phone ?? null,
  }));

  // Определяем заказы, которые уже включены в активные перевозки
  const activeTransportDealIds = new Set(
    transports
      .filter((t) => t.status === "draft" || t.status === "active")
      .flatMap((t) => t.items.map((it) => it.dealId))
  );

  // Заказы с доставкой, которые ещё не в перевозке
  const pendingDeals: TransportDeal[] = dealOrders
    .filter((d) => !activeTransportDealIds.has(d.id))
    .map((d) => ({
      id: d.id,
      number: d.number,
      customerName: d.customerName || "Без имени",
      customerPhone: d.customerPhone ?? d.phone ?? null,
      deliveryAddress: d.deliveryAddress ?? d.address ?? null,
      deliveryType: d.deliveryType ?? null,
      deliveryCost: d.deliveryCost ?? null,
      items: (d.items || []).map((it: any) => ({
        productId: it.productId,
        name: it.name,
        quantity: it.quantity,
      })),
      totalSum: d.total ?? null,
      shippedItems: Array.isArray(d.shippedItems) ? d.shippedItems : [],
      deliveryItems: Array.isArray(d.deliveryItems) ? d.deliveryItems : [],
    }));

  // Приёмы/сдачи с пометкой «в перевозку», ещё не взятые в активный рейс.
  // Подписи видов: справочник видов + базовые (картон, бумага…).
  const wpTypeLabels = buildWpTypeLabels(wpProducts);
  const pendingWpDocs = buildWpTransportQueue({
    intakes: wpIntakes,
    shipments: wpShipments,
    takenKeys: wpTakenKeysFromTransports(transports),
    typeLabels: wpTypeLabels,
  });

  // Поставки «Заберём сами», ещё не взятые в активный рейс: забор груза
  // у поставщика, груз — остаток по приёмке (заказано − уже принято).
  const pendingReceipts = buildReceiptTransportQueue({
    receipts,
    takenIds: receiptTakenIdsFromTransports(transports),
  });

  return (
    <div>
      <DeliveriesRealtime />
      <TransportManager
        transports={transports}
        pendingDeals={pendingDeals}
        pendingWpDocs={pendingWpDocs}
        pendingReceipts={pendingReceipts}
        drivers={drivers}
        companyPhone={companyPhone}
        companyAddress={companyAddress}
        products={products}
      />
    </div>
  );
}
