// =========================================================
// FILE: src/app/api/admin/die-calc/settings/route.ts
// Общий прайс калькулятора (die_calc_settings): профили гофрокартона,
// форматы листа и ставки. Нужен, чтобы цены в журнале считались по одним и
// тем же ставкам, а не по localStorage каждого администратора.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";
import { dieCalcTableHint, getDieCalcSettings, saveDieCalcSettings } from "@/lib/die-calc-db";

const bad = (error: unknown, fallback: string) => {
  const status = Number((error as { status?: number })?.status ?? 0);
  const message = String((error as { message?: string })?.message || fallback);
  return NextResponse.json({ error: dieCalcTableHint(error) ?? message }, { status: status >= 400 && status < 500 ? status : 500 });
};

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ settings: await getDieCalcSettings() });
  } catch (error) {
    console.error("Die-calc settings read error:", error);
    return NextResponse.json({ settings: null });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Ожидался объект с настройками" }, { status: 400 });
    }
    const actor = auth.displayName || auth.username;
    await saveDieCalcSettings(body as Record<string, unknown>, actor);
    await logAdminAction(actor, auth.role, "update", "die-calc", "settings", "общий прайс калькулятора", {});
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Die-calc settings write error:", error);
    return bad(error, "Не удалось сохранить прайс");
  }
}
