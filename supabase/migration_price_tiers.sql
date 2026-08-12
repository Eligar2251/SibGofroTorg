-- Миграция: варианты цен (ценовые уровни) контрагентов.
-- regular   — обычная цена (как в карточке товара), у всех по умолчанию;
-- special   — спеццена: скидка от цены продажи (процент в настройках,
--             price_tier_special_discount, по умолчанию 5%);
-- exclusive — эксклюзивная цена: скидка больше (price_tier_exclusive_discount,
--             по умолчанию 10%).
-- Скидка применяется автоматически при оформлении заказа (Учёт → Заказы):
-- цена товара подставляется уже со скидкой уровня контрагента.

ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS price_tier TEXT NOT NULL DEFAULT 'regular';

COMMENT ON COLUMN counterparties.price_tier IS
  'Вариант цены: regular (обычная) / special (спеццена, скидка %) / exclusive (эксклюзив, скидка % больше). Проценты скидок — в настройках (price_tier_special_discount, price_tier_exclusive_discount).';

CREATE INDEX IF NOT EXISTS idx_counterparties_price_tier
  ON counterparties(price_tier) WHERE price_tier <> 'regular';
