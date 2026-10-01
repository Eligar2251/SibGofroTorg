// =========================================================
// FILE: src/lib/supabase.ts
// Singleton-клиент Supabase для серверных (Admin/RSC) запросов.
// Использует service_role key → обходит RLS (как firebase-admin).
// =========================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

// Во время `next build` статические страницы пререндерятся с запросами в БД.
// Если Supabase из сети сборщика (Timeweb, РФ) отвечает медленно или пакеты
// теряются, fetch без таймаута висит минутами: Next ждёт 60 с на страницу,
// повторяет 3 раза — деплой растягивается на 30+ минут и падает.
// Поэтому все запросы клиента ограничены по времени; при таймауте функции
// данных уже отдают fallback, а ISR (revalidate) подтянет свежие данные в рантайме.
const IS_BUILD = process.env.NEXT_PHASE === "phase-production-build";
const DB_TIMEOUT_MS = Number(
  process.env.SUPABASE_FETCH_TIMEOUT_MS || (IS_BUILD ? 8000 : 20000)
);

// Предохранитель для сборки: после первого сетевого сбоя остальные запросы
// в этом процессе сразу отдают ошибку, не ожидая таймаут повторно.
let buildDbUnavailable = false;

const fetchWithTimeout: typeof fetch = async (input, init) => {
  if (IS_BUILD && buildDbUnavailable) {
    throw new Error("Supabase недоступен во время сборки — используем fallback");
  }
  const timeout = AbortSignal.timeout(DB_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (IS_BUILD && !init?.signal?.aborted) {
      buildDbUnavailable = true;
      console.warn("[supabase] БД недоступна во время сборки, страницы соберутся с fallback и обновятся через ISR");
    }
    throw error;
  }
};

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

/** Серверный клиент с правами service_role (обходит RLS) */
export function getAdminDb(): SupabaseClient {
  if (!_client) {
    _client = createClient(getSupabaseUrl(), getSupabaseServiceKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchWithTimeout },
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
