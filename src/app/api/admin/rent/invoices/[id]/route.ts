// PATCH/DELETE /api/admin/rent/invoices/[id]
import { NextRequest, NextResponse } from "next/server";
import { requireRentEdit } from "../../helpers";
import { updateRentInvoice, deleteRentInvoice } from "@/lib/rent";
import { logAdminAction } from "@/lib/activity-log";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRentEdit();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    await updateRentInvoice(id, {
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      issueDate: body.issueDate,
      dueDate: body.dueDate,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      status: body.status,
      comment: body.comment,
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      body.status ? "status_change" : "update",
      "rent-invoice",
      id,
      `Начисление ${id.slice(0, 8)}`,
      { status: body.status, amount: body.amount }
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Rent invoice PATCH error:", error);
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
    await deleteRentInvoice(id);
    await logAdminAction(auth.displayName, auth.role, "delete", "rent-invoice", id, "Начисление");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Rent invoice DELETE error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
