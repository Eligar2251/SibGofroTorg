import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { sendTelegramNotification } from "@/lib/notify";

export async function POST() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await sendTelegramNotification(
      "✅ <b>Тест уведомления</b>\nЕсли вы видите это сообщение — Telegram настроен верно."
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, detail: result.detail },
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
