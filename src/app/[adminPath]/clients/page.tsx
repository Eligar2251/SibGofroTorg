// src/app/[adminPath]/clients/page.tsx
import { notFound } from "next/navigation";
import { ClientsManager } from "@/components/admin/ClientsManager";
import { getAdminDb } from "@/lib/firebase-admin";

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

export default async function AdminClientsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const db = getAdminDb();
  // Ограничиваем рабочий набор: раньше страница при каждом переходе читала
  // целиком обе коллекции. Точные общее количество получаем агрегатом.
  const [usersSnap, ordersSnap, usersCountAgg] = await Promise.all([
    db.collection("users").orderBy("createdAt", "desc").limit(200).get(),
    db.collection("orders").orderBy("createdAt", "desc").limit(500).get(),
    db.collection("users").count().get(),
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

  const clients = usersSnap.docs.map((d) => {
    const data = d.data();
    const uid = d.id;
    const userOrders = orders.filter(
      (o) =>
        o.userId === uid ||
        (data.phoneDigits && o.customerPhoneDigits === data.phoneDigits)
    );
    return {
      id: uid,
      name: data.name ?? null,
      phone: data.phone ?? null,
      phoneDigits: data.phoneDigits ?? null,
      email: data.email ?? null,
      customerType: data.customerType ?? "individual",
      companyName: data.companyName ?? null,
      inn: data.inn ?? null,
      createdAt: toIso(data.createdAt),
      ordersCount: userOrders.length,
      completedCount: userOrders.filter((o) => o.status === "completed")
        .length,
      totalSpent: userOrders
        .filter((o) => o.status === "completed")
        .reduce((s, o) => s + (o.totalSum || 0), 0),
      lastOrderAt: userOrders[0]?.createdAt ?? null,
      orders: userOrders,
    };
  });

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Клиенты</h1>
          <p className="admin-sub">
            Всего:{" "}
            <strong style={{ color: "var(--adm-navy)" }}>
              {usersCountAgg.data().count}
            </strong>{" "}
            пользователей · показаны последние {clients.length}
          </p>
        </div>
      </div>
      <ClientsManager clients={clients} />
    </div>
  );
}