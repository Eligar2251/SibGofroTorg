// =========================================================
// FILE: scripts/dev.mjs
// Запуск dev-сервера с увеличенной кучей Node.
//
// ЗАЧЕМ
// Страница «Учёт» — очень крупный модуль, и Turbopack компилирует её в
// отдельном воркере. Воркеру достаётся куча по умолчанию (на Windows это
// ~2 ГБ и меньше), из-за чего сборка падала с
// «FATAL ERROR: JavaScript heap out of memory» и
// «Jest worker encountered 2 child process exceptions».
//
// Флаг задаётся именно через переменную окружения NODE_OPTIONS, а не
// аргументом командной строки: дочерние процессы (воркеры Next)
// наследуют переменные окружения, а флаги родителя — нет.
//
// Кроссплатформенно и без лишних зависимостей вроде cross-env.
// Размер кучи можно переопределить: SGT_DEV_MEMORY=12288 pnpm dev
// =========================================================

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const memory = Number(process.env.SGT_DEV_MEMORY) || 8192;
const existing = process.env.NODE_OPTIONS || "";

// Если размер кучи уже задан снаружи — уважаем выбор разработчика.
const nodeOptions = /--max-old-space-size/.test(existing)
  ? existing
  : `${existing} --max-old-space-size=${memory}`.trim();

const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
