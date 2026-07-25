// =========================================================
// FILE: src/lib/notify.ts
// Надёжная отправка уведомлений в Telegram и MAX.
// — чанкует слишком длинные сообщения (лимит Telegram 4096
//   символов), иначе длинные заявки молча не доходят;
// — не падает при ошибке сети, но подробно логирует причину,
//   чтобы «пропавшие» уведомления было легко диагностировать.
// =========================================================

import { getSettings } from "./supabase-queries";

const TELEGRAM_LIMIT = 4000; // с запасом меньше лимита 4096
const MAX_LIMIT = 4000;

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

export interface NotifyResult {
  ok: boolean;
  error?: string;
  detail?: unknown;
}

export async function sendTelegramNotification(
  text: string
): Promise<NotifyResult> {
  try {
    const settings = await getSettings();
    const token =
      settings.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN;
    const chatId =
      settings.telegram_admin_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!token || !chatId) {
      console.warn(
        "[notify] Telegram не настроен: нет TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID"
      );
      return {
        ok: false,
        error:
          "Telegram не настроен: не заданы TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID",
      };
    }
    const parts = chunkText(text, TELEGRAM_LIMIT);
    for (let i = 0; i < parts.length; i++) {
      const body = JSON.stringify({
        chat_id: chatId,
        text:
          parts.length > 1
            ? `${parts[i]}\n\n(часть ${i + 1}/${parts.length})`
            : parts[i],
        parse_mode: "HTML",
      });
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(
          "[notify] Telegram error:",
          data?.description || res.status,
          data
        );
        return {
          ok: false,
          error: data?.description || `HTTP ${res.status}`,
          detail: data,
        };
      }
    }
    console.log(`[notify] Telegram OK (${parts.length} част.)`);
    return { ok: true };
  } catch (err) {
    console.error("[notify] Telegram exception:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Ошибка отправки",
    };
  }
}

export async function sendMaxNotification(text: string): Promise<NotifyResult> {
  try {
    const settings = await getSettings();
    const token = settings.max_bot_token || process.env.MAX_BOT_TOKEN;
    const chatId = settings.max_admin_chat_id || process.env.MAX_ADMIN_CHAT_ID;
    if (!token || !chatId) {
      console.warn("[notify] MAX не настроен");
      return { ok: false, error: "MAX не настроен" };
    }
    const plain = String(text).replace(/<[^>]*>/g, "");
    const parts = chunkText(plain, MAX_LIMIT);
    for (const part of parts) {
      const res = await fetch(
        `https://botapi.max.ru/messages?access_token=${token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: part }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[notify] MAX error:", res.status, data);
        return { ok: false, error: `HTTP ${res.status}`, detail: data };
      }
    }
    console.log("[notify] MAX OK");
    return { ok: true };
  } catch (err) {
    console.error("[notify] MAX exception:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Ошибка отправки",
    };
  }
}

/** Отправить во все настроенные каналы (Telegram + MAX) параллельно. */
export async function sendAdminNotifications(
  htmlText: string
): Promise<{ telegram: NotifyResult; max: NotifyResult }> {
  const [telegram, max] = await Promise.all([
    sendTelegramNotification(htmlText),
    sendMaxNotification(htmlText),
  ]);
  return { telegram, max };
}
