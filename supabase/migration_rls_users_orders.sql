-- =========================================================
-- КРИТИЧНО. Миграция: закрыть публичный доступ к users и orders
--
-- ЧТО НАЙДЕНО
-- В schema.sql на таблицах users и orders висят политики «разрешить всем»:
--   users_sel  FOR SELECT USING (TRUE)
--   users_ins  FOR INSERT WITH CHECK (TRUE)
--   users_upd  FOR UPDATE USING (TRUE)
--   orders_sel FOR SELECT USING (TRUE)
--   orders_ins FOR INSERT WITH CHECK (TRUE)
--   orders_upd FOR UPDATE USING (TRUE)
--
-- Схема public целиком публикуется наружу через PostgREST, а ключ anon
-- публичный. Пока эти политики включены, любой, кто знает ключ и адрес
-- проекта, может:
--
--   curl "$SUPABASE_URL/rest/v1/users?select=*" -H "apikey: $ANON"
--     → телефоны, имена, email, ИНН, адреса И ХЕШИ ПАРОЛЕЙ всех клиентов;
--
--   curl -X PATCH "$SUPABASE_URL/rest/v1/users?id=eq.<id>" \
--        -H "apikey: $ANON" -d '{"password_hash":"..."}'
--     → подменить пароль любому клиенту и войти в его кабинет;
--
--   curl "$SUPABASE_URL/rest/v1/orders?select=*" -H "apikey: $ANON"
--     → выгрузить все заявки с именами, телефонами, суммами и адресами.
--
-- В терминах 152-ФЗ это готовая утечка персональных данных: ч. 12–15
-- ст. 13.11 КоАП — от 3 млн ₽, при повторной — оборотный штраф.
--
-- ПОЧЕМУ ЭТО НИЧЕГО НЕ СЛОМАЕТ
-- В приложении НЕТ ни одного обращения к Supabase из браузера:
-- getPublicDb() (src/lib/supabase.ts) не вызывается нигде, весь доступ
-- идёт через getAdminDb() на service_role, который обходит RLS на уровне
-- Postgres. Регистрация, вход, оформление заявок, кабинет — всё это
-- серверные маршруты /api/*. Realtime админки тоже работает через сервер
-- (src/lib/realtime-hub.ts, service_role), а не через anon.
--
-- Проверить после применения (должно вернуть пустой массив или ошибку):
--   curl "$SUPABASE_URL/rest/v1/users?select=id" -H "apikey: $ANON"
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

-- ── Клиенты: доступ только с сервера ──
DROP POLICY IF EXISTS "users_sel" ON users;
DROP POLICY IF EXISTS "users_ins" ON users;
DROP POLICY IF EXISTS "users_upd" ON users;

-- ── Заявки: доступ только с сервера ──
DROP POLICY IF EXISTS "orders_sel" ON orders;
DROP POLICY IF EXISTS "orders_ins" ON orders;
DROP POLICY IF EXISTS "orders_upd" ON orders;

-- Заявки на вывоз макулатуры создаются тем же серверным маршрутом
-- (/api/wastepaper) — политика для анонимной вставки не нужна.
DROP POLICY IF EXISTS "wp_ins" ON wastepaper_requests;

-- RLS должен остаться включённым (без политик = «никому, кроме service_role»).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE wastepaper_requests ENABLE ROW LEVEL SECURITY;

-- Каталог остаётся публично читаемым намеренно: товары, категории,
-- настройки, акции и отзывы и так показываются на сайте, персональных
-- данных там нет. Их политики не трогаем.

DO $$
BEGIN
  RAISE NOTICE 'Публичные политики users/orders сняты. Проверьте сайт: регистрация, вход, оформление заявки, кабинет.';
END $$;
