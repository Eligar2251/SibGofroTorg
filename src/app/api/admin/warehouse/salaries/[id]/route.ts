import { NextRequest, NextResponse } from "next/server";
import { updateSalary, deleteSalary } from "@/lib/warehouse";
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
    await updateSalary(id, {
      employeeId: body.employeeId,
      employeeName: body.employeeName,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      date: body.date,
      source: body.source === "cash" || body.source === "bank" ? body.source : undefined,
      isPaid: body.isPaid,
      paidAt: body.paidAt,
      comment: body.comment,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Update salary error:", error);
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
    await deleteSalary(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete salary error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
