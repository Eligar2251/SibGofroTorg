-- Автоматическая синхронизация наличия товара (in_stock) со складским остатком (stock_qty).
-- Идемпотентная миграция: безопасно запускать повторно в Supabase SQL Editor.

ALTER TABLE products ALTER COLUMN stock_qty SET DEFAULT 0;
ALTER TABLE products ALTER COLUMN in_stock SET DEFAULT FALSE;

UPDATE products
SET
  stock_qty = COALESCE(stock_qty, 0),
  in_stock = (FLOOR(COALESCE(stock_qty, 0)) >= 1)
WHERE stock_qty IS NULL
   OR in_stock IS DISTINCT FROM (FLOOR(COALESCE(stock_qty, 0)) >= 1);

CREATE OR REPLACE FUNCTION sync_product_in_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stock_qty IS NULL THEN
    NEW.stock_qty := 0;
  END IF;
  NEW.in_stock := FLOOR(NEW.stock_qty) >= 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_sync_in_stock ON products;
CREATE TRIGGER trg_products_sync_in_stock
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION sync_product_in_stock();
