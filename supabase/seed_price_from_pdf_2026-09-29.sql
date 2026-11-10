-- =========================================================
-- SQL: КАТАЛОГ ПО ПРАЙСУ «КОРОБКИ — 29.09.2026» (147 позиций)
-- Файл: supabase/seed_price_from_pdf_2026-09-29.sql
--
-- Источник: «Прайс (1).pdf» — прайс от 29.09.2026 (Новосибирск, Ватутина 42а к1).
--   Забраны ВСЕ 147 позиций: название, размеры и цена — один в один из прайса,
--   без наценки. Пустая цена в прайсе → цена по запросу (made_to_order = TRUE).
--
-- Артикулы — в стиле «Бланка ревизии склада» (04.09.2026):
--   GK-…            гофроящик четырехклапанный        ('Ящик № 12' → GK-12)
--   G-MINI-…        миникороб / самосборный            ('Миникороб 45 мг' → G-MINI-45-MG)
--   OGK-…           овощной ящик                       ('Овощной ящик № 143' → OGK-143)
--   PIZ-…           пицца                              ('Пицца (квадрат) С52' → PIZ-S52)
--   G-LOT-…         лоток «телевизор»                  ('Лоток 848 бел.' → G-LOT-848-BEL)
--   GF-… / GF-ROLL-…гофроформат лист / рулон
--   TAPE-…, STRETCH-…, VPP-…, PERG-…, KRAFT-…, PAPER-…, GK-PAD-…
--   BAGS-…, CORNER-…, FILLER-…, MARKER-…, GLOVES-…, DIE-…
--
-- ЧТО ДЕЛАЕТ
--   1. Создаёт/обновляет 11 категорий каталога.
--   2. Заполняет 147 товаров: артикул, цена, размеры (Д×Ш×В, мм), материал,
--      вес, упаковка, примечание; объём считает триггер БД; скотч получает
--      тип размеров «Скотч (Ш×Д×мкм)» (если применён migration_dimension_profiles.sql).
--   3. Идемпотентно: позиция ищется по артикулу → slug → названию, поэтому
--      повторный запуск обновляет карточки, а не создаёт дубликаты.
--      Товар НЕ создаётся заново, если он уже есть под другим артикулом/названием
--      (прайс 10.12.2024 → этот прайс), см. п. 2.1.
--   4. Остатки (stock_qty / in_stock) не трогает — это дело склада.
--
-- ТРЕБУЕТ применённую схему: supabase/schema.sql + migration_dimension_profiles.sql,
--   migration_cuttable.sql, migration_product_volume_and_label_colors.sql,
--   migration_stock_sync.sql — или целиком supabase/FULL_DATABASE_MIGRATION.sql.
--
-- ЗАПУСК: Supabase → SQL Editor → вставить файл целиком → Run.
-- ЗАМЕНА: supabase/seed_price_from_pdf.sql (прайс 10.12.2024) — этот файл актуальнее.
-- =========================================================

BEGIN;

-- ─── 1. Категории прайса ────────────────────────────────────────
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('Стандартные гофроящики четырехклапанные', 'gofroyaschiki-chetyrehklapannye', 'box',
       'Четырехклапанные гофрокоробы для товара, переезда и маркетплейсов', 10),
      ('Овощные гофроящики', 'ovoshchnye-gofroyaschiki', 'box',
       'Гофрокоробы для овощей, фруктов и консервации', 20),
      ('Кондитерские гофролотки (телевизор)', 'konditerskie-gofrolotki-televizor', 'gift',
       'Открытые лотки «телевизор» для кондитерских изделий', 30),
      ('Пицца (квадрат)', 'picca-kvadrat', 'box',
       'Квадратные коробки для пиццы из микрогофры', 40),
      ('Миникороб самосборный', 'minikorob-samosbornyj', 'box',
       'Самосборные миникороба из микрогофры — для маркетплейсов и мелкой продукции', 50),
      ('Гофроформат', 'gofroformat', 'file',
       'Гофролист 2-х и 3-слойный: листы и рулоны, микрогофра', 60),
      ('Скотч (клейкая лента)', 'skotch-klejkaya-lenta', 'box',
       'Упаковочная клейкая лента 43 мк: прозрачная, тонированная, цветная', 70),
      ('Упаковочная плёнка', 'plenka-upakovochnaya', 'box',
       'Стрейч-плёнка и воздушно-пузырьковая плёнка: рулоны, намотка, метражом', 80),
      ('Бумага и картонные материалы', 'bumaga-i-kartonnye-materialy', 'books',
       'Крафт-бумага, подпергамент, оберточная бумага, картонные прокладки', 90),
      ('Упаковочные и сопутствующие материалы', 'upakovochnye-materialy', 'cart',
       'Мешки, уголки, наполнитель, перчатки, маркеры — всё для отгрузки', 100),
      ('Оснастка (штанцформы)', 'osnastka-i-oborudovanie', 'settings',
       'Плоские штанцформы под профили B и E', 110)
    ) AS t(name, slug, icon, description, sort_order)
  LOOP
    IF EXISTS (SELECT 1 FROM categories WHERE slug = rec.slug) THEN
      UPDATE categories SET
        name = rec.name,
        description = rec.description,
        sort_order = rec.sort_order,
        is_visible = TRUE,
        icon = CASE WHEN icon IS NULL OR BTRIM(icon) = '' THEN rec.icon ELSE icon END,
        updated_at = NOW()
      WHERE slug = rec.slug;
    ELSE
      INSERT INTO categories (name, slug, icon, description, sort_order, is_visible)
      VALUES (rec.name, rec.slug, rec.icon, rec.description, rec.sort_order, TRUE);
    END IF;
  END LOOP;
END $$;


-- ─── 2. Функция upsertа товара из прайса ────────────────────────
-- Число «как в прайсе»: 1200 → «1200», 13.5 → «13,5», 3.0 → «3».
CREATE OR REPLACE FUNCTION seed_price_num(v NUMERIC) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN v IS NULL THEN NULL
    WHEN v::text LIKE '%.%' THEN RTRIM(RTRIM(REPLACE(v::text, '.', ','), '0'), ',')
    ELSE REPLACE(v::text, '.', ',')
  END;
$$;

CREATE OR REPLACE FUNCTION seed_price_product(
  p_sku         TEXT,                    -- артикул
  p_name        TEXT,                    -- название как в прайсе
  p_category    TEXT,                    -- slug категории
  p_slug        TEXT,                    -- желаемый slug (для поиска новых)
  p_len         NUMERIC DEFAULT NULL,    -- длина, мм
  p_width       NUMERIC DEFAULT NULL,    -- ширина, мм (у плёнки/ленты — намотка, м)
  p_height      NUMERIC DEFAULT NULL,    -- высота, мм
  p_price       NUMERIC DEFAULT NULL,    -- цена за единицу, ₽; NULL = по запросу
  p_unit        TEXT DEFAULT 'мм',       -- единица размеров: 'мм' | 'мм×м'
  p_material    TEXT DEFAULT NULL,       -- материал / марка
  p_note        TEXT DEFAULT NULL,       -- примечание в карточке
  p_pack_qty    INT DEFAULT NULL,        -- штук в упаковке
  p_weight      NUMERIC DEFAULT NULL,    -- вес единицы, кг
  p_thickness   NUMERIC DEFAULT NULL,    -- толщина, мкм (для типа размеров 'tape')
  p_roll_meters NUMERIC DEFAULT NULL,    -- метров в рулоне → продажа метражом
  p_profile     TEXT DEFAULT NULL        -- тип размеров: 'tape'
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_cat   UUID;
  v_id    UUID;
  v_try   TEXT;
  v_n     INT := 0;
  v_prof  UUID;
  v_vals  JSONB;
  v_size  TEXT;
  v_desc  TEXT;
BEGIN
  IF p_category IS NOT NULL THEN
    SELECT id INTO v_cat FROM categories WHERE slug = p_category LIMIT 1;
    IF v_cat IS NULL THEN
      RAISE WARNING 'seed_price_product: категория % не найдена — товар без категории', p_category;
    END IF;
  END IF;

  -- ── строка размеров и описание ──
  v_size := CASE
    WHEN p_len IS NOT NULL AND p_width IS NOT NULL AND p_height IS NOT NULL
      THEN seed_price_num(p_len) || '×' || seed_price_num(p_width) || '×' ||
           seed_price_num(p_height) || ' ' || COALESCE(NULLIF(p_unit, ''), 'мм')
    WHEN p_len IS NOT NULL AND p_width IS NOT NULL
      THEN seed_price_num(p_len) || '×' || seed_price_num(p_width) ||
           ' ' || COALESCE(NULLIF(p_unit, ''), 'мм')
    WHEN p_len IS NOT NULL
      THEN seed_price_num(p_len) || ' ' || COALESCE(NULLIF(p_unit, ''), 'мм')
    ELSE NULL
  END;

  v_desc := NULLIF(CONCAT_WS(E'\n',
    CASE WHEN v_size IS NOT NULL     THEN 'Размер: ' || v_size END,
    CASE WHEN p_material IS NOT NULL THEN 'Материал: ' || p_material END,
    CASE WHEN p_pack_qty IS NOT NULL THEN 'В упаковке: ' || p_pack_qty::text || ' шт.' END,
    CASE WHEN p_weight IS NOT NULL   THEN 'Вес: ' || seed_price_num(p_weight) || ' кг' END,
    p_note
  ), '');

  -- ── тип размеров + значения (скотч: Ш×Д×Т) ──
  IF p_profile = 'tape' AND to_regclass('public.product_dimension_profiles') IS NOT NULL THEN
    BEGIN
      SELECT id INTO v_prof FROM product_dimension_profiles WHERE slug = 'tape' LIMIT 1;
      IF v_prof IS NOT NULL THEN
        v_vals := jsonb_build_array(
          jsonb_build_object('key', 'width',     'label', 'Ширина',
                             'value', NULLIF(p_len, 0),       'unit', 'мм'),
          jsonb_build_object('key', 'length',    'label', 'Длина',
                             'value', NULLIF(p_width, 0),     'unit', 'м'),
          jsonb_build_object('key', 'thickness', 'label', 'Толщина',
                             'value', NULLIF(p_thickness, 0), 'unit', 'мкм')
        );
      END IF;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      v_prof := NULL;
      v_vals := NULL;
    END;
  END IF;

  -- ── ищем существующую карточку: артикул → slug → название ──
  SELECT id INTO v_id FROM products
   WHERE sku IS NOT NULL AND UPPER(BTRIM(sku)) = UPPER(BTRIM(p_sku))
   ORDER BY id LIMIT 1;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM products WHERE slug = p_slug ORDER BY id LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM products
     WHERE LOWER(REGEXP_REPLACE(BTRIM(name), '\s+', ' ', 'g')) =
           LOWER(REGEXP_REPLACE(BTRIM(p_name), '\s+', ' ', 'g'))
     ORDER BY id LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE products SET
      name = p_name,
      sku  = p_sku,
      category_id = CASE WHEN v_cat IS NOT NULL AND (category_id IS NULL OR EXISTS (
                      SELECT 1 FROM categories mc
                      WHERE mc.id = products.category_id
                        AND mc.slug IN ('gofroyaschiki-chetyrehklapannye','ovoshchnye-gofroyaschiki','konditerskie-gofrolotki-televizor','picca-kvadrat','minikorob-samosbornyj','gofroformat','skotch-klejkaya-lenta','plenka-upakovochnaya','bumaga-i-kartonnye-materialy','upakovochnye-materialy','osnastka-i-oborudovanie')))
                     THEN v_cat ELSE category_id END,
      price            = COALESCE(p_price, price),
      dimension_length = COALESCE(p_len, dimension_length),
      dimension_width  = COALESCE(p_width, dimension_width),
      dimension_height = COALESCE(p_height, dimension_height),
      dimension_unit   = COALESCE(NULLIF(p_unit, ''), dimension_unit),
      material         = COALESCE(p_material, material),
      note             = COALESCE(p_note, note),
      pack_qty         = COALESCE(p_pack_qty, pack_qty),
      weight           = COALESCE(p_weight, weight),
      -- «цена по запросу» из прайса → помечаем «под заказ»; снимаем флаг только
      -- у тех карточек, где он стоит из-за пустой цены (прайс дал цену),
      -- ручную отметку менеджера не трогаем
      made_to_order    = CASE WHEN p_price IS NULL THEN TRUE
                              WHEN COALESCE(made_to_order, FALSE) AND price IS NULL THEN FALSE
                              ELSE made_to_order END,
      is_cuttable         = CASE WHEN p_roll_meters IS NOT NULL THEN TRUE ELSE is_cuttable END,
      cut_meters_per_roll = COALESCE(p_roll_meters, cut_meters_per_roll),
      cut_price_per_meter = CASE WHEN p_roll_meters IS NOT NULL AND p_price IS NOT NULL
                                 THEN ROUND(p_price / p_roll_meters, 2)
                                 ELSE cut_price_per_meter END,
      cut_unit_name       = CASE WHEN p_roll_meters IS NOT NULL THEN 'м' ELSE cut_unit_name END,
      -- описание перезаписываем только если оно пустое или сгенерировано сидом
      description = CASE WHEN description IS NULL OR BTRIM(description) = ''
                           OR description LIKE 'Размер:%'
                         THEN COALESCE(v_desc, description) ELSE description END,
      dimension_profile_id = COALESCE(v_prof, dimension_profile_id),
      dimension_values     = COALESCE(v_vals, dimension_values),
      is_visible  = TRUE,
      updated_by  = 'импорт прайса 29.09.2026',
      updated_at  = NOW()
    WHERE id = v_id;
    RETURN 'updated ' || p_sku;
  END IF;

  -- ── новая карточка: подбираем свободный slug ──
  v_try := p_slug;
  WHILE EXISTS (SELECT 1 FROM products WHERE slug = v_try) LOOP
    v_n := v_n + 1;
    v_try := p_slug || '-' || v_n::text;
  END LOOP;

  INSERT INTO products (
    name, slug, category_id, sku, price,
    dimension_length, dimension_width, dimension_height, dimension_unit,
    material, note, pack_qty, weight, description,
    made_to_order, is_cuttable, cut_meters_per_roll, cut_price_per_meter, cut_unit_name,
    dimension_profile_id, dimension_values,
    in_stock, stock_qty, is_visible, updated_by
  ) VALUES (
    p_name, v_try, v_cat, p_sku, p_price,
    p_len, p_width, p_height, COALESCE(NULLIF(p_unit, ''), 'мм'),
    p_material, p_note, p_pack_qty, p_weight, v_desc,
    (p_price IS NULL), (p_roll_meters IS NOT NULL), p_roll_meters,
    CASE WHEN p_roll_meters IS NOT NULL AND p_price IS NOT NULL
         THEN ROUND(p_price / p_roll_meters, 2) END,
    CASE WHEN p_roll_meters IS NOT NULL THEN 'м' END,
    v_prof, v_vals,
    FALSE, 0, TRUE, 'импорт прайса 29.09.2026'
  );
  RETURN 'inserted ' || p_sku;
END $$;

-- ─── 2.1 Позиции, которые прайс переименовал/перенумеровал ──────
-- Подставляем новый артикул старой карточке, чтобы п. 3 обновил её,
-- а не создал дубликат. Условие: старый артикул есть, нового ещё нет.
UPDATE products p SET
  sku = a.new_sku,
  updated_at = NOW()
FROM (VALUES
  ('621',        'GK-6212'),      -- «Ящик № 621» → «Ящик № 6212» (505×305×107)
  ('MINI-170',   'G-MINI-170'),   -- «Миникороб 170» → «Миникороб №170»
  ('VPP',        'VPP-1200-100')  -- «ВПП (пупырка)» → конкретный рулон 1,2×100 м
) AS a(old_sku, new_sku)
WHERE UPPER(BTRIM(p.sku)) = UPPER(a.old_sku)
  AND NOT EXISTS (SELECT 1 FROM products n WHERE UPPER(BTRIM(n.sku)) = UPPER(a.new_sku));

-- ─── 3. Товары из прайса (147 позиций) ─────────────────────────
DO $$
BEGIN
  -- · Стандартные гофроящики четырехклапанные — 66 шт.
  PERFORM seed_price_product('GK-1280', 'Ящик № 1280', 'gofroyaschiki-chetyrehklapannye', 'yashchik-1280', 1200, 800, 800, 629);
  PERFORM seed_price_product('GK-510', 'Ящик № 510', 'gofroyaschiki-chetyrehklapannye', 'yashchik-510', 1200, 400, 400, 200);
  PERFORM seed_price_product('GK-890', 'Ящик № 890', 'gofroyaschiki-chetyrehklapannye', 'yashchik-890', 800, 400, 500, 150);
  PERFORM seed_price_product('GK-751', 'Ящик № 751', 'gofroyaschiki-chetyrehklapannye', 'yashchik-751', 750, 360, 430, 143);
  PERFORM seed_price_product('GK-996', 'Ящик № 996', 'gofroyaschiki-chetyrehklapannye', 'yashchik-996', 565, 404, 494, 131);
  PERFORM seed_price_product('GK-670', 'Ящик № 670', 'gofroyaschiki-chetyrehklapannye', 'yashchik-670', 600, 400, 400, 101);
  PERFORM seed_price_product('GK-335', 'Ящик № 335', 'gofroyaschiki-chetyrehklapannye', 'yashchik-335', 600, 400, 285, 99);
  PERFORM seed_price_product('GK-B80', 'Ящик № Б80', 'gofroyaschiki-chetyrehklapannye', 'yashchik-b80', 486, 286, 286, 93.5);
  PERFORM seed_price_product('GK-6399', 'Ящик № 6399', 'gofroyaschiki-chetyrehklapannye', 'yashchik-6399', 420, 380, 275, 86);
  PERFORM seed_price_product('GK-653', 'Ящик № 653', 'gofroyaschiki-chetyrehklapannye', 'yashchik-653', 600, 300, 230, 80);
  PERFORM seed_price_product('GK-18', 'Ящик № 18', 'gofroyaschiki-chetyrehklapannye', 'yashchik-18', 630, 320, 340, 79.5);
  PERFORM seed_price_product('GK-28', 'Ящик № 28', 'gofroyaschiki-chetyrehklapannye', 'yashchik-28', 570, 285, 190, 67.5);
  PERFORM seed_price_product('GK-722', 'Ящик № 722', 'gofroyaschiki-chetyrehklapannye', 'yashchik-722', 390, 330, 290, 67.5);
  PERFORM seed_price_product('GK-21', 'Ящик № 21', 'gofroyaschiki-chetyrehklapannye', 'yashchik-21', 380, 380, 228, 64.5);
  PERFORM seed_price_product('GK-B76', 'Ящик № Б-76', 'gofroyaschiki-chetyrehklapannye', 'yashchik-b-76', 450, 350, 250, 64);
  PERFORM seed_price_product('GK-38', 'Ящик № 38', 'gofroyaschiki-chetyrehklapannye', 'yashchik-38', 380, 304, 285, 61);
  PERFORM seed_price_product('GK-400', 'Ящик № 400', 'gofroyaschiki-chetyrehklapannye', 'yashchik-400', 400, 300, 400, 58.5);
  PERFORM seed_price_product('GK-60', 'Ящик № 60', 'gofroyaschiki-chetyrehklapannye', 'yashchik-60', 460, 380, 110, 56);
  PERFORM seed_price_product('GK-54', 'Ящик № 54', 'gofroyaschiki-chetyrehklapannye', 'yashchik-54', 460, 290, 160, 54);
  PERFORM seed_price_product('GK-6263', 'Ящик № 6263', 'gofroyaschiki-chetyrehklapannye', 'yashchik-6263', 550, 400, 150, 53.5);
  PERFORM seed_price_product('GK-89', 'Ящик № 89', 'gofroyaschiki-chetyrehklapannye', 'yashchik-89', 380, 285, 290, 53);
  PERFORM seed_price_product('GK-300', 'Ящик № 300', 'gofroyaschiki-chetyrehklapannye', 'yashchik-300', 300, 300, 320, 52);
  PERFORM seed_price_product('GK-880-P31', 'Ящик № 880 П-31', 'gofroyaschiki-chetyrehklapannye', 'yashchik-880-p-31', NULL, NULL, NULL, 52,
            p_note => 'под печать «П-31»; размер — по запросу');
  PERFORM seed_price_product('GK-52', 'Ящик № 52', 'gofroyaschiki-chetyrehklapannye', 'yashchik-52', 412, 310, 165, 52);
  PERFORM seed_price_product('GK-17', 'Ящик № 17', 'gofroyaschiki-chetyrehklapannye', 'yashchik-17', 380, 285, 228, 47);
  PERFORM seed_price_product('GK-819', 'Ящик № 819', 'gofroyaschiki-chetyrehklapannye', 'yashchik-819', 330, 233, 275, 47);
  PERFORM seed_price_product('GK-36-1', 'Ящик № 36/1', 'gofroyaschiki-chetyrehklapannye', 'yashchik-36-1', 380, 300, 180, 46);
  PERFORM seed_price_product('GK-16', 'Ящик № 16', 'gofroyaschiki-chetyrehklapannye', 'yashchik-16', 380, 285, 190, 46);
  PERFORM seed_price_product('GK-7', 'Ящик № 7', 'gofroyaschiki-chetyrehklapannye', 'yashchik-7', 380, 253, 237, 44);
  PERFORM seed_price_product('GK-871', 'Ящик № 871', 'gofroyaschiki-chetyrehklapannye', 'yashchik-871', 380, 253, 140, 43.5);
  PERFORM seed_price_product('GK-84', 'Ящик № 84', 'gofroyaschiki-chetyrehklapannye', 'yashchik-84', 310, 250, 290, 43);
  PERFORM seed_price_product('GK-14', 'Ящик № 14', 'gofroyaschiki-chetyrehklapannye', 'yashchik-14', 380, 285, 142, 41.5);
  PERFORM seed_price_product('GK-821', 'Ящик № 821', 'gofroyaschiki-chetyrehklapannye', 'yashchik-821', 319, 294, 144, 41);
  PERFORM seed_price_product('GK-96', 'Ящик № 96', 'gofroyaschiki-chetyrehklapannye', 'yashchik-96', 400, 230, 330, 40);
  PERFORM seed_price_product('GK-87', 'Ящик № 87', 'gofroyaschiki-chetyrehklapannye', 'yashchik-87', 310, 240, 320, 40);
  PERFORM seed_price_product('GK-12', 'Ящик № 12', 'gofroyaschiki-chetyrehklapannye', 'yashchik-12', 380, 285, 95, 37);
  PERFORM seed_price_product('GK-875', 'Ящик № 875', 'gofroyaschiki-chetyrehklapannye', 'yashchik-875', 380, 253, 140, 32.5);
  PERFORM seed_price_product('GK-6212', 'Ящик № 6212', 'gofroyaschiki-chetyrehklapannye', 'yashchik-6212', 505, 305, 107, 31);
  PERFORM seed_price_product('GK-282', 'Ящик № 282', 'gofroyaschiki-chetyrehklapannye', 'yashchik-282', 380, 253, 120, 30);
  PERFORM seed_price_product('GK-717', 'Ящик № 717', 'gofroyaschiki-chetyrehklapannye', 'yashchik-717', 310, 210, 170, 28);
  PERFORM seed_price_product('GK-912', 'Ящик № 912', 'gofroyaschiki-chetyrehklapannye', 'yashchik-912', 120, 120, 120, 28);
  PERFORM seed_price_product('GK-6262', 'Ящик № 6262', 'gofroyaschiki-chetyrehklapannye', 'yashchik-6262', 400, 300, 130, 27);
  PERFORM seed_price_product('GK-A57', 'Ящик № А57', 'gofroyaschiki-chetyrehklapannye', 'yashchik-a57', 260, 190, 170, 24.5);
  PERFORM seed_price_product('GK-1446', 'Ящик № 1446', 'gofroyaschiki-chetyrehklapannye', 'yashchik-1446', 270, 220, 100, 22.5);
  PERFORM seed_price_product('GK-227', 'Ящик № 227', 'gofroyaschiki-chetyrehklapannye', 'yashchik-227', NULL, NULL, NULL, 22.5,
            p_note => 'размер — по запросу');
  PERFORM seed_price_product('GK-34L', 'Ящик №34Л', 'gofroyaschiki-chetyrehklapannye', 'yashchik-34l', 110, 110, 120, 19);
  PERFORM seed_price_product('GK-30L', 'Ящик №30Л', 'gofroyaschiki-chetyrehklapannye', 'yashchik-30l', 90, 90, 120, 19);
  PERFORM seed_price_product('GK-917', 'Ящик № 917', 'gofroyaschiki-chetyrehklapannye', 'yashchik-917', 200, 185, 130, 17.5);
  PERFORM seed_price_product('GK-D98', 'Ящик № Д98', 'gofroyaschiki-chetyrehklapannye', 'yashchik-d98', 310, 170, 100, 17);
  PERFORM seed_price_product('GK-440', 'Ящик № 440', 'gofroyaschiki-chetyrehklapannye', 'yashchik-440', 200, 120, 120, 15);
  PERFORM seed_price_product('GK-915', 'Ящик № 915', 'gofroyaschiki-chetyrehklapannye', 'yashchik-915', 150, 150, 100, 13.5);
  PERFORM seed_price_product('GK-40', 'Ящик № 40', 'gofroyaschiki-chetyrehklapannye', 'yashchik-40', 590, 390, 230, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-39', 'Ящик № 39', 'gofroyaschiki-chetyrehklapannye', 'yashchik-39', 590, 390, 190, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-35', 'Ящик № 35', 'gofroyaschiki-chetyrehklapannye', 'yashchik-35', 350, 350, 120, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-22', 'Ящик № 22', 'gofroyaschiki-chetyrehklapannye', 'yashchik-22', 350, 200, 120, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-26', 'Ящик № 26', 'gofroyaschiki-chetyrehklapannye', 'yashchik-26', 350, 130, 95, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-48', 'Ящик № 48', 'gofroyaschiki-chetyrehklapannye', 'yashchik-48', 260, 120, 105, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-A715', 'Ящик № А715', 'gofroyaschiki-chetyrehklapannye', 'yashchik-a715', 320, 150, 150, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-425', 'Ящик № 425', 'gofroyaschiki-chetyrehklapannye', 'yashchik-425', 425, 325, 90, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-390', 'Ящик № 390', 'gofroyaschiki-chetyrehklapannye', 'yashchik-390', 390, 260, 220, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-180', 'Ящик № 180', 'gofroyaschiki-chetyrehklapannye', 'yashchik-180', 180, 120, 100, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-345', 'Ящик № 345', 'gofroyaschiki-chetyrehklapannye', 'yashchik-345', 345, 245, 260, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-350', 'Ящик № 350', 'gofroyaschiki-chetyrehklapannye', 'yashchik-350', 350, 350, 350, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-680', 'Ящик № 680', 'gofroyaschiki-chetyrehklapannye', 'yashchik-680', 680, 390, 330, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-790', 'Ящик № 790', 'gofroyaschiki-chetyrehklapannye', 'yashchik-790', 790, 390, 150, NULL,
            p_note => 'цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('GK-46', 'Ящик № 46', 'gofroyaschiki-chetyrehklapannye', 'yashchik-46', 400, 230, 330, NULL,
            p_note => 'цена по запросу — изготовление под заказ');

  -- · Овощные гофроящики — 6 шт.
  PERFORM seed_price_product('OGK-219', 'Овощной ящик № 219', 'ovoshchnye-gofroyaschiki', 'ovoshchnoi-yashchik-219', 560, 390, 180, 82);
  PERFORM seed_price_product('OGK-468', 'Овощной ящик № 468', 'ovoshchnye-gofroyaschiki', 'ovoshchnoi-yashchik-468', 468, 313, 156, 80);
  PERFORM seed_price_product('OGK-143', 'Овощной ящик № 143', 'ovoshchnye-gofroyaschiki', 'ovoshchnoi-yashchik-143', 565, 377, 111, 65.5);
  PERFORM seed_price_product('OGK-218', 'Овощной ящик № 218', 'ovoshchnye-gofroyaschiki', 'ovoshchnoi-yashchik-218', 550, 380, 90, 58);
  PERFORM seed_price_product('OGK-217', 'Овощной ящик №217', 'ovoshchnye-gofroyaschiki', 'ovoshchnoi-yashchik-217', 360, 290, 170, 41);
  PERFORM seed_price_product('OGK-777', 'Овощной ящик №777', 'ovoshchnye-gofroyaschiki', 'ovoshchnoi-yashchik-777', 500, 400, 250, NULL,
            p_note => 'цена по запросу — изготовление под заказ');

  -- · Кондитерские гофролотки (телевизор) — 12 шт.
  PERFORM seed_price_product('G-LOT-848-BEL', 'Лоток 848 бел.', 'konditerskie-gofrolotki-televizor', 'lotok-848-bel', 380, 280, 105, 36,
            p_note => 'белый микрогофрокартон');
  PERFORM seed_price_product('G-LOT-S33', 'Лоток С-33', 'konditerskie-gofrolotki-televizor', 'lotok-s-33', 375, 210, 90, 36,
            p_note => 'лоток «телевизор»');
  PERFORM seed_price_product('G-LOT-60-BEL', 'Лоток 60 бел.', 'konditerskie-gofrolotki-televizor', 'lotok-60-bel', 390, 270, 60, 33,
            p_note => 'белый микрогофрокартон');
  PERFORM seed_price_product('G-LOT-S86', 'Лоток № С-86', 'konditerskie-gofrolotki-televizor', 'lotok-s-86', 380, 280, 60, 30,
            p_note => 'лоток «телевизор»');
  PERFORM seed_price_product('G-LOT-S23', 'Лоток С-23', 'konditerskie-gofrolotki-televizor', 'lotok-s-23', 270, 165, 76, 29,
            p_note => 'лоток «телевизор»');
  PERFORM seed_price_product('G-LOT-S297', 'Лоток С-297', 'konditerskie-gofrolotki-televizor', 'lotok-s-297', 260, 155, 75, 28,
            p_note => 'лоток «телевизор»');
  PERFORM seed_price_product('G-LOT-38M', 'Лоток № 38М', 'konditerskie-gofrolotki-televizor', 'lotok-38m', 258, 208, 63, 22.5,
            p_note => 'лоток «телевизор»');
  PERFORM seed_price_product('G-LOT-S324', 'Лоток С-324', 'konditerskie-gofrolotki-televizor', 'lotok-s-324', 282, 257, 60, 22.5,
            p_note => 'лоток «телевизор»');
  PERFORM seed_price_product('G-LOT-S323', 'Лоток С-323', 'konditerskie-gofrolotki-televizor', 'lotok-s-323', 254, 191, 58, 22,
            p_note => 'лоток «телевизор»');
  PERFORM seed_price_product('G-LOT-46M-BEL', 'Лоток 46м бел.', 'konditerskie-gofrolotki-televizor', 'lotok-46m-bel', 258, 208, 48, 20.5,
            p_note => 'белый микрогофрокартон');
  PERFORM seed_price_product('G-LOT-S17', 'Лоток № С17', 'konditerskie-gofrolotki-televizor', 'lotok-s17', 238, 184, 55, 15.5,
            p_note => 'лоток «телевизор»');
  PERFORM seed_price_product('G-LOT-S25', 'Лоток № С25', 'konditerskie-gofrolotki-televizor', 'lotok-s25', 280, 280, 65, 14.5,
            p_note => 'лоток «телевизор»');

  -- · Пицца (квадрат) — 7 шт.
  PERFORM seed_price_product('PIZ-S52', 'Пицца (квадрат) С52', 'picca-kvadrat', 'pitstsa-kvadrat-s52', 315, 315, 50, 37.5,
            p_material => 'микрогофра', p_note => 'микрогофра');
  PERFORM seed_price_product('PIZ-S68', 'Пицца (квадрат) С68', 'picca-kvadrat', 'pitstsa-kvadrat-s68', 290, 290, 42, 30,
            p_material => 'микрогофра', p_note => 'микрогофра');
  PERFORM seed_price_product('PIZ-S56', 'Пицца (квадрат) С56', 'picca-kvadrat', 'pitstsa-kvadrat-s56', 236, 236, 40, 22.5,
            p_material => 'микрогофра', p_note => 'микрогофра');
  PERFORM seed_price_product('PIZ-S55', 'Пицца (квадрат) С55', 'picca-kvadrat', 'pitstsa-kvadrat-s55', 335, 222, 50, NULL,
            p_material => 'микрогофра', p_note => 'микрогофра; цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('PIZ-S62', 'Пицца (квадрат) С62', 'picca-kvadrat', 'pitstsa-kvadrat-s62', 260, 260, 45, NULL,
            p_material => 'микрогофра', p_note => 'микрогофра; цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('PIZ-S78', 'Пицца (квадрат) С78', 'picca-kvadrat', 'pitstsa-kvadrat-s78', 340, 340, 45, NULL,
            p_material => 'микрогофра', p_note => 'микрогофра; цена по запросу — изготовление под заказ');
  PERFORM seed_price_product('PIZ-S92', 'Пицца (квадрат) С92', 'picca-kvadrat', 'pitstsa-kvadrat-s92', 410, 410, 45, NULL,
            p_material => 'микрогофра', p_note => 'микрогофра; цена по запросу — изготовление под заказ');

  -- · Миникороб самосборный — 17 шт.
  PERFORM seed_price_product('G-MINI-AS450', 'Миникороб АС450', 'minikorob-samosbornyj', 'minikorob-as450', 450, 300, 70, 71.5,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-AS255', 'Миникороб АС255', 'minikorob-samosbornyj', 'minikorob-as255', 255, 120, 90, 35.5,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-S60', 'Самосборный № С60', 'minikorob-samosbornyj', 'samosbornyi-s60', 270, 220, 30, 30,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('GK-270', 'Миникороб № С270', 'minikorob-samosbornyj', 'minikorob-s270', 270, 190, 60, 30,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-100', 'Миникороб 100', 'minikorob-samosbornyj', 'minikorob-100', 100, 100, 100, 26.5,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-S240', 'Миникороб № С240', 'minikorob-samosbornyj', 'minikorob-s240', 240, 180, 60, 26,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-S217', 'Самосборный № С217', 'minikorob-samosbornyj', 'samosbornyi-s217', 255, 125, 75, 25.5,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-S247', 'Миникороб С247', 'minikorob-samosbornyj', 'minikorob-s247', 215, 110, 92, 24.5,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-S286', 'Миникороб С286', 'minikorob-samosbornyj', 'minikorob-s286', 305, 155, 55, 24.5,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-170', 'Миникороб №170', 'minikorob-samosbornyj', 'minikorob-170', 170, 90, 90, 24.5,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-AS250', 'Миникороб АС250', 'minikorob-samosbornyj', 'minikorob-as250', 250, 120, 60, 24,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-160', 'Миникороб № 160', 'minikorob-samosbornyj', 'minikorob-160', 160, 100, 100, 24,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-S45', 'Миникороб С45', 'minikorob-samosbornyj', 'minikorob-s45', 235, 103, 60, 22.5,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-AS150', 'Миникороб АС150', 'minikorob-samosbornyj', 'minikorob-as150', 150, 120, 56, 20,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-S30', 'Самосборный № С30', 'minikorob-samosbornyj', 'samosbornyi-s30', 260, 100, 30, 18.5,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-166', 'Миникороб № 166', 'minikorob-samosbornyj', 'minikorob-166', 166, 116, 72, 17.5,
            p_material => 'микрогофра', p_note => 'самосборный');
  PERFORM seed_price_product('G-MINI-45-MG', 'Миникороб 45 мг', 'minikorob-samosbornyj', 'minikorob-45-mg', 170, 80, 63, 13.5,
            p_material => 'микрогофра', p_note => 'самосборный');

  -- · Гофроформат — 10 шт.
  PERFORM seed_price_product('GF-ROLL-1400-50', 'Гофроформат в рулоне 2-х сл. 1.4×50 м', 'gofroformat', 'gofroformat-v-rulone-2-h-sl-1-4-50-m', 1400, 50, NULL, 3980,
            p_unit => 'мм×м', p_material => '2-слойный', p_note => 'Рулон 1,4 м × 50 м, 2 слоя — цена за рулон', p_roll_meters => 50);
  PERFORM seed_price_product('GF-ROLL-1050-50', 'Гофроформат в рулоне 2-х сл. 1.05×50м', 'gofroformat', 'gofroformat-v-rulone-2-h-sl-1-05-50m', 1050, 50, NULL, 3100,
            p_unit => 'мм×м', p_material => '2-слойный', p_note => 'Рулон 1,05 м × 50 м, 2 слоя — цена за рулон', p_roll_meters => 50);
  PERFORM seed_price_product('GF-ROLL-1400-25', 'Гофроформат в рулоне 2-х сл. 1.4×25 м', 'gofroformat', 'gofroformat-v-rulone-2-h-sl-1-4-25-m', 1400, 25, NULL, 2050,
            p_unit => 'мм×м', p_material => '2-слойный', p_note => 'Рулон 1,4 м × 25 м, 2 слоя — цена за рулон', p_roll_meters => 25);
  PERFORM seed_price_product('GF-1400-2500', 'Гофроформат 3-х сл. 2500×1400', 'gofroformat', 'gofroformat-3-h-sl-2500-1400', 1400, 2500, NULL, 197.5,
            p_material => '3-слойный', p_note => 'Лист 1400×2500 мм, площадь 3,5 м²');
  PERFORM seed_price_product('GF-2000-1400', 'Гофроформат 3-х сл. 2000×1400 мм', 'gofroformat', 'gofroformat-3-h-sl-2000-1400-mm', 2000, 1400, NULL, 184,
            p_material => '3-слойный', p_note => 'Лист 2000×1400 мм, площадь 2,8 м²');
  PERFORM seed_price_product('GF-1440-1150-MG', 'Гофроформат 1440×1150 микрогофра', 'gofroformat', 'gofroformat-1440-1150-mikrogofra', 1440, 1150, NULL, 85,
            p_material => 'микрогофра', p_note => 'Лист 1440×1150 мм, площадь 1,66 м²');
  PERFORM seed_price_product('GF-1200-800', 'Гофроформат 3-х сл. 1200×800 мм', 'gofroformat', 'gofroformat-3-h-sl-1200-800-mm', 1200, 800, NULL, 55,
            p_material => '3-слойный', p_note => 'Лист 1200×800 мм, площадь 0,96 м²');
  PERFORM seed_price_product('GF-1200-800-E', 'Гофроформат профиль Е 1200×800 мм', 'gofroformat', 'gofroformat-profil-e-1200-800-mm', 1200, 800, NULL, 50.5,
            p_material => '3-слойный, профиль Е', p_note => 'Лист 1200×800 мм, площадь 0,96 м²');
  PERFORM seed_price_product('GF-1200-1000-SEC', 'Гофроформат 3-х сл. вторичный 1200×1000 мм', 'gofroformat', 'gofroformat-3-h-sl-vtorichnyi-1200-1000-mm', 1200, 1000, NULL, 37,
            p_material => '3-слойный, вторичный', p_note => 'Лист 1200×1000 мм, площадь 1,2 м²');
  PERFORM seed_price_product('GF-1200-800-C-BEL', 'Гофроформат 3-х сл. 1200×800 мм, профиль С, белый', 'gofroformat', 'gofroformat-3-h-sl-1200-800-mm-profil-s-belyi', 1200, 800, NULL, NULL,
            p_material => '3-слойный, профиль С, белый', p_note => 'Лист 1200×800 мм, площадь 0,96 м²; цена по запросу');

  -- · Скотч (клейкая лента) — 5 шт.
  PERFORM seed_price_product('TAPE-48-120-CLR', 'Скотч прозрачный 43 мк 48 мм × 120 м', 'skotch-klejkaya-lenta', 'skotch-prozrachnyi-43-mk-48-mm-120-m', 48, 120, NULL, 133,
            p_unit => 'мм×м', p_material => '43 мкм', p_note => 'Клейкая лента прозрачная, увеличенная намотка, 43 мк', p_thickness => 43, p_profile => 'tape');
  PERFORM seed_price_product('TAPE-72-60-CLR', 'Скотч прозрачный 43 мк 72 мм × 60 м', 'skotch-klejkaya-lenta', 'skotch-prozrachnyi-43-mk-72-mm-60-m', 72, 60, NULL, 97,
            p_unit => 'мм×м', p_material => '43 мкм', p_note => 'Клейкая лента прозрачная, широкая, 43 мк', p_thickness => 43, p_profile => 'tape');
  PERFORM seed_price_product('TAPE-48-60-COL', 'Скотч цветной 43 мк 48 мм × 60 м', 'skotch-klejkaya-lenta', 'skotch-tsvetnoi-43-mk-48-mm-60-m', 48, 60, NULL, 90.5,
            p_unit => 'мм×м', p_material => '43 мкм', p_note => 'Клейкая лента цветная, в ассортименте, 43 мк', p_thickness => 43, p_profile => 'tape');
  PERFORM seed_price_product('TAPE-48-60-CLR', 'Скотч прозрачный 43 мк 48 мм × 60 м', 'skotch-klejkaya-lenta', 'skotch-prozrachnyi-43-mk-48-mm-60-m', 48, 60, NULL, 71.5,
            p_unit => 'мм×м', p_material => '43 мкм', p_note => 'Клейкая лента прозрачная, 43 мк', p_thickness => 43, p_profile => 'tape');
  PERFORM seed_price_product('TAPE-48-60-BRN', 'Скотч тонированный 43 мк 48 мм × 60 м', 'skotch-klejkaya-lenta', 'skotch-tonirovannyi-43-mk-48-mm-60-m', 48, 60, NULL, 71.5,
            p_unit => 'мм×м', p_material => '43 мкм', p_note => 'Клейкая лента тонированная (коричневая), 43 мк', p_thickness => 43, p_profile => 'tape');

  -- · Упаковочная плёнка — 12 шт.
  PERFORM seed_price_product('VPP-1600-100', 'Воздушно-пузырьковая плёнка 1.6*100 55мкм', 'plenka-upakovochnaya', 'vozdushno-puzyrkovaya-plenka-1-6-100-55mkm', 1600, 100, NULL, 5500,
            p_unit => 'мм×м', p_material => '55 мкм', p_note => 'Рулон 1,6 м × 100 м, 55 мкм — цена за рулон', p_thickness => 55, p_roll_meters => 100);
  PERFORM seed_price_product('VPP-1200-100', 'Воздушно-пузырьковая плёнка 1,2*100 55мкм', 'plenka-upakovochnaya', 'vozdushno-puzyrkovaya-plenka-1-2-100-55mkm', 1200, 100, NULL, 4100,
            p_unit => 'мм×м', p_material => '55 мкм', p_note => 'Рулон 1,2 м × 100 м, 55 мкм — цена за рулон', p_thickness => 55, p_roll_meters => 100);
  PERFORM seed_price_product('VPP-800-100', 'Воздушно-пузырьковая плёнка 0.8*100 55мкм', 'plenka-upakovochnaya', 'vozdushno-puzyrkovaya-plenka-0-8-100-55mkm', 800, 100, NULL, 2750,
            p_unit => 'мм×м', p_material => '55 мкм', p_note => 'Рулон 0,8 м × 100 м, 55 мкм — цена за рулон', p_thickness => 55, p_roll_meters => 100);
  PERFORM seed_price_product('VPP-400-100', 'Воздушно-пузырьковая плёнка 0.4*100 55мкм', 'plenka-upakovochnaya', 'vozdushno-puzyrkovaya-plenka-0-4-100-55mkm', 400, 100, NULL, 1400,
            p_unit => 'мм×м', p_material => '55 мкм', p_note => 'Рулон 0,4 м × 100 м, 55 мкм — цена за рулон', p_thickness => 55, p_roll_meters => 100);
  PERFORM seed_price_product('STRETCH-1.9', 'Стрейч-плёнка первичная 450–500 мм, 1,9 кг', 'plenka-upakovochnaya', 'streich-plenka-pervichnaya-450-500-mm-1-9-kg', 450, 500, NULL, 570,
            p_note => 'первичная, вес рулона 1,9 кг, ширина рулона 450–500 мм', p_weight => 1.9);
  PERFORM seed_price_product('STRETCH-1.2-BLK', 'Стрейч-плёнка первичная черная 450–500 мм, 1,2 кг', 'plenka-upakovochnaya', 'streich-plenka-pervichnaya-chernaya-450-500-mm-1-2-kg', 450, 500, NULL, 540,
            p_note => 'первичная, черная, вес рулона 1,2 кг, ширина рулона 450–500 мм', p_weight => 1.2);
  PERFORM seed_price_product('STRETCH-3-SEC', 'Стрейч-плёнка вторичная 450–500 мм, 3 кг', 'plenka-upakovochnaya', 'streich-plenka-vtorichnaya-450-500-mm-3-kg', 450, 500, NULL, 501,
            p_note => 'вторичная, вес рулона 3 кг, ширина рулона 450–500 мм', p_weight => 3);
  PERFORM seed_price_product('STRETCH-500-1.2-23', 'Стрейч пленка 500мм*1,2кг 23мк', 'plenka-upakovochnaya', 'streich-plenka-500mm-1-2kg-23mk', 500, NULL, NULL, 460,
            p_material => '23 мкм', p_note => 'вес рулона 1,2 кг, толщина 23 мкм, ширина рулона 500 мм', p_weight => 1.2);
  PERFORM seed_price_product('STRETCH-1.9-SEC', 'Стрейч-плёнка вторичная 450–500 мм, 1,9 кг', 'plenka-upakovochnaya', 'streich-plenka-vtorichnaya-450-500-mm-1-9-kg', 450, 500, NULL, 450,
            p_note => 'вторичная, вес рулона 1,9 кг, ширина рулона 450–500 мм', p_weight => 1.9);
  PERFORM seed_price_product('STRETCH-0.495-FOOD', 'Стрейч-плёнка пищевая 450мм, 0,495 кг', 'plenka-upakovochnaya', 'streich-plenka-pishchevaya-450mm-0-495-kg', 450, NULL, NULL, 125,
            p_note => 'пищевая, вес рулона 0,495 кг, ширина рулона 450 мм', p_weight => 0.495);
  PERFORM seed_price_product('STRETCH-0.496', 'Стрейч-плёнка первичная 450 мм, 0,496 кг', 'plenka-upakovochnaya', 'streich-plenka-pervichnaya-450-mm-0-496-kg', 450, NULL, NULL, 125,
            p_note => 'первичная, малый рулон, вес рулона 0,496 кг, ширина рулона 450 мм', p_weight => 0.496);
  PERFORM seed_price_product('STRETCH-2-BEL', 'Стрейч-плёнка первичная белая 450–500 мм, 2 кг', 'plenka-upakovochnaya', 'streich-plenka-pervichnaya-belaya-450-500-mm-2-kg', 450, 500, NULL, NULL,
            p_note => 'первичная, белая, вес рулона 2 кг, ширина рулона 450–500 мм; цена по запросу', p_weight => 2);

  -- · Бумага и картонные материалы — 5 шт.
  PERFORM seed_price_product('PERG-420-600', 'Подпергамент «П» 52 г/м² 420×600 1000 листов', 'bumaga-i-kartonnye-materialy', 'podpergament-p-52-g-m2-420-600-1000-listov', 420, 600, NULL, 3800,
            p_material => '52 г/м²', p_note => 'Подпергамент «П», пачка 1 000 листов', p_pack_qty => 1000);
  PERFORM seed_price_product('PERG-420-300', 'Подпергамент «П» 52 г/м² 420×300', 'bumaga-i-kartonnye-materialy', 'podpergament-p-52-g-m2-420-300', 420, 300, NULL, 1900,
            p_material => '52 г/м²', p_note => 'Подпергамент «П», пачка 1 000 листов', p_pack_qty => 1000);
  PERFORM seed_price_product('PAPER-ANG-80-1050', 'Бумага оберточная Ангарск, пл. 80, ф. 1050', 'bumaga-i-kartonnye-materialy', 'bumaga-obertochnaya-angarsk-pl-80-f-1050', 1050, NULL, NULL, 115,
            p_material => '80 г/м²', p_note => 'Плотность 80 г/м², формат 1050 мм — цена за лист');
  PERFORM seed_price_product('GK-PAD-7', 'Прокладка №7', 'bumaga-i-kartonnye-materialy', 'prokladka-7', 370, 243, NULL, 10,
            p_material => 'гофрокартон', p_note => 'Картонная прокладка между рядами продукции, 370×243 мм');
  PERFORM seed_price_product('KRAFT-840-600', 'Крафт-бумага 78 г/м² 840×600', 'bumaga-i-kartonnye-materialy', 'kraft-bumaga-78-g-m2-840-600', 840, 600, NULL, 8.5,
            p_material => '78 г/м²', p_note => 'Крафт-бумага, цена за лист');

  -- · Упаковочные и сопутствующие материалы — 5 шт.
  PERFORM seed_price_product('FILLER-1KG', 'Упаковочный наполнитель 1 кг', 'upakovochnye-materialy', 'upakovochnyi-napolnitel-1-kg', NULL, NULL, NULL, 120,
            p_note => 'Бумажный наполнитель для заполнения пустот, бухта 1 кг', p_weight => 1);
  PERFORM seed_price_product('CORNER-50-50-4-2000', 'Защитный картонный уголок 50*50*4*2000', 'upakovochnye-materialy', 'zashchitnyi-kartonnyi-ugolok-50-50-4-2000', 2000, 50, 50, 78,
            p_material => 'картон 4 мм', p_note => 'Сечение 50×50 мм, толщина 4 мм, длина 2000 мм');
  PERFORM seed_price_product('MARKER-SPETS-BLK', 'Маркер СПЕЦ перманентный, черный', 'upakovochnye-materialy', 'marker-spets-permanentnyi-chernyi', NULL, NULL, NULL, 50,
            p_note => 'Перманентный маркер, черный');
  PERFORM seed_price_product('GLOVES-PVH-6', 'Перчатки ПВХ 6 нитей люкс', 'upakovochnye-materialy', 'perchatki-pvh-6-nitei-lyuks', NULL, NULL, NULL, 31,
            p_note => 'С ПВХ-покрытием, 6 нитей, люкс — цена за пару');
  PERFORM seed_price_product('BAGS-PP-55-105', 'Мешки ПП белые 55*105 см (60 гр)', 'upakovochnye-materialy', 'meshki-pp-belye-55-105-sm-60-gr', 550, 1050, NULL, 20.5,
            p_note => 'Мешки полипропиленовые белые, 55×105 см, плотность 60 г/м²');

  -- · Оснастка (штанцформы) — 2 шт.
  PERFORM seed_price_product('DIE-B', 'Плоская штанцформа профиль B', 'osnastka-i-oborudovanie', 'ploskaya-shtantsforma-profil-b', NULL, NULL, NULL, NULL,
            p_note => 'Плоская штанцформа под профиль B, цена по запросу');
  PERFORM seed_price_product('DIE-E', 'Плоская штанцформа профиль Е', 'osnastka-i-oborudovanie', 'ploskaya-shtantsforma-profil-e', NULL, NULL, NULL, NULL,
            p_note => 'Плоская штанцформа под профиль E, цена по запросу');

  RAISE NOTICE 'Прайс 29.09.2026: обработано позиций: 147';
END $$;

-- ─── 4. Итог ───────────────────────────────────────────────────
SELECT c.name AS "Категория",
       COUNT(p.id) AS "Позиций",
       COUNT(p.id) FILTER (WHERE p.price IS NULL) AS "Без цены",
       COUNT(p.id) FILTER (WHERE p.dimension_length IS NOT NULL) AS "С размерами"
FROM categories c
LEFT JOIN products p ON p.category_id = c.id
WHERE c.slug IN (
      'gofroyaschiki-chetyrehklapannye',
      'ovoshchnye-gofroyaschiki',
      'konditerskie-gofrolotki-televizor',
      'picca-kvadrat',
      'minikorob-samosbornyj',
      'gofroformat',
      'skotch-klejkaya-lenta',
      'plenka-upakovochnaya',
      'bumaga-i-kartonnye-materialy',
      'upakovochnye-materialy',
      'osnastka-i-oborudovanie'
)
GROUP BY c.name, c.sort_order
ORDER BY c.sort_order;

COMMIT;
