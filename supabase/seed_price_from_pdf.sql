-- =========================================================
-- SQL: категории + товары из прайса
-- Источник: «Прайс с размерами 10.12.2024 Сибгофроторг Ватутина 42а к1»
--
-- ВАЖНО: бинарный PDF не попал в среду агента, поэтому ниже —
-- каркас с категориями и ПРИМЕРАМИ строк товаров в том формате,
-- который нужен схеме. Дополните VALUES реальными позициями
-- из PDF (или пришлите прайс .xlsx/.csv — сгенерирую полный SQL).
--
-- Идемпотентно: категории/товары по slug upsert.
-- Запуск: SQL Editor Supabase.
-- =========================================================

-- 1) Категории (типовые для гофротары)
INSERT INTO categories (name, slug, icon, description, sort_order, is_visible)
VALUES
  ('Гофроящик', 'gofroyaschik', 'box', 'Гофроящики стандартных и нестандартных размеров', 10, TRUE),
  ('Четырёхклапанный ящик', 'chetyrehklapannyj-yaschik', 'box', 'Четырёхклапанные гофроящики', 20, TRUE),
  ('Лоток / обечайка', 'lotok-obechajka', 'layers', 'Лотки и обечайки из гофрокартона', 30, TRUE),
  ('Гофрокартон листовой', 'gofrokarton-listovoj', 'layers', 'Листы гофрокартона', 40, TRUE),
  ('Комплектующие', 'komplektuyuschie', 'package', 'Прокладки, решётки, вкладыши', 50, TRUE)
ON CONFLICT DO NOTHING;

-- На случай если UNIQUE(slug) нет — гарантируем наличие через update+insert
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('Гофроящик', 'gofroyaschik', 'box', 'Гофроящики стандартных и нестандартных размеров', 10),
      ('Четырёхклапанный ящик', 'chetyrehklapannyj-yaschik', 'box', 'Четырёхклапанные гофроящики', 20),
      ('Лоток / обечайка', 'lotok-obechajka', 'layers', 'Лотки и обечайки из гофрокартона', 30),
      ('Гофрокартон листовой', 'gofrokarton-listovoj', 'layers', 'Листы гофрокартона', 40),
      ('Комплектующие', 'komplektuyuschie', 'package', 'Прокладки, решётки, вкладыши', 50)
    ) AS t(name, slug, icon, description, sort_order)
  LOOP
    IF EXISTS (SELECT 1 FROM categories WHERE slug = rec.slug) THEN
      UPDATE categories SET
        name = rec.name,
        icon = rec.icon,
        description = rec.description,
        sort_order = rec.sort_order,
        is_visible = TRUE,
        updated_at = NOW()
      WHERE slug = rec.slug;
    ELSE
      INSERT INTO categories (name, slug, icon, description, sort_order, is_visible)
      VALUES (rec.name, rec.slug, rec.icon, rec.description, rec.sort_order, TRUE);
    END IF;
  END LOOP;
END $$;

-- 2) Функция upsert товара по slug
CREATE OR REPLACE FUNCTION seed_upsert_product(
  p_name TEXT,
  p_slug TEXT,
  p_category_slug TEXT,
  p_sku TEXT,
  p_price NUMERIC,
  p_price_wholesale NUMERIC,
  p_min_wholesale_qty INT,
  p_len NUMERIC,
  p_width NUMERIC,
  p_height NUMERIC,
  p_unit TEXT,
  p_material TEXT,
  p_pack_qty INT,
  p_stock_qty INT,
  p_description TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_cat UUID;
BEGIN
  SELECT id INTO v_cat FROM categories WHERE slug = p_category_slug LIMIT 1;

  IF EXISTS (SELECT 1 FROM products WHERE slug = p_slug) THEN
    UPDATE products SET
      name = p_name,
      category_id = v_cat,
      sku = p_sku,
      price = p_price,
      price_wholesale = p_price_wholesale,
      min_wholesale_qty = p_min_wholesale_qty,
      dimension_length = p_len,
      dimension_width = p_width,
      dimension_height = p_height,
      dimension_unit = COALESCE(p_unit, 'мм'),
      material = p_material,
      pack_qty = p_pack_qty,
      stock_qty = COALESCE(p_stock_qty, stock_qty),
      in_stock = COALESCE(p_stock_qty, stock_qty, 0) > 0,
      description = COALESCE(p_description, description),
      is_visible = TRUE,
      updated_at = NOW()
    WHERE slug = p_slug;
  ELSE
    INSERT INTO products (
      name, slug, category_id, sku, price, price_wholesale, min_wholesale_qty,
      dimension_length, dimension_width, dimension_height, dimension_unit,
      material, pack_qty, stock_qty, in_stock, description, is_visible
    ) VALUES (
      p_name, p_slug, v_cat, p_sku, p_price, p_price_wholesale, p_min_wholesale_qty,
      p_len, p_width, p_height, COALESCE(p_unit, 'мм'),
      p_material, p_pack_qty, COALESCE(p_stock_qty, 0), COALESCE(p_stock_qty, 0) > 0,
      p_description, TRUE
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 3) ПРИМЕРЫ строк (замените/дополните по PDF)
-- Формат: name, slug, category_slug, sku, price, price_wholesale, min_opt, L, W, H, unit, material, pack, stock, desc
SELECT seed_upsert_product(
  'Ящик 670×370×370', 'yaschik-670-370-370', 'gofroyaschik', 'BOX-670-370-370',
  45, 38, 100, 670, 370, 370, 'мм', 'Т-23', 20, 0,
  'Гофроящик 670×370×370 мм, марка Т-23. Прайс от 10.12.2024.'
);
SELECT seed_upsert_product(
  'Ящик 600×400×400', 'yaschik-600-400-400', 'gofroyaschik', 'BOX-600-400-400',
  42, 36, 100, 600, 400, 400, 'мм', 'Т-23', 20, 0,
  'Гофроящик 600×400×400 мм. Прайс от 10.12.2024.'
);
SELECT seed_upsert_product(
  'Ящик 500×300×300', 'yaschik-500-300-300', 'gofroyaschik', 'BOX-500-300-300',
  35, 30, 100, 500, 300, 300, 'мм', 'Т-23', 25, 0,
  'Гофроящик 500×300×300 мм. Прайс от 10.12.2024.'
);
SELECT seed_upsert_product(
  'Ящик 400×300×300', 'yaschik-400-300-300', 'gofroyaschik', 'BOX-400-300-300',
  30, 26, 100, 400, 300, 300, 'мм', 'Т-23', 25, 0,
  'Гофроящик 400×300×300 мм. Прайс от 10.12.2024.'
);
SELECT seed_upsert_product(
  'Ящик 380×280×280', 'yaschik-380-280-280', 'gofroyaschik', 'BOX-380-280-280',
  28, 24, 100, 380, 280, 280, 'мм', 'Т-23', 30, 0,
  'Гофроящик 380×280×280 мм. Прайс от 10.12.2024.'
);
SELECT seed_upsert_product(
  'Ящик 350×250×250', 'yaschik-350-250-250', 'gofroyaschik', 'BOX-350-250-250',
  25, 22, 100, 350, 250, 250, 'мм', 'Т-23', 30, 0,
  'Гофроящик 350×250×250 мм. Прайс от 10.12.2024.'
);
SELECT seed_upsert_product(
  'Ящик 300×200×200', 'yaschik-300-200-200', 'gofroyaschik', 'BOX-300-200-200',
  20, 17, 100, 300, 200, 200, 'мм', 'Т-23', 40, 0,
  'Гофроящик 300×200×200 мм. Прайс от 10.12.2024.'
);
SELECT seed_upsert_product(
  'Лист гофрокартона 1200×800', 'list-1200-800', 'gofrokarton-listovoj', 'SHEET-1200-800',
  55, 48, 50, 1200, 800, NULL, 'мм', 'Т-23', 1, 0,
  'Лист гофрокартона 1200×800 мм. Прайс от 10.12.2024.'
);
SELECT seed_upsert_product(
  'Лоток 400×300×100', 'lotok-400-300-100', 'lotok-obechajka', 'TRAY-400-300-100',
  18, 15, 100, 400, 300, 100, 'мм', 'Т-23', 50, 0,
  'Лоток 400×300×100 мм. Прайс от 10.12.2024.'
);

-- 4) Шаблон для вставки остальных позиций из PDF:
-- Скопируйте строку и подставьте значения:
--
-- SELECT seed_upsert_product(
--   'Название из прайса',
--   'slug-latin-iz-nazvaniya',
--   'gofroyaschik',           -- slug категории
--   'ART-XXX',                -- артикул
--   0,                        -- цена розница
--   0,                        -- цена опт
--   100,                      -- мин. опт шт
--   0, 0, 0,                  -- L W H мм
--   'мм',
--   'Т-23',                   -- марка/профиль
--   20,                       -- в пачке
--   0,                        -- остаток (0 = под заказ/не задан)
--   'Описание / примечание из прайса'
-- );

-- Проверка:
-- SELECT c.name, count(p.id)
-- FROM categories c
-- LEFT JOIN products p ON p.category_id = c.id
-- GROUP BY c.name
-- ORDER BY c.name;
