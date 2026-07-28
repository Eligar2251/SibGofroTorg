-- =========================================================
-- ВАРИАНТЫ ТОВАРА (product_variants)
-- =========================================================
--
-- Идея: один товар (например, "Скотч 48 мм") может существовать в
-- нескольких вариантах (цвет, размер упаковки, материал и т.п.).
-- Каждый вариант — отдельная строка в этой таблице, со своим SKU,
-- ценой, остатком и (опционально) изображениями.
--
-- Совместимость:
--   * Товары, у которых НЕТ вариантов, продолжают работать как
--     раньше — данные берутся из самой строки products.
--   * Если у товара ЕСТЬ хотя бы один вариант, цена/остаток/изображения
--     читаются из вариантов (products.price/quantity становятся
--     «сводными» — min/max для карточки каталога и fallback).
--
-- Связи:
--   product_id — логическая связь с products.id (без FK, как
--   принято в проекте — см. остальные таблицы в schema.sql).
--
-- Индексы: типичные запросы — выбор всех вариантов товара
-- (страница товара) и быстрый фильтр «в наличии» (каталог).
-- =========================================================

CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Логическая связь с products.id
  product_id UUID NOT NULL,

  -- Название варианта: «красный», «коробка 50 шт», «XL» и т.д.
  -- На странице товара показывается как бейдж/чип. В карточке
  -- корзины/заказе — добавляется к названию товара через "/".
  name TEXT NOT NULL DEFAULT '',

  -- Тип опции для будущей группировки/визуала: «color», «size»,
  -- «pack», «material», или пустая строка для «другого».
  -- На странице товара варианты одного типа группируются в
  -- одну строку (например, «Цвет: красный | синий | зелёный»).
  option_type TEXT NOT NULL DEFAULT '',

  -- HEX-цвет для визуала (если это цвет). Может быть пустым
  -- для не-цветовых вариантов.
  color_hex TEXT,

  -- Сортировка внутри одного товара и одного option_type
  sort_order INT NOT NULL DEFAULT 0,

  -- Цена, остаток и прочее — у КАЖДОГО варианта свои.
  -- Если не указаны — наследуем с products (NULL означает fallback).
  price NUMERIC,
  price_wholesale NUMERIC,

  -- Артикул варианта. Если пуст — берём product.sku с припиской
  -- имени варианта (например «BOX-670-red»).
  sku TEXT,

  -- Свой остаток на складе. Если NULL или 0 — вариант «нет в наличии»
  -- (в каталоге и на странице товара показывается как недоступный).
  stock_qty INT NOT NULL DEFAULT 0,
  stock_warn_qty INT,

  -- Изображения варианта (если есть — показываются вместо
  -- общих для товара). Массив URL, как products.images.
  images JSONB DEFAULT '[]'::jsonb,
  image_url TEXT,

  -- Размеры упаковки (могут отличаться от товара — например,
  -- пачка 10 шт. vs пачка 50 шт.). NULL → берём с products.
  dimension_length NUMERIC,
  dimension_width NUMERIC,
  dimension_height NUMERIC,
  dimension_unit TEXT,
  weight NUMERIC,

  -- Вес варианта как у товара — разный упаковочный формат
  pack_qty INT,

  -- Видимость — обычно = true, но можно временно скрыть
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,

  -- Служебное
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Основной индекс — все варианты одного товара. Используется
-- на странице товара и при пересчёте остатков.
CREATE INDEX IF NOT EXISTS idx_variants_product
  ON product_variants(product_id);

-- Каталог: быстро выбрать только видимые и в наличии.
CREATE INDEX IF NOT EXISTS idx_variants_visible_in_stock
  ON product_variants(product_id, is_visible, stock_qty)
  WHERE is_visible = TRUE;

-- Каталог: сортировка по умолчанию внутри option_type.
CREATE INDEX IF NOT EXISTS idx_variants_sort
  ON product_variants(product_id, option_type, sort_order);

DROP TRIGGER IF EXISTS trg_variants_updated ON product_variants;
CREATE TRIGGER trg_variants_updated
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- RLS
-- =========================================================
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

-- Публичное чтение (anon key) — клиенты сайта видят варианты.
DROP POLICY IF EXISTS "variants_sel" ON product_variants;
CREATE POLICY "variants_sel" ON product_variants FOR SELECT USING (TRUE);

-- Запись — только через service_role (минует RLS автоматически),
-- то есть только серверный код с ключом SUPABASE_SERVICE_ROLE_KEY.
-- На клиенте (admin) пишем через /api/admin/* endpoint-ы.
