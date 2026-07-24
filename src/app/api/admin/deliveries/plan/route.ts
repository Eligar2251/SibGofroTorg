// src/app/api/admin/deliveries/plan/route.ts
// Массовое планирование доставок на выбранную дату
// items: [{ id, source: "site"|"deal" }] или orderIds (legacy, site)
import { NextRequest, NextResponse } from "next/server";
import { updateOrderDelivery, getOrderById } from "@/lib/supabase-queries";
import { updateDealDelivery } from "@/lib/warehouse";
import { getAdminDb } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const date =
      body.date != null ? String(body.date).trim() : "";

    type Item = { id: string; source: "site" | "deal"; deliveryItems?: { productId: string; name: string; quantity: number }[] };
    let items: Item[] = [];
    if (Array.isArray(body.items)) {
      items = body.items
        .map((x: any) => ({
          id: String(x?.id || ""),
          source: x?.source === "deal" ? ("deal" as const) : ("site" as const),
          deliveryItems: Array.isArray(x?.deliveryItems) ? x.deliveryItems : [],
        }))
        .filter((x: Item) => x.id);
    } else if (Array.isArray(body.orderIds)) {
      items = body.orderIds
        .map((x: unknown) => String(x))
        .filter(Boolean)
        .map((id: string) => ({ id, source: "site" as const }));
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Укажите дату в формате YYYY-MM-DD" },
        { status: 400 }
      );
    }
    if (items.length === 0) {
      return NextResponse.json(
        { error: "Выберите хотя бы один заказ" },
        { status: 400 }
      );
    }
    if (items.length > 100) {
      return NextResponse.json(
        { error: "Не более 100 заказов за раз" },
        { status: 400 }
      );
    }

    const results: { id: string; ok: boolean; error?: string }[] = [];
    const db = getAdminDb();

    for (const item of items) {
      try {
        if (item.source === "deal") {
          const { data: existing } = await db
            .from("customer_deals")
            .select("id, has_delivery, delivery_address")
            .eq("id", item.id)
            .maybeSingle();
          if (!existing) {
            results.push({ id: item.id, ok: false, error: "Не найден" });
            continue;
          }
          if (!existing.has_delivery) {
            results.push({ id: item.id, ok: false, error: "Нет доставки" });
            continue;
          }
          if (!existing.delivery_address) {
            results.push({ id: item.id, ok: false, error: "Нет адреса" });
            continue;
          }
          await updateDealDelivery(item.id, {
            deliveryPlannedDate: date,
            deliveryItems: item.deliveryItems && item.deliveryItems.length > 0 ? item.deliveryItems : undefined,
          });
          results.push({ id: item.id, ok: true });
        } else {
          const existing = await getOrderById(item.id);
          if (!existing) {
            results.push({ id: item.id, ok: false, error: "Не найден" });
            continue;
          }
          if (!existing.hasDelivery) {
            results.push({ id: item.id, ok: false, error: "Нет доставки" });
            continue;
          }
          if (!existing.deliveryAddress) {
            results.push({ id: item.id, ok: false, error: "Нет адреса" });
            continue;
          }
          await updateOrderDelivery(item.id, { deliveryPlannedDate: date });
          results.push({ id: item.id, ok: true });
        }
      } catch (e) {
        results.push({
          id: item.id,
          ok: false,
          error: e instanceof Error ? e.message : "Ошибка",
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({
      success: true,
      planned: okCount,
      date,
      results,
    });
  } catch (error) {
    console.error("Bulk plan deliveries error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
