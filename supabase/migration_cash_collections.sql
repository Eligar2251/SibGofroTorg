-- Миграция: сдача кассы (инкассация)
-- Каждая запись = одна сданная кассовая смена (дата + сумма).
-- При сдаче кассы весь остаток наличных списывается и уходит в банк.

CREATE TABLE IF NOT EXISTS cash_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_collections_date ON cash_collections(date);

ALTER TABLE cash_collections ENABLE ROW LEVEL SECURITY;
