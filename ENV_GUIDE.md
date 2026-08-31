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

# ─── MAX-бот для уведомлений о заявках ───
# Telegram убран: с серверов в РФ api.telegram.org недоступен, а отправка
# через зарубежный релей = трансграничная передача персональных данных.
MAX_BOT_TOKEN=...
MAX_ADMIN_CHAT_ID=...

# ─── Аналитика ───
# Номер счётчика Яндекс.Метрики (только цифры). Если не задан — счётчик и цели
# не загружаются (сайт работает как обычно). Подробнее о целях — в README-SEO.md.
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
MAX_BOT_TOKEN
MAX_ADMIN_CHAT_ID
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
MAX_BOT_TOKEN              ← уведомления о заявках, работает из РФ
MAX_ADMIN_CHAT_ID
```

---

## 🔔 Уведомления о заявках (MAX)

Telegram полностью удалён из проекта: с российских серверов `api.telegram.org`
недоступен (ТСПУ дропает пакеты), а обход через зарубежный релей означал бы
отправку имён и телефонов клиентов за границу — трансграничную передачу
персональных данных, которую по ст. 12 152-ФЗ надо отдельно уведомлять в РКН.

Рабочий канал — **MAX** (российский, работает без VPN):
создайте бота в MAX (напишите `@MasterBot`), заполните `MAX_BOT_TOKEN` и
`MAX_ADMIN_CHAT_ID` в переменных окружения или в админке
(Настройки → Уведомления) и нажмите «Проверить MAX».

Независимо от мессенджера заявки видны в самой панели: колокольчик
показывает новые заявки со звуком мгновенно, а пропущенные (пришедшие,
пока панель была закрыта) прозвенят при следующем входе.
