-- Товар поставщика на реализации: поставка создаёт отслеживаемую партию.
ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS is_consignment BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN warehouse_receipts.is_consignment IS
  'Товар поставлен на реализацию: продажи отслеживаются по закупочной цене поставщика.';
