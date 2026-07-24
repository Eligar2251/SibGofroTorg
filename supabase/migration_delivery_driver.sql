-- =========================================================
-- Миграция: водитель на доставке заказа учёта
-- Идемпотентно. SQL Editor Supabase.
-- =========================================================

ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_driver_id UUID;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_driver_name TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_delivery_driver
  ON customer_deals(delivery_driver_id)
  WHERE has_delivery = TRUE;
