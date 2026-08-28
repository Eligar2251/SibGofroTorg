-- =========================================================
-- Закупки: реальные платежи вместо «накопил и списал одной кнопкой»
--
-- ЧТО МЕНЯЕТСЯ
-- Раньше закупка копила виртуальные «пополнения» (JSONB contributions),
-- которые не двигали деньги, а потом одна кнопка «Списать» создавала
-- ОДИН платёж на всю накопленную сумму. Отредактировать или удалить
-- отдельный взнос было нельзя.
--
-- Теперь каждый платёж по закупке — обычная строка bank_payments
-- (исходящий платёж), связанная с закупкой через purchase_plan_id.
-- Его можно создать как из карточки закупки, так и из банка, а также
-- отредактировать и удалить как любой другой платёж.
--
-- Старые поля (contributions, spent_amount, spent_payment_id,
-- spent_salary_id, spend_mode) НЕ удаляются: по ним показывается история
-- уже закрытых закупок и остатки «отложено» по активным.
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

-- ── Привязка платежа к закупке ──
ALTER TABLE bank_payments
  ADD COLUMN IF NOT EXISTS purchase_plan_id UUID;

COMMENT ON COLUMN bank_payments.purchase_plan_id IS
  'Закупка (warehouse_purchase_plans), к которой отнесён платёж';

-- Частичный индекс: строк с привязкой мало, полный индекс не нужен
CREATE INDEX IF NOT EXISTS idx_bank_payments_purchase_plan
  ON bank_payments(purchase_plan_id)
  WHERE purchase_plan_id IS NOT NULL;

-- Если закупку удалили — платёж остаётся в банке, просто теряет привязку.
-- Деньги не должны исчезать вместе с планом.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_payments_purchase_plan_fk'
  ) THEN
    ALTER TABLE bank_payments
      ADD CONSTRAINT bank_payments_purchase_plan_fk
      FOREIGN KEY (purchase_plan_id)
      REFERENCES warehouse_purchase_plans(id)
      ON DELETE SET NULL;
    RAISE NOTICE 'Добавлена связь bank_payments.purchase_plan_id → warehouse_purchase_plans';
  ELSE
    RAISE NOTICE 'Связь уже есть, пропускаем';
  END IF;
END $$;

-- ── Дата, к которой закупку планируют закрыть (необязательная) ──
ALTER TABLE warehouse_purchase_plans
  ADD COLUMN IF NOT EXISTS due_date DATE;

COMMENT ON COLUMN warehouse_purchase_plans.due_date IS
  'Плановая дата закупки — по ней сортируются ближайшие';
