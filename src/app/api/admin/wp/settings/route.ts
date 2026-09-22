// src/app/api/admin/wp/settings/route.ts
// Учёт макулатуры: настройки таблицы зарплат модуля (планы, долги,
// календарь выплат, график) — ключи wp_salary_* плюс общая ширина
// колонок таблицы зарплат. Остальные настройки сайта отсюда не видны и
// не меняются: маршрут доступен и роли «макулатура».
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSettings, updateSettings } from "@/lib/supabase-queries";
import { requireWastepaperApi } from "@/lib/wastepaper-account";
import { isWastepaperSalarySettingKey } from "@/lib/admin-rbac";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const settings = await getSettings();
    const scoped = Object.fromEntries(
      Object.entries(settings || {}).filter(([key]) => isWastepaperSalarySettingKey(key))
    );
    return NextResponse.json(scoped);
  } catch (error) {
    console.error("WP read settings error:", error);
    return NextResponse.json({ error: "Не удалось прочитать настройки" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as Record<string, string>;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.values(body).some((value) => typeof value !== "string")
    ) {
      return NextResponse.json({ error: "Некорректные настройки" }, { status: 400 });
    }
    const keys = Object.keys(body);
    if (keys.length === 0 || !keys.every(isWastepaperSalarySettingKey)) {
      return NextResponse.json({ error: "Недопустимый ключ настройки" }, { status: 403 });
    }
    await updateSettings(body);
    revalidateTag("settings", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("WP update settings error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
