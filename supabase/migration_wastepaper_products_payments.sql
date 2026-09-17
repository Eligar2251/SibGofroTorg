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
