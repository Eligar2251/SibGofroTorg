// GET/POST /api/admin/rent/invoices — начисления (счета) арендаторам.
import { NextRequest, NextResponse } from "next/server";
import { requireRentRead, requireRentEdit } from "../helpers";
import { getRentInvoices, createRentInvoice } from "@/lib/rent";
import { logAdminAction } from "@/lib/activity-log";

export async function GET() {
  const auth = await requireRentRead();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ invoices: await getRentInvoices() });
  } catch (error: any) {
    console.error("Rent invoices GET error:", error);
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
    const result = await createRentInvoice({
      tenantId: body.tenantId,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      issueDate: body.issueDate,
      dueDate: body.dueDate,
      amount: Number(body.amount) || 0,
      comment: body.comment,
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "rent-invoice",
      result.id,
      `Начисление АР-${result.number}`
    );
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Rent invoice POST error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
