-- Справочник видов макулатуры (wp_products) становится единственным
-- источником видов для документов модуля «Учёт макулатура».
--
-- Раньше формы приёмок/отгрузок использовали зашитый в код список из
-- четырёх видов (cardboard / office_paper / books / mix), поэтому правки
-- справочника ни на что не влияли. Теперь документ хранит «ключ вида»:
--   • для четырёх исходных видов — их старый код (чтобы прежние документы
--     и тарифы калькулятора сайта продолжали работать),
--   • для новых видов — UUID строки справочника.
--
-- Миграция добавляет колонку code и проставляет коды исходным видам по
-- их названиям. Если каких-то из исходных видов уже нет — они добавляются
-- заново (скрытыми не помечаются: пользователь сам решает, что скрыть).
ALTER TABLE wp_products ADD COLUMN IF NOT EXISTS code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wp_products_code_unique
  ON wp_products(code) WHERE code IS NOT NULL;

UPDATE wp_products SET code = 'cardboard'
  WHERE code IS NULL AND name = 'Гофрокартон';
UPDATE wp_products SET code = 'office_paper'
  WHERE code IS NULL AND name = 'Белая бумага (архив)';
UPDATE wp_products SET code = 'books'
  WHERE code IS NULL AND name = 'Книги, журналы, газеты';
UPDATE wp_products SET code = 'mix'
  WHERE code IS NULL AND name = 'Смешанная макулатура';

INSERT INTO wp_products (name, price_per_kg, code)
SELECT v.name, 0, v.code
FROM (VALUES
  ('Гофрокартон', 'cardboard'),
  ('Белая бумага (архив)', 'office_paper'),
  ('Книги, журналы, газеты', 'books'),
  ('Смешанная макулатура', 'mix')
) AS v(name, code)
WHERE NOT EXISTS (SELECT 1 FROM wp_products p WHERE p.code = v.code)
  AND NOT EXISTS (SELECT 1 FROM wp_products p WHERE p.name = v.name);
