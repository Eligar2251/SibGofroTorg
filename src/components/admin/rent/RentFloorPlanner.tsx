// =========================================================
// FILE: src/components/admin/rent/RentFloorPlanner.tsx
// Планировщик этажа «по клеткам» — как редактор карт для D&D,
// но для схем зданий:
//   • инструменты: выбор/перемещение, стена, дверь, окно, ворота,
//     помещение, ластик;
//   • сетка клеток, зум, автообводка помещений стенами, автонарезка;
//   • отмена/повтор, привязка арендаторов, площади по клеткам;
//   • режим «Просмотр» (публикация) — чистая схема без линий сетки:
//     только стены, двери, окна и заливки помещений;
//   • экспорт PNG, печать.
// =========================================================

"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Ban,
  DoorOpen,
  Eraser,
  Grid3x3,
  Hand,
  Image as ImageIcon,
  Maximize2,
  MousePointer2,
  Move,
  PanelTop,
  Printer,
  Redo2,
  Square,
  Trash2,
  Undo2,
  Users,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  computeTenantState,
  rentFmt,
  rentPeriodLabel,
  type RentInvoice,
  type RentTenant,
} from "@/lib/rent-shared";
import {
  cellFromIndex,
  cellIndex,
  roomArea,
  roomBounds,
  type RentFloorPlan,
  type RentPlanEdge,
  type RentPlanRoom,
} from "@/lib/rent-building";
import {
  applyPlanStroke,
  buildAutoPartition,
  clearPlan,
  moveRoomBy,
  withPerimeterWalls,
  type PlanStroke,
} from "@/lib/rent-plan-ops";

export type PlannerTool = "select" | "wall" | "door" | "window" | "gate" | "room" | "erase";

type Pt = { x: number; y: number };

type Stroke = PlanStroke & { base: RentFloorPlan; origin?: Pt };

const VACANT_FILL = "#eef2f7";

const ROOM_COLORS: { id: string; name: string; fill: string; line: string }[] = [
  { id: "slate", name: "Нейтральный", fill: "#eef2f7", line: "#c3ccd8" },
  { id: "pine", name: "Зелёный", fill: "#e8f4ec", line: "#a3c9af" },
  { id: "steel", name: "Синий", fill: "#e8eef6", line: "#a8bedb" },
  { id: "kraft", name: "Янтарный", fill: "#fdf3dc", line: "#e2c98a" },
  { id: "rust", name: "Терракот", fill: "#fdeceb", line: "#e9b4a8" },
  { id: "teal", name: "Бирюзовый", fill: "#e9f6f6", line: "#9ae0e0" },
  { id: "violet", name: "Сиреневый", fill: "#f1eefc", line: "#c5bdf2" },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function paletteForColor(color?: string | null): { fill: string; line: string } {
  const found = ROOM_COLORS.find((c) => c.id === color);
  if (found) return { fill: found.fill, line: found.line };
  if (color && /^#[0-9a-f]{3,8}$/i.test(color)) return { fill: color, line: "#b9c2cd" };
  return { fill: VACANT_FILL, line: "#c3ccd8" };
}

/** Отрезки границы набора клеток — тонкие контуры помещений. */
function boundarySegments(cells: number[], cols: number, rows: number) {
  const set = new Set(cells);
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const c of cells) {
    const { x, y } = cellFromIndex(cols, c);
    if (y === 0 || !set.has(cellIndex(cols, x, y - 1))) out.push({ x1: x, y1: y, x2: x + 1, y2: y });
    if (y === rows - 1 || !set.has(cellIndex(cols, x, y + 1)))
      out.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 });
    if (x === 0 || !set.has(cellIndex(cols, x - 1, y))) out.push({ x1: x, y1: y, x2: x, y2: y + 1 });
    if (x === cols - 1 || !set.has(cellIndex(cols, x + 1, y)))
      out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
  }
  return out;
}

export function RentFloorPlanner({
  plan,
  onChange,
  readOnly,
  mode,
  tenants,
  invoices,
  today,
  selectedRoomId,
  onSelectRoom,
}: {
  plan: RentFloorPlan;
  onChange: (next: RentFloorPlan, options?: { history?: boolean; markDirty?: boolean }) => void;
  readOnly: boolean;
  mode: "edit" | "view";
  tenants: RentTenant[];
  invoices: RentInvoice[];
  today: string;
  selectedRoomId: string | null;
  onSelectRoom: (id: string | null) => void;
}) {
  const editing = mode === "edit" && !readOnly;
  const [tool, setTool] = useState<PlannerTool>("select");
  const [cellPx, setCellPx] = useState(26);
  const [showGrid, setShowGrid] = useState(true);
  const [autoWalls, setAutoWalls] = useState(true);
  const [hoverCell, setHoverCell] = useState<Pt | null>(null);
  const [draft, setDraft] = useState<{ a: Pt; b: Pt } | null>(null);
  const [pastLen, setPastLen] = useState(0);
  const [futureLen, setFutureLen] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const pastRef = useRef<RentFloorPlan[]>([]);
  const futureRef = useRef<RentFloorPlan[]>([]);

  const planRef = useRef(plan);

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const tenantById = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants]);
  const selectedRoom = useMemo(
    () => plan.rooms.find((r) => r.id === selectedRoomId) || null,
    [plan.rooms, selectedRoomId]
  );

  /* ─────────────── состояние помещения (долг/просрочка) ─────────────── */

  const roomState = (room: RentPlanRoom) => {
    if (!room.tenantId) return null;
    const tenant = tenantById.get(room.tenantId);
    if (!tenant) return null;
    return computeTenantState(tenant, invoices, today);
  };

  const roomPalette = (room: RentPlanRoom) => {
    if (room.color) return paletteForColor(room.color);
    if (!room.tenantId) return { fill: VACANT_FILL, line: "#c3ccd8" };
    const st = roomState(room);
    if (st && st.overdue > 0) return { fill: "#fdeceb", line: "#e9b4a8" };
    if (st && st.debt > 0) return { fill: "#fdf3dc", line: "#e2c98a" };
    return { fill: "#e8f4ec", line: "#a3c9af" };
  };

  /* ─────────────────────────── история ─────────────────────────── */

  function pushHistory(snapshot: RentFloorPlan) {
    pastRef.current = [...pastRef.current.slice(-59), snapshot];
    futureRef.current = [];
    setPastLen(pastRef.current.length);
    setFutureLen(0);
  }

  function commit(next: RentFloorPlan, markDirty = true) {
    onChange(next, { history: false, markDirty });
  }

  function undo() {
    if (pastRef.current.length === 0) return;
    const stack = [...pastRef.current];
    const prev = stack.pop() as RentFloorPlan;
    pastRef.current = stack;
    futureRef.current = [planRef.current, ...futureRef.current].slice(0, 60);
    setPastLen(stack.length);
    setFutureLen(futureRef.current.length);
    commit(prev);
  }

  function redo() {
    if (futureRef.current.length === 0) return;
    const [next, ...rest] = futureRef.current;
    futureRef.current = rest;
    pastRef.current = [...pastRef.current.slice(-59), planRef.current];
    setPastLen(pastRef.current.length);
    setFutureLen(rest.length);
    commit(next);
  }

  /* ─────────────────────────── рисование ─────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const px = cellPx;
    const W = plan.cols * px;
    const H = plan.rows * px;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const showGridNow = editing && showGrid;
    const wallColor = "#2f3a45";
    const wallW = clamp(px * 0.18, 2.5, 7);

    // «бумага»
    ctx.fillStyle = showGridNow ? "#fcfbf8" : "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // заливки помещений
    for (const room of plan.rooms) {
      ctx.fillStyle = roomPalette(room).fill;
      for (const c of room.cells) {
        const { x, y } = cellFromIndex(plan.cols, c);
        ctx.fillRect(x * px, y * px, px, px);
      }
    }

    // тонкие контуры помещений (структура без «клетчатости»)
    ctx.lineWidth = 1;
    for (const room of plan.rooms) {
      ctx.strokeStyle = roomPalette(room).line;
      for (const s of boundarySegments(room.cells, plan.cols, plan.rows)) {
        ctx.beginPath();
        ctx.moveTo(s.x1 * px, s.y1 * px);
        ctx.lineTo(s.x2 * px, s.y2 * px);
        ctx.stroke();
      }
    }

    // сетка — только в редакторе
    if (showGridNow) {
      ctx.lineWidth = 1;
      for (let x = 0; x <= plan.cols; x += 1) {
        ctx.strokeStyle = x % 5 === 0 ? "rgba(120,130,145,.30)" : "rgba(150,160,175,.16)";
        ctx.beginPath();
        ctx.moveTo(Math.round(x * px) + 0.5, 0);
        ctx.lineTo(Math.round(x * px) + 0.5, H);
        ctx.stroke();
      }
      for (let y = 0; y <= plan.rows; y += 1) {
        ctx.strokeStyle = y % 5 === 0 ? "rgba(120,130,145,.30)" : "rgba(150,160,175,.16)";
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y * px) + 0.5);
        ctx.lineTo(W, Math.round(y * px) + 0.5);
        ctx.stroke();
      }
    }

    // черновик прямоугольника помещения
    if (draft) {
      const rx0 = Math.min(draft.a.x, draft.b.x);
      const ry0 = Math.min(draft.a.y, draft.b.y);
      const rw = Math.abs(draft.a.x - draft.b.x) + 1;
      const rh = Math.abs(draft.a.y - draft.b.y) + 1;
      ctx.fillStyle = "rgba(200,134,10,.16)";
      ctx.fillRect(rx0 * px, ry0 * px, rw * px, rh * px);
      ctx.strokeStyle = "#c8860a";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(rx0 * px, ry0 * px, rw * px, rh * px);
      ctx.setLineDash([]);
    }

    // стены
    ctx.strokeStyle = wallColor;
    ctx.lineWidth = wallW;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (const w of plan.walls) {
      if (w.o === "h") {
        ctx.moveTo(w.x * px, w.y * px);
        ctx.lineTo((w.x + 1) * px, w.y * px);
      } else {
        ctx.moveTo(w.x * px, w.y * px);
        ctx.lineTo(w.x * px, (w.y + 1) * px);
      }
    }
    ctx.stroke();
    ctx.lineCap = "butt";

    // проёмы
    for (const op of plan.openings) {
      const isH = op.o === "h";
      const x1 = op.x * px;
      const y1 = op.y * px;
      const x2 = isH ? (op.x + 1) * px : op.x * px;
      const y2 = isH ? op.y * px : (op.y + 1) * px;
      const L = px;
      // «прорезаем» стену и бежим от края до края
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = wallW + 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (op.kind === "window") {
        ctx.strokeStyle = "#2b6cb0";
        ctx.lineWidth = Math.max(1.5, wallW * 0.34);
        const off = Math.max(2, wallW * 0.5);
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          if (isH) {
            ctx.moveTo(x1 + L * 0.06, y1 + dir * off);
            ctx.lineTo(x2 - L * 0.06, y2 + dir * off);
          } else {
            ctx.moveTo(x1 + dir * off, y1 + L * 0.06);
            ctx.lineTo(x2 + dir * off, y2 - L * 0.06);
          }
          ctx.stroke();
        }
        ctx.strokeStyle = "#9ec3e0";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (op.kind === "gate") {
        ctx.strokeStyle = "#0d7377";
        ctx.lineWidth = Math.max(1.5, wallW * 0.4);
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // дверь: полотно + дуга открывания
        const leafLen = L * 0.76;
        const hx = isH ? x1 + L * 0.12 : x1;
        const hy = isH ? y1 : y1 + L * 0.12;
        const nx = isH ? 0 : 1;
        const ny = isH ? 1 : 0;
        ctx.strokeStyle = "#b83a1e";
        ctx.lineWidth = Math.max(1.6, wallW * 0.42);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + nx * leafLen, hy + ny * leafLen);
        ctx.stroke();
        ctx.strokeStyle = "rgba(184,58,30,.45)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const start = isH ? 0 : Math.PI / 2;
        ctx.arc(hx, hy, leafLen, start, start + Math.PI / 2);
        ctx.stroke();
      }
    }

    // подписи помещений
    for (const room of plan.rooms) {
      const b = roomBounds(plan, room);
      const bw = b.w * px;
      const bh = b.h * px;
      if (bw < 42 || bh < 30) continue;
      const tenant = room.tenantId ? tenantById.get(room.tenantId) : null;
      const st = roomState(room);
      const cx = (b.x0 + b.w / 2) * px;
      const cy = (b.y0 + b.h / 2) * px;
      const area = roomArea(plan, room);
      const titleSize = clamp(Math.min(bw / 9, bh / 6), 9, 15);
      const subSize = clamp(titleSize * 0.82, 8, 12);
      const lines: { text: string; font: string; color: string }[] = [
        {
          text: room.label,
          font: `800 ${titleSize}px Inter, system-ui, sans-serif`,
          color: "#1f2833",
        },
      ];
      if (tenant) {
        const debtText =
          st && st.overdue > 0
            ? `просрочка ${rentFmt(st.overdue)} ₽`
            : st && st.debt > 0
              ? `долг ${rentFmt(st.debt)} ₽`
              : null;
        lines.push({
          text: tenant.name,
          font: `600 ${subSize}px Inter, system-ui, sans-serif`,
          color: debtText ? (st && st.overdue > 0 ? "#b83a1e" : "#96650a") : "#3d4a58",
        });
        if (debtText) {
          lines.push({
            text: debtText,
            font: `700 ${subSize * 0.92}px Inter, system-ui, sans-serif`,
            color: "#b83a1e",
          });
        }
      }
      if (area > 0) {
        lines.push({
          text: `${area} м²`,
          font: `500 ${subSize * 0.9}px Inter, system-ui, sans-serif`,
          color: "#7a8798",
        });
      }
      const step = titleSize * 0.95;
      const totalH = lines.length * step + (lines.length - 1) * (subSize * 0.35);
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x0 * px + 1, b.y0 * px + 1, bw - 2, bh - 2);
      ctx.clip();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let ty = cy - totalH / 2 + step / 2;
      for (const line of lines) {
        ctx.font = line.font;
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, cx, ty, bw - 8);
        ty += step + subSize * 0.35;
      }
      ctx.restore();
    }

    // выделение
    if (selectedRoom) {
      ctx.strokeStyle = "#1f2833";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      for (const c of selectedRoom.cells) {
        const { x, y } = cellFromIndex(plan.cols, c);
        ctx.strokeRect(x * px + 1, y * px + 1, px - 2, px - 2);
      }
      ctx.setLineDash([]);
    }

    // подсветка клетки под курсором
    if (editing && hoverCell) {
      ctx.strokeStyle = tool === "erase" ? "rgba(184,58,30,.75)" : "rgba(30,58,90,.7)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(hoverCell.x * px + 0.5, hoverCell.y * px + 0.5, px - 1, px - 1);
      ctx.setLineDash([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellPx, draft, editing, hoverCell, plan, selectedRoom, showGrid, tenantById, tool, invoices, today]);

  // автоподбор масштаба под ширину контейнера
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fit = () => {
      const width = el.clientWidth - 4;
      if (width > 60) {
        setCellPx((prev) => {
          const next = clamp(width / planRef.current.cols, 8, 40);
          return Math.abs(next - prev) < 0.8 ? prev : next;
        });
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ────────────────────── геометрия указателя ────────────────────── */

  function pointFrom(clientX: number, clientY: number): Pt {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = rect.width / planRef.current.cols;
    return { x: (clientX - rect.left) / px, y: (clientY - rect.top) / px };
  }

  function pickEdge(p: Pt, maxDist = 0.42): RentPlanEdge | null {
    const { cols, rows } = planRef.current;
    const cx = clamp(p.x, 0, cols - 0.001);
    const cy = clamp(p.y, 0, rows - 0.001);
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    const fx = cx - x;
    const fy = cy - y;
    let best: RentPlanEdge | null = null;
    let bestD = maxDist;
    const consider = (edge: RentPlanEdge, dist: number) => {
      if (dist < bestD) {
        bestD = dist;
        best = edge;
      }
    };
    consider({ x, y, o: "h" }, fy);
    if (y + 1 <= rows) consider({ x, y: y + 1, o: "h" }, 1 - fy);
    consider({ x, y, o: "v" }, fx);
    if (x + 1 <= cols) consider({ x: x + 1, y, o: "v" }, 1 - fx);
    return best;
  }

  function cellFromPoint(p: Pt): Pt {
    const { cols, rows } = planRef.current;
    return {
      x: clamp(Math.floor(p.x), 0, cols - 1),
      y: clamp(Math.floor(p.y), 0, rows - 1),
    };
  }

  function roomAtCell(cell: number): RentPlanRoom | null {
    const rooms = planRef.current.rooms;
    for (let i = rooms.length - 1; i >= 0; i -= 1) {
      if (rooms[i].cells.includes(cell)) return rooms[i];
    }
    return null;
  }

  /* ─────────────────── применение хода (штриха) ─────────────────── */

  /** Применяет штрих к базовой планировке через чистые операции. */
  function runStroke(stroke: Stroke): RentFloorPlan {
    return applyPlanStroke(stroke.base, stroke, { autoWalls: autoWalls && !readOnly });
  }

  function nudge(roomId: string, dx: number, dy: number) {
    pushHistory(planRef.current);
    commit(moveRoomBy(planRef.current, roomId, dx, dy));
  }

  /* ───────────────────────── события указателя ───────────────────────── */

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const base = planRef.current;
    const p = pointFrom(e.clientX, e.clientY);

    if (!editing) {
      const cell = cellFromPoint(p);
      const room = roomAtCell(cellIndex(plan.cols, cell.x, cell.y));
      onSelectRoom(room ? room.id : null);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === "room") {
      const cell = cellFromPoint(p);
      const stroke: Stroke = { kind: "room", a: cell, b: cell, base };
      strokeRef.current = stroke;
      setDraft({ a: cell, b: cell });
      return;
    }

    if (tool === "select") {
      const cell = cellFromPoint(p);
      const room = roomAtCell(cellIndex(plan.cols, cell.x, cell.y));
      if (!room) {
        onSelectRoom(null);
        return;
      }
      onSelectRoom(room.id);
      pushHistory(base);
      strokeRef.current = { kind: "move-room", roomId: room.id, dx: 0, dy: 0, base, origin: cell };
      return;
    }

    const edge = pickEdge(p, tool === "erase" ? 0.42 : 0.6);
    if (tool === "erase") {
      pushHistory(base);
      if (edge) {
        const axis = edge.o;
        const start = axis === "h" ? edge.x : edge.y;
        const stroke: Stroke = {
          kind: "edge",
          tool: "erase",
          axis,
          line: axis === "h" ? edge.y : edge.x,
          from: start,
          to: start,
          base,
        };
        strokeRef.current = stroke;
        commit(runStroke(stroke));
        return;
      }
      const cell = cellFromPoint(p);
      const stroke: Stroke = {
        kind: "erase-cells",
        visited: [cellIndex(plan.cols, cell.x, cell.y)],
        base,
      };
      strokeRef.current = stroke;
      commit(runStroke(stroke));
      return;
    }

    if (!edge) return;
    pushHistory(base);
    const axis = edge.o;
    const start = axis === "h" ? edge.x : edge.y;
    const stroke: Stroke = {
      kind: "edge",
      tool,
      axis,
      line: axis === "h" ? edge.y : edge.x,
      from: start,
      to: start,
      base,
    };
    strokeRef.current = stroke;
    commit(runStroke(stroke));
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const p = pointFrom(e.clientX, e.clientY);
    const cell = cellFromPoint(p);
    setHoverCell((prev) => (prev && prev.x === cell.x && prev.y === cell.y ? prev : cell));

    const stroke = strokeRef.current;
    if (!stroke || !editing) return;

    if (stroke.kind === "room") {
      if (stroke.b.x === cell.x && stroke.b.y === cell.y) return;
      const next: Stroke = { ...stroke, b: cell };
      strokeRef.current = next;
      setDraft({ a: next.a, b: cell });
      return;
    }
    if (stroke.kind === "move-room") {
      const origin = stroke.origin || cell;
      const dx = cell.x - origin.x;
      const dy = cell.y - origin.y;
      if (stroke.dx === dx && stroke.dy === dy) return;
      const next: Stroke = { ...stroke, dx, dy };
      strokeRef.current = next;
      commit(runStroke(next));
      return;
    }
    if (stroke.kind === "edge") {
      const index = stroke.axis === "h" ? cell.x : cell.y;
      if (stroke.to === index) return;
      const next: Stroke = { ...stroke, to: index };
      strokeRef.current = next;
      commit(runStroke(next));
      return;
    }
    if (stroke.kind === "erase-cells") {
      const idx = cellIndex(plan.cols, cell.x, cell.y);
      if (stroke.visited.includes(idx)) return;
      const next: Stroke = { ...stroke, visited: [...stroke.visited, idx] };
      strokeRef.current = next;
      commit(runStroke(next));
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    if (!stroke || !editing) return;
    if (stroke.kind === "room") {
      setDraft(null);
      const cell = cellFromPoint(pointFrom(e.clientX, e.clientY));
      const final: Stroke = { kind: "room", a: stroke.a, b: cell, base: stroke.base };
      const next = runStroke(final);
      commit(next);
      const created = next.rooms.find((r) => !stroke.base.rooms.some((x) => x.id === r.id));
      if (created) onSelectRoom(created.id);
    }
  }

  /* ─────────────────── горячие клавиши ─────────────────── */

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedRoomId) return;
        e.preventDefault();
        removeRoom(selectedRoomId);
        return;
      }
      if (e.key === "Escape") {
        setTool("select");
        onSelectRoom(null);
        return;
      }
      if (e.key.startsWith("Arrow") && selectedRoomId) {
        e.preventDefault();
        const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        nudge(selectedRoomId, dx, dy);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selectedRoomId, plan]);

  /* ─────────────────────────── действия ─────────────────────────── */

  function patchRoom(id: string, patch: Partial<RentPlanRoom>, history = true) {
    if (history) pushHistory(planRef.current);
    commit({
      ...planRef.current,
      rooms: planRef.current.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }

  function removeRoom(id: string) {
    const room = planRef.current.rooms.find((r) => r.id === id);
    if (!room) return;
    if (!confirm(`Удалить «${room.label}» со схемы?`)) return;
    pushHistory(planRef.current);
    commit({ ...planRef.current, rooms: planRef.current.rooms.filter((r) => r.id !== id) });
    if (selectedRoomId === id) onSelectRoom(null);
  }

  function clearFloor() {
    if (!confirm("Очистить этаж: стены, проёмы и помещения?")) return;
    pushHistory(planRef.current);
    commit(clearPlan(planRef.current));
    onSelectRoom(null);
  }

  function drawPerimeter() {
    pushHistory(planRef.current);
    commit(withPerimeterWalls(planRef.current));
  }

  /** Быстрый старт: этаж нарезается на равные помещения со стенами и дверями. */
  function autoPartition() {
    if (
      !confirm(
        "Автонарезка: этаж будет разбит на одинаковые помещения со стенами, контуром и дверями. Текущие стены и помещения заменятся. Продолжить?"
      )
    )
      return;
    const next = buildAutoPartition(planRef.current);
    if (next.rooms.length === 0) {
      alert("Слишком мелкая сетка — увеличьте количество клеток этажа.");
      return;
    }
    pushHistory(planRef.current);
    commit(next);
    onSelectRoom(null);
  }

  function exportPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `plan-${plan.buildingId}-floor${plan.floor}.png`;
    a.click();
  }

  function printPlan() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL("image/png");
    const w = window.open("", "_blank", "width=1100,height=800");
    if (!w) return;
    w.document.write(
      `<html><head><title>План этажа ${plan.floor}</title><style>body{margin:0;display:grid;place-items:center;font-family:system-ui}img{max-width:100%;height:auto}</style></head><body><img src="${data}" onload="window.print()" /></body></html>`
    );
    w.document.close();
  }

  /* ───────────────────────────── UI ───────────────────────────── */

  const tools: { id: PlannerTool; label: string; icon: ReactNode; hint: string }[] = [
    {
      id: "select",
      label: "Выбор",
      icon: <MousePointer2 size={14} />,
      hint: "Выбрать помещение, перетащить его мышью; стрелки — сдвиг, Delete — удалить",
    },
    {
      id: "wall",
      label: "Стена",
      icon: <Square size={14} />,
      hint: "Ведите мышью вдоль клеток: влево/вправо — горизонтальная стена, вверх/вниз — вертикальная",
    },
    {
      id: "door",
      label: "Дверь",
      icon: <DoorOpen size={14} />,
      hint: "Клик или протяжка по стене — дверной проём",
    },
    {
      id: "window",
      label: "Окно",
      icon: <PanelTop size={14} />,
      hint: "Клик или протяжка по стене — окно",
    },
    {
      id: "gate",
      label: "Ворота",
      icon: <ArrowRight size={14} />,
      hint: "Клик или протяжка по стене — ворота/проезд",
    },
    {
      id: "room",
      label: "Помещение",
      icon: <Grid3x3 size={14} />,
      hint: "Протяните прямоугольник по клеткам — появится помещение с заливкой",
    },
    {
      id: "erase",
      label: "Ластик",
      icon: <Eraser size={14} />,
      hint: "Стирает стены/проёмы, а по заливке — убирает клетки помещений",
    },
  ];

  function statusChip(room: RentPlanRoom) {
    const tenant = room.tenantId ? tenantById.get(room.tenantId) : null;
    if (!tenant)
      return <span className="rfp-room-card__chip rfp-room-card__chip--free">свободно</span>;
    const st = roomState(room);
    if (st && st.overdue > 0)
      return (
        <span className="rfp-room-card__chip rfp-room-card__chip--overdue">
          просрочка {rentFmt(st.overdue)} ₽
        </span>
      );
    if (st && st.debt > 0)
      return (
        <span className="rfp-room-card__chip rfp-room-card__chip--debt">долг {rentFmt(st.debt)} ₽</span>
      );
    return <span className="rfp-room-card__chip rfp-room-card__chip--ok">без долга</span>;
  }

  const scaleLabel = `${plan.cols}×${plan.rows} клеток · ${Math.round(plan.cellSize * 100) / 100} м/клетка · ${Math.round(plan.cols * plan.cellSize * 10) / 10}×${Math.round(plan.rows * plan.cellSize * 10) / 10} м`;

  return (
    <div className="rfp">
      <div className="rfp__toolbar">
        {editing && (
          <div className="rfp__tools" role="toolbar" aria-label="Инструменты планировки">
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.hint}
                className={`rfp__tool${tool === t.id ? " rfp__tool--on" : ""}`}
                onClick={() => setTool(t.id)}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="rfp__toolbar-right">
          {editing && (
            <>
              <button
                type="button"
                className="rfp__icon-btn"
                title="Отменить (Ctrl+Z)"
                onClick={undo}
                disabled={pastLen === 0}
              >
                <Undo2 size={14} />
              </button>
              <button
                type="button"
                className="rfp__icon-btn"
                title="Повторить (Ctrl+Shift+Z)"
                onClick={redo}
                disabled={futureLen === 0}
              >
                <Redo2 size={14} />
              </button>
              <span className="rfp__sep" />
            </>
          )}
          <button
            type="button"
            className={`rfp__icon-btn${showGrid && editing ? " rfp__icon-btn--on" : ""}`}
            title={showGrid ? "Скрыть сетку клеток" : "Показать сетку клеток"}
            onClick={() => setShowGrid((v) => !v)}
            disabled={!editing}
          >
            <Grid3x3 size={14} />
          </button>
          <button
            type="button"
            className="rfp__icon-btn"
            title="Уменьшить"
            onClick={() => setCellPx((v) => clamp(v - 4, 8, 48))}
          >
            <ZoomOut size={14} />
          </button>
          <span className="rfp__zoom">{Math.round((cellPx / 26) * 100)}%</span>
          <button
            type="button"
            className="rfp__icon-btn"
            title="Увеличить"
            onClick={() => setCellPx((v) => clamp(v + 4, 8, 48))}
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            className="rfp__icon-btn"
            title="Вписать в экран"
            onClick={() => {
              const el = scrollRef.current;
              if (!el) return;
              setCellPx(clamp((el.clientWidth - 4) / plan.cols, 8, 40));
            }}
          >
            <Maximize2 size={14} />
          </button>
          <span className="rfp__sep" />
          <button type="button" className="rfp__icon-btn" title="Скачать PNG" onClick={exportPng}>
            <ImageIcon size={14} />
          </button>
          <button type="button" className="rfp__icon-btn" title="Печать" onClick={printPlan}>
            <Printer size={14} />
          </button>
        </div>
      </div>

      {editing && (
        <div className="rfp__subbar">
          <label className="rfp__check">
            <input
              type="checkbox"
              checked={autoWalls}
              onChange={(e) => setAutoWalls(e.target.checked)}
            />
            Обводить новые помещения стенами
          </label>
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={drawPerimeter}>
            <Square size={12} /> Контур этажа
          </button>
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={autoPartition}>
            <Wand2 size={12} /> Автонарезка на помещения
          </button>
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={clearFloor}>
            <Trash2 size={12} /> Очистить этаж
          </button>
          <span className="rfp__hint">{tools.find((t) => t.id === tool)?.hint}</span>
        </div>
      )}

      <div className="rfp__body">
        <div className="rfp__stage">
          <div className="rfp__scroll" ref={scrollRef}>
            <canvas
              ref={canvasRef}
              className={`rfp__canvas${editing ? " rfp__canvas--edit" : ""}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onMouseLeave={() => setHoverCell(null)}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
          <div className="rfp__statusbar">
            <span>{scaleLabel}</span>
            <span>Помещений: {plan.rooms.length}</span>
            <span>Стен: {plan.walls.length}</span>
            <span>Проёмов: {plan.openings.length}</span>
            {!editing && (
              <span className="rfp__statusbar-badge">
                <Hand size={12} /> {readOnly ? "режим просмотра" : "опубликованная схема"}
              </span>
            )}
          </div>
        </div>

        <aside className="rfp__panel">
          {selectedRoom ? (
            <div className="admin-card rfp__card">
              <div className="admin-card__head">
                <h3 className="admin-card__title">
                  <Square size={13} /> {selectedRoom.label}
                </h3>
                {editing && (
                  <button
                    type="button"
                    className="admin-btn admin-btn--icon admin-btn--ghost"
                    style={{ width: 28, height: 28 }}
                    title="Удалить помещение"
                    onClick={() => removeRoom(selectedRoom.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className="admin-card__pad rfp__fields">
                <div className="admin-field">
                  <label className="admin-label">Название</label>
                  <input
                    className="admin-input"
                    value={selectedRoom.label}
                    onChange={(e) => patchRoom(selectedRoom.id, { label: e.target.value }, false)}
                    onBlur={() => commit(planRef.current)}
                    disabled={!editing}
                    placeholder="Офис 214"
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Арендатор</label>
                  <select
                    className="admin-select"
                    value={selectedRoom.tenantId || ""}
                    onChange={(e) => patchRoom(selectedRoom.id, { tenantId: e.target.value || null })}
                    disabled={!editing}
                  >
                    <option value="">— свободно —</option>
                    {tenants
                      .filter((t) => t.status === "active" || t.id === selectedRoom.tenantId)
                      .map((t) => {
                        const st = computeTenantState(t, invoices, today);
                        const mark =
                          st.overdue > 0
                            ? `🔴 ${rentFmt(st.overdue)}`
                            : st.debt > 0
                              ? `🟡 ${rentFmt(st.debt)}`
                              : "";
                        return (
                          <option key={t.id} value={t.id}>
                            {t.name} {t.office ? `· ${t.office}` : ""} {mark}
                          </option>
                        );
                      })}
                  </select>
                </div>
                <div className="admin-grid-2">
                  <div className="admin-field">
                    <label className="admin-label">Площадь</label>
                    <input className="admin-input" value={`${roomArea(plan, selectedRoom)} м²`} readOnly />
                  </div>
                  <div className="admin-field">
                    <label className="admin-label">Клеток</label>
                    <input className="admin-input" value={selectedRoom.cells.length} readOnly />
                  </div>
                </div>
                <div className="admin-field">
                  <label className="admin-label">Заливка</label>
                  <div className="rfp__swatches">
                    <button
                      type="button"
                      className={`rfp__swatch${!selectedRoom.color ? " rfp__swatch--on" : ""}`}
                      title="Авто (по статусу арендатора)"
                      onClick={() => patchRoom(selectedRoom.id, { color: null })}
                      disabled={!editing}
                    >
                      <Ban size={12} />
                    </button>
                    {ROOM_COLORS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        title={c.name}
                        className={`rfp__swatch${selectedRoom.color === c.id ? " rfp__swatch--on" : ""}`}
                        style={{ background: c.fill, borderColor: c.line }}
                        onClick={() => patchRoom(selectedRoom.id, { color: c.id })}
                        disabled={!editing}
                      />
                    ))}
                  </div>
                </div>
                <div className="admin-field">
                  <label className="admin-label">Комментарий</label>
                  <textarea
                    className="admin-input rfp__textarea"
                    value={selectedRoom.comment || ""}
                    onChange={(e) => patchRoom(selectedRoom.id, { comment: e.target.value }, false)}
                    onBlur={() => commit(planRef.current)}
                    disabled={!editing}
                    placeholder="Например: вход со двора, отдельный счётчик"
                  />
                </div>
                {selectedRoom.tenantId &&
                  (() => {
                    const tenant = tenantById.get(selectedRoom.tenantId as string);
                    if (!tenant) return null;
                    const st = computeTenantState(tenant, invoices, today);
                    return (
                      <div className="rfp__tenant">
                        <div className="rfp__tenant-name">
                          <Users size={13} /> {tenant.name}
                        </div>
                        <div className="admin-muted" style={{ fontSize: 11 }}>
                          {[tenant.contactName, tenant.phone, tenant.email].filter(Boolean).join(" · ")}
                        </div>
                        <div className="rfp__tenant-badges">
                          <span
                            className={`admin-badge ${
                              st.overdue > 0
                                ? "admin-badge--red"
                                : st.debt > 0
                                  ? "admin-badge--amber"
                                  : "admin-badge--green"
                            }`}
                          >
                            {st.overdue > 0
                              ? `Просрочка ${rentFmt(st.overdue)} ₽`
                              : st.debt > 0
                                ? `Долг ${rentFmt(st.debt)} ₽`
                                : "Нет долга"}
                          </span>
                          <span className="admin-badge admin-badge--muted">
                            {rentFmt(tenant.monthlyRent)} ₽/мес
                          </span>
                          <span className="admin-badge admin-badge--muted">
                            {rentPeriodLabel(tenant.periodMonths)}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                {editing && (
                  <div className="rfp__nudge">
                    <span className="admin-label">Сдвиг</span>
                    <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => nudge(selectedRoom.id, 0, -1)}>↑</button>
                    <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => nudge(selectedRoom.id, -1, 0)}>←</button>
                    <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => nudge(selectedRoom.id, 1, 0)}>→</button>
                    <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => nudge(selectedRoom.id, 0, 1)}>↓</button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onSelectRoom(null)}
                    >
                      Готово
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="admin-card rfp__card">
              <div className="admin-card__head">
                <h3 className="admin-card__title">
                  <Move size={13} /> Помещения этажа
                </h3>
                <span className="admin-badge admin-badge--muted">{plan.rooms.length}</span>
              </div>
              <div className="admin-card__pad rfp__rooms">
                {plan.rooms.length === 0 ? (
                  <div className="admin-muted" style={{ fontSize: 12 }}>
                    {editing
                      ? "Инструментом «Помещение» протяните прямоугольник по сетке — или нажмите «Автонарезка на помещения»."
                      : "На этом этаже ещё не нарисованы помещения."}
                  </div>
                ) : (
                  plan.rooms.map((room) => {
                    const tenant = room.tenantId ? tenantById.get(room.tenantId) : null;
                    const pal = roomPalette(room);
                    return (
                      <button
                        key={room.id}
                        type="button"
                        className={`rfp-room-card${selectedRoomId === room.id ? " rfp-room-card--on" : ""}`}
                        onClick={() => {
                          onSelectRoom(room.id);
                          const b = roomBounds(plan, room);
                          const el = scrollRef.current;
                          if (el) {
                            el.scrollTo({
                              left: Math.max(0, (b.x0 + b.w / 2) * cellPx - el.clientWidth / 2),
                              top: Math.max(0, (b.y0 + b.h / 2) * cellPx - el.clientHeight / 2),
                              behavior: "smooth",
                            });
                          }
                        }}
                      >
                        <span
                          className="rfp-room-card__swatch"
                          style={{ background: pal.fill, borderColor: pal.line }}
                        />
                        <span className="rfp-room-card__main">
                          <span className="rfp-room-card__title">{room.label}</span>
                          <span className="rfp-room-card__sub">
                            {tenant ? tenant.name : "свободно"} · {roomArea(plan, room)} м²
                          </span>
                        </span>
                        {statusChip(room)}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
