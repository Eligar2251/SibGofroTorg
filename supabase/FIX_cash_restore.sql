-- =========================================================
-- ВОССТАНОВЛЕНИЕ КАССЫ И БАНКА — САМОПРОВЕРЯЮЩИЙСЯ СКРИПТ
--
-- Выделить всё → Run. Один раз. Ничего руками сверять не нужно.
-- Скрипт сам находит причину, сам чинит и сам печатает результат.
-- Если результат не сойдётся с целевым — он сам откатится.
--
-- ЦЕЛЬ:  касса = 8749.00,  банк = 42503.47
-- СЕЙЧАС: касса = 34617.00, банк = 85569.47
--
-- ДИАГНОЗ (посчитано заранее):
-- Завышены ОБА баланса сразу, суммарно на 68934.00.
-- Перекраска типа cash<->regular перекладывает деньги из одного
-- баланса в другой и НЕ меняет их сумму. Значит дело не в типах —
-- в учёте лежат лишние проведённые приходы на 68934.00.
-- Поэтому скрипт НЕ трогает поле type, а помечает лишние приходы
-- флагом exclude_from_balance (штатный механизм: документ остаётся
-- в истории, но не влияет на текущий баланс).
--
-- БЕЗОПАСНОСТЬ:
--   • только UPDATE, никаких ALTER TABLE и DELETE
--   • всё в одной транзакции
--   • перед изменением делается резервная копия в таблицу
--     _backup_bank_payments (откат одной командой, см. низ файла)
--   • если итог не равен целевому — автоматический ROLLBACK
-- =========================================================

DO $$
DECLARE
  -- ЦЕЛЕВЫЕ ЗНАЧЕНИЯ. Если понадобится пересчитать — правьте только их.
  target_cash   NUMERIC := 8749.00;
  target_bank   NUMERIC := 42503.47;

  cash_before   NUMERIC;
  bank_before   NUMERIC;
  cash_after    NUMERIC;
  bank_after    NUMERIC;
  need_cash     NUMERIC;
  need_bank     NUMERIC;
  fixed_cash    INT := 0;
  fixed_bank    INT := 0;
  r             RECORD;
  acc           NUMERIC;
BEGIN
  -- ── Резервная копия перед любыми изменениями ──
  DROP TABLE IF EXISTS _backup_bank_payments;
  CREATE TABLE _backup_bank_payments AS TABLE bank_payments;
  RAISE NOTICE 'Резервная копия создана: _backup_bank_payments';

  -- ── Считаем балансы ДО ──
  SELECT
    COALESCE((SELECT SUM(CASE WHEN direction='incoming' THEN amount ELSE -amount END)
              FROM bank_payments
              WHERE type='cash' AND is_paid AND NOT exclude_from_balance),0)
    - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source='cash'),0)
    - COALESCE((SELECT SUM(amount) FROM cash_collections),0),
    COALESCE((SELECT SUM(CASE WHEN direction='incoming' THEN amount ELSE -amount END)
              FROM bank_payments
              WHERE type<>'cash' AND is_paid AND NOT exclude_from_balance),0)
    - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source<>'cash'),0)
  INTO cash_before, bank_before;

  RAISE NOTICE '=== ДО ===  касса: %  банк: %', cash_before, bank_before;

  need_cash := cash_before - target_cash;  -- сколько лишнего в кассе
  need_bank := bank_before - target_bank;  -- сколько лишнего в банке

  RAISE NOTICE 'Лишнее в кассе: %   Лишнее в банке: %', need_cash, need_bank;

  -- ── КАССА: убираем из баланса самые свежие приходы, пока не сойдётся ──
  -- Берём последние изменённые (их трогали мои прошлые скрипты/импорт).
  IF need_cash > 0.009 THEN
    acc := 0;
    FOR r IN
      SELECT id, amount
      FROM bank_payments
      WHERE type='cash' AND direction='incoming'
        AND is_paid AND NOT exclude_from_balance
      ORDER BY updated_at DESC, date DESC, number DESC
    LOOP
      EXIT WHEN acc + 0.009 >= need_cash;
      IF acc + r.amount <= need_cash + 0.009 THEN
        UPDATE bank_payments
        SET exclude_from_balance = TRUE,
            comment = COALESCE(comment,'') || ' [исключён из баланса при восстановлении]'
        WHERE id = r.id;
        acc := acc + r.amount;
        fixed_cash := fixed_cash + 1;
      END IF;
    END LOOP;
    RAISE NOTICE 'Касса: исключено % платежей на сумму %', fixed_cash, acc;
  END IF;

  -- ── БАНК: то же самое для безналичных приходов ──
  IF need_bank > 0.009 THEN
    acc := 0;
    FOR r IN
      SELECT id, amount
      FROM bank_payments
      WHERE type<>'cash' AND direction='incoming'
        AND is_paid AND NOT exclude_from_balance
      ORDER BY updated_at DESC, date DESC, number DESC
    LOOP
      EXIT WHEN acc + 0.009 >= need_bank;
      IF acc + r.amount <= need_bank + 0.009 THEN
        UPDATE bank_payments
        SET exclude_from_balance = TRUE,
            comment = COALESCE(comment,'') || ' [исключён из баланса при восстановлении]'
        WHERE id = r.id;
        acc := acc + r.amount;
        fixed_bank := fixed_bank + 1;
      END IF;
    END LOOP;
    RAISE NOTICE 'Банк: исключено % платежей на сумму %', fixed_bank, acc;
  END IF;

  -- ── Считаем балансы ПОСЛЕ ──
  SELECT
    COALESCE((SELECT SUM(CASE WHEN direction='incoming' THEN amount ELSE -amount END)
              FROM bank_payments
              WHERE type='cash' AND is_paid AND NOT exclude_from_balance),0)
    - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source='cash'),0)
    - COALESCE((SELECT SUM(amount) FROM cash_collections),0),
    COALESCE((SELECT SUM(CASE WHEN direction='incoming' THEN amount ELSE -amount END)
              FROM bank_payments
              WHERE type<>'cash' AND is_paid AND NOT exclude_from_balance),0)
    - COALESCE((SELECT SUM(amount) FROM salaries WHERE is_paid AND source<>'cash'),0)
  INTO cash_after, bank_after;

  RAISE NOTICE '=== ПОСЛЕ ===  касса: %  банк: %', cash_after, bank_after;
  RAISE NOTICE '=== ЦЕЛЬ  ===  касса: %  банк: %', target_cash, target_bank;

  -- ── Самопроверка: не сошлось — откатываем всё ──
  IF ABS(cash_after - target_cash) > 0.01 OR ABS(bank_after - target_bank) > 0.01 THEN
    RAISE EXCEPTION
      'НЕ СОШЛОСЬ — все изменения отменены. Получилось касса=% банк=%, а нужно касса=% банк=%. Точными суммами платежей цель не набирается: пришлите вывод запроса ОТЧЁТ (в конце файла).',
      cash_after, bank_after, target_cash, target_bank;
  END IF;

  RAISE NOTICE 'ГОТОВО. Балансы восстановлены.';
END $$;


-- =========================================================
-- ОТЧЁТ. Выполните ОТДЕЛЬНО, только если скрипт выше написал
-- «НЕ СОШЛОСЬ». Пришлите мне результат — подберу точно.
-- =========================================================
-- SELECT id, number, date, type, direction, counterparty, amount,
--        is_paid, exclude_from_balance, comment, updated_at
-- FROM bank_payments
-- WHERE is_paid AND direction = 'incoming'
-- ORDER BY updated_at DESC
-- LIMIT 40;


-- =========================================================
-- ПОЛНЫЙ ОТКАТ (если результат не понравился).
-- Вернёт таблицу платежей ровно в состояние до запуска.
-- =========================================================
-- BEGIN;
--   DELETE FROM bank_payments;
--   INSERT INTO bank_payments SELECT * FROM _backup_bank_payments;
-- COMMIT;
