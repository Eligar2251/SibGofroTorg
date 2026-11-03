// =========================================================
// FILE: tests/stubs/db-auth-hooks.mjs
// Load-хуки для сквозного теста API-роутов: подменяют «@/lib/auth»
// и «@/lib/supabase» на тестовые двойники, чтобы вызвать настоящие
// GET/POST из route.ts без Supabase и без админ-сессии.
// См. tests/api-payment-export.test.mjs
// =========================================================

const STUBS = {
  "@/lib/auth": new URL("./stub-auth.ts", import.meta.url).href,
  "@/lib/supabase": new URL("./stub-supabase.ts", import.meta.url).href,
  "next/cache": new URL("./next-cache-stub.ts", import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) return nextResolve(STUBS[specifier], context);
  if (
    (specifier === "./supabase" || specifier === "./supabase.ts") &&
    context.parentURL?.includes("/src/lib/")
  ) {
    return nextResolve(STUBS["@/lib/supabase"], context);
  }
  return nextResolve(specifier, context);
}
