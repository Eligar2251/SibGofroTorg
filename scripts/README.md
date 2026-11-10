# scripts/ — что здесь и зачем

Ни один файл этой папки, кроме двух помеченных ★, **не участвует в работе
продакшена**: финальный Docker-образ содержит только `public/`, `.next/static`,
`.next/standalone` и ровно `scripts/docker-entrypoint.sh` + `scripts/start.mjs`
(см. `Dockerfile`, этапы `builder`/`runner`). `tools/`, `tests/`, `supabase/` и
`*.md` в корневом `.dockerignore` — то есть в образ они вообще не попадают.

Назначение этой папки — чтобы сайт можно было **развернуть и переразвернуть с
нуля**, а не только «нажать deploy» в Vercel.

| Файл | Зачем | Когда трогать |
|---|---|---|
| `start.mjs` ★ | Точка входа продакшена: сам выбирает `next start` или standalone-сервер, чинит пути base-path, греет кэш. Вызывается из `nixpacks.toml` (`cmd`) и `docker-entrypoint.sh` | никогда «на глаз»: без него контейнер не стартует |
| `docker-entrypoint.sh` ★ | Обёртка CMD в Docker: применяет `scripts/start.mjs`, ждёт готовности порта | только вместе с `Dockerfile` |
| `dev.mjs` | `npm run dev` с увеличенной кучей Node: страница «Учёт» компилируется Turbopack-воркером и на куче по умолчанию падает с OOM (особенно на Windows) | локальная разработка |
| `pc-server.mjs` | `npm run dev:pc` / `start:pc` — «локальный сервер на ПК склада»: поднимает сайт на 127.0.0.1 с локальной БД и своим каталогом `~/.sibgofrotorg-pc` | работа склада офлайн |
| `build-full-migration.mjs` | Собирает `supabase/FULL_DATABASE_MIGRATION.sql` из `schema.sql` + всех `migration_*.sql` в порядке зависимостей, делает триггеры/политики идемпотентными | **после** добавления нового `supabase/migration_*.sql` → `node scripts/build-full-migration.mjs` |
| `generate-admin-sql.mjs` | `npm run admin:sql` — печатает SQL с scrypt-хэшем пароля для создания/обновления администратора (для Supabase SQL Editor, когда нет доступа к Node) | заведение первого владельца/админа |
| `create-admin.ts` | То же, но пишет напрямую в БД: `npx tsx scripts/create-admin.ts <user> <pass> [role] [имя]` | заведение админов на живом проекте |
| `mock-realtime.mjs` | Мини-мок Supabase Realtime (phoenix-протокол) для сквозной проверки SSE-рассылок — реальный Supabase в песочнице не поднять | отладка realtime (см. `README-REALTIME.md`) |
| `test-receipt-completion.cjs` | Регрессия логики приёмки (`isReceiptArchived`, `buildReceiptDebtRows`) без БД и Next.js | `node scripts/test-receipt-completion.cjs` при правках складской логики |

Файлы **только для истории/документации** и не нужны для сборки: `../README*.md`,
`ENV_GUIDE.md`, `MOBILE-*.md`, `supabase/APPLY_MIGRATIONS.md`.

Данные каталога (не код, в образ тоже не входят): `supabase/schema.sql`,
`supabase/migration_*.sql` (схема), `supabase/seed_*.sql` (наполнение прайсами,
например `seed_price_from_pdf_2026-09-29.sql` — 147 позиций прайса 29.09.2026).
