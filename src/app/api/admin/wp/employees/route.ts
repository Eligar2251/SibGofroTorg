// src/app/api/admin/wp/employees/route.ts
// Учёт макулатуры: сотрудники для зарплат модуля (общий справочник
// employees, доступен администратору и роли «макулатура»).
import { NextRequest, NextResponse } from "next/server";
import { getEmployees, saveEmployee } from "@/lib/warehouse";
import { requireWastepaperApi } from "@/lib/wastepaper-account";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ items: await getEmployees() });
  } catch (error) {
    console.error("WP employees list error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Укажите имя сотрудника" }, { status: 400 });
    const result = await saveEmployee({
      id: body.id ?? null,
      name,
      position: body.position ?? null,
      phone: body.phone ?? null,
      comment: body.comment ?? null,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("WP save employee error:", error);
    return NextResponse.json({ error: error?.message || "Ошибка сервера" }, { status: 400 });
  }
}
