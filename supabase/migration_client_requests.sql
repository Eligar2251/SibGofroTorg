-- =========================================================
-- Миграция: ручные заявки клиентов (CRM-обращения)
--
-- ЗАЧЕМ
-- Менеджеру звонит (пишет, приходит) клиент — нужно быстро
-- зафиксировать обращение: кто, как связаться, что нужно
-- (не обязательно конкретный товар) и вести его по статусам.
-- Эти заявки НЕ связаны с заказами сайта (orders) и не
-- попадают в учёт автоматически.
--
-- БЕЗОПАСНОСТЬ
-- RLS включён, политик для anon/authenticated НЕТ: читать и
-- писать может только сервер админки через service_role
-- (обходит RLS на уровне Postgres) — тот же приём, что у
-- bank_payments, salaries, activity_logs и др.
--
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- Идемпотентно: можно запускать повторно.
-- =========================================================

CREATE TABLE IF NOT EXISTS client_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Клиент: имя или название компании (обязательно)
  customer_name TEXT NOT NULL DEFAULT '',
  -- Телефон (необязателен: например, клиент подошёл лично)
  customer_phone TEXT NOT NULL DEFAULT '',
  -- Как связались / как держим связь
  contact_method TEXT NOT NULL DEFAULT 'call'
    CHECK (contact_method IN ('call', 'whatsapp', 'telegram', 'max', 'email', 'visit', 'other')),
  -- Что нужно клиенту (обязательно, свободный текст)
  subject TEXT NOT NULL DEFAULT '',
  -- Рабочие заметки менеджера
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'completed', 'rejected')),
  -- Итог (для 'completed') или причина отмены (для 'rejected')
  close_reason TEXT,
  -- Кто из админки внёс заявку
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_requests_status ON client_requests(status);
CREATE INDEX IF NOT EXISTS idx_client_requests_created ON client_requests(created_at DESC);

DROP TRIGGER IF EXISTS trg_client_requests_updated ON client_requests;
CREATE TRIGGER trg_client_requests_updated
  BEFORE UPDATE ON client_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE client_requests ENABLE ROW LEVEL SECURITY;

-- Политики намеренно не создаём (см. шапку): доступ только у
-- service_role через серверные API админки.

-- Realtime: чтобы страница обновлялась мгновенно (как «Заявки»),
-- добавляем таблицу в публикацию, если она есть в проекте.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'client_requests'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE client_requests';
    END IF;
  END IF;
END $$;
