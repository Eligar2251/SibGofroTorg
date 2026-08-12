-- =========================================================
-- Миграция: закупочная цена товара
-- Добавляет поле purchase_price в таблицу products.
-- Используется в отчёте «Популярность продаж» и карточке товара
-- для расчёта прибыли. Если у товара нет последней поставки,
-- закупочная цена берётся отсюда.
-- Идемпотентно.
-- =========================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC;

COMMENT ON COLUMN products.purchase_price IS
  'Закупочная цена товара (по умолчанию / последняя известная). Используется для расчёта прибыли в отчётах.';

CREATE INDEX IF NOT EXISTS idx_products_purchase_price ON products(purchase_price) WHERE purchase_price IS NOT NULL;
