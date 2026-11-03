-- =========================================================
-- FILE: supabase/migration_fix_die_calc_view_security_invoker.sql
-- Исправление замечаний Supabase Security Advisor:
--   1. [ERROR] View `public.die_calc_job_stats` is defined with the
--      SECURITY DEFINER property → переводим представление в режим
--      `security_invoker = true`, чтобы при запросах через PostgREST
--      действовали RLS-права вызывающей роли, а не владельца схемы.
--   2. [WARN] Фиксируем `search_path = public` у всех серверных и
--      триггерных функций схемы `public`, чтобы в Security Advisor
--      не было предупреждений `Function Search Path Mutable`.
-- Идемпотентно — безопасно запускать повторно.
-- =========================================================

-- 1. Пересоздаём и явно переключаем вьюху статистики расчётов штанцформ
--    в режим SECURITY INVOKER (PostgreSQL 15+ / Supabase Cloud).
CREATE OR REPLACE VIEW public.die_calc_job_stats
WITH (security_invoker = true) AS
SELECT
  j.construction,
  j.closure,
  j.profile_id,
  COUNT(*)::INT AS jobs,
  COUNT(*) FILTER (WHERE j.fact_blank_w IS NOT NULL AND j.fact_blank_h IS NOT NULL)::INT AS with_fact_geom,
  COUNT(*) FILTER (WHERE j.fact_price_per_pcs IS NOT NULL OR j.fact_price_batch IS NOT NULL)::INT AS with_fact_price,
  ROUND(AVG(
    (ABS(j.fact_blank_w - j.blank_w) + ABS(j.fact_blank_h - j.blank_h)) / 2
  ) FILTER (WHERE j.fact_blank_w IS NOT NULL AND j.fact_blank_h IS NOT NULL), 1) AS mean_blank_err_mm,
  ROUND(AVG(j.fact_price_per_pcs / NULLIF(j.price_per_pcs, 0))
    FILTER (WHERE j.fact_price_per_pcs > 0 AND j.price_per_pcs > 0), 4) AS mean_price_k,
  SUM(j.price_batch) AS sum_price_batch,
  SUM(j.fact_price_batch) AS sum_fact_price_batch
FROM public.die_calc_jobs j
WHERE j.learned = TRUE
GROUP BY j.construction, j.closure, j.profile_id;

ALTER VIEW public.die_calc_job_stats SET (security_invoker = true);

-- Запрещаем прямой доступ к представлению для ролей anon/authenticated
-- (чтение статистики штанцформ выполняется только серверным ключом админки)
REVOKE ALL ON public.die_calc_job_stats FROM anon, authenticated;

-- 2. Фиксируем безопасный `search_path = public` для всех функций проекта
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_product_in_stock') THEN
    ALTER FUNCTION public.sync_product_in_stock() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calculate_product_box_volume') THEN
    ALTER FUNCTION public.calculate_product_box_volume() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_update_product_rating') THEN
    ALTER FUNCTION public.fn_update_product_rating() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_next_counter') THEN
    ALTER FUNCTION public.fn_next_counter(TEXT) SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_increment_view_count') THEN
    ALTER FUNCTION public.fn_increment_view_count() SET search_path = public;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_review_helpful') THEN
    ALTER FUNCTION public.increment_review_helpful(UUID) SET search_path = public;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
