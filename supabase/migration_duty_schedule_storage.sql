-- =========================================================
-- Миграция: постоянное хранилище табелей охраны
--
-- Один общий JSONB-снимок содержит сотрудников охраны, графики всех
-- месяцев, ручные суммы, начисления и дни выплат. Запись всегда имеет
-- id = 'main': повторная генерация или ручная правка делает UPSERT этой
-- же строки, а не создаёт дубликат табеля.
--
-- RLS включён без публичных политик. Читать и менять снимок может только
-- сервер админки через service_role.
--
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- Миграция идемпотентна, её безопасно запускать повторно.
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

DROP TRIGGER IF EXISTS trg_duty_schedule_state_updated ON duty_schedule_state;
CREATE TRIGGER trg_duty_schedule_state_updated
  BEFORE UPDATE ON duty_schedule_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE duty_schedule_state ENABLE ROW LEVEL SECURITY;

-- Политик для anon/authenticated намеренно нет. service_role обходит RLS.
