import { NextRequest, NextResponse } from "next/server";
import { createSalary, saveEmployee } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    let employeeId = body.employeeId ?? null;
    const employeeName = String(body.employeeName || "").trim();

    // Если указан ID сотрудника, но он не выбран (пустой или "new"),
    // и есть имя — создаём сотрудника автоматически
    if (!employeeId && employeeName) {
      try {
        const emp = await saveEmployee({
          name: employeeName,
          position: body.employeePosition ?? null,
          phone: body.employeePhone ?? null,
          comment: null,
        });
        employeeId = emp.id;
      } catch (e) {
        console.error("Auto-create employee error:", e);
      }
    }

    const src = String(body.source || "");
    const safeSource = (src === "cash" || src === "ym_card" || src === "rent" || src === "bank" ? src : "bank");
    const result = await createSalary({
      employeeId,
      employeeName,
      amount: Number(body.amount) || 0,
      date: String(body.date || ""),
      source: safeSource as any,
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
