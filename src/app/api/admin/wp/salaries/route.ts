// src/app/api/admin/wp/salaries/route.ts
// Учёт макулатуры: зарплаты модуля (список, создание).
//
// Записи живут в общей таблице salaries с тегом [Макулатура]; источник —
// только счета модуля: наличка (wastepaper), безнал (wastepaper_bank) или
// сторонние средства (wastepaper_third, с пометкой «откуда» в комментарии).
// Балансы учёта СибГофроТорг такие выплаты не трогают.
import { NextRequest, NextResponse } from "next/server";
import { createSalary, saveEmployee } from "@/lib/warehouse";
import { getWpSalaries, requireWastepaperApi } from "@/lib/wastepaper-account";
import { isWastepaperSalarySource, type SalarySource } from "@/lib/warehouse-shared";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ items: await getWpSalaries() });
  } catch (error) {
    console.error("WP salaries list error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    let employeeId = body.employeeId ?? null;
    const employeeName = String(body.employeeName || "").trim();
    if (!employeeName) {
      return NextResponse.json({ error: "Укажите сотрудника" }, { status: 400 });
    }

    // Сотрудник вписан вручную — заводим его в общем справочнике.
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
        console.error("WP auto-create employee error:", e);
      }
    }

    const source: SalarySource = isWastepaperSalarySource(body.source) ? body.source : "wastepaper";
    const amount = Number(body.amount) || 0;
    if (!(amount > 0)) {
      return NextResponse.json({ error: "Сумма должна быть больше нуля" }, { status: 400 });
    }
    const result = await createSalary({
      employeeId,
      employeeName,
      amount,
      date: String(body.date || ""),
      source,
      isPaid: body.isPaid === true,
      comment: body.comment ?? null,
    });
    await logAdminAction(auth.displayName, auth.role, "create", "salary", result.id, `ЗП макулатуры: ${employeeName}`, {
      amount,
      source,
      isPaid: body.isPaid === true,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("WP create salary error:", error);
    return NextResponse.json({ error: error?.message || "Ошибка сервера" }, { status: 400 });
  }
}
