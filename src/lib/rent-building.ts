// =========================================================
// FILE: src/lib/rent-building.ts
// Схема здания для аренды: корпуса, этажи, планировки по клеткам.
//
// Планировка (plan) хранится как «карта» в стиле редакторов карт:
//   • walls    — стены на рёбрах клеток: { x, y, o } где o = "h"
//                (верхнее ребро клетки x,y) или "v" (левое ребро);
//   • openings — двери / окна / ворота на тех же рёбрах;
//   • rooms    — помещения как набор клеток (индекс = y * cols + x)
//                с названием, арендатором, цветом и комментарием.
//
// Хранение — settings.rent_building_scheme (работает без миграций).
// Старый формат (offices, прямоугольники в процентах) поддерживается:
// при чтении он автоматически превращается в клеточную планировку,
// при записи из планировки обратно рассчитываются legacy-офисы.
// =========================================================

import { getAdminDb } from "./supabase";

/* ─────────────────────────── Корпуса ─────────────────────────── */

export interface RentBuilding {
  id: string;
  name: string;
  address?: string | null;
  floors: number; // количество этажей, 1..20
}

/** Legacy-офис (прямоугольник в процентах). Оставлен для совместимости. */
export interface RentOfficeUnit {
  id: string;
  buildingId: string;
  floor: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tenantId: string | null;
  area?: number | null;
  color?: string | null;
  comment?: string | null;
}

/* ────────────────────────── Планировка ───────────────────────── */

export type PlanOrientation = "h" | "v";

/** Стена на ребре клетки. */
export interface RentPlanEdge {
  x: number;
  y: number;
  o: PlanOrientation;
}

export type RentOpeningKind = "door" | "window" | "gate";

/** Дверь / окно / ворота на ребре клетки. */
export interface RentPlanOpening extends RentPlanEdge {
  kind: RentOpeningKind;
}

/** Помещение — набор клеток этажа. */
export interface RentPlanRoom {
  id: string;
  label: string;
  cells: number[];
  tenantId: string | null;
  color?: string | null;
  comment?: string | null;
}

export interface RentFloorPlan {
  id: string;
  buildingId: string;
  floor: number;
  cols: number;
  rows: number;
  cellSize: number; // метров на клетку
  walls: RentPlanEdge[];
  openings: RentPlanOpening[];
  rooms: RentPlanRoom[];
  published?: boolean;
  publishedAt?: string | null;
  updatedAt?: string | null;
}

export interface RentBuildingScheme {
  buildings: RentBuilding[];
  /** legacy-представление, рассчитывается из plans при сохранении */
  offices: RentOfficeUnit[];
  plans: RentFloorPlan[];
}

export const PLAN_DEFAULT_COLS = 40;
export const PLAN_DEFAULT_ROWS = 24;
export const PLAN_DEFAULT_CELL_SIZE = 0.5; // 0.5 м → 20×12 м
export const PLAN_MIN_COLS = 8;
export const PLAN_MAX_COLS = 120;

const SETTINGS_KEY = "rent_building_scheme";

/* ────────────────────────── Утилиты ──────────────────────────── */

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function cellIndex(cols: number, x: number, y: number): number {
  return y * cols + x;
}

export function cellFromIndex(cols: number, index: number): { x: number; y: number } {
  return { x: index % cols, y: Math.floor(index / cols) };
}

export function edgeKey(edge: RentPlanEdge): string {
  return `${edge.o}:${edge.x}:${edge.y}`;
}

export function openingKey(edge: RentPlanEdge): string {
  return `${edge.o}:${edge.x}:${edge.y}`;
}

/** Нормализует набор клеток помещения (уникальные, в пределах сетки). */
export function normalizeCells(cells: number[], cols: number, rows: number): number[] {
  const max = cols * rows;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of cells) {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 0 || n >= max) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.sort((a, b) => a - b);
}

export function roomArea(plan: RentFloorPlan, room: RentPlanRoom): number {
  const value = room.cells.length * plan.cellSize * plan.cellSize;
  return Math.round(value * 10) / 10;
}

export function roomBounds(plan: RentFloorPlan, room: RentPlanRoom) {
  if (room.cells.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of room.cells) {
    const { x, y } = cellFromIndex(plan.cols, c);
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Периметр набора клеток: рёбра, за которыми нет «своей» клетки. */
export function regionPerimeterCells(cells: number[], cols: number, rows: number): RentPlanEdge[] {
  const set = new Set(cells);
  const edges: RentPlanEdge[] = [];
  for (const c of cells) {
    const { x, y } = cellFromIndex(cols, c);
    // верхнее ребро
    if (y === 0 || !set.has(cellIndex(cols, x, y - 1))) edges.push({ x, y, o: "h" });
    // нижнее ребро = верхнее ребро клетки ниже
    if (y === rows - 1 || !set.has(cellIndex(cols, x, y + 1))) edges.push({ x, y: y + 1, o: "h" });
    // левое ребро
    if (x === 0 || !set.has(cellIndex(cols, x - 1, y))) edges.push({ x, y, o: "v" });
    // правое ребро = левое ребро клетки справа
    if (x === cols - 1 || !set.has(cellIndex(cols, x + 1, y))) edges.push({ x: x + 1, y, o: "v" });
  }
  return edges;
}

export function createFloorPlan(
  buildingId: string,
  floor: number,
  over: Partial<RentFloorPlan> = {}
): RentFloorPlan {
  return {
    id: over.id || `${buildingId}-f${floor}`,
    buildingId,
    floor,
    cols: over.cols ?? PLAN_DEFAULT_COLS,
    rows: over.rows ?? PLAN_DEFAULT_ROWS,
    cellSize: over.cellSize ?? PLAN_DEFAULT_CELL_SIZE,
    walls: over.walls ?? [],
    openings: over.openings ?? [],
    rooms: over.rooms ?? [],
    published: over.published ?? false,
    publishedAt: over.publishedAt ?? null,
    updatedAt: over.updatedAt ?? null,
  };
}

/* ───────────────────── Очистка / валидация ───────────────────── */

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
  const tenantId =
    o.tenantId != null && String(o.tenantId).trim()
      ? String(o.tenantId).trim()
      : o.tenant_id
        ? String(o.tenant_id).trim()
        : null;
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

function cleanPlan(raw: any, buildings: RentBuilding[]): RentFloorPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const buildingId = String(raw.buildingId || raw.building_id || "main").trim() || "main";
  const building =
    buildings.find((b) => b.id === buildingId) || buildings[0] || { id: "main", name: "Корпус", floors: 3 };
  const floor = clamp(Math.round(Number(raw.floor) || 1), 1, building.floors || 20);
  const cols = clamp(Math.round(Number(raw.cols) || PLAN_DEFAULT_COLS), PLAN_MIN_COLS, PLAN_MAX_COLS);
  const rows = clamp(Math.round(Number(raw.rows) || PLAN_DEFAULT_ROWS), PLAN_MIN_COLS, PLAN_MAX_COLS);
  const cellSize = clamp(Number(raw.cellSize) || PLAN_DEFAULT_CELL_SIZE, 0.1, 5);

  const wallSeen = new Set<string>();
  const walls: RentPlanEdge[] = [];
  for (const w of Array.isArray(raw.walls) ? raw.walls : []) {
    const o: PlanOrientation = w?.o === "v" ? "v" : "h";
    const x = clamp(Math.round(Number(w?.x) || 0), 0, o === "v" ? cols : cols - 1);
    const y = clamp(Math.round(Number(w?.y) || 0), 0, o === "h" ? rows : rows - 1);
    const key = edgeKey({ x, y, o });
    if (wallSeen.has(key)) continue;
    wallSeen.add(key);
    walls.push({ x, y, o });
  }

  const openSeen = new Set<string>();
  const openings: RentPlanOpening[] = [];
  for (const op of Array.isArray(raw.openings) ? raw.openings : []) {
    const o: PlanOrientation = op?.o === "v" ? "v" : "h";
    const x = clamp(Math.round(Number(op?.x) || 0), 0, o === "v" ? cols : cols - 1);
    const y = clamp(Math.round(Number(op?.y) || 0), 0, o === "h" ? rows : rows - 1);
    const key = openingKey({ x, y, o });
    if (openSeen.has(key)) continue;
    openSeen.add(key);
    const kind: RentOpeningKind =
      op?.kind === "window" ? "window" : op?.kind === "gate" ? "gate" : "door";
    openings.push({ x, y, o, kind });
    // отверстие вырезает стену на этом ребре
    const wk = edgeKey({ x, y, o });
    if (wallSeen.has(wk)) {
      wallSeen.delete(wk);
      const idx = walls.findIndex((w) => edgeKey(w) === wk);
      if (idx >= 0) walls.splice(idx, 1);
    }
  }

  const usedCells = new Set<number>();
  const rooms: RentPlanRoom[] = [];
  for (const r of Array.isArray(raw.rooms) ? raw.rooms : []) {
    if (!r || typeof r !== "object") continue;
    const cells = normalizeCells(Array.isArray(r.cells) ? r.cells : [], cols, rows).filter((c) => {
      if (usedCells.has(c)) return false;
      usedCells.add(c);
      return true;
    });
    if (cells.length === 0) continue;
    rooms.push({
      id: String(r.id || `room-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      label: String(r.label || "").trim().slice(0, 60) || `Помещение ${rooms.length + 1}`,
      cells,
      tenantId:
        r.tenantId != null && String(r.tenantId).trim()
          ? String(r.tenantId).trim()
          : r.tenant_id
            ? String(r.tenant_id).trim()
            : null,
      color: r.color ? String(r.color).slice(0, 16) : null,
      comment: r.comment ? String(r.comment).trim().slice(0, 500) : null,
    });
  }

  return {
    id: String(raw.id || `${buildingId}-f${floor}`),
    buildingId: building.id,
    floor,
    cols,
    rows,
    cellSize: Math.round(cellSize * 100) / 100,
    walls,
    openings,
    rooms,
    published: Boolean(raw.published),
    publishedAt: raw.publishedAt ? String(raw.publishedAt).slice(0, 40) : null,
    updatedAt: raw.updatedAt ? String(raw.updatedAt).slice(0, 40) : null,
  };
}

/* ─────────────── Конвертация legacy ⇄ планировка ────────────── */

/** Legacy-офисы (проценты) → помещения на клеточной сетке. */
export function legacyOfficesToPlans(
  buildings: RentBuilding[],
  offices: RentOfficeUnit[]
): RentFloorPlan[] {
  const groups = new Map<string, RentOfficeUnit[]>();
  for (const o of offices) {
    const key = `${o.buildingId}#${o.floor}`;
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }

  const plans: RentFloorPlan[] = [];
  for (const [key, list] of groups) {
    const [buildingId, floorRaw] = key.split("#");
    const floor = Number(floorRaw) || 1;
    const cols = PLAN_DEFAULT_COLS;
    const rows = PLAN_DEFAULT_ROWS;
    // Размер клетки подбираем так, чтобы площадь совпала с указанной у офисов.
    const withArea = list.filter((o) => o.area && o.area > 0);
    let cellSize = PLAN_DEFAULT_CELL_SIZE;
    if (withArea.length > 0) {
      const ratios = withArea.map((o) => {
        const wc = Math.max(1, Math.round((o.w / 100) * cols));
        const hc = Math.max(1, Math.round((o.h / 100) * rows));
        return Math.sqrt((o.area as number) / (wc * hc));
      });
      const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
      cellSize = clamp(Math.round(avg * 20) / 20, 0.25, 2);
    }

    const plan = createFloorPlan(buildingId, floor, { cols, rows, cellSize });
    const used = new Set<number>();
    for (const o of list) {
      const x0 = clamp(Math.round((o.x / 100) * cols), 0, cols - 1);
      const y0 = clamp(Math.round((o.y / 100) * rows), 0, rows - 1);
      const x1 = clamp(Math.round(((o.x + o.w) / 100) * cols), x0 + 1, cols) - 1;
      const y1 = clamp(Math.round(((o.y + o.h) / 100) * rows), y0 + 1, rows) - 1;
      const cells: number[] = [];
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const idx = cellIndex(cols, x, y);
          if (used.has(idx)) continue;
          used.add(idx);
          cells.push(idx);
        }
      }
      if (cells.length === 0) continue;
      plan.rooms.push({
        id: o.id.startsWith("off-") ? o.id : `room-${o.id}`,
        label: o.label,
        cells: normalizeCells(cells, cols, rows),
        tenantId: o.tenantId,
        color: o.color ?? null,
        comment: o.comment ?? null,
      });
      // Стены по периметру + одна дверь снизу.
      for (const e of regionPerimeterCells(cells, cols, rows)) {
        plan.walls.push(e);
      }
      const bottom = regionPerimeterCells(cells, cols, rows).filter((e) => e.o === "h");
      if (bottom.length > 0) {
        const mid = bottom[Math.floor(bottom.length / 2)];
        plan.openings.push({ ...mid, kind: "door" });
        plan.walls = plan.walls.filter((w) => edgeKey(w) !== edgeKey(mid));
      }
    }
    plan.published = true;
    plans.push(plan);
  }
  return plans;
}

/** Помещения планировки → legacy-офисы (для старых таблиц и совместимости). */
export function plansToLegacyOffices(plans: RentFloorPlan[]): RentOfficeUnit[] {
  const offices: RentOfficeUnit[] = [];
  for (const plan of plans) {
    for (const room of plan.rooms) {
      const b = roomBounds(plan, room);
      if (b.w <= 0 || b.h <= 0) continue;
      offices.push({
        id: room.id,
        buildingId: plan.buildingId,
        floor: plan.floor,
        label: room.label,
        x: Math.round((b.x0 / plan.cols) * 1000) / 10,
        y: Math.round((b.y0 / plan.rows) * 1000) / 10,
        w: Math.round((b.w / plan.cols) * 1000) / 10,
        h: Math.round((b.h / plan.rows) * 1000) / 10,
        tenantId: room.tenantId,
        area: roomArea(plan, room),
        color: room.color ?? null,
        comment: room.comment ?? null,
      });
    }
  }
  return offices;
}

/* ──────────────────────── Чтение / запись ────────────────────── */

function defaultScheme(): RentBuildingScheme {
  return {
    buildings: [{ id: "main", name: "Главный корпус", address: null, floors: 3 }],
    offices: [],
    plans: [],
  };
}

function buildScheme(rawBuildings: any[], rawOffices: any[], rawPlans: any[]): RentBuildingScheme | null {
  const buildings = rawBuildings.map(cleanBuilding).filter(Boolean) as RentBuilding[];
  if (buildings.length === 0) return null;
  const offices = rawOffices.map((o) => cleanOffice(o, buildings)).filter(Boolean) as RentOfficeUnit[];
  let plans = rawPlans.map((p) => cleanPlan(p, buildings)).filter(Boolean) as RentFloorPlan[];
  // Нет сохранённых планировок, но есть legacy-офисы — переносим в клетки.
  if (plans.length === 0 && offices.length > 0) {
    plans = legacyOfficesToPlans(buildings, offices);
  }
  return { buildings, offices, plans };
}

async function readSettingsScheme(): Promise<RentBuildingScheme | null> {
  try {
    const db = getAdminDb();
    const { data, error } = await db
      .from("settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error || !data?.value) return null;
    const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
    if (!parsed || typeof parsed !== "object") return null;
    return buildScheme(
      Array.isArray(parsed.buildings) ? parsed.buildings : [],
      Array.isArray(parsed.offices) ? parsed.offices : [],
      Array.isArray(parsed.plans) ? parsed.plans : []
    );
  } catch {
    return null;
  }
}

/** Планировка конкретного этажа (при отсутствии — пустая сетка). */
export function findPlan(
  scheme: RentBuildingScheme,
  buildingId: string,
  floor: number
): RentFloorPlan {
  const found = scheme.plans.find((p) => p.buildingId === buildingId && p.floor === floor);
  if (found) return found;
  const building = scheme.buildings.find((b) => b.id === buildingId);
  if (building) {
    const base = scheme.plans.find((p) => p.buildingId === buildingId);
    return createFloorPlan(buildingId, floor, {
      cols: base?.cols ?? PLAN_DEFAULT_COLS,
      rows: base?.rows ?? PLAN_DEFAULT_ROWS,
      cellSize: base?.cellSize ?? PLAN_DEFAULT_CELL_SIZE,
    });
  }
  return createFloorPlan(buildingId, floor);
}

export async function getRentBuildingScheme(): Promise<RentBuildingScheme> {
  // 1. Основное хранилище — settings (там лежат планировки).
  const settings = await readSettingsScheme();
  if (settings) return settings;

  // 2. Если настроек нет — пробуем legacy-таблицы.
  try {
    const db = getAdminDb();
    const { data: bData, error: bErr } = await db.from("rent_buildings").select("*").order("id");
    if (!bErr && bData && bData.length > 0) {
      const { data: oData, error: oErr } = await db
        .from("rent_office_units")
        .select("*")
        .order("floor")
        .order("label");
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
        const scheme = buildScheme(buildings, offices, []);
        if (scheme) return scheme;
      }
    }
  } catch {
    // ignore → defaults
  }

  return defaultScheme();
}

export async function saveRentBuildingScheme(scheme: RentBuildingScheme): Promise<void> {
  const buildings = (scheme.buildings || []).map(cleanBuilding).filter(Boolean) as RentBuilding[];
  const safeBuildings = buildings.length ? buildings : defaultScheme().buildings;
  const plans = (scheme.plans || [])
    .map((p) => cleanPlan(p, safeBuildings))
    .filter(Boolean) as RentFloorPlan[];

  // legacy-офисы всегда пересчитываем из планировок (для старых таблиц и сводок)
  let offices: RentOfficeUnit[];
  if (plans.length > 0) {
    offices = plansToLegacyOffices(plans);
  } else {
    offices = (scheme.offices || []).map((o) => cleanOffice(o, safeBuildings)).filter(Boolean) as RentOfficeUnit[];
  }

  const payload = { buildings: safeBuildings, offices, plans };

  // 1. Основное хранилище — settings. Пишем всегда.
  const db = getAdminDb();
  const { error: settingsError } = await db.from("settings").upsert(
    { key: SETTINGS_KEY, value: JSON.stringify(payload), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (settingsError) throw settingsError;

  // 2. Best-effort синхронизация legacy-таблиц, если они есть.
  try {
    const probe = await db.from("rent_buildings").select("id").limit(1);
    if (probe.error) return;

    for (const b of safeBuildings) {
      await db.from("rent_buildings").upsert(
        {
          id: b.id,
          name: b.name,
          address: b.address,
          floors: b.floors,
          updated_at: new Date().toISOString(),
        },
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
    await db.from("rent_office_units").delete().not("id", "is", null);
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
  } catch (e) {
    console.warn("rent building: legacy tables sync skipped", e);
  }
}
