-- =========================================================
-- Миграция: разделение сданной кассы на наличные и перевод.
--
-- В кассе лежат деньги двух видов: физическая наличка и переводы
-- (на карту/СБП). Оба вида НЕ относятся к основному безналичному
-- банковскому счёту, поэтому учитываются здесь, а не в bankBalance.
--
-- При сдаче кассы теперь фиксируется, сколько ушло наличными, а
-- сколько переводом, плюс поимённая разметка платежей.
-- Идемпотентно.
-- =========================================================

ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS cash_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS transfer_amount NUMERIC NOT NULL DEFAULT 0;

-- items: [{paymentId, number, counterparty, amount, kind: 'cash'|'transfer'}]
-- Разметка платежей, вошедших в эту сдачу.
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;

-- Старые сдачи (до появления разделения) считаем полностью наличными:
-- тогда переводы отдельно не учитывались.
UPDATE cash_collections
SET cash_amount = amount
WHERE cash_amount = 0
  AND transfer_amount = 0
  AND amount <> 0;

COMMENT ON COLUMN cash_collections.cash_amount IS
  'Часть сданной кассы, полученная наличными.';
COMMENT ON COLUMN cash_collections.transfer_amount IS
  'Часть сданной кассы, полученная переводом (не основной банковский счёт).';
COMMENT ON COLUMN cash_collections.items IS
  'Разметка платежей сдачи: [{paymentId, number, counterparty, amount, kind}].';
