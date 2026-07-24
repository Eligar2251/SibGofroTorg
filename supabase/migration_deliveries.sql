-- =========================================================
-- Миграция: доставка заказов + планирование
-- Запустить в SQL Editor Supabase (идемпотентно).
-- =========================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_delivery BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_cost NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_planned_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_released_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_note TEXT;

-- Ограничение типа доставки (если ещё нет)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_type_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_delivery_type_check
      CHECK (delivery_type IS NULL OR delivery_type IN ('free', 'paid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_has_delivery ON orders(has_delivery) WHERE has_delivery = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_delivery_planned ON orders(delivery_planned_date) WHERE has_delivery = TRUE;
