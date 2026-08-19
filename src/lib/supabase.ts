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
 * fetch для серверного Supabase-клиента с защитой от типовых проблем прода:
 *
 * 1) Next.js патчит глобальный fetch (кэш + дедупликация RSC), из-за чего
 *    параллельные Supabase-запросы могут падать с «TypeError: fetch failed».
 *    Здесь явно ставим cache:'no-store' и работаем с обычным undici-fetch.
 *
 * 2) В РФ-сетях соединения к *.supabase.co бывают нестабильны (ТСПУ,
 *    IPv6-сбои контейнера) — идемпотентные GET-запросы повторяем с
 *    короткой паузой. Записи (POST/PATCH/DELETE) не повторяем, чтобы не
 *    задвоить операцию, если сервер уже применил её до обрыва.
 *
 * 3) Ограничиваем время ожидания, чтобы зависший запрос не блокировал
 *    страницу бесконечно (вместо этого вернётся ошибка, которую вызов
 *    уже обработает или залогирует).
 */
async function supabaseFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const method = String(init?.method || "GET").toUpperCase();
  // Повторять безопасно только чтение — операции с данными не идемпотентны.
  const attempts = method === "GET" || method === "HEAD" ? 3 : 1;
  const timeoutMs = 30_000;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || attempt === attempts) break;
      // Пауза перед повтором, растущая с каждой попыткой (150/300 мс).
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    } finally {
      clearTimeout(timer);
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
