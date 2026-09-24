-- =========================================================
-- Карта В.М. — вторая карта учёта (отдельный денежный счёт)
-- =========================================================
-- Карта ЮМ остаётся как есть: на неё попадают только деньги,
-- переведённые именно на ЮМ. Карта В.М. устроена так же, но
-- считается отдельно.
--
-- Деньги на карте В.М. живут в bank_payments.type = 'vm_card'
-- и в зарплатах как тег комментария [Карта В.М.] (source='bank')
-- — то есть новых таблиц не нужно. Здесь добавляется только
-- расшифровка сдачи кассы: сколько из поступлений смены ушло
-- на вторую карту.
--
-- Применять после migration_cash_collection_split.sql.
-- =========================================================

-- Сколько из поступлений смены отмечено на карте В.М.
-- Это метка, а не новое движение денег (как transfer_amount для ЮМ).
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS vm_transfer_amount NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN cash_collections.vm_transfer_amount IS
  'Поступления смены, отмеченные на карте В.М. Метка, а не движение денег.';

-- Типы платежей и зарплат хранятся текстом (без CHECK-ограничения),
-- поэтому значения 'vm_card' доступны сразу после деплоя кода:
--  · bank_payments.type = 'vm_card' — поступление/расход по второй карте;
--  · salaries.source остаётся 'bank', карта определяется тегом [Карта В.М.]
--    (CHECK-ограничение salaries.source трогать не нужно).

-- Разметка сдачи кассы умеет третью кассу — вторую карту.
ALTER TABLE bank_payments DROP CONSTRAINT IF EXISTS bank_payments_cash_destination_check;
ALTER TABLE bank_payments
  ADD CONSTRAINT bank_payments_cash_destination_check
  CHECK (cash_destination IN ('cash', 'card', 'vm_card'));
