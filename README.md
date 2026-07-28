# SibGofroTorg — Каталог и панель управления

Современный веб-сайт и панель управления для оптово-розничной торговли, построенный на **Next.js 16 (App Router + Turbopack)**, **React 19**, **Tailwind CSS v4** и **Supabase (PostgreSQL)**.

---

## 🚀 Деплой

### 1. Деплой в Timeweb Cloud (App Platform / Docker)

Проект полностью настроен для запуска в **Timeweb Cloud** и других облачных платформах как через автосборку (Cloudpack / Nixpacks), так и через `Dockerfile`:

- **Порт и хост**: Приложение запускается на `0.0.0.0` и слушает порт из переменной окружения `${PORT:-3000}`.
- **Команда запуска**: Настроена на прямой запуск исполняемого файла `node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3000}`, что исключает ошибки разрешения PATH или проблем с симлинками.
- **Отключение автоинсталляции в проде**: В `pnpm-workspace.yaml` и `.npmrc` явно отключена проверка зависимостей (`verifyDepsBeforeRun: false`, `verify-deps-before-run=never`), благодаря чему `pnpm start` не пытается выполнять `pnpm install` или создавать временные файлы в директории приложения `/app` при запуске контейнера от неротового пользователя (`uid 2000`).

#### Рекомендуемая конфигурация в панели Timeweb Cloud:
- **Команда сборки (Build Command)**: `pnpm run build`
- **Команда запуска (Start Command)**: `pnpm start` (или `node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3000}`)
- **Порт (Port)**: `3000`

---

### 2. Деплой на Vercel

В корне репозитория добавлен файл `vercel.json` с настроенными командами для корректной работы с **pnpm v11**:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "corepack enable && pnpm install --no-frozen-lockfile",
  "buildCommand": "pnpm build"
}
```

- **Corepack**: Команда `installCommand` автоматически включает `corepack` и использует версию `pnpm@11.17.0`, указанную в `package.json`.
- **Флаг `--no-frozen-lockfile`**: Предотвращает сбои установки в Linux-окружении Vercel при валидации кроссплатформенных опциональных зависимостей (например, `@zxing/library`, `sharp`).

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
