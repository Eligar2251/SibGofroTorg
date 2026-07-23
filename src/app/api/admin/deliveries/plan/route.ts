// src/app/api/admin/deliveries/plan/route.ts
// Массовое планирование доставок на выбранную дату
import { NextRequest, NextResponse } from "next/server";
import { updateOrderDelivery, getOrderById } from "@/lib/supabase-queries";
import { requireAdminApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const date =
      body.date != null ? String(body.date).trim() : "";
    const orderIds: string[] = Array.isArray(body.orderIds)
      ? body.orderIds.map((x: unknown) => String(x)).filter(Boolean)
      : [];

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Укажите дату в формате YYYY-MM-DD" },
        { status: 400 }
      );
    }
    if (orderIds.length === 0) {
      return NextResponse.json(
        { error: "Выберите хотя бы один заказ" },
        { status: 400 }
      );
    }
    if (orderIds.length > 100) {
      return NextResponse.json(
        { error: "Не более 100 заказов за раз" },
        { status: 400 }
      );
    }

    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const id of orderIds) {
      try {
        const existing = await getOrderById(id);
        if (!existing) {
          results.push({ id, ok: false, error: "Не найден" });
          continue;
        }
        if (!existing.hasDelivery) {
          results.push({ id, ok: false, error: "Нет доставки" });
          continue;
        }
        if (!existing.deliveryAddress) {
          results.push({ id, ok: false, error: "Нет адреса" });
          continue;
        }
        await updateOrderDelivery(id, { deliveryPlannedDate: date });
        results.push({ id, ok: true });
      } catch (e) {
        results.push({
          id,
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
