// src/app/api/admin/orders/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { updateOrderStatus, deleteOrder } from "@/lib/supabase-queries";
import { convertOrderToDeal, returnOrderFromWork } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";
import { getAdminDb } from "@/lib/supabase";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const ALLOWED_STATUSES = ["new", "in_progress", "completed", "rejected"];
    if (!body.status || !ALLOWED_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: "Недопустимый статус заявки" },
        { status: 400 }
      );
    }
    const oldStatus = body.oldStatus || "";

    // Определяем тип заявки, чтобы «В работу» работал единообразно:
    // заявка-заказ (есть позиции) → создаётся сделка в учёте и платёж,
    // запрос на уточнение (без позиций) → просто меняет статус.
    const db = getAdminDb();
    const { data: orderRow } = await db
      .from("orders")
      .select("type, items, status, deal_id")
      .eq("id", id)
      .maybeSingle();

    const isOrderWithItems =
      orderRow?.type === "order" &&
      Array.isArray(orderRow.items) &&
      orderRow.items.length > 0;

    if (body.status === "new" && body.removeFromWork) {
      const rollback = await returnOrderFromWork(id);
      await logAdminAction(
        auth.displayName, auth.role, "status_change", "order", id,
        `Заявка #${id.slice(0, 8)}: убрана из работы`,
        { oldStatus, newStatus: "new", rollback }
      );
      return NextResponse.json({ success: true, rollback });
    }

    // Заявка, уже переданная в учёт, живёт в одном статусе с заказом ЗК:
    // вручную закрыть её со страницы заявок нельзя — закрытие/отмена придут
    // автоматически из учёта (проведение или отмена заказа ЗК).
    if ((body.status === "completed" || body.status === "rejected") && orderRow?.deal_id) {
      const { data: linkedDeal } = await db
        .from("customer_deals")
        .select("status")
        .eq("id", orderRow.deal_id)
        .maybeSingle();
      if (linkedDeal && linkedDeal.status !== "completed" && linkedDeal.status !== "cancelled") {
        return NextResponse.json(
          {
            error:
              body.status === "completed"
                ? "Заявка связана с заказом в учёте — она закроется автоматически после его проведения."
                : "Заявка связана с активным заказом в учёте — сначала уберите её из работы или отмените заказ в учёте.",
          },
          { status: 409 }
        );
      }
    }

    let deal: Awaited<ReturnType<typeof convertOrderToDeal>> | undefined;
    if (body.status === "in_progress" && isOrderWithItems) {
      try {
        deal = await convertOrderToDeal(id);
      } catch (convertError) {
        console.error("Convert order to deal error:", convertError);
        return NextResponse.json(
          { error: convertError instanceof Error ? convertError.message : "Не удалось передать в учёт" },
          { status: 500 }
        );
      }
    }

    await updateOrderStatus(id, body.status, body.closeReason ?? null);

    await logAdminAction(
      auth.displayName, auth.role, "status_change", "order", id,
      `Заявка #${id.slice(0, 8)}: ${oldStatus} → ${body.status}`,
      { oldStatus, newStatus: body.status, dealCreated: !!deal }
    );

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
    const result = await deleteOrder(id);

    await logAdminAction(
      auth.displayName, auth.role, "delete", "order", id,
      result.deleted
        ? `Удалена заявка #${id.slice(0, 8)} (${result.table || "unknown"})`
        : `Заявка #${id.slice(0, 8)} уже отсутствовала в базе`,
      result
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Delete order error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
