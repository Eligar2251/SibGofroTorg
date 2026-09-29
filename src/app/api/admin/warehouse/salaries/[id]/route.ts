import { NextRequest, NextResponse } from "next/server";
import { updateSalary, deleteSalary, getSalaryById } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";
import { isWastepaperSalary, isWastepaperSalarySource } from "@/lib/warehouse-shared";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const current = await getSalaryById(id);
    if (!current || isWastepaperSalary(current)) {
      return NextResponse.json({ error: "Зарплата учёта не найдена" }, { status: 404 });
    }
    const body = await request.json();
    const src = body.source !== undefined ? String(body.source) : undefined;
    if (
      (src && isWastepaperSalarySource(src)) ||
      (body.comment !== undefined && isWastepaperSalary({ comment: body.comment }))
    ) {
      return NextResponse.json(
        { error: "Записи макулатуры редактируются только в модуле «Учёт макулатуры»" },
        { status: 400 }
      );
    }
    const safeSource =
      src === "cash" ||
      src === "bank" ||
      src === "ym_card" ||
      src === "vm_card" ||
      src === "rent"
        ? src
        : undefined;
    await updateSalary(id, {
      employeeId: body.employeeId,
      employeeName: body.employeeName,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      date: body.date,
      source: safeSource as any,
      isPaid: body.isPaid,
      paidAt: body.paidAt,
      comment: body.comment,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Update salary error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const current = await getSalaryById(id);
    if (!current || isWastepaperSalary(current)) {
      return NextResponse.json({ error: "Зарплата учёта не найдена" }, { status: 404 });
    }
    await deleteSalary(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete salary error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
