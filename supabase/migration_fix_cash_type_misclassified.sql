-- =========================================================
-- Миграция: чиним безналичные платежи, ошибочно помеченные как наличные.
--
-- ПРИЧИНА БАГА
-- При импорте платежей из Excel тип определялся регуляркой /нал|cash|касс/.
-- Слово «безнал» / «безналичный» содержит подстроку «нал», поэтому любой
-- безналичный платёж записывался в bank_payments с type = 'cash'.
-- В результате при сдаче кассы туда выводились ВСЕ платежи, включая
-- деньги с расчётного счёта, и касса «списывала» всё подряд.
--
-- Регулярка в коде исправлена (src/lib/excel-io.ts): «безнал» теперь
-- отсекается раньше и даёт type = 'regular'. Эта миграция чинит записи,
-- которые уже успели попасть в базу неправильно.
--
-- ЧТО ДЕЛАЕМ
-- Возвращаем type = 'regular' платежам, которые по комментарию явно
-- безналичные («безнал», «расчётный счёт», «счёт покупателю», «п/п»).
-- Платежи с честным наличным комментарием («оплата наличными») не трогаем.
--
-- ВАЖНО: миграция НЕ трогает платежи, уже вошедшие в сдачу кассы
-- (их id есть в cash_collections.items) — чтобы не расходились
-- исторические отчёты по уже сданным сменам.
--
-- Идемпотентно.
-- =========================================================

-- Подстраховка: смотрим, что именно будет исправлено (для ручной проверки).
-- SELECT id, number, date, counterparty, amount, comment
-- FROM bank_payments
-- WHERE type = 'cash'
--   AND (comment ILIKE '%безнал%' OR comment ILIKE '%счёт покупателю%'
--        OR comment ILIKE '%счет покупателю%' OR comment ILIKE '%расчетный счет%'
--        OR comment ILIKE '%расчётный счёт%' OR comment ILIKE '%п/п%');

UPDATE bank_payments AS bp
SET type = 'regular'
WHERE bp.type = 'cash'
  AND (
    bp.comment ILIKE '%безнал%'
    OR bp.comment ILIKE '%б/нал%'
    OR bp.comment ILIKE '%счёт покупателю%'
    OR bp.comment ILIKE '%счет покупателю%'
    OR bp.comment ILIKE '%расчетный счет%'
    OR bp.comment ILIKE '%расчётный счёт%'
    OR bp.comment ILIKE '%п/п%'
  )
  -- Не трогаем платежи, уже учтённые в сдачах кассы.
  AND NOT EXISTS (
    SELECT 1
    FROM cash_collections cc,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(cc.items) = 'array' THEN cc.items ELSE '[]'::jsonb END
         ) AS item
    WHERE item->>'paymentId' = bp.id::text
  );

COMMENT ON COLUMN bank_payments.type IS
  'regular = безналичный расчётный счёт, cash = наличные в кассу, '
  'transfer = исходящий перевод физлицу, refund = возврат, deposit = внесение. '
  'В сдачу кассы попадают только type = cash.';
