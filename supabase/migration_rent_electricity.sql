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
