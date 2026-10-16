# 🚑 Если админка или база данных не работает

Ситуация: **сайт открывается, а админка — нет**, разделы пустые, вход не проходит.
Это почти всегда значит, что недоступна **база данных** (сайт отдаёт страницы из
кэша, поэтому выглядит живым; админка ходит в базу при каждом запросе и падает
первой). Данные при этом не теряются: когда база вернётся, товары, заказы,
клиенты и админка появятся сами. Ничего пересоздавать не нужно.

Быстрая проверка (обе ссылки открываются в браузере):

- `https://<домен>/api/health` → `{"ok":true}` — процесс сайта жив;
- `https://<домен>/api/health/db` → `{"ok":true,"db":"up"}` — база отвечает;
  `503` — база недоступна (читайте текст ошибки в ответе).

---

## Шаг 1. База данных не запущена или не отвечает

Самая частая причина. Сбои вида `PGRST002` («Could not query the database for the
schema cache»), `PGRST003` («Timed out acquiring connection from connection
pool») и тайм-ауты означают: API-слой базы жив, но PostgreSQL не принимает
соединения.

1. Откройте панель, где развёрнута база:
   - **Supabase Cloud** → <https://supabase.com/dashboard> → проект. Если «Paused» — нажмите **Restore / Resume**;
   - **сервер/приложение на хостинге** (Timeweb, Beget и т. п.) → раздел с базой или приложением Supabase → проверьте, запущено ли, и нажмите **Перезапустить**.
2. Полезно посмотреть логи базы и свободное место: переполненный диск — частая причина, и перезапуск тогда не поможет (сначала освободить место).
3. После перезапуска подождите 1–3 минуты (PostgreSQL выходит из recovery) и снова откройте `/api/health/db`.

⚠️ При перезапуске через Docker **не используйте `docker compose down -v`** — флаг `-v` удаляет volume с данными. Только `restart`.

---

## Шаг 2. Supabase не принимает ключ

Признак: в ответе базы `Invalid API key` / `401` / `403`. Так бывает, если в
проекте нажали **Rotate JWT secret**, отключили **legacy-ключи** или в переменную
попал публичный ключ вместо секретного.

1. <https://supabase.com/dashboard> → ваш проект.
2. **Project Settings → API Keys** (старый интерфейс — **Settings → API**):
   - **Secret key** (он же `service_role`) → `SUPABASE_SERVICE_ROLE_KEY`;
   - **Publishable key** (он же `anon`) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. **Project Settings → Data API** → **Project URL** → `SUPABASE_URL`
   (вид `https://xxxxxxxx.supabase.co`).
4. Вставьте значения в переменные окружения приложения, сохраните и **перезапустите**.
5. Проверьте `/api/health/db` → должно быть `{"ok":true,"db":"up"}`.

> ⚠️ Ключ `service_role` даёт полный доступ к базе. Не публикуйте его, не
> пересылайте в мессенджерах и не вставляйте в браузерный код.

---

## Шаг 3. Готовый блок переменных окружения (копировать и вставить)

Панель хостинга → приложение → **Переменные окружения**. Замените всё, что в
угловых скобках.

```env
# ── База данных ─────────────────────────────────────────────
SUPABASE_URL=https://<ваш-проект>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<Secret key / legacy service_role>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Publishable key / legacy anon>

# ── Админка ────────────────────────────────────────────────
# Секрет подписи сессий: случайная строка 32+ символов.
# Смена значения = все администраторы входят заново (данные не теряются).
ADMIN_SESSION_SECRET=<случайная-строка-32+символов>
# Путь админки. ОБЕ переменные должны совпадать!
ADMIN_SECRET_PATH=<путь-админки>
NEXT_PUBLIC_ADMIN_PATH=<тот-же-путь-админки>

# ── Сессии клиентов сайта (можно оставить пустым) ──────────
USER_SESSION_SECRET=<случайная-строка-32+символов>

# ── Служебное ──────────────────────────────────────────────
NEXT_PUBLIC_SITE_URL=https://sibgofrotorg.ru
PORT=3000
# Таймаут запросов к базе, мс (поднять, если база отвечает медленно)
SUPABASE_FETCH_TIMEOUT_MS=30000

# ── Загрузка фото товаров ──────────────────────────────────
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=<cloud name>
CLOUDINARY_API_KEY=<api key>
CLOUDINARY_API_SECRET=<api secret>

# ── Уведомления о заявках в MAX (необязательно) ────────────
MAX_BOT_TOKEN=<токен бота MAX>
MAX_ADMIN_CHAT_ID=<id чата>
```

Важно:

- `ADMIN_SECRET_PATH` и `NEXT_PUBLIC_ADMIN_PATH` **обязаны совпадать**, иначе
  вход в панель ломается (страница открывается по одному адресу, а вход ищет её
  по другому).
- Переменные `NEXT_PUBLIC_*` подставляются **на этапе сборки**: после их
  изменения нужен пересбор («Пересобрать и запустить»), а не только перезапуск.
- Секрет можно сгенерировать командой:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

---

## Шаг 4. Вход в админку: пароль забыт, аккаунт деактивирован

### 4.1. Сессия истекла — просто войдите заново

Сессия администратора — JWT в cookie, живёт 30 дней и продлевается автоматически,
пока вы работаете в панели. Если она всё-таки истекла (сменился
`ADMIN_SESSION_SECRET`, очищены cookie браузера), панель сама ведёт на форму
входа с надписью «Сессия истекла». Пароль и данные при этом не менялись.

### 4.2. Восстановление доступа без SQL

1. Добавьте в переменные окружения (см. шаг 3) случайную строку 32+ символов:

   ```env
   ADMIN_RECOVERY_TOKEN=<случайная-строка-32+символов>
   ```

2. **Перезапустите** приложение.
3. Откройте `https://<домен>/api/health/recover-admin` — форма в браузере.
4. Укажите токен, логин (`owner`), новый пароль (8+ символов), роль `owner`,
   нажмите **«Восстановить доступ»**.
5. Войдите в админку новым паролем.
6. **Удалите `ADMIN_RECOVERY_TOKEN`** и перезапустите приложение — «дверь» закроется.

Альтернатива через терминал:

```bash
curl -X POST https://<домен>/api/health/recover-admin \
  -H "Content-Type: application/json" \
  -d '{"token":"<ADMIN_RECOVERY_TOKEN>","username":"owner","password":"<новый пароль>","role":"owner"}'
```

### 4.3. Через SQL

SQL-редактор базы (например, Supabase → SQL Editor). Посмотреть администраторов:

```sql
select username, role, is_active, (password_hash is not null) as has_password, created_at
from admins
order by created_at;
```

Создать таблицу, если её нет:

```sql
create table if not exists admins (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null default 'admin'
    check (role in ('owner', 'admin', 'manager', 'lawyer', 'wastepaper')),
  display_name text default '',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Расширить список ролей (если база не знает `owner`):

```sql
alter table admins drop constraint if exists admins_role_check;
alter table admins add constraint admins_role_check
  check (role in ('owner', 'admin', 'manager', 'lawyer', 'wastepaper'));
```

Готовый `insert` с хешем пароля выдаёт команда проекта:

```bash
npm run admin:sql -- --username owner --role owner
```

---

## Шаг 5. Проверка

1. `https://<домен>/api/health` → `{"ok":true}`.
2. `https://<домен>/api/health/db` → `{"ok":true,"db":"up"}`.
3. Вход в админку проходит, разделы открываются, товары и заказы на месте.

---

## Частые вопросы

**Почему сайт работает, а админка — нет?**
Публичные страницы отдаются из кэша (до 2 минут, дальше — последняя удачная
версия), поэтому сбой базы на них не виден сразу. Админка ходит в базу при каждом
запросе и падает первой. Это один сбой, а не два.

**Как «обновить JWT» администратора?**
Никак вручную — сессия продлевается сама, а по истечении достаточно войти заново.
JWT хранится в cookie и в базе не лежит.

**Ключи Supabase истекают?**
По времени — нет. Они перестают работать только если в проекте сделали
**Rotate JWT secret**, отключили legacy-ключи или проект удалён/на паузе
(шаги 1–2).

**Где смотреть логи ошибок?**
Панель хостинга → приложение → **Логи**. Ищите строки `Login error`,
`Admin notifications error`, `Read admin nav layout error` — рядом будет текст
ошибки базы.
