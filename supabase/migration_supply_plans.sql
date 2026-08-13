-- Отдельные планы будущих поставок. Это ещё не приходные ордера:
-- планы не меняют склад и банк, а хранят черновой состав и оценку бюджета.
CREATE TABLE IF NOT EXISTS warehouse_supply_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  planned_date TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_plans_status
  ON warehouse_supply_plans(status);
CREATE INDEX IF NOT EXISTS idx_supply_plans_date
  ON warehouse_supply_plans(planned_date);

DROP TRIGGER IF EXISTS trg_supply_plans_updated ON warehouse_supply_plans;
CREATE TRIGGER trg_supply_plans_updated
  BEFORE UPDATE ON warehouse_supply_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Планирование — внутренний модуль. Политик для anon/authenticated нет;
-- серверная service_role обходит RLS.
ALTER TABLE warehouse_supply_plans ENABLE ROW LEVEL SECURITY;
