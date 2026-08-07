// =========================================================
// FILE: src/lib/notify.ts
// Надёжная отправка уведомлений в Telegram и MAX.
//
// ВАЖНО ПРО БЛОКИРОВКИ (2026): с серверов в РФ ТСПУ дропает
// пакеты к api.telegram.org — напрямую Telegram отсюда не
// отправляется. Поэтому адрес Telegram API настраивается
// (TELEGRAM_API_BASE / настройка telegram_api_base): туда можно
// вписать РЕЛЕЙ — зарубежный VPS/Cloudflare Worker, который
// проксирует api.telegram.org. Поддерживается несколько адресов
// через запятую — пробуем по очереди, пока не сработает.
// MAX (botapi.max.ru) работает из РФ без ограничений и служит
// запасным каналом.
//
// — чанкует слишком длинные сообщения (лимиты 4096/4000),
//   иначе длинные заявки молча не доходят;
// — таймауты на все запросы, чтобы блокировки не вешали заказы;
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
const FETCH_TIMEOUT_MS = 15_000;

const DEFAULT_TELEGRAM_BASE = "https://api.telegram.org";

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

/** fetch с таймаутом: блокировки/релеи не должны вешать запросы. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
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
 * Список адресов Telegram Bot API в порядке приоритета.
 * Свои ретрансляторы (релеи) задаются через TELEGRAM_API_BASE (env)
 * или настройку telegram_api_base — можно несколько через запятую.
 * Официальный api.telegram.org всегда добавляется последним.
 */
export async function telegramApiBases(): Promise<string[]> {
  const raw = env("TELEGRAM_API_BASE") || (await setting("telegram_api_base"));
  const bases: string[] = [];
  if (raw) {
    for (const part of raw.split(",")) {
      let v = part.trim().replace(/\/+$/, "");
      if (!v) continue;
      if (!/^https?:\/\//.test(v)) v = `https://${v}`;
      if (!bases.includes(v)) bases.push(v);
    }
  }
  if (!bases.includes(DEFAULT_TELEGRAM_BASE)) bases.push(DEFAULT_TELEGRAM_BASE);
  return bases;
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
  return /^\+[0-9()\-]+$/.test(chatId.trim());
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
  apiBases: string[];
  getMe?: {
    ok: boolean;
    username?: string | null;
    error?: string;
    base?: string;
  };
}

/**
 * Диагностика подключения: показывает, ОТКУДА взяты токен/chat_id
 * (env или настройки), не светя их целиком, какие адреса API будут
 * пробоваться, и проверяет токен вызовом getMe через каждый адрес.
 */
export async function diagnoseTelegram(): Promise<TelegramDiagnostics> {
  const cfg = await resolveTelegramConfig();
  const bases = await telegramApiBases();
  const diag: TelegramDiagnostics = {
    configured: Boolean(cfg.token && cfg.chatId),
    tokenSource: cfg.tokenSource,
    chatIdSource: cfg.chatIdSource,
    tokenMasked: mask(cfg.token),
    chatIdMasked: mask(cfg.chatId),
    chatIdNormalized: cfg.chatId ? normalizeTelegramChatId(cfg.chatId) : null,
    apiBases: bases,
  };
  if (!cfg.token) return diag;

  // getMe пробуем по каждому адресу: так видно, какой релей живой,
  // а какой заблокирован/не отвечает.
  let lastError = "";
  for (const base of bases) {
    try {
      const res = await fetchWithTimeout(`${base}/bot${cfg.token}/getMe`, {
        method: "GET",
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok && data?.ok) {
        diag.getMe = {
          ok: true,
          username: data.result?.username ?? null,
          base,
        };
        return diag;
      }
      lastError = data?.description || `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Сетевая ошибка";
    }
  }
  diag.getMe = { ok: false, error: lastError };
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
    const bases = await telegramApiBases();
    const parts = chunkText(text, TELEGRAM_LIMIT);

    let workingBase: string | null = null;
    const errors: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const body = JSON.stringify({
        chat_id: normalizedChatId,
        text:
          parts.length > 1
            ? `${parts[i]}\n\n(часть ${i + 1}/${parts.length})`
            : parts[i],
        parse_mode: "HTML",
      });

      // Сначала адрес, который уже сработал на предыдущей части,
      // затем остальные по списку.
      const preferred: string | null = workingBase;
      const order: string[] = preferred
        ? [preferred, ...bases.filter((b) => b !== preferred)]
        : bases;

      let sent = false;
      for (const base of order) {
        try {
          const res = await fetchWithTimeout(`${base}/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.ok !== false) {
            workingBase = base;
            sent = true;
            break;
          }
          const reason = data?.description || `HTTP ${res.status}`;
          errors.push(`${base}: ${reason}`);
          console.error(`[notify] Telegram ${base}:`, reason, data);
          // 4xx уровня токена/чата нет смысла гонять по другим адресам —
          // ошибка одна и та же. Прерываем перебор баз.
          if (
            res.status === 400 ||
            res.status === 401 ||
            res.status === 403
          ) {
            return {
              ok: false,
              error: reason,
              detail: data,
            };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Сетевая ошибка";
          errors.push(`${base}: ${msg}`);
          console.error(`[notify] Telegram ${base} недоступен:`, msg);
        }
      }
      if (!sent) {
        return {
          ok: false,
          error:
            "Не удалось отправить ни через один адрес Telegram API: " +
            errors.join("; ") +
            ". Если сервер в РФ — api.telegram.org заблокирован ТСПУ: укажите релей в TELEGRAM_API_BASE (настройки сайта → Telegram API) или настройте MAX.",
          detail: errors,
        };
      }
    }
    console.log(
      `[notify] Telegram OK (${parts.length} част.) через ${workingBase}`
    );
    return { ok: true };
  } catch (err) {
    console.error("[notify] Telegram exception:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Ошибка отправки",
    };
  }
}

// ── MAX ──────────────────────────────────────────────────
// Официальный Bot API: POST {host}/messages?chat_id={id}
// (или ?user_id={id} для личных чатов), токен — в заголовке
// Authorization; access_token в query больше не поддерживается.
// Хосты пробуем по очереди: botapi.max.ru и platform-api.max.ru.

const MAX_HOSTS = ["https://botapi.max.ru", "https://platform-api.max.ru"];

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
    const errors: string[] = [];

    for (const part of parts) {
      let sent = false;
      // chat_id и user_id — разные адресаты в MAX; пробуем оба варианта.
      const paramNames = ["chat_id", "user_id"];
      outer: for (const host of MAX_HOSTS) {
        for (const paramName of paramNames) {
          try {
            const res = await fetchWithTimeout(
              `${host}/messages?${paramName}=${encodeURIComponent(chatId)}`,
              {
                method: "POST",
                headers: {
                  Authorization: token,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ text: part }),
              }
            );
            if (res.ok) {
              sent = true;
              break outer;
            }
            const data = await res.json().catch(() => ({}));
            errors.push(`${host}?${paramName}: HTTP ${res.status}`);
            console.error("[notify] MAX error:", res.status, data);
          } catch (err) {
            errors.push(
              `${host}?${paramName}: ${err instanceof Error ? err.message : "Сетевая ошибка"}`
            );
          }
        }
      }
      if (!sent) {
        return {
          ok: false,
          error: `MAX: не удалось отправить (${errors.join("; ")})`,
          detail: errors,
        };
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
  if (!telegram.ok && !max.ok) {
    console.error(
      `[notify] Уведомление НЕ доставлено ни в один канал. TG: ${telegram.error}; MAX: ${max.error}`
    );
  }
  return { telegram, max };
}
