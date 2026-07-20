import { NextRequest, NextResponse } from "next/server";
import { updatePayment, deletePayment } from "@/lib/warehouse";
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
    await updatePayment(id, {
      isPaid: body.isPaid,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      comment: body.comment,
      date: body.date,
      counterparty: body.counterparty,
      invoiceNumber: body.invoiceNumber,
    });
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
  try {
    const { id } = await params;
    await deletePayment(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete payment error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
