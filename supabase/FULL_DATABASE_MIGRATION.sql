-- =====================================================================
-- ПОЛНАЯ ЕДИНАЯ МИГРАЦИЯ БАЗЫ ДАННЫХ СИБГОФРОТОРГ (PostgreSQL / Supabase)
-- Файл: supabase/FULL_DATABASE_MIGRATION.sql
--
-- Назначение:
--   Полное развёртывание ИЛИ обновление схемы БД в 1 запуск для переезда
--   на облачный Supabase (Supabase Cloud) или любой self-hosted Supabase.
--
-- Включает абсолютно ВСЕ миграции проекта (schema.sql + все 74 файла
-- migration_*.sql, включая прошлые и текущие пул-реквесты/мержи):
--   • Все 58 таблиц проекта (каталог, связки карточек product_link_groups,
--     заказы, склад, поставки, КМП-комплектации warehouse_assemblies,
--     перевозки, банк, касса, зарплаты, табели, штанцформы, аренда,
--     макулатура, журнал синхронизации локальной БД db_sync_runs и др.)
--   • Все представления с security_invoker = true (die_calc_job_stats), индексы и GIN-индексы
--   • Все функции и RPC (fn_next_counter, increment_review_helpful,
--     sync_product_in_stock, calculate_product_box_volume, fn_update_product_rating,
--     fn_increment_view_count, update_updated_at_column)
--   • Все триггеры, RLS-политики безопасности (152-ФЗ) и публикации Realtime
--
-- Скрипт на 100% ИДЕМПОТЕНТЕН: безопасно запускать как на чистой БД,
-- так и поверх существующей базы данных.
--
-- Как применить в облачном Supabase:
--   1. Откройте Supabase Dashboard → SQL Editor → New query
--   2. Вставьте содержимое этого файла целиком и нажмите Run
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =====================================================================
-- БАЗОВАЯ СХЕМА (supabase/schema.sql)
-- =====================================================================
-- =========================================================
-- SUPABASE SCHEMA — СибГофроТорг
-- БЕЗ внешних ключей (FK) — как в Firestore, связи на уровне приложения.
-- Запускается в SQL Editor Supabase.
-- =========================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- 1. КАТЕГОРИИ
-- =========================================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  icon TEXT,
  description TEXT,
  sort_order INT DEFAULT 0,
  is_visible BOOLEAN DEFAULT TRUE,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_sort ON categories(sort_order ASC);
DROP TRIGGER IF EXISTS trg_categories_updated ON categories;
CREATE TRIGGER trg_categories_updated BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 2. ТОВАРЫ  (category_id — логическая связь, БЕЗ FK)
-- =========================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  category_id UUID,  -- логическая связь с categories.id (без FK!)
  sku TEXT,
  description TEXT,
  price NUMERIC,
  price_wholesale NUMERIC,
  min_wholesale_qty INT,
  dimension_length NUMERIC,
  dimension_width NUMERIC,
  dimension_height NUMERIC,
  dimension_unit TEXT DEFAULT 'мм',
  weight NUMERIC,
  material TEXT,
  pack_qty INT,
  volume NUMERIC,
  note TEXT,
  in_stock BOOLEAN DEFAULT FALSE,
  stock_qty NUMERIC DEFAULT 0,
  stock_warn_qty INT,
  is_promo BOOLEAN DEFAULT FALSE,
  promo_label TEXT,
  -- Метки товара («озон», «вб», «сдэк», «гост»...) — по ним собираются
  -- плитки разделов на главной (см. таблицу home_tiles).
  tags TEXT[] DEFAULT '{}'::text[],
  promo_label_color TEXT,
  promo_label_text_color TEXT,
  made_to_order BOOLEAN DEFAULT FALSE,
  made_to_order_min_qty INT,
  -- Вариативность: продажа рулонами и метрами (отмотка)
  is_cuttable BOOLEAN DEFAULT FALSE,
  cut_meters_per_roll NUMERIC,
  cut_price_per_meter NUMERIC,
  cut_unit_name TEXT DEFAULT 'м',
  discount_type TEXT CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC,
  discount_badge TEXT,
  is_visible BOOLEAN DEFAULT TRUE,
  is_featured BOOLEAN DEFAULT FALSE,
  image_url TEXT,
  images JSONB DEFAULT '[]'::jsonb,
  view_count INT DEFAULT 0,
  average_rating NUMERIC DEFAULT 0,
  total_reviews INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_visible ON products(is_visible) WHERE is_visible = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_promo ON products(is_promo) WHERE is_promo = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_products_in_stock ON products(in_stock) WHERE in_stock = TRUE;
DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION sync_product_in_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stock_qty IS NULL THEN
    NEW.stock_qty := 0;
  END IF;
  NEW.in_stock := FLOOR(NEW.stock_qty) >= 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_sync_in_stock ON products;
CREATE TRIGGER trg_products_sync_in_stock
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION sync_product_in_stock();

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

-- =========================================================
-- 3. ПОЛЬЗОВАТЕЛИ
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  phone_digits TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  email TEXT,
  customer_type TEXT CHECK (customer_type IN ('individual', 'legal')),
  company_name TEXT,
  inn TEXT,
  kpp TEXT,
  ogrn TEXT,
  legal_address TEXT,
  actual_address TEXT,
  delivery_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_digits ON users(phone_digits);
DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 4. АДМИНИСТРАТОРЫ
-- =========================================================
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'manager', 'lawyer')),
  display_name TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_username ON admins(username);
DROP TRIGGER IF EXISTS trg_admins_updated ON admins;
CREATE TRIGGER trg_admins_updated BEFORE UPDATE ON admins FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Личная раскладка меню админки (группы, иконки). Без FK: логин
-- может появиться раньше строки, запись всё равно должна сохраниться.
CREATE TABLE IF NOT EXISTS admin_nav_layouts (
  username TEXT PRIMARY KEY,
  layout JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_admin_nav_layouts_updated ON admin_nav_layouts;
CREATE TRIGGER trg_admin_nav_layouts_updated
  BEFORE UPDATE ON admin_nav_layouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE admin_nav_layouts ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 5. ЗАКАЗЫ  (user_id, deal_id, payment_id — логические связи, БЕЗ FK)
-- =========================================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'order' CHECK (type IN ('order', 'inquiry')),
  customer_type TEXT NOT NULL DEFAULT 'individual' CHECK (customer_type IN ('individual', 'legal')),
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_phone_digits TEXT,
  user_id TEXT,  -- логическая связь с users.id (без FK!)
  customer_email TEXT,
  communication_channel TEXT NOT NULL DEFAULT 'call',
  payment_method TEXT,
  items JSONB,
  total_sum NUMERIC,
  product_info TEXT,
  quantity INT,
  comment TEXT,
  channel TEXT DEFAULT 'website',
  -- набор статусов единый для сайта и админки (src/lib/order-status.ts):
  -- in_delivery = «Передано в доставку», issued = «Выдан» (код выдачи на складе)
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'ready', 'in_delivery', 'issued', 'completed', 'rejected')),
  close_reason TEXT,
  deal_id UUID,        -- логическая связь с customer_deals.id
  deal_number INT,
  payment_id UUID,     -- логическая связь с bank_payments.id
  company_name TEXT,
  short_name TEXT,
  inn TEXT,
  kpp TEXT,
  ogrn TEXT,
  legal_address TEXT,
  actual_address TEXT,
  tax_system TEXT,
  bank_account TEXT,
  bank_name TEXT,
  bik TEXT,
  correspondent_account TEXT,
  delivery_address TEXT,
  -- Доставка заказа (админка)
  has_delivery BOOLEAN DEFAULT FALSE,
  delivery_type TEXT CHECK (delivery_type IS NULL OR delivery_type IN ('free', 'paid')),
  delivery_cost NUMERIC DEFAULT 0,
  delivery_planned_date DATE,
  delivery_released_at TIMESTAMPTZ,
  delivery_note TEXT,
  customer_edited_at TIMESTAMPTZ,
  customer_cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_phone_digits ON orders(customer_phone_digits);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_type ON orders(type);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_has_delivery ON orders(has_delivery) WHERE has_delivery = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_delivery_planned ON orders(delivery_planned_date) WHERE has_delivery = TRUE;
DROP TRIGGER IF EXISTS trg_orders_updated ON orders;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 6. НАСТРОЙКИ
-- =========================================================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_settings_updated ON settings;
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 7. АКЦИИ
-- =========================================================
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT,
  badge TEXT,
  image_url TEXT,
  link_type TEXT NOT NULL DEFAULT 'none' CHECK (link_type IN ('product', 'url', 'none')),
  product_id UUID,
  link_url TEXT,
  sort_order INT DEFAULT 0,
  is_visible BOOLEAN DEFAULT TRUE,
  icon TEXT,
  color TEXT,
  light TEXT,
  deadline TEXT,
  is_popup BOOLEAN DEFAULT FALSE,
  popup_start_at TEXT,
  popup_delay_seconds INT,
  popup_duration_seconds INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promotions_sort ON promotions(sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_promotions_visible ON promotions(is_visible) WHERE is_visible = TRUE;
DROP TRIGGER IF EXISTS trg_promotions_updated ON promotions;
CREATE TRIGGER trg_promotions_updated BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 7.1 ПЛИТКИ РАЗДЕЛОВ НА ГЛАВНОЙ
-- Витрина главной страницы: набор, порядок, фото и правило отбора
-- товаров задаются в админке. Каталог не затрагивается.
-- =========================================================
CREATE TABLE IF NOT EXISTS home_tiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT,
  image_url TEXT,
  icon TEXT,
  kind TEXT NOT NULL DEFAULT 'category'
    CHECK (kind IN ('category', 'tag', 'featured', 'sale', 'all')),
  category_id UUID,   -- логическая связь с categories.id (без FK!)
  tag TEXT,           -- метка или несколько через запятую
  accent TEXT,
  sort_order INT DEFAULT 0,
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_home_tiles_sort ON home_tiles(sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_home_tiles_visible ON home_tiles(is_visible) WHERE is_visible = TRUE;
DROP TRIGGER IF EXISTS trg_home_tiles_updated ON home_tiles;
CREATE TRIGGER trg_home_tiles_updated BEFORE UPDATE ON home_tiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE home_tiles ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 8. POPUP-КАМПАНИИ
-- =========================================================
CREATE TABLE IF NOT EXISTS popup_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'banner' CHECK (type IN ('banner', 'story')),
  title TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  kicker TEXT,
  description TEXT,
  details TEXT,
  button_text TEXT,
  button_url TEXT,
  style TEXT DEFAULT 'info' CHECK (style IN ('info', 'promo', 'important')),
  image_url TEXT,
  start_at TEXT,
  end_at TEXT,
  delay_seconds INT DEFAULT 0,
  duration_seconds INT DEFAULT 20,
  frequency TEXT DEFAULT 'session' CHECK (frequency IN ('session', 'day', 'always')),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_popup_campaigns_active ON popup_campaigns(is_active) WHERE is_active = TRUE;
DROP TRIGGER IF EXISTS trg_popup_campaigns_updated ON popup_campaigns;
CREATE TRIGGER trg_popup_campaigns_updated BEFORE UPDATE ON popup_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 9. ОТЗЫВЫ  (product_id — логическая связь, БЕЗ FK)
-- =========================================================
CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL,  -- логическая связь с products.id (без FK!)
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  user_avatar TEXT,
  order_id TEXT DEFAULT '',
  rating INT NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  title TEXT,
  text TEXT NOT NULL DEFAULT '',
  pros TEXT,
  cons TEXT,
  images JSONB DEFAULT '[]'::jsonb,
  is_verified_purchase BOOLEAN DEFAULT FALSE,
  helpful_count INT DEFAULT 0,
  is_approved BOOLEAN DEFAULT FALSE,
  moderation_status TEXT DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  moderation_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_approved ON product_reviews(product_id, is_approved, moderation_status);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON product_reviews(created_at DESC);
DROP TRIGGER IF EXISTS trg_reviews_updated ON product_reviews;
CREATE TRIGGER trg_reviews_updated BEFORE UPDATE ON product_reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 10. ГОЛОСА ЗА ОТЗЫВЫ (review_id — логическая связь, БЕЗ FK)
-- =========================================================
CREATE TABLE IF NOT EXISTS review_helpful_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL,  -- логическая связь с product_reviews.id
  voter_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(review_id, voter_key)
);
CREATE INDEX IF NOT EXISTS idx_helpful_votes_review ON review_helpful_votes(review_id);

-- =========================================================
-- 11. ВОПРОСЫ (product_id — логическая связь, БЕЗ FK)
-- =========================================================
CREATE TABLE IF NOT EXISTS product_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL,  -- логическая связь с products.id
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  user_avatar TEXT,
  question TEXT NOT NULL DEFAULT '',
  answer TEXT,
  answer_author TEXT,
  answered_at TIMESTAMPTZ,
  is_answered BOOLEAN DEFAULT FALSE,
  helpful_count INT DEFAULT 0,
  is_approved BOOLEAN DEFAULT FALSE,
  moderation_status TEXT DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  moderation_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_questions_product ON product_questions(product_id);
CREATE INDEX IF NOT EXISTS idx_questions_approved ON product_questions(product_id, is_approved, moderation_status);
CREATE INDEX IF NOT EXISTS idx_questions_created ON product_questions(created_at DESC);
DROP TRIGGER IF EXISTS trg_questions_updated ON product_questions;
CREATE TRIGGER trg_questions_updated BEFORE UPDATE ON product_questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 12. РЕЙТИНГИ (product_id — логическая связь, БЕЗ FK)
-- =========================================================
CREATE TABLE IF NOT EXISTS product_ratings (
  product_id UUID PRIMARY KEY,  -- логическая связь с products.id
  average_rating NUMERIC DEFAULT 0,
  total_reviews INT DEFAULT 0,
  rating_distribution JSONB DEFAULT '{"5":0,"4":0,"3":0,"2":0,"1":0}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_product_ratings_updated ON product_ratings;
CREATE TRIGGER trg_product_ratings_updated BEFORE UPDATE ON product_ratings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 13. ПРОСМОТРЫ (product_id — логическая связь, БЕЗ FK)
-- =========================================================
CREATE TABLE IF NOT EXISTS product_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL,  -- логическая связь с products.id
  user_id TEXT,
  session_id TEXT NOT NULL DEFAULT '',
  ip_hash TEXT,
  user_agent TEXT,
  referrer TEXT,
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_views_product ON product_views(product_id);
CREATE INDEX IF NOT EXISTS idx_views_session ON product_views(session_id);

-- =========================================================
-- 14. ЗАЯВКИ НА МАКУЛАТУРУ
-- =========================================================
CREATE TABLE IF NOT EXISTS wastepaper_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  wastepaper_type TEXT,
  weight NUMERIC DEFAULT 0,
  delivery_method TEXT,
  estimated_payout NUMERIC DEFAULT 0,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wastepaper_status ON wastepaper_requests(status);
CREATE INDEX IF NOT EXISTS idx_wastepaper_created ON wastepaper_requests(created_at DESC);
DROP TRIGGER IF EXISTS trg_wastepaper_updated ON wastepaper_requests;
CREATE TRIGGER trg_wastepaper_updated BEFORE UPDATE ON wastepaper_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 15. СЧЁТЧИКИ ДОКУМЕНТОВ
-- =========================================================
CREATE TABLE IF NOT EXISTS doc_counters (
  key TEXT PRIMARY KEY,
  value INT NOT NULL DEFAULT 0
);
INSERT INTO doc_counters (key, value) VALUES
  ('receipt', 0), ('deal', 0), ('payment', 0), ('salary', 0), ('bank_account_transfer', 0)
ON CONFLICT DO NOTHING;

-- =========================================================
-- 16. КОНТРАГЕНТЫ
-- =========================================================
CREATE TABLE IF NOT EXISTS counterparties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  normalized_name TEXT NOT NULL DEFAULT '',
  roles JSONB DEFAULT '[]'::jsonb,
  supplier_prices JSONB DEFAULT '{}'::jsonb,
  phone TEXT,
  email TEXT,
  inn TEXT,
  kpp TEXT,
  ogrn TEXT,
  full_name TEXT,
  short_name TEXT,
  legal_address TEXT,
  tax_system TEXT,
  bank_account TEXT,
  bank_name TEXT,
  bik TEXT,
  correspondent_account TEXT,
  address TEXT,
  contact_name TEXT,
  comment TEXT,
  is_cash BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_counterparties_normalized ON counterparties(normalized_name);
DROP TRIGGER IF EXISTS trg_counterparties_updated ON counterparties;
CREATE TRIGGER trg_counterparties_updated BEFORE UPDATE ON counterparties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 17. ЦЕНЫ ПОСТАВЩИКОВ (counterparty_id, product_id — без FK)
-- =========================================================
CREATE TABLE IF NOT EXISTS supplier_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counterparty_id TEXT NOT NULL,  -- логическая связь
  product_id UUID NOT NULL,       -- логическая связь
  price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(counterparty_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_counterparty ON supplier_prices(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_product ON supplier_prices(product_id);
DROP TRIGGER IF EXISTS trg_supplier_prices_updated ON supplier_prices;
CREATE TRIGGER trg_supplier_prices_updated BEFORE UPDATE ON supplier_prices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 18. ПОСТУПЛЕНИЯ
-- =========================================================
CREATE TABLE IF NOT EXISTS warehouse_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  counterparty_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  phone TEXT,
  email TEXT,
  inn TEXT,
  kpp TEXT,
  address TEXT,
  contact_name TEXT,
  comment TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  -- Накопительно принято на склад: [{productId, name, receivedQty}].
  received_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC NOT NULL DEFAULT 0,
  bank_adjustment NUMERIC DEFAULT 0,
  vat_rate NUMERIC DEFAULT 22,
  vat_amount NUMERIC DEFAULT 0,
  linked_deal_ids JSONB DEFAULT '[]'::jsonb,
  linked_deal_numbers JSONB DEFAULT '[]'::jsonb,
  is_consignment BOOLEAN NOT NULL DEFAULT FALSE,
  -- Забрать поставку нашим транспортом («Заберём сами»): поставка встаёт
  -- в очередь перевозок учёта и едет в путевом листе как «забор груза».
  needs_transport BOOLEAN NOT NULL DEFAULT FALSE,
  transport_planned_date DATE,
  -- Подтверждённое завершение недопоставленной перевозки и отметки об оплате излишков.
  transport_finished_at TIMESTAMPTZ,
  paid_overdelivery_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_number ON warehouse_receipts(number);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON warehouse_receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON warehouse_receipts(date);
CREATE INDEX IF NOT EXISTS idx_receipts_items_gin ON warehouse_receipts USING GIN (items jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_receipts_needs_transport ON warehouse_receipts(needs_transport) WHERE needs_transport = TRUE;
DROP TRIGGER IF EXISTS trg_receipts_updated ON warehouse_receipts;
CREATE TRIGGER trg_receipts_updated BEFORE UPDATE ON warehouse_receipts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Планы будущих поставок: не влияют на склад/банк до создания реального поступления.
CREATE TABLE IF NOT EXISTS warehouse_supply_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  planned_date TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supply_plans_status ON warehouse_supply_plans(status);
CREATE INDEX IF NOT EXISTS idx_supply_plans_date ON warehouse_supply_plans(planned_date);
DROP TRIGGER IF EXISTS trg_supply_plans_updated ON warehouse_supply_plans;
CREATE TRIGGER trg_supply_plans_updated BEFORE UPDATE ON warehouse_supply_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE warehouse_supply_plans ENABLE ROW LEVEL SECURITY;

-- Накопительные планы закупок. Пополнения виртуальные; фактическое
-- списание создаёт отдельный проведённый платёж с выбранного счёта.
CREATE TABLE IF NOT EXISTS warehouse_purchase_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT,
  ozon_url TEXT,
  ozon_image_url TEXT,
  ozon_image_public_id TEXT,
  ozon_price NUMERIC,
  ozon_checked_at TIMESTAMPTZ,
  ozon_price_updated_at TIMESTAMPTZ,
  ozon_last_error TEXT,
  target_amount NUMERIC NOT NULL DEFAULT 0,
  contribution_amount NUMERIC NOT NULL DEFAULT 500,
  account TEXT NOT NULL DEFAULT 'bank' CHECK (account IN ('cash', 'bank', 'ym_card')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  contributions JSONB NOT NULL DEFAULT '[]'::jsonb,
  spent_amount NUMERIC NOT NULL DEFAULT 0,
  spent_payment_id UUID,
  spent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_plans_status ON warehouse_purchase_plans(status);
CREATE INDEX IF NOT EXISTS idx_purchase_plans_product ON warehouse_purchase_plans(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_plans_ozon_refresh
  ON warehouse_purchase_plans(status, ozon_checked_at)
  WHERE ozon_url IS NOT NULL;
DROP TRIGGER IF EXISTS trg_purchase_plans_updated ON warehouse_purchase_plans;
CREATE TRIGGER trg_purchase_plans_updated BEFORE UPDATE ON warehouse_purchase_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE warehouse_purchase_plans ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 19. ЗАКАЗЫ ПОКУПАТЕЛЕЙ
-- =========================================================
CREATE TABLE IF NOT EXISTS customer_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  counterparty_id TEXT,
  customer_phone TEXT,
  phone TEXT,
  email TEXT,
  inn TEXT,
  kpp TEXT,
  address TEXT,
  contact_name TEXT,
  comment TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  total NUMERIC NOT NULL DEFAULT 0,
  bank_adjustment NUMERIC DEFAULT 0,
  vat_rate NUMERIC DEFAULT 22,
  vat_amount NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'completed', 'cancelled')),
  cancel_reason TEXT,
  source_order_id UUID,
  -- Доставка заказа учёта
  has_delivery BOOLEAN DEFAULT FALSE,
  delivery_type TEXT CHECK (delivery_type IS NULL OR delivery_type IN ('free', 'paid')),
  delivery_cost NUMERIC DEFAULT 0,
  delivery_address TEXT,
  delivery_planned_date DATE,
  delivery_released_at TIMESTAMPTZ,
  delivery_note TEXT,
  delivery_driver_id UUID,      -- логическая связь с employees.id
  delivery_driver_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deals_number ON customer_deals(number);
CREATE INDEX IF NOT EXISTS idx_deals_status ON customer_deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_date ON customer_deals(date);
CREATE INDEX IF NOT EXISTS idx_deals_items_gin ON customer_deals USING GIN (items jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_deals_source_order ON customer_deals(source_order_id);
CREATE INDEX IF NOT EXISTS idx_deals_has_delivery ON customer_deals(has_delivery) WHERE has_delivery = TRUE;
CREATE INDEX IF NOT EXISTS idx_deals_delivery_planned ON customer_deals(delivery_planned_date) WHERE has_delivery = TRUE;
CREATE INDEX IF NOT EXISTS idx_deals_delivery_driver ON customer_deals(delivery_driver_id) WHERE has_delivery = TRUE;
DROP TRIGGER IF EXISTS trg_deals_updated ON customer_deals;
CREATE TRIGGER trg_deals_updated BEFORE UPDATE ON customer_deals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 20. БАНКОВСКИЕ ПЛАТЕЖИ
-- =========================================================
CREATE TABLE IF NOT EXISTS bank_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  type TEXT DEFAULT 'regular',
  -- Для наличного входящего: куда предвыбрать деньги при сдаче кассы.
  cash_destination TEXT CHECK (cash_destination IN ('cash', 'card', 'vm_card')),
  counterparty TEXT NOT NULL DEFAULT '',
  counterparty_id TEXT,
  deal_ids JSONB DEFAULT '[]'::jsonb,
  deal_numbers JSONB DEFAULT '[]'::jsonb,
  receipt_ids JSONB DEFAULT '[]'::jsonb,
  receipt_numbers JSONB DEFAULT '[]'::jsonb,
  amount NUMERIC NOT NULL DEFAULT 0,
  invoice_number TEXT,
  vat_rate NUMERIC DEFAULT 22,
  vat_amount NUMERIC DEFAULT 0,
  is_paid BOOLEAN DEFAULT FALSE,
  paid_at TEXT,
  -- TRUE = платёж закрывает связанный документ, но не влияет на текущий банк/кассу
  -- (архивная/старая оплата, чтобы не было ложных долгов и уведомлений).
  exclude_from_balance BOOLEAN DEFAULT FALSE,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_direction ON bank_payments(direction);
CREATE INDEX IF NOT EXISTS idx_payments_paid ON bank_payments(is_paid);
CREATE INDEX IF NOT EXISTS idx_payments_date ON bank_payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_exclude_from_balance ON bank_payments(exclude_from_balance);
DROP TRIGGER IF EXISTS trg_payments_updated ON bank_payments;
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON bank_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 20a. ВНУТРЕННИЕ ПЕРЕВОДЫ МЕЖДУ ДЕНЕЖНЫМИ СЧЕТАМИ
-- =========================================================
CREATE TABLE IF NOT EXISTS bank_account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  from_account TEXT NOT NULL CHECK (from_account IN ('cash', 'bank', 'ym_card', 'vm_card')),
  to_account TEXT NOT NULL CHECK (to_account IN ('cash', 'bank', 'ym_card', 'vm_card')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT bank_account_transfers_different_accounts CHECK (from_account <> to_account)
);
CREATE INDEX IF NOT EXISTS idx_bank_account_transfers_date ON bank_account_transfers(date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_account_transfers_accounts ON bank_account_transfers(from_account, to_account);
DROP TRIGGER IF EXISTS trg_bank_account_transfers_updated ON bank_account_transfers;
CREATE TRIGGER trg_bank_account_transfers_updated BEFORE UPDATE ON bank_account_transfers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE bank_account_transfers ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 21. СОТРУДНИКИ
-- =========================================================
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  position TEXT,
  phone TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_employees_updated ON employees;
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 22. ЗАРПЛАТЫ (employee_id — логическая связь, БЕЗ FK)
-- =========================================================
CREATE TABLE IF NOT EXISTS salaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID,  -- логическая связь с employees.id (без FK!)
  employee_name TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  date TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'bank' CHECK (source IN ('cash', 'bank')),
  is_paid BOOLEAN DEFAULT FALSE,
  paid_at TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salaries_employee ON salaries(employee_id);
CREATE INDEX IF NOT EXISTS idx_salaries_date ON salaries(date);
CREATE INDEX IF NOT EXISTS idx_salaries_paid ON salaries(is_paid);
DROP TRIGGER IF EXISTS trg_salaries_updated ON salaries;
CREATE TRIGGER trg_salaries_updated BEFORE UPDATE ON salaries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 22.1. ТАБЕЛИ ОХРАНЫ — единый постоянный снимок
-- =========================================================
CREATE TABLE IF NOT EXISTS duty_schedule_state (
  id TEXT PRIMARY KEY DEFAULT 'main' CHECK (id = 'main'),
  snapshot JSONB NOT NULL DEFAULT '{
    "employees": [],
    "schedules": {},
    "amountOverrides": {},
    "salaryPayouts": {},
    "payoutTitles": {},
    "salaryAccruals": {},
    "payPlans": {}
  }'::jsonb,
  pay_offset SMALLINT NOT NULL DEFAULT 1 CHECK (pay_offset IN (0, 1, 2)),
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_duty_schedule_state_updated ON duty_schedule_state;
CREATE TRIGGER trg_duty_schedule_state_updated
  BEFORE UPDATE ON duty_schedule_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 22.2. ФАКТИЧЕСКИЕ СВОДКИ КАССОВЫХ СМЕН
-- Справочный снимок дня: наличные, карта ЮМ, расходы и остаток кассы.
-- Запись не является движением денег и не влияет на прибыль/баланс сама.
-- =========================================================
CREATE TABLE IF NOT EXISTS cash_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date TEXT NOT NULL DEFAULT '',
  -- Все отмеченные поступления дня: наличные + карта ЮМ, без переноса.
  amount NUMERIC NOT NULL DEFAULT 0,
  -- Фактический остаток наличных в кассе на конец дня.
  cash_amount NUMERIC NOT NULL DEFAULT 0,
  -- Отмеченные поступления на ЮМ; это метка, а не новое движение денег.
  transfer_amount NUMERIC NOT NULL DEFAULT 0,
  items JSONB DEFAULT '[]'::jsonb,
  -- Расходы двух касс: [{kind, id, title, amount, sourceKind:'cash'|'card'}].
  expenses JSONB DEFAULT '[]'::jsonb,
  -- Дублирует общий приход смены для отчётов: наличные + ЮМ.
  income_amount NUMERIC,
  -- Общие расходы наличной кассы и карты ЮМ.
  expenses_amount NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cash_collections_date ON cash_collections(date);

-- =========================================================
-- ROW LEVEL SECURITY
-- service_role ключ обходит RLS автоматически.
-- Эти политики — для публичного доступа (anon key).
-- =========================================================

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE popup_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_helpful_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE wastepaper_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE salaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE duty_schedule_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_collections ENABLE ROW LEVEL SECURITY;

-- Публичное чтение
DROP POLICY IF EXISTS "cat_sel" ON categories;
CREATE POLICY "cat_sel" ON categories FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "prod_sel" ON products;
CREATE POLICY "prod_sel" ON products FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "settings_sel" ON settings;
CREATE POLICY "settings_sel" ON settings FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "promo_sel" ON promotions;
CREATE POLICY "promo_sel" ON promotions FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "popup_sel" ON popup_campaigns;
CREATE POLICY "popup_sel" ON popup_campaigns FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "rating_sel" ON product_ratings;
CREATE POLICY "rating_sel" ON product_ratings FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "rev_sel" ON product_reviews;
CREATE POLICY "rev_sel" ON product_reviews FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "rev_ins" ON product_reviews;
CREATE POLICY "rev_ins" ON product_reviews FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "q_sel" ON product_questions;
CREATE POLICY "q_sel" ON product_questions FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "q_ins" ON product_questions;
CREATE POLICY "q_ins" ON product_questions FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "view_ins" ON product_views;
CREATE POLICY "view_ins" ON product_views FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "helpful_ins" ON review_helpful_votes;
CREATE POLICY "helpful_ins" ON review_helpful_votes FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "wp_ins" ON wastepaper_requests;
CREATE POLICY "wp_ins" ON wastepaper_requests FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "users_ins" ON users;
CREATE POLICY "users_ins" ON users FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "users_sel" ON users;
CREATE POLICY "users_sel" ON users FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "users_upd" ON users;
CREATE POLICY "users_upd" ON users FOR UPDATE USING (TRUE);

DROP POLICY IF EXISTS "orders_ins" ON orders;
CREATE POLICY "orders_ins" ON orders FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "orders_sel" ON orders;
CREATE POLICY "orders_sel" ON orders FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "orders_upd" ON orders;
CREATE POLICY "orders_upd" ON orders FOR UPDATE USING (TRUE);

-- ── Страховка: RLS на всех остальных таблицах public ──
-- Схема public целиком публикуется наружу через PostgREST, а ключ
-- anon зашит в JS-бандл сайта. Любая таблица, забытая в списке выше
-- (а также созданная отдельной миграцией или временным скриптом),
-- оказывается доступна на чтение обычным HTTP-запросом.
-- Именно так «утекли» _backup_bank_payments и transports —
-- Supabase Security Advisor пометил их как Critical.
--
-- Здесь только ENABLE, без FORCE: service_role (getAdminDb в
-- приложении) обходит RLS, поэтому серверная логика не страдает.
-- Таблицы без политик = доступ только с сервера, что и требуется
-- для админских данных.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = FALSE
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    RAISE NOTICE 'RLS включён (страховка): %', r.relname;
  END LOOP;
END $$;

-- =========================================================
-- ФУНКЦИИ
-- =========================================================

-- Обновление рейтинга товара
CREATE OR REPLACE FUNCTION fn_update_product_rating()
RETURNS TRIGGER AS $$
DECLARE
  v_product_id UUID;
  v_avg NUMERIC;
  v_total INT;
  v_dist JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD.product_id;
  ELSE
    v_product_id := NEW.product_id;
  END IF;

  SELECT COALESCE(AVG(rating), 0), COUNT(*)
  INTO v_avg, v_total
  FROM product_reviews
  WHERE product_id = v_product_id
    AND is_approved = TRUE AND moderation_status = 'approved';

  v_avg := ROUND(v_avg * 10) / 10;

  SELECT jsonb_build_object(
    '5', COUNT(*) FILTER (WHERE rating = 5),
    '4', COUNT(*) FILTER (WHERE rating = 4),
    '3', COUNT(*) FILTER (WHERE rating = 3),
    '2', COUNT(*) FILTER (WHERE rating = 2),
    '1', COUNT(*) FILTER (WHERE rating = 1)
  ) INTO v_dist
  FROM product_reviews
  WHERE product_id = v_product_id
    AND is_approved = TRUE AND moderation_status = 'approved';

  INSERT INTO product_ratings (product_id, average_rating, total_reviews, rating_distribution)
  VALUES (v_product_id, v_avg, v_total, v_dist)
  ON CONFLICT (product_id) DO UPDATE SET
    average_rating = v_avg, total_reviews = v_total,
    rating_distribution = v_dist, updated_at = NOW();

  UPDATE products SET average_rating = v_avg, total_reviews = v_total WHERE id = v_product_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_reviews_rating_update ON product_reviews;
CREATE TRIGGER trg_reviews_rating_update
  AFTER INSERT OR UPDATE OR DELETE ON product_reviews
  FOR EACH ROW EXECUTE FUNCTION fn_update_product_rating();

-- Счётчик документов
CREATE OR REPLACE FUNCTION fn_next_counter(p_key TEXT)
RETURNS INT AS $$
DECLARE v_val INT;
BEGIN
  UPDATE doc_counters SET value = value + 1 WHERE key = p_key RETURNING value INTO v_val;
  IF v_val IS NULL THEN
    INSERT INTO doc_counters (key, value) VALUES (p_key, 1) RETURNING value INTO v_val;
  END IF;
  RETURN v_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Инкремент просмотров
CREATE OR REPLACE FUNCTION fn_increment_view_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products SET view_count = COALESCE(view_count, 0) + 1 WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_views_increment ON product_views;
CREATE TRIGGER trg_views_increment
  AFTER INSERT ON product_views
  FOR EACH ROW EXECUTE FUNCTION fn_increment_view_count();

-- =========================================================
-- СВЯЗКИ КАРТОЧЕК ТОВАРОВ (product_link_groups — как на Ozon)
-- См. также supabase/migration_product_links.sql
-- =========================================================
CREATE TABLE IF NOT EXISTS product_link_groups (
  id TEXT PRIMARY KEY,
  primary_product_id TEXT NOT NULL,
  product_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  group_title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_link_groups_members
  ON product_link_groups USING GIN (product_ids);

DROP TRIGGER IF EXISTS trg_product_link_groups_updated ON product_link_groups;
CREATE TRIGGER trg_product_link_groups_updated
  BEFORE UPDATE ON product_link_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE product_link_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plg_anon_select ON product_link_groups;
CREATE POLICY plg_anon_select ON product_link_groups
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS plg_service_all ON product_link_groups;
CREATE POLICY plg_service_all ON product_link_groups
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- =========================================================
-- РУЧНЫЕ ЗАЯВКИ КЛИЕНТОВ (CRM-обращения, не связаны с заказами)
-- См. также migration_client_requests.sql
-- =========================================================
CREATE TABLE IF NOT EXISTS client_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  contact_method TEXT NOT NULL DEFAULT 'call'
    CHECK (contact_method IN ('call', 'whatsapp', 'telegram', 'max', 'email', 'visit', 'other')),
  subject TEXT NOT NULL DEFAULT '',
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'completed', 'rejected')),
  close_reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_requests_status ON client_requests(status);
CREATE INDEX IF NOT EXISTS idx_client_requests_created ON client_requests(created_at DESC);
DROP TRIGGER IF EXISTS trg_client_requests_updated ON client_requests;
CREATE TRIGGER trg_client_requests_updated
  BEFORE UPDATE ON client_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE client_requests ENABLE ROW LEVEL SECURITY;
-- Политик нет: чтение/запись только с сервера (service_role).

-- Типы размеров товаров — см. supabase/migration_dimension_profiles.sql


-- =====================================================================
-- МИГРАЦИЯ: migration_rbac_logs.sql
-- =====================================================================
-- =========================================================
-- Миграция: права доступа, логи действий, ответственные
-- =========================================================

-- 1. Роли в таблице admins
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin' CHECK (role IN ('admin', 'manager', 'lawyer'));
ALTER TABLE admins ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT '';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 2. Таблица логов действий
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID,
  admin_name TEXT NOT NULL DEFAULT '',
  admin_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',        -- 'create' | 'update' | 'delete' | 'status_change' | 'login' | 'export'
  entity_type TEXT NOT NULL DEFAULT '',    -- 'order' | 'deal' | 'payment' | 'receipt' | 'product' | 'transport' | 'delivery' | 'settings'
  entity_id TEXT DEFAULT '',
  entity_label TEXT DEFAULT '',            -- человекочитаемое описание ("Заказ #123", "Платёж ПЛ-5")
  details JSONB DEFAULT '{}'::jsonb,       -- {field, oldValue, newValue} или {status: "new→completed"}
  ip_address TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_admin ON activity_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);

-- 3. Поля ответственного в ключевых таблицах
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';
ALTER TABLE bank_payments ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';
ALTER TABLE warehouse_receipts ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';
ALTER TABLE transports ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';

-- 4. RLS для логов (только чтение для авторизованных)
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "logs_sel" ON activity_logs;
CREATE POLICY "logs_sel" ON activity_logs FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "logs_ins" ON activity_logs;
CREATE POLICY "logs_ins" ON activity_logs FOR INSERT WITH CHECK (TRUE);


-- =====================================================================
-- МИГРАЦИЯ: migration_admin_nav_layouts.sql
-- =====================================================================
-- =========================================================
-- Миграция: личная навигация админки
--
-- У каждого пользователя админки своя раскладка меню:
-- группы, порядок вкладок, иконки и подписи.
-- RLS включён без публичных политик — читает и пишет
-- только сервер админки (service_role).
--
-- Если миграцию ещё не запускали, приложение само
-- сохраняет ту же JSON-раскладку в settings
-- (ключ admin_nav_layout:<логин>). После применения
-- этого файла новые сохранения уходят в таблицу.
--
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- Идемпотентна.
-- =========================================================

CREATE TABLE IF NOT EXISTS admin_nav_layouts (
  username TEXT PRIMARY KEY,
  layout JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_admin_nav_layouts_updated ON admin_nav_layouts;
CREATE TRIGGER trg_admin_nav_layouts_updated
  BEFORE UPDATE ON admin_nav_layouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE admin_nav_layouts ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- МИГРАЦИЯ: migration_admin_lawyer_role.sql
-- =====================================================================
-- =========================================================
-- Роль lawyer для ограниченного финансового дашборда
-- =========================================================

ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin';

-- В старой миграции CHECK разрешал только admin/manager. Имя ограничения,
-- созданного PostgreSQL для колонки admins.role, стандартное.
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;

UPDATE admins SET role = 'admin' WHERE role IS NULL;
ALTER TABLE admins ALTER COLUMN role SET DEFAULT 'admin';
ALTER TABLE admins ALTER COLUMN role SET NOT NULL;

ALTER TABLE admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('admin', 'manager', 'lawyer'));

COMMENT ON COLUMN admins.role IS
  'admin — полный доступ; manager — всё кроме настроек сайта и логов; lawyer — только финансовый дашборд и перевозки';


-- =====================================================================
-- МИГРАЦИЯ: migration_owner_role_and_money.sql
-- =====================================================================
-- =========================================================
-- Миграция: роль «Владелец» + прямые правки денежных счетов.
--
-- 1. Владелец — надмножество администратора. Дополнительно он может
--    менять остаток любого денежного счёта БЕЗ документа (касса, р/с,
--    карты ЮМ и В.М.): деньги просто появляются или исчезают.
-- 2. Каждая такая правка пишется в money_adjustments и в журнал
--    действий (entity_type = 'money-adjustment'), который видят
--    только владельцы.
--
-- Файл идемпотентен: можно запускать повторно.
-- =========================================================

-- ── 1. Роль owner ────────────────────────────────────────
-- В migration_wastepaper_account.sql CHECK разрешал
-- admin/manager/lawyer/wastepaper — заменяем на полный список.
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'lawyer', 'wastepaper'));

COMMENT ON COLUMN admins.role IS
  'owner — полный доступ и правка денежных счетов без документов; admin — полный доступ; manager — всё кроме настроек, базы данных и логов; lawyer — только финансовый дашборд; wastepaper — только отдельный учёт макулатуры';

-- ── 2. Прямые правки денежных счетов ─────────────────────
CREATE TABLE IF NOT EXISTS money_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account TEXT NOT NULL CHECK (account IN ('cash', 'bank', 'ym_card', 'vm_card')),
  -- Плюс — деньги пришли, минус — списаны («убрать 14 ₽»).
  delta NUMERIC(14,2) NOT NULL CHECK (delta <> 0),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  -- Снимок «стало» для журнала владельца (не участвует в расчёте).
  balance_after NUMERIC(14,2),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_money_adjustments_date
  ON money_adjustments(date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_money_adjustments_account
  ON money_adjustments(account);

-- Расширения для старых баз: колонки могли появиться в предыдущей версии.
ALTER TABLE money_adjustments
  ADD COLUMN IF NOT EXISTS balance_after NUMERIC(14,2);
ALTER TABLE money_adjustments
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Читает и пишет только сервер приложения (service_role обходит RLS).
-- Публичных политик нет намеренно: движения владельца не должны быть
-- доступны никому, кроме него.
ALTER TABLE money_adjustments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE money_adjustments IS
  'Прямые правки денежных счетов владельцем: без документов, в журнале видны только роли owner';



-- =====================================================================
-- МИГРАЦИЯ: migration_local_db_sync_and_emergency_auth.sql
-- =====================================================================
-- =========================================================
-- ДВУСТОРОННЯЯ СИНХРОНИЗАЦИЯ SUPABASE ↔ ЛОКАЛЬНАЯ JSON-БД
-- И АУДИТ АВАРИЙНОГО БЕСПАРОЛЬНОГО ВХОДА ПО ФАЙЛУ ЛОКАЛЬНОЙ БД
--
-- Назначение:
--   • Хранит журнал сеансов синхронизации (экспорт Supabase → локалка,
--     импорт локалка → Supabase, двусторонняя сверка с досылкой офлайн-правок)
--   • Фиксирует полный путь локального файла БД (`local_file_path`) при
--     синхронизации и аварийном беспарольном входе при отказе основной БД
--
-- Идемпотентная миграция: безопасно запускать повторно.
-- =========================================================

CREATE TABLE IF NOT EXISTS db_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL CHECK (
    direction IN (
      'supabase_to_local',
      'local_to_supabase',
      'bidirectional',
      'emergency_file_login'
    )
  ),
  status TEXT NOT NULL DEFAULT 'success' CHECK (
    status IN ('success', 'partial', 'error')
  ),
  target_label TEXT,
  synced_tables INT NOT NULL DEFAULT 0,
  synced_rows INT NOT NULL DEFAULT 0,
  replayed_mutations INT NOT NULL DEFAULT 0,
  local_file_path TEXT,
  initiated_by TEXT,
  error_message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_sync_runs_created_at
  ON db_sync_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_db_sync_runs_direction
  ON db_sync_runs(direction, created_at DESC);

ALTER TABLE db_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS db_sync_runs_service_all ON db_sync_runs;
CREATE POLICY db_sync_runs_service_all ON db_sync_runs
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND tablename = 'db_sync_runs'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE db_sync_runs';
  END IF;
END $$;


-- =====================================================================
-- МИГРАЦИЯ: migration_dimension_profiles.sql
-- =====================================================================
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


-- =====================================================================
-- МИГРАЦИЯ: migration_cuttable.sql
-- =====================================================================
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


-- =====================================================================
-- МИГРАЦИЯ: migration_made_to_order_min_qty.sql
-- =====================================================================
-- Добавление поля минимального количества для товаров под заказ
ALTER TABLE products ADD COLUMN IF NOT EXISTS made_to_order_min_qty INT;
CREATE INDEX IF NOT EXISTS idx_products_made_to_order ON products(made_to_order) WHERE made_to_order = TRUE;


-- =====================================================================
-- МИГРАЦИЯ: migration_product_barcodes.sql
-- =====================================================================
-- =========================================================
-- FILE: supabase/migration_product_barcodes.sql
-- Постоянные штрихкоды (EAN-13) для товаров.
--
-- Раньше штрихкод считался детерминированно из id товара и не
-- хранился в БД. Теперь присваиваем каждому товару штрихкод
-- в колонке `products.barcode` — раз и навсегда:
--   • код не меняется при любых правках товара;
--   • меняется только вручную (форма товара) или кнопкой
--     «Обновить штрихкоды» — и та трогает ТОЛЬКО товары без
--     кода или с битым (дубль/невалидная сумма) кодом;
--   • уникальность гарантирует индекс — два разных товара
--     физически не могут получить одинаковый EAN.
--
-- Выполнить в SQL Editor Supabase (или через supabase db push).
-- Идемпотентно: повторный запуск безопасен.
-- =========================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;

-- Уникальный индекс только по заполненным значениям (NULL-ы у
-- старых товаров не конфликтуют между собой в Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
  ON products (barcode)
  WHERE barcode IS NOT NULL;

-- Быстрый поиск товара по коду из сканера (по тому же индексу —
-- отдельный не нужен, unique index покрывает и lookup).

COMMENT ON COLUMN products.barcode IS
  'Постоянный штрихкод EAN-13 товара (обычно с префиксом 200 — внутренний диапазон магазина). Присваивается один раз и меняется только вручную.';


-- =====================================================================
-- МИГРАЦИЯ: migration_product_links.sql
-- =====================================================================
-- =========================================================
-- СВЯЗКИ КАРТОЧЕК ТОВАРОВ (объединённые карточки как на Ozon)
-- Заменяет старую таблицу product_variants: каждый вариант —
-- обычная самостоятельная карточка товара со своим складом,
-- ценой, артикулом и штрихкодом, связанная в единую группу.
-- Идемпотентная миграция: безопасно запускать повторно.
-- =========================================================

CREATE TABLE IF NOT EXISTS product_link_groups (
  id TEXT PRIMARY KEY,
  primary_product_id TEXT NOT NULL,
  product_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  group_title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_link_groups_members
  ON product_link_groups USING GIN (product_ids);

DROP TRIGGER IF EXISTS trg_product_link_groups_updated ON product_link_groups;
CREATE TRIGGER trg_product_link_groups_updated
  BEFORE UPDATE ON product_link_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE product_link_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plg_anon_select ON product_link_groups;
CREATE POLICY plg_anon_select ON product_link_groups
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS plg_service_all ON product_link_groups;
CREATE POLICY plg_service_all ON product_link_groups
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Удаление старой таблицы под-вариантов (если создавалась ранее)
DROP TABLE IF EXISTS product_variants CASCADE;


-- =====================================================================
-- МИГРАЦИЯ: migration_product_sale.sql
-- =====================================================================
-- =========================================================
-- Миграция: «Распродажа остатков» — флаг товара на распродажу.
-- Товары с is_sale = TRUE показываются в секции «Распродажа
-- остатков» на главной странице (перед «Популярными товарами»).
-- =========================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_sale BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_products_sale ON products(is_sale) WHERE is_sale = TRUE;


-- =====================================================================
-- МИГРАЦИЯ: migration_product_volume_and_label_colors.sql
-- =====================================================================
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


-- =====================================================================
-- МИГРАЦИЯ: migration_purchase_price.sql
-- =====================================================================
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


-- =====================================================================
-- МИГРАЦИЯ: migration_stock_sync.sql
-- =====================================================================
-- Автоматическая синхронизация наличия товара (in_stock) со складским остатком (stock_qty).
-- Идемпотентная миграция: безопасно запускать повторно в Supabase SQL Editor.

ALTER TABLE products ALTER COLUMN stock_qty SET DEFAULT 0;
ALTER TABLE products ALTER COLUMN in_stock SET DEFAULT FALSE;

UPDATE products
SET
  stock_qty = COALESCE(stock_qty, 0),
  in_stock = (FLOOR(COALESCE(stock_qty, 0)) >= 1)
WHERE stock_qty IS NULL
   OR in_stock IS DISTINCT FROM (FLOOR(COALESCE(stock_qty, 0)) >= 1);

CREATE OR REPLACE FUNCTION sync_product_in_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stock_qty IS NULL THEN
    NEW.stock_qty := 0;
  END IF;
  NEW.in_stock := FLOOR(NEW.stock_qty) >= 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_sync_in_stock ON products;
CREATE TRIGGER trg_products_sync_in_stock
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION sync_product_in_stock();


-- =====================================================================
-- МИГРАЦИЯ: migration_home_tiles.sql
-- =====================================================================
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


-- =====================================================================
-- МИГРАЦИЯ: migration_consent_log.sql
-- =====================================================================
-- =========================================================
-- FILE: supabase/migration_consent_log.sql
-- Журнал согласий на обработку персональных данных (152-ФЗ, ст. 9).
-- =========================================================
--
-- ЗАЧЕМ
-- С 01.09.2025 практика РКН требует, чтобы оператор мог доказать факт
-- и условия согласия: IP-адрес, дата и время, источник (страница/форма)
-- и версия текста согласия, на который кликнул пользователь.
--
-- Кто пишет: src/lib/consent-log.ts (logConsent), вызывается из
-- обработчиков форм с персональными данными.
--
-- ★ Миграция необязательна для работы сайта: если таблицы нет, заявки
--   принимаются как обычно, а в лог сервера идёт предупреждение.
--   Чтобы согласия начали фиксироваться — выполните этот файл в
--   Supabase SQL Editor (см. supabase/APPLY_MIGRATIONS.md).

CREATE TABLE IF NOT EXISTS consent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Источник согласия: order | register | inquiry | quick-order | review …
  form TEXT NOT NULL,
  -- Субъект (телефон/почта), чтобы связать согласие с конкретным обращением
  subject TEXT,
  -- Технические доказательства
  ip TEXT,
  user_agent TEXT,
  page TEXT,
  -- Версия самого текста согласия и страница документа
  text_version TEXT NOT NULL,
  document_path TEXT NOT NULL DEFAULT '/consent',
  -- Какие именно согласия отмечены: {"personal_data": true, "marketing": false}
  accepted JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_consent_logs_created ON consent_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_logs_form ON consent_logs(form);
CREATE INDEX IF NOT EXISTS idx_consent_logs_subject ON consent_logs(subject);

-- RLS: журнал согласий доступен только сервисному ключу (админка/сервер).
-- Публичные ключи не должны ни читать, ни писать.
ALTER TABLE consent_logs ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- МИГРАЦИЯ: migration_client_requests.sql
-- =====================================================================
-- =========================================================
-- Миграция: ручные заявки клиентов (CRM-обращения)
--
-- ЗАЧЕМ
-- Менеджеру звонит (пишет, приходит) клиент — нужно быстро
-- зафиксировать обращение: кто, как связаться, что нужно
-- (не обязательно конкретный товар) и вести его по статусам.
-- Эти заявки НЕ связаны с заказами сайта (orders) и не
-- попадают в учёт автоматически.
--
-- БЕЗОПАСНОСТЬ
-- RLS включён, политик для anon/authenticated НЕТ: читать и
-- писать может только сервер админки через service_role
-- (обходит RLS на уровне Postgres) — тот же приём, что у
-- bank_payments, salaries, activity_logs и др.
--
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- Идемпотентно: можно запускать повторно.
-- =========================================================

CREATE TABLE IF NOT EXISTS client_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Клиент: имя или название компании (обязательно)
  customer_name TEXT NOT NULL DEFAULT '',
  -- Телефон (необязателен: например, клиент подошёл лично)
  customer_phone TEXT NOT NULL DEFAULT '',
  -- Как связались / как держим связь
  contact_method TEXT NOT NULL DEFAULT 'call'
    CHECK (contact_method IN ('call', 'whatsapp', 'telegram', 'max', 'email', 'visit', 'other')),
  -- Что нужно клиенту (обязательно, свободный текст)
  subject TEXT NOT NULL DEFAULT '',
  -- Рабочие заметки менеджера
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'completed', 'rejected')),
  -- Итог (для 'completed') или причина отмены (для 'rejected')
  close_reason TEXT,
  -- Кто из админки внёс заявку
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_requests_status ON client_requests(status);
CREATE INDEX IF NOT EXISTS idx_client_requests_created ON client_requests(created_at DESC);

DROP TRIGGER IF EXISTS trg_client_requests_updated ON client_requests;
CREATE TRIGGER trg_client_requests_updated
  BEFORE UPDATE ON client_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE client_requests ENABLE ROW LEVEL SECURITY;

-- Политики намеренно не создаём (см. шапку): доступ только у
-- service_role через серверные API админки.

-- Realtime: чтобы страница обновлялась мгновенно (как «Заявки»),
-- добавляем таблицу в публикацию, если она есть в проекте.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'client_requests'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE client_requests';
    END IF;
  END IF;
END $$;


-- =====================================================================
-- МИГРАЦИЯ: migration_deliveries.sql
-- =====================================================================
-- =========================================================
-- Миграция: доставка заказов + планирование
-- Запустить в SQL Editor Supabase (идемпотентно).
-- =========================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_delivery BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_cost NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_planned_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_released_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_note TEXT;

-- Ограничение типа доставки (если ещё нет)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_type_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_delivery_type_check
      CHECK (delivery_type IS NULL OR delivery_type IN ('free', 'paid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_has_delivery ON orders(has_delivery) WHERE has_delivery = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_delivery_planned ON orders(delivery_planned_date) WHERE has_delivery = TRUE;


-- =====================================================================
-- МИГРАЦИЯ: migration_order_ready_status.sql
-- =====================================================================
-- =========================================================
-- Миграция: статус «Готов к выдаче» (ready) для заявок сайта
--
-- Зачем: менеджер отмечает собранный заказ как «Готов к выдаче»
-- прямо в заявке — клиент мгновенно видит этот же статус
-- в личном кабинете, а после проведения отпуска товара в учёте
-- (проведение заказа ЗК) заявка закрывается автоматически
-- («Проведена» → архив).
--
-- Применить в Supabase Dashboard → SQL Editor.
-- =========================================================

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('new', 'in_progress', 'ready', 'completed', 'rejected'));

-- Индекс по статусу уже есть (idx_orders_status) — доп. действий не нужно.


-- =====================================================================
-- МИГРАЦИЯ: migration_order_in_delivery_status.sql
-- =====================================================================
-- =========================================================
-- Миграция: статус заявки «Передано в доставку» (in_delivery)
-- =========================================================
-- Между «Готов к выдаче» и «Проведена» появляется отдельный статус:
-- груз передан водителю и едет клиенту. Клиент видит его в личном
-- кабинете, менеджер — в админке; логика выдачи (код выдачи, «Выдан»,
-- «Проведена») при этом не меняется.
--
-- Список статусов полный (с учётом более ранних миграций 'ready' и
-- 'issued'), поэтому файл можно выполнять на любой живой базе: он просто
-- пересоздаёт ограничение.
--
-- ВАЖНО: колонка TEXT, значения не переименовываются — старые заявки
-- не затрагиваются, DROP/ADD CONSTRAINT выполняются мгновенно.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'new',
    'in_progress',
    'ready',
    'in_delivery',
    'issued',
    'completed',
    'rejected'
  ));

-- Индекс по статусу уже есть (idx_orders_status) — доп. действий не нужно.


-- =====================================================================
-- МИГРАЦИЯ: migration_order_issue.sql
-- =====================================================================
-- =========================================================
-- Миграция: логин-аккаунты + код выдачи заказа
-- =========================================================
-- 1) Регистрация только по логину и паролю (без телефона/почты):
--    в users добавляется колонка username (уникальный логин).
-- 2) Код выдачи заказа: orders.pickup_code + orders.issued_at —
--    короткий код, который выдаётся клиенту после заказа и по которому
--    на вкладке «Выдача товара» в админке можно найти и выдать заказ.
-- 3) В перечень статусов заявки добавляется 'issued' (выдан).

-- ── users.username ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)
  WHERE username IS NOT NULL;

-- ── orders.pickup_code / issued_at ──
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_pickup_code ON orders(pickup_code)
  WHERE pickup_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_issued_at ON orders(issued_at)
  WHERE issued_at IS NOT NULL;

-- ── статус 'issued' в CHECK-ограничении ──
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('new', 'in_progress', 'ready', 'issued', 'completed', 'rejected'));


-- =====================================================================
-- МИГРАЦИЯ: migration_counterparty_cash.sql
-- =====================================================================
-- Миграция: пометка «за наличку» у контрагента.
-- Если галочка стоит: заказы контрагента отдельно выводятся кнопкой
-- «Касса» в архиве заказов (Учёт → Заказы → Архив), а при оформлении
-- нового заказа способ оплаты автоматически подставляется «Наличные»
-- (можно переключить вручную).
-- ПРИМЕНИТЬ ВРУЧНУЮ в Supabase SQL Editor до обновления кода,
-- иначе сохранение карточки контрагента будет падать с ошибкой.

ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS is_cash BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN counterparties.is_cash IS
  'Контрагент рассчитывается наличными: его заказы выводятся кнопкой «Касса» в архиве заказов, способ оплаты в новом заказе подставляется «Наличные».';

CREATE INDEX IF NOT EXISTS idx_counterparties_is_cash
  ON counterparties(id) WHERE is_cash = true;


-- =====================================================================
-- МИГРАЦИЯ: migration_price_tiers.sql
-- =====================================================================
-- Миграция: варианты цен (ценовые уровни) контрагентов.
-- regular   — обычная цена (как в карточке товара), у всех по умолчанию;
-- special   — спеццена: скидка от цены продажи (процент в настройках,
--             price_tier_special_discount, по умолчанию 5%);
-- exclusive — эксклюзивная цена: скидка больше (price_tier_exclusive_discount,
--             по умолчанию 10%).
-- Скидка применяется автоматически при оформлении заказа (Учёт → Заказы):
-- цена товара подставляется уже со скидкой уровня контрагента.

ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS price_tier TEXT NOT NULL DEFAULT 'regular';

COMMENT ON COLUMN counterparties.price_tier IS
  'Вариант цены: regular (обычная) / special (спеццена, скидка %) / exclusive (эксклюзив, скидка % больше). Проценты скидок — в настройках (price_tier_special_discount, price_tier_exclusive_discount).';

CREATE INDEX IF NOT EXISTS idx_counterparties_price_tier
  ON counterparties(price_tier) WHERE price_tier <> 'regular';


-- =====================================================================
-- МИГРАЦИЯ: migration_consignment_receipts.sql
-- =====================================================================
-- Товар поставщика на реализации: поставка создаёт отслеживаемую партию.
ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS is_consignment BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN warehouse_receipts.is_consignment IS
  'Товар поставлен на реализацию: продажи отслеживаются по закупочной цене поставщика.';


-- =====================================================================
-- МИГРАЦИЯ: migration_consignment_manual.sql
-- =====================================================================
-- Миграция: ручные продажи товара на реализации.
-- Реестр «Товар на реализации» считает продажи автоматически по
-- отгруженным заказам учёта. Если часть товара продана вне заказов
-- (или исторически не проведена), количество можно вписать вручную —
-- одна строка на пару (поставка + товар).

CREATE TABLE IF NOT EXISTS consignment_manual_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Поставка (ПО), к чьей партии относится ручная продажа
  receipt_id UUID NOT NULL REFERENCES warehouse_receipts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  -- Снапшот названия товара (для истории/журнала)
  product_name TEXT NOT NULL DEFAULT '',
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- На одну партию один товар — одна ручная запись (редактируется upsert'ом)
  UNIQUE (receipt_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_consignment_manual_receipt ON consignment_manual_sales(receipt_id);
CREATE INDEX IF NOT EXISTS idx_consignment_manual_product ON consignment_manual_sales(product_id);

DROP TRIGGER IF EXISTS trg_consignment_manual_updated ON consignment_manual_sales;
CREATE TRIGGER trg_consignment_manual_updated BEFORE UPDATE ON consignment_manual_sales FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE consignment_manual_sales ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE consignment_manual_sales IS
  'Ручные продажи товара на реализации: добавляются к автоматически посчитанным по отгрузкам.';


-- =====================================================================
-- МИГРАЦИЯ: migration_partial_receipts.sql
-- =====================================================================
-- Частичная приёмка поставок.
-- Храним накопительно фактически принятое количество по каждой позиции.
-- Идемпотентно: можно выполнять повторно.

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS received_items JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Старые проведённые поступления уже полностью попали на склад. Заполняем
-- для них received_items полным составом, чтобы новый код не принял их снова.
UPDATE warehouse_receipts AS receipt
SET received_items = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'productId', item->>'productId',
        'name', COALESCE(item->>'name', ''),
        'receivedQty', COALESCE((item->>'quantity')::numeric, 0)
      )
    )
    FROM jsonb_array_elements(COALESCE(receipt.items, '[]'::jsonb)) AS item
  ),
  '[]'::jsonb
)
WHERE receipt.status = 'posted'
  AND COALESCE(receipt.received_items, '[]'::jsonb) = '[]'::jsonb;

COMMENT ON COLUMN warehouse_receipts.received_items IS
  'Накопительно принято на склад: [{productId, name, receivedQty}].';


-- =====================================================================
-- МИГРАЦИЯ: migration_partial_shipping.sql
-- =====================================================================
-- Миграция: добавление отслеживания частичных отгрузок
-- shipped_items: [{productId, name, shippedQty}] — кумулятивно по всем отгрузкам

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS shipped_items JSONB DEFAULT '[]'::jsonb;


-- =====================================================================
-- МИГРАЦИЯ: migration_transports.sql
-- =====================================================================
-- Миграция: система перевозок (transports)
-- Перевозка = группа заказов на одну дату с одним водителем

CREATE TABLE IF NOT EXISTS transports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  planned_date DATE,
  driver_id UUID,
  driver_name TEXT,
  driver_phone TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  note TEXT,
  -- items: [{dealId, dealNumber, customerName, address, items: [{productId, name, qty}], totalSum}]
  items JSONB DEFAULT '[]'::jsonb,
  total_items INT DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transports_status ON transports(status);
CREATE INDEX IF NOT EXISTS idx_transports_date ON transports(planned_date);
DROP TRIGGER IF EXISTS trg_transports_updated ON transports;
CREATE TRIGGER trg_transports_updated BEFORE UPDATE ON transports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security.
-- Схема public целиком публикуется наружу через PostgREST, а ключ anon
-- лежит в JS-бандле сайта — без RLS таблицу можно было бы прочитать
-- обычным HTTP-запросом (маршруты, водители, адреса клиентов).
-- Политики не нужны: приложение ходит сюда только через service_role
-- (getAdminDb), а он RLS обходит. См. migration_rls_public_tables.sql.
ALTER TABLE transports ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- МИГРАЦИЯ: migration_receipt_transport_link.sql
-- =====================================================================
-- =========================================================
-- Миграция: связь ПОСТАВОК (приходных ордеров warehouse_receipts)
-- с ЕДИНЫМИ перевозками учёта (таблица transports).
--
-- Логика та же, что у макулатуры (migration_wp_transport_link.sql):
--   • needs_transport:
--     TRUE  — товар по поставке нужно ЗАБРАТЬ у поставщика нашим
--             транспортом («Заберём сами»). Поставка попадает в очередь
--             «Ожидают формирования» в разделе «Доставки» и далее в
--             путевой лист как «забор груза»;
--     FALSE — самопривоз: поставщик привозит товар сам, перевозка не нужна.
--   • transport_planned_date — желаемая дата забора (необязательно,
--     подсказка диспетчеру при формировании рейса).
--
-- При завершении перевозки такая поставка принимается на склад:
-- фактическое количество вводится руками (можно меньше) — остаток
-- остаётся в поставке как «остаток по приёмке» (частичная приёмка
-- warehouse_receipts.received_items, см. migration_partial_receipts.sql).
--
-- Адрес/контакт/телефон забора берём из самого приходного ордера
-- (колонки address / contact_name / phone уже есть в warehouse_receipts).
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS needs_transport BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS transport_planned_date DATE;

CREATE INDEX IF NOT EXISTS idx_receipts_needs_transport
  ON warehouse_receipts(needs_transport)
  WHERE needs_transport = TRUE;

COMMENT ON COLUMN warehouse_receipts.needs_transport IS
  'TRUE — товар по поставке забираем нашим транспортом (очередь перевозок учёта, «забор груза»); FALSE — самопривоз поставщика';

COMMENT ON COLUMN warehouse_receipts.transport_planned_date IS
  'Желаемая дата забора поставки нашим транспортом (подсказка диспетчеру)';


-- =====================================================================
-- МИГРАЦИЯ: migration_receipt_debts.sql
-- =====================================================================
-- Долги по расхождениям в поставках.
-- Недопоставка становится долгом поставщика после явного завершения перевозки.
-- Принятый сверх заказа товар сразу формирует долг перед поставщиком;
-- paid_overdelivery_items хранит уже оплаченные количества по товарам.
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS transport_finished_at TIMESTAMPTZ;

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS paid_overdelivery_items JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN warehouse_receipts.transport_finished_at IS
  'Время явного завершения перевозки с недопоставкой; после этого остаток считается долгом поставщика';

COMMENT ON COLUMN warehouse_receipts.paid_overdelivery_items IS
  'Уже оплаченные количества перепоставки: [{productId, paidQty, paidAt}]';


-- =====================================================================
-- МИГРАЦИЯ: migration_deal_delivery_vat.sql
-- =====================================================================
-- =========================================================
-- Миграция: доставка + явные поля у заказов учёта (customer_deals)
-- Идемпотентно. Запустить в SQL Editor Supabase.
-- =========================================================

ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS has_delivery BOOLEAN DEFAULT FALSE;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_type TEXT;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_cost NUMERIC DEFAULT 0;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_planned_date DATE;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_released_at TIMESTAMPTZ;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_deals_delivery_type_check'
  ) THEN
    ALTER TABLE customer_deals
      ADD CONSTRAINT customer_deals_delivery_type_check
      CHECK (delivery_type IS NULL OR delivery_type IN ('free', 'paid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deals_has_delivery ON customer_deals(has_delivery) WHERE has_delivery = TRUE;
CREATE INDEX IF NOT EXISTS idx_deals_delivery_planned ON customer_deals(delivery_planned_date) WHERE has_delivery = TRUE;

-- Если адрес доставки пуст, а address заполнен — копируем как адрес доставки (только для уже помеченных)
UPDATE customer_deals
SET delivery_address = address
WHERE has_delivery = TRUE
  AND (delivery_address IS NULL OR delivery_address = '')
  AND address IS NOT NULL
  AND address <> '';


-- =====================================================================
-- МИГРАЦИЯ: migration_delivery_driver.sql
-- =====================================================================
-- =========================================================
-- Миграция: водитель на доставке заказа учёта
-- Идемпотентно. SQL Editor Supabase.
-- =========================================================

ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_driver_id UUID;
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS delivery_driver_name TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_delivery_driver
  ON customer_deals(delivery_driver_id)
  WHERE has_delivery = TRUE;


-- =====================================================================
-- МИГРАЦИЯ: migration_delivery_items.sql
-- =====================================================================
-- Миграция: отслеживание количества в доставках
-- delivery_items: [{productId, name, quantity}] — сколько товара запланировано на эту доставку

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS delivery_items JSONB DEFAULT '[]'::jsonb;


-- =====================================================================
-- МИГРАЦИЯ: migration_deal_internal.sql
-- =====================================================================
-- =========================================================
-- Заказы: хознужды (списание товара без оплаты)
--
-- ЗАЧЕМ
-- Раньше заказ нельзя было создать с нулевой суммой: срабатывала проверка
-- «Укажите цену товаров, итог заказа должен быть больше нуля». Из-за этого
-- нельзя было списать товар на собственные нужды (образцы, упаковка своих
-- отправлений, брак, подарок клиенту) — приходилось выдумывать цену.
--
-- Заказ с флагом is_internal:
--   • может иметь нулевые цены и нулевой итог;
--   • НЕ создаёт входящий счёт в банке (денег по нему не ждут);
--   • списывает склад как обычный заказ — движение товара остаётся видимым;
--   • помечен в списке заказов как «Хознужды».
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN customer_deals.is_internal IS
  'Хознужды: списание товара без оплаты. Итог может быть 0, счёт не создаётся.';

CREATE INDEX IF NOT EXISTS idx_customer_deals_internal
  ON customer_deals(is_internal)
  WHERE is_internal = TRUE;


-- =====================================================================
-- МИГРАЦИЯ: migration_deal_reservation.sql
-- =====================================================================
-- Миграция: резерв товара под заказ + контактные лица доставки.
-- 1) Флаг is_reserved: заказ зарезервирован (выставлен счёт), товары из него
--    не продаются другим клиентам.
-- 2) Поля delivery_contact / delivery_phone — контактное лицо на адресе доставки
--    (чтобы не хранить только телефон покупателя).
ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS is_reserved BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_deals_reserved
  ON customer_deals(is_reserved)
  WHERE is_reserved = TRUE AND status <> 'cancelled';

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS delivery_contact TEXT NULL,
  ADD COLUMN IF NOT EXISTS delivery_phone TEXT NULL;


-- =====================================================================
-- МИГРАЦИЯ: migration_deal_archive_forecast.sql
-- =====================================================================
-- =========================================================
-- МИГРАЦИЯ: Архивные (импортированные) заказы + прогноз выручки
-- =========================================================
-- Что делает:
--  1. customer_deals.is_archive — пометка «архивный заказ» для массовой
--     загрузки старых проведённых заказов контрагентов (вне складского
--     учёта: склад и банк не затрагиваются, суммы попадают в отчёты и
--     в автоматический прогноз выручки).
--  2. customer_deals.archive_note — произвольный комментарий к партии
--     импорта (необязательно).
--
-- Применить в SQL Editor Supabase: supabase/migration_deal_archive_forecast.sql
-- =========================================================

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS is_archive BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS archive_note TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_is_archive
  ON customer_deals(is_archive);

COMMENT ON COLUMN customer_deals.is_archive IS
  'Архивный заказ из массовой загрузки: старые проведённые заказы вне складского учёта (склад/банк не затрагиваются).';


-- =====================================================================
-- МИГРАЦИЯ: migration_supply_plans.sql
-- =====================================================================
-- Отдельные планы будущих поставок. Это ещё не приходные ордера:
-- планы не меняют склад и банк, а хранят черновой состав и оценку бюджета.
CREATE TABLE IF NOT EXISTS warehouse_supply_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  planned_date TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_plans_status
  ON warehouse_supply_plans(status);
CREATE INDEX IF NOT EXISTS idx_supply_plans_date
  ON warehouse_supply_plans(planned_date);

DROP TRIGGER IF EXISTS trg_supply_plans_updated ON warehouse_supply_plans;
CREATE TRIGGER trg_supply_plans_updated
  BEFORE UPDATE ON warehouse_supply_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Планирование — внутренний модуль. Политик для anon/authenticated нет;
-- серверная service_role обходит RLS.
ALTER TABLE warehouse_supply_plans ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- МИГРАЦИЯ: migration_purchase_plans.sql
-- =====================================================================
-- Накопительные планы закупок.
-- Пополнения виртуальные и не двигают деньги; при списании создаётся
-- проведённый исходящий платёж с выбранного счёта.

CREATE TABLE IF NOT EXISTS warehouse_purchase_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT,
  ozon_url TEXT,
  ozon_image_url TEXT,
  ozon_image_public_id TEXT,
  ozon_price NUMERIC,
  ozon_checked_at TIMESTAMPTZ,
  ozon_price_updated_at TIMESTAMPTZ,
  ozon_last_error TEXT,
  target_amount NUMERIC NOT NULL DEFAULT 0,
  contribution_amount NUMERIC NOT NULL DEFAULT 500,
  account TEXT NOT NULL DEFAULT 'bank' CHECK (account IN ('cash', 'bank', 'ym_card')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  contributions JSONB NOT NULL DEFAULT '[]'::jsonb,
  spent_amount NUMERIC NOT NULL DEFAULT 0,
  spent_payment_id UUID,
  spent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_plans_status
  ON warehouse_purchase_plans(status);
CREATE INDEX IF NOT EXISTS idx_purchase_plans_product
  ON warehouse_purchase_plans(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_plans_ozon_refresh
  ON warehouse_purchase_plans(status, ozon_checked_at)
  WHERE ozon_url IS NOT NULL;

ALTER TABLE warehouse_purchase_plans ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_purchase_plans_updated ON warehouse_purchase_plans;
CREATE TRIGGER trg_purchase_plans_updated
  BEFORE UPDATE ON warehouse_purchase_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =====================================================================
-- МИГРАЦИЯ: migration_purchase_plan_images.sql
-- =====================================================================
-- Доп. фото закупок (Cloudinary). Если колонки нет, сервер пишет только ozon_image_*.
alter table if exists warehouse_purchase_plans
  add column if not exists images jsonb default '[]'::jsonb;


-- =====================================================================
-- МИГРАЦИЯ: migration_purchase_plan_ozon.sql
-- =====================================================================
-- Ссылки Ozon и автоматически обновляемые метаданные планов закупок.

ALTER TABLE warehouse_purchase_plans
  ADD COLUMN IF NOT EXISTS ozon_url TEXT,
  ADD COLUMN IF NOT EXISTS ozon_image_url TEXT,
  ADD COLUMN IF NOT EXISTS ozon_image_public_id TEXT,
  ADD COLUMN IF NOT EXISTS ozon_price NUMERIC,
  ADD COLUMN IF NOT EXISTS ozon_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ozon_price_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ozon_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_plans_ozon_refresh
  ON warehouse_purchase_plans(status, ozon_checked_at)
  WHERE ozon_url IS NOT NULL;


-- =====================================================================
-- МИГРАЦИЯ: migration_purchase_plan_spend.sql
-- =====================================================================
-- =========================================================
-- Закупки: куда ушло списание (банк / ЗП) и «вне баланса»
-- =========================================================
-- spent_payment_id уже есть (платёж в банке).
-- Добавляем spent_salary_id, spend_mode, exclude_from_balance.

ALTER TABLE warehouse_purchase_plans
  ADD COLUMN IF NOT EXISTS spent_salary_id text,
  ADD COLUMN IF NOT EXISTS spend_mode text,
  ADD COLUMN IF NOT EXISTS exclude_from_balance boolean DEFAULT false;

COMMENT ON COLUMN warehouse_purchase_plans.spent_salary_id IS
  'ID записи salaries, если списание шло через зарплату';
COMMENT ON COLUMN warehouse_purchase_plans.spend_mode IS
  'bank | salary — куда ушло списание накоплений';
COMMENT ON COLUMN warehouse_purchase_plans.exclude_from_balance IS
  'true = платёж/ЗП «вне баланса», не влияет на текущий банк/кассу';


-- =====================================================================
-- МИГРАЦИЯ: migration_purchase_payments.sql
-- =====================================================================
-- =========================================================
-- Закупки: реальные платежи вместо «накопил и списал одной кнопкой»
--
-- ЧТО МЕНЯЕТСЯ
-- Раньше закупка копила виртуальные «пополнения» (JSONB contributions),
-- которые не двигали деньги, а потом одна кнопка «Списать» создавала
-- ОДИН платёж на всю накопленную сумму. Отредактировать или удалить
-- отдельный взнос было нельзя.
--
-- Теперь каждый платёж по закупке — обычная строка bank_payments
-- (исходящий платёж), связанная с закупкой через purchase_plan_id.
-- Его можно создать как из карточки закупки, так и из банка, а также
-- отредактировать и удалить как любой другой платёж.
--
-- Старые поля (contributions, spent_amount, spent_payment_id,
-- spent_salary_id, spend_mode) НЕ удаляются: по ним показывается история
-- уже закрытых закупок и остатки «отложено» по активным.
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

-- ── Привязка платежа к закупке ──
ALTER TABLE bank_payments
  ADD COLUMN IF NOT EXISTS purchase_plan_id UUID;

COMMENT ON COLUMN bank_payments.purchase_plan_id IS
  'Закупка (warehouse_purchase_plans), к которой отнесён платёж';

-- Частичный индекс: строк с привязкой мало, полный индекс не нужен
CREATE INDEX IF NOT EXISTS idx_bank_payments_purchase_plan
  ON bank_payments(purchase_plan_id)
  WHERE purchase_plan_id IS NOT NULL;

-- Если закупку удалили — платёж остаётся в банке, просто теряет привязку.
-- Деньги не должны исчезать вместе с планом.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_payments_purchase_plan_fk'
  ) THEN
    ALTER TABLE bank_payments
      ADD CONSTRAINT bank_payments_purchase_plan_fk
      FOREIGN KEY (purchase_plan_id)
      REFERENCES warehouse_purchase_plans(id)
      ON DELETE SET NULL;
    RAISE NOTICE 'Добавлена связь bank_payments.purchase_plan_id → warehouse_purchase_plans';
  ELSE
    RAISE NOTICE 'Связь уже есть, пропускаем';
  END IF;
END $$;

-- ── Дата, к которой закупку планируют закрыть (необязательная) ──
ALTER TABLE warehouse_purchase_plans
  ADD COLUMN IF NOT EXISTS due_date DATE;

COMMENT ON COLUMN warehouse_purchase_plans.due_date IS
  'Плановая дата закупки — по ней сортируются ближайшие';


-- =====================================================================
-- МИГРАЦИЯ: migration_warehouse_assemblies.sql
-- =====================================================================
-- =========================================================
-- КОМПЛЕКТАЦИЯ / РАЗУКОМПЛЕКТАЦИЯ НОМЕНКЛАТУРЫ (как в 1С)
-- Превращает исходные материалы/комплектующие в готовую продукцию
-- (например, листы гофрокартона → готовые коробки) с автоматическим
-- списанием сырья и оприходованием выпуска поставкой ПО-… от «СибГофроТорг».
-- Идемпотентная миграция: безопасно запускать повторно.
-- =========================================================

CREATE TABLE IF NOT EXISTS warehouse_assemblies (
  id TEXT PRIMARY KEY,
  number INT NOT NULL DEFAULT 1,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  kind TEXT NOT NULL DEFAULT 'assembly' CHECK (kind IN ('assembly', 'disassembly')),
  spent_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  produced_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  produced_total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  boxes_per_sheet NUMERIC(14,4),
  surcharge_rub NUMERIC(14,2) DEFAULT 2,
  linked_receipt_id TEXT,
  linked_receipt_number INT,
  update_purchase_price BOOLEAN NOT NULL DEFAULT TRUE,
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE warehouse_assemblies ADD COLUMN IF NOT EXISTS produced_total_cost NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE warehouse_assemblies ADD COLUMN IF NOT EXISTS boxes_per_sheet NUMERIC(14,4);
ALTER TABLE warehouse_assemblies ADD COLUMN IF NOT EXISTS surcharge_rub NUMERIC(14,2) DEFAULT 2;
ALTER TABLE warehouse_assemblies ADD COLUMN IF NOT EXISTS linked_receipt_id TEXT;
ALTER TABLE warehouse_assemblies ADD COLUMN IF NOT EXISTS linked_receipt_number INT;

CREATE INDEX IF NOT EXISTS idx_warehouse_assemblies_date
  ON warehouse_assemblies(date DESC, number DESC);

CREATE INDEX IF NOT EXISTS idx_warehouse_assemblies_status
  ON warehouse_assemblies(status);

CREATE INDEX IF NOT EXISTS idx_warehouse_assemblies_receipt
  ON warehouse_assemblies(linked_receipt_id);

DROP TRIGGER IF EXISTS trg_warehouse_assemblies_updated ON warehouse_assemblies;
CREATE TRIGGER trg_warehouse_assemblies_updated
  BEFORE UPDATE ON warehouse_assemblies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE warehouse_assemblies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_service_all ON warehouse_assemblies;
CREATE POLICY wa_service_all ON warehouse_assemblies
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND tablename = 'warehouse_assemblies'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_assemblies';
  END IF;
END $$;

INSERT INTO doc_counters (key, value)
VALUES ('warehouse_assembly', 0)
ON CONFLICT (key) DO NOTHING;


-- =====================================================================
-- МИГРАЦИЯ: migration_warehouse_product_history_indexes.sql
-- =====================================================================
-- Быстрый поиск всех поступлений и заказов по конкретному товару
-- для выпадающей сводки на вкладке «Учёт → Склад».
--
-- Сводка использует JSONB containment (`items @> '[{"productId":"…"}]'`).
-- Без этих индексов она тоже работает, но на большой архивной базе PostgreSQL
-- пришлось бы просматривать все документы при каждом первом открытии товара.

CREATE INDEX IF NOT EXISTS idx_receipts_items_gin
  ON warehouse_receipts USING GIN (items jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_deals_items_gin
  ON customer_deals USING GIN (items jsonb_path_ops);


-- =====================================================================
-- МИГРАЦИЯ: migration_1c_client_bank.sql
-- =====================================================================
-- Миграция для поддержки выгрузки платёжек в формате 1CClientBankExchange (Альфа-Банк).
-- Добавляет:
--   1. Город банка у контрагентов (bank_city) и у поступлений (bank_city).
--   2. Поля платёжного поручения в bank_payments:
--      payment_purpose  — назначение платежа (НазначениеПлатежа1).
--      payment_priority — очерёдность платежа (по умолч. 5).
--      payment_kind     — вид платежа (по умолч. "01" = электронно).
--      exported_at      — дата выгрузки в 1С (чтобы не экспортировать повторно).
-- Колонки добавляются безопасно: IF NOT EXISTS.

ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS bank_city TEXT;

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS bank_account TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_city TEXT,
  ADD COLUMN IF NOT EXISTS bik TEXT,
  ADD COLUMN IF NOT EXISTS correspondent_account TEXT,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS invoice_date TEXT;

ALTER TABLE bank_payments
  ADD COLUMN IF NOT EXISTS payment_purpose TEXT,
  ADD COLUMN IF NOT EXISTS payment_priority INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS payment_kind TEXT DEFAULT '01',
  ADD COLUMN IF NOT EXISTS exported_at TEXT;

-- Настройки нашей компании для выгрузки (реквизиты плательщика).
-- Используем существующую таблицу settings (key-value), дополнительной таблицы не нужно.


-- =====================================================================
-- МИГРАЦИЯ: migration_bank_account_transfers.sql
-- =====================================================================
-- =========================================================
-- Внутренние переводы между четырьмя денежными счетами компании.
-- Перевод не является доходом или расходом: он только меняет
-- распределение денег между наличными, р/с и двумя картами.
-- =========================================================

CREATE TABLE IF NOT EXISTS bank_account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  from_account TEXT NOT NULL CHECK (from_account IN ('cash', 'bank', 'ym_card', 'vm_card')),
  to_account TEXT NOT NULL CHECK (to_account IN ('cash', 'bank', 'ym_card', 'vm_card')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT bank_account_transfers_different_accounts CHECK (from_account <> to_account)
);

CREATE INDEX IF NOT EXISTS idx_bank_account_transfers_date
  ON bank_account_transfers(date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_account_transfers_accounts
  ON bank_account_transfers(from_account, to_account);

DROP TRIGGER IF EXISTS trg_bank_account_transfers_updated ON bank_account_transfers;
CREATE TRIGGER trg_bank_account_transfers_updated
  BEFORE UPDATE ON bank_account_transfers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bank_account_transfers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND tablename = 'bank_account_transfers'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE bank_account_transfers';
  END IF;
END $$;

INSERT INTO doc_counters (key, value)
VALUES ('bank_account_transfer', 0)
ON CONFLICT (key) DO NOTHING;


-- =====================================================================
-- МИГРАЦИЯ: migration_payment_balance_flags.sql
-- =====================================================================
-- Миграция: явная пометка платежей «вне баланса».
-- Такие платежи закрывают связанный документ (заказ/поступление),
-- но не попадают в текущий банковский/кассовый баланс и не создают
-- срочные уведомления о неоплате.

ALTER TABLE bank_payments
  ADD COLUMN IF NOT EXISTS exclude_from_balance BOOLEAN DEFAULT FALSE;

UPDATE bank_payments
SET exclude_from_balance = FALSE
WHERE exclude_from_balance IS NULL;

ALTER TABLE bank_payments
  ALTER COLUMN exclude_from_balance SET DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_payments_exclude_from_balance
  ON bank_payments(exclude_from_balance);

COMMENT ON COLUMN bank_payments.exclude_from_balance IS
  'TRUE = платеж закрывает документ, но не влияет на текущий банк/кассу (архив/старый учет).';


-- =====================================================================
-- МИГРАЦИЯ: migration_payment_cash_destination.sql
-- =====================================================================
ALTER TABLE bank_payments ADD COLUMN IF NOT EXISTS cash_destination TEXT CHECK (cash_destination IN ('cash', 'card'));


-- =====================================================================
-- МИГРАЦИЯ: migration_cash_collections.sql
-- =====================================================================
-- Миграция: сдача кассы.
-- Каждая запись = одна сданная кассовая смена (дата + сумма + примечание).
-- При сдаче кассы весь остаток наличных списывается в отдельный журнал,
-- но не прибавляется к безналичному банковскому счёту.

CREATE TABLE IF NOT EXISTS cash_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_collections_date ON cash_collections(date);

ALTER TABLE cash_collections ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- МИГРАЦИЯ: migration_cash_collection_expenses.sql
-- =====================================================================
-- =========================================================
-- Миграция: детализация сдачи кассы — траты и приход.
--
-- Чтобы в отчёте «Сданная касса» можно было раскрыть смену и увидеть,
-- какие платежи в неё вошли, какие были расходы налом и куда ушли
-- деньги, эти данные сохраняются в самой записи сдачи. Так детализация
-- останется верной, даже если платёж или зарплату потом отредактируют.
--
-- Только ADD COLUMN IF NOT EXISTS — выполнять можно многократно.
-- Существующие данные не меняются: у старых сдач траты пустые, а
-- приходом считается сама сумма сдачи (обрабатывается в коде).
-- =========================================================

-- Наличные траты дня: [{kind:'salary'|'payment', id, title, amount, comment}]
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS expenses JSONB DEFAULT '[]'::jsonb;

-- Приход за день ДО вычета трат
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS income_amount NUMERIC;

-- Сумма трат налом, вычтенная из прихода
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS expenses_amount NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN cash_collections.expenses IS
  'Траты налом за день: [{kind, id, title, amount, comment}]. kind = salary|payment.';
COMMENT ON COLUMN cash_collections.income_amount IS
  'Приход наличными за день до вычета трат. NULL у старых записей.';
COMMENT ON COLUMN cash_collections.expenses_amount IS
  'Сумма наличных трат, вычтенная из прихода при сдаче.';


-- =====================================================================
-- МИГРАЦИЯ: migration_cash_collection_split.sql
-- =====================================================================
-- =========================================================
-- Миграция: разделение сданной кассы на наличные и перевод.
--
-- В кассе лежат деньги двух видов: физическая наличка и переводы
-- (на карту/СБП). Оба вида НЕ относятся к основному безналичному
-- банковскому счёту, поэтому учитываются здесь, а не в bankBalance.
--
-- При сдаче кассы теперь фиксируется, сколько ушло наличными, а
-- сколько переводом, плюс поимённая разметка платежей.
-- Идемпотентно.
-- =========================================================

ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS cash_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS transfer_amount NUMERIC NOT NULL DEFAULT 0;

-- items: [{paymentId, number, counterparty, amount, kind: 'cash'|'transfer'}]
-- Разметка платежей, вошедших в эту сдачу.
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;

-- Старые сдачи (до появления разделения) считаем полностью наличными:
-- тогда переводы отдельно не учитывались.
UPDATE cash_collections
SET cash_amount = amount
WHERE cash_amount = 0
  AND transfer_amount = 0
  AND amount <> 0;

COMMENT ON COLUMN cash_collections.cash_amount IS
  'Часть сданной кассы, полученная наличными.';
COMMENT ON COLUMN cash_collections.transfer_amount IS
  'Часть сданной кассы, полученная переводом (не основной банковский счёт).';
COMMENT ON COLUMN cash_collections.items IS
  'Разметка платежей сдачи: [{paymentId, number, counterparty, amount, kind}].';


-- =====================================================================
-- МИГРАЦИЯ: migration_vm_card.sql
-- =====================================================================
-- =========================================================
-- Карта В.М. — вторая карта учёта (отдельный денежный счёт)
-- =========================================================
-- Карта ЮМ остаётся как есть: на неё попадают только деньги,
-- переведённые именно на ЮМ. Карта В.М. устроена так же, но
-- считается отдельно.
--
-- Деньги на карте В.М. живут в bank_payments.type = 'vm_card'
-- и в зарплатах как тег комментария [Карта В.М.] (source='bank')
-- — то есть новых таблиц не нужно. Здесь добавляется только
-- расшифровка сдачи кассы: сколько из поступлений смены ушло
-- на вторую карту.
--
-- Применять после migration_cash_collection_split.sql.
-- =========================================================

-- Сколько из поступлений смены отмечено на карте В.М.
-- Это метка, а не новое движение денег (как transfer_amount для ЮМ).
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS vm_transfer_amount NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN cash_collections.vm_transfer_amount IS
  'Поступления смены, отмеченные на карте В.М. Метка, а не движение денег.';

-- Типы платежей и зарплат хранятся текстом (без CHECK-ограничения),
-- поэтому значения 'vm_card' доступны сразу после деплоя кода:
--  · bank_payments.type = 'vm_card' — поступление/расход по второй карте;
--  · salaries.source остаётся 'bank', карта определяется тегом [Карта В.М.]
--    (CHECK-ограничение salaries.source трогать не нужно).

-- Разметка сдачи кассы умеет третью кассу — вторую карту.
ALTER TABLE bank_payments DROP CONSTRAINT IF EXISTS bank_payments_cash_destination_check;
ALTER TABLE bank_payments
  ADD CONSTRAINT bank_payments_cash_destination_check
  CHECK (cash_destination IN ('cash', 'card', 'vm_card'));


-- =====================================================================
-- МИГРАЦИЯ: migration_duty_schedule_storage.sql
-- =====================================================================
-- =========================================================
-- Миграция: постоянное хранилище табелей охраны + история версий
--
-- 1) duty_schedule_state — текущий рабочий снимок табеля.
--    Один общий JSONB-снимок содержит сотрудников охраны, графики всех
--    месяцев, ручные суммы, начисления и дни выплат. Запись всегда имеет
--    id = 'main': повторная генерация или ручная правка делает UPSERT этой
--    же строки, а не создаёт дубликат табеля.
--
-- 2) duty_schedule_revisions — журнал версий. Каждое сохранение кладёт
--    снимок в историю, поэтому прежние смены, зарплату и выплаты можно
--    пролистать и вернуть. Самая свежая запись журнала всегда совпадает
--    с рабочим снимком (инвариант поддерживает приложение).
--
-- 3) duty_schedule_state.content_hash — отпечаток содержимого снимка:
--    по нему приложение понимает, что данные не изменились, и не пишет
--    лишнюю версию.
--
-- RLS включён без публичных политик. Читать и менять снимок и историю
-- может только сервер админки через service_role.
--
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- Миграция идемпотентна, её безопасно запускать повторно (в том числе
-- поверх уже применённой прежней версии файла — просто появится история).
-- =========================================================

CREATE TABLE IF NOT EXISTS duty_schedule_state (
  id TEXT PRIMARY KEY DEFAULT 'main' CHECK (id = 'main'),
  snapshot JSONB NOT NULL DEFAULT '{
    "employees": [],
    "schedules": {},
    "amountOverrides": {},
    "salaryPayouts": {},
    "payoutTitles": {},
    "salaryAccruals": {},
    "payPlans": {}
  }'::jsonb,
  pay_offset SMALLINT NOT NULL DEFAULT 1 CHECK (pay_offset IN (0, 1, 2)),
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Отпечаток содержимого: одинаковый снимок не создаёт новую версию.
ALTER TABLE duty_schedule_state
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

DROP TRIGGER IF EXISTS trg_duty_schedule_state_updated ON duty_schedule_state;
CREATE TRIGGER trg_duty_schedule_state_updated
  BEFORE UPDATE ON duty_schedule_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE duty_schedule_state ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- История версий табеля
-- =========================================================

CREATE TABLE IF NOT EXISTS duty_schedule_revisions (
  id BIGSERIAL PRIMARY KEY,
  -- Полный снимок табеля на момент сохранения (сотрудники, смены,
  -- начисления, выплаты).
  snapshot JSONB NOT NULL,
  pay_offset SMALLINT NOT NULL DEFAULT 1 CHECK (pay_offset IN (0, 1, 2)),
  content_hash TEXT NOT NULL DEFAULT '',
  -- Краткая сводка для списка истории (месяцы, суммы начислений и выплат).
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Пометка события: «Восстановлена версия от …». NULL — обычное автосохранение.
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Последнее обновление версии: правки одной сессии объединяются в неё.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_duty_schedule_revisions_updated
  ON duty_schedule_revisions(updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_duty_schedule_revisions_hash
  ON duty_schedule_revisions(content_hash);

ALTER TABLE duty_schedule_revisions ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- Проверка после применения
-- =========================================================
-- SELECT 'duty_schedule_state' AS check_name,
--        EXISTS (SELECT 1 FROM information_schema.tables
--                WHERE table_name = 'duty_schedule_state') AS ok
-- UNION ALL SELECT 'duty_schedule_state.content_hash',
--        EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_name = 'duty_schedule_state' AND column_name = 'content_hash')
-- UNION ALL SELECT 'duty_schedule_revisions',
--        EXISTS (SELECT 1 FROM information_schema.tables
--                WHERE table_name = 'duty_schedule_revisions');
-- Ожидаемый результат — 3 строки, во всех ok = true.


-- =====================================================================
-- МИГРАЦИЯ: migration_die_calc.sql
-- =====================================================================
-- =========================================================
-- Миграция: ШТАНЦФОРМЫ — СОХРАНЁННЫЕ РАСЧЁТЫ, ОБУЧЕНИЕ, ОБЩИЙ ПРАЙС
--
-- Калькулятор штанцформы (админка → «Штанцформа», /die-calc) до этой
-- миграции жил только в localStorage браузера. Здесь появляются три
-- таблицы:
--
--  1. die_calc_jobs    — сохранённые расчёты (таблица «Расчёты штанцформ»).
--     Колонки разбиты на три группы:
--       · ввод (l_mm, w_mm, h_mm, qty, профиль, конструкция, замок) — по ним
--         фильтруют и из них же можно пересчитать всё заново;
--       · расчёт (blank_*, die_*, knives_m, per_sheet, price_*) — то, что
--         выдал калькулятор в момент сохранения;
--       · ФАКТ (fact_*) — что получилось на самом деле: габарит заготовки с
--         готовой матрицы и реальная цена. Именно из этих колонок растёт
--         обучение; пустой fact = запись в обучении не участвует.
--     settings/result/pricing — jsonb: полный ввод со справочниками и снимок
--     результата. Нужны, чтобы «открыть снова» воспроизводило расчёт
--     бит-в-бит, а не зависело от того, какие ставки у админа в браузере.
--
--  2. die_calc_models  — выученные модели (поправка по габариту на
--     конструкцию + множители цены по группам). Храним историей:
--     активная строка одна (is_active), предыдущие остаются для отката.
--
--  3. die_calc_settings — ОДИН общий прайс калькулятора (профили, форматы
--     листа, ставки штампа/тиража, размер маркировки). Пока он пустой, все
--     сидят на своих localStorage-ставках и цены в журнале не сопоставимы.
--
-- Права: пишут только серверные маршруты через service_role (getAdminDb),
-- поэтому RLS включаем без политик — как у home_tiles и остальных
-- служебных таблиц.
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

-- ── 1. Сохранённые расчёты ──
CREATE TABLE IF NOT EXISTS die_calc_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- что показываем в таблице
  order_no TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  customer TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','quoted','approved','in_work','done','rejected','archived')),

  -- ввод (денормализован: фильтры, обучение и сортировка работают по колонкам,
  -- а не по jsonb)
  construction TEXT NOT NULL
    CHECK (construction IN ('lastochkin','lotok','yazyk','bokovoy','blank')),
  closure TEXT NOT NULL
    CHECK (closure IN ('none','half','tuck','full','glue')),
  profile_id TEXT NOT NULL DEFAULT 'E',
  l_mm NUMERIC(10,2) NOT NULL CHECK (l_mm > 0),
  w_mm NUMERIC(10,2) NOT NULL CHECK (w_mm > 0),
  h_mm NUMERIC(10,2) NOT NULL CHECK (h_mm > 0),
  qty INTEGER NOT NULL DEFAULT 1000 CHECK (qty > 0),

  -- расчёт калькулятора на момент сохранения
  blank_w NUMERIC(10,2),
  blank_h NUMERIC(10,2),
  die_w NUMERIC(10,2),
  die_h NUMERIC(10,2),
  blank_area_m2 NUMERIC(12,6),
  knives_m NUMERIC(10,3),
  per_sheet INTEGER,
  sheets INTEGER,
  price_die NUMERIC(14,2),
  price_batch NUMERIC(14,2),
  price_per_pcs NUMERIC(12,2),
  price_with_vat NUMERIC(14,2),

  -- ФАКТ: правится руками в таблице, кормит обучение
  fact_blank_w NUMERIC(10,2),
  fact_blank_h NUMERIC(10,2),
  fact_price_per_pcs NUMERIC(12,2),
  fact_price_batch NUMERIC(14,2),
  fact_qty INTEGER,

  -- участвовать ли в обучении (срывные тиражи и «за знакомство» можно
  -- выключить, не удаляя запись)
  learned BOOLEAN NOT NULL DEFAULT TRUE,

  -- всё для точного повтора расчёта
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { input, prices, profiles, sheets }
  result JSONB NOT NULL DEFAULT '{}'::jsonb,     -- снимок CalcResult (без панелей)

  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_die_calc_jobs_created ON die_calc_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_die_calc_jobs_status ON die_calc_jobs(status);
-- группа обучения: «все подтверждённые ласточкины хвосты с tuck на E»
CREATE INDEX IF NOT EXISTS idx_die_calc_jobs_group
  ON die_calc_jobs(construction, closure, profile_id);
CREATE INDEX IF NOT EXISTS idx_die_calc_jobs_learned
  ON die_calc_jobs(construction, closure, profile_id) WHERE learned = TRUE;
CREATE INDEX IF NOT EXISTS idx_die_calc_jobs_order_no ON die_calc_jobs(order_no) WHERE order_no <> '';

DROP TRIGGER IF EXISTS trg_die_calc_jobs_updated ON die_calc_jobs;
CREATE TRIGGER trg_die_calc_jobs_updated BEFORE UPDATE ON die_calc_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE die_calc_jobs ENABLE ROW LEVEL SECURITY;

-- ── 2. Выученные модели ──
-- model — это DieCalcModel из src/lib/die-calc/learn.ts:
--   { version, trainedAt, n, geo: [{construction, coef, n, errBeforeMm,
--     errAfterMm, ...}], price: [{key, n, k, kMean, spreadPct}], notes: [] }
-- Считается на сервере (trainDieCalcModel) тем же ядром, что и расчёт.
CREATE TABLE IF NOT EXISTS die_calc_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  n INTEGER NOT NULL DEFAULT 0,
  model JSONB NOT NULL,
  notes TEXT[] DEFAULT '{}'::text[],
  trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

-- активная модель всегда одна
CREATE UNIQUE INDEX IF NOT EXISTS uq_die_calc_models_active
  ON die_calc_models (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_die_calc_models_trained ON die_calc_models(trained_at DESC);

ALTER TABLE die_calc_models ENABLE ROW LEVEL SECURITY;

-- ── 3. Общий прайс калькулятора (одна строка) ──
CREATE TABLE IF NOT EXISTS die_calc_settings (
  key TEXT PRIMARY KEY DEFAULT 'default',
  content JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { profiles, sheets, prices, labelSize }
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_die_calc_settings_updated ON die_calc_settings;
CREATE TRIGGER trg_die_calc_settings_updated BEFORE UPDATE ON die_calc_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE die_calc_settings ENABLE ROW LEVEL SECURITY;

-- ── 4. Сводка для дашборда админки (материализуем лень, смотрим вьюхой) ──
CREATE OR REPLACE VIEW die_calc_job_stats
WITH (security_invoker = true) AS
SELECT
  j.construction,
  j.closure,
  j.profile_id,
  COUNT(*)::INT AS jobs,
  COUNT(*) FILTER (WHERE j.fact_blank_w IS NOT NULL AND j.fact_blank_h IS NOT NULL)::INT AS with_fact_geom,
  COUNT(*) FILTER (WHERE j.fact_price_per_pcs IS NOT NULL OR j.fact_price_batch IS NOT NULL)::INT AS with_fact_price,
  ROUND(AVG(
    (ABS(j.fact_blank_w - j.blank_w) + ABS(j.fact_blank_h - j.blank_h)) / 2
  ) FILTER (WHERE j.fact_blank_w IS NOT NULL AND j.fact_blank_h IS NOT NULL), 1) AS mean_blank_err_mm,
  ROUND(AVG(j.fact_price_per_pcs / NULLIF(j.price_per_pcs, 0))
    FILTER (WHERE j.fact_price_per_pcs > 0 AND j.price_per_pcs > 0), 4) AS mean_price_k,
  SUM(j.price_batch) AS sum_price_batch,
  SUM(j.fact_price_batch) AS sum_fact_price_batch
FROM die_calc_jobs j
WHERE j.learned = TRUE
GROUP BY j.construction, j.closure, j.profile_id;

-- ── 5. Пустая строка общего прайса, чтобы админка могла её сразу редактировать ──
INSERT INTO die_calc_settings (key, content)
SELECT 'default', '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM die_calc_settings WHERE key = 'default');


-- =====================================================================
-- МИГРАЦИЯ: migration_rent_accounting.sql
-- =====================================================================
-- =========================================================
-- МИГРАЦИЯ: Управленческий учёт аренды (банк аренды)
--
-- Полностью ОТДЕЛЬНЫЙ модуль, не связан со складским учётом
-- (bank_payments). Свои организации, арендаторы, начисления
-- и платежи.
--
-- Организации:
--   bau   — БАУ (расчётный счёт)
--   sit   — СибИнвестТорг (своего счёта нет: деньги арендаторов
--           СИТ приходят на счёт БАУ — pays_to_org_id = 'bau')
--   pakin — ИП Пакин (расчётный счёт)
--
-- Цикл по умолчанию: счёт выставляется 25-го числа (invoice_day),
-- оплата до 3-го числа месяца (pay_day). У арендатора могут быть
-- исключения: свой день оплаты, свой период (квартал/полгода/год/
-- произвольный), отсрочка.
-- =========================================================

-- ── 1. Организации (владельцы счетов) ────────────────────
CREATE TABLE IF NOT EXISTS rent_orgs (
  id TEXT PRIMARY KEY,               -- 'bau' | 'sit' | 'pakin'
  name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  legal_name TEXT,
  inn TEXT,
  bank_account TEXT,                 -- расчётный счёт
  bank_name TEXT,
  bik TEXT,
  correspondent_account TEXT,
  pay_day INT NOT NULL DEFAULT 3,    -- крайний день оплаты (для всех по умолчанию)
  invoice_day INT NOT NULL DEFAULT 25, -- день выставления счёта
  -- Если у организации нет своего счёта (СИТ), деньги идут на счёт
  -- другой организации. NULL = деньги идут на собственный счёт.
  pays_to_org_id TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO rent_orgs (id, name, short_name, legal_name, comment) VALUES
  ('bau',   'БАУ',            'БАУ',    'СибИнвестТорг', 'Основной счёт: сюда приходят деньги арендаторов БАУ и СибИнвестТорга'),
  ('sit',   'СибИнвестТорг',  'СИТ',    'СибИнвестТорг', 'Своего счёта нет — деньги приходят на счёт БАУ'),
  ('pakin', 'ИП Пакин',       'ИП Пакин', NULL,           'Отдельный счёт ИП Пакин')
ON CONFLICT (id) DO NOTHING;

UPDATE rent_orgs SET pays_to_org_id = 'bau' WHERE id = 'sit' AND pays_to_org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rent_orgs_pays_to ON rent_orgs(pays_to_org_id);

DROP TRIGGER IF EXISTS trg_rent_orgs_updated ON rent_orgs;
CREATE TRIGGER trg_rent_orgs_updated BEFORE UPDATE ON rent_orgs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Арендаторы (контрагенты с договором) ──────────────
CREATE TABLE IF NOT EXISTS rent_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,              -- к кому относится арендатор (bau/sit/pakin)
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL DEFAULT '',
  office TEXT,                       -- офис/помещение
  contract_number TEXT,              -- договор №
  contract_date TEXT,                -- дата договора YYYY-MM-DD
  monthly_rent NUMERIC NOT NULL DEFAULT 0, -- ставка в месяц
  period_months INT NOT NULL DEFAULT 1,    -- период оплаты: 1/3/6/12/... (руками)
  due_day INT,                       -- исключение: свой крайний день оплаты (NULL = общий pay_day организации)
  invoice_day INT,                   -- исключение: свой день выставления счёта
  deferral_days INT NOT NULL DEFAULT 0,    -- отсрочка оплаты, дней
  pay_method TEXT NOT NULL DEFAULT 'any' CHECK (pay_method IN ('bank', 'cash', 'any')),
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  inn TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_tenants_org ON rent_tenants(org_id);
CREATE INDEX IF NOT EXISTS idx_rent_tenants_status ON rent_tenants(status);
CREATE INDEX IF NOT EXISTS idx_rent_tenants_normalized ON rent_tenants(normalized_name);

DROP TRIGGER IF EXISTS trg_rent_tenants_updated ON rent_tenants;
CREATE TRIGGER trg_rent_tenants_updated BEFORE UPDATE ON rent_tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. Начисления / счета арендаторам ────────────────────
-- Одно начисление = один период аренды (месяц/квартал/...).
-- Статусы: awaiting (ждёт оплаты), paid (оплачен), cancelled (отменён).
CREATE TABLE IF NOT EXISTS rent_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL,
  tenant_id UUID NOT NULL,           -- логическая связь с rent_tenants.id
  org_id TEXT NOT NULL,              -- организация арендатора на момент счёта
  account_org_id TEXT NOT NULL,      -- на чей счёт приходят деньги (с учётом СИТ→БАУ)
  period_start TEXT NOT NULL,        -- YYYY-MM-DD
  period_end TEXT NOT NULL,          -- YYYY-MM-DD
  issue_date TEXT NOT NULL,          -- дата выставления счёта
  due_date TEXT NOT NULL,            -- крайний день оплаты
  amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting', 'paid', 'cancelled')),
  paid_at TEXT,                      -- дата фактической оплаты
  pay_method TEXT,                   -- как оплатили: bank/cash
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_invoices_tenant ON rent_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rent_invoices_status ON rent_invoices(status);
CREATE INDEX IF NOT EXISTS idx_rent_invoices_due ON rent_invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_rent_invoices_period ON rent_invoices(period_start, period_end);

DROP TRIGGER IF EXISTS trg_rent_invoices_updated ON rent_invoices;
CREATE TRIGGER trg_rent_invoices_updated BEFORE UPDATE ON rent_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 4. Банк аренды (полноценный, отдельный от складского) ─
CREATE TABLE IF NOT EXISTS rent_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL,
  account_org_id TEXT NOT NULL,      -- счёт организации (bau/pakin)
  tenant_id UUID,                    -- логическая связь с rent_tenants.id
  invoice_id UUID,                   -- логическая связь с rent_invoices.id
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  kind TEXT NOT NULL DEFAULT 'rent', -- rent/other для входящих; expense_* для исходящих
  method TEXT NOT NULL DEFAULT 'bank' CHECK (method IN ('bank', 'cash')), -- безнал/наличка
  counterparty TEXT NOT NULL DEFAULT '', -- арендатор или сторонний контрагент
  amount NUMERIC NOT NULL DEFAULT 0,
  date TEXT NOT NULL DEFAULT '',     -- дата операции YYYY-MM-DD
  invoice_number TEXT,               -- № счёта/платёжки
  is_paid BOOLEAN NOT NULL DEFAULT FALSE, -- проведён ли платёж
  paid_at TEXT,
  exclude_from_balance BOOLEAN NOT NULL DEFAULT FALSE,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_payments_org ON rent_payments(account_org_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_tenant ON rent_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_invoice ON rent_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_date ON rent_payments(date);
CREATE INDEX IF NOT EXISTS idx_rent_payments_paid ON rent_payments(is_paid);

DROP TRIGGER IF EXISTS trg_rent_payments_updated ON rent_payments;
CREATE TRIGGER trg_rent_payments_updated BEFORE UPDATE ON rent_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. RLS: доступ только с сервера (service_role) ───────
ALTER TABLE rent_orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_payments ENABLE ROW LEVEL SECURITY;
-- Политик нет: чтение/запись только с сервера (service_role).

-- ── 6. Счётчики номеров документов ───────────────────────
INSERT INTO doc_counters (key, value) VALUES
  ('rent_invoice', 0),
  ('rent_payment', 0)
ON CONFLICT (key) DO NOTHING;


-- =====================================================================
-- МИГРАЦИЯ: migration_rent_building.sql
-- =====================================================================
-- =========================================================
-- МИГРАЦИЯ: Схема здания для аренды (этажи и офисы)
--
-- Добавляет:
--   rent_buildings      — здания (корпуса)
--   rent_office_units   — офисы/помещения на этажах (x,y,w,h в %)
-- Связь офиса с арендатором — tenant_id (логическая, без FK
-- на случай удаления арендатора — ставится NULL).
--
-- Идемпотентна: безопасно запускать повторно в Supabase → SQL Editor.
-- =========================================================

CREATE TABLE IF NOT EXISTS rent_buildings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  floors INT NOT NULL DEFAULT 3 CHECK (floors >= 1 AND floors <= 20),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO rent_buildings (id, name, address, floors) VALUES
  ('main', 'Главный корпус', NULL, 3)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_rent_buildings_updated ON rent_buildings;
CREATE TRIGGER trg_rent_buildings_updated BEFORE UPDATE ON rent_buildings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS rent_office_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id TEXT NOT NULL REFERENCES rent_buildings(id) ON DELETE CASCADE,
  floor INT NOT NULL CHECK (floor >= 1 AND floor <= 20),
  label TEXT NOT NULL,
  x NUMERIC(5,1) NOT NULL CHECK (x >= 0 AND x <= 100),
  y NUMERIC(5,1) NOT NULL CHECK (y >= 0 AND y <= 100),
  w NUMERIC(5,1) NOT NULL CHECK (w >= 1 AND w <= 100),
  h NUMERIC(5,1) NOT NULL CHECK (h >= 1 AND h <= 100),
  tenant_id UUID,
  area NUMERIC(10,1),
  color TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_office_units_building_floor ON rent_office_units(building_id, floor);
CREATE INDEX IF NOT EXISTS idx_rent_office_units_tenant ON rent_office_units(tenant_id);

DROP TRIGGER IF EXISTS trg_rent_office_units_updated ON rent_office_units;
CREATE TRIGGER trg_rent_office_units_updated BEFORE UPDATE ON rent_office_units
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE rent_buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_office_units ENABLE ROW LEVEL SECURITY;
-- Политик нет: доступ только с сервера (service_role)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='rent_buildings') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE rent_buildings';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='rent_office_units') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE rent_office_units';
  END IF;
END $$;


-- =====================================================================
-- МИГРАЦИЯ: migration_rent_electricity.sql
-- =====================================================================
-- =========================================================
-- МИГРАЦИЯ: Расчёт электроэнергии арендаторов (счётчики и счета за ЭЭ)
--
-- Добавляет:
--   1. Индивидуальный тариф за электроэнергию в rent_tenants (по умолчанию 9.0 ₽/кВт⋅ч)
--   2. Вид начисления (kind: 'rent' | 'electricity') в rent_invoices
--   3. Таблицу показаний счётчиков rent_meter_readings с уникальным индексом (tenant_id, period)
--
-- Идемпотентна: безопасно запускать повторно в Supabase → SQL Editor.
-- =========================================================

-- 1. Индивидуальный тариф ЭЭ у арендатора (по стандарту 9 руб./кВт⋅ч)
ALTER TABLE rent_tenants
  ADD COLUMN IF NOT EXISTS electricity_tariff NUMERIC(10, 2) NOT NULL DEFAULT 9.0;

-- 2. Тип счёта в начислениях аренды ('rent' — аренда, 'electricity' — электроэнергия)
ALTER TABLE rent_invoices
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'rent'
  CHECK (kind IN ('rent', 'electricity'));

CREATE INDEX IF NOT EXISTS idx_rent_invoices_kind ON rent_invoices(kind);

-- 3. Показания счётчиков электроэнергии по месяцам
CREATE TABLE IF NOT EXISTS rent_meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES rent_tenants(id) ON DELETE CASCADE,
  period DATE NOT NULL,                        -- месяц расчёта: YYYY-MM-01
  tariff NUMERIC(10, 2) NOT NULL DEFAULT 9.0,  -- тариф руб./кВт⋅ч в этом месяце
  reading_start NUMERIC(14, 1),                -- начальное показание счётчика
  reading_end NUMERIC(14, 1),                  -- конечное показание счётчика
  consumption NUMERIC(14, 1) NOT NULL DEFAULT 0, -- расход = reading_end - reading_start
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,      -- сумма = consumption * tariff
  invoice_id UUID,                             -- связанный счёт за ЭЭ (rent_invoices.id)
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Уникальный индекс: одна запись на арендатора в месяц
CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_meter_readings_tenant_period
  ON rent_meter_readings(tenant_id, period);

CREATE INDEX IF NOT EXISTS idx_rent_meter_readings_period
  ON rent_meter_readings(period DESC);

CREATE INDEX IF NOT EXISTS idx_rent_meter_readings_invoice
  ON rent_meter_readings(invoice_id);

DROP TRIGGER IF EXISTS trg_rent_meter_readings_updated ON rent_meter_readings;
CREATE TRIGGER trg_rent_meter_readings_updated
  BEFORE UPDATE ON rent_meter_readings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE rent_meter_readings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND tablename = 'rent_meter_readings') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE rent_meter_readings';
  END IF;
END $$;


-- =====================================================================
-- МИГРАЦИЯ: migration_wastepaper_account.sql
-- =====================================================================
-- =========================================================
-- Миграция: отдельный учёт макулатуры (никак не связан с сайтом
-- и с товарным учётом — свои контрагенты, приёмы, сдачи,
-- платежи нал/безнал и перевозки).
--
-- Таблицы:
--   wp_counterparties — контрагенты (кто сдаёт нам / предприятия-приёмщики)
--   wp_intakes        — приём макулатуры (создаёт расходный платёж)
--   wp_shipments      — сдача макулатуры на предприятие (создаёт приход)
--   wp_payments       — ручные платежи (аренда, грузчики, прочее)
--   wp_transports     — плановые перевозки за макулатурой с остановками
--
-- Плюс роль admins.role = 'wastepaper' (макулатурщик: доступ только
-- к этому модулю; логин/пароль задаётся в админке, как у остальных).
--
-- Применить в Supabase Dashboard → SQL Editor.
-- =========================================================

-- ── Контрагенты ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wp_counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  roles TEXT[] NOT NULL DEFAULT '{}',          -- 'supplier' сдаёт нам, 'enterprise' принимает у нас
  phone TEXT,                                  -- зеркало первой точки (для совместимости)
  address TEXT,                                -- зеркало первой точки (для совместимости)
  contact_person TEXT,                         -- зеркало первой точки (для совместимости)
  branches JSONB NOT NULL DEFAULT '[]'::jsonb, -- точки/филиалы: [{id,label,address,contactPerson,phone}]
  inn TEXT,
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wp_counterparties_name ON wp_counterparties(name);

-- ── Приём макулатуры ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS wp_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL DEFAULT 0,               -- порядковый № (ПМ-<n>)
  date DATE NOT NULL,                          -- дата приёма
  counterparty_id UUID,                        -- логическая связь с wp_counterparties
  counterparty_name TEXT NOT NULL DEFAULT '',
  address TEXT,                                -- откуда забрали (для вывоза)
  wastepaper_type TEXT NOT NULL DEFAULT 'cardboard',
  weight_kg NUMERIC NOT NULL DEFAULT 0,
  price_per_kg NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,    -- позиции: [{id,wastepaperType,weightKg,pricePerKg,total}]
  phone TEXT,                                  -- телефон точки (для путевого листа)
  contact_person TEXT,                         -- контактное лицо точки
  account TEXT NOT NULL DEFAULT 'cash' CHECK (account IN ('cash','bank')),  -- как платим поставщику
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TIMESTAMPTZ,                         -- фактическая дата/время оплаты (осн. для баланса)
  transport_id UUID,                           -- логическая связь с wp_transports (если забор перевозкой)
  transport_item_id TEXT,                      -- id остановки внутри перевозки
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wp_intakes_date ON wp_intakes(date DESC);
CREATE INDEX IF NOT EXISTS idx_wp_intakes_status ON wp_intakes(status);

-- ── Сдача макулатуры на предприятие ──────────────────────
CREATE TABLE IF NOT EXISTS wp_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL DEFAULT 0,               -- порядковый № (СМ-<n>)
  date DATE NOT NULL,
  enterprise_id UUID,                          -- логическая связь с wp_counterparties (роль enterprise)
  enterprise_name TEXT NOT NULL DEFAULT '',
  address TEXT,                                -- куда везём (точка/филиал предприятия)
  wastepaper_type TEXT NOT NULL DEFAULT 'cardboard',
  weight_kg NUMERIC NOT NULL DEFAULT 0,
  price_per_kg NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,    -- позиции: [{id,wastepaperType,weightKg,pricePerKg,total}]
  phone TEXT,                                  -- телефон точки (для путевого листа)
  contact_person TEXT,                         -- контактное лицо точки
  account TEXT NOT NULL DEFAULT 'bank' CHECK (account IN ('cash','bank')),  -- как получаем деньги
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wp_shipments_date ON wp_shipments(date DESC);
CREATE INDEX IF NOT EXISTS idx_wp_shipments_status ON wp_shipments(status);

-- ── Ручные платежи (зарплата грузчикам, аренда, прочее) ──
CREATE TABLE IF NOT EXISTS wp_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL DEFAULT 0,               -- порядковый № (ПЛМ-<n>)
  date DATE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  account TEXT NOT NULL DEFAULT 'cash' CHECK (account IN ('cash','bank')),
  counterparty_id UUID,                        -- логическая связь (может быть NULL)
  counterparty_name TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TIMESTAMPTZ,
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wp_payments_date ON wp_payments(date DESC);
CREATE INDEX IF NOT EXISTS idx_wp_payments_paid ON wp_payments(is_paid);

-- ── Перевозки за макулатурой ─────────────────────────────
CREATE TABLE IF NOT EXISTS wp_transports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL DEFAULT 0,               -- порядковый № (ТМ-<n>)
  date DATE NOT NULL,                          -- плановая дата рейса
  start_time TEXT,                             -- примерное время выезда (HH:MM)
  driver_name TEXT,
  driver_phone TEXT,
  vehicle TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','cancelled')),
  note TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,    -- остановки: см. ниже структуру
  total_planned_kg NUMERIC NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wp_transports_date ON wp_transports(date DESC);
CREATE INDEX IF NOT EXISTS idx_wp_transports_status ON wp_transports(status);

-- Структура элемента items (остановка):
-- {
--   id: string,
--   counterpartyId: string|null,
--   counterpartyName: string,
--   address: string,
--   approxTime: string,            -- примерное время заезда (HH:MM или "~14:00")
--   wastepaperType: string,
--   plannedKg: number,
--   actualKg: number|null,
--   note: string,
--   status: "pending"|"done"|"skipped",
--   intakeId: string|null          -- оформленный по остановке приём (wp_intakes.id)
-- }

-- ── RLS: только service_role с сервера ───────────────────
ALTER TABLE wp_counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_transports ENABLE ROW LEVEL SECURITY;
-- Политик нет: чтение/запись только с сервера (service_role).

-- ── Realtime (как у остальных рабочих таблиц) ────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='wp_intakes') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_intakes';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='wp_shipments') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_shipments';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='wp_payments') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_payments';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='wp_transports') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_transports';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='wp_counterparties') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_counterparties';
    END IF;
  END IF;
END $$;

-- ── Роль «макулатурщик» ──────────────────────────────────
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('admin', 'manager', 'lawyer', 'wastepaper'));

COMMENT ON COLUMN admins.role IS
  'admin — полный доступ; manager — всё кроме настроек сайта и логов; lawyer — только финансовый дашборд; wastepaper — только отдельный учёт макулатуры';

-- ── Счётчики номеров документов ──────────────────────────
INSERT INTO doc_counters (key, value) VALUES
  ('wp_intake', 0),
  ('wp_shipment', 0),
  ('wp_payment', 0),
  ('wp_transport', 0)
ON CONFLICT (key) DO NOTHING;


-- =====================================================================
-- МИГРАЦИЯ: migration_wastepaper_branches_items.sql
-- =====================================================================
-- =========================================================
-- Миграция: развитие учёта макулатуры.
--
-- 1) Контрагент = одна фирма (например «Детский мир»), у которой
--    может быть НЕСКОЛЬКО филиалов/точек. Каждая точка — связка
--    «адрес + контактное лицо (ФИО) + телефон» (wp_counterparties.branches).
--    Эти данные подставляются в документы и в печать путевого листа.
--
-- 2) Приём и сдача — документы как в 1С: табличная часть из позиций
--    (макулатура разных профилей), у каждой свой вес и цена за кг.
--    Сумма документа = сумма позиций (wp_intakes.items / wp_shipments.items).
--
-- 3) В сдачи добавлен адрес (куда везём) и телефон/контакт точки,
--    в приёмы — телефон/контакт точки (адрес уже был).
--
-- Старые одиночные поля (phone/address/contact_person и
-- wastepaper_type/weight_kg/price_per_kg) НЕ удаляем: они остаются
-- как «зеркало» первой точки / агрегата документа для совместимости.
--
-- Применить в Supabase Dashboard → SQL Editor.
-- =========================================================

-- ── Контрагенты: список точек (филиалов) ─────────────────
ALTER TABLE wp_counterparties
  ADD COLUMN IF NOT EXISTS branches JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Структура элемента branches:
-- {
--   id: string,               -- стабильный id точки
--   label: string,            -- необязательная метка («Филиал №1», «Центральный»)
--   address: string,          -- адрес
--   contactPerson: string,    -- ФИО контактного лица этого адреса
--   phone: string             -- телефон, привязанный к адресу/контакту
-- }

-- Переносим одиночные адрес/телефон/контакт в первую точку,
-- чтобы существующие контрагенты не потеряли данные.
UPDATE wp_counterparties
SET branches = jsonb_build_array(
      jsonb_build_object(
        'id', 'br-legacy',
        'label', '',
        'address', COALESCE(address, ''),
        'contactPerson', COALESCE(contact_person, ''),
        'phone', COALESCE(phone, '')
      )
    )
WHERE (branches IS NULL OR branches = '[]'::jsonb)
  AND (COALESCE(address, '') <> '' OR COALESCE(phone, '') <> '' OR COALESCE(contact_person, '') <> '');

-- ── Приёмы: табличная часть + контакт точки ──────────────
ALTER TABLE wp_intakes
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_person TEXT;

-- Структура элемента items (позиция документа):
-- { id: string, wastepaperType: string, weightKg: number, pricePerKg: number, total: number }

-- Собираем позиции из старых одиночных полей.
UPDATE wp_intakes
SET items = jsonb_build_array(
      jsonb_build_object(
        'id', 'it-legacy',
        'wastepaperType', COALESCE(wastepaper_type, 'cardboard'),
        'weightKg', COALESCE(weight_kg, 0),
        'pricePerKg', COALESCE(price_per_kg, 0),
        'total', COALESCE(total, 0)
      )
    )
WHERE (items IS NULL OR items = '[]'::jsonb)
  AND COALESCE(weight_kg, 0) > 0;

-- ── Сдачи: адрес + табличная часть + контакт точки ───────
ALTER TABLE wp_shipments
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_person TEXT;

UPDATE wp_shipments
SET items = jsonb_build_array(
      jsonb_build_object(
        'id', 'it-legacy',
        'wastepaperType', COALESCE(wastepaper_type, 'cardboard'),
        'weightKg', COALESCE(weight_kg, 0),
        'pricePerKg', COALESCE(price_per_kg, 0),
        'total', COALESCE(total, 0)
      )
    )
WHERE (items IS NULL OR items = '[]'::jsonb)
  AND COALESCE(weight_kg, 0) > 0;


-- =====================================================================
-- МИГРАЦИЯ: migration_wastepaper_products_payments.sql
-- =====================================================================
-- Отдельный справочник видов макулатуры и раздельная оплата по перевозкам.
-- Не связан с таблицей products сайта.
CREATE TABLE IF NOT EXISTS wp_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price_per_kg NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wp_products_active ON wp_products(is_active, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wp_products_name_unique ON wp_products(name);
INSERT INTO wp_products (name, price_per_kg) VALUES
  ('Гофрокартон', 0), ('Белая бумага (архив)', 0),
  ('Книги, журналы, газеты', 0), ('Смешанная макулатура', 0)
ON CONFLICT DO NOTHING;
ALTER TABLE wp_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp_intakes ADD COLUMN IF NOT EXISTS cash_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE wp_intakes ADD COLUMN IF NOT EXISTS bank_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE wp_transports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- payment fields live inside wp_transports.items JSONB:
-- pricePerKg, cashAmount, bankAmount. Existing records remain compatible.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='wp_products') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_products';
  END IF;
END $$;


-- =====================================================================
-- МИГРАЦИЯ: migration_wastepaper_third_party_funds.sql
-- =====================================================================
-- Сторонние пополнения: отдельный денежный контур (карты/источники могут быть разными).
ALTER TABLE wp_payments DROP CONSTRAINT IF EXISTS wp_payments_account_check;
ALTER TABLE wp_payments ADD CONSTRAINT wp_payments_account_check CHECK (account IN ('cash','bank','third_party'));


-- =====================================================================
-- МИГРАЦИЯ: migration_wp_account_transfers.sql
-- =====================================================================
-- =========================================================
-- Миграция: переводы между счетами макулатуры (безнал ↔ наличка).
--
-- Перевод — внутреннее движение денег модуля: сумма уходит с одного
-- счёта и приходит на другой, внешний приход/расход не создаётся.
-- В отчётах показывается двумя строками одного перевода: расход по
-- счёту-источнику и приход по счёту-получателю (общий остаток модуля
-- при этом не меняется).
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

CREATE TABLE IF NOT EXISTS wp_account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL DEFAULT 0,               -- порядковый № (Перевод №<n>)
  date DATE NOT NULL,                          -- дата перевода
  from_account TEXT NOT NULL DEFAULT 'bank',   -- cash | bank | third_party
  to_account TEXT NOT NULL DEFAULT 'cash',     -- cash | bank | third_party
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,     -- сумма перевода, ₽
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wp_account_transfers_date
  ON wp_account_transfers(date DESC);

COMMENT ON TABLE wp_account_transfers IS
  'Переводы денег между счетами учёта макулатуры (безнал ↔ наличка ↔ сторонние): внутреннее движение, внешний приход/расход не создаёт';

-- ── RLS: только service_role с сервера (как у остальных wp_*) ──
ALTER TABLE wp_account_transfers ENABLE ROW LEVEL SECURITY;

-- ── Realtime: журнал «Банк» обновляется у всех, кто открыл модуль ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND tablename = 'wp_account_transfers') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_account_transfers';
  END IF;
END $$;

-- ── Счётчик номеров переводов ────────────────────────────
INSERT INTO doc_counters (key, value) VALUES ('wp_account_transfer', 0)
ON CONFLICT (key) DO NOTHING;


-- =====================================================================
-- МИГРАЦИЯ: migration_wp_actual_weights.sql
-- =====================================================================
-- Фактический склад и раздельные веса/деньги макулатуры.
ALTER TABLE wp_intakes ADD COLUMN IF NOT EXISTS accepted_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE wp_intakes ADD COLUMN IF NOT EXISTS payable_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE wp_shipments ADD COLUMN IF NOT EXISTS shipped_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE wp_shipments ADD COLUMN IF NOT EXISTS accepted_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE wp_shipments ADD COLUMN IF NOT EXISTS received_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE wp_shipments ADD COLUMN IF NOT EXISTS bank_posted_at TIMESTAMPTZ;


-- =====================================================================
-- МИГРАЦИЯ: migration_wp_awaiting_weight.sql
-- =====================================================================
-- =========================================================
-- Миграция: пометка приёма макулатуры «Приёмка выполнена · ожидание
-- взвешивания».
--
-- Когда перевозка с приёмом макулатуры (точка ПМ-, «забор груза»)
-- завершается, система НИЧЕГО не проводит: склад макулатуры и платёж
-- не двигаются. На приёме появляется только пометка awaiting_weight —
-- «приёмка выполнена, ожидание взвешивания».
--
-- Дальше макулатурщик открывает приём вручную, вписывает фактический вес
-- (accepted_weight_kg / payable_weight_kg) — и после сохранения приём
-- уходит на склад макулатуры и в банк (расход на сумму) как обычно.
-- Сохранение карточки приёма снимает пометку.
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

ALTER TABLE wp_intakes
  ADD COLUMN IF NOT EXISTS awaiting_weight BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_wp_intakes_awaiting_weight
  ON wp_intakes(awaiting_weight)
  WHERE awaiting_weight = TRUE;

COMMENT ON COLUMN wp_intakes.awaiting_weight IS
  'TRUE — приёмка выполнена перевозкой, ждём взвешивания. Склад и платёж не двигаются, пока макулатурщик не впишет вес и не сохранит приём';


-- =====================================================================
-- МИГРАЦИЯ: migration_wp_payment_details.sql
-- =====================================================================
-- Реквизиты поставщика макулатуры для выплат по приёмам.
ALTER TABLE wp_counterparties
  ADD COLUMN IF NOT EXISTS payment_details TEXT;
COMMENT ON COLUMN wp_counterparties.payment_details IS 'Куда переводить деньги поставщику: карта, СБП, счёт и т.п.';


-- =====================================================================
-- МИГРАЦИЯ: migration_wp_payment_links.sql
-- =====================================================================
-- =========================================================
-- Миграция: привязка платежа к документу макулатуры (оплата приёма/продажи).
--
-- Платёж с привязкой — ЕДИНСТВЕННОЕ денежное движение документа:
-- собственное событие документа (по отметке «оплачено») при наличии
-- привязанных платежей не создаётся — деньги не задваиваются. Заголовок
-- платежа в ленте: «Оплата приёма №N» / «Оплата продажи №N». Поля оплаты
-- документа (is_paid, paid_at, account, суммы) синхронизируются с
-- платежами при каждом изменении (один объект правится с обеих сторон).
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

ALTER TABLE wp_payments
  ADD COLUMN IF NOT EXISTS doc_type TEXT;   -- 'intake' | 'shipment' | NULL (свободный платёж)
ALTER TABLE wp_payments
  ADD COLUMN IF NOT EXISTS doc_id TEXT;     -- id приёма / продажи (wp_intakes.id / wp_shipments.id)

CREATE INDEX IF NOT EXISTS idx_wp_payments_doc
  ON wp_payments(doc_type, doc_id)
  WHERE doc_type IS NOT NULL;

COMMENT ON COLUMN wp_payments.doc_type IS
  'Привязка платежа к документу: intake (оплата приёма) | shipment (оплата продажи/сдачи) | NULL — свободный платёж';
COMMENT ON COLUMN wp_payments.doc_id IS
  'id документа (wp_intakes.id / wp_shipments.id); платёж с привязкой — единственное движение денег документа';


-- =====================================================================
-- МИГРАЦИЯ: migration_wp_products_code.sql
-- =====================================================================
-- Справочник видов макулатуры (wp_products) становится единственным
-- источником видов для документов модуля «Учёт макулатура».
--
-- Раньше формы приёмок/отгрузок использовали зашитый в код список из
-- четырёх видов (cardboard / office_paper / books / mix), поэтому правки
-- справочника ни на что не влияли. Теперь документ хранит «ключ вида»:
--   • для четырёх исходных видов — их старый код (чтобы прежние документы
--     и тарифы калькулятора сайта продолжали работать),
--   • для новых видов — UUID строки справочника.
--
-- Миграция добавляет колонку code и проставляет коды исходным видам по
-- их названиям. Если каких-то из исходных видов уже нет — они добавляются
-- заново (скрытыми не помечаются: пользователь сам решает, что скрыть).
ALTER TABLE wp_products ADD COLUMN IF NOT EXISTS code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wp_products_code_unique
  ON wp_products(code) WHERE code IS NOT NULL;

UPDATE wp_products SET code = 'cardboard'
  WHERE code IS NULL AND name = 'Гофрокартон';
UPDATE wp_products SET code = 'office_paper'
  WHERE code IS NULL AND name = 'Белая бумага (архив)';
UPDATE wp_products SET code = 'books'
  WHERE code IS NULL AND name = 'Книги, журналы, газеты';
UPDATE wp_products SET code = 'mix'
  WHERE code IS NULL AND name = 'Смешанная макулатура';

INSERT INTO wp_products (name, price_per_kg, code)
SELECT v.name, 0, v.code
FROM (VALUES
  ('Гофрокартон', 'cardboard'),
  ('Белая бумага (архив)', 'office_paper'),
  ('Книги, журналы, газеты', 'books'),
  ('Смешанная макулатура', 'mix')
) AS v(name, code)
WHERE NOT EXISTS (SELECT 1 FROM wp_products p WHERE p.code = v.code)
  AND NOT EXISTS (SELECT 1 FROM wp_products p WHERE p.name = v.name);


-- =====================================================================
-- МИГРАЦИЯ: migration_wp_stock_manual.sql
-- =====================================================================
-- =========================================================
-- Миграция: склад макулатуры — продажа «без списания» и ручная
-- правка остатка.
--
-- 1) wp_shipments.skip_stock
--    Пометка на сдаче (продаже): деньги проводим как обычно, а остаток
--    на площадке НЕ уменьшаем. Нужно, когда макулатура уехала не с нашей
--    площадки (например, перегруз напрямую от клиента на предприятие) —
--    в склад она не приходила, значит и списывать с него нечего.
--
-- 2) wp_stock_adjustments
--    Ручная корректировка остатка по виду макулатуры (вкладка «Склад»):
--    макулатурщик вписывает фактическое количество и жмёт «Сохранить».
--    Храним РАЗНИЦУ с расчётным остатком (принято − продано), поэтому
--    новые приёмы и продажи продолжают двигать склад поверх правки.
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

-- ── Продажа без списания со склада ──────────────────────
ALTER TABLE wp_shipments
  ADD COLUMN IF NOT EXISTS skip_stock BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_wp_shipments_skip_stock
  ON wp_shipments(skip_stock)
  WHERE skip_stock = TRUE;

COMMENT ON COLUMN wp_shipments.skip_stock IS
  'TRUE — деньги по сдаче проводим, а остаток макулатуры на площадке не уменьшаем (груз ушёл не с нашей площадки)';

-- ── Ручная корректировка остатка по видам ───────────────
CREATE TABLE IF NOT EXISTS wp_stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wastepaper_type TEXT NOT NULL,               -- ключ вида (wp_products.code/id или старое имя)
  delta_kg NUMERIC(12,3) NOT NULL DEFAULT 0,   -- разница с расчётным остатком, кг (+/−)
  note TEXT,                                   -- почему правили (необязательно)
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wp_stock_adjustments_type
  ON wp_stock_adjustments(wastepaper_type);

COMMENT ON TABLE wp_stock_adjustments IS
  'Ручная правка остатка макулатуры на складе: разница между фактическим количеством и расчётом (принято − продано)';

-- ── RLS: только service_role с сервера (как у остальных wp_*) ──
ALTER TABLE wp_stock_adjustments ENABLE ROW LEVEL SECURITY;

-- ── Realtime: вкладка «Склад» обновляется у всех, кто открыл модуль ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND tablename = 'wp_stock_adjustments') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_stock_adjustments';
  END IF;
END $$;


-- =====================================================================
-- МИГРАЦИЯ: migration_wp_transport_link.sql
-- =====================================================================
-- =========================================================
-- Миграция: связь приёмов/сдач макулатуры с ЕДИНЫМИ перевозками
-- (таблица transports из товарного учёта).
--
-- Что меняется:
--   • wp_intakes / wp_shipments получают флаг needs_transport:
--     TRUE  — документ нужно везти перевозкой (приём = «забор груза»,
--             сдача = «сдача груза»), он попадает в очередь «Ожидают
--             формирования» и далее в путевой лист — по той же логике,
--             что доставка заказов учёта (ЗК);
--     FALSE — клиент привозит/забирает сам, перевозка не нужна.
--   • transport_planned_date — желаемая дата вывоза (необязательно,
--     подсказка диспетчеру при формировании рейса).
--
-- Отдельные перевозки макулатуры (wp_transports, ТМ-...) больше не
-- используются интерфейсом: вкладка «Перевозки» в модуле макулатуры
-- показывает те же перевозки учёта (ПЕР-...), что и раздел «Доставки».
-- Таблица wp_transports НЕ удаляется — старые рейсы остаются в БД.
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

-- ── Приём макулатуры ─────────────────────────────────────
ALTER TABLE wp_intakes
  ADD COLUMN IF NOT EXISTS needs_transport BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE wp_intakes
  ADD COLUMN IF NOT EXISTS transport_planned_date DATE;

CREATE INDEX IF NOT EXISTS idx_wp_intakes_needs_transport
  ON wp_intakes(needs_transport)
  WHERE needs_transport = TRUE;

COMMENT ON COLUMN wp_intakes.needs_transport IS
  'TRUE — приём нужно забрать перевозкой (попадает в очередь перевозок учёта и в путевой лист как «забор груза»); FALSE — клиент привозит сам';

-- ── Сдача макулатуры на предприятие ──────────────────────
ALTER TABLE wp_shipments
  ADD COLUMN IF NOT EXISTS needs_transport BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE wp_shipments
  ADD COLUMN IF NOT EXISTS transport_planned_date DATE;

CREATE INDEX IF NOT EXISTS idx_wp_shipments_needs_transport
  ON wp_shipments(needs_transport)
  WHERE needs_transport = TRUE;

COMMENT ON COLUMN wp_shipments.needs_transport IS
  'TRUE — сдачу нужно отвезти перевозкой (попадает в очередь перевозок учёта и в путевой лист как «сдача груза»); FALSE — без нашей перевозки';


-- =====================================================================
-- МИГРАЦИЯ: migration_wp_transport_done.sql
-- =====================================================================
-- ============================================================
-- Пометка «перевозка выполнена» на приёмах макулатуры
-- ------------------------------------------------------------
-- Приём (ПМ) живёт дольше перевозки: груз вывезли, а вес и оплату
-- макулатурщик вписывает потом. Чтобы приём не висел в доставках /
-- очереди перевозок, у него есть отдельная durable-пометка.
--
-- Ставится:
--   • автоматически — при завершении рейса, в котором была точка этого
--     приёма (completeTransport, вместе с awaiting_weight);
--   • вручную — кнопкой «Перевозка выполнена» в списке Приёмы или в
--     карточке приёма.
--
-- Снимается только вручную (той же кнопкой). Сохранение карточки приёма
-- её НЕ трогает — в отличие от awaiting_weight, которая снимается, как
-- только вписан фактический вес.
--
-- Отдельный столбец, а не awaiting_weight, потому что «ждёт
-- взвешивания» — временное состояние (пропадает после сохранения веса),
-- а «перевозка выполнена» должно жить до конца работы с приёмом.
-- ============================================================

ALTER TABLE wp_intakes
  ADD COLUMN IF NOT EXISTS transport_done boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN wp_intakes.transport_done IS
  'Перевозка выполнена: груз вывезли (автоматически при завершении рейса или вручную). Приём уходит из очереди перевозок и доставок, работа продолжается по весу и оплате.';

-- Старые приёмы, у которых перевозка уже состоялась, помечаем
-- выполненными — иначе после миграции они снова появятся в доставках.
-- Берём только те, что реально ездили: стоят в завершённом рейсе
-- (awaiting_weight) или были привязаны к перевозке (transport_id).
UPDATE wp_intakes
SET transport_done = true
WHERE transport_done = false
  AND (awaiting_weight = true OR transport_id IS NOT NULL);


-- =====================================================================
-- МИГРАЦИЯ: migration_rls_public_tables.sql
-- =====================================================================
-- =========================================================
-- Миграция: включить RLS на таблицах, забытых в public
--
-- ЧТО ЧИНИТ
-- Supabase Security Advisor: «RLS Disabled in Public» (Critical)
--   • public._backup_bank_payments
--   • public.transports          ← та же проблема, advisor покажет её следом
--
-- ПОЧЕМУ ЭТО ВАЖНО
-- Supabase публикует ВСЕ таблицы схемы public через PostgREST —
-- то есть по HTTP на https://<project>.supabase.co/rest/v1/<table>.
-- Ключ anon публичный: он зашит в JS-бандл сайта (см.
-- NEXT_PUBLIC_SUPABASE_ANON_KEY в use-admin-realtime.ts), его видно
-- в DevTools у любого посетителя.
-- Без RLS единственное, что защищает таблицу, — то, что её имя
-- никто не угадал. Для _backup_bank_payments это копия ВСЕХ
-- банковских платежей, для transports — маршруты, water/телефоны
-- водителей и адреса клиентов.
-- Проверить, что дыра реальна, можно так (до миграции вернёт данные):
--   curl "$SUPABASE_URL/rest/v1/transports?select=*" \
--        -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
--
-- ПОЧЕМУ ЭТО НИЧЕГО НЕ СЛОМАЕТ В АДМИНКЕ
-- 1. Вся работа с этими таблицами идёт через getAdminDb() —
--    клиент на service_role (src/lib/supabase.ts). Ключ service_role
--    обходит RLS на уровне Postgres (роль имеет атрибут BYPASSRLS),
--    поэтому политики к нему не применяются вообще.
--    Проверено: 12 обращений к transports в src/lib/warehouse.ts —
--    все через getAdminDb(); _backup_bank_payments в коде не
--    используется ни разу.
-- 2. Ни одна из таблиц не участвует в Realtime-подписках
--    (там только orders, wastepaper_requests, bank_payments,
--    customer_deals, product_reviews — у всех RLS уже включён).
-- 3. Используем ENABLE, а НЕ FORCE ROW LEVEL SECURITY.
--    FORCE распространил бы политики и на владельца таблицы —
--    вот это сломало бы админку. ENABLE — не ломает.
--
-- Политики намеренно НЕ создаём: доступ нужен только серверу.
-- Это тот же приём, что уже применён в schema.sql для
-- bank_payments, salaries, employees, cash_collections,
-- counterparties, supplier_prices, warehouse_receipts,
-- doc_counters, customer_deals, activity_logs, admins —
-- у них RLS включён и политик нет.
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

-- ── 1. Резервная копия платежей, оставшаяся от старого скрипта ──
-- Создана в FIX_cash_restore.sql (он помечен «УСТАРЕЛО — НЕ ЗАПУСКАТЬ»).
-- Приложение к ней не обращается — таблица нужна только как архив.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = '_backup_bank_payments'
  ) THEN
    EXECUTE 'ALTER TABLE public._backup_bank_payments ENABLE ROW LEVEL SECURITY';
    RAISE NOTICE 'RLS включён: _backup_bank_payments';
  ELSE
    RAISE NOTICE 'Пропущено: _backup_bank_payments не существует';
  END IF;
END $$;

-- ── 2. Перевозки ──
-- Админская таблица: маршруты, водители, адреса клиентов.
-- Публичного доступа не требует.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'transports'
  ) THEN
    EXECUTE 'ALTER TABLE public.transports ENABLE ROW LEVEL SECURITY';
    RAISE NOTICE 'RLS включён: transports';
  ELSE
    RAISE NOTICE 'Пропущено: transports не существует';
  END IF;
END $$;

-- ── 3. Страховка на будущее ──
-- Ловим любые другие таблицы public без RLS, чтобы advisor не
-- присылал такие же предупреждения после следующих миграций.
-- Системные таблицы Supabase не трогаем — они не в public.
DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind = 'r'          -- обычные таблицы (не вьюхи/партиции)
      AND c.relrowsecurity = FALSE -- RLS ещё не включён
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    RAISE NOTICE 'RLS включён (страховка): %', r.relname;
    n := n + 1;
  END LOOP;

  IF n = 0 THEN
    RAISE NOTICE 'Все таблицы public уже под RLS';
  END IF;
END $$;

-- ── 4. Проверка результата ──
-- Должно вернуть 0 строк. Если что-то осталось — оно всё ещё открыто.
SELECT
  c.relname AS table_without_rls
FROM pg_class c
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = FALSE
ORDER BY 1;

-- Полная картина: какие таблицы под RLS и сколько у них политик.
-- Таблицы с 0 политик = доступны только service_role (это норма
-- для админских таблиц).
SELECT
  c.relname                                   AS table_name,
  c.relrowsecurity                            AS rls_enabled,
  (SELECT COUNT(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_class c
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY policies DESC, c.relname;

-- =========================================================
-- ОПЦИОНАЛЬНО: удалить устаревшую резервную копию
--
-- _backup_bank_payments — снимок bank_payments, сделанный скриптом
-- FIX_cash_restore.sql. Тот скрипт завершился ROLLBACK («база сейчас
-- в исходном виде», см. шапку файла), поэтому копия дублирует данные,
-- которые и так лежат в bank_payments, и с тех пор устарела.
--
-- После включения RLS она уже не опасна, так что спешить некуда.
-- Если решите убрать — сначала убедитесь, что она не нужна:
--
--   SELECT COUNT(*) FROM _backup_bank_payments;   -- сколько строк
--   SELECT COUNT(*) FROM bank_payments;           -- сравнить с текущими
--
-- и только потом:
--
--   DROP TABLE IF EXISTS public._backup_bank_payments;
-- =========================================================


-- =====================================================================
-- МИГРАЦИЯ: migration_rls_users_orders.sql
-- =====================================================================
-- =========================================================
-- КРИТИЧНО. Миграция: закрыть публичный доступ к users и orders
--
-- ЧТО НАЙДЕНО
-- В schema.sql на таблицах users и orders висят политики «разрешить всем»:
--   users_sel  FOR SELECT USING (TRUE)
--   users_ins  FOR INSERT WITH CHECK (TRUE)
--   users_upd  FOR UPDATE USING (TRUE)
--   orders_sel FOR SELECT USING (TRUE)
--   orders_ins FOR INSERT WITH CHECK (TRUE)
--   orders_upd FOR UPDATE USING (TRUE)
--
-- Схема public целиком публикуется наружу через PostgREST, а ключ anon
-- публичный. Пока эти политики включены, любой, кто знает ключ и адрес
-- проекта, может:
--
--   curl "$SUPABASE_URL/rest/v1/users?select=*" -H "apikey: $ANON"
--     → телефоны, имена, email, ИНН, адреса И ХЕШИ ПАРОЛЕЙ всех клиентов;
--
--   curl -X PATCH "$SUPABASE_URL/rest/v1/users?id=eq.<id>" \
--        -H "apikey: $ANON" -d '{"password_hash":"..."}'
--     → подменить пароль любому клиенту и войти в его кабинет;
--
--   curl "$SUPABASE_URL/rest/v1/orders?select=*" -H "apikey: $ANON"
--     → выгрузить все заявки с именами, телефонами, суммами и адресами.
--
-- В терминах 152-ФЗ это готовая утечка персональных данных: ч. 12–15
-- ст. 13.11 КоАП — от 3 млн ₽, при повторной — оборотный штраф.
--
-- ПОЧЕМУ ЭТО НИЧЕГО НЕ СЛОМАЕТ
-- В приложении НЕТ ни одного обращения к Supabase из браузера:
-- getPublicDb() (src/lib/supabase.ts) не вызывается нигде, весь доступ
-- идёт через getAdminDb() на service_role, который обходит RLS на уровне
-- Postgres. Регистрация, вход, оформление заявок, кабинет — всё это
-- серверные маршруты /api/*. Realtime админки тоже работает через сервер
-- (src/lib/realtime-hub.ts, service_role), а не через anon.
--
-- Проверить после применения (должно вернуть пустой массив или ошибку):
--   curl "$SUPABASE_URL/rest/v1/users?select=id" -H "apikey: $ANON"
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

-- ── Клиенты: доступ только с сервера ──
DROP POLICY IF EXISTS "users_sel" ON users;
DROP POLICY IF EXISTS "users_ins" ON users;
DROP POLICY IF EXISTS "users_upd" ON users;

-- ── Заявки: доступ только с сервера ──
DROP POLICY IF EXISTS "orders_sel" ON orders;
DROP POLICY IF EXISTS "orders_ins" ON orders;
DROP POLICY IF EXISTS "orders_upd" ON orders;

-- Заявки на вывоз макулатуры создаются тем же серверным маршрутом
-- (/api/wastepaper) — политика для анонимной вставки не нужна.
DROP POLICY IF EXISTS "wp_ins" ON wastepaper_requests;

-- RLS должен остаться включённым (без политик = «никому, кроме service_role»).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE wastepaper_requests ENABLE ROW LEVEL SECURITY;

-- Каталог остаётся публично читаемым намеренно: товары, категории,
-- настройки, акции и отзывы и так показываются на сайте, персональных
-- данных там нет. Их политики не трогаем.

DO $$
BEGIN
  RAISE NOTICE 'Публичные политики users/orders сняты. Проверьте сайт: регистрация, вход, оформление заявки, кабинет.';
END $$;


-- =====================================================================
-- МИГРАЦИЯ: migration_fix_die_calc_view_security_invoker.sql
-- =====================================================================
-- =========================================================
-- FILE: supabase/migration_fix_die_calc_view_security_invoker.sql
-- Исправление замечаний Supabase Security Advisor:
--   1. [ERROR] View `public.die_calc_job_stats` is defined with the
--      SECURITY DEFINER property → переводим представление в режим
--      `security_invoker = true`, чтобы при запросах через PostgREST
--      действовали RLS-права вызывающей роли, а не владельца схемы.
--   2. [WARN] Фиксируем `search_path = public` у всех серверных и
--      триггерных функций схемы `public`, чтобы в Security Advisor
--      не было предупреждений `Function Search Path Mutable`.
-- Идемпотентно — безопасно запускать повторно.
-- =========================================================

-- 1. Пересоздаём и явно переключаем вьюху статистики расчётов штанцформ
--    в режим SECURITY INVOKER (PostgreSQL 15+ / Supabase Cloud).
CREATE OR REPLACE VIEW public.die_calc_job_stats
WITH (security_invoker = true) AS
SELECT
  j.construction,
  j.closure,
  j.profile_id,
  COUNT(*)::INT AS jobs,
  COUNT(*) FILTER (WHERE j.fact_blank_w IS NOT NULL AND j.fact_blank_h IS NOT NULL)::INT AS with_fact_geom,
  COUNT(*) FILTER (WHERE j.fact_price_per_pcs IS NOT NULL OR j.fact_price_batch IS NOT NULL)::INT AS with_fact_price,
  ROUND(AVG(
    (ABS(j.fact_blank_w - j.blank_w) + ABS(j.fact_blank_h - j.blank_h)) / 2
  ) FILTER (WHERE j.fact_blank_w IS NOT NULL AND j.fact_blank_h IS NOT NULL), 1) AS mean_blank_err_mm,
  ROUND(AVG(j.fact_price_per_pcs / NULLIF(j.price_per_pcs, 0))
    FILTER (WHERE j.fact_price_per_pcs > 0 AND j.price_per_pcs > 0), 4) AS mean_price_k,
  SUM(j.price_batch) AS sum_price_batch,
  SUM(j.fact_price_batch) AS sum_fact_price_batch
FROM public.die_calc_jobs j
WHERE j.learned = TRUE
GROUP BY j.construction, j.closure, j.profile_id;

ALTER VIEW public.die_calc_job_stats SET (security_invoker = true);

-- Запрещаем прямой доступ к представлению для ролей anon/authenticated
-- (чтение статистики штанцформ выполняется только серверным ключом админки)
REVOKE ALL ON public.die_calc_job_stats FROM anon, authenticated;

-- 2. Фиксируем безопасный `search_path = public` для всех функций проекта
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_product_in_stock') THEN
    ALTER FUNCTION public.sync_product_in_stock() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calculate_product_box_volume') THEN
    ALTER FUNCTION public.calculate_product_box_volume() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_update_product_rating') THEN
    ALTER FUNCTION public.fn_update_product_rating() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_next_counter') THEN
    ALTER FUNCTION public.fn_next_counter(TEXT) SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_increment_view_count') THEN
    ALTER FUNCTION public.fn_increment_view_count() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_review_helpful') THEN
    ALTER FUNCTION public.increment_review_helpful(UUID) SET search_path = public;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- МИГРАЦИЯ: migration_realtime_admin.sql
-- =====================================================================
-- =========================================================
-- Миграция: включить Realtime для рабочих таблиц админки
--
-- ЧТО ДЕЛАЕТ
-- Добавляет таблицы в публикацию supabase_realtime. Без этого Postgres
-- просто не пишет их изменения в поток логической репликации, и Realtime
-- не отдаёт по ним события — даже под service_role.
--
-- БЕЗОПАСНОСТЬ
-- Публикация НЕ раздаёт доступ. Права по-прежнему определяются RLS:
--   • у finance-таблиц (bank_payments, salaries, customer_deals,
--     cash_collections, client_requests…) RLS включён и политик для anon
--     нет — анонимный клиент не получит по ним ни одной строки;
--   • подписку держит сервер приложения под service_role
--     (src/lib/realtime-hub.ts), а браузеры админки слушают наш же домен
--     через SSE /api/admin/events под admin-session cookie.
-- Никаких новых политик здесь намеренно не создаётся.
--
-- REPLICA IDENTITY не меняем: приложению достаточно id изменённой строки,
-- а REPLICA IDENTITY FULL заметно раздувает WAL.
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

DO $$
DECLARE
  t TEXT;
  wanted TEXT[] := ARRAY[
    'orders',
    'wastepaper_requests',
    'client_requests',
    'customer_deals',
    'warehouse_receipts',
    'bank_payments',
    'salaries',
    'cash_collections',
    'products',
    'transports',
    'product_reviews',
    'product_questions',
    'activity_logs',
    'rent_invoices',
    'rent_payments',
    'wp_intakes',
    'wp_shipments',
    'wp_payments',
    'wp_transports',
    'wp_counterparties'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Публикации supabase_realtime нет — Realtime в этом проекте не настроен, пропускаем.';
    RETURN;
  END IF;

  FOREACH t IN ARRAY wanted LOOP
    -- таблицы может не быть, если соответствующая миграция ещё не применена
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      RAISE NOTICE 'Пропуск %: таблицы нет', t;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      RAISE NOTICE 'Уже в публикации: %', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    RAISE NOTICE 'Добавлено в Realtime: %', t;
  END LOOP;
END $$;

-- Проверка: что сейчас в публикации
-- SELECT tablename FROM pg_publication_tables
--  WHERE pubname = 'supabase_realtime' ORDER BY tablename;


-- =====================================================================
-- ФИНАЛЬНАЯ КОНСОЛИДАЦИЯ ОГРАНИЧЕНИЙ, RPC, СЧЁТЧИКОВ И REALTIME
-- Гарантирует, что объединённые наборы ролей и статусов полные.
-- =====================================================================

-- 1. Полный список ролей сотрудников админки (включая owner и wastepaper)
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
UPDATE admins SET role = 'admin' WHERE role IS NULL;
ALTER TABLE admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'lawyer', 'wastepaper'));

-- 2. Полный список статусов заявок с сайта (включая ready, in_delivery, issued)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'new',
    'confirmed',
    'processing',
    'in_progress',
    'ready',
    'in_delivery',
    'shipped',
    'issued',
    'completed',
    'cancelled',
    'rejected'
  ));

-- 3. Разметка сдачи кассы для третьей кассы (Карта В.М.)
ALTER TABLE bank_payments DROP CONSTRAINT IF EXISTS bank_payments_cash_destination_check;
ALTER TABLE bank_payments
  ADD CONSTRAINT bank_payments_cash_destination_check
  CHECK (cash_destination IN ('cash', 'card', 'vm_card'));

-- 4. RPC атомарного инкремента «Отзыв полезен»
CREATE OR REPLACE FUNCTION increment_review_helpful(review_id_param UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INT;
BEGIN
  UPDATE product_reviews
  SET helpful_count = COALESCE(helpful_count, 0) + 1
  WHERE id = review_id_param
  RETURNING helpful_count INTO new_count;
  RETURN COALESCE(new_count, 0);
END;
$$;

-- 5. Инициализация всех счётчиков документов
INSERT INTO doc_counters (key, value) VALUES
  ('receipt', 0),
  ('deal', 0),
  ('payment', 0),
  ('transport', 0),
  ('warehouse_assembly', 0),
  ('wp_intake', 0),
  ('wp_shipment', 0),
  ('wp_payment', 0),
  ('wp_transport', 0)
ON CONFLICT (key) DO NOTHING;

-- 6. Включение публикации Supabase Realtime для всех живых таблиц админки
DO $$
DECLARE
  t TEXT;
  wanted TEXT[] := ARRAY[
    'orders',
    'wastepaper_requests',
    'client_requests',
    'customer_deals',
    'warehouse_receipts',
    'warehouse_assemblies',
    'bank_payments',
    'bank_account_transfers',
    'salaries',
    'cash_collections',
    'products',
    'transports',
    'product_reviews',
    'product_questions',
    'activity_logs',
    'db_sync_runs',
    'rent_invoices',
    'rent_payments',
    'rent_meter_readings',
    'wp_intakes',
    'wp_shipments',
    'wp_payments',
    'wp_transports',
    'wp_counterparties',
    'wp_stock_adjustments',
    'wp_account_transfers'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY wanted LOOP
      IF EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- 7. Обновление кэша схемы PostgREST
NOTIFY pgrst, 'reload schema';
