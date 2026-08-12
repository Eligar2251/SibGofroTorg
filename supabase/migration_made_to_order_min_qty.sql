-- Добавление поля минимального количества для товаров под заказ
ALTER TABLE products ADD COLUMN IF NOT EXISTS made_to_order_min_qty INT;
CREATE INDEX IF NOT EXISTS idx_products_made_to_order ON products(made_to_order) WHERE made_to_order = TRUE;
