// =========================================================
// FILE: src/app/api/admin/settings/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSettings, updateSettings } from "@/lib/supabase-queries";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { isOperationalSettingKey } from "@/lib/admin-rbac";

/**
 * GET: администратору отдаёт все настройки. Менеджеру — только рабочие
 * ключи зарплат и порядка товаров, необходимые соответствующим модулям.
 * Ключи — строки, значения — строки (JSON хранится как текст).
 */
export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const settings = await getSettings();
    if (hasPermission(auth, "view_settings")) {
      return NextResponse.json(settings || {});
    }

    if (!hasPermission(auth, "use_operational_settings")) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    // Менеджеру нужны служебные значения зарплат и порядка товаров, но
    // токены, контакты, баннеры и прочие настройки сайта не выдаём.
    const operationalSettings = Object.fromEntries(
      Object.entries(settings || {}).filter(([key]) =>
        isOperationalSettingKey(key)
      )
    );
    return NextResponse.json(operationalSettings);
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
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.values(body).some((value) => typeof value !== "string")
    ) {
      return NextResponse.json({ error: "Некорректные настройки" }, { status: 400 });
    }

    if (!hasPermission(auth, "manage_settings")) {
      const keys = Object.keys(body);
      const canUpdateOperationalSettings =
        hasPermission(auth, "use_operational_settings") &&
        keys.length > 0 &&
        keys.every(isOperationalSettingKey);
      if (!canUpdateOperationalSettings) {
        return NextResponse.json(
          { error: "Нет доступа к настройкам сайта" },
          { status: 403 }
        );
      }
    }

    await updateSettings(body);
    revalidateTag("settings", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update settings error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}