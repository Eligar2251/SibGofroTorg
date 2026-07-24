import { NextRequest, NextResponse } from "next/server";
import { updatePayment, deletePayment } from "@/lib/warehouse";
import { requireAdminApi, hasPermission } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    await updatePayment(id, {
      isPaid: body.isPaid,
      excludeFromBalance: body.excludeFromBalance,
      type: body.type,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      comment: body.comment,
      date: body.date,
      counterparty: body.counterparty,
      invoiceNumber: body.invoiceNumber,
      dealIds: body.dealIds,
      receiptIds: body.receiptIds,
    });

    await logAdminAction(
      auth.displayName, auth.role, "update", "payment", id,
      `Платёж ПЛ-${body.number || id.slice(0, 8)}`,
      { isPaid: body.isPaid, amount: body.amount }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Update payment error:", error);
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
    await deletePayment(id);

    await logAdminAction(
      auth.displayName, auth.role, "delete", "payment", id,
      `Удалён платёж #${id.slice(0, 8)}`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete payment error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
