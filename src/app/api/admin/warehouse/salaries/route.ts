import { NextRequest, NextResponse } from "next/server";
import { createSalary, saveEmployee } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";
import { isWastepaperSalary, isWastepaperSalarySource } from "@/lib/warehouse-shared";

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
    // Записи с макулатуры создаются только через API её модуля; не даём
    // обычному учёту создавать записи в чужом разделе или помечать их тегом.
    if (
      isWastepaperSalarySource(src) ||
      isWastepaperSalary({ comment: body.comment })
    ) {
      return NextResponse.json(
        { error: "Зарплаты макулатуры нужно проводить в модуле «Учёт макулатуры»" },
        { status: 400 }
      );
    }
    const safeSource =
      src === "cash" ||
      src === "ym_card" ||
      src === "vm_card" ||
      src === "rent" ||
      src === "bank"
        ? src
        : "bank";
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
