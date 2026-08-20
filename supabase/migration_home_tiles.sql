-- =========================================================
-- Миграция: ПЛИТКИ КАТЕГОРИЙ НА ГЛАВНОЙ + МЕТКИ ТОВАРОВ
--
-- ЧТО ДОБАВЛЯЕТ
--  1. products.tags TEXT[] — произвольные метки товара
--     («озон», «вб», «сдэк», «гост», «хит», ...). У одного товара
--     их может быть сколько угодно. Старая одиночная метка
--     products.promo_label остаётся как есть — она тоже участвует
--     в подборе товаров по плитке (бейдж = метка).
--  2. Таблица home_tiles — плитки на главной странице.
--     Порядок, картинка, подпись и правило отбора задаются
--     в админке: «Товары и категории → Плитки на главной».
--
-- Плитка (kind):
--   category — товары одной категории каталога (category_id)
--   tag      — товары с меткой/бейджем (tag, можно список через запятую)
--   featured — популярные товары (is_featured)
--   sale     — распродажа остатков (is_sale)
--   all      — весь каталог
--
-- Каталог миграция НЕ меняет: категории каталога остаются прежними,
-- плитки — это только витрина главной.
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

-- ── 1. Метки товара (много на товар) ──
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[];

-- GIN-индекс: быстрый поиск «товары с меткой X» (tags @> ARRAY['озон'])
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN (tags);

-- ── 2. Плитки главной ──
CREATE TABLE IF NOT EXISTS home_tiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT,
  image_url TEXT,
  icon TEXT,
  kind TEXT NOT NULL DEFAULT 'category'
    CHECK (kind IN ('category', 'tag', 'featured', 'sale', 'all')),
  -- логическая связь с categories.id (без FK — как у products.category_id)
  category_id UUID,
  -- метка (или несколько через запятую): 'озон', 'вб, wb', 'гост'
  tag TEXT,
  accent TEXT,
  sort_order INT DEFAULT 0,
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_home_tiles_sort ON home_tiles(sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_home_tiles_visible ON home_tiles(is_visible) WHERE is_visible = TRUE;

DROP TRIGGER IF EXISTS trg_home_tiles_updated ON home_tiles;
CREATE TRIGGER trg_home_tiles_updated BEFORE UPDATE ON home_tiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Читает/пишет только сервер через service_role (getAdminDb),
-- поэтому RLS включаем без политик — как у остальных служебных таблиц.
ALTER TABLE home_tiles ENABLE ROW LEVEL SECURITY;

-- ── 3. Стартовое наполнение (только если таблица пустая) ──
-- Плитки создаются из видимых категорий каталога + «Популярные».
-- Всё это потом правится и переупорядочивается в админке.
INSERT INTO home_tiles (title, subtitle, icon, kind, category_id, sort_order, is_visible)
SELECT c.name, c.description, c.icon, 'category', c.id,
       ROW_NUMBER() OVER (ORDER BY c.sort_order ASC, c.name ASC), TRUE
FROM categories c
WHERE c.is_visible IS NOT FALSE
  AND NOT EXISTS (SELECT 1 FROM home_tiles);

INSERT INTO home_tiles (title, subtitle, icon, kind, sort_order, is_visible)
SELECT 'Популярные', 'Товары, которые заказывают чаще всего', 'star', 'featured', 0, TRUE
WHERE NOT EXISTS (SELECT 1 FROM home_tiles WHERE kind = 'featured');
