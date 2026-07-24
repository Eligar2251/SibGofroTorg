-- Миграция: добавление отслеживания частичных отгрузок
-- shipped_items: [{productId, name, shippedQty}] — кумулятивно по всем отгрузкам

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS shipped_items JSONB DEFAULT '[]'::jsonb;
