-- Автоматический объём коробок и индивидуальные цвета товарных меток.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS promo_label_color TEXT,
  ADD COLUMN IF NOT EXISTS promo_label_text_color TEXT;

CREATE OR REPLACE FUNCTION calculate_product_box_volume()
RETURNS TRIGGER AS $$
DECLARE
  cubic_units NUMERIC;
  normalized_unit TEXT;
BEGIN
  IF NEW.dimension_length IS NULL OR NEW.dimension_length <= 0
     OR NEW.dimension_width IS NULL OR NEW.dimension_width <= 0
     OR NEW.dimension_height IS NULL OR NEW.dimension_height <= 0 THEN
    NEW.volume = NULL;
    RETURN NEW;
  END IF;

  cubic_units := NEW.dimension_length * NEW.dimension_width * NEW.dimension_height;
  normalized_unit := LOWER(COALESCE(NULLIF(TRIM(NEW.dimension_unit), ''), 'мм'));

  NEW.volume := ROUND(
    CASE
      WHEN normalized_unit IN ('м', 'm') THEN cubic_units * 1000
      WHEN normalized_unit IN ('см', 'cm') THEN cubic_units / 1000
      ELSE cubic_units / 1000000
    END,
    3
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_calculate_volume ON products;
CREATE TRIGGER trg_products_calculate_volume
  BEFORE INSERT OR UPDATE OF dimension_length, dimension_width, dimension_height, dimension_unit
  ON products
  FOR EACH ROW EXECUTE FUNCTION calculate_product_box_volume();

-- Заполняем объём у уже существующих позиций с полным комплектом размеров.
UPDATE products
SET volume = ROUND(
  CASE
    WHEN LOWER(COALESCE(NULLIF(TRIM(dimension_unit), ''), 'мм')) IN ('м', 'm')
      THEN dimension_length * dimension_width * dimension_height * 1000
    WHEN LOWER(COALESCE(NULLIF(TRIM(dimension_unit), ''), 'мм')) IN ('см', 'cm')
      THEN dimension_length * dimension_width * dimension_height / 1000
    ELSE dimension_length * dimension_width * dimension_height / 1000000
  END,
  3
)
WHERE dimension_length > 0
  AND dimension_width > 0
  AND dimension_height > 0;

-- Неполный набор размеров не должен показывать старое ручное значение.
UPDATE products
SET volume = NULL
WHERE dimension_length IS NULL OR dimension_length <= 0
   OR dimension_width IS NULL OR dimension_width <= 0
   OR dimension_height IS NULL OR dimension_height <= 0;
