-- =========================================================
-- ⚠️ УСТАРЕЛО — НЕ ЗАПУСКАТЬ. Оставлено только как история.
--
-- В формуле кассы ниже ОШИБКА: она вычитает ВСЕ наличные зарплаты,
--   ... FROM salaries WHERE is_paid AND source='cash'
-- включая помеченные тегом «[Вне баланса]» — выплаты в обход кассы,
-- которые на остаток влиять не должны (см. getBankSummary в
-- src/lib/warehouse-shared.ts).
--
-- Из-за этого скрипт «видел» кассу в минусе, хотя минуса в данных нет,
-- и пытался лечить несуществующую проблему, создавая корректирующие
-- платежи и искажая учёт.
--
-- Вместо этого используйте supabase/CHECK_cash_balance.sql —
-- он считает остаток по правильной формуле и ничего не меняет.
-- =========================================================

-- =========================================================
-- ВОССТАНОВЛЕНИЕ КАССЫ И БАНКА — САМОПРОВЕРЯЮЩИЙСЯ СКРИПТ (v2)
--
-- Выделить всё → Run. Один раз. Ручная сверка не нужна.
--
-- ЦЕЛЬ: касса = 8749.00, банк = 42503.47
--
-- ЧТО ПОКАЗАЛ ПРОШЛЫЙ ЗАПУСК
--   • банк:  85569.47 -> 42503.47  — попал в цель ТОЧНО, логика верна;
--   • касса: осталась -34617 и не изменилась.
-- Касса в БД лежит В МИНУСЕ (в админке знак не виден). Прошлый скрипт
-- умел только УБИРАТЬ лишние приходы, поэтому при отрицательной кассе
-- условие need_cash > 0 не выполнялось и блок кассы пропускался.
-- Из-за RAISE EXCEPTION всё откатилось — база сейчас в исходном виде.
--
-- ЧТО ДЕЛАЕТ ЭТА ВЕРСИЯ
--   • банк завышен на 43066.00  -> исключает лишние приходы (как раньше);
--   • касса занижена на 43366.00 -> ВОЗВРАЩАЕТ в баланс наличные приходы,
--     ранее помеченные exclude_from_balance; если их не хватит, создаёт
--     одну корректирующую строку ровно на недостающую сумму.
--
-- БЕЗОПАСНОСТЬ
--   • без ALTER TABLE и без DELETE (кроме отката вручную)
--   • одна транзакция, резервная копия _backup_bank_payments
--   • не сошлось с целью -> автоматический ROLLBACK
-- =========================================================

DO $$
DECLARE
  target_cash NUMERIC := 8749.00;
  target_bank NUMERIC := 42503.47;

  cash_before NUMERIC; bank_before NUMERIC;
  cash_after  NUMERIC; bank_after  NUMERIC;
  diff_cash   NUMERIC; diff_bank   NUMERIC;
  acc         NUMERIC;
  cnt         INT;
  r           RECORD;
  v_num       INT;
BEGIN
  DROP TABLE IF EXISTS _backup_bank_payments;
  CREATE TABLE _backup_bank_payments AS TABLE bank_payments;
  RAISE NOTICE 'Резервная копия: _backup_bank_payments';

  SELECT
    COALESCE((SELECT SUM(CASE WHEN direction='incoming' THEN amount ELSE -amount END)
              FROM bank_payments WHERE type='cash' AND is_paid AND NOT exclude_from_balance),0)
    - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source='cash'),0)
    - COALESCE((SELECT SUM(amount) FROM cash_collections),0),
    COALESCE((SELECT SUM(CASE WHEN direction='incoming' THEN amount ELSE -amount END)
              FROM bank_payments WHERE type<>'cash' AND is_paid AND NOT exclude_from_balance),0)
    - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source<>'cash'),0)
  INTO cash_before, bank_before;

  RAISE NOTICE '=== ДО ===  касса: %  банк: %', cash_before, bank_before;

  diff_cash := cash_before - target_cash;   -- >0 убрать, <0 добавить
  diff_bank := bank_before - target_bank;
  RAISE NOTICE 'Касса: % | Банк: %',
    CASE WHEN diff_cash > 0 THEN 'убрать '||diff_cash ELSE 'добавить '||(-diff_cash) END,
    CASE WHEN diff_bank > 0 THEN 'убрать '||diff_bank ELSE 'добавить '||(-diff_bank) END;

  -- ─────────── КАССА ЗАВЫШЕНА: исключаем лишние приходы ───────────
  IF diff_cash > 0.009 THEN
    acc := 0; cnt := 0;
    FOR r IN SELECT id, amount FROM bank_payments
             WHERE type='cash' AND direction='incoming'
               AND is_paid AND NOT exclude_from_balance
             ORDER BY updated_at DESC, date DESC, number DESC
    LOOP
      EXIT WHEN acc + 0.009 >= diff_cash;
      IF acc + r.amount <= diff_cash + 0.009 THEN
        UPDATE bank_payments SET exclude_from_balance = TRUE,
          comment = COALESCE(comment,'') || ' [искл. при восстановлении]'
        WHERE id = r.id;
        acc := acc + r.amount; cnt := cnt + 1;
      END IF;
    END LOOP;
    RAISE NOTICE 'Касса: исключено % шт. на %', cnt, acc;
  END IF;

  -- ─────────── КАССА ЗАНИЖЕНА: возвращаем ранее исключённые ───────────
  IF diff_cash < -0.009 THEN
    acc := 0; cnt := 0;
    FOR r IN SELECT id, amount FROM bank_payments
             WHERE type='cash' AND direction='incoming'
               AND is_paid AND exclude_from_balance
             ORDER BY updated_at DESC, date DESC, number DESC
    LOOP
      EXIT WHEN acc + 0.009 >= -diff_cash;
      IF acc + r.amount <= -diff_cash + 0.009 THEN
        UPDATE bank_payments SET exclude_from_balance = FALSE,
          comment = COALESCE(comment,'') || ' [возвращён в баланс]'
        WHERE id = r.id;
        acc := acc + r.amount; cnt := cnt + 1;
      END IF;
    END LOOP;
    RAISE NOTICE 'Касса: возвращено % шт. на %', cnt, acc;

    -- Не хватило — одна корректирующая строка ровно на остаток.
    IF acc + 0.009 < -diff_cash THEN
      v_num := COALESCE((SELECT MAX(number) FROM bank_payments), 0) + 1;
      INSERT INTO bank_payments
        (number, date, direction, type, counterparty, amount,
         vat_rate, vat_amount, is_paid, paid_at, exclude_from_balance, comment)
      VALUES
        (v_num, TO_CHAR(NOW(),'YYYY-MM-DD'), 'incoming', 'cash',
         'Корректировка кассы', (-diff_cash) - acc,
         0, 0, TRUE, TO_CHAR(NOW(),'YYYY-MM-DD'), FALSE,
         'Корректировка остатка кассы при восстановлении учёта');
      RAISE NOTICE 'Касса: корректировка ПЛ-% на %', v_num, (-diff_cash) - acc;
    END IF;
  END IF;

  -- ─────────── БАНК ЗАВЫШЕН: исключаем лишние приходы ───────────
  IF diff_bank > 0.009 THEN
    acc := 0; cnt := 0;
    FOR r IN SELECT id, amount FROM bank_payments
             WHERE type<>'cash' AND direction='incoming'
               AND is_paid AND NOT exclude_from_balance
             ORDER BY updated_at DESC, date DESC, number DESC
    LOOP
      EXIT WHEN acc + 0.009 >= diff_bank;
      IF acc + r.amount <= diff_bank + 0.009 THEN
        UPDATE bank_payments SET exclude_from_balance = TRUE,
          comment = COALESCE(comment,'') || ' [искл. при восстановлении]'
        WHERE id = r.id;
        acc := acc + r.amount; cnt := cnt + 1;
      END IF;
    END LOOP;
    RAISE NOTICE 'Банк: исключено % шт. на %', cnt, acc;
  END IF;

  -- ─────────── БАНК ЗАНИЖЕН: возвращаем ранее исключённые ───────────
  IF diff_bank < -0.009 THEN
    acc := 0; cnt := 0;
    FOR r IN SELECT id, amount FROM bank_payments
             WHERE type<>'cash' AND direction='incoming'
               AND is_paid AND exclude_from_balance
             ORDER BY updated_at DESC, date DESC, number DESC
    LOOP
      EXIT WHEN acc + 0.009 >= -diff_bank;
      IF acc + r.amount <= -diff_bank + 0.009 THEN
        UPDATE bank_payments SET exclude_from_balance = FALSE,
          comment = COALESCE(comment,'') || ' [возвращён в баланс]'
        WHERE id = r.id;
        acc := acc + r.amount; cnt := cnt + 1;
      END IF;
    END LOOP;
    IF acc + 0.009 < -diff_bank THEN
      v_num := COALESCE((SELECT MAX(number) FROM bank_payments), 0) + 1;
      INSERT INTO bank_payments
        (number, date, direction, type, counterparty, amount,
         vat_rate, vat_amount, is_paid, paid_at, exclude_from_balance, comment)
      VALUES
        (v_num, TO_CHAR(NOW(),'YYYY-MM-DD'), 'incoming', 'regular',
         'Корректировка банка', (-diff_bank) - acc,
         0, 0, TRUE, TO_CHAR(NOW(),'YYYY-MM-DD'), FALSE,
         'Корректировка остатка расчётного счёта при восстановлении учёта');
      RAISE NOTICE 'Банк: корректировка ПЛ-% на %', v_num, (-diff_bank) - acc;
    END IF;
  END IF;

  -- ─────────── Итог ───────────
  SELECT
    COALESCE((SELECT SUM(CASE WHEN direction='incoming' THEN amount ELSE -amount END)
              FROM bank_payments WHERE type='cash' AND is_paid AND NOT exclude_from_balance),0)
    - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source='cash'),0)
    - COALESCE((SELECT SUM(amount) FROM cash_collections),0),
    COALESCE((SELECT SUM(CASE WHEN direction='incoming' THEN amount ELSE -amount END)
              FROM bank_payments WHERE type<>'cash' AND is_paid AND NOT exclude_from_balance),0)
    - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source<>'cash'),0)
  INTO cash_after, bank_after;

  RAISE NOTICE '=== ПОСЛЕ ===  касса: %  банк: %', cash_after, bank_after;

  IF ABS(cash_after - target_cash) > 0.01 OR ABS(bank_after - target_bank) > 0.01 THEN
    RAISE EXCEPTION 'НЕ СОШЛОСЬ — всё отменено. Получилось касса=% банк=%, нужно касса=% банк=%.',
      cash_after, bank_after, target_cash, target_bank;
  END IF;

  RAISE NOTICE 'ГОТОВО. Касса и банк соответствуют целевым значениям.';
END $$;


-- =========================================================
-- ПОЛНЫЙ ОТКАТ (если результат не устроил)
-- =========================================================
-- BEGIN;
--   DELETE FROM bank_payments;
--   INSERT INTO bank_payments SELECT * FROM _backup_bank_payments;
-- COMMIT;
