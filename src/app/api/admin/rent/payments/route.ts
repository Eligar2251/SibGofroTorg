// GET/POST /api/admin/rent/payments — банк аренды (платежи).
import { NextRequest, NextResponse } from "next/server";
import { requireRentRead, requireRentEdit } from "../helpers";
import { getRentPayments, createRentPayment } from "@/lib/rent";
import { logAdminAction } from "@/lib/activity-log";

export async function GET() {
  const auth = await requireRentRead();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ payments: await getRentPayments() });
  } catch (error: any) {
    console.error("Rent payments GET error:", error);
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
    const result = await createRentPayment({
      accountOrgId: body.accountOrgId,
      direction: body.direction === "outgoing" ? "outgoing" : "incoming",
      kind: body.kind,
      method: body.method === "cash" ? "cash" : "bank",
      tenantId: body.tenantId || null,
      invoiceId: body.invoiceId || null,
      counterparty: body.counterparty,
      amount: Number(body.amount) || 0,
      date: body.date,
      invoiceNumber: body.invoiceNumber,
      isPaid: body.isPaid === true,
      excludeFromBalance: body.excludeFromBalance === true,
      comment: body.comment,
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "rent-payment",
      result.id,
      `Платёж аренды АП-${result.number}`,
      { amount: body.amount, direction: body.direction }
    );
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Rent payment POST error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
