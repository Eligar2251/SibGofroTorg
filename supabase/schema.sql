-- =========================================================
-- SUPABASE SCHEMA — СибГофроТорг
-- Полный SQL для создания всех таблиц, индексов,
-- RLS-политик и функций. Запускается в SQL Editor Supabase.
-- =========================================================

-- ─── Расширения ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Утилитная функция: обновить updated_at ────────────────
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

CREATE INDEX idx_categories_slug ON categories(slug);
CREATE INDEX idx_categories_sort ON categories(sort_order ASC);

CREATE TRIGGER trg_categories_updated
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 2. ТОВАРЫ
-- =========================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
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

CREATE INDEX idx_products_slug ON products(slug);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_visible ON products(is_visible) WHERE is_visible = TRUE;
CREATE INDEX idx_products_featured ON products(is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_products_promo ON products(is_promo) WHERE is_promo = TRUE;
CREATE INDEX idx_products_in_stock ON products(in_stock) WHERE in_stock = TRUE;

CREATE TRIGGER trg_products_updated
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 3. ПОЛЬЗОВАТЕЛИ (клиенты сайта)
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,  -- phone_<hash> для совместимости
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

CREATE UNIQUE INDEX idx_users_phone_digits ON users(phone_digits);

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

CREATE UNIQUE INDEX idx_admins_username ON admins(username);

CREATE TRIGGER trg_admins_updated
  BEFORE UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 5. ЗАКАЗЫ
-- =========================================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'order' CHECK (type IN ('order', 'inquiry')),
  customer_type TEXT NOT NULL DEFAULT 'individual' CHECK (customer_type IN ('individual', 'legal')),
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_phone_digits TEXT,
  user_id TEXT REFERENCES users(id),
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
  deal_id UUID,
  deal_number INT,
  payment_id UUID,
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
  customer_edited_at TIMESTAMPTZ,
  customer_cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_phone_digits ON orders(customer_phone_digits);
CREATE INDEX idx_orders_phone ON orders(customer_phone);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_type ON orders(type);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

CREATE TRIGGER trg_orders_updated
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 6. НАСТРОЙКИ (ключ-значение, как в Firestore settings.main)
-- =========================================================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_settings_updated
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 7. АКЦИИ / ПРОМО
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

CREATE INDEX idx_promotions_sort ON promotions(sort_order ASC);
CREATE INDEX idx_promotions_visible ON promotions(is_visible) WHERE is_visible = TRUE;

CREATE TRIGGER trg_promotions_updated
  BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

CREATE INDEX idx_popup_campaigns_active ON popup_campaigns(is_active) WHERE is_active = TRUE;

CREATE TRIGGER trg_popup_campaigns_updated
  BEFORE UPDATE ON popup_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 9. ОТЗЫВЫ
-- =========================================================
CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
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

CREATE INDEX idx_reviews_product ON product_reviews(product_id);
CREATE INDEX idx_reviews_approved ON product_reviews(product_id, is_approved, moderation_status);
CREATE INDEX idx_reviews_created ON product_reviews(created_at DESC);

CREATE TRIGGER trg_reviews_updated
  BEFORE UPDATE ON product_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 10. ГОЛОСА ЗА ОТЗЫВЫ (helpful)
-- =========================================================
CREATE TABLE IF NOT EXISTS review_helpful_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(review_id, voter_key)
);

CREATE INDEX idx_helpful_votes_review ON review_helpful_votes(review_id);

-- =========================================================
-- 11. ВОПРОСЫ ПО ТОВАРАМ
-- =========================================================
CREATE TABLE IF NOT EXISTS product_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
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

CREATE INDEX idx_questions_product ON product_questions(product_id);
CREATE INDEX idx_questions_approved ON product_questions(product_id, is_approved, moderation_status);
CREATE INDEX idx_questions_created ON product_questions(created_at DESC);

CREATE TRIGGER trg_questions_updated
  BEFORE UPDATE ON product_questions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 12. РЕЙТИНГИ ТОВАРОВ
-- =========================================================
CREATE TABLE IF NOT EXISTS product_ratings (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  average_rating NUMERIC DEFAULT 0,
  total_reviews INT DEFAULT 0,
  rating_distribution JSONB DEFAULT '{"5":0,"4":0,"3":0,"2":0,"1":0}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_product_ratings_updated
  BEFORE UPDATE ON product_ratings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 13. ПРОСМОТРЫ ТОВАРОВ
-- =========================================================
CREATE TABLE IF NOT EXISTS product_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id TEXT,
  session_id TEXT NOT NULL DEFAULT '',
  ip_hash TEXT,
  user_agent TEXT,
  referrer TEXT,
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_views_product ON product_views(product_id);
CREATE INDEX idx_views_session ON product_views(session_id);

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

CREATE INDEX idx_wastepaper_status ON wastepaper_requests(status);
CREATE INDEX idx_wastepaper_created ON wastepaper_requests(created_at DESC);

CREATE TRIGGER trg_wastepaper_updated
  BEFORE UPDATE ON wastepaper_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 15. СЧЁТЧИКИ ДОКУМЕНТОВ (для сквозной нумерации)
-- =========================================================
CREATE TABLE IF NOT EXISTS doc_counters (
  key TEXT PRIMARY KEY,
  value INT NOT NULL DEFAULT 0
);

-- Начальные значения
INSERT INTO doc_counters (key, value) VALUES
  ('receipt', 0),
  ('deal', 0),
  ('payment', 0),
  ('salary', 0)
ON CONFLICT DO NOTHING;

-- =========================================================
-- 16. КОНТРАГЕНТЫ
-- =========================================================
CREATE TABLE IF NOT EXISTS counterparties (
  id TEXT PRIMARY KEY,  -- cp_<hash> для совместимости
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

CREATE INDEX idx_counterparties_normalized ON counterparties(normalized_name);

CREATE TRIGGER trg_counterparties_updated
  BEFORE UPDATE ON counterparties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 17. ЦЕНЫ ПОСТАВЩИКОВ
-- =========================================================
CREATE TABLE IF NOT EXISTS supplier_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counterparty_id TEXT NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(counterparty_id, product_id)
);

CREATE INDEX idx_supplier_prices_counterparty ON supplier_prices(counterparty_id);
CREATE INDEX idx_supplier_prices_product ON supplier_prices(product_id);

CREATE TRIGGER trg_supplier_prices_updated
  BEFORE UPDATE ON supplier_prices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 18. ПОСТУПЛЕНИЯ (ПРИХОДНЫЕ ОРДЕРА)
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

CREATE INDEX idx_receipts_number ON warehouse_receipts(number);
CREATE INDEX idx_receipts_status ON warehouse_receipts(status);
CREATE INDEX idx_receipts_date ON warehouse_receipts(date);

CREATE TRIGGER trg_receipts_updated
  BEFORE UPDATE ON warehouse_receipts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 19. ЗАКАЗЫ ПОКУПАТЕЛЕЙ (СКЛАД)
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deals_number ON customer_deals(number);
CREATE INDEX idx_deals_status ON customer_deals(status);
CREATE INDEX idx_deals_date ON customer_deals(date);
CREATE INDEX idx_deals_source_order ON customer_deals(source_order_id);

CREATE TRIGGER trg_deals_updated
  BEFORE UPDATE ON customer_deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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
  exclude_from_balance BOOLEAN DEFAULT FALSE,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_direction ON bank_payments(direction);
CREATE INDEX idx_payments_paid ON bank_payments(is_paid);
CREATE INDEX idx_payments_date ON bank_payments(date);

CREATE TRIGGER trg_payments_updated
  BEFORE UPDATE ON bank_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

CREATE TRIGGER trg_employees_updated
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 22. ЗАРПЛАТЫ
-- =========================================================
CREATE TABLE IF NOT EXISTS salaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
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

CREATE INDEX idx_salaries_employee ON salaries(employee_id);
CREATE INDEX idx_salaries_date ON salaries(date);
CREATE INDEX idx_salaries_paid ON salaries(is_paid);

CREATE TRIGGER trg_salaries_updated
  BEFORE UPDATE ON salaries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- ROW LEVEL SECURITY (RLS) — Защита данных
-- =========================================================

-- Включаем RLS на всех таблицах
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

-- ─── ПУБЛИЧНЫЕ ПОЛИТИКИ (чтение для всех) ────────────────
-- Публичное чтение: категории, товары (видимые), акции, поп-кампании,
-- настройки (публичные), рейтинги, просмотры, отзывы (одобрённые),
-- вопросы (одобрённые), заявки на макулатуру (создание),
-- создание отзывов/вопросов/просмотров

-- Категории — видят все
CREATE POLICY "categories_select_all" ON categories FOR SELECT USING (TRUE);

-- Товары — видимые видят все
CREATE POLICY "products_select_visible" ON products FOR SELECT
  USING (is_visible = TRUE);

-- Настройки — чтение для всех (нет секретов, токены в env)
CREATE POLICY "settings_select_all" ON settings FOR SELECT USING (TRUE);

-- Акции — видимые
CREATE POLICY "promotions_select_visible" ON promotions FOR SELECT
  USING (is_visible = TRUE);

-- Pop-up кампании — активные
CREATE POLICY "popup_campaigns_select_active" ON popup_campaigns FOR SELECT
  USING (is_active = TRUE);

-- Рейтинги товаров — публичное чтение
CREATE POLICY "product_ratings_select_all" ON product_ratings FOR SELECT USING (TRUE);

-- Отзывы — одобрённые видят все
CREATE POLICY "reviews_select_approved" ON product_reviews FOR SELECT
  USING (is_approved = TRUE AND moderation_status = 'approved');

-- Вопросы — одобренные отвеченные
CREATE POLICY "questions_select_approved" ON product_questions FOR SELECT
  USING (is_approved = TRUE AND moderation_status = 'approved');

-- Создание отзывов/вопросов/просмотров — для анонимусов и авторизованных
CREATE POLICY "reviews_insert_any" ON product_reviews FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "questions_insert_any" ON product_questions FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "views_insert_any" ON product_views FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "helpful_votes_insert_any" ON review_helpful_votes FOR INSERT WITH CHECK (TRUE);

-- Заявки на макулатуру — создание
CREATE POLICY "wastepaper_insert_any" ON wastepaper_requests FOR INSERT WITH CHECK (TRUE);

-- Регистрация пользователей
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (TRUE);
-- Пользователь видит свои данные
CREATE POLICY "users_select_own" ON users FOR SELECT
  USING (id = current_setting('app.current_user_id', true));
CREATE POLICY "users_update_own" ON users FOR UPDATE
  USING (id = current_setting('app.current_user_id', true));

-- Заказы — создание для всех
CREATE POLICY "orders_insert_any" ON orders FOR INSERT WITH CHECK (TRUE);
-- Пользователь видит свои заказы
CREATE POLICY "orders_select_own" ON orders FOR SELECT
  USING (
    user_id = current_setting('app.current_user_id', true)
    OR customer_phone_digits = current_setting('app.current_phone_digits', true)
    OR customer_phone = current_setting('app.current_phone_display', true)
  );
CREATE POLICY "orders_update_own" ON orders FOR UPDATE
  USING (
    user_id = current_setting('app.current_user_id', true)
    OR customer_phone_digits = current_setting('app.current_phone_digits', true)
  );

-- ─── АДМИНСКИЕ ПОЛИТИКИ (полный доступ через service_role) ──
-- Все админские операции выполняются через service_role ключ
-- (серверный), поэтому RLS их не ограничивает.
-- Эти политики нужны только для edge cases:

-- Admin full access через auth.jwt() — не используется напрямую,
-- весь admin API работает через service_role.
-- Но на случай если понадобится direct SQL:

CREATE POLICY "admin_categories_all" ON categories FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.uid() IS NOT NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.uid() IS NOT NULL
    )
  );

-- Для всех остальных таблиц — полный доступ через service_role
-- (service_role bypasses RLS by default in Supabase)

-- =========================================================
-- ФУНКЦИЯ: обновление рейтинга товара при изменении отзывов
-- =========================================================
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

  SELECT
    COALESCE(AVG(rating), 0),
    COUNT(*)
  INTO v_avg, v_total
  FROM product_reviews
  WHERE product_id = v_product_id
    AND is_approved = TRUE
    AND moderation_status = 'approved';

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
    AND is_approved = TRUE
    AND moderation_status = 'approved';

  INSERT INTO product_ratings (product_id, average_rating, total_reviews, rating_distribution)
  VALUES (v_product_id, v_avg, v_total, v_dist)
  ON CONFLICT (product_id) DO UPDATE SET
    average_rating = v_avg,
    total_reviews = v_total,
    rating_distribution = v_dist,
    updated_at = NOW();

  UPDATE products SET
    average_rating = v_avg,
    total_reviews = v_total
  WHERE id = v_product_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_reviews_rating_update
  AFTER INSERT OR UPDATE OR DELETE ON product_reviews
  FOR EACH ROW EXECUTE FUNCTION fn_update_product_rating();

-- =========================================================
-- ФУНКЦИЯ: атомарный инкремент счётчика документов
-- =========================================================
CREATE OR REPLACE FUNCTION fn_next_counter(p_key TEXT)
RETURNS INT AS $$
DECLARE
  v_val INT;
BEGIN
  UPDATE doc_counters SET value = value + 1 WHERE key = p_key RETURNING value INTO v_val;
  IF v_val IS NULL THEN
    INSERT INTO doc_counters (key, value) VALUES (p_key, 1) RETURNING value INTO v_val;
  END IF;
  RETURN v_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================
-- ФУНКЦИЯ: обновление view_count при вставке просмотра
-- =========================================================
CREATE OR REPLACE FUNCTION fn_increment_view_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_views_increment
  AFTER INSERT ON product_views
  FOR EACH ROW EXECUTE FUNCTION fn_increment_view_count();
