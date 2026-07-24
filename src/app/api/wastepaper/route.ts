// src/app/api/wastepaper/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/supabase";
import { getSettings } from "@/lib/supabase-queries";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(`wastepaper:${clientIp(request)}`, 15, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Слишком много заявок. Попробуйте позже." },
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }

    const body = await request.json();
    const { customerName, customerPhone, wastepaperType, weight, deliveryMethod, estimatedPayout, comment } = body;

    if (!customerName || !customerPhone) {
      return NextResponse.json({ error: "Имя и телефон обязательны" }, { status: 400 });
    }

    const db = getAdminDb();
    const { data, error } = await db.from("wastepaper_requests").insert({
      customer_name: customerName,
      customer_phone: customerPhone,
      wastepaper_type: wastepaperType,
      weight: Number(weight || 0),
      delivery_method: deliveryMethod,
      estimated_payout: Number(estimatedPayout || 0),
      comment: comment || "",
      status: "new",
    }).select("id").single();
    if (error) throw error;

    const message = `<b>НОВАЯ ЗАЯВКА НА МАКУЛАТУРУ</b>
<b>Клиент:</b> ${customerName}
<b>Телефон:</b> ${customerPhone}

<b>Сырьё:</b> ${wastepaperType}
<b>Вес:</b> ${weight} кг
<b>Доставка:</b> ${deliveryMethod === "self" ? "Привезут сами на склад" : "Нужен наш вывоз"}
<b>Сумма выплаты:</b> ~${Number(estimatedPayout || 0).toLocaleString("ru-RU")} ₽

<b>Комментарий:</b> ${comment || "—"}`;

    const settings = await getSettings();
    const telegramToken = settings.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = settings.telegram_admin_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID;
    const maxToken = settings.max_bot_token || process.env.MAX_BOT_TOKEN;
    const maxChatId = settings.max_admin_chat_id || process.env.MAX_ADMIN_CHAT_ID;

    const promises: Promise<unknown>[] = [];
    if (telegramToken && telegramChatId) {
      promises.push(fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramChatId, text: message, parse_mode: "HTML" }),
      }));
    }
    if (maxToken && maxChatId) {
      promises.push(fetch(`https://botapi.max.ru/messages?access_token=${maxToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: maxChatId, text: message.replace(/<[^>]*>/g, "") }),
      }));
    }
    if (promises.length > 0) await Promise.allSettled(promises);

    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Wastepaper API Error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
