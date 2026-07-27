-- =========================================================
-- Безопасное исправление платежей, ошибочно помеченных наличными.
--
-- КОНТЕКСТ
-- Импорт из Excel определял тип регуляркой /нал|cash|касс/, а слово
-- «безнал» содержит «нал» → безналичные платежи сохранялись как
-- type='cash' и попадали в кассу. Регулярка уже исправлена в коде
-- (src/lib/excel-io.ts). Остаётся починить записи в БД.
--
-- ПОЧЕМУ ПРЕДЫДУЩАЯ ПОПЫТКА СЛОМАЛА БАЛАНС
-- Просто поменять type у платежа НЕЛЬЗЯ, если он уже покрыт сдачей
-- кассы. Старые сдачи хранят items = [] (без привязки к платежам) и
-- вычитают из кассы фиксированную сумму. Убрав приход из кассы, но
-- оставив сдачу, мы загоняем кассу в минус ровно на эту сумму.
--
-- ПРИНЦИП ЭТОГО СКРИПТА
-- Тип меняем ТОЛЬКО у платежей, которые НЕ покрыты сдачами кассы.
-- «Покрытость» считаем честно: по сумме, а не по items, потому что
-- старые сдачи безымянные. Сначала сдачами гасятся самые ранние
-- наличные приходы (FIFO) — это соответствует реальному порядку
-- инкассации. Всё, что попало под сдачи, остаётся 'cash' и требует
-- ручного решения (см. отчёт в конце файла).
--
-- ЗАПУСКАТЬ ПОСЛЕ migration_rollback_cash_type_fix.sql.
-- Идемпотентно. Внутри транзакции.
-- =========================================================

BEGIN;

-- Сколько всего денег уже списано сдачами кассы.
WITH collected AS (
  SELECT COALESCE(SUM(amount), 0) AS total FROM cash_collections
),
-- Наличные приходы по возрастанию даты с накопительным итогом.
cash_income AS (
  SELECT
    bp.id,
    bp.amount,
    bp.comment,
    SUM(bp.amount) OVER (
      ORDER BY bp.date, bp.number, bp.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_total
  FROM bank_payments bp
  WHERE bp.type = 'cash'
    AND bp.direction = 'incoming'
    AND bp.is_paid = TRUE
    AND bp.exclude_from_balance = FALSE
),
-- Платёж считается НЕ покрытым сдачей, если весь его объём лежит
-- выше отметки уже сданных денег.
uncovered AS (
  SELECT ci.id
  FROM cash_income ci, collected c
  WHERE ci.running_total - ci.amount >= c.total
)
UPDATE bank_payments bp
SET type = 'regular'
WHERE bp.id IN (SELECT id FROM uncovered)
  AND (
    bp.comment ILIKE '%безнал%'
    OR bp.comment ILIKE '%б/нал%'
    OR bp.comment ILIKE '%счёт покупателю%'
    OR bp.comment ILIKE '%счет покупателю%'
    OR bp.comment ILIKE '%расчетный счет%'
    OR bp.comment ILIKE '%расчётный счёт%'
    OR bp.comment ILIKE '%п/п%'
  );

COMMIT;

-- =========================================================
-- ПРОВЕРКА ПОСЛЕ ЗАПУСКА (выполнить вручную)
--
-- 1) Остаток кассы. НЕ должен быть отрицательным:
--
-- SELECT
--   COALESCE((SELECT SUM(CASE WHEN direction='incoming' THEN amount ELSE -amount END)
--             FROM bank_payments
--             WHERE type='cash' AND is_paid AND NOT exclude_from_balance), 0)
--   - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source='cash'), 0)
--   - COALESCE((SELECT SUM(amount) FROM cash_collections), 0) AS cash_balance;
--
-- 2) Оставшиеся спорные платежи (помечены наличными, но похожи на
--    безнал, и уже покрыты сдачами кассы). Их скрипт намеренно НЕ
--    трогает: исправлять нужно вместе с корректировкой сдачи, иначе
--    касса уйдёт в минус. В интерфейсе они подсвечены плашкой
--    «похоже на безнал».
--
-- SELECT id, number, date, counterparty, amount, comment
-- FROM bank_payments
-- WHERE type = 'cash' AND direction = 'incoming' AND is_paid
--   AND (comment ILIKE '%безнал%' OR comment ILIKE '%счёт покупателю%'
--        OR comment ILIKE '%счет покупателю%' OR comment ILIKE '%п/п%')
-- ORDER BY date;
-- =========================================================
