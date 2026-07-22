// src/app/api/admin/orders/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { updateOrderStatus, deleteOrder } from "@/lib/firestore-queries";
import { convertOrderToDeal } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    if (!body.status) {
      return NextResponse.json({ error: "Статус обязателен" }, { status: 400 });
    }
    await updateOrderStatus(id, body.status, body.closeReason ?? null);

    // «Передать в работу»: автоматически создаём заказ в учёте и счёт в банке
    let deal: Awaited<ReturnType<typeof convertOrderToDeal>> | undefined;
    if (body.status === "in_progress") {
      try {
        deal = await convertOrderToDeal(id);
      } catch (convertError) {
        console.error("Convert order to deal error:", convertError);
        return NextResponse.json({
          success: true,
          dealError:
            convertError instanceof Error
              ? convertError.message
              : "Не удалось передать в учёт",
        });
      }
    }

    return NextResponse.json({ success: true, deal });
  } catch (error) {
    console.error("Update order error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteOrder(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete order error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}