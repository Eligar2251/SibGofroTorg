-- =========================================================
-- Миграция: ПЕРСОНАЛЬНАЯ НАСТРОЙКА НАВИГАЦИИ АДМИНКИ
--
-- ЧТО ДОБАВЛЯЕТ
--  Таблица admin_nav_settings — настройки меню админ-панели
--  для КАЖДОГО пользователя (ключ — логин из таблицы admins):
--  порядок разделов, скрытые разделы и группы-выпадашки
--  (заголовок + иконка + состав). Хранятся одним JSONB-полем.
--
-- Читает/пишет только сервер через service_role (getAdminDb):
--  • src/lib/admin-nav-store.ts
--  • src/app/api/admin/nav-settings/route.ts
-- поэтому RLS включаем без политик — как у остальных служебных
-- таблиц (см. home_tiles и др.).
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

CREATE TABLE IF NOT EXISTS admin_nav_settings (
  -- Логин администратора (admins.username, UNIQUE).
  username TEXT PRIMARY KEY REFERENCES admins(username) ON DELETE CASCADE,
  -- { version, entries: [ключ | { id, title, icon, items[] }], hidden[] }
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_admin_nav_settings_updated ON admin_nav_settings;
CREATE TRIGGER trg_admin_nav_settings_updated BEFORE UPDATE ON admin_nav_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- При удалении пользователя его настройки меню удаляются каскадно (FK выше).
