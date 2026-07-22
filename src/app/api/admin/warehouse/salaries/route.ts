import { NextRequest, NextResponse } from "next/server";
import { createSalary } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const result = await createSalary({
      employeeId: body.employeeId ?? null,
      employeeName: String(body.employeeName || ""),
      amount: Number(body.amount) || 0,
      date: String(body.date || ""),
      source: body.source === "cash" ? "cash" : "bank",
      isPaid: body.isPaid === true,
      comment: body.comment ?? null,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Create salary error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
