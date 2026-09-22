// src/app/api/admin/wp/salaries/[id]/route.ts
// Учёт макулатуры: правка/проведение/удаление зарплаты модуля.
// Работает только с записями, помеченными [Макулатура]: чужие зарплаты
// учёта через этот маршрут не видны и не меняются.
import { NextRequest, NextResponse } from "next/server";
import { deleteSalary, getSalaryById, updateSalary } from "@/lib/warehouse";
import { requireWastepaperApi } from "@/lib/wastepaper-account";
import { isWastepaperSalary, isWastepaperSalarySource, type SalarySource } from "@/lib/warehouse-shared";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

async function findWpSalary(id: string) {
  const salary = await getSalaryById(id);
  if (!salary || !isWastepaperSalary(salary)) return null;
  return salary;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const current = await findWpSalary(id);
    if (!current) {
      return NextResponse.json({ error: "Зарплата модуля макулатуры не найдена" }, { status: 404 });
    }
    const body = await request.json();
    if (body.source !== undefined && !isWastepaperSalarySource(body.source)) {
      return NextResponse.json({ error: "Счёт должен быть счётом макулатуры" }, { status: 400 });
    }
    // Теги счёта живут в комментарии: при любом новом тексте пересобираем
    // их по выбранному (или текущему) счёту, чтобы запись не «ушла» из модуля.
    const source: SalarySource | undefined =
      body.source !== undefined ? body.source : body.comment !== undefined ? current.source : undefined;
    await updateSalary(id, {
      employeeId: body.employeeId,
      employeeName: body.employeeName,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      date: body.date,
      source,
      isPaid: body.isPaid,
      paidAt: body.paidAt,
      comment: body.comment,
    });
    await logAdminAction(auth.displayName, auth.role, "update", "salary", id, `ЗП макулатуры: ${current.employeeName}`, {
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      source,
      isPaid: body.isPaid,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("WP update salary error:", error);
    return NextResponse.json({ error: error?.message || "Ошибка сервера" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const current = await findWpSalary(id);
    if (!current) {
      return NextResponse.json({ error: "Зарплата модуля макулатуры не найдена" }, { status: 404 });
    }
    await deleteSalary(id);
    await logAdminAction(auth.displayName, auth.role, "delete", "salary", id, `ЗП макулатуры: ${current.employeeName}`, {
      amount: current.amount,
      source: current.source,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("WP delete salary error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка сервера" }, { status: 400 });
  }
}
