import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  postDeal,
  cancelDeal,
  deleteDeal,
  updateDeal,
  unshipDeal,
} from "@/lib/warehouse";
import { requireAdminApi, hasPermission } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    await updateDeal(id, {
      date: String(body.date || ""),
      customerName: String(body.customerName || ""),
      customerPhone: body.customerPhone ?? null,
      email: body.email ?? null,
      inn: body.inn ?? null,
      kpp: body.kpp ?? null,
      address: body.address ?? null,
      contactName: body.contactName ?? null,
      comment: body.comment ?? null,
      items: Array.isArray(body.items) ? body.items : [],
      linkedPaymentIds: body.linkedPaymentIds,
      // Способ оплаты и разбиение: сохраняем наличку, расчётный счёт или ЮМ.
      paymentMethod: body.paymentMethod,
      paymentSplits: body.paymentSplits,
      vatRate: body.vatRate,
      hasDelivery: body.hasDelivery,
      deliveryType: body.deliveryType,
      deliveryCost: body.deliveryCost,
      deliveryAddress: body.deliveryAddress,
      deliveryPlannedDate: body.deliveryPlannedDate,
      deliveryNote: body.deliveryNote,
      deliveryContact: body.deliveryContact,
      deliveryPhone: body.deliveryPhone,
      isReserved: body.isReserved === true,
    });
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const actionLabel = body.action === "post" ? "post" : body.action === "unship" ? "cancel" : body.action === "cancel" ? "cancel" : "update";

    if (body.action === "post") {
      await postDeal(id, Array.isArray(body.shippedItems) ? body.shippedItems : undefined);
      await logAdminAction(auth.displayName, auth.role, "post", "deal", id, `Отгрузка заказа #${id.slice(0, 8)}`, { shippedItems: body.shippedItems });
    } else if (body.action === "unship") {
      await unshipDeal(id);
      await logAdminAction(auth.displayName, auth.role, "cancel", "deal", id, `Отмена отгрузки заказа #${id.slice(0, 8)}`);
    } else if (body.action === "cancel") {
      await cancelDeal(id, body.reason ?? null);
      await logAdminAction(auth.displayName, auth.role, "cancel", "deal", id, `Отмена заказа #${id.slice(0, 8)}`, { reason: body.reason });
    } else {
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Update deal error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  if (!hasPermission(auth, "delete")) {
    return NextResponse.json({ error: "Нет прав на удаление" }, { status: 403 });
  }

  try {
    const { id } = await params;
    await deleteDeal(id);

    await logAdminAction(
      auth.displayName, auth.role, "delete", "deal", id,
      `Удалён заказ #${id.slice(0, 8)}`
    );

    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete deal error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
