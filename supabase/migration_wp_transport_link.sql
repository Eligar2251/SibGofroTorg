-- =========================================================
-- Миграция: связь приёмов/сдач макулатуры с ЕДИНЫМИ перевозками
-- (таблица transports из товарного учёта).
--
-- Что меняется:
--   • wp_intakes / wp_shipments получают флаг needs_transport:
--     TRUE  — документ нужно везти перевозкой (приём = «забор груза»,
--             сдача = «сдача груза»), он попадает в очередь «Ожидают
--             формирования» и далее в путевой лист — по той же логике,
--             что доставка заказов учёта (ЗК);
--     FALSE — клиент привозит/забирает сам, перевозка не нужна.
--   • transport_planned_date — желаемая дата вывоза (необязательно,
--     подсказка диспетчеру при формировании рейса).
--
-- Отдельные перевозки макулатуры (wp_transports, ТМ-...) больше не
-- используются интерфейсом: вкладка «Перевозки» в модуле макулатуры
-- показывает те же перевозки учёта (ПЕР-...), что и раздел «Доставки».
-- Таблица wp_transports НЕ удаляется — старые рейсы остаются в БД.
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

-- ── Приём макулатуры ─────────────────────────────────────
ALTER TABLE wp_intakes
  ADD COLUMN IF NOT EXISTS needs_transport BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE wp_intakes
  ADD COLUMN IF NOT EXISTS transport_planned_date DATE;

CREATE INDEX IF NOT EXISTS idx_wp_intakes_needs_transport
  ON wp_intakes(needs_transport)
  WHERE needs_transport = TRUE;

COMMENT ON COLUMN wp_intakes.needs_transport IS
  'TRUE — приём нужно забрать перевозкой (попадает в очередь перевозок учёта и в путевой лист как «забор груза»); FALSE — клиент привозит сам';

-- ── Сдача макулатуры на предприятие ──────────────────────
ALTER TABLE wp_shipments
  ADD COLUMN IF NOT EXISTS needs_transport BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE wp_shipments
  ADD COLUMN IF NOT EXISTS transport_planned_date DATE;

CREATE INDEX IF NOT EXISTS idx_wp_shipments_needs_transport
  ON wp_shipments(needs_transport)
  WHERE needs_transport = TRUE;

COMMENT ON COLUMN wp_shipments.needs_transport IS
  'TRUE — сдачу нужно отвезти перевозкой (попадает в очередь перевозок учёта и в путевой лист как «сдача груза»); FALSE — без нашей перевозки';
