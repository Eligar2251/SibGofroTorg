-- Миграция: явная пометка платежей «вне баланса».
-- Такие платежи закрывают связанный документ (заказ/поступление),
-- но не попадают в текущий банковский/кассовый баланс и не создают
-- срочные уведомления о неоплате.

ALTER TABLE bank_payments
  ADD COLUMN IF NOT EXISTS exclude_from_balance BOOLEAN DEFAULT FALSE;

UPDATE bank_payments
SET exclude_from_balance = FALSE
WHERE exclude_from_balance IS NULL;

ALTER TABLE bank_payments
  ALTER COLUMN exclude_from_balance SET DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_payments_exclude_from_balance
  ON bank_payments(exclude_from_balance);

COMMENT ON COLUMN bank_payments.exclude_from_balance IS
  'TRUE = платеж закрывает документ, но не влияет на текущий банк/кассу (архив/старый учет).';
