-- =========================================================
-- FILE: supabase/migration_consent_log.sql
-- Журнал согласий на обработку персональных данных (152-ФЗ, ст. 9).
-- =========================================================
--
-- ЗАЧЕМ
-- С 01.09.2025 практика РКН требует, чтобы оператор мог доказать факт
-- и условия согласия: IP-адрес, дата и время, источник (страница/форма)
-- и версия текста согласия, на который кликнул пользователь.
--
-- Кто пишет: src/lib/consent-log.ts (logConsent), вызывается из
-- обработчиков форм с персональными данными.
--
-- ★ Миграция необязательна для работы сайта: если таблицы нет, заявки
--   принимаются как обычно, а в лог сервера идёт предупреждение.
--   Чтобы согласия начали фиксироваться — выполните этот файл в
--   Supabase SQL Editor (см. supabase/APPLY_MIGRATIONS.md).

CREATE TABLE IF NOT EXISTS consent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Источник согласия: order | register | inquiry | quick-order | review …
  form TEXT NOT NULL,
  -- Субъект (телефон/почта), чтобы связать согласие с конкретным обращением
  subject TEXT,
  -- Технические доказательства
  ip TEXT,
  user_agent TEXT,
  page TEXT,
  -- Версия самого текста согласия и страница документа
  text_version TEXT NOT NULL,
  document_path TEXT NOT NULL DEFAULT '/consent',
  -- Какие именно согласия отмечены: {"personal_data": true, "marketing": false}
  accepted JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_consent_logs_created ON consent_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_logs_form ON consent_logs(form);
CREATE INDEX IF NOT EXISTS idx_consent_logs_subject ON consent_logs(subject);

-- RLS: журнал согласий доступен только сервисному ключу (админка/сервер).
-- Публичные ключи не должны ни читать, ни писать.
ALTER TABLE consent_logs ENABLE ROW LEVEL SECURITY;
