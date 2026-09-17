-- Реквизиты поставщика макулатуры для выплат по приёмам.
ALTER TABLE wp_counterparties
  ADD COLUMN IF NOT EXISTS payment_details TEXT;
COMMENT ON COLUMN wp_counterparties.payment_details IS 'Куда переводить деньги поставщику: карта, СБП, счёт и т.п.';
