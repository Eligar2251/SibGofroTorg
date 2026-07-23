// src/app/[adminPath]/deliveries/page.tsx
// Доставки только по заказам учёта (ЗК). Заявки сайта → сначала в учёт.
import { notFound } from "next/navigation";
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

  let dealOrders: Awaited<ReturnType<typeof getDealDeliveries>> = [];
  let loadError: string | null = null;

  try {
    dealOrders = await getDealDeliveries({ filter: "all", limit: 500 });
  } catch (e) {
    console.error("deliveries page:", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/column|does not exist|schema cache/i.test(msg)) {
      loadError =
        "Поля доставки заказов учёта ещё не в БД. Выполните supabase/migration_deal_delivery_vat.sql в SQL Editor Supabase.";
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
            <p className="admin-sub">Планирование доставок по заказам учёта</p>
          </div>
        </div>
        <div className="admin-card" style={{ padding: 24 }}>
          <p style={{ color: "#b45309", fontWeight: 600, margin: 0 }}>{loadError}</p>
        </div>
      </div>
    );
  }

  const rows: DeliveryRow[] = dealOrders.map((d) => ({
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
  }));

  return <DeliveriesManager orders={rows} adminPath={ADMIN_PATH} />;
}
