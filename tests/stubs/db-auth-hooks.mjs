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
};

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) return nextResolve(STUBS[specifier], context);
  return nextResolve(specifier, context);
}
