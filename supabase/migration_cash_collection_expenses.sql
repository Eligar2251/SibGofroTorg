-- =========================================================
-- Миграция: детализация сдачи кассы — траты и приход.
--
-- Чтобы в отчёте «Сданная касса» можно было раскрыть смену и увидеть,
-- какие платежи в неё вошли, какие были расходы налом и куда ушли
-- деньги, эти данные сохраняются в самой записи сдачи. Так детализация
-- останется верной, даже если платёж или зарплату потом отредактируют.
--
-- Только ADD COLUMN IF NOT EXISTS — выполнять можно многократно.
-- Существующие данные не меняются: у старых сдач траты пустые, а
-- приходом считается сама сумма сдачи (обрабатывается в коде).
-- =========================================================

-- Наличные траты дня: [{kind:'salary'|'payment', id, title, amount, comment}]
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS expenses JSONB DEFAULT '[]'::jsonb;

-- Приход за день ДО вычета трат
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS income_amount NUMERIC;

-- Сумма трат налом, вычтенная из прихода
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS expenses_amount NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN cash_collections.expenses IS
  'Траты налом за день: [{kind, id, title, amount, comment}]. kind = salary|payment.';
COMMENT ON COLUMN cash_collections.income_amount IS
  'Приход наличными за день до вычета трат. NULL у старых записей.';
COMMENT ON COLUMN cash_collections.expenses_amount IS
  'Сумма наличных трат, вычтенная из прихода при сдаче.';
