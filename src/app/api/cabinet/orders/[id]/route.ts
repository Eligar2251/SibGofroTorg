import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/supabase";
import { requireUserApi, normalizePhone } from "@/lib/user-auth";
import { cancelWebsiteOrderByCustomer, reviseWebsiteOrderByCustomer } from "@/lib/warehouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function assertOrderOwner(orderId: string, uid: string, phone: string) {
  const db = getAdminDb();
  const { data: order, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error || !order) return { error: "Заказ не найден", status: 404 as const };
  const phoneDigits = normalizePhone(phone);
  const orderPhone = normalizePhone(order.customer_phone_digits || order.customer_phone || "");
  if (order.user_id && order.user_id !== uid) return { error: "Нет доступа", status: 403 as const };
  if (!order.user_id && orderPhone !== phoneDigits) return { error: "Нет доступа", status: 403 as const };
  return { order };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUserApi();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const owner = await assertOrderOwner(id, auth.uid, auth.phone);
  if ("error" in owner) return NextResponse.json({ error: owner.error }, { status: owner.status });

  try {
    const body = await request.json();
    const result = await reviseWebsiteOrderByCustomer(id, {
      items: Array.isArray(body.items) ? body.items : [],
      comment: body.comment ?? null,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Cabinet order update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUserApi();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const owner = await assertOrderOwner(id, auth.uid, auth.phone);
  if ("error" in owner) return NextResponse.json({ error: owner.error }, { status: owner.status });

  try {
    await cancelWebsiteOrderByCustomer(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Cabinet order cancel error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
