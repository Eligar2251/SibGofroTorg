// =========================================================
// FILE: tests/api-prices-register.mjs
// Регистрация хуков для теста массового сохранения цен:
// ts-resolver-hooks (импорты «@/...» и расширения) + подмена
// @/lib/auth, @/lib/supabase и next/cache (tests/stubs/bulk-prices-hooks.mjs).
// =========================================================

import { register } from "node:module";
import { pathToFileURL } from "node:url";

const opts = { parentURL: pathToFileURL("./tests/").href };
register("./ts-resolver-hooks.mjs", opts);
register("./stubs/bulk-prices-hooks.mjs", opts);
