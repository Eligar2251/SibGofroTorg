-- =========================================================
-- Миграция: связь ПОСТАВОК (приходных ордеров warehouse_receipts)
-- с ЕДИНЫМИ перевозками учёта (таблица transports).
--
-- Логика та же, что у макулатуры (migration_wp_transport_link.sql):
--   • needs_transport:
--     TRUE  — товар по поставке нужно ЗАБРАТЬ у поставщика нашим
--             транспортом («Заберём сами»). Поставка попадает в очередь
--             «Ожидают формирования» в разделе «Доставки» и далее в
--             путевой лист как «забор груза»;
--     FALSE — самопривоз: поставщик привозит товар сам, перевозка не нужна.
--   • transport_planned_date — желаемая дата забора (необязательно,
--     подсказка диспетчеру при формировании рейса).
--
-- При завершении перевозки такая поставка принимается на склад:
-- фактическое количество вводится руками (можно меньше) — остаток
-- остаётся в поставке как «остаток по приёмке» (частичная приёмка
-- warehouse_receipts.received_items, см. migration_partial_receipts.sql).
--
-- Адрес/контакт/телефон забора берём из самого приходного ордера
-- (колонки address / contact_name / phone уже есть в warehouse_receipts).
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS needs_transport BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS transport_planned_date DATE;

CREATE INDEX IF NOT EXISTS idx_receipts_needs_transport
  ON warehouse_receipts(needs_transport)
  WHERE needs_transport = TRUE;

COMMENT ON COLUMN warehouse_receipts.needs_transport IS
  'TRUE — товар по поставке забираем нашим транспортом (очередь перевозок учёта, «забор груза»); FALSE — самопривоз поставщика';

COMMENT ON COLUMN warehouse_receipts.transport_planned_date IS
  'Желаемая дата забора поставки нашим транспортом (подсказка диспетчеру)';
