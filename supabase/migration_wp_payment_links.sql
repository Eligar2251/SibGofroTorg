-- =========================================================
-- Миграция: привязка платежа к документу макулатуры (оплата приёма/продажи).
--
-- Платёж с привязкой — ЕДИНСТВЕННОЕ денежное движение документа:
-- собственное событие документа (по отметке «оплачено») при наличии
-- привязанных платежей не создаётся — деньги не задваиваются. Заголовок
-- платежа в ленте: «Оплата приёма №N» / «Оплата продажи №N». Поля оплаты
-- документа (is_paid, paid_at, account, суммы) синхронизируются с
-- платежами при каждом изменении (один объект правится с обеих сторон).
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

ALTER TABLE wp_payments
  ADD COLUMN IF NOT EXISTS doc_type TEXT;   -- 'intake' | 'shipment' | NULL (свободный платёж)
ALTER TABLE wp_payments
  ADD COLUMN IF NOT EXISTS doc_id TEXT;     -- id приёма / продажи (wp_intakes.id / wp_shipments.id)

CREATE INDEX IF NOT EXISTS idx_wp_payments_doc
  ON wp_payments(doc_type, doc_id)
  WHERE doc_type IS NOT NULL;

COMMENT ON COLUMN wp_payments.doc_type IS
  'Привязка платежа к документу: intake (оплата приёма) | shipment (оплата продажи/сдачи) | NULL — свободный платёж';
COMMENT ON COLUMN wp_payments.doc_id IS
  'id документа (wp_intakes.id / wp_shipments.id); платёж с привязкой — единственное движение денег документа';
