-- Ссылки Ozon и автоматически обновляемые метаданные планов закупок.

ALTER TABLE warehouse_purchase_plans
  ADD COLUMN IF NOT EXISTS ozon_url TEXT,
  ADD COLUMN IF NOT EXISTS ozon_image_url TEXT,
  ADD COLUMN IF NOT EXISTS ozon_price NUMERIC,
  ADD COLUMN IF NOT EXISTS ozon_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ozon_price_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ozon_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_plans_ozon_refresh
  ON warehouse_purchase_plans(status, ozon_checked_at)
  WHERE ozon_url IS NOT NULL;
