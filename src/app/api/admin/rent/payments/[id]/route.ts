// GET/PATCH/DELETE /api/admin/rent/payments/[id]
import { NextRequest, NextResponse } from "next/server";
import { requireRentRead, requireRentEdit } from "../../helpers";
import {
  updateRentPayment,
  deleteRentPayment,
  getRentPayments,
} from "@/lib/rent";
import { logAdminAction } from "@/lib/activity-log";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRentRead();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const payments = await getRentPayments();
    const payment = payments.find((p) => p.id === id);
    if (!payment) {
      return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });
    }
    return NextResponse.json({ payment });
  } catch (error) {
    console.error("Rent payment GET error:", error);
    return NextResponse.json(
      { error: "Не удалось загрузить платёж" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRentEdit();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    await updateRentPayment(id, {
      accountOrgId: body.accountOrgId,
      kind: body.kind,
      method: body.method,
      tenantId: body.tenantId,
      invoiceId: body.invoiceId,
      counterparty: body.counterparty,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      date: body.date,
      invoiceNumber: body.invoiceNumber,
      isPaid: body.isPaid,
      excludeFromBalance: body.excludeFromBalance,
      comment: body.comment,
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      body.isPaid !== undefined ? "post" : "update",
      "rent-payment",
      id,
      `Платёж аренды ${id.slice(0, 8)}`,
      { isPaid: body.isPaid, amount: body.amount }
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Rent payment PATCH error:", error);
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
  const auth = await requireRentEdit();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteRentPayment(id);
    await logAdminAction(auth.displayName, auth.role, "delete", "rent-payment", id, "Платёж аренды");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Rent payment DELETE error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
