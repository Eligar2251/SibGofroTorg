-- =========================================================
-- Миграция: постоянное хранилище табелей охраны + история версий
--
-- 1) duty_schedule_state — текущий рабочий снимок табеля.
--    Один общий JSONB-снимок содержит сотрудников охраны, графики всех
--    месяцев, ручные суммы, начисления и дни выплат. Запись всегда имеет
--    id = 'main': повторная генерация или ручная правка делает UPSERT этой
--    же строки, а не создаёт дубликат табеля.
--
-- 2) duty_schedule_revisions — журнал версий. Каждое сохранение кладёт
--    снимок в историю, поэтому прежние смены, зарплату и выплаты можно
--    пролистать и вернуть. Самая свежая запись журнала всегда совпадает
--    с рабочим снимком (инвариант поддерживает приложение).
--
-- 3) duty_schedule_state.content_hash — отпечаток содержимого снимка:
--    по нему приложение понимает, что данные не изменились, и не пишет
--    лишнюю версию.
--
-- RLS включён без публичных политик. Читать и менять снимок и историю
-- может только сервер админки через service_role.
--
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- Миграция идемпотентна, её безопасно запускать повторно (в том числе
-- поверх уже применённой прежней версии файла — просто появится история).
-- =========================================================

CREATE TABLE IF NOT EXISTS duty_schedule_state (
  id TEXT PRIMARY KEY DEFAULT 'main' CHECK (id = 'main'),
  snapshot JSONB NOT NULL DEFAULT '{
    "employees": [],
    "schedules": {},
    "amountOverrides": {},
    "salaryPayouts": {},
    "payoutTitles": {},
    "salaryAccruals": {},
    "payPlans": {}
  }'::jsonb,
  pay_offset SMALLINT NOT NULL DEFAULT 1 CHECK (pay_offset IN (0, 1, 2)),
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Отпечаток содержимого: одинаковый снимок не создаёт новую версию.
ALTER TABLE duty_schedule_state
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

DROP TRIGGER IF EXISTS trg_duty_schedule_state_updated ON duty_schedule_state;
CREATE TRIGGER trg_duty_schedule_state_updated
  BEFORE UPDATE ON duty_schedule_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE duty_schedule_state ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- История версий табеля
-- =========================================================

CREATE TABLE IF NOT EXISTS duty_schedule_revisions (
  id BIGSERIAL PRIMARY KEY,
  -- Полный снимок табеля на момент сохранения (сотрудники, смены,
  -- начисления, выплаты).
  snapshot JSONB NOT NULL,
  pay_offset SMALLINT NOT NULL DEFAULT 1 CHECK (pay_offset IN (0, 1, 2)),
  content_hash TEXT NOT NULL DEFAULT '',
  -- Краткая сводка для списка истории (месяцы, суммы начислений и выплат).
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Пометка события: «Восстановлена версия от …». NULL — обычное автосохранение.
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Последнее обновление версии: правки одной сессии объединяются в неё.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_duty_schedule_revisions_updated
  ON duty_schedule_revisions(updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_duty_schedule_revisions_hash
  ON duty_schedule_revisions(content_hash);

ALTER TABLE duty_schedule_revisions ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- Проверка после применения
-- =========================================================
-- SELECT 'duty_schedule_state' AS check_name,
--        EXISTS (SELECT 1 FROM information_schema.tables
--                WHERE table_name = 'duty_schedule_state') AS ok
-- UNION ALL SELECT 'duty_schedule_state.content_hash',
--        EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_name = 'duty_schedule_state' AND column_name = 'content_hash')
-- UNION ALL SELECT 'duty_schedule_revisions',
--        EXISTS (SELECT 1 FROM information_schema.tables
--                WHERE table_name = 'duty_schedule_revisions');
-- Ожидаемый результат — 3 строки, во всех ok = true.
