-- =========================================================
-- ВОССТАНОВЛЕНИЕ КАССЫ И БАНКА
--
-- Выполнять В SQL Editor Supabase по шагам, СВЕРХУ ВНИЗ.
-- Ничего не меняет в структуре таблиц — только данные.
-- Никаких ALTER TABLE, поэтому ошибок «уже существует» не будет.
--
-- ЧТО ПРОИЗОШЛО
-- Мой предыдущий скрипт (migration_rollback_cash_type_fix.sql) искал
-- платежи по комментарию, в том числе по «счёт покупателю». Но так
-- подписан КАЖДЫЙ обычный безналичный платёж, который создаёт сайт.
-- В результате все безналичные приходы были помечены наличными и
-- уехали в кассу: касса +100000, банк ушёл в минус.
--
-- Комментарий — ненадёжный признак, больше его не используем.
-- Опираемся на updated_at: триггер trg_payments_updated проставляет
-- его при каждом UPDATE, поэтому испорченные строки видно точно.
-- =========================================================


-- ─────────────────────────────────────────────────────────
-- ШАГ 1. ДИАГНОСТИКА. Ничего не меняет — только смотрим.
-- Выполните и посмотрите, что попало в кассу.
-- ─────────────────────────────────────────────────────────

-- 1.1. Текущие балансы (то, что вы видите в админке)
SELECT
  COALESCE((SELECT SUM(CASE WHEN direction = 'incoming' THEN amount ELSE -amount END)
            FROM bank_payments
            WHERE type = 'cash' AND is_paid AND NOT exclude_from_balance), 0)
  - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source = 'cash'), 0)
  - COALESCE((SELECT SUM(amount) FROM cash_collections), 0)          AS "касса_сейчас",
  COALESCE((SELECT SUM(CASE WHEN direction = 'incoming' THEN amount ELSE -amount END)
            FROM bank_payments
            WHERE type <> 'cash' AND is_paid AND NOT exclude_from_balance), 0)
  - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source <> 'cash'), 0)
                                                                      AS "банк_сейчас";

-- 1.2. Платежи, которые мои скрипты трогали за последние 3 дня.
--      Именно они сейчас лежат в кассе неправильно.
--      ВНИМАТЕЛЬНО посмотрите этот список: это кандидаты на возврат в банк.
SELECT id, number, date, counterparty, amount, type, comment, updated_at
FROM bank_payments
WHERE type = 'cash'
  AND direction = 'incoming'
  AND updated_at > NOW() - INTERVAL '3 days'
ORDER BY updated_at DESC, date;

-- 1.3. Сколько денег суммарно «залипло» в кассе из-за этого
SELECT COUNT(*) AS "штук", COALESCE(SUM(amount), 0) AS "сумма"
FROM bank_payments
WHERE type = 'cash'
  AND direction = 'incoming'
  AND updated_at > NOW() - INTERVAL '3 days';


-- ─────────────────────────────────────────────────────────
-- ШАГ 2. ИСПРАВЛЕНИЕ.
--
-- Запускайте ТОЛЬКО после того, как в шаге 1.2 убедились, что в
-- списке действительно безналичные платежи, а не ваша реальная
-- наличка.
--
-- Возвращаем в банк всё, что мои скрипты перекрасили в наличные.
-- Настоящая наличка сюда не попадёт: её никто не редактировал за
-- последние 3 дня, у неё старый updated_at.
-- ─────────────────────────────────────────────────────────

BEGIN;

UPDATE bank_payments
SET type = 'regular'
WHERE type = 'cash'
  AND direction = 'incoming'
  AND updated_at > NOW() - INTERVAL '3 days';

-- Контроль ПЕРЕД фиксацией: касса не должна быть отрицательной,
-- банк должен вернуться в плюс.
SELECT
  COALESCE((SELECT SUM(CASE WHEN direction = 'incoming' THEN amount ELSE -amount END)
            FROM bank_payments
            WHERE type = 'cash' AND is_paid AND NOT exclude_from_balance), 0)
  - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source = 'cash'), 0)
  - COALESCE((SELECT SUM(amount) FROM cash_collections), 0)          AS "касса_после",
  COALESCE((SELECT SUM(CASE WHEN direction = 'incoming' THEN amount ELSE -amount END)
            FROM bank_payments
            WHERE type <> 'cash' AND is_paid AND NOT exclude_from_balance), 0)
  - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source <> 'cash'), 0)
                                                                      AS "банк_после";

-- Если числа верные — выполните COMMIT.
-- Если нет — выполните ROLLBACK, ничего не изменится.
COMMIT;
-- ROLLBACK;


-- ─────────────────────────────────────────────────────────
-- ШАГ 3. Если касса всё ещё в минусе.
--
-- Значит, часть наличных приходов раньше была удалена или изменена,
-- а старые сдачи кассы продолжают вычитать свою сумму.
-- Сдачи хранятся в cash_collections. Посмотрите их:
-- ─────────────────────────────────────────────────────────

-- 3.1. Список всех сдач кассы
-- SELECT id, date, amount, cash_amount, transfer_amount,
--        jsonb_array_length(COALESCE(items, '[]'::jsonb)) AS "размечено_платежей",
--        note
-- FROM cash_collections
-- ORDER BY date DESC;

-- 3.2. Удалить конкретную ошибочную сдачу (подставьте id из 3.1).
--      Её сумма вернётся в кассу.
-- DELETE FROM cash_collections WHERE id = 'СЮДА-ID-СДАЧИ';
