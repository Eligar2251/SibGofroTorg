-- =========================================================
-- Миграция: ТИПЫ РАЗМЕРОВ ТОВАРОВ (профили размеров)
--
-- ЧТО ДОБАВЛЯЕТ
--  1. Таблица product_dimension_profiles — набор полей размеров
--     и единица по умолчанию для каждого поля:
--       Коробки        — Длина (мм) × Ширина (мм) × Высота (мм)
--       Скотч          — Ширина (мм) × Длина (м) × Толщина (мкм)
--       Стрейч-плёнка  — Ширина (мм) × Длина (м) × Толщина (мкм)
--     Свои типы создаются в админке: «Товары → Категории → Типы размеров».
--  2. categories.dimension_profile_id — тип размеров категории.
--  3. products.dimension_profile_id — свой тип у товара (необязательно).
--  4. products.dimension_values JSONB — значения размеров
--     [{ "key": "width", "label": "Ширина", "value": 48, "unit": "мм" }, ...]
--     у каждого поля своя единица (48 мм × 120 м × 45 мкм).
--
-- Старые колонки dimension_length/width/height/unit остаются: товары
-- без dimension_values показываются как раньше, а для совместимости
-- (подбор коробок, объём) поля length/width/height дублируются туда в мм.
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

CREATE TABLE IF NOT EXISTS product_dimension_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  slug TEXT UNIQUE,
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INT DEFAULT 0,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dimension_profiles_sort
  ON product_dimension_profiles(sort_order ASC);

DROP TRIGGER IF EXISTS trg_dimension_profiles_updated ON product_dimension_profiles;
CREATE TRIGGER trg_dimension_profiles_updated BEFORE UPDATE ON product_dimension_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Читает/пишет только сервер через service_role.
ALTER TABLE product_dimension_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS dimension_profile_id UUID;
ALTER TABLE products   ADD COLUMN IF NOT EXISTS dimension_profile_id UUID;
ALTER TABLE products   ADD COLUMN IF NOT EXISTS dimension_values JSONB;

CREATE INDEX IF NOT EXISTS idx_categories_dimension_profile ON categories(dimension_profile_id);

-- ── Стартовые типы ──
INSERT INTO product_dimension_profiles (name, slug, fields, sort_order, is_default)
VALUES
  ('Коробки (Д×Ш×В)', 'box',
   '[{"key":"length","label":"Длина","unit":"мм"},
     {"key":"width","label":"Ширина","unit":"мм"},
     {"key":"height","label":"Высота","unit":"мм"}]'::jsonb, 1, TRUE),
  ('Скотч (Ш×Д×мкм)', 'tape',
   '[{"key":"width","label":"Ширина","unit":"мм"},
     {"key":"length","label":"Длина","unit":"м"},
     {"key":"thickness","label":"Толщина","unit":"мкм"}]'::jsonb, 2, FALSE),
  ('Стрейч-плёнка (Ш×Д×мкм)', 'stretch',
   '[{"key":"width","label":"Ширина","unit":"мм"},
     {"key":"length","label":"Длина","unit":"м"},
     {"key":"thickness","label":"Толщина","unit":"мкм"}]'::jsonb, 3, FALSE)
ON CONFLICT (slug) DO NOTHING;

-- ── Автопривязка существующих категорий по названию (только пустые) ──
UPDATE categories c SET dimension_profile_id = p.id
FROM product_dimension_profiles p
WHERE c.dimension_profile_id IS NULL AND p.slug = 'tape'
  AND (c.name ILIKE '%скотч%' OR c.name ILIKE '%клейк%лент%');

UPDATE categories c SET dimension_profile_id = p.id
FROM product_dimension_profiles p
WHERE c.dimension_profile_id IS NULL AND p.slug = 'stretch'
  AND c.name ILIKE '%стрейч%';

UPDATE categories c SET dimension_profile_id = p.id
FROM product_dimension_profiles p
WHERE c.dimension_profile_id IS NULL AND p.slug = 'box'
  AND (c.name ILIKE '%короб%' OR c.name ILIKE '%гофро%');
