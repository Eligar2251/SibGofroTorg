// =========================================================
// FILE: src/lib/rent-building.ts
// Схема здания для аренды: этажи, офисы, привязка арендаторов.
// Хранение — в таблице settings (ключ rent_building_scheme) с
// fallback, как у rent_electricity. При наличии таблиц
// rent_buildings / rent_office_units — можно мигрировать, но пока
// достаточно JSON-фолбэка — работает без применения миграций.
// =========================================================

import { getAdminDb } from "./supabase";

export interface RentBuilding {
  id: string;
  name: string;
  address?: string | null;
  floors: number; // количество этажей, 1..20
}

export interface RentOfficeUnit {
  id: string;
  buildingId: string;
  floor: number; // 1..floors
  label: string; // "Офис 201" | "Каб. 12"
  x: number; // 0..100 %
  y: number;
  w: number; // 5..100
  h: number;
  tenantId: string | null;
  area?: number | null; // кв.м
  color?: string | null;
  comment?: string | null;
}

export interface RentBuildingScheme {
  buildings: RentBuilding[];
  offices: RentOfficeUnit[];
}

const SETTINGS_KEY = "rent_building_scheme";

function defaultScheme(): RentBuildingScheme {
  return {
    buildings: [
      { id: "main", name: "Главный корпус", address: null, floors: 3 },
    ],
    offices: [],
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function cleanOffice(o: any, buildings: RentBuilding[]): RentOfficeUnit | null {
  if (!o || typeof o !== "object") return null;
  const buildingId = String(o.buildingId || o.building_id || "main").trim() || "main";
  const building = buildings.find((b) => b.id === buildingId) || buildings[0];
  if (!building) return null;
  const floor = clamp(Math.round(Number(o.floor) || 1), 1, building.floors);
  const label = String(o.label || "").trim().slice(0, 80) || `Офис ${floor}01`;
  const x = clamp(Number(o.x) || 0, 0, 95);
  const y = clamp(Number(o.y) || 0, 0, 95);
  const w = clamp(Number(o.w) || 18, 5, 100 - x);
  const h = clamp(Number(o.h) || 14, 5, 100 - y);
  // tenantId может быть uuid или null
  const tenantId = o.tenantId != null && String(o.tenantId).trim() ? String(o.tenantId).trim() : (o.tenant_id ? String(o.tenant_id).trim() : null);
  return {
    id: String(o.id || `off-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    buildingId,
    floor,
    label,
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    w: Math.round(w * 10) / 10,
    h: Math.round(h * 10) / 10,
    tenantId,
    area: o.area != null && Number(o.area) > 0 ? Math.round(Number(o.area) * 10) / 10 : null,
    color: o.color ? String(o.color).slice(0, 16) : null,
    comment: o.comment ? String(o.comment).trim().slice(0, 500) : null,
  };
}

function cleanBuilding(b: any): RentBuilding | null {
  if (!b || typeof b !== "object") return null;
  const id = String(b.id || "").trim().slice(0, 60) || `b-${Date.now()}`;
  const name = String(b.name || "").trim().slice(0, 120) || "Корпус";
  const floors = clamp(Math.round(Number(b.floors) || 3), 1, 20);
  return {
    id,
    name,
    address: b.address ? String(b.address).trim().slice(0, 200) : null,
    floors,
  };
}

async function readSettingsScheme(): Promise<RentBuildingScheme | null> {
  try {
    const db = getAdminDb();
    const { data, error } = await db.from("settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    if (error || !data?.value) return null;
    const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
    if (!parsed || typeof parsed !== "object") return null;
    const rawBuildings = Array.isArray(parsed.buildings) ? parsed.buildings : [];
    const rawOffices = Array.isArray(parsed.offices) ? parsed.offices : [];
    const buildings = rawBuildings.map(cleanBuilding).filter(Boolean) as RentBuilding[];
    const offices = rawOffices.map((o: any) => cleanOffice(o, buildings.length ? buildings : defaultScheme().buildings)).filter(Boolean) as RentOfficeUnit[];
    if (buildings.length === 0) return null;
    return { buildings, offices };
  } catch {
    return null;
  }
}

export async function getRentBuildingScheme(): Promise<RentBuildingScheme> {
  // Пытаемся прочитать из новых таблиц, если они существуют
  try {
    const db = getAdminDb();
    const { data: bData, error: bErr } = await db.from("rent_buildings").select("*").order("id");
    if (!bErr && bData) {
      const { data: oData, error: oErr } = await db.from("rent_office_units").select("*").order("floor").order("label");
      if (!oErr && oData) {
        const buildings: RentBuilding[] = bData.map((r: any) => ({
          id: String(r.id),
          name: String(r.name),
          address: r.address ?? null,
          floors: Number(r.floors) || 3,
        }));
        const offices: RentOfficeUnit[] = oData.map((r: any) => ({
          id: String(r.id),
          buildingId: String(r.building_id),
          floor: Number(r.floor),
          label: String(r.label),
          x: Number(r.x),
          y: Number(r.y),
          w: Number(r.w),
          h: Number(r.h),
          tenantId: r.tenant_id ? String(r.tenant_id) : null,
          area: r.area != null ? Number(r.area) : null,
          color: r.color ?? null,
          comment: r.comment ?? null,
        }));
        if (buildings.length > 0) return { buildings, offices };
      }
    }
  } catch {
    // fallback to settings
  }

  const fallback = await readSettingsScheme();
  if (fallback) return fallback;
  return defaultScheme();
}

export async function saveRentBuildingScheme(scheme: RentBuildingScheme): Promise<void> {
  const buildings = (scheme.buildings || []).map(cleanBuilding).filter(Boolean) as RentBuilding[];
  const safeBuildings = buildings.length ? buildings : defaultScheme().buildings;
  const offices = (scheme.offices || []).map((o) => cleanOffice(o, safeBuildings)).filter(Boolean) as RentOfficeUnit[];

  // Пытаемся записать в новые таблицы, если они есть
  try {
    const db = getAdminDb();
    // Проверяем существование таблицы пробным select
    const probe = await db.from("rent_buildings").select("id").limit(1);
    if (!probe.error) {
      // Синхронизируем здания: upsert + удалить отсутствующие
      for (const b of safeBuildings) {
        await db.from("rent_buildings").upsert(
          { id: b.id, name: b.name, address: b.address, floors: b.floors, updated_at: new Date().toISOString() },
          { onConflict: "id" }
        );
      }
      const keepBuildingIds = new Set(safeBuildings.map((b) => b.id));
      const { data: existing } = await db.from("rent_buildings").select("id");
      for (const row of existing || []) {
        if (!keepBuildingIds.has(row.id)) {
          await db.from("rent_buildings").delete().eq("id", row.id);
        }
      }
      // Офисы: полная замена
      await db.from("rent_office_units").delete().not("id", "is", null); // чистим и перезаписываем
      if (offices.length > 0) {
        const rows = offices.map((o) => ({
          id: o.id,
          building_id: o.buildingId,
          floor: o.floor,
          label: o.label,
          x: o.x,
          y: o.y,
          w: o.w,
          h: o.h,
          tenant_id: o.tenantId,
          area: o.area,
          color: o.color,
          comment: o.comment,
        }));
        const { error } = await db.from("rent_office_units").insert(rows);
        if (error) throw error;
      }
      // Дублируем в settings для совместимости
      await db.from("settings").upsert(
        { key: SETTINGS_KEY, value: JSON.stringify({ buildings: safeBuildings, offices }), updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      return;
    }
  } catch {
    // fallback
  }

  const db = getAdminDb();
  await db.from("settings").upsert(
    { key: SETTINGS_KEY, value: JSON.stringify({ buildings: safeBuildings, offices }), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}
