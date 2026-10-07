-- =========================================================
-- Миграция: личная навигация админки
--
-- У каждого пользователя админки своя раскладка меню:
-- группы, порядок вкладок, иконки и подписи.
-- RLS включён без публичных политик — читает и пишет
-- только сервер админки (service_role).
--
-- Если миграцию ещё не запускали, приложение само
-- сохраняет ту же JSON-раскладку в settings
-- (ключ admin_nav_layout:<логин>). После применения
-- этого файла новые сохранения уходят в таблицу.
--
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- Идемпотентна.
-- =========================================================

CREATE TABLE IF NOT EXISTS admin_nav_layouts (
  username TEXT PRIMARY KEY,
  layout JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_admin_nav_layouts_updated ON admin_nav_layouts;
CREATE TRIGGER trg_admin_nav_layouts_updated
  BEFORE UPDATE ON admin_nav_layouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE admin_nav_layouts ENABLE ROW LEVEL SECURITY;
