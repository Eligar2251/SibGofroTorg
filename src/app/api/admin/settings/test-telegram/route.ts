import { NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { diagnoseTelegram, sendTelegramNotification } from "@/lib/notify";

/**
 * GET — диагностика подключения Telegram-бота:
 * откуда взяты токен/chat_id (env или настройки сайта), значения замаскированы,
 * токен проверен вызовом getMe. Помогает понять, почему уведомления не доходят.
 */
export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_settings")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  try {
    const diag = await diagnoseTelegram();
    return NextResponse.json(diag);
  } catch (error: any) {
    console.error("Telegram diagnostics error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка диагностики" },
      { status: 500 }
    );
  }
}

export async function POST() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_settings")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  try {
    const result = await sendTelegramNotification(
      "✅ <b>Тест уведомления</b>\nЕсли вы видите это сообщение — Telegram настроен верно.",
      "Тест Telegram (настройки)"
    );
    if (!result.ok) {
      // К ошибке прикладываем снимок конфигурации — видно, откуда бот
      // взял (или не взял) токен и chat_id.
      const diag = await diagnoseTelegram().catch(() => null);
      return NextResponse.json(
        { ok: false, error: result.error, detail: result.detail, diag },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Test telegram error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Ошибка сервера" },
      { status: 500 }
    );
  }
}
