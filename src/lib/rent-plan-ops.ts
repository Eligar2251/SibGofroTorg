// =========================================================
// FILE: src/lib/rent-plan-ops.ts
// Чистые операции над клеточной планировкой этажа:
// стены/проёмы, помещения, авто-обводка, автонарезка, сдвиг.
// Никакого React — только данные, поэтому функции легко
// покрывать тестами (и они не зависят от браузера).
// =========================================================

import {
  cellFromIndex,
  cellIndex,
  createFloorPlan,
  edgeKey,
  normalizeCells,
  regionPerimeterCells,
  type RentFloorPlan,
  type RentOpeningKind,
  type RentPlanEdge,
  type RentPlanRoom,
} from "./rent-building";

export type PlanEdgeTool = "wall" | "door" | "window" | "gate" | "erase";

export type PlanStroke =
  | {
      kind: "edge";
      tool: PlanEdgeTool;
      axis: "h" | "v";
      line: number;
      from: number;
      to: number;
    }
  | { kind: "erase-cells"; visited: number[] }
  | { kind: "room"; a: { x: number; y: number }; b: { x: number; y: number } }
  | { kind: "move-room"; roomId: string; dx: number; dy: number };

/** Правильный ли отрезок стены/проёма (не выходит за сетку). */
function isEdgeInside(plan: RentFloorPlan, edge: RentPlanEdge): boolean {
  if (edge.o === "h") {
    return edge.x >= 0 && edge.x < plan.cols && edge.y >= 0 && edge.y <= plan.rows;
  }
  return edge.y >= 0 && edge.y < plan.rows && edge.x >= 0 && edge.x <= plan.cols;
}

/** Применяет штрих к планировке и возвращает новую планировку. */
export function applyPlanStroke(
  base: RentFloorPlan,
  stroke: PlanStroke,
  options: { autoWalls?: boolean } = {}
): RentFloorPlan {
  if (stroke.kind === "edge") {
    const from = Math.min(stroke.from, stroke.to);
    const to = Math.max(stroke.from, stroke.to);
    const wallMap = new Map<string, RentPlanEdge>(base.walls.map((w) => [edgeKey(w), w]));
    const openMap = new Map<string, RentPlanEdge & { kind: RentOpeningKind }>(
      base.openings.map((o) => [edgeKey(o), o])
    );
    for (let i = from; i <= to; i += 1) {
      const edge: RentPlanEdge =
        stroke.axis === "h" ? { x: i, y: stroke.line, o: "h" } : { x: stroke.line, y: i, o: "v" };
      if (!isEdgeInside(base, edge)) continue;
      const key = edgeKey(edge);
      if (stroke.tool === "erase") {
        wallMap.delete(key);
        openMap.delete(key);
      } else if (stroke.tool === "wall") {
        openMap.delete(key);
        wallMap.set(key, edge);
      } else {
        wallMap.delete(key);
        openMap.set(key, {
          ...edge,
          kind: stroke.tool === "door" ? "door" : stroke.tool === "window" ? "window" : "gate",
        });
      }
    }
    return { ...base, walls: [...wallMap.values()], openings: [...openMap.values()] };
  }

  if (stroke.kind === "erase-cells") {
    if (stroke.visited.length === 0) return base;
    const used = new Set(stroke.visited);
    const rooms = base.rooms
      .map((r) => ({ ...r, cells: r.cells.filter((c) => !used.has(c)) }))
      .filter((r) => r.cells.length > 0);
    return { ...base, rooms };
  }

  if (stroke.kind === "room") {
    const x0 = Math.min(stroke.a.x, stroke.b.x);
    const y0 = Math.min(stroke.a.y, stroke.b.y);
    const x1 = Math.max(stroke.a.x, stroke.b.x);
    const y1 = Math.max(stroke.a.y, stroke.b.y);
    const cells: number[] = [];
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) cells.push(cellIndex(base.cols, x, y));
    }
    if (cells.length === 0) return base;
    const used = new Set(cells);
    const rooms = base.rooms
      .map((r) => ({ ...r, cells: r.cells.filter((c) => !used.has(c)) }))
      .filter((r) => r.cells.length > 0);
    const room: RentPlanRoom = {
      id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label: `Помещение ${base.rooms.length + 1}`,
      cells: normalizeCells(cells, base.cols, base.rows),
      tenantId: null,
      color: null,
      comment: null,
    };
    rooms.push(room);
    let next: RentFloorPlan = { ...base, rooms };
    if (options.autoWalls) next = withAutoWalls(next, room.id);
    return next;
  }

  if (stroke.kind === "move-room") {
    return moveRoomBy(base, stroke.roomId, stroke.dx, stroke.dy);
  }

  return base;
}

/** Сдвиг помещения на dx/dy клеток с ограничением по границам сетки. */
export function moveRoomBy(plan: RentFloorPlan, roomId: string, dx: number, dy: number): RentFloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || room.cells.length === 0) return plan;
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
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const cx = Math.max(-x0, Math.min(dx, plan.cols - (x0 + w)));
  const cy = Math.max(-y0, Math.min(dy, plan.rows - (y0 + h)));
  if (cx === 0 && cy === 0) return plan;

  const occupied = new Set<number>();
  for (const r of plan.rooms) {
    if (r.id === room.id) continue;
    for (const c of r.cells) occupied.add(c);
  }
  const shifted = room.cells
    .map((c) => {
      const { x, y } = cellFromIndex(plan.cols, c);
      return cellIndex(plan.cols, x + cx, y + cy);
    })
    .filter((c) => !occupied.has(c));
  if (shifted.length === 0) return plan;
  const rooms = plan.rooms.map((r) =>
    r.id === room.id ? { ...r, cells: normalizeCells(shifted, plan.cols, plan.rows) } : r
  );
  return { ...plan, rooms };
}

/** Обводит помещение стенами по периметру, убирая стены внутри него. */
export function withAutoWalls(plan: RentFloorPlan, roomId: string): RentFloorPlan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || room.cells.length === 0) return plan;
  const own = new Set(room.cells);
  const perimeter = regionPerimeterCells(room.cells, plan.cols, plan.rows);
  const wallMap = new Map<string, RentPlanEdge>();
  for (const w of plan.walls) {
    const key = edgeKey(w);
    if (w.o === "h") {
      const above = w.y > 0 ? cellIndex(plan.cols, w.x, w.y - 1) : -1;
      const below = w.y < plan.rows ? cellIndex(plan.cols, w.x, w.y) : -1;
      if (above >= 0 && below >= 0 && own.has(above) && own.has(below)) continue;
    } else {
      const left = w.x > 0 ? cellIndex(plan.cols, w.x - 1, w.y) : -1;
      const right = w.x < plan.cols ? cellIndex(plan.cols, w.x, w.y) : -1;
      if (left >= 0 && right >= 0 && own.has(left) && own.has(right)) continue;
    }
    wallMap.set(key, w);
  }
  for (const e of perimeter) wallMap.set(edgeKey(e), e);
  const openings = plan.openings.filter((o) => {
    if (o.o === "h") {
      const above = o.y > 0 ? cellIndex(plan.cols, o.x, o.y - 1) : -1;
      const below = o.y < plan.rows ? cellIndex(plan.cols, o.x, o.y) : -1;
      return !(above >= 0 && below >= 0 && own.has(above) && own.has(below));
    }
    const left = o.x > 0 ? cellIndex(plan.cols, o.x - 1, o.y) : -1;
    const right = o.x < plan.cols ? cellIndex(plan.cols, o.x, o.y) : -1;
    return !(left >= 0 && right >= 0 && own.has(left) && own.has(right));
  });
  return { ...plan, walls: [...wallMap.values()], openings };
}

/** Внешний контур этажа (стены по периметру сетки). */
export function withPerimeterWalls(plan: RentFloorPlan): RentFloorPlan {
  const wallMap = new Map<string, RentPlanEdge>(plan.walls.map((w) => [edgeKey(w), w]));
  for (let x = 0; x < plan.cols; x += 1) {
    wallMap.set(edgeKey({ x, y: 0, o: "h" }), { x, y: 0, o: "h" });
    wallMap.set(edgeKey({ x, y: plan.rows, o: "h" }), { x, y: plan.rows, o: "h" });
  }
  for (let y = 0; y < plan.rows; y += 1) {
    wallMap.set(edgeKey({ x: 0, y, o: "v" }), { x: 0, y, o: "v" });
    wallMap.set(edgeKey({ x: plan.cols, y, o: "v" }), { x: plan.cols, y, o: "v" });
  }
  return { ...plan, walls: [...wallMap.values()] };
}

/**
 * Автонарезка: одинаковые помещения со стенами, контуром и дверями.
 * Быстрый старт, когда нужно «расчертить» этаж за один клик.
 */
export function buildAutoPartition(plan: RentFloorPlan, options?: { roomsAcross?: number }): RentFloorPlan {
  const { cols, rows } = plan;
  const margin = 2;
  const gap = 3;
  const innerW = cols - margin * 2;
  const innerH = rows - margin * 2;
  const nx = options?.roomsAcross ?? Math.max(2, Math.floor(innerW / 10));
  const ny = Math.max(1, Math.floor(innerH / 9));
  const roomW = Math.floor((innerW - gap * (nx - 1)) / nx);
  const roomH = Math.floor((innerH - gap * (ny - 1)) / ny);
  if (roomW < 3 || roomH < 3) return plan;

  const rooms: RentPlanRoom[] = [];
  let counter = 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      counter += 1;
      const x0 = margin + i * (roomW + gap);
      const y0 = margin + j * (roomH + gap);
      const cells: number[] = [];
      for (let y = y0; y < y0 + roomH; y += 1) {
        for (let x = x0; x < x0 + roomW; x += 1) cells.push(cellIndex(cols, x, y));
      }
      rooms.push({
        id: `room-auto-${Date.now()}-${counter}`,
        label: `Помещение ${counter}`,
        cells,
        tenantId: null,
        color: null,
        comment: null,
      });
    }
  }

  const wallMap = new Map<string, RentPlanEdge>();
  const openMap = new Map<string, RentPlanEdge & { kind: RentOpeningKind }>();
  for (let x = 0; x < cols; x += 1) {
    wallMap.set(edgeKey({ x, y: 0, o: "h" }), { x, y: 0, o: "h" });
    wallMap.set(edgeKey({ x, y: rows, o: "h" }), { x, y: rows, o: "h" });
  }
  for (let y = 0; y < rows; y += 1) {
    wallMap.set(edgeKey({ x: 0, y, o: "v" }), { x: 0, y, o: "v" });
    wallMap.set(edgeKey({ x: cols, y, o: "v" }), { x: cols, y, o: "v" });
  }
  for (const room of rooms) {
    const perimeter = regionPerimeterCells(room.cells, cols, rows);
    for (const e of perimeter) wallMap.set(edgeKey(e), e);
    const bottom = perimeter.filter((e) => e.o === "h");
    if (bottom.length > 0) {
      const mid = bottom[Math.floor(bottom.length / 2)];
      openMap.set(edgeKey(mid), { ...mid, kind: "door" });
      wallMap.delete(edgeKey(mid));
    }
  }
  return { ...plan, walls: [...wallMap.values()], openings: [...openMap.values()], rooms };
}

/** Пустой этаж (с сохранением размеров сетки). */
export function clearPlan(plan: RentFloorPlan): RentFloorPlan {
  return { ...plan, walls: [], openings: [], rooms: [] };
}

/** Обрезка планировки под новую сетку (стены, проёмы, клетки помещений). */
export function fitPlanToGrid(
  plan: RentFloorPlan,
  cols: number,
  rows: number,
  cellSize: number
): RentFloorPlan {
  const base: RentFloorPlan = { ...plan, cols, rows, cellSize };
  return {
    ...base,
    walls: plan.walls.filter((w) => isEdgeInside(base, w)),
    openings: plan.openings.filter((o) => isEdgeInside(base, o)),
    rooms: plan.rooms
      .map((r) => ({ ...r, cells: normalizeCells(r.cells, cols, rows) }))
      .filter((r) => r.cells.length > 0),
  };
}

/** Пустая планировка этажа (для тестов и «на лету»). */
export function emptyPlan(buildingId: string, floor: number, cols = 40, rows = 24): RentFloorPlan {
  return createFloorPlan(buildingId, floor, { cols, rows });
}
