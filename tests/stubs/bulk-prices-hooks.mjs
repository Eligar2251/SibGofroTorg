// =========================================================
// FILE: tests/stubs/bulk-prices-hooks.mjs
// Load-хуки для сквозного теста массового сохранения цен:
//   @/lib/auth   → «всегда залогинен владельцем» (stub-auth.ts);
//   @/lib/supabase → in-memory база (stub-supabase.ts);
//   next/cache   → заглушки revalidateTag/revalidatePath.
// См. tests/api-bulk-prices.test.mjs
// =========================================================

const STUB_SUPABASE = new URL("./stub-supabase.ts", import.meta.url).href;

const STUBS = {
  "@/lib/auth": new URL("./stub-auth.ts", import.meta.url).href,
  "@/lib/supabase": STUB_SUPABASE,
  "next/cache": new URL("./next-cache-stub.ts", import.meta.url).href,
};

/** Модули src/lib импортируют друг друга относительно («./supabase»):
 *  такую ссылку тоже надо привести к двойнику, иначе журнал действий
 *  уйдёт в настоящий клиент Supabase. */
const RELATIVE_SUPABASE = new Set(["./supabase", "../supabase", "./supabase.ts"]);

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) return nextResolve(STUBS[specifier], context);
  if (RELATIVE_SUPABASE.has(specifier) && String(context.parentURL || "").includes("/src/lib/")) {
    return nextResolve(STUB_SUPABASE, context);
  }
  return nextResolve(specifier, context);
}
