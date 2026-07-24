// src/app/[adminPath]/deliveries/page.tsx
// Доставки заказов учёта (ЗК): водитель, печать бланка, архив.
import { notFound } from "next/navigation";
import { getDealDeliveries, getEmployees } from "@/lib/warehouse";
import { getSettings } from "@/lib/supabase-queries";
import {
  DeliveriesManager,
  type DeliveryRow,
} from "@/components/admin/DeliveriesManager";
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

  let dealOrders: Awaited<ReturnType<typeof getDealDeliveries>> = [];
  let employees: Awaited<ReturnType<typeof getEmployees>> = [];
  let loadError: string | null = null;

  try {
    const [deals, emps] = await Promise.all([
      getDealDeliveries({ filter: "all", limit: 500 }),
      getEmployees().catch(() => []),
    ]);
    dealOrders = deals;
    employees = emps;
  } catch (e) {
    console.error("deliveries page:", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/column|does not exist|schema cache/i.test(msg)) {
      loadError =
        "Поля доставки/водителя ещё не в БД. Выполните supabase/migration_deal_delivery_vat.sql и supabase/migration_delivery_driver.sql";
    } else {
      loadError = "Не удалось загрузить доставки. Попробуйте обновить страницу.";
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
            <h1 className="admin-h1">Доставки</h1>
            <p className="admin-sub">Планирование · водитель · бланк курьера</p>
          </div>
        </div>
        <div className="admin-card" style={{ padding: 24 }}>
          <p style={{ color: "#b45309", fontWeight: 600, margin: 0 }}>{loadError}</p>
        </div>
      </div>
    );
  }

  // Водители = сотрудники (все; удобно выбирать курьера из штата)
  const drivers = employees.map((e) => ({
    id: e.id,
    name: e.name,
    phone: e.phone ?? null,
    position: e.position ?? null,
  }));

  const rows: DeliveryRow[] = dealOrders.map((d) => ({
    id: d.id,
    source: "deal" as const,
    label: `ЗК-${d.number}`,
    customerName: d.customerName || "Без имени",
    customerPhone: d.customerPhone ?? d.phone ?? null,
    contactName: d.contactName ?? null,
    deliveryType: d.deliveryType ?? null,
    deliveryCost: d.deliveryCost ?? null,
    deliveryAddress: d.deliveryAddress ?? d.address ?? null,
    deliveryPlannedDate: d.deliveryPlannedDate ?? null,
    deliveryReleasedAt: d.deliveryReleasedAt ?? null,
    deliveryNote: d.deliveryNote ?? null,
    deliveryDriverId: d.deliveryDriverId ?? null,
    deliveryDriverName: d.deliveryDriverName ?? null,
    items: d.items
      ? d.items.map((it) => ({ productId: it.productId, name: it.name, quantity: it.quantity }))
      : null,
    deliveryItems: Array.isArray(d.deliveryItems) ? d.deliveryItems : null,
    totalSum: d.total ?? null,
    createdAt: d.createdAt ?? null,
    dealNumber: d.number,
  }));

  return (
    <div>
      <DeliveriesRealtime />
      <DeliveriesManager
        orders={rows}
        adminPath={ADMIN_PATH}
        drivers={drivers}
        companyPhone={companyPhone}
        companyAddress={companyAddress}
      />
    </div>
  );
}
