// src/app/api/admin/clients/route.ts
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw?.toDate === "function") return raw.toDate().toISOString();
  if (raw._seconds != null) return new Date(raw._seconds * 1000).toISOString();
  if (raw.seconds != null) return new Date(raw.seconds * 1000).toISOString();
  if (typeof raw === "string") return raw;
  return null;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
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
        customerPhone: data.customerPhone ?? null,
        customerPhoneDigits: data.customerPhoneDigits ?? null,
        customerName: data.customerName ?? null,
        type: data.type ?? "inquiry",
        status: data.status ?? "new",
        totalSum: data.totalSum ?? null,
        createdAt: toIso(data.createdAt),
      };
    });

    const clients = usersSnap.docs.map((d) => {
      const data = d.data();
      const uid = d.id;
      const userOrders = orders.filter(
        (o) =>
          o.userId === uid ||
          (o.customerPhoneDigits && o.customerPhoneDigits === data.phoneDigits)
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
        totalSpent: userOrders
          .filter((o) => o.status === "completed")
          .reduce((s, o) => s + (o.totalSum || 0), 0),
        lastOrderAt:
          userOrders.length > 0 ? userOrders[0].createdAt : null,
        orders: userOrders,
      };
    });

    return NextResponse.json(clients);
  } catch (error) {
    console.error("Clients API error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}