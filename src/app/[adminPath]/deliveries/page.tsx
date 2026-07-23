// src/app/[adminPath]/deliveries/page.tsx
import { notFound } from "next/navigation";
import { getDeliveryOrders } from "@/lib/supabase-queries";
import { DeliveriesManager } from "@/components/admin/DeliveriesManager";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export default async function AdminDeliveriesPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  let orders: Awaited<ReturnType<typeof getDeliveryOrders>> = [];
  let loadError: string | null = null;

  try {
    orders = await getDeliveryOrders({ filter: "all", limit: 500 });
  } catch (e) {
    console.error("deliveries page:", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/column|does not exist|schema cache/i.test(msg)) {
      loadError =
        "Поля доставки ещё не добавлены в базу. Выполните файл supabase/migration_deliveries.sql в SQL Editor Supabase.";
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

  // Сериализуем plain-объекты для client component
  const plain = orders.map((o) => ({
    ...o,
    items: o.items ? [...o.items] : null,
  }));

  return <DeliveriesManager orders={plain as any} adminPath={ADMIN_PATH} />;
}
