-- =========================================================
-- Миграция: ШТАНЦФОРМЫ — СОХРАНЁННЫЕ РАСЧЁТЫ, ОБУЧЕНИЕ, ОБЩИЙ ПРАЙС
--
-- Калькулятор штанцформы (админка → «Штанцформа», /die-calc) до этой
-- миграции жил только в localStorage браузера. Здесь появляются три
-- таблицы:
--
--  1. die_calc_jobs    — сохранённые расчёты (таблица «Расчёты штанцформ»).
--     Колонки разбиты на три группы:
--       · ввод (l_mm, w_mm, h_mm, qty, профиль, конструкция, замок) — по ним
--         фильтруют и из них же можно пересчитать всё заново;
--       · расчёт (blank_*, die_*, knives_m, per_sheet, price_*) — то, что
--         выдал калькулятор в момент сохранения;
--       · ФАКТ (fact_*) — что получилось на самом деле: габарит заготовки с
--         готовой матрицы и реальная цена. Именно из этих колонок растёт
--         обучение; пустой fact = запись в обучении не участвует.
--     settings/result/pricing — jsonb: полный ввод со справочниками и снимок
--     результата. Нужны, чтобы «открыть снова» воспроизводило расчёт
--     бит-в-бит, а не зависело от того, какие ставки у админа в браузере.
--
--  2. die_calc_models  — выученные модели (поправка по габариту на
--     конструкцию + множители цены по группам). Храним историей:
--     активная строка одна (is_active), предыдущие остаются для отката.
--
--  3. die_calc_settings — ОДИН общий прайс калькулятора (профили, форматы
--     листа, ставки штампа/тиража, размер маркировки). Пока он пустой, все
--     сидят на своих localStorage-ставках и цены в журнале не сопоставимы.
--
-- Права: пишут только серверные маршруты через service_role (getAdminDb),
-- поэтому RLS включаем без политик — как у home_tiles и остальных
-- служебных таблиц.
--
-- Идемпотентно: можно запускать повторно.
-- Запуск: Supabase → SQL Editor → вставить целиком → Run.
-- =========================================================

-- ── 1. Сохранённые расчёты ──
CREATE TABLE IF NOT EXISTS die_calc_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- что показываем в таблице
  order_no TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  customer TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','quoted','approved','in_work','done','rejected','archived')),

  -- ввод (денормализован: фильтры, обучение и сортировка работают по колонкам,
  -- а не по jsonb)
  construction TEXT NOT NULL
    CHECK (construction IN ('lastochkin','lotok','yazyk','bokovoy','blank')),
  closure TEXT NOT NULL
    CHECK (closure IN ('none','half','tuck','full','glue')),
  profile_id TEXT NOT NULL DEFAULT 'E',
  l_mm NUMERIC(10,2) NOT NULL CHECK (l_mm > 0),
  w_mm NUMERIC(10,2) NOT NULL CHECK (w_mm > 0),
  h_mm NUMERIC(10,2) NOT NULL CHECK (h_mm > 0),
  qty INTEGER NOT NULL DEFAULT 1000 CHECK (qty > 0),

  -- расчёт калькулятора на момент сохранения
  blank_w NUMERIC(10,2),
  blank_h NUMERIC(10,2),
  die_w NUMERIC(10,2),
  die_h NUMERIC(10,2),
  blank_area_m2 NUMERIC(12,6),
  knives_m NUMERIC(10,3),
  per_sheet INTEGER,
  sheets INTEGER,
  price_die NUMERIC(14,2),
  price_batch NUMERIC(14,2),
  price_per_pcs NUMERIC(12,2),
  price_with_vat NUMERIC(14,2),

  -- ФАКТ: правится руками в таблице, кормит обучение
  fact_blank_w NUMERIC(10,2),
  fact_blank_h NUMERIC(10,2),
  fact_price_per_pcs NUMERIC(12,2),
  fact_price_batch NUMERIC(14,2),
  fact_qty INTEGER,

  -- участвовать ли в обучении (срывные тиражи и «за знакомство» можно
  -- выключить, не удаляя запись)
  learned BOOLEAN NOT NULL DEFAULT TRUE,

  -- всё для точного повтора расчёта
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { input, prices, profiles, sheets }
  result JSONB NOT NULL DEFAULT '{}'::jsonb,     -- снимок CalcResult (без панелей)

  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_die_calc_jobs_created ON die_calc_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_die_calc_jobs_status ON die_calc_jobs(status);
-- группа обучения: «все подтверждённые ласточкины хвосты с tuck на E»
CREATE INDEX IF NOT EXISTS idx_die_calc_jobs_group
  ON die_calc_jobs(construction, closure, profile_id);
CREATE INDEX IF NOT EXISTS idx_die_calc_jobs_learned
  ON die_calc_jobs(construction, closure, profile_id) WHERE learned = TRUE;
CREATE INDEX IF NOT EXISTS idx_die_calc_jobs_order_no ON die_calc_jobs(order_no) WHERE order_no <> '';

DROP TRIGGER IF EXISTS trg_die_calc_jobs_updated ON die_calc_jobs;
CREATE TRIGGER trg_die_calc_jobs_updated BEFORE UPDATE ON die_calc_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE die_calc_jobs ENABLE ROW LEVEL SECURITY;

-- ── 2. Выученные модели ──
-- model — это DieCalcModel из src/lib/die-calc/learn.ts:
--   { version, trainedAt, n, geo: [{construction, coef, n, errBeforeMm,
--     errAfterMm, ...}], price: [{key, n, k, kMean, spreadPct}], notes: [] }
-- Считается на сервере (trainDieCalcModel) тем же ядром, что и расчёт.
CREATE TABLE IF NOT EXISTS die_calc_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  n INTEGER NOT NULL DEFAULT 0,
  model JSONB NOT NULL,
  notes TEXT[] DEFAULT '{}'::text[],
  trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

-- активная модель всегда одна
CREATE UNIQUE INDEX IF NOT EXISTS uq_die_calc_models_active
  ON die_calc_models (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_die_calc_models_trained ON die_calc_models(trained_at DESC);

ALTER TABLE die_calc_models ENABLE ROW LEVEL SECURITY;

-- ── 3. Общий прайс калькулятора (одна строка) ──
CREATE TABLE IF NOT EXISTS die_calc_settings (
  key TEXT PRIMARY KEY DEFAULT 'default',
  content JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { profiles, sheets, prices, labelSize }
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_die_calc_settings_updated ON die_calc_settings;
CREATE TRIGGER trg_die_calc_settings_updated BEFORE UPDATE ON die_calc_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE die_calc_settings ENABLE ROW LEVEL SECURITY;

-- ── 4. Сводка для дашборда админки (материализуем лень, смотрим вьюхой) ──
CREATE OR REPLACE VIEW die_calc_job_stats AS
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
FROM die_calc_jobs j
WHERE j.learned = TRUE
GROUP BY j.construction, j.closure, j.profile_id;

-- ── 5. Пустая строка общего прайса, чтобы админка могла её сразу редактировать ──
INSERT INTO die_calc_settings (key, content)
SELECT 'default', '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM die_calc_settings WHERE key = 'default');
