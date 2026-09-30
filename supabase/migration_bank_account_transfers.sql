-- =========================================================
-- Внутренние переводы между четырьмя денежными счетами компании.
-- Перевод не является доходом или расходом: он только меняет
-- распределение денег между наличными, р/с и двумя картами.
-- =========================================================

CREATE TABLE IF NOT EXISTS bank_account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  from_account TEXT NOT NULL CHECK (from_account IN ('cash', 'bank', 'ym_card', 'vm_card')),
  to_account TEXT NOT NULL CHECK (to_account IN ('cash', 'bank', 'ym_card', 'vm_card')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT bank_account_transfers_different_accounts CHECK (from_account <> to_account)
);

CREATE INDEX IF NOT EXISTS idx_bank_account_transfers_date
  ON bank_account_transfers(date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_account_transfers_accounts
  ON bank_account_transfers(from_account, to_account);

DROP TRIGGER IF EXISTS trg_bank_account_transfers_updated ON bank_account_transfers;
CREATE TRIGGER trg_bank_account_transfers_updated
  BEFORE UPDATE ON bank_account_transfers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bank_account_transfers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND tablename = 'bank_account_transfers'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE bank_account_transfers';
  END IF;
END $$;

INSERT INTO doc_counters (key, value)
VALUES ('bank_account_transfer', 0)
ON CONFLICT (key) DO NOTHING;
