// PATCH/DELETE /api/admin/rent/tenants/[id]
import { NextRequest, NextResponse } from "next/server";
import { requireRentEdit } from "../../helpers";
import { updateRentTenant, deleteRentTenant } from "@/lib/rent";
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
    await updateRentTenant(id, {
      orgId: body.orgId,
      name: body.name,
      office: body.office,
      contractNumber: body.contractNumber,
      contractDate: body.contractDate,
      monthlyRent: Number(body.monthlyRent) || 0,
      periodMonths: Number(body.periodMonths) || 1,
      dueDay: body.dueDay,
      invoiceDay: body.invoiceDay,
      deferralDays: Number(body.deferralDays) || 0,
      payMethod: body.payMethod,
      contactName: body.contactName,
      phone: body.phone,
      email: body.email,
      inn: body.inn,
      comment: body.comment,
      status: body.status,
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "rent-tenant",
      id,
      String(body.name || "Арендатор")
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Rent tenant PATCH error:", error);
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
    await deleteRentTenant(id);
    await logAdminAction(auth.displayName, auth.role, "delete", "rent-tenant", id, "Арендатор");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Rent tenant DELETE error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
