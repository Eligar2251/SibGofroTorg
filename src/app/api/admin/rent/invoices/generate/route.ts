// POST /api/admin/rent/invoices/generate — массовое выставление
// счетов за следующий период по всем активным арендаторам.
import { NextResponse } from "next/server";
import { requireRentEdit } from "../../helpers";
import { generateRentInvoices } from "@/lib/rent";
import { logAdminAction } from "@/lib/activity-log";

export async function POST() {
  const auth = await requireRentEdit();
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await generateRentInvoices();
    await logAdminAction(
      auth.displayName,
      auth.role,
      "bulk_update",
      "rent-invoice",
      "",
      "Выставление счетов за следующий период",
      result
    );
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Rent invoices generate error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
