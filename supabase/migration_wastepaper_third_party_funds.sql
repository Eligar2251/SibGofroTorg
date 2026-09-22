-- Сторонние пополнения: отдельный денежный контур (карты/источники могут быть разными).
ALTER TABLE wp_payments DROP CONSTRAINT IF EXISTS wp_payments_account_check;
ALTER TABLE wp_payments ADD CONSTRAINT wp_payments_account_check CHECK (account IN ('cash','bank','third_party'));
