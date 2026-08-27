-- =========================================================
-- Миграция: включить Realtime для рабочих таблиц админки
--
-- ЧТО ДЕЛАЕТ
-- Добавляет таблицы в публикацию supabase_realtime. Без этого Postgres
-- просто не пишет их изменения в поток логической репликации, и Realtime
-- не отдаёт по ним события — даже под service_role.
--
-- БЕЗОПАСНОСТЬ
-- Публикация НЕ раздаёт доступ. Права по-прежнему определяются RLS:
--   • у finance-таблиц (bank_payments, salaries, customer_deals,
--     cash_collections, client_requests…) RLS включён и политик для anon
--     нет — анонимный клиент не получит по ним ни одной строки;
--   • подписку держит сервер приложения под service_role
--     (src/lib/realtime-hub.ts), а браузеры админки слушают наш же домен
--     через SSE /api/admin/events под admin-session cookie.
-- Никаких новых политик здесь намеренно не создаётся.
--
-- REPLICA IDENTITY не меняем: приложению достаточно id изменённой строки,
-- а REPLICA IDENTITY FULL заметно раздувает WAL.
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

DO $$
DECLARE
  t TEXT;
  wanted TEXT[] := ARRAY[
    'orders',
    'wastepaper_requests',
    'client_requests',
    'customer_deals',
    'warehouse_receipts',
    'bank_payments',
    'salaries',
    'cash_collections',
    'products',
    'transports',
    'product_reviews',
    'product_questions',
    'activity_logs',
    'rent_invoices',
    'rent_payments',
    'wp_intakes',
    'wp_shipments',
    'wp_payments',
    'wp_transports',
    'wp_counterparties'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Публикации supabase_realtime нет — Realtime в этом проекте не настроен, пропускаем.';
    RETURN;
  END IF;

  FOREACH t IN ARRAY wanted LOOP
    -- таблицы может не быть, если соответствующая миграция ещё не применена
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      RAISE NOTICE 'Пропуск %: таблицы нет', t;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      RAISE NOTICE 'Уже в публикации: %', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    RAISE NOTICE 'Добавлено в Realtime: %', t;
  END LOOP;
END $$;

-- Проверка: что сейчас в публикации
-- SELECT tablename FROM pg_publication_tables
--  WHERE pubname = 'supabase_realtime' ORDER BY tablename;
