// PATCH /api/admin/rent/orgs/[id] — реквизиты и правила организации.
import { NextRequest, NextResponse } from "next/server";
import { requireRentEdit } from "../../helpers";
import { updateRentOrg } from "@/lib/rent";
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
    await updateRentOrg(id, {
      name: body.name,
      shortName: body.shortName,
      legalName: body.legalName,
      inn: body.inn,
      bankAccount: body.bankAccount,
      bankName: body.bankName,
      bik: body.bik,
      correspondentAccount: body.correspondentAccount,
      payDay: body.payDay !== undefined ? Number(body.payDay) : undefined,
      invoiceDay: body.invoiceDay !== undefined ? Number(body.invoiceDay) : undefined,
      comment: body.comment,
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "rent-org",
      id,
      `Организация аренды ${id}`,
      { payDay: body.payDay, invoiceDay: body.invoiceDay }
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Rent org PATCH error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
