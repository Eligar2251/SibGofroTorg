-- =========================================================
-- МИГРАЦИЯ: Архивные (импортированные) заказы + прогноз выручки
-- =========================================================
-- Что делает:
--  1. customer_deals.is_archive — пометка «архивный заказ» для массовой
--     загрузки старых проведённых заказов контрагентов (вне складского
--     учёта: склад и банк не затрагиваются, суммы попадают в отчёты и
--     в автоматический прогноз выручки).
--  2. customer_deals.archive_note — произвольный комментарий к партии
--     импорта (необязательно).
--
-- Применить в SQL Editor Supabase: supabase/migration_deal_archive_forecast.sql
-- =========================================================

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS is_archive BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE customer_deals
  ADD COLUMN IF NOT EXISTS archive_note TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_is_archive
  ON customer_deals(is_archive);

COMMENT ON COLUMN customer_deals.is_archive IS
  'Архивный заказ из массовой загрузки: старые проведённые заказы вне складского учёта (склад/банк не затрагиваются).';
