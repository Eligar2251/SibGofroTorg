# SibGofroTorg — Каталог и панель управления

Современный веб-сайт и панель управления для оптово-розничной торговли, построенный на **Next.js 16 (App Router + Turbopack)**, **React 19**, **Tailwind CSS v4** и **Supabase (PostgreSQL)**.

---

## 🚀 Деплой

### 1. Деплой в Timeweb Cloud (App Platform / Docker)

Проект полностью настроен для запуска в **Timeweb Cloud** и других облачных платформах как через автосборку (Cloudpack / Nixpacks), так и через `Dockerfile`:

- **Порт и хост**: Приложение запускается на `0.0.0.0` и слушает порт из переменной окружения `${PORT:-3000}`.
- **Команда запуска**: Для Docker/standalone используется `node server.js` из `.next/standalone` — рантайму больше не нужно ставить зависимости повторно.
- **Отключение автоинсталляции в проде**: В `pnpm-workspace.yaml` и `.npmrc` явно отключена проверка зависимостей (`verifyDepsBeforeRun: false`, `verify-deps-before-run=never`), благодаря чему `pnpm start` не пытается выполнять `pnpm install` или создавать временные файлы в директории приложения `/app` при запуске контейнера от неротового пользователя (`uid 2000`).
- **Почему деплой стал быстрее**: `Dockerfile` теперь использует `output: "standalone"` и делает только **одну** установку зависимостей в builder-слое вместо двух.

#### Рекомендуемая конфигурация в панели Timeweb Cloud:
- **Команда сборки (Build Command)**: `corepack enable && pnpm install --frozen-lockfile --prefer-offline && pnpm run build`
- **Команда запуска (Start Command)**: `node .next/standalone/server.js`
- **Порт (Port)**: `3000`

> Если в Timeweb используется автодетект пакетов (Cloudpack / Nixpacks), в репозитории уже добавлен `nixpacks.toml`, который принудительно включает `pnpm` и запускает standalone-рантайм. Это нужно потому, что исторически в проекте есть и `package-lock.json`, и `pnpm-lock.yaml`, а без явной конфигурации платформа может выбрать более медленный `npm install`.

---

### 2. Деплой на Vercel

В корне репозитория добавлен файл `vercel.json` с настроенными командами для корректной работы с **pnpm v11**:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "corepack enable && pnpm install --frozen-lockfile --prefer-offline",
  "buildCommand": "pnpm build"
}
```

- **Corepack**: Команда `installCommand` автоматически включает `corepack` и использует версию `pnpm@11.17.0`, указанную в `package.json`.
- **`--frozen-lockfile`**: Vercel использует уже готовый `pnpm-lock.yaml`, без повторного пересчёта дерева зависимостей на каждом деплое.
- **`--prefer-offline`**: если кэш пакетов на стороне Vercel уже есть, установка проходит заметно быстрее.

---

## 🛠 Локальный запуск

```bash
# Включить corepack для pnpm
corepack enable

# Установить зависимости
pnpm install

# Запуск в режиме разработки
pnpm dev

# Проверка сборки продакшена
pnpm build
pnpm start
```

## 📋 Переменные окружения

Полный список и описание переменных окружения см. в файле [`ENV_GUIDE.md`](./ENV_GUIDE.md).
