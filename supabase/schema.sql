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
  in_stock BOOLEAN DEFAULT TRUE,
  stock_qty INT,
  stock_warn_qty INT,
  is_promo BOOLEAN DEFAULT FALSE,
  promo_label TEXT,
  made_to_order BOOLEAN DEFAULT FALSE,
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
CREATE INDEX IF NOT EXISTS idx_products_in_stock ON products(in_stock) WHERE in_stock = TRUE;
DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_username ON admins(username);
DROP TRIGGER IF EXISTS trg_admins_updated ON admins;
CREATE TRIGGER trg_admins_updated BEFORE UPDATE ON admins FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'completed', 'rejected')),
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
  ('receipt', 0), ('deal', 0), ('payment', 0), ('salary', 0)
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
  total NUMERIC NOT NULL DEFAULT 0,
  bank_adjustment NUMERIC DEFAULT 0,
  vat_rate NUMERIC DEFAULT 22,
  vat_amount NUMERIC DEFAULT 0,
  linked_deal_ids JSONB DEFAULT '[]'::jsonb,
  linked_deal_numbers JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_number ON warehouse_receipts(number);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON warehouse_receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON warehouse_receipts(date);
DROP TRIGGER IF EXISTS trg_receipts_updated ON warehouse_receipts;
CREATE TRIGGER trg_receipts_updated BEFORE UPDATE ON warehouse_receipts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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
-- 22.1. СДАЧА КАССЫ
-- Списание всего остатка наличных из кассы в отдельный журнал сдач.
-- В безналичный банковский счёт эти суммы не прибавляются.
-- Каждая запись = одна сданная смена (дата + сумма + примечание).
-- =========================================================
CREATE TABLE IF NOT EXISTS cash_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
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
