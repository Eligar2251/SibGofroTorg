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
