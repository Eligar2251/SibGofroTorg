// src/app/api/admin/wp/employees/[id]/route.ts
// Учёт макулатуры: правка/удаление сотрудника (общий справочник employees).
import { NextRequest, NextResponse } from "next/server";
import { deleteEmployee, saveEmployee } from "@/lib/warehouse";
import { requireWastepaperApi } from "@/lib/wastepaper-account";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Укажите имя сотрудника" }, { status: 400 });
    const result = await saveEmployee({
      id,
      name,
      position: body.position ?? null,
      phone: body.phone ?? null,
      comment: body.comment ?? null,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("WP update employee error:", error);
    return NextResponse.json({ error: error?.message || "Ошибка сервера" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteEmployee(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("WP delete employee error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка сервера" }, { status: 400 });
  }
}
