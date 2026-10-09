// =========================================================
// FILE: tests/ts-resolver-hooks.mjs
// Хуки resolve для node:test:
//   • «@/lib/...» → <repo>/src/lib/...
//   • относительный импорт без расширения → добавляем .ts
// Нужны, чтобы тесты могли импортировать TS-модули src/lib так же,
// как это делает Next.js (см. tests/ts-register.mjs).
// =========================================================

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_BASE = pathToFileURL(resolvePath(repoRoot, "src")).href + "/";

/** Расширения, которые Node резолвит сам — их не трогаем. */
const KNOWN_EXT = /\.(ts|mts|cts|js|mjs|cjs|json|node|wasm)$/i;

function toUrl(specifier, parentURL) {
  if (specifier.startsWith("@/")) return new URL(specifier.slice(2), SRC_BASE).href;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return parentURL ? new URL(specifier, parentURL).href : null;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // «server-only» — служебный пакет Next.js, в установке сайта его нет.
  // Для тестов подставляем пустой модуль, чтобы можно было импортировать
  // серверные либы (client-bank-exchange.ts) напрямую.
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export {};", shortCircuit: true };
  }

  const rewritten = toUrl(specifier, context.parentURL);

  if (rewritten) {
    if (KNOWN_EXT.test(rewritten)) return nextResolve(rewritten, context);
    // Без расширения: пробуем .ts / .mts / /index.ts.
    // Важно проверять именно список расширений: модуль «payment-purpose»
    // оканчивается на «-purpose», и наивная проверка «есть ли точка в имени»
    // приняла бы «.purpose» за расширение и не добавила бы .ts.
    for (const ext of [".ts", ".mts", "/index.ts"]) {
      const candidate = rewritten + ext;
      try {
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(candidate, context);
        }
      } catch {
        // не путь в файловой системе — пробуем следующий вариант
      }
    }
    return nextResolve(rewritten, context);
  }

  // Bare-импорт («next/server»): Node требует точный путь, а пакет Next.js
  // экспортирует «next/server.js». Пробуем обычный resolve, при неудаче —
  // с добавлением .js.
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      !specifier.startsWith("node:") &&
      !specifier.startsWith(".") &&
      error?.code === "ERR_MODULE_NOT_FOUND"
    ) {
      try {
        return await nextResolve(`${specifier}.js`, context);
      } catch {
        // не угадали — отдаём исходную ошибку
      }
    }
    throw error;
  }
}
