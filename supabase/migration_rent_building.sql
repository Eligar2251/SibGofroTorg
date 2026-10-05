-- =========================================================
-- МИГРАЦИЯ: Схема здания для аренды (этажи и офисы)
--
-- Добавляет:
--   rent_buildings      — здания (корпуса)
--   rent_office_units   — офисы/помещения на этажах (x,y,w,h в %)
-- Связь офиса с арендатором — tenant_id (логическая, без FK
-- на случай удаления арендатора — ставится NULL).
--
-- Идемпотентна: безопасно запускать повторно в Supabase → SQL Editor.
-- =========================================================

CREATE TABLE IF NOT EXISTS rent_buildings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  floors INT NOT NULL DEFAULT 3 CHECK (floors >= 1 AND floors <= 20),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO rent_buildings (id, name, address, floors) VALUES
  ('main', 'Главный корпус', NULL, 3)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_rent_buildings_updated ON rent_buildings;
CREATE TRIGGER trg_rent_buildings_updated BEFORE UPDATE ON rent_buildings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS rent_office_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id TEXT NOT NULL REFERENCES rent_buildings(id) ON DELETE CASCADE,
  floor INT NOT NULL CHECK (floor >= 1 AND floor <= 20),
  label TEXT NOT NULL,
  x NUMERIC(5,1) NOT NULL CHECK (x >= 0 AND x <= 100),
  y NUMERIC(5,1) NOT NULL CHECK (y >= 0 AND y <= 100),
  w NUMERIC(5,1) NOT NULL CHECK (w >= 1 AND w <= 100),
  h NUMERIC(5,1) NOT NULL CHECK (h >= 1 AND h <= 100),
  tenant_id UUID,
  area NUMERIC(10,1),
  color TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_office_units_building_floor ON rent_office_units(building_id, floor);
CREATE INDEX IF NOT EXISTS idx_rent_office_units_tenant ON rent_office_units(tenant_id);

DROP TRIGGER IF EXISTS trg_rent_office_units_updated ON rent_office_units;
CREATE TRIGGER trg_rent_office_units_updated BEFORE UPDATE ON rent_office_units
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE rent_buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_office_units ENABLE ROW LEVEL SECURITY;
-- Политик нет: доступ только с сервера (service_role)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='rent_buildings') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE rent_buildings';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='rent_office_units') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE rent_office_units';
  END IF;
END $$;
