// =========================================================
// Выдача товара: отметить заказ выданным (или отменить выдачу).
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";
import { getAdminDb } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  // action: "issue" — выдать товар; "unissue" — отменить выдачу.
  const action = body.action === "unissue" ? "unissue" : "issue";

  const db = getAdminDb();
  const { data: order } = await db
    .from("orders")
    .select("id, status, pickup_code")
    .eq("id", id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

  if (action === "issue") {
    if (order.status === "issued") {
      return NextResponse.json({ success: true, already: true });
    }
    const { error } = await db
      .from("orders")
      .update({ status: "issued", issued_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("issue order error:", error);
      return NextResponse.json({ error: "Не удалось выдать заказ" }, { status: 500 });
    }
    await logAdminAction(
      auth.displayName,
      auth.role,
      "issue",
      "order",
      id,
      `Выдан товар по заказу #${id.slice(0, 8)} (код ${order.pickup_code || "—"})`
    );
    return NextResponse.json({ success: true });
  }

  // Отмена выдачи — возвращаем в «Готов к выдаче».
  const { error } = await db
    .from("orders")
    .update({ status: "ready", issued_at: null })
    .eq("id", id);
  if (error) {
    console.error("unissue order error:", error);
    return NextResponse.json({ error: "Не удалось отменить выдачу" }, { status: 500 });
  }
  await logAdminAction(
    auth.displayName,
    auth.role,
    "issue",
    "order",
    id,
    `Отменена выдача по заказу #${id.slice(0, 8)}`
  );
  return NextResponse.json({ success: true });
}
