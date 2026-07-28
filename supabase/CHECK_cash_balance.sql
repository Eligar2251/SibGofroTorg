-- =========================================================
-- ПРОВЕРКА ОСТАТКА КАССЫ (только чтение, ничего не меняет)
--
-- Зачем: сверить остаток кассы в базе с числом, которое показывает
-- админка, и убедиться, что формулы не разошлись.
--
-- ГЛАВНОЕ ПРАВИЛО (источник правды — getBankSummary в
-- src/lib/warehouse-shared.ts):
--   зарплаты с тегом «[Вне баланса]» в комментарии НЕ уменьшают кассу.
--   Это выплаты в обход кассы: они видны в разделе ЗП, но на текущий
--   остаток не влияют.
--
-- Именно этого условия не хватало в прошлых скриптах (FIX_cash_restore.sql)
-- и в серверной проверке при сдаче кассы: они вычитали ВСЕ наличные
-- зарплаты, включая внебалансовые, и получали минус на ровном месте.
-- =========================================================

WITH cash_in AS (
  SELECT COALESCE(SUM(
    CASE WHEN direction = 'incoming' THEN amount ELSE -amount END
  ), 0) AS v
  FROM bank_payments
  WHERE type = 'cash' AND is_paid AND NOT COALESCE(exclude_from_balance, FALSE)
),
-- Наличные зарплаты, ВЛИЯЮЩИЕ на баланс (без тега «[Вне баланса]»).
salary_out AS (
  SELECT COALESCE(SUM(amount), 0) AS v
  FROM salaries
  WHERE is_paid
    AND source = 'cash'
    AND COALESCE(comment, '') NOT LIKE '%[Вне баланса]%'
),
-- Наличные зарплаты, идущие МИМО кассы (справочно).
salary_bypass AS (
  SELECT COALESCE(SUM(amount), 0) AS v, COUNT(*) AS n
  FROM salaries
  WHERE is_paid
    AND source = 'cash'
    AND COALESCE(comment, '') LIKE '%[Вне баланса]%'
),
collected AS (
  SELECT COALESCE(SUM(amount), 0) AS v FROM cash_collections
)
SELECT
  cash_in.v                                              AS "Приход налом",
  salary_out.v                                           AS "ЗП налом (в балансе)",
  salary_bypass.v                                        AS "ЗП мимо кассы (не вычитается)",
  salary_bypass.n                                        AS "Кол-во ЗП мимо кассы",
  collected.v                                            AS "Сдано (инкассация)",
  -- ПРАВИЛЬНЫЙ остаток — должен совпадать с числом в админке.
  cash_in.v - salary_out.v - collected.v                 AS "ОСТАТОК КАССЫ (верно)",
  -- Как считали раньше (с багом): вычитались и внебалансовые ЗП.
  cash_in.v - salary_out.v - salary_bypass.v - collected.v
                                                         AS "Остаток по старой формуле (баг)"
FROM cash_in, salary_out, salary_bypass, collected;


-- ─────────────────────────────────────────────────────────
-- Список выплат, идущих мимо кассы (именно они создавали расхождение).
-- ─────────────────────────────────────────────────────────
SELECT
  employee_name AS "Сотрудник",
  amount        AS "Сумма",
  COALESCE(paid_at, date) AS "Дата",
  comment       AS "Комментарий"
FROM salaries
WHERE is_paid
  AND source = 'cash'
  AND COALESCE(comment, '') LIKE '%[Вне баланса]%'
ORDER BY COALESCE(paid_at, date) DESC;
