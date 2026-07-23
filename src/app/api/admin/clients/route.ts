// src/app/api/admin/clients/route.ts
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const db = getAdminDb();
    const [usersRes, ordersRes] = await Promise.all([
      db.from("users").select("*").order("created_at", { ascending: false }).limit(200),
      db.from("orders").select("id, user_id, customer_phone, customer_phone_digits, customer_name, type, status, total_sum, created_at").order("created_at", { ascending: false }).limit(500),
    ]);

    const orders = (ordersRes.data || []).map((d: any) => ({
      id: d.id,
      userId: d.user_id ?? null,
      customerPhone: d.customer_phone ?? null,
      customerPhoneDigits: d.customer_phone_digits ?? null,
      customerName: d.customer_name ?? null,
      type: d.type ?? "inquiry",
      status: d.status ?? "new",
      totalSum: d.total_sum ?? null,
      createdAt: toIso(d.created_at),
    }));

    const clients = (usersRes.data || []).map((d: any) => {
      const uid = d.id;
      const userOrders = orders.filter(
        (o: any) => o.userId === uid || (o.customerPhoneDigits && o.customerPhoneDigits === d.phone_digits)
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
        totalSpent: userOrders
          .filter((o: any) => o.status === "completed")
          .reduce((s: number, o: any) => s + (o.totalSum || 0), 0),
        lastOrderAt: userOrders.length > 0 ? userOrders[0].createdAt : null,
        orders: userOrders,
      };
    });

    return NextResponse.json(clients);
  } catch (error) {
    console.error("Clients API error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
