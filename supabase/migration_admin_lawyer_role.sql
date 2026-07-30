-- =========================================================
-- Роль lawyer для ограниченного финансового дашборда
-- =========================================================

ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin';

-- В старой миграции CHECK разрешал только admin/manager. Имя ограничения,
-- созданного PostgreSQL для колонки admins.role, стандартное.
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;

UPDATE admins SET role = 'admin' WHERE role IS NULL;
ALTER TABLE admins ALTER COLUMN role SET DEFAULT 'admin';
ALTER TABLE admins ALTER COLUMN role SET NOT NULL;

ALTER TABLE admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('admin', 'manager', 'lawyer'));

COMMENT ON COLUMN admins.role IS
  'admin — полный доступ; manager — всё кроме настроек сайта и логов; lawyer — только финансовый дашборд и перевозки';
