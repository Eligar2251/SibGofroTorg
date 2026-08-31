// src/app/[adminPath]/clients/page.tsx
import { notFound } from "next/navigation";
import { ClientsManager } from "@/components/admin/ClientsManager";
import { getAdminDb } from "@/lib/supabase";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
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
  const [usersRes, ordersRes, usersCountRes] = await Promise.all([
    db.from("users").select("*").order("created_at", { ascending: false }).limit(200),
    db.from("orders").select("*").order("created_at", { ascending: false }).limit(500),
    db.from("users").select("id", { count: "exact", head: true }),
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

  const clients = (usersRes.data || []).map((d: any) => {
    const uid = d.id;
    const userOrders = orders.filter(
      (o: any) =>
        o.userId === uid ||
        (d.phone_digits && o.customerPhoneDigits === d.phone_digits)
    );
    return {
      id: uid,
      name: d.name ?? null,
      phone: d.phone ?? null,
      phoneDigits: d.phone_digits ?? null,
      email: d.email ?? null,
      customerType: d.customer_type ?? "individual",
      companyName: d.company_name ?? null,
      inn: d.inn ?? null,
      createdAt: toIso(d.created_at),
      ordersCount: userOrders.length,
      completedCount: userOrders.filter((o: any) => o.status === "completed").length,
      totalSpent: userOrders
        .filter((o: any) => o.status === "completed")
        .reduce((s: number, o: any) => s + (o.totalSum || 0), 0),
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
              {usersCountRes.count || 0}
            </strong>{" "}
            пользователей · показаны последние {clients.length}
          </p>
        </div>
      </div>
      <ClientsManager clients={clients} adminPath={ADMIN_PATH} />
    </div>
  );
}
