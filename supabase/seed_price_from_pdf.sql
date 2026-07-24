-- =========================================================
-- SQL: категории + товары из прайса СибГофроТорг
-- Источник: прайс 10.12.2024 (Ватутина 42а к1)
-- Цены: исходные + 0,50 ₽
-- Идемпотентно (upsert по slug). SQL Editor Supabase.
-- =========================================================

-- ─── 1. Категории ─────────────────────────────────────────
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('Стандартные гофроящики четырехклапанные', 'gofroyaschiki-chetyrehklapannye', 'box',
       'Стандартные четырехклапанные гофроящики', 10),
      ('Кондитерские гофролотки (телевизор)', 'konditerskie-gofrolotki-televizor', 'layers',
       'Кондитерские гофролотки типа «телевизор»', 20),
      ('Пицца (квадрат)', 'picca-kvadrat', 'box',
       'Коробки для пиццы квадратные, микрогофра', 30),
      ('Миникороб самосборный', 'minikorob-samosbornyj', 'package',
       'Миникороба самосборные из микрогофры', 40),
      ('Гофроформат', 'gofroformat', 'layers',
       'Гофроформат (листы) 3-слойный', 50),
      ('Скотч (клейкая лента)', 'skotch-klejkaya-lenta', 'package',
       'Клейкая лента упаковочная', 60),
      ('Упаковочные материалы', 'upakovochnye-materialy', 'package',
       'Стрейч, пупырка, бумага и прочие материалы', 70)
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

-- ─── 2. Upsert товара ─────────────────────────────────────
CREATE OR REPLACE FUNCTION seed_upsert_product(
  p_name TEXT,
  p_slug TEXT,
  p_category_slug TEXT,
  p_sku TEXT,
  p_price NUMERIC,
  p_len NUMERIC,
  p_width NUMERIC,
  p_height NUMERIC,
  p_volume NUMERIC,
  p_material TEXT,
  p_note TEXT,
  p_made_to_order BOOLEAN DEFAULT FALSE,
  p_unit TEXT DEFAULT 'мм'
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
      dimension_length = p_len,
      dimension_width = p_width,
      dimension_height = p_height,
      dimension_unit = COALESCE(p_unit, 'мм'),
      volume = p_volume,
      material = p_material,
      note = p_note,
      made_to_order = COALESCE(p_made_to_order, FALSE),
      in_stock = CASE WHEN COALESCE(p_made_to_order, FALSE) THEN FALSE ELSE COALESCE(in_stock, TRUE) END,
      is_visible = TRUE,
      description = CONCAT_WS(
        E'\n',
        CASE WHEN p_len IS NOT NULL THEN
          'Размер: ' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM p_len::text)) ||
          '×' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM p_width::text)) ||
          CASE WHEN p_height IS NOT NULL THEN
            '×' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM p_height::text))
          ELSE '' END || ' ' || COALESCE(p_unit, 'мм')
        END,
        CASE WHEN p_volume IS NOT NULL THEN 'Объём: ' || p_volume::text || ' л' END,
        CASE WHEN p_material IS NOT NULL THEN 'Марка: ' || p_material END,
        CASE WHEN p_note IS NOT NULL THEN p_note END
      ),
      updated_at = NOW()
    WHERE slug = p_slug;
  ELSE
    INSERT INTO products (
      name, slug, category_id, sku, price,
      dimension_length, dimension_width, dimension_height, dimension_unit,
      volume, material, note, made_to_order, in_stock, stock_qty, is_visible, description
    ) VALUES (
      p_name, p_slug, v_cat, p_sku, p_price,
      p_len, p_width, p_height, COALESCE(p_unit, 'мм'),
      p_volume, p_material, p_note, COALESCE(p_made_to_order, FALSE),
      NOT COALESCE(p_made_to_order, FALSE),
      0,
      TRUE,
      CONCAT_WS(
        E'\n',
        CASE WHEN p_len IS NOT NULL THEN
          'Размер: ' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM p_len::text)) ||
          '×' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM p_width::text)) ||
          CASE WHEN p_height IS NOT NULL THEN
            '×' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM p_height::text))
          ELSE '' END || ' ' || COALESCE(p_unit, 'мм')
        END,
        CASE WHEN p_volume IS NOT NULL THEN 'Объём: ' || p_volume::text || ' л' END,
        CASE WHEN p_material IS NOT NULL THEN 'Марка: ' || p_material END,
        CASE WHEN p_note IS NOT NULL THEN p_note END
      )
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─── 3. Стандартные гофроящики четырехклапанные ───────────
-- цена = прайс + 0.50
SELECT seed_upsert_product('Ящик № 915', 'yaschik-915', 'gofroyaschiki-chetyrehklapannye', '915', 13.50, 150, 150, 100, 2.3, 'Т23К', 'Т23К');
SELECT seed_upsert_product('Ящик № 917', 'yaschik-917', 'gofroyaschiki-chetyrehklapannye', '917', 17.50, 200, 185, 130, 4.8, NULL, NULL);
SELECT seed_upsert_product('Ящик № 1446', 'yaschik-1446', 'gofroyaschiki-chetyrehklapannye', '1446', 22.50, 270, 220, 100, 5.9, NULL, NULL);
SELECT seed_upsert_product('Ящик № Д98', 'yaschik-d98', 'gofroyaschiki-chetyrehklapannye', 'D98', 17.00, 310, 170, 100, 5.3, 'Т23К', 'Т23К');
SELECT seed_upsert_product('Ящик № А57', 'yaschik-a57', 'gofroyaschiki-chetyrehklapannye', 'A57', 24.50, 260, 190, 170, 8.4, NULL, NULL);
SELECT seed_upsert_product('Ящик № 12', 'yaschik-12', 'gofroyaschiki-chetyrehklapannye', '12', 36.50, 380, 285, 95, 10.3, NULL, NULL);
SELECT seed_upsert_product('Ящик № 717', 'yaschik-717', 'gofroyaschiki-chetyrehklapannye', '717', 28.00, 310, 210, 170, 11.1, NULL, NULL);
SELECT seed_upsert_product('Ящик № 282', 'yaschik-282', 'gofroyaschiki-chetyrehklapannye', '282', 30.00, 380, 253, 120, 11.5, NULL, NULL);
SELECT seed_upsert_product('Ящик № 871', 'yaschik-871', 'gofroyaschiki-chetyrehklapannye', '871', NULL, 380, 253, 140, 13.5, NULL, 'Под заказ', TRUE);
SELECT seed_upsert_product('Ящик № 14', 'yaschik-14', 'gofroyaschiki-chetyrehklapannye', '14', 41.00, 380, 285, 142, 15.4, NULL, NULL);
SELECT seed_upsert_product('Ящик № 621', 'yaschik-621', 'gofroyaschiki-chetyrehklapannye', '621', 30.90, 505, 305, 107, 16.5, 'Т23К', 'Т23К, печать «Сметана»');
SELECT seed_upsert_product('Ящик № 36/1', 'yaschik-36-1', 'gofroyaschiki-chetyrehklapannye', '36-1', 45.50, 380, 300, 180, 20.5, NULL, NULL);
SELECT seed_upsert_product('Ящик № 52', 'yaschik-52', 'gofroyaschiki-chetyrehklapannye', '52', 51.50, 412, 310, 165, 21.1, NULL, NULL);
SELECT seed_upsert_product('Ящик № 819', 'yaschik-819', 'gofroyaschiki-chetyrehklapannye', '819', 46.50, 330, 233, 275, 21.1, NULL, NULL);
SELECT seed_upsert_product('Ящик № 7', 'yaschik-7', 'gofroyaschiki-chetyrehklapannye', '7', 43.50, 380, 253, 237, 22.8, NULL, NULL);
SELECT seed_upsert_product('Ящик № 17', 'yaschik-17', 'gofroyaschiki-chetyrehklapannye', '17', 46.50, 380, 285, 228, 24.7, NULL, NULL);
SELECT seed_upsert_product('Ящик № 28', 'yaschik-28', 'gofroyaschiki-chetyrehklapannye', '28', 66.50, 570, 285, 190, 30.9, NULL, NULL);
SELECT seed_upsert_product('Ящик № 38', 'yaschik-38', 'gofroyaschiki-chetyrehklapannye', '38', 60.00, 380, 304, 285, 32.9, NULL, NULL);
SELECT seed_upsert_product('Ящик № 21', 'yaschik-21', 'gofroyaschiki-chetyrehklapannye', '21', 64.50, 380, 380, 228, 32.9, NULL, NULL);
SELECT seed_upsert_product('Ящик № 722', 'yaschik-722', 'gofroyaschiki-chetyrehklapannye', '722', 66.50, 390, 330, 290, 37.3, NULL, NULL);
SELECT seed_upsert_product('Ящик № Б-76', 'yaschik-b-76', 'gofroyaschiki-chetyrehklapannye', 'B-76', 63.00, 450, 350, 250, 39.4, NULL, NULL);
SELECT seed_upsert_product('Ящик № 18', 'yaschik-18', 'gofroyaschiki-chetyrehklapannye', '18', 78.50, 630, 320, 340, 68.5, NULL, NULL);
SELECT seed_upsert_product('Ящик № 670', 'yaschik-670', 'gofroyaschiki-chetyrehklapannye', '670', 99.50, 600, 400, 400, 96.0, NULL, NULL);
SELECT seed_upsert_product('Ящик № 996', 'yaschik-996', 'gofroyaschiki-chetyrehklapannye', '996', 128.50, 565, 404, 494, 112.8, NULL, NULL);

-- ─── 4. Кондитерские гофролотки (телевизор) ───────────────
SELECT seed_upsert_product('Лоток 848 бел.', 'lotok-848-bel', 'konditerskie-gofrolotki-televizor', 'LOT-848-BEL', 35.50, 380, 280, 105, 11.2, NULL, 'белый');
SELECT seed_upsert_product('Лоток 60 бел.', 'lotok-60-bel', 'konditerskie-gofrolotki-televizor', 'LOT-60-BEL', 32.50, 390, 270, 60, 6.3, NULL, 'белый, двойные борта');
SELECT seed_upsert_product('Лоток С-33', 'lotok-s-33', 'konditerskie-gofrolotki-televizor', 'LOT-S-33', NULL, 375, 210, 90, 7.1, 'Т23К', 'Под заказ, Т23К', TRUE);
SELECT seed_upsert_product('Лоток С-297', 'lotok-s-297', 'konditerskie-gofrolotki-televizor', 'LOT-S-297', 28.00, 260, 155, 75, 3.0, NULL, 'белый');
SELECT seed_upsert_product('Лоток 46м бел.', 'lotok-46m-bel', 'konditerskie-gofrolotki-televizor', 'LOT-46M-BEL', 20.50, 258, 208, 48, 2.6, NULL, 'белый');
SELECT seed_upsert_product('Лоток С-23', 'lotok-s-23', 'konditerskie-gofrolotki-televizor', 'LOT-S-23', NULL, 270, 165, 76, 3.4, NULL, 'Под заказ', TRUE);
SELECT seed_upsert_product('Лоток С-323', 'lotok-s-323', 'konditerskie-gofrolotki-televizor', 'LOT-S-323', 19.00, 254, 191, 58, 2.8, NULL, NULL);
SELECT seed_upsert_product('Лоток С-324', 'lotok-s-324', 'konditerskie-gofrolotki-televizor', 'LOT-S-324', NULL, 282, 257, 60, 4.3, NULL, 'Под заказ', TRUE);

-- ─── 5. Пицца (квадрат) ───────────────────────────────────
SELECT seed_upsert_product('Пицца (квадрат) С56', 'picca-kvadrat-s56', 'picca-kvadrat', 'PIZ-S56', 22.50, 236, 236, 40, 2.2, 'микрогофра', 'микрогофра');
SELECT seed_upsert_product('Пицца (квадрат) С68', 'picca-kvadrat-s68', 'picca-kvadrat', 'PIZ-S68', 30.00, 290, 290, 42, 3.5, 'микрогофра', 'микрогофра');
SELECT seed_upsert_product('Пицца (квадрат) С52', 'picca-kvadrat-s52', 'picca-kvadrat', 'PIZ-S52', 37.00, 315, 315, 50, 5.0, 'микрогофра', 'микрогофра');

-- ─── 6. Миникороб самосборный ─────────────────────────────
SELECT seed_upsert_product('Миникороб 100', 'minikorob-100', 'minikorob-samosbornyj', 'MINI-100', 26.50, 100, 100, 100, 1.0, 'микрогофра', 'микрогофра, самосборный');
SELECT seed_upsert_product('Миникороб С247', 'minikorob-s247', 'minikorob-samosbornyj', 'MINI-S247', 24.50, 215, 110, 92, 2.2, 'микрогофра', 'микрогофра');
SELECT seed_upsert_product('Миникороб С45', 'minikorob-s45', 'minikorob-samosbornyj', 'MINI-S45', 22.50, 235, 103, 60, 1.5, 'микрогофра', 'микрогофра');
SELECT seed_upsert_product('Миникороб 45 мг', 'minikorob-45-mg', 'minikorob-samosbornyj', 'MINI-45-MG', 13.50, 170, 80, 63, 0.9, 'микрогофра', 'микрогофра');
SELECT seed_upsert_product('Миникороб 170', 'minikorob-170', 'minikorob-samosbornyj', 'MINI-170', 24.50, 170, 90, 90, 1.4, 'микрогофра', 'микрогофра');
SELECT seed_upsert_product('Миникороб С286', 'minikorob-s286', 'minikorob-samosbornyj', 'MINI-S286', 24.50, 305, 155, 55, 2.6, 'микрогофра', 'микрогофра');
SELECT seed_upsert_product('Миникороб АС150', 'minikorob-as150', 'minikorob-samosbornyj', 'MINI-AS150', 20.00, 150, 120, 56, 1.0, 'микрогофра', 'микрогофра');
SELECT seed_upsert_product('Миникороб АС250', 'minikorob-as250', 'minikorob-samosbornyj', 'MINI-AS250', 24.00, 250, 120, 60, 1.8, 'микрогофра', 'микрогофра');
SELECT seed_upsert_product('Миникороб АС255', 'minikorob-as255', 'minikorob-samosbornyj', 'MINI-AS255', 35.50, 255, 120, 90, 2.8, 'микрогофра', 'микрогофра');
SELECT seed_upsert_product('Миникороб АС450', 'minikorob-as450', 'minikorob-samosbornyj', 'MINI-AS450', 70.50, 450, 300, 70, 9.5, 'микрогофра', 'микрогофра, формат А3');

-- ─── 7. Гофроформат ───────────────────────────────────────
-- volume хранит площадь м²
SELECT seed_upsert_product('Гофроформат 3-х сл. 1400×2500', 'gofroformat-1400-2500', 'gofroformat', 'GF-1400-2500', 193.50, 1400, 2500, NULL, 3.50, '3-слойный', 'площадь 3,50 м²');
SELECT seed_upsert_product('Гофроформат 3-х сл. 1200×800', 'gofroformat-1200-800', 'gofroformat', 'GF-1200-800', 54.50, 1200, 800, NULL, 0.96, '3-слойный', 'площадь 0,96 м²');

-- ─── 8. Скотч ─────────────────────────────────────────────
SELECT seed_upsert_product('Скотч прозрачный 43 мк 48 мм × 60 м', 'skotch-prozrachnyj-48-60', 'skotch-klejkaya-lenta', 'TAPE-48-60-CLR', 70.50, 48, 60, NULL, NULL, '43 мк', 'прозрачный', FALSE, 'мм×м');
SELECT seed_upsert_product('Скотч прозрачный 43 мк 48 мм × 120 м', 'skotch-prozrachnyj-48-120', 'skotch-klejkaya-lenta', 'TAPE-48-120-CLR', 130.50, 48, 120, NULL, NULL, '43 мк', 'прозрачный, большая намотка', FALSE, 'мм×м');
SELECT seed_upsert_product('Скотч прозрачный 43 мк 72 мм × 60 м', 'skotch-prozrachnyj-72-60', 'skotch-klejkaya-lenta', 'TAPE-72-60-CLR', 110.50, 72, 60, NULL, NULL, '43 мк', 'прозрачный, широкий', FALSE, 'мм×м');
SELECT seed_upsert_product('Скотч тонированный 43 мк 48 мм × 60 м', 'skotch-tonirovannyj-48-60', 'skotch-klejkaya-lenta', 'TAPE-48-60-BRN', 70.50, 48, 60, NULL, NULL, '43 мк', 'коричневый', FALSE, 'мм×м');
SELECT seed_upsert_product('Скотч цветной 43 мк 48 мм × 60 м', 'skotch-cvetnoj-48-60', 'skotch-klejkaya-lenta', 'TAPE-48-60-COL', 90.50, 48, 60, NULL, NULL, '43 мк', 'цветной в ассортименте', FALSE, 'мм×м');

-- ─── 9. Упаковочные материалы ─────────────────────────────
SELECT seed_upsert_product('Стрейч-плёнка первичная 450–500 мм, 1,9 кг', 'strejch-pljonka-pervichnaya-1-9', 'upakovochnye-materialy', 'STRETCH-1.9', 550.50, 450, 500, NULL, NULL, NULL, 'первичная, 1,9 кг', FALSE, 'мм');
SELECT seed_upsert_product('Стрейч-плёнка вторичная 450–500 мм, 3 кг', 'strejch-pljonka-vtorichnaya-3', 'upakovochnye-materialy', 'STRETCH-3-SEC', NULL, 450, 500, NULL, NULL, NULL, 'вторичная, 3 кг; цена по запросу', TRUE, 'мм');
SELECT seed_upsert_product('Стрейч-плёнка первичная 450 мм, 0,496 кг', 'strejch-pljonka-pervichnaya-0-496', 'upakovochnye-materialy', 'STRETCH-0.496', NULL, 450, NULL, NULL, NULL, NULL, 'первичная, 0,496 кг; цена по запросу', TRUE, 'мм');
SELECT seed_upsert_product('ВПП (пупырка)', 'vpp-pupyrka', 'upakovochnye-materialy', 'VPP', NULL, NULL, NULL, NULL, NULL, NULL, 'цена за м² по запросу', TRUE, 'мм');
SELECT seed_upsert_product('Подпергамент «П» 52 г/м² 420×300', 'podpergament-p-52-420-300', 'upakovochnye-materialy', 'PERG-420-300', NULL, 420, 300, NULL, NULL, '52 г/м²', 'пачка 1 000 л.; цена по запросу', TRUE, 'мм');
SELECT seed_upsert_product('Крафт-бумага 78 г/м² 840×600', 'kraft-bumaga-78-840-600', 'upakovochnye-materialy', 'KRAFT-840-600', NULL, 840, 600, NULL, NULL, '78 г/м²', 'пачка 250 л.; цена по запросу', TRUE, 'мм');

-- ─── Проверка ─────────────────────────────────────────────
-- SELECT c.name AS category, count(p.id) AS products
-- FROM categories c
-- LEFT JOIN products p ON p.category_id = c.id
-- WHERE c.slug IN (
--   'gofroyaschiki-chetyrehklapannye','konditerskie-gofrolotki-televizor',
--   'picca-kvadrat','minikorob-samosbornyj','gofroformat',
--   'skotch-klejkaya-lenta','upakovochnye-materialy'
-- )
-- GROUP BY c.name, c.sort_order
-- ORDER BY c.sort_order;
