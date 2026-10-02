// =========================================================
// FILE: src/app/api/admin/nav-settings/route.ts
// Персональные настройки навигации админки: порядок разделов,
// скрытые разделы и группы-выпадашки. Каждый пользователь читает
// и меняет ТОЛЬКО свои настройки (ключ — логин из сессии).
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  ADMIN_NAV_ITEMS,
  normalizeNavSettings,
  type AdminNavSettingsDto,
} from "@/lib/admin-nav";
import {
  deleteAdminNavSettings,
  getAdminNavSettings,
  saveAdminNavSettings,
} from "@/lib/admin-nav-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KNOWN_KEYS = ADMIN_NAV_ITEMS.map((item) => item.key);

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const settings = await getAdminNavSettings(auth.username);
    return noStoreJson({ settings });
  } catch (error) {
    console.error("Read nav settings error:", error);
    return noStoreJson(
      { error: "Не удалось прочитать настройки меню" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as { settings?: unknown };
    const normalized = normalizeNavSettings(body?.settings, KNOWN_KEYS);
    if (!normalized) {
      return noStoreJson({ error: "Некорректные настройки меню" }, { status: 400 });
    }
    await saveAdminNavSettings(auth.username, normalized);
    return noStoreJson({ settings: normalized });
  } catch (error) {
    console.error("Save nav settings error:", error);
    return noStoreJson(
      {
        error:
          "Не удалось сохранить настройки меню. Проверьте, что применена миграция admin_nav_settings.",
      },
      { status: 500 }
    );
  }
}

/** Сброс к меню по умолчанию (удаляет сохранённые настройки). */
export async function DELETE() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    await deleteAdminNavSettings(auth.username);
    return noStoreJson({ settings: null satisfies AdminNavSettingsDto | null });
  } catch (error) {
    console.error("Reset nav settings error:", error);
    return noStoreJson(
      { error: "Не удалось сбросить настройки меню" },
      { status: 500 }
    );
  }
}
