// =========================================================
// FILE: src/lib/supabase-browser-stub.ts
// Безопасная клиентская заглушка без модулей Node.js (node:fs / node:path).
// Используется бандлером браузера только если клиентский компонент
// импортирует общие типы/утилиты из модуля, где также импортирован supabase.ts.
// =========================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DbBackendMode } from "./db-runtime-config-types";

export function createDirectSupabaseClient(
  url: string,
  key: string
): SupabaseClient {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isRemoteServerFailure(): boolean {
  return false;
}

export function getAdminDb(): SupabaseClient {
  throw new Error("getAdminDb() доступен только на сервере");
}

export function getPublicDb(): SupabaseClient {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getSupabaseUrl_pub(): string {
  return String(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
}

export function getSupabaseAnonKey_pub(): string {
  return String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
}

export function getActiveDatabaseConnectionInfo(): {
  configuredMode: DbBackendMode;
  effectiveMode: DbBackendMode;
  label: string;
  url: string;
  serviceRoleKey: string;
} {
  return {
    configuredMode: "primary",
    effectiveMode: "primary",
    label: "Supabase",
    url: "",
    serviceRoleKey: "",
  };
}

export async function probeDatabaseBackend(target: DbBackendMode) {
  return {
    target,
    label: String(target),
    configured: false,
    reachable: false,
    latencyMs: null,
    productsCount: null,
    error: "Client environment",
  };
}
