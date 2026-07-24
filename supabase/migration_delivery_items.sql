-- Миграция: отслеживание количества в доставках
-- delivery_items: [{productId, name, quantity}] — сколько товара запланировано на эту доставку

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS delivery_items JSONB DEFAULT '[]'::jsonb;
