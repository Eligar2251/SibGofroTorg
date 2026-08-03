ALTER TABLE bank_payments ADD COLUMN IF NOT EXISTS cash_destination TEXT CHECK (cash_destination IN ('cash', 'card'));
