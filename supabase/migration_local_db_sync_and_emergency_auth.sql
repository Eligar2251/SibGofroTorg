-- =========================================================
-- ДВУСТОРОННЯЯ СИНХРОНИЗАЦИЯ SUPABASE ↔ ЛОКАЛЬНАЯ JSON-БД
-- И АУДИТ АВАРИЙНОГО БЕСПАРОЛЬНОГО ВХОДА ПО ФАЙЛУ ЛОКАЛЬНОЙ БД
--
-- Назначение:
--   • Хранит журнал сеансов синхронизации (экспорт Supabase → локалка,
--     импорт локалка → Supabase, двусторонняя сверка с досылкой офлайн-правок)
--   • Фиксирует полный путь локального файла БД (`local_file_path`) при
--     синхронизации и аварийном беспарольном входе при отказе основной БД
--
-- Идемпотентная миграция: безопасно запускать повторно.
-- =========================================================

CREATE TABLE IF NOT EXISTS db_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL CHECK (
    direction IN (
      'supabase_to_local',
      'local_to_supabase',
      'bidirectional',
      'emergency_file_login'
    )
  ),
  status TEXT NOT NULL DEFAULT 'success' CHECK (
    status IN ('success', 'partial', 'error')
  ),
  target_label TEXT,
  synced_tables INT NOT NULL DEFAULT 0,
  synced_rows INT NOT NULL DEFAULT 0,
  replayed_mutations INT NOT NULL DEFAULT 0,
  local_file_path TEXT,
  initiated_by TEXT,
  error_message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_sync_runs_created_at
  ON db_sync_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_db_sync_runs_direction
  ON db_sync_runs(direction, created_at DESC);

ALTER TABLE db_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS db_sync_runs_service_all ON db_sync_runs;
CREATE POLICY db_sync_runs_service_all ON db_sync_runs
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND tablename = 'db_sync_runs'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE db_sync_runs';
  END IF;
END $$;
