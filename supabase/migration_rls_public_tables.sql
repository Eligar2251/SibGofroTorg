-- =========================================================
-- Миграция: включить RLS на таблицах, забытых в public
--
-- ЧТО ЧИНИТ
-- Supabase Security Advisor: «RLS Disabled in Public» (Critical)
--   • public._backup_bank_payments
--   • public.transports          ← та же проблема, advisor покажет её следом
--
-- ПОЧЕМУ ЭТО ВАЖНО
-- Supabase публикует ВСЕ таблицы схемы public через PostgREST —
-- то есть по HTTP на https://<project>.supabase.co/rest/v1/<table>.
-- Ключ anon публичный: он зашит в JS-бандл сайта (см.
-- NEXT_PUBLIC_SUPABASE_ANON_KEY в use-admin-realtime.ts), его видно
-- в DevTools у любого посетителя.
-- Без RLS единственное, что защищает таблицу, — то, что её имя
-- никто не угадал. Для _backup_bank_payments это копия ВСЕХ
-- банковских платежей, для transports — маршруты, water/телефоны
-- водителей и адреса клиентов.
-- Проверить, что дыра реальна, можно так (до миграции вернёт данные):
--   curl "$SUPABASE_URL/rest/v1/transports?select=*" \
--        -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
--
-- ПОЧЕМУ ЭТО НИЧЕГО НЕ СЛОМАЕТ В АДМИНКЕ
-- 1. Вся работа с этими таблицами идёт через getAdminDb() —
--    клиент на service_role (src/lib/supabase.ts). Ключ service_role
--    обходит RLS на уровне Postgres (роль имеет атрибут BYPASSRLS),
--    поэтому политики к нему не применяются вообще.
--    Проверено: 12 обращений к transports в src/lib/warehouse.ts —
--    все через getAdminDb(); _backup_bank_payments в коде не
--    используется ни разу.
-- 2. Ни одна из таблиц не участвует в Realtime-подписках
--    (там только orders, wastepaper_requests, bank_payments,
--    customer_deals, product_reviews — у всех RLS уже включён).
-- 3. Используем ENABLE, а НЕ FORCE ROW LEVEL SECURITY.
--    FORCE распространил бы политики и на владельца таблицы —
--    вот это сломало бы админку. ENABLE — не ломает.
--
-- Политики намеренно НЕ создаём: доступ нужен только серверу.
-- Это тот же приём, что уже применён в schema.sql для
-- bank_payments, salaries, employees, cash_collections,
-- counterparties, supplier_prices, warehouse_receipts,
-- doc_counters, customer_deals, activity_logs, admins —
-- у них RLS включён и политик нет.
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

-- ── 1. Резервная копия платежей, оставшаяся от старого скрипта ──
-- Создана в FIX_cash_restore.sql (он помечен «УСТАРЕЛО — НЕ ЗАПУСКАТЬ»).
-- Приложение к ней не обращается — таблица нужна только как архив.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = '_backup_bank_payments'
  ) THEN
    EXECUTE 'ALTER TABLE public._backup_bank_payments ENABLE ROW LEVEL SECURITY';
    RAISE NOTICE 'RLS включён: _backup_bank_payments';
  ELSE
    RAISE NOTICE 'Пропущено: _backup_bank_payments не существует';
  END IF;
END $$;

-- ── 2. Перевозки ──
-- Админская таблица: маршруты, водители, адреса клиентов.
-- Публичного доступа не требует.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'transports'
  ) THEN
    EXECUTE 'ALTER TABLE public.transports ENABLE ROW LEVEL SECURITY';
    RAISE NOTICE 'RLS включён: transports';
  ELSE
    RAISE NOTICE 'Пропущено: transports не существует';
  END IF;
END $$;

-- ── 3. Страховка на будущее ──
-- Ловим любые другие таблицы public без RLS, чтобы advisor не
-- присылал такие же предупреждения после следующих миграций.
-- Системные таблицы Supabase не трогаем — они не в public.
DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind = 'r'          -- обычные таблицы (не вьюхи/партиции)
      AND c.relrowsecurity = FALSE -- RLS ещё не включён
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    RAISE NOTICE 'RLS включён (страховка): %', r.relname;
    n := n + 1;
  END LOOP;

  IF n = 0 THEN
    RAISE NOTICE 'Все таблицы public уже под RLS';
  END IF;
END $$;

-- ── 4. Проверка результата ──
-- Должно вернуть 0 строк. Если что-то осталось — оно всё ещё открыто.
SELECT
  c.relname AS table_without_rls
FROM pg_class c
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = FALSE
ORDER BY 1;

-- Полная картина: какие таблицы под RLS и сколько у них политик.
-- Таблицы с 0 политик = доступны только service_role (это норма
-- для админских таблиц).
SELECT
  c.relname                                   AS table_name,
  c.relrowsecurity                            AS rls_enabled,
  (SELECT COUNT(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_class c
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY policies DESC, c.relname;

-- =========================================================
-- ОПЦИОНАЛЬНО: удалить устаревшую резервную копию
--
-- _backup_bank_payments — снимок bank_payments, сделанный скриптом
-- FIX_cash_restore.sql. Тот скрипт завершился ROLLBACK («база сейчас
-- в исходном виде», см. шапку файла), поэтому копия дублирует данные,
-- которые и так лежат в bank_payments, и с тех пор устарела.
--
-- После включения RLS она уже не опасна, так что спешить некуда.
-- Если решите убрать — сначала убедитесь, что она не нужна:
--
--   SELECT COUNT(*) FROM _backup_bank_payments;   -- сколько строк
--   SELECT COUNT(*) FROM bank_payments;           -- сравнить с текущими
--
-- и только потом:
--
--   DROP TABLE IF EXISTS public._backup_bank_payments;
-- =========================================================
