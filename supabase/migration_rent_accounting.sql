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
