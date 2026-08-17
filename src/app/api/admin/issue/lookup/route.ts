// =========================================================
// Поиск заказа по коду выдачи / номеру / имени / телефону
// для вкладки «Выдача товара».
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID_RE = /^[0-9a-f]{4,16}$/i;

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ orders: [] });
  }

  const db = getAdminDb();
  const codeQuery = q.toUpperCase();
  const results = new Map<string, any>();

  // 1) По коду выдачи (pickup_code — TEXT).
  try {
    const { data, error } = await db
      .from("orders")
      .select("*")
      .ilike("pickup_code", `%${codeQuery}%`)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("issue lookup by code:", error);
    } else {
      for (const row of data || []) results.set(row.id, row);
    }
  } catch (err) {
    console.error("issue lookup by code:", err);
  }

  // 2) По имени / телефону / почте / организации (все TEXT).
  //    ВАЖНО: id здесь не участвует — orders.id имеет тип UUID,
  //    и `ilike` по UUID вызывает ошибку Postgres (operator does not exist).
  try {
    const { data, error } = await db
      .from("orders")
      .select("*")
      .or(
        `customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%,customer_email.ilike.%${q}%,company_name.ilike.%${q}%`
      )
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("issue lookup by text:", error);
    } else {
      for (const row of data || []) results.set(row.id, row);
    }
  } catch (err) {
    console.error("issue lookup by text:", err);
  }

  // 3) По номеру заказа (id): точное совпадение полного UUID
  //    либо короткий префикс (то, что показывается как «#ab12cd34»).
  if (UUID_RE.test(q)) {
    try {
      const { data } = await db
        .from("orders")
        .select("*")
        .eq("id", q.toLowerCase())
        .maybeSingle();
      if (data) results.set(data.id, data);
    } catch (err) {
      console.error("issue lookup by id:", err);
    }
  } else if (SHORT_ID_RE.test(q)) {
    try {
      const { data } = await db
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      for (const row of data || []) {
        if (String(row.id).toLowerCase().startsWith(q.toLowerCase())) {
          results.set(row.id, row);
        }
      }
    } catch (err) {
      console.error("issue lookup by short id:", err);
    }
  }

  const orders = Array.from(results.values()).map(serializeOrder);
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
