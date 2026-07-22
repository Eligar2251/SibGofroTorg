// =========================================================
// src/lib/supabase.ts
// Клиент Supabase — бесплатный тариф, только DB (без Storage/Functions)
// =========================================================
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("[Supabase] SUPABASE_URL или SUPABASE_ANON_KEY не заданы. Клиент не инициализирован.");
}

/** Публичный клиент для чтения (RLS-ограниченный) и аутентифицированных вставок.
 * Без Service Role Key — только anon, чтобы не обходить RLS. */
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
