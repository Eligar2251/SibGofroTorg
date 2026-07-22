-- =========================================================
-- SUPABASE SCHEMA (Free Tier) — Backup / Parallel DB
-- Для сайта SibGofroTorg, работает вместе с Firestore.
-- Без Buckets / Functions — только Database + RLS.
-- =========================================================

-- Включаем расширение UUID (обычно уже включено в Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================
-- Администраторы (для RLS-политик записи)
-- =========================================================
CREATE TABLE IF NOT EXISTS admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins see own" ON admins FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins insert own" ON admins FOR INSERT WITH CHECK (user_id = auth.uid());

-- =========================================================
-- Категории (public read / admin write)
-- =========================================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT 'box',
  description TEXT,
  sort_order INT DEFAULT 0,
  is_visible BOOLEAN DEFAULT TRUE,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Categories public read" ON categories FOR SELECT USING (TRUE); -- читают все
CREATE POLICY "Categories admin insert" ON categories FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Categories admin update" ON categories FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Categories admin delete" ON categories FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- =========================================================
-- Товары (public read / admin write)
-- =========================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  sku TEXT,
  description TEXT,
  price NUMERIC(14, 2),
  price_wholesale NUMERIC(14, 2),
  min_wholesale_qty INT DEFAULT 1,
  dimension_length NUMERIC(10, 2),
  dimension_width NUMERIC(10, 2),
  dimension_height NUMERIC(10, 2),
  dimension_unit TEXT DEFAULT 'мм',
  weight NUMERIC(10, 3),
  material TEXT,
  pack_qty INT,
  volume NUMERIC(10, 3),
  note TEXT,
  in_stock BOOLEAN DEFAULT TRUE,
  stock_qty INT DEFAULT 0,
  stock_warn_qty INT DEFAULT 5,
  is_promo BOOLEAN DEFAULT FALSE,
  promo_label TEXT,
  made_to_order BOOLEAN DEFAULT FALSE,
  discount_type TEXT CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC(10, 2),
  discount_badge TEXT,
  is_visible BOOLEAN DEFAULT TRUE,
  is_featured BOOLEAN DEFAULT FALSE,
  image_url TEXT,
  images JSONB DEFAULT '[]'::jsonb,
  view_count INT DEFAULT 0,
  average_rating NUMERIC(3, 1) DEFAULT 0,
  total_reviews INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Products public read visible" ON products FOR SELECT USING (is_visible = TRUE);
CREATE POLICY "Products admin insert" ON products FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Products admin update" ON products FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Products admin delete" ON products FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- =========================================================
-- Заказы (user reads own / admin reads all / auth insert)
-- =========================================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT DEFAULT 'order' CHECK (type IN ('order', 'inquiry')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_type TEXT DEFAULT 'individual' CHECK (customer_type IN ('individual', 'legal')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_phone_digits TEXT,
  customer_email TEXT,
  communication_channel TEXT DEFAULT 'telegram',
  payment_method TEXT DEFAULT 'transfer',
  items JSONB DEFAULT '[]'::jsonb,
  total_sum NUMERIC(14, 2),
  product_info TEXT,
  quantity INT DEFAULT 1,
  comment TEXT,
  channel TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'completed', 'rejected')),
  close_reason TEXT,
  deal_id UUID,
  deal_number INT,
  payment_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Orders user read own" ON orders FOR SELECT USING (
  user_id = auth.uid() OR EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Orders auth insert" ON orders FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Orders admin update" ON orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Orders admin delete" ON orders FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- =========================================================
-- Акции / Промо (public read / admin write)
-- =========================================================
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  subtitle TEXT,
  badge TEXT,
  image_url TEXT,
  link_type TEXT DEFAULT 'none' CHECK (link_type IN ('product', 'url', 'none')),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  link_url TEXT,
  sort_order INT DEFAULT 0,
  is_visible BOOLEAN DEFAULT TRUE,
  icon TEXT,
  color TEXT,
  light TEXT,
  deadline TEXT,
  is_popup BOOLEAN DEFAULT FALSE,
  popup_start_at TIMESTAMPTZ,
  popup_delay_seconds INT DEFAULT 0,
  popup_duration_seconds INT DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Promotions public read" ON promotions FOR SELECT USING (is_visible = TRUE);
CREATE POLICY "Promotions admin insert" ON promotions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Promotions admin update" ON promotions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Promotions admin delete" ON promotions FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- =========================================================
-- Попап-кампании (public read / admin write)
-- =========================================================
CREATE TABLE IF NOT EXISTS popup_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT DEFAULT 'banner' CHECK (type IN ('banner', 'story')),
  title TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  kicker TEXT,
  description TEXT,
  details JSONB DEFAULT '[]'::jsonb,
  button_text TEXT,
  button_url TEXT,
  style TEXT DEFAULT 'info' CHECK (style IN ('info', 'promo', 'important')),
  image_url TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  delay_seconds INT DEFAULT 5,
  duration_seconds INT DEFAULT 20,
  frequency TEXT DEFAULT 'session' CHECK (frequency IN ('session', 'day', 'always')),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE popup_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Popup campaigns public read" ON popup_campaigns FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Popup campaigns admin insert" ON popup_campaigns FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Popup campaigns admin update" ON popup_campaigns FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Popup campaigns admin delete" ON popup_campaigns FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- =========================================================
-- Отзывы о товарах (public approved / auth insert / admin write)
-- =========================================================
CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  user_avatar TEXT,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  title TEXT,
  text TEXT NOT NULL,
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
ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reviews public approved" ON product_reviews FOR SELECT USING (is_approved = TRUE AND moderation_status = 'approved');
CREATE POLICY "Reviews auth insert" ON product_reviews FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Reviews admin update" ON product_reviews FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Reviews admin delete" ON product_reviews FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Reviews user update own" ON product_reviews FOR UPDATE USING (
  user_id = auth.uid() AND EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid()) = FALSE
) WITH CHECK (user_id = auth.uid());

-- =========================================================
-- Вопросы о товарах (public approved / auth insert / admin write)
-- =========================================================
CREATE TABLE IF NOT EXISTS product_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  user_avatar TEXT,
  question TEXT NOT NULL,
  answer TEXT,
  answer_author TEXT CHECK (answer_author IN ('seller', 'admin', 'user')),
  answered_at TIMESTAMPTZ,
  is_answered BOOLEAN DEFAULT FALSE,
  helpful_count INT DEFAULT 0,
  is_approved BOOLEAN DEFAULT FALSE,
  moderation_status TEXT DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  moderation_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE product_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Questions public approved" ON product_questions FOR SELECT USING (is_approved = TRUE AND moderation_status = 'approved');
CREATE POLICY "Questions auth insert" ON product_questions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Questions admin update" ON product_questions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Questions admin delete" ON product_questions FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- =========================================================
-- Рейтинги товаров (public read / admin update — рассчитано)
-- =========================================================
CREATE TABLE IF NOT EXISTS product_ratings (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  average_rating NUMERIC(3, 1) DEFAULT 0,
  total_reviews INT DEFAULT 0,
  rating_distribution JSONB DEFAULT '{"5":0,"4":0,"3":0,"2":0,"1":0}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE product_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ratings public read" ON product_ratings FOR SELECT USING (TRUE);
CREATE POLICY "Ratings admin insert" ON product_ratings FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Ratings admin update" ON product_ratings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Ratings admin delete" ON product_ratings FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- =========================================================
-- Просмотры товаров (auth insert / admin read)
-- =========================================================
CREATE TABLE IF NOT EXISTS product_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  referrer TEXT,
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE product_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Views auth insert" ON product_views FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Views admin select" ON product_views FOR SELECT USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Views admin delete" ON product_views FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- =========================================================
-- Настройки сайта (public read / admin write)
-- =========================================================
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY DEFAULT 'main',
  content JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Settings public read" ON settings FOR SELECT USING (TRUE);
CREATE POLICY "Settings admin insert" ON settings FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Settings admin update" ON settings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Settings admin delete" ON settings FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- =========================================================
-- Заявки на приём макулатуры (auth insert / admin read-write)
-- =========================================================
CREATE TABLE IF NOT EXISTS wastepaper_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  wastepaper_type TEXT,
  weight NUMERIC(10, 2),
  delivery_method TEXT,
  estimated_payout NUMERIC(14, 2),
  comment TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'completed', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE wastepaper_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Wastepaper auth insert" ON wastepaper_requests FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Wastepaper admin select" ON wastepaper_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Wastepaper admin update" ON wastepaper_requests FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Wastepaper admin delete" ON wastepaper_requests FOR DELETE USING (
  EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);
CREATE POLICY "Wastepaper user read own" ON wastepaper_requests FOR SELECT USING (
  user_id = auth.uid() OR EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- =========================================================
-- Индексы для производительности (бесплатный тариф поддерживает)
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_visible ON products(is_visible);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_approved ON product_reviews(is_approved, moderation_status);
CREATE INDEX IF NOT EXISTS idx_questions_product ON product_questions(product_id);
CREATE INDEX IF NOT EXISTS idx_questions_approved ON product_questions(is_approved, moderation_status);
CREATE INDEX IF NOT EXISTS idx_popups_active ON popup_campaigns(is_active);
CREATE INDEX IF NOT EXISTS idx_promotions_visible ON promotions(is_visible);
CREATE INDEX IF NOT EXISTS idx_views_product ON product_views(product_id);
CREATE INDEX IF NOT EXISTS idx_wastepaper_status ON wastepaper_requests(status);

-- =========================================================
-- Триггер для авто-обновления updated_at
-- =========================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name IN (
        'categories','products','orders','promotions','popup_campaigns',
        'product_reviews','product_questions','product_ratings','product_views',
        'settings','wastepaper_requests'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON %I', tbl);
    EXECUTE format('CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl);
  END LOOP;
END $$;
