-- Накопительные планы закупок.
-- Пополнения виртуальные и не двигают деньги; при списании создаётся
-- проведённый исходящий платёж с выбранного счёта.

CREATE TABLE IF NOT EXISTS warehouse_purchase_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT,
  ozon_url TEXT,
  ozon_image_url TEXT,
  ozon_price NUMERIC,
  ozon_checked_at TIMESTAMPTZ,
  ozon_price_updated_at TIMESTAMPTZ,
  ozon_last_error TEXT,
  target_amount NUMERIC NOT NULL DEFAULT 0,
  contribution_amount NUMERIC NOT NULL DEFAULT 500,
  account TEXT NOT NULL DEFAULT 'bank' CHECK (account IN ('cash', 'bank', 'ym_card')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  contributions JSONB NOT NULL DEFAULT '[]'::jsonb,
  spent_amount NUMERIC NOT NULL DEFAULT 0,
  spent_payment_id UUID,
  spent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_plans_status
  ON warehouse_purchase_plans(status);
CREATE INDEX IF NOT EXISTS idx_purchase_plans_product
  ON warehouse_purchase_plans(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_plans_ozon_refresh
  ON warehouse_purchase_plans(status, ozon_checked_at)
  WHERE ozon_url IS NOT NULL;

ALTER TABLE warehouse_purchase_plans ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_purchase_plans_updated ON warehouse_purchase_plans;
CREATE TRIGGER trg_purchase_plans_updated
  BEFORE UPDATE ON warehouse_purchase_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
