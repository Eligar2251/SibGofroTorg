-- =========================================================
-- Миграция: переводы между счетами макулатуры (безнал ↔ наличка).
--
-- Перевод — внутреннее движение денег модуля: сумма уходит с одного
-- счёта и приходит на другой, внешний приход/расход не создаётся.
-- В отчётах показывается двумя строками одного перевода: расход по
-- счёту-источнику и приход по счёту-получателю (общий остаток модуля
-- при этом не меняется).
--
-- Применить в Supabase Dashboard → SQL Editor (идемпотентно).
-- =========================================================

CREATE TABLE IF NOT EXISTS wp_account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL DEFAULT 0,               -- порядковый № (Перевод №<n>)
  date DATE NOT NULL,                          -- дата перевода
  from_account TEXT NOT NULL DEFAULT 'bank',   -- cash | bank | third_party
  to_account TEXT NOT NULL DEFAULT 'cash',     -- cash | bank | third_party
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,     -- сумма перевода, ₽
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wp_account_transfers_date
  ON wp_account_transfers(date DESC);

COMMENT ON TABLE wp_account_transfers IS
  'Переводы денег между счетами учёта макулатуры (безнал ↔ наличка ↔ сторонние): внутреннее движение, внешний приход/расход не создаёт';

-- ── RLS: только service_role с сервера (как у остальных wp_*) ──
ALTER TABLE wp_account_transfers ENABLE ROW LEVEL SECURITY;

-- ── Realtime: журнал «Банк» обновляется у всех, кто открыл модуль ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND tablename = 'wp_account_transfers') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_account_transfers';
  END IF;
END $$;

-- ── Счётчик номеров переводов ────────────────────────────
INSERT INTO doc_counters (key, value) VALUES ('wp_account_transfer', 0)
ON CONFLICT (key) DO NOTHING;
