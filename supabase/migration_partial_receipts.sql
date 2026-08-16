-- Частичная приёмка поставок.
-- Храним накопительно фактически принятое количество по каждой позиции.
-- Идемпотентно: можно выполнять повторно.

ALTER TABLE warehouse_receipts
  ADD COLUMN IF NOT EXISTS received_items JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Старые проведённые поступления уже полностью попали на склад. Заполняем
-- для них received_items полным составом, чтобы новый код не принял их снова.
UPDATE warehouse_receipts AS receipt
SET received_items = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'productId', item->>'productId',
        'name', COALESCE(item->>'name', ''),
        'receivedQty', COALESCE((item->>'quantity')::numeric, 0)
      )
    )
    FROM jsonb_array_elements(COALESCE(receipt.items, '[]'::jsonb)) AS item
  ),
  '[]'::jsonb
)
WHERE receipt.status = 'posted'
  AND COALESCE(receipt.received_items, '[]'::jsonb) = '[]'::jsonb;

COMMENT ON COLUMN warehouse_receipts.received_items IS
  'Накопительно принято на склад: [{productId, name, receivedQty}].';
