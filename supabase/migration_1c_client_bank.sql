-- Миграция для поддержки выгрузки платёжек в формате 1CClientBankExchange (Альфа-Банк).
-- Добавляет:
--   1. Город банка у контрагентов (bank_city) и у поступлений (bank_city).
--   2. Поля платёжного поручения в bank_payments:
--      payment_purpose  — назначение платежа (НазначениеПлатежа1).
--      payment_priority — очерёдность платежа (по умолч. 5).
--      payment_kind     — вид платежа (по умолч. "01" = электронно).
--      exported_at      — дата выгрузки в 1С (чтобы не экспортировать повторно).
-- Колонки добавляются безопасно: IF NOT EXISTS.

ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS bank_city TEXT;

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS bank_account TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_city TEXT,
  ADD COLUMN IF NOT EXISTS bik TEXT,
  ADD COLUMN IF NOT EXISTS correspondent_account TEXT,
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS invoice_date TEXT;

ALTER TABLE bank_payments
  ADD COLUMN IF NOT EXISTS payment_purpose TEXT,
  ADD COLUMN IF NOT EXISTS payment_priority INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS payment_kind TEXT DEFAULT '01',
  ADD COLUMN IF NOT EXISTS exported_at TEXT;

-- Настройки нашей компании для выгрузки (реквизиты плательщика).
-- Используем существующую таблицу settings (key-value), дополнительной таблицы не нужно.
