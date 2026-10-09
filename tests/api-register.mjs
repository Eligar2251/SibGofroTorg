// Регистрация хуков для сквозного теста API-роутов (см. stubs/db-auth-hooks.mjs
// и tests/ts-resolver-hooks.mjs).
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const opts = { parentURL: pathToFileURL("./tests/").href };
register("./ts-resolver-hooks.mjs", opts);
register("./stubs/db-auth-hooks.mjs", opts);
