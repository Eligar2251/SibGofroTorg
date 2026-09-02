// =========================================================
// FILE: src/app/api/admin/notifications/requests/route.ts
// Лёгкий эндпоинт: ТОЛЬКО необработанные заявки клиентов.
//
// ЗАЧЕМ ОТДЕЛЬНО ОТ /api/admin/notifications
// Тот эндпоинт вытягивает 1000 товаров, 300 сделок и 2000 платежей и
// считает по ним остатки и долги — сотни миллисекунд на запрос. Колокольчик
// заявок дёргал именно его на каждое realtime-событие, поэтому «мгновенно»
// на деле означало заметную задержку, а при частых событиях — лишнюю
// нагрузку на БД.
//
// Здесь два узких запроса по индексу status='new'. Ответ приходит за
// десятки миллисекунд, что и делает уведомление действительно моментальным.
// =========================================================

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

type RequestItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  createdAt: string | null;
};

function toIso(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}

function fmtRub(value: unknown): string {
  return `${(Number(value) || 0).toLocaleString("ru-RU")} ₽`;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const db = getAdminDb();

    const [ordersRes, wasteRes] = await Promise.all([
      db
        .from("orders")
        .select("id,type,customer_name,total_sum,product_info,created_at")
        .eq("status", "new")
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("wastepaper_requests")
        .select("id,customer_name,wastepaper_type,weight,created_at")
        .eq("status", "new")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (ordersRes.error) throw ordersRes.error;
    if (wasteRes.error) throw wasteRes.error;

    const items: RequestItem[] = [];

    for (const order of ordersRes.data || []) {
      items.push({
        id: `order-${order.id}`,
        title:
          order.type === "inquiry"
            ? "Новая заявка на уточнение"
            : "Новая заявка с сайта",
        description:
          order.type === "inquiry"
            ? `${order.customer_name || "Клиент"}: ${order.product_info || "уточнение по товару"}`
            : `${order.customer_name || "Клиент"}${order.total_sum ? ` · ${fmtRub(order.total_sum)}` : ""}`,
        href: `/${ADMIN_PATH}/orders?status=new&q=${encodeURIComponent(order.id)}`,
        createdAt: toIso(order.created_at),
      });
    }

    for (const request of wasteRes.data || []) {
      items.push({
        id: `waste-${request.id}`,
        title: "Новая заявка на макулатуру",
        description: `${request.customer_name || "Клиент"}: ${request.wastepaper_type || "макулатура"}${
          request.weight ? ` · ${request.weight} кг` : ""
        }`,
        href: `/${ADMIN_PATH}/orders?status=new&q=${encodeURIComponent(request.id)}`,
        createdAt: toIso(request.created_at),
      });
    }

    // Свежие сверху — по ним и звонит сигнал.
    items.sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );

    return NextResponse.json({ total: items.length, items });
  } catch (error) {
    console.error("Admin request alerts error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
