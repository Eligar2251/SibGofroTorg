// =========================================================
// Поиск заказа по коду выдачи / номеру / имени / телефону
// для вкладки «Выдача товара».
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ orders: [] });
  }

  const db = getAdminDb();
  const codeQuery = q.toUpperCase();

  // 1) Точное совпадение по коду выдачи.
  const byCode = await db
    .from("orders")
    .select("*")
    .ilike("pickup_code", `%${codeQuery}%`)
    .order("created_at", { ascending: false })
    .limit(20);

  // 2) По ID (префикс), имени или телефону.
  const byText = await db
    .from("orders")
    .select("*")
    .or(
      `id.ilike.%${q}%,customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%,company_name.ilike.%${q}%`
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (byCode.error || byText.error) {
    console.error("issue lookup error:", byCode.error || byText.error);
    return NextResponse.json({ error: "Ошибка поиска" }, { status: 500 });
  }

  const map = new Map<string, any>();
  for (const row of [...(byCode.data || []), ...(byText.data || [])]) {
    map.set(row.id, row);
  }

  const orders = Array.from(map.values()).map(serializeOrder);
  return NextResponse.json({ orders });
}

function serializeOrder(row: any) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    customerType: row.customer_type,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email ?? null,
    companyName: row.company_name ?? null,
    inn: row.inn ?? null,
    pickupCode: row.pickup_code ?? null,
    issuedAt: row.issued_at ?? null,
    items: Array.isArray(row.items)
      ? row.items.map((item: any) => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          sku: item.sku ?? null,
        }))
      : null,
    totalSum: row.total_sum != null ? Number(row.total_sum) : null,
    comment: row.comment ?? null,
    deliveryAddress: row.delivery_address ?? null,
    deliveryNote: row.delivery_note ?? null,
    createdAt: row.created_at,
  };
}
