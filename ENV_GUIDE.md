# 📋 Переменные окружения — миграция Firestore → Supabase

## ✅ ОСТАВИТЬ (как было)

```bash
# ─── JWT-секреты для защиты админки и пользовательских сессий ───
# ЭТИ КЛЮЧИ ОЧЕНЬ ВАЖНЫ — они защищают админку от взлома!
ADMIN_SESSION_SECRET=ваш-длинный-секрет-минимум-32-символа-тут
USER_SESSION_SECRET=можно-тот-же-что-и-admin-или-отдельный

# ─── Путь к админке (скрытый, чтобы боты не нашли) ───
ADMIN_SECRET_PATH=ваш-секретный-путь

# ─── Cloudinary (загрузка изображений) ───
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# ─── Telegram/MAX боты для уведомлений ───
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_CHAT_ID=...
# Адрес Telegram Bot API. Пусто = официальный api.telegram.org.
# ⚠️ С серверов в РФ api.telegram.org заблокирован (ТСПУ дропает пакеты) —
# сюда вписывают РЕЛЕЙ: зарубежный VPS / Cloudflare Worker, который
# проксирует api.telegram.org. Можно несколько адресов через запятую —
# пробоются по очереди. Либо настройте MAX — он работает из РФ без VPN.
TELEGRAM_API_BASE=
MAX_BOT_TOKEN=...
MAX_ADMIN_CHAT_ID=...

# ─── Аналитика ───
NEXT_PUBLIC_YANDEX_METRIKA_ID=...

# ─── Компания (публичные данные) ───
NEXT_PUBLIC_COMPANY_ADDRESS=...
NEXT_PUBLIC_COMPANY_PHONE=...
NEXT_PUBLIC_COMPANY_EMAIL=...
NEXT_PUBLIC_COMPANY_HOURS_WEEKDAY=...

# ─── SEO: канонический домен сайта ───
# ЕДИНЫЙ источник домена для canonical-тегов, OG/JSON-LD,
# robots.txt (host) и sitemap.xml. Все они читают ОДНУ переменную.
# ⚠️ Должен совпадать с реальным доменом в выдаче (без слеша на конце):
NEXT_PUBLIC_SITE_URL=https://sibgofrotorg.ru
```

## ➕ ДОБАВИТЬ (новые для Supabase)

```bash
# ─── Supabase ───
# URL вашего Supabase проекта (Settings → API → Project URL)
SUPABASE_URL=https://xxxxx.supabase.co

# Серверный ключ (Settings → API → service_role key)
# ⚠️ НИКОГДА не коммитить и не передавать клиенту!
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Публичный анонимный ключ (Settings → API → anon/public key)
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## 🔥 ДЛЯ МИГРАЦИИ (Firestore → Supabase)

```bash
# Нужны ТОЛЬКО для кнопки переноса данных.
# После миграции можно убрать.

FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Эти можно убрать после миграции:
# NEXT_PUBLIC_FIREBASE_API_KEY
# NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
# NEXT_PUBLIC_FIREBASE_PROJECT_ID
# NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
# NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
# NEXT_PUBLIC_FIREBASE_APP_ID
```

## ❌ УБРАТЬ (после миграции)

```bash
# Больше НЕ нужны после полного перехода на Supabase:
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

## 📌 Итого: минимальный набор для работы

### Для разработки (все фичи + миграция):
```
ADMIN_SESSION_SECRET
ADMIN_SECRET_PATH
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_CHAT_ID
FIREBASE_PROJECT_ID        ← только для миграции
FIREBASE_CLIENT_EMAIL      ← только для миграции
FIREBASE_PRIVATE_KEY       ← только для миграции
```

### Для прода (после миграции):
```
ADMIN_SESSION_SECRET
ADMIN_SECRET_PATH
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_CHAT_ID
TELEGRAM_API_BASE          ← только если сервер в РФ (релей)
MAX_BOT_TOKEN              ← запасной канал, работает из РФ
MAX_ADMIN_CHAT_ID
```

---

## 🔔 Уведомления в Telegram из РФ (блокировка api.telegram.org)

С марта 2026 ТСПУ дропает пакеты с российских серверов к `api.telegram.org` —
заявки «уходят», но в Telegram ничего не приходит. Два рабочих варианта:

### Вариант 1 (рекомендуемый): MAX-бот
MAX работает из РФ без ограничений. Создайте бота в MAX, заполните в админке
(Настройки → Уведомления) `MAX_BOT_TOKEN` и `MAX_ADMIN_CHAT_ID` и нажмите
«Проверить MAX». Уведомления будут дублироваться в MAX.

### Вариант 2: релей для Telegram
Поднимите маленький зарубежный VPS (или бесплатный Cloudflare Worker), который
проксирует `api.telegram.org`, и впишите его адрес в `TELEGRAM_API_BASE`
(env) или в админке: Настройки → «Адрес Telegram API (релей)».

Пример Caddy на зарубежном VPS (проксирует только ваш IP):

```
tg.example.com {
    @allowed remote_ip 1.2.3.4   # IP вашего сервера в РФ
    handle @allowed {
        reverse_proxy https://api.telegram.org {
            header_up Host api.telegram.org
        }
    }
    respond 403
}
```

Тогда в настройках сайта: `TELEGRAM_API_BASE=https://tg.example.com`.
Код сам пройдёт по списку адресов и отправит через первый живой. Проверка —
кнопка «Проверить Telegram» в настройках: диагностика покажет, какой адрес
ответил, а какой заблокирован.

Пример бесплатного Cloudflare Worker-релея (Workers → Create Worker):

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = new URL("https://api.telegram.org" + url.pathname + url.search);
    const init = {
      method: request.method,
      headers: request.headers,
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }
    return fetch(target, init);
  },
};
```

Опубликуйте и впишите адрес worker'а в `TELEGRAM_API_BASE`
(например `https://tg-relay.ваш-аккаунт.workers.dev`).

### Если в журнале «✓ отправлено», но на телефон приходит только с VPN

Значит сервер свою работу сделал — сообщение доставлено в Telegram, но
**клиент Telegram на телефоне в РФ заблокирован** (блокировка раскатывается
по регионам постепенно, поэтому «неделю назад работало»). Код сайта это
починить не может. Решения:

1. **MAX-бот** (рекомендуется): уведомления дублируются в MAX — он в РФ
   работает без VPN. Настройка: Настройки → Уведомления → блок «MAX-бот».
2. Читать Telegram через VPN на телефоне.

### Диагностика

В админке (Настройки → Уведомления) есть «Журнал последних отправок»:
для каждого заказа видно, что сервер пытался отправить в Telegram и MAX,
и чем закончилась попытка. Если заказа в журнале нет — сервер вообще не
дошёл до отправки (смотрите серверные логи); если есть «✗ не ушло» —
причина написана рядом.

Технические детали MAX (2026): хосты пробуются по очереди
`botapi.max.ru` → `platform-api2.max.ru` → `platform-api.max.ru`
(старый platform-api отключён 19.07.2026); авторизация пробывается и
сырым токеном, и `Bearer`-вариантом. Если Node не доверяет TLS-цепочке
*.max.ru (корневой сертификат Минцифры), задайте на сервере
`NODE_EXTRA_CA_CERTS=/путь/к/russian_trusted_root_ca.pem`.
