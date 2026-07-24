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
MAX_BOT_TOKEN=...
MAX_ADMIN_CHAT_ID=...

# ─── Аналитика ───
NEXT_PUBLIC_YANDEX_METRIKA_ID=...

# ─── Компания (публичные данные) ───
NEXT_PUBLIC_COMPANY_ADDRESS=...
NEXT_PUBLIC_COMPANY_PHONE=...
NEXT_PUBLIC_COMPANY_EMAIL=...
NEXT_PUBLIC_COMPANY_HOURS_WEEKDAY=...
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
```
