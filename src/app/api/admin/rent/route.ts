// GET /api/admin/rent — весь набор данных учёта аренды одним запросом.
import { NextResponse } from "next/server";
import { requireRentRead } from "./helpers";
import {
  getRentOrgs,
  getRentTenants,
  getRentInvoices,
  getRentPayments,
} from "@/lib/rent";

export async function GET() {
  const auth = await requireRentRead();
  if (auth instanceof NextResponse) return auth;

  try {
    const [orgs, tenants, invoices, payments] = await Promise.all([
      getRentOrgs(),
      getRentTenants(),
      getRentInvoices(),
      getRentPayments(),
    ]);
    return NextResponse.json({ orgs, tenants, invoices, payments });
  } catch (error: any) {
    console.error("Rent GET error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
