-- =========================================================
-- Миграция: развитие учёта макулатуры.
--
-- 1) Контрагент = одна фирма (например «Детский мир»), у которой
--    может быть НЕСКОЛЬКО филиалов/точек. Каждая точка — связка
--    «адрес + контактное лицо (ФИО) + телефон» (wp_counterparties.branches).
--    Эти данные подставляются в документы и в печать путевого листа.
--
-- 2) Приём и сдача — документы как в 1С: табличная часть из позиций
--    (макулатура разных профилей), у каждой свой вес и цена за кг.
--    Сумма документа = сумма позиций (wp_intakes.items / wp_shipments.items).
--
-- 3) В сдачи добавлен адрес (куда везём) и телефон/контакт точки,
--    в приёмы — телефон/контакт точки (адрес уже был).
--
-- Старые одиночные поля (phone/address/contact_person и
-- wastepaper_type/weight_kg/price_per_kg) НЕ удаляем: они остаются
-- как «зеркало» первой точки / агрегата документа для совместимости.
--
-- Применить в Supabase Dashboard → SQL Editor.
-- =========================================================

-- ── Контрагенты: список точек (филиалов) ─────────────────
ALTER TABLE wp_counterparties
  ADD COLUMN IF NOT EXISTS branches JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Структура элемента branches:
-- {
--   id: string,               -- стабильный id точки
--   label: string,            -- необязательная метка («Филиал №1», «Центральный»)
--   address: string,          -- адрес
--   contactPerson: string,    -- ФИО контактного лица этого адреса
--   phone: string             -- телефон, привязанный к адресу/контакту
-- }

-- Переносим одиночные адрес/телефон/контакт в первую точку,
-- чтобы существующие контрагенты не потеряли данные.
UPDATE wp_counterparties
SET branches = jsonb_build_array(
      jsonb_build_object(
        'id', 'br-legacy',
        'label', '',
        'address', COALESCE(address, ''),
        'contactPerson', COALESCE(contact_person, ''),
        'phone', COALESCE(phone, '')
      )
    )
WHERE (branches IS NULL OR branches = '[]'::jsonb)
  AND (COALESCE(address, '') <> '' OR COALESCE(phone, '') <> '' OR COALESCE(contact_person, '') <> '');

-- ── Приёмы: табличная часть + контакт точки ──────────────
ALTER TABLE wp_intakes
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_person TEXT;

-- Структура элемента items (позиция документа):
-- { id: string, wastepaperType: string, weightKg: number, pricePerKg: number, total: number }

-- Собираем позиции из старых одиночных полей.
UPDATE wp_intakes
SET items = jsonb_build_array(
      jsonb_build_object(
        'id', 'it-legacy',
        'wastepaperType', COALESCE(wastepaper_type, 'cardboard'),
        'weightKg', COALESCE(weight_kg, 0),
        'pricePerKg', COALESCE(price_per_kg, 0),
        'total', COALESCE(total, 0)
      )
    )
WHERE (items IS NULL OR items = '[]'::jsonb)
  AND COALESCE(weight_kg, 0) > 0;

-- ── Сдачи: адрес + табличная часть + контакт точки ───────
ALTER TABLE wp_shipments
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_person TEXT;

UPDATE wp_shipments
SET items = jsonb_build_array(
      jsonb_build_object(
        'id', 'it-legacy',
        'wastepaperType', COALESCE(wastepaper_type, 'cardboard'),
        'weightKg', COALESCE(weight_kg, 0),
        'pricePerKg', COALESCE(price_per_kg, 0),
        'total', COALESCE(total, 0)
      )
    )
WHERE (items IS NULL OR items = '[]'::jsonb)
  AND COALESCE(weight_kg, 0) > 0;
