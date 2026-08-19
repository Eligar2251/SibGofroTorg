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

/** Серверный клиент с правами service_role (обходит RLS) */
export function getAdminDb(): SupabaseClient {
  if (!_client) {
    _client = createClient(getSupabaseUrl(), getSupabaseServiceKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
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
