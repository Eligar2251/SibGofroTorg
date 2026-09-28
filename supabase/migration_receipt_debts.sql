-- Долги по расхождениям в поставках.
-- Недопоставка становится долгом поставщика после явного завершения перевозки.
-- Принятый сверх заказа товар сразу формирует долг перед поставщиком;
-- paid_overdelivery_items хранит уже оплаченные количества по товарам.
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS transport_finished_at TIMESTAMPTZ;

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS paid_overdelivery_items JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN warehouse_receipts.transport_finished_at IS
  'Время явного завершения перевозки с недопоставкой; после этого остаток считается долгом поставщика';

COMMENT ON COLUMN warehouse_receipts.paid_overdelivery_items IS
  'Уже оплаченные количества перепоставки: [{productId, paidQty, paidAt}]';
