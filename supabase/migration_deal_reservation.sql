-- Миграция: резерв товара под заказ + контактные лица доставки.
-- 1) Флаг is_reserved: заказ зарезервирован (выставлен счёт), товары из него
--    не продаются другим клиентам.
-- 2) Поля delivery_contact / delivery_phone — контактное лицо на адресе доставки
--    (чтобы не хранить только телефон покупателя).
ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS is_reserved BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_deals_reserved
  ON customer_deals(is_reserved)
  WHERE is_reserved = TRUE AND status <> 'cancelled';

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS delivery_contact TEXT NULL,
  ADD COLUMN IF NOT EXISTS delivery_phone TEXT NULL;
