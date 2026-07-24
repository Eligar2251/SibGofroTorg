-- =========================================================
-- Миграция: доставка + явные поля у заказов учёта (customer_deals)
-- Идемпотентно. Запустить в SQL Editor Supabase.
-- =========================================================

ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS has_delivery BOOLEAN DEFAULT FALSE;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_type TEXT;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_cost NUMERIC DEFAULT 0;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_planned_date DATE;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_released_at TIMESTAMPTZ;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_deals_delivery_type_check'
  ) THEN
    ALTER TABLE customer_deals
      ADD CONSTRAINT customer_deals_delivery_type_check
      CHECK (delivery_type IS NULL OR delivery_type IN ('free', 'paid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deals_has_delivery ON customer_deals(has_delivery) WHERE has_delivery = TRUE;
CREATE INDEX IF NOT EXISTS idx_deals_delivery_planned ON customer_deals(delivery_planned_date) WHERE has_delivery = TRUE;

-- Если адрес доставки пуст, а address заполнен — копируем как адрес доставки (только для уже помеченных)
UPDATE customer_deals
SET delivery_address = address
WHERE has_delivery = TRUE
  AND (delivery_address IS NULL OR delivery_address = '')
  AND address IS NOT NULL
  AND address <> '';
