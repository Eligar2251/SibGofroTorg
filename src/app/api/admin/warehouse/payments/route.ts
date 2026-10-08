import { NextRequest, NextResponse } from "next/server";
import { createPayment } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const result = await createPayment({
      date: String(body.date || ""),
      direction: body.direction === "outgoing" ? "outgoing" : "incoming",
      type: body.type,
      counterparty: String(body.counterparty || ""),
      dealIds: Array.isArray(body.dealIds) ? body.dealIds : [],
      receiptIds: Array.isArray(body.receiptIds) ? body.receiptIds : [],
      amount: Number(body.amount) || 0,
      invoiceNumber: body.invoiceNumber ?? null,
      isPaid: body.isPaid === true,
      excludeFromBalance: body.excludeFromBalance === true,
      comment: body.comment ?? null,
      purchasePlanId: body.purchasePlanId ? String(body.purchasePlanId) : null,
      paymentPurpose: body.paymentPurpose ?? null,
      paymentPriority: body.paymentPriority ?? 5,
      paymentKind: body.paymentKind ?? "01",
      vatRate: body.vatRate !== undefined && body.vatRate !== null ? Number(body.vatRate) : undefined,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Create payment error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
