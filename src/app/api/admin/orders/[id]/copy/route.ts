// =========================================================
// FILE: src/app/api/admin/orders/[id]/copy/route.ts
// Дублирование заявки-заказа с сайта в новую заявку со статусом «Новая».
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { createOrder } from "@/lib/supabase-queries";
import { getAdminDb } from "@/lib/supabase";
import { logAdminAction } from "@/lib/activity-log";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const db = getAdminDb();
    const { data: src, error } = await db
      .from("orders")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !src) {
      return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    }

    const created = await createOrder({
      type: src.type || "order",
      customerType: src.customer_type || "individual",
      customerName: src.customer_name || "",
      customerPhone: src.customer_phone || "",
      customerPhoneDigits: src.customer_phone_digits || null,
      userId: src.user_id || null,
      customerEmail: src.customer_email || null,
      communicationChannel: src.communication_channel || "call",
      paymentMethod: src.payment_method || null,
      items: src.items || null,
      totalSum: src.total_sum ?? null,
      productInfo: src.product_info || null,
      quantity: src.quantity ?? null,
      comment: src.comment || null,
      channel: src.channel || "website",
      status: "new",
      companyName: src.company_name || null,
      shortName: src.short_name || null,
      inn: src.inn || null,
      kpp: src.kpp || null,
      ogrn: src.ogrn || null,
      legalAddress: src.legal_address || null,
      actualAddress: src.actual_address || null,
      taxSystem: src.tax_system || null,
      bankAccount: src.bank_account || null,
      bankName: src.bank_name || null,
      bik: src.bik || null,
      correspondentAccount: src.correspondent_account || null,
      deliveryAddress: src.delivery_address || null,
      hasDelivery: src.has_delivery ?? false,
      deliveryType: src.delivery_type || null,
      deliveryCost: src.delivery_cost ?? 0,
      deliveryNote: src.delivery_note || null,
    });

    await logAdminAction(
      auth.displayName || auth.username,
      auth.role,
      "create",
      "order",
      created.id,
      `Создана копия заявки #${id.slice(0, 8)} → #${created.id.slice(0, 8)}`,
      { copiedFrom: id },
    );

    return NextResponse.json({ ok: true, id: created.id, pickupCode: created.pickupCode });
  } catch (e: any) {
    console.error("[orders/copy POST]", e);
    return NextResponse.json(
      { error: e?.message || "Не удалось скопировать заявку" },
      { status: 500 },
    );
  }
}
