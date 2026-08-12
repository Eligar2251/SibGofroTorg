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
