// src/app/[adminPath]/deliveries/page.tsx
import { notFound } from "next/navigation";
import { getDeliveryOrders } from "@/lib/supabase-queries";
import { getDealDeliveries } from "@/lib/warehouse";
import {
  DeliveriesManager,
  type DeliveryRow,
} from "@/components/admin/DeliveriesManager";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export default async function AdminDeliveriesPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  let siteOrders: Awaited<ReturnType<typeof getDeliveryOrders>> = [];
  let dealOrders: Awaited<ReturnType<typeof getDealDeliveries>> = [];
  let loadError: string | null = null;

  try {
    const [site, deals] = await Promise.all([
      getDeliveryOrders({ filter: "all", limit: 500 }).catch((e) => {
        console.error("site deliveries:", e);
        throw e;
      }),
      getDealDeliveries({ filter: "all", limit: 500 }).catch((e) => {
        // Если колонок доставки у deals ещё нет — не валим всю страницу
        const msg = e instanceof Error ? e.message : String(e);
        if (/column|does not exist|schema cache/i.test(msg)) {
          console.warn("deal deliveries columns missing:", msg);
          return [] as Awaited<ReturnType<typeof getDealDeliveries>>;
        }
        throw e;
      }),
    ]);
    siteOrders = site;
    dealOrders = deals;
  } catch (e) {
    console.error("deliveries page:", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/column|does not exist|schema cache/i.test(msg)) {
      loadError =
        "Поля доставки ещё не добавлены в базу. Выполните supabase/migration_deliveries.sql и supabase/migration_deal_delivery_vat.sql в SQL Editor Supabase.";
    } else {
      loadError = "Не удалось загрузить доставки. Попробуйте обновить страницу.";
    }
  }

  if (loadError) {
    return (
      <div>
        <div className="admin-page-head">
          <div>
            <h1 className="admin-h1">Доставки</h1>
            <p className="admin-sub">Планирование и неотпущенные заказы</p>
          </div>
        </div>
        <div className="admin-card" style={{ padding: 24 }}>
          <p style={{ color: "#b45309", fontWeight: 600, margin: 0 }}>{loadError}</p>
        </div>
      </div>
    );
  }

  const rows: DeliveryRow[] = [
    ...siteOrders.map((o) => ({
      id: o.id,
      source: "site" as const,
      label: `#${o.id.slice(0, 8)}`,
      customerName: o.customerName || "Без имени",
      customerPhone: o.customerPhone ?? null,
      deliveryType: o.deliveryType ?? null,
      deliveryCost: o.deliveryCost ?? null,
      deliveryAddress: o.deliveryAddress ?? null,
      deliveryPlannedDate: o.deliveryPlannedDate ?? null,
      deliveryReleasedAt: o.deliveryReleasedAt ?? null,
      deliveryNote: o.deliveryNote ?? null,
      items: o.items
        ? o.items.map((it) => ({ name: it.name, quantity: it.quantity }))
        : null,
      totalSum: o.totalSum ?? null,
      createdAt: o.createdAt ?? null,
      dealNumber: null,
    })),
    ...dealOrders.map((d) => ({
      id: d.id,
      source: "deal" as const,
      label: `ЗК-${d.number}`,
      customerName: d.customerName || "Без имени",
      customerPhone: d.customerPhone ?? d.phone ?? null,
      deliveryType: d.deliveryType ?? null,
      deliveryCost: d.deliveryCost ?? null,
      deliveryAddress: d.deliveryAddress ?? d.address ?? null,
      deliveryPlannedDate: d.deliveryPlannedDate ?? null,
      deliveryReleasedAt: d.deliveryReleasedAt ?? null,
      deliveryNote: d.deliveryNote ?? null,
      items: d.items
        ? d.items.map((it) => ({ name: it.name, quantity: it.quantity }))
        : null,
      totalSum: d.total ?? null,
      createdAt: d.createdAt ?? null,
      dealNumber: d.number,
    })),
  ];

  return <DeliveriesManager orders={rows} adminPath={ADMIN_PATH} />;
}
