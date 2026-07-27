// =========================================================
// FILE: src/app/api/admin/settings/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSettings, updateSettings } from "@/lib/supabase-queries";
import { requireAdminApi } from "@/lib/auth";

/**
 * GET: отдаёт все настройки админке (используется, например, вкладкой
 * «Зарплаты» для чтения планов на месяц и календаря выходных дней).
 * Ключи — строки, значения — строки (JSON хранится как текст).
 */
export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const settings = await getSettings();
    return NextResponse.json(settings || {});
  } catch (error) {
    console.error("Read settings error:", error);
    return NextResponse.json(
      { error: "Не удалось прочитать настройки" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json()) as Record<string, string>;
    await updateSettings(body);
    revalidateTag("settings", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update settings error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}