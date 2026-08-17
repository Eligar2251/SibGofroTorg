-- =========================================================
-- Миграция: «Распродажа остатков» — флаг товара на распродажу.
-- Товары с is_sale = TRUE показываются в секции «Распродажа
-- остатков» на главной странице (перед «Популярными товарами»).
-- =========================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_sale BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_products_sale ON products(is_sale) WHERE is_sale = TRUE;
