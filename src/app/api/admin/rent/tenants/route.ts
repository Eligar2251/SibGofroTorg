// GET/POST /api/admin/rent/tenants — список и создание арендаторов.
import { NextRequest, NextResponse } from "next/server";
import { requireRentRead, requireRentEdit } from "../helpers";
import { getRentTenants, createRentTenant } from "@/lib/rent";
import { logAdminAction } from "@/lib/activity-log";

export async function GET() {
  const auth = await requireRentRead();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ tenants: await getRentTenants() });
  } catch (error: any) {
    console.error("Rent tenants GET error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRentEdit();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const result = await createRentTenant({
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
      "create",
      "rent-tenant",
      result.id,
      String(body.name || "Арендатор")
    );
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Rent tenant POST error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
