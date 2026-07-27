-- =========================================================
-- Миграция: сдача кассы = только наличные платежи + направление сдачи.
--
-- Что изменилось по смыслу:
--   • В сдачу кассы попадают ТОЛЬКО наличные поступления (bank_payments
--     с type = 'cash', direction = 'incoming', is_paid = true). Основной
--     безналичный расчётный счёт к кассе не относится и не затрагивается.
--   • Разметка платежа теперь означает НАПРАВЛЕНИЕ сдачи, а не способ
--     поступления денег:
--       - 'card' — инкассация на карту (получатель настраивается в
--                  настройках, по умолчанию «Юлия Марковна»);
--       - 'cash' — наличные (виртуальная карта, куда уходит сданная касса).
--   • Колонка transfer_amount исторически хранит сумму, ушедшую на карту.
--
-- Идемпотентно.
-- =========================================================

-- Старое значение kind = 'transfer' переименовано в 'card'.
UPDATE cash_collections
SET items = (
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN item->>'kind' = 'transfer' THEN jsonb_set(item, '{kind}', '"card"'::jsonb)
        ELSE item
      END
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(cash_collections.items) AS item
)
WHERE items IS NOT NULL
  AND jsonb_typeof(items) = 'array'
  AND items @> '[{"kind": "transfer"}]'::jsonb;

COMMENT ON COLUMN cash_collections.cash_amount IS
  'Часть сданной кассы, оставшаяся наличными (виртуальная карта «наличка»).';
COMMENT ON COLUMN cash_collections.transfer_amount IS
  'Часть сданной кассы, ушедшая инкассацией на карту (не расчётный счёт).';
COMMENT ON COLUMN cash_collections.items IS
  'Разметка сдачи: [{paymentId, number, counterparty, amount, kind}], kind = card|cash.';

-- Получатель инкассации на карту (показывается при сдаче кассы).
INSERT INTO settings (key, value)
VALUES ('cash_collection_card_holder', 'Юлия Марковна')
ON CONFLICT (key) DO NOTHING;
