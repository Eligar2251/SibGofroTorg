-- =========================================================
-- Миграция: склад макулатуры — продажа «без списания» и ручная
-- правка остатка.
--
-- 1) wp_shipments.skip_stock
--    Пометка на сдаче (продаже): деньги проводим как обычно, а остаток
--    на площадке НЕ уменьшаем. Нужно, когда макулатура уехала не с нашей
--    площадки (например, перегруз напрямую от клиента на предприятие) —
--    в склад она не приходила, значит и списывать с него нечего.
--
-- 2) wp_stock_adjustments
--    Ручная корректировка остатка по виду макулатуры (вкладка «Склад»):
--    макулатурщик вписывает фактическое количество и жмёт «Сохранить».
--    Храним РАЗНИЦУ с расчётным остатком (принято − продано), поэтому
--    новые приёмы и продажи продолжают двигать склад поверх правки.
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

-- ── Продажа без списания со склада ──────────────────────
ALTER TABLE wp_shipments
  ADD COLUMN IF NOT EXISTS skip_stock BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_wp_shipments_skip_stock
  ON wp_shipments(skip_stock)
  WHERE skip_stock = TRUE;

COMMENT ON COLUMN wp_shipments.skip_stock IS
  'TRUE — деньги по сдаче проводим, а остаток макулатуры на площадке не уменьшаем (груз ушёл не с нашей площадки)';

-- ── Ручная корректировка остатка по видам ───────────────
CREATE TABLE IF NOT EXISTS wp_stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wastepaper_type TEXT NOT NULL,               -- ключ вида (wp_products.code/id или старое имя)
  delta_kg NUMERIC(12,3) NOT NULL DEFAULT 0,   -- разница с расчётным остатком, кг (+/−)
  note TEXT,                                   -- почему правили (необязательно)
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wp_stock_adjustments_type
  ON wp_stock_adjustments(wastepaper_type);

COMMENT ON TABLE wp_stock_adjustments IS
  'Ручная правка остатка макулатуры на складе: разница между фактическим количеством и расчётом (принято − продано)';

-- ── RLS: только service_role с сервера (как у остальных wp_*) ──
ALTER TABLE wp_stock_adjustments ENABLE ROW LEVEL SECURITY;

-- ── Realtime: вкладка «Склад» обновляется у всех, кто открыл модуль ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND tablename = 'wp_stock_adjustments') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_stock_adjustments';
  END IF;
END $$;
