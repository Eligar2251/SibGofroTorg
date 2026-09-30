-- =========================================================
-- Миграция: роль «Владелец» + прямые правки денежных счетов.
--
-- 1. Владелец — надмножество администратора. Дополнительно он может
--    менять остаток любого денежного счёта БЕЗ документа (касса, р/с,
--    карты ЮМ и В.М.): деньги просто появляются или исчезают.
-- 2. Каждая такая правка пишется в money_adjustments и в журнал
--    действий (entity_type = 'money-adjustment'), который видят
--    только владельцы.
--
-- Файл идемпотентен: можно запускать повторно.
-- =========================================================

-- ── 1. Роль owner ────────────────────────────────────────
-- В migration_wastepaper_account.sql CHECK разрешал
-- admin/manager/lawyer/wastepaper — заменяем на полный список.
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'lawyer', 'wastepaper'));

COMMENT ON COLUMN admins.role IS
  'owner — полный доступ и правка денежных счетов без документов; admin — полный доступ; manager — всё кроме настроек, базы данных и логов; lawyer — только финансовый дашборд; wastepaper — только отдельный учёт макулатуры';

-- ── 2. Прямые правки денежных счетов ─────────────────────
CREATE TABLE IF NOT EXISTS money_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account TEXT NOT NULL CHECK (account IN ('cash', 'bank', 'ym_card', 'vm_card')),
  -- Плюс — деньги пришли, минус — списаны («убрать 14 ₽»).
  delta NUMERIC(14,2) NOT NULL CHECK (delta <> 0),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  -- Снимок «стало» для журнала владельца (не участвует в расчёте).
  balance_after NUMERIC(14,2),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_money_adjustments_date
  ON money_adjustments(date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_money_adjustments_account
  ON money_adjustments(account);

-- Расширения для старых баз: колонки могли появиться в предыдущей версии.
ALTER TABLE money_adjustments
  ADD COLUMN IF NOT EXISTS balance_after NUMERIC(14,2);
ALTER TABLE money_adjustments
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Читает и пишет только сервер приложения (service_role обходит RLS).
-- Публичных политик нет намеренно: движения владельца не должны быть
-- доступны никому, кроме него.
ALTER TABLE money_adjustments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE money_adjustments IS
  'Прямые правки денежных счетов владельцем: без документов, в журнале видны только роли owner';

-- ── 3. Проверка ──────────────────────────────────────────
SELECT 'admins.role допускает owner' AS check_name,
       EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'admins_role_check'
           AND pg_get_constraintdef(oid) LIKE '%owner%'
       ) AS ok
UNION ALL
SELECT 'таблица money_adjustments создана',
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'money_adjustments')
UNION ALL
SELECT 'RLS включён',
       EXISTS (
         SELECT 1 FROM pg_tables
         WHERE tablename = 'money_adjustments' AND rowsecurity = TRUE
       );
