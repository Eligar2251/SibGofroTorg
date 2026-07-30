-- Быстрый поиск всех поступлений и заказов по конкретному товару
-- для выпадающей сводки на вкладке «Учёт → Склад».
--
-- Сводка использует JSONB containment (`items @> '[{"productId":"…"}]'`).
-- Без этих индексов она тоже работает, но на большой архивной базе PostgreSQL
-- пришлось бы просматривать все документы при каждом первом открытии товара.

CREATE INDEX IF NOT EXISTS idx_receipts_items_gin
  ON warehouse_receipts USING GIN (items jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_deals_items_gin
  ON customer_deals USING GIN (items jsonb_path_ops);
