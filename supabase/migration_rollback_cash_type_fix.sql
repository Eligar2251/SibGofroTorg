-- =========================================================
-- ОТКАТ ошибочной миграции migration_fix_cash_type_misclassified.sql
--
-- ЧТО СЛОМАЛОСЬ
-- Та миграция переводила платежи type='cash' → 'regular' по комментарию.
-- Защита «не трогать платежи, уже вошедшие в сдачу кассы» искала их в
-- cash_collections.items. Но СТАРЫЕ сдачи (сделанные до разметки) хранят
-- items = [] — там только итоговая сумма без привязки к платежам.
-- Поэтому защита не сработала: платежи, реально покрытые старой сдачей,
-- были переведены в безнал.
--
-- Итог: приход ушёл на расчётный счёт (+сумма), а сдача продолжила
-- вычитать ту же сумму из кассы → касса ушла в минус на ту же величину.
--
-- ЭТОТ СКРИПТ возвращает type='cash' платежам, которые были задеты.
-- Запускать ДО каких-либо новых исправлений типов.
-- Идемпотентно.
-- =========================================================

BEGIN;

-- 1. Смотрим масштаб: сколько наличных приходов и на какую сумму
--    покрывают сдачи кассы. Для ручной сверки перед откатом.
--
-- SELECT
--   (SELECT COALESCE(SUM(amount), 0) FROM cash_collections)          AS collected_total,
--   (SELECT COALESCE(SUM(amount), 0) FROM bank_payments
--     WHERE type = 'cash' AND direction = 'incoming'
--       AND is_paid AND NOT exclude_from_balance)                    AS cash_income_total;

-- 2. Возвращаем 'cash' платежам, которые миграция перевела в 'regular'.
--    Ориентируемся на тот же набор признаков, что использовала
--    сломанная миграция, но ограничиваемся строго входящими платежами
--    (исходящие безналичные она и так не трогала бы осмысленно).
UPDATE bank_payments
SET type = 'cash'
WHERE type = 'regular'
  AND direction = 'incoming'
  AND is_paid = TRUE
  AND (
    comment ILIKE '%безнал%'
    OR comment ILIKE '%б/нал%'
    OR comment ILIKE '%счёт покупателю%'
    OR comment ILIKE '%счет покупателю%'
    OR comment ILIKE '%расчетный счет%'
    OR comment ILIKE '%расчётный счёт%'
    OR comment ILIKE '%п/п%'
  )
  -- Только те, что были изменены недавно (миграцией), а не руками ранее.
  -- trg_payments_updated проставляет updated_at при каждом UPDATE.
  AND updated_at > NOW() - INTERVAL '7 days';

-- 3. Проверка: касса не должна быть отрицательной.
--    Ожидаемый остаток кассы = наличные приходы − наличные расходы
--    − наличные зарплаты − сданная касса.
--
-- SELECT
--   COALESCE((SELECT SUM(CASE WHEN direction='incoming' THEN amount ELSE -amount END)
--             FROM bank_payments
--             WHERE type='cash' AND is_paid AND NOT exclude_from_balance), 0)
--   - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source='cash'), 0)
--   - COALESCE((SELECT SUM(amount) FROM cash_collections), 0) AS cash_balance;

COMMIT;
