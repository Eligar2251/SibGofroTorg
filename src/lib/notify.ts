// =========================================================
// FILE: src/lib/notify.ts
// Надёжная отправка уведомлений в Telegram и MAX.
// — чанкует слишком длинные сообщения (лимит Telegram 4096
//   символов), иначе длинные заявки молча не доходят;
// — не падает при ошибке сети, но подробно логирует причину,
//   чтобы «пропавшие» уведомления было легко диагностировать.
// — ключи берутся ПРЕЖДЕ всего из переменных окружения
//   (process.env), а getSettings() используется только как
//   необязательный fallback. Это критично: getSettings()
//   использует unstable_cache и при вызове вне контекста
//   запроса (fire-and-forget уведомления) может упасть, из-за
//   чего сообщение молча не отправлялось бы.
// =========================================================

import { getSettings } from "./supabase-queries";

const TELEGRAM_LIMIT = 4000; // с запасом меньше лимита 4096
const MAX_LIMIT = 4000;

/**
 * Чтение переменной окружения через скобочную нотацию.
 * Это гарантирует runtime-доступ к process.env даже если сборщик
 * (Next.js) попытался бы статически подставить/inline значение.
 */
function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

/** Безопасное чтение настройки из БД. Никогда не бросает. */
async function setting(key: string): Promise<string | undefined> {
  try {
    const settings = await getSettings();
    const v = settings?.[key];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  } catch (err) {
    console.error(`[notify] getSettings() не доступен (${key}):`, err);
    return undefined;
  }
}

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

type SettingSource = "env" | "settings" | "none";

export interface TelegramConfig {
  token?: string;
  chatId?: string;
  tokenSource: SettingSource;
  chatIdSource: SettingSource;
}

/** Разрешает конфиг Telegram: env имеет приоритет, настройки из БД — fallback. */
export async function resolveTelegramConfig(): Promise<TelegramConfig> {
  const envToken = env("TELEGRAM_BOT_TOKEN");
  const envChatId = env("TELEGRAM_ADMIN_CHAT_ID");
  let tokenSource: SettingSource = envToken ? "env" : "none";
  let chatIdSource: SettingSource = envChatId ? "env" : "none";
  let token = envToken;
  let chatId = envChatId;
  if (!token) {
    const s = await setting("telegram_bot_token");
    if (s) {
      token = s;
      tokenSource = "settings";
    }
  }
  if (!chatId) {
    const s = await setting("telegram_admin_chat_id");
    if (s) {
      chatId = s;
      chatIdSource = "settings";
    }
  }
  return { token, chatId, tokenSource, chatIdSource };
}

/**
 * Приводит chat_id к рабочему виду: username канала/группы без «@»
 * дополняем префиксом (иначе Telegram отвечает «chat not found»),
 * номера телефонов API не принимает вовсе — об этом явно говорим.
 */
export function normalizeTelegramChatId(raw: string): string {
  const v = String(raw || "").trim().replace(/\s+/g, "");
  if (!v) return v;
  // Числовой id (пользователь/группа) или уже с @ — оставляем как есть.
  if (/^-?\d+$/.test(v) || v.startsWith("@")) return v;
  return `@${v}`;
}

/** chat_id в виде +79… — это номер телефона: Telegram таких адресатов не знает. */
function looksLikePhoneNumber(chatId: string): boolean {
  return /^\+[0-9()\-\s]+$/.test(chatId.trim());
}

function mask(value: string | undefined, visible = 4): string | null {
  if (!value) return null;
  const v = String(value);
  if (v.length <= visible * 2) return `${v.slice(0, 2)}…${v.slice(-2)}`;
  return `${v.slice(0, visible)}…${v.slice(-visible)}`;
}

export interface TelegramDiagnostics {
  configured: boolean;
  tokenSource: SettingSource;
  chatIdSource: SettingSource;
  tokenMasked: string | null;
  chatIdMasked: string | null;
  chatIdNormalized: string | null;
  getMe?: { ok: boolean; username?: string | null; error?: string };
}

/**
 * Диагностика подключения: показывает, ОТКУДА взяты токен/chat_id
 * (env или настройки), не светя их целиком, и проверяет токен вызовом getMe.
 */
export async function diagnoseTelegram(): Promise<TelegramDiagnostics> {
  const cfg = await resolveTelegramConfig();
  const diag: TelegramDiagnostics = {
    configured: Boolean(cfg.token && cfg.chatId),
    tokenSource: cfg.tokenSource,
    chatIdSource: cfg.chatIdSource,
    tokenMasked: mask(cfg.token),
    chatIdMasked: mask(cfg.chatId),
    chatIdNormalized: cfg.chatId ? normalizeTelegramChatId(cfg.chatId) : null,
  };
  if (!cfg.token) return diag;
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/getMe`, {
      method: "GET",
    });
    const data = await res.json().catch(() => ({} as any));
    if (res.ok && data?.ok) {
      diag.getMe = { ok: true, username: data.result?.username ?? null };
    } else {
      diag.getMe = {
        ok: false,
        error: data?.description || `HTTP ${res.status}`,
      };
    }
  } catch (err) {
    diag.getMe = {
      ok: false,
      error: err instanceof Error ? err.message : "Сетевая ошибка",
    };
  }
  return diag;
}

export async function sendTelegramNotification(
  text: string
): Promise<NotifyResult> {
  try {
    const cfg = await resolveTelegramConfig();
    const { token, chatId } = cfg;
    if (!token || !chatId) {
      console.warn(
        `[notify] Telegram не настроен: token=${cfg.tokenSource}, chatId=${cfg.chatIdSource} (нет ни в env, ни в настройках сайта)`
      );
      return {
        ok: false,
        error:
          "Telegram не настроен: не заданы TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID (ни в переменных окружения, ни в настройках сайта)",
      };
    }
    if (looksLikePhoneNumber(chatId)) {
      console.error("[notify] TELEGRAM_ADMIN_CHAT_ID похож на номер телефона — Telegram требует числовой chat_id или @username");
      return {
        ok: false,
        error:
          "TELEGRAM_ADMIN_CHAT_ID выглядит как номер телефона. Укажите числовой chat_id (его сообщит бот @userinfobot / @getmyid_bot) или @username канала/группы.",
      };
    }
    const normalizedChatId = normalizeTelegramChatId(chatId);
    const parts = chunkText(text, TELEGRAM_LIMIT);
    for (let i = 0; i < parts.length; i++) {
      const body = JSON.stringify({
        chat_id: normalizedChatId,
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
    const token = env("MAX_BOT_TOKEN") || (await setting("max_bot_token"));
    const chatId =
      env("MAX_ADMIN_CHAT_ID") || (await setting("max_admin_chat_id"));
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
