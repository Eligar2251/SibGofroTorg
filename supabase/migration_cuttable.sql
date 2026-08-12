-- =========================================================
-- Миграция: вариативность товара (рулон / метры)
-- Для плёнки пузырчатой и т.п.: рулон = 100м, но можно
-- отматывать по метрам. Остаток помечается автоматически:
-- 5 рулонов по 100м + один рулон 90м = 5.9 рулона.
-- =========================================================

-- Новые поля в products
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_cuttable BOOLEAN DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cut_meters_per_roll NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cut_price_per_meter NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cut_unit_name TEXT DEFAULT 'м';

-- stock_qty ранее был INT, теперь нужен NUMERIC для дробных рулонов (5.9)
-- Меняем тип безопасно через USING
DO $$
BEGIN
  -- Проверяем текущий тип
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='stock_qty' AND data_type='integer'
  ) THEN
    ALTER TABLE products ALTER COLUMN stock_qty TYPE NUMERIC USING stock_qty::NUMERIC;
  END IF;
END $$;

-- Индекс для быстрого поиска резаных товаров
CREATE INDEX IF NOT EXISTS idx_products_cuttable ON products(is_cuttable) WHERE is_cuttable = TRUE;

-- Комментарии
COMMENT ON COLUMN products.is_cuttable IS 'Товар можно продавать рулонами и метрами (отмотка). Остаток в рулонах дробный.';
COMMENT ON COLUMN products.cut_meters_per_roll IS 'Метров в одном рулоне (напр. 100)';
COMMENT ON COLUMN products.cut_price_per_meter IS 'Цена за метр при отмотке';
COMMENT ON COLUMN products.cut_unit_name IS 'Единица отмотки, напр. м';
