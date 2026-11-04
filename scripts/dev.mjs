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
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const memory = Number(process.env.SGT_DEV_MEMORY) || 8192;
const existing = process.env.NODE_OPTIONS || "";

// Если размер кучи уже задан снаружи — уважаем выбор разработчика.
const nodeOptions = /--max-old-space-size/.test(existing)
  ? existing
  : `${existing} --max-old-space-size=${memory}`.trim();

const nextBin = require.resolve("next/dist/bin/next");

// npm run dev runs the site itself on this PC; there is no separate DB server.
// The local-file features must never be accidentally exposed on a network host.
const localPc = process.env.SGT_PC_LOCAL_SERVER !== "0";
const args = process.argv.slice(2);
if (localPc) {
  for (let i=0;i<args.length;i++) {
    const arg=args[i];
    const host=arg === "-H" || arg === "--hostname" ? args[++i] : arg.startsWith("--hostname=") ? arg.slice(11) : arg.startsWith("-H=") ? arg.slice(3) : arg.startsWith("-H") && arg.length>2 ? arg.slice(2) : undefined;
    if (host !== undefined && !["localhost","127.0.0.1","::1"].includes(host)) {
      console.error("Локальный режим хранит данные ПК и разрешает только localhost. Для обычного сетевого dev используйте dev:plain.");
      process.exit(1);
    }
  }
}
const pcHome=process.env.SGT_PC_CONFIG_DIR || path.join(os.homedir(),".sibgofrotorg-pc");
const env = localPc ? {...process.env, NODE_OPTIONS:nodeOptions, SGT_PC_LOCAL_SERVER:"1", SGT_PC_CONFIG_DIR:pcHome, SGT_DATA_DIR:path.join(pcHome,"runtime"), HOSTNAME:"127.0.0.1"} : {...process.env,NODE_OPTIONS:nodeOptions,SGT_PC_LOCAL_SERVER:"0"};
const child = spawn(process.execPath, [nextBin, "dev", ...(localPc ? ["-H","127.0.0.1"] : []), ...args], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
