// =========================================================
// FILE: src/app/api/admin/settings/test-max/route.ts
// Проверка MAX-бота: диагностика конфигурации (GET) и
// отправка тестового сообщения (POST).
// =========================================================

import { NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { sendMaxNotification } from "@/lib/notify";

function mask(value: string | undefined, visible = 4): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (v.length <= visible * 2) return `${v.slice(0, 2)}…${v.slice(-2)}`;
  return `${v.slice(0, visible)}…${v.slice(-visible)}`;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_settings")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const token = process.env["MAX_BOT_TOKEN"]?.trim() || undefined;
  const chatId = process.env["MAX_ADMIN_CHAT_ID"]?.trim() || undefined;
  return NextResponse.json({
    configured: Boolean(token && chatId),
    tokenSource: token ? "env" : "settings-or-none",
    tokenMasked: mask(token),
    chatIdMasked: mask(chatId),
  });
}

export async function POST() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_settings")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  try {
    const result = await sendMaxNotification(
      "Тест уведомления SibGofroTorg: если вы видите это сообщение — MAX настроен верно."
    , "Тест MAX (настройки)");
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, detail: result.detail },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Test MAX error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 500 }
    );
  }
}
