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
  phone TEXT,
  address TEXT,
  contact_person TEXT,
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
  wastepaper_type TEXT NOT NULL DEFAULT 'cardboard',
  weight_kg NUMERIC NOT NULL DEFAULT 0,
  price_per_kg NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
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
