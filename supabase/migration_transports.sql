-- Миграция: система перевозок (transports)
-- Перевозка = группа заказов на одну дату с одним водителем

CREATE TABLE IF NOT EXISTS transports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  planned_date DATE,
  driver_id UUID,
  driver_name TEXT,
  driver_phone TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  note TEXT,
  -- items: [{dealId, dealNumber, customerName, address, items: [{productId, name, qty}], totalSum}]
  items JSONB DEFAULT '[]'::jsonb,
  total_items INT DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transports_status ON transports(status);
CREATE INDEX IF NOT EXISTS idx_transports_date ON transports(planned_date);
CREATE TRIGGER trg_transports_updated BEFORE UPDATE ON transports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
