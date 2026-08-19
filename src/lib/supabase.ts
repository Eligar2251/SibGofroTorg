// =========================================================
// FILE: src/lib/supabase.ts
// Singleton-клиент Supabase для серверных (Admin/RSC) запросов.
// Использует service_role key → обходит RLS (как firebase-admin).
// =========================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL не задан в переменных окружения");
  return url;
}

function getSupabaseServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY не задан в переменных окружения");
  return key;
}

export function getSupabaseUrl_pub(): string {
  return process.env.SUPABASE_URL || "";
}

export function getSupabaseAnonKey_pub(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}

/** Похоже ли на временный сетевой сбой (а не на ответ 4xx/5xx). */
function isTransientFetchError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("enetunreach") ||
    message.includes("eai_again") ||
    message.includes("etimedout") ||
    message.includes("socket") ||
    message.includes("und_err") ||
    message.includes("aborted") ||
    message.includes("terminated")
  );
}

/**
 * fetch для серверного Supabase-клиента.
 *
 * 1) Next.js патчит глобальный fetch (кэш + дедупликация RSC) — явно
 *    ставим cache:'no-store', чтобы запросы шли напрямую и не
 *    дедуплицировались между параллельными вызовами.
 *
 * 2) Соединение с Supabase (CDN Cloudflare) в РФ-сетях бывает нестабильно
 *    (ТСПУ / IPv6) и может висеть до таймаута undici (~10с). Ограничиваем
 *    КАЖДУЮ попытку коротким таймаутом, чтобы при недоступности БД страницы
 *    не «висели» по 30+ секунд, а быстро отдавали фоллбек. GET повторяем
 *    один раз при явно временном сбое; записи (POST/PATCH/DELETE) не
 *    повторяем, чтобы не задвоить операцию.
 */
async function supabaseFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const method = String(init?.method || "GET").toUpperCase();
  // Повторять безопасно только чтение — операции с данными не идемпотентны.
  const attempts = method === "GET" || method === "HEAD" ? 2 : 1;
  const timeoutMs = 4_000;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    // Если вызывающий код передал свой signal — учитываем и его, и наш таймаут.
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    try {
      return await fetch(input, {
        ...init,
        cache: "no-store",
        signal,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw lastError;
}

/** Серверный клиент с правами service_role (обходит RLS) */
export function getAdminDb(): SupabaseClient {
  if (!_client) {
    _client = createClient(getSupabaseUrl(), getSupabaseServiceKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: supabaseFetch },
    });
  }
  return _client;
}

/** Публичный клиент (для browser components) */
export function getPublicDb(): SupabaseClient {
  return createClient(getSupabaseUrl_pub(), getSupabaseAnonKey_pub(), {
    auth: { autoRefreshToken: true, persistSession: true },
  });
}
