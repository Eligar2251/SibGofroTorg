// =========================================================
// FILE: tests/ts-register.mjs
// Резолвер для запуска TS-модулей из node:test.
//
// Зачем: в проекте импорты внутри src/lib пишутся без расширения
// («./payment-purpose») — так их resolve'ит Next.js/бандлер. Node в режиме
// --experimental-strip-types требует точный путь, поэтому добавляем
// недостающее .ts/.mts на этапе resolve. Используется скриптами
// `npm run test` / `test:payments` / `test:variants`.
// =========================================================

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolver-hooks.mjs", { parentURL: pathToFileURL("./tests/").href });
