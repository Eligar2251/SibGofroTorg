-- =========================================================
-- СВЯЗКИ КАРТОЧЕК ТОВАРОВ (объединённые карточки как на Ozon)
-- Заменяет старую таблицу product_variants: каждый вариант —
-- обычная самостоятельная карточка товара со своим складом,
-- ценой, артикулом и штрихкодом, связанная в единую группу.
-- Идемпотентная миграция: безопасно запускать повторно.
-- =========================================================

CREATE TABLE IF NOT EXISTS product_link_groups (
  id TEXT PRIMARY KEY,
  primary_product_id TEXT NOT NULL,
  product_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  group_title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_link_groups_members
  ON product_link_groups USING GIN (product_ids);

DROP TRIGGER IF EXISTS trg_product_link_groups_updated ON product_link_groups;
CREATE TRIGGER trg_product_link_groups_updated
  BEFORE UPDATE ON product_link_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE product_link_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plg_anon_select ON product_link_groups;
CREATE POLICY plg_anon_select ON product_link_groups
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS plg_service_all ON product_link_groups;
CREATE POLICY plg_service_all ON product_link_groups
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Удаление старой таблицы под-вариантов (если создавалась ранее)
DROP TABLE IF EXISTS product_variants CASCADE;
