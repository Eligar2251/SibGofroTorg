// =========================================================
// FILE: src/lib/notify.ts
// Отправка уведомлений о заявках в MAX.
//
// Telegram УБРАН полностью и намеренно:
//   • с серверов в РФ api.telegram.org недоступен, работать это могло
//     только через зарубежный релей;
//   • а релей означал бы отправку имён и телефонов клиентов за границу —
//     трансграничную передачу персональных данных, которую по ст. 12 152-ФЗ
//     надо отдельно уведомлять в РКН.
// MAX (botapi.max.ru) — российский сервис, работает из РФ напрямую.
//
// — чанкует слишком длинные сообщения (лимит 4000),
//   иначе длинные заявки молча не доходят;
// — таймауты на все запросы, чтобы сеть не вешала оформление заказа;
// — не падает при ошибке сети, но подробно логирует причину,
//   чтобы «пропавшие» уведомления было легко диагностировать;
// — ключи берутся ПРЕЖДЕ всего из переменных окружения (process.env),
//   а getSettings() используется только как необязательный fallback.
//   Это критично: getSettings() использует unstable_cache и при вызове
//   вне контекста запроса (fire-and-forget уведомления) может упасть.
// =========================================================

import { getSettings } from "./supabase-queries";

const MAX_LIMIT = 4000;
const FETCH_TIMEOUT_MS = 15_000;

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

/** fetch с таймаутом: недоступный сервис не должен вешать запросы. */
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

// ── Журнал последних отправок ────────────────────────────
// Хранится в памяти процесса (до перезапуска контейнера) — этого
// достаточно, чтобы в админке быстро увидеть, УШЛО ли уведомление
// и почему нет.
export interface NotifyLogEntry {
  at: string;
  channel: "max";
  label: string;
  ok: boolean;
  error?: string;
}
const NOTIFY_LOG_LIMIT = 30;
const notifyLog: NotifyLogEntry[] = [];

function pushNotifyLog(channel: "max", label: string, result: NotifyResult) {
  notifyLog.push({
    at: new Date().toISOString(),
    channel,
    label: label || "—",
    ok: result.ok,
    error: result.ok ? undefined : String(result.error || "Ошибка"),
  });
  if (notifyLog.length > NOTIFY_LOG_LIMIT) {
    notifyLog.splice(0, notifyLog.length - NOTIFY_LOG_LIMIT);
  }
}

/** Последние отправки (новые сверху). */
export function getNotificationLog(): NotifyLogEntry[] {
  return [...notifyLog].reverse();
}

// ── MAX ──────────────────────────────────────────────────
// Официальный Bot API: POST {host}/messages?chat_id={id}
// (или ?user_id={id} для личных чатов), токен — в заголовке
// Authorization. Хосты пробуем по очереди.
//
// ВАЖНО (2026): MAX переехал на platform-api2.max.ru — старый
// platform-api.max.ru отключён после 19.07.2026, поэтому он
// только в конце списка как запасной. Авторизация в документации
// описана неоднозначно: где-то «Authorization: <токен>», где-то
// «Authorization: Bearer <токен>» — пробуем оба варианта.
// TLS-цепочка *.max.ru может быть подписана корневым сертификатом
// Минцифры: если Node его не знает, нужна NODE_EXTRA_CA_CERTS.

const MAX_HOSTS = [
  "https://botapi.max.ru",
  "https://platform-api2.max.ru",
  "https://platform-api.max.ru",
];

function tlsHint(msg: string): string {
  return /certificate|cert\b|tls|ssl/i.test(msg)
    ? " (TLS: среда не доверяет корневому сертификату Минцифры — задайте NODE_EXTRA_CA_CERTS на сервере)"
    : "";
}

export async function sendMaxNotification(
  text: string,
  label = ""
): Promise<NotifyResult> {
  try {
    const token = env("MAX_BOT_TOKEN") || (await setting("max_bot_token"));
    const chatId =
      env("MAX_ADMIN_CHAT_ID") || (await setting("max_admin_chat_id"));
    if (!token || !chatId) {
      console.warn("[notify] MAX не настроен");
      const r = { ok: false, error: "MAX не настроен" };
      pushNotifyLog("max", label, r);
      return r;
    }
    const plain = String(text).replace(/<[^>]*>/g, "");
    const parts = chunkText(plain, MAX_LIMIT);
    const errors: string[] = [];
    let workingHost: string | null = null;
    let workingAuth: string | null = null;

    // Два варианта заголовка авторизации — см. комментарий выше.
    const authVariants = [token, `Bearer ${token}`];

    for (const part of parts) {
      let sent = false;
      const hosts: string[] = workingHost
        ? [workingHost, ...MAX_HOSTS.filter((h) => h !== workingHost)]
        : MAX_HOSTS;
      outer: for (const host of hosts) {
        const auths: string[] = workingAuth
          ? [workingAuth, ...authVariants.filter((v) => v !== workingAuth)]
          : authVariants;
        for (const authHeader of auths) {
          // chat_id и user_id — разные адресаты в MAX; пробуем оба.
          for (const paramName of ["chat_id", "user_id"]) {
            try {
              const res = await fetchWithTimeout(
                `${host}/messages?${paramName}=${encodeURIComponent(chatId)}`,
                {
                  method: "POST",
                  headers: {
                    Authorization: authHeader,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ text: part }),
                }
              );
              const data = await res.json().catch(() => ({} as any));
              if (res.ok) {
                workingHost = host;
                workingAuth = authHeader;
                sent = true;
                break outer;
              }
              const reason =
                data?.message ||
                data?.description ||
                data?.code ||
                `HTTP ${res.status}`;
              errors.push(`${host}?${paramName}: ${reason}`);
              console.error("[notify] MAX error:", res.status, data);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Сетевая ошибка";
              errors.push(`${host}?${paramName}: ${msg}${tlsHint(msg)}`);
              console.error(`[notify] MAX ${host} недоступен:`, msg);
            }
          }
        }
      }
      if (!sent) {
        const r = {
          ok: false,
          error: `MAX: не удалось отправить (${errors.join("; ")})`,
          detail: errors,
        };
        pushNotifyLog("max", label, r);
        return r;
      }
    }
    console.log(`[notify] MAX OK через ${workingHost}`);
    const r = { ok: true };
    pushNotifyLog("max", label, r);
    return r;
  } catch (err) {
    console.error("[notify] MAX exception:", err);
    const r = {
      ok: false,
      error: err instanceof Error ? err.message : "Ошибка отправки",
    };
    pushNotifyLog("max", label, r);
    return r;
  }
}

/**
 * Отправить уведомление во все настроенные каналы.
 * Сейчас канал один — MAX. Функция оставлена как единая точка вызова:
 * если появится ещё один канал, менять места вызова не придётся.
 */
export async function sendAdminNotifications(
  htmlText: string,
  label = ""
): Promise<{ max: NotifyResult }> {
  const max = await sendMaxNotification(htmlText, label);
  if (!max.ok) {
    console.error(`[notify] Уведомление НЕ доставлено. MAX: ${max.error}`);
  }
  return { max };
}
