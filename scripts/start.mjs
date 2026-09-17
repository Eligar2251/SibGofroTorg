// =========================================================
// FILE: scripts/start.mjs
// Универсальная точка входа для продакшена.
//
// Работает одинаково в трёх окружениях, поэтому Timeweb может
// запускать что угодно — `pnpm start`, `node scripts/start.mjs`
// или CMD из Dockerfile — контейнер стартует без crash-loop:
//
//   1. Полная сборка + node_modules (локально, Cloudpack/Nixpacks):
//      `next start -H 0.0.0.0 -p $PORT`.
//   2. Nixpacks без полноценных зависимостей: standalone-сервер
//      по стандартному пути `.next/standalone/server.js`.
//   3. Docker-образ (standalone скопирован в корень /app): `server.js`.
//
// ВАЖНО: раньше `start` вызывал `node node_modules/next/dist/bin/next start`,
// чего нет в standalone-образе (CLI не входит в traced node_modules) —
// `pnpm start` падал с MODULE_NOT_FOUND и контейнер уходил в перезапуск.
// =========================================================

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const has = (p) => existsSync(path.join(root, p));

const port = process.env.PORT || "3000";
// Standalone-сервер Next слушает HOSTNAME из env (0.0.0.0 = все интерфейсы,
// иначе Timeweb не сможет сделать health-check).
process.env.HOSTNAME = process.env.HOSTNAME || "0.0.0.0";

/** @type {() => void} */
function execNode(args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : (code ?? 1));
  });
  child.on("error", (err) => {
    console.error("[start] Не удалось запустить сервер:", err?.message || err);
    process.exit(1);
  });
}

if (has(".next/standalone/server.js") && has(".next/standalone/.next/static")) {
  // Standalone-сервер со скопированными статик-ассетами — канонический
  // прод-запуск Next 16 (`next start` с output:'standalone' печатает warning).
  execNode([".next/standalone/server.js"]);
} else if (has("node_modules/next/dist/bin/next") && has(".next/BUILD_ID")) {
  // Полный прод-билд (например, локально после `pnpm build`) — next start.
  execNode(["node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", port]);
} else if (has(".next/standalone/server.js")) {
  execNode([".next/standalone/server.js"]);
} else if (has("server.js")) {
  // Flattened standalone-рантайм из Docker-образа (/app/server.js).
  execNode(["server.js"]);
} else {
  console.error(
    "[start] Не найден собранный сервер.\n" +
      "       Соберите проект перед запуском (`pnpm build`) либо используйте\n" +
      "       образ, собранный из Dockerfile — в нём сервер лежит в /app/server.js."
  );
  process.exit(1);
}
