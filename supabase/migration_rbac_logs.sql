-- =========================================================
-- Миграция: права доступа, логи действий, ответственные
-- =========================================================

-- 1. Роли в таблице admins
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin' CHECK (role IN ('admin', 'manager'));
ALTER TABLE admins ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT '';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 2. Таблица логов действий
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID,
  admin_name TEXT NOT NULL DEFAULT '',
  admin_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',        -- 'create' | 'update' | 'delete' | 'status_change' | 'login' | 'export'
  entity_type TEXT NOT NULL DEFAULT '',    -- 'order' | 'deal' | 'payment' | 'receipt' | 'product' | 'transport' | 'delivery' | 'settings'
  entity_id TEXT DEFAULT '',
  entity_label TEXT DEFAULT '',            -- человекочитаемое описание ("Заказ #123", "Платёж ПЛ-5")
  details JSONB DEFAULT '{}'::jsonb,       -- {field, oldValue, newValue} или {status: "new→completed"}
  ip_address TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_admin ON activity_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);

-- 3. Поля ответственного в ключевых таблицах
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';
ALTER TABLE customer_deals ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';
ALTER TABLE bank_payments ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';
ALTER TABLE warehouse_receipts ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';
ALTER TABLE transports ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT '';

-- 4. RLS для логов (только чтение для авторизованных)
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "logs_sel" ON activity_logs;
CREATE POLICY "logs_sel" ON activity_logs FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "logs_ins" ON activity_logs;
CREATE POLICY "logs_ins" ON activity_logs FOR INSERT WITH CHECK (TRUE);
