-- =========================================================
-- Закупки: куда ушло списание (банк / ЗП) и «вне баланса»
-- =========================================================
-- spent_payment_id уже есть (платёж в банке).
-- Добавляем spent_salary_id, spend_mode, exclude_from_balance.

ALTER TABLE warehouse_purchase_plans
  ADD COLUMN IF NOT EXISTS spent_salary_id text,
  ADD COLUMN IF NOT EXISTS spend_mode text,
  ADD COLUMN IF NOT EXISTS exclude_from_balance boolean DEFAULT false;

COMMENT ON COLUMN warehouse_purchase_plans.spent_salary_id IS
  'ID записи salaries, если списание шло через зарплату';
COMMENT ON COLUMN warehouse_purchase_plans.spend_mode IS
  'bank | salary — куда ушло списание накоплений';
COMMENT ON COLUMN warehouse_purchase_plans.exclude_from_balance IS
  'true = платёж/ЗП «вне баланса», не влияет на текущий банк/кассу';
