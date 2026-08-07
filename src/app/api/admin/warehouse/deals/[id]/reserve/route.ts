// PATCH /api/admin/warehouse/deals/[id]/reserve
// Переключение резерва товара по заказу.
// Если заказ в резерве — товары из него вычитаются из свободного остатка.
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { logAdminAction } from "@/lib/activity-log";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reserved = body.reserved === true;

    const db = getAdminDb();
    const { data: existing, error } = await db
      .from("customer_deals")
      .select("id, number, status, customer_name, items, is_reserved")
      .eq("id", id)
      .maybeSingle();
    if (error || !existing) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }
    if (existing.status === "completed" || existing.status === "cancelled") {
      return NextResponse.json(
        { error: "Нельзя зарезервировать проведённый или отменённый заказ" },
        { status: 400 }
      );
    }
    if (Boolean(existing.is_reserved) === reserved) {
      return NextResponse.json({ success: true, reserved });
    }

    const { error: updErr } = await db
      .from("customer_deals")
      .update({ is_reserved: reserved, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updErr) throw new Error(updErr.message);

    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "deal",
      id,
      `${reserved ? "Зарезервирован" : "Снят с резерва"} заказ #${existing.number} (${existing.customer_name || ""})`
    );

    revalidateTag("products", { expire: 0 });
    revalidateTag("warehouse-deals", { expire: 0 });
    return NextResponse.json({ success: true, reserved });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
