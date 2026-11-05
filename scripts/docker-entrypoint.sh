#!/bin/sh
# =========================================================
# FILE: scripts/docker-entrypoint.sh
# Универсальный вход контейнера. Timeweb Cloud умеет переопределять
# команду запуска приложения; независимо от того, что там написано
# (`pnpm start`, `node server.js`, `node .next/standalone/server.js`
# или пусто — дефолтный CMD), этот скрипт находит собранный сервер.
#
# Контейнер уходил в restart-loop, потому что:
#   - `node .next/standalone/server.js` не работает в этом образе
#     (standalone скопирован В КОРЕНЬ /app, файла по такому пути нет);
#   - `pnpm start` не работает, т.к. в runner-слое нет ни pnpm,
#     ни node_modules/next/dist/bin/next (standalone-trace не включает CLI).
# =========================================================
set -e
# Внутри образа — /app; при запуске скриптом из репозитория — корень проекта.
cd /app 2>/dev/null || cd "$(dirname "$0")/.."

export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export PORT="${PORT:-3000}"

if [ -f server.js ]; then
  # Docker-образ: standalone скопирован в корень (CMD по умолчанию).
  exec node server.js
fi

if [ -f .next/standalone/server.js ]; then
  # Образ, собранный без flatten (например, cloudpacks поверх репозитория):
  # гарантируем, что статика .next/static и public подключены, иначе /_next/static/*.js вернут 404!
  if [ -d .next/static ] && [ ! -e .next/standalone/.next/static ]; then
    mkdir -p .next/standalone/.next
    ln -s "$(pwd)/.next/static" .next/standalone/.next/static 2>/dev/null || cp -R .next/static .next/standalone/.next/static
  fi
  if [ -d public ] && [ ! -e .next/standalone/public ]; then
    ln -s "$(pwd)/public" .next/standalone/public 2>/dev/null || cp -R public .next/standalone/public
  fi
  exec node .next/standalone/server.js
fi

if [ -f scripts/start.mjs ]; then
  # Fallback для команды `pnpm start` / `npm start`.
  exec node scripts/start.mjs
fi

echo "[entrypoint] Не найден собранный сервер (.next/standalone). Проверьте, что фаза 'pnpm build' отработала в образе." >&2
exit 1
