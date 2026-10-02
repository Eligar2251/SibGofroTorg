/**
 * geo.ts — плоская геометрия (всё в мм, ось Y направлена ВВЕРХ).
 * Никаких зависимостей: файл можно копировать в любой проект как есть.
 *
 * Соглашения:
 *  - полигон = замкнутый контур, точки против часовой стрелки (CCW) => площадь положительная;
 *  - отрезок = { a, b } + тип линии (рез / биговка / перфорация / техно / маркировка);
 *  - скругления и дуги аппроксимируются цепочкой отрезков (ARC_STEPS), что одинаково
 *   годно и для SVG, и для DXF (LWPOLYLINE), и для расчёта длины ножа.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type LineKind = 'cut' | 'crease' | 'perf' | 'tech' | 'mark';

export interface Seg {
  a: Vec2;
  b: Vec2;
  kind: LineKind;
  /** панель-владелец (для отладки и для 3D) */
  owner?: string;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const norm = (a: Vec2): Vec2 => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** перпендикуляр в плоскости (левая нормаль) */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function bboxOf(pts: Vec2[]): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (!pts.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

export function mergeBox(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export const boxW = (b: Box): number => b.x1 - b.x0;
export const boxH = (b: Box): number => b.y1 - b.y0;
export const boxAreaMm2 = (b: Box): number => boxW(b) * boxH(b);

export function shiftPoly(pts: Vec2[], dx: number, dy: number): Vec2[] {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** площадь CCW-полигона (знак = ориентация) */
export function signedArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const polyArea = (pts: Vec2[]): number => Math.abs(signedArea(pts));

/** гарантия CCW (для корректной площади и обхода) */
export function ensureCCW(pts: Vec2[]): Vec2[] {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts.slice();
}

export function rect(x: number, y: number, w: number, h: number): Vec2[] {
  return [v(x, y), v(x + w, y), v(x + w, y + h), v(x, y + h)];
}

/** трапеция: нижнее основание w0, верхнее w1, высота h, центрирована по x */
export function trapezoid(cx: number, y: number, w0: number, w1: number, h: number): Vec2[] {
  return [v(cx - w0 / 2, y), v(cx + w0 / 2, y), v(cx + w1 / 2, y + h), v(cx - w1 / 2, y + h)];
}

export function segsOfPoly(pts: Vec2[], kind: LineKind, owner?: string): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (dist(a, b) > 1e-6) out.push({ a, b, kind, owner });
  }
  return out;
}

export const segLen = (s: Seg): number => dist(s.a, s.b);

export const mid = (s: Seg): Vec2 => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });

/** ключ середины отрезка для дедупликации общих рёбер смежных панелей */
const keyOf = (s: Seg, tol: number): string => {
  const m = mid(s);
  return `${Math.round(m.x / tol)}:${Math.round(m.y / tol)}`;
};

/**
 * Общая ребро-детекция: возвращает true, если отрезок где-то уже встречается
 * (с точностью tol по середине и с точностью 1° по направлению).
 */
export function sameEdgeAs(list: Seg[], s: Seg, tol: number): boolean {
  const m = mid(s);
  const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
  for (const o of list) {
    const om = mid(o);
    if (Math.abs(om.x - m.x) > tol || Math.abs(om.y - m.y) > tol) continue;
    const oa = Math.atan2(o.b.y - o.a.y, o.b.x - o.a.x);
    let d = Math.abs(ang - oa) % Math.PI;
    if (d > Math.PI / 2) d = Math.PI - d;
    if (d < 0.02) return true;
  }
  return false;
}

/**
 * Склейка коллинеарных отрезков одного типа и слоя. Нужна, чтобы длина ножа
 * соответствовала реальному гнутому ножу в штампе (в CAD их тоже считают концевыми:
 * сумма длин после склейки == сумма до склейки, зато видна «нитка» ножа).
 */
export function mergeCollinear(segs: Seg[], tol = 0.05): Seg[] {
  const groups: Seg[][] = [];
  for (const s of segs) {
    const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
    let placed = false;
    for (const g of groups) {
      const head = g[0];
      const ha = Math.atan2(head.b.y - head.a.y, head.b.x - head.a.x);
      let d = Math.abs(ang - ha) % Math.PI;
      if (d > Math.PI / 2) d = Math.PI - d;
      if (d > 0.001) continue;
      // расстояние от s.a до прямой head
      const dir = norm(sub(head.b, head.a));
      const nrm = perp(dir);
      const off = Math.abs((s.a.x - head.a.x) * nrm.x + (s.a.y - head.a.y) * nrm.y);
      if (off > tol) continue;
      g.push(s);
      placed = true;
      break;
    }
    if (!placed) groups.push([s]);
  }
  const out: Seg[] = [];
  for (const g of groups) {
    const dir = norm(sub(g[0].b, g[0].a));
    const axis = (p: Vec2): number => (p.x - g[0].a.x) * dir.x + (p.y - g[0].a.y) * dir.y;
    const iv: Array<[number, number, LineKind, string | undefined]> = g.map((s) => {
      const a0 = axis(s.a);
      const a1 = axis(s.b);
      return [Math.min(a0, a1), Math.max(a0, a1), s.kind, s.owner];
    });
    iv.sort((p, q) => p[0] - q[0]);
    let cur: [number, number, LineKind, string | undefined] | null = null;
    for (const n of iv) {
      if (cur && n[0] <= cur[1] + tol) {
        cur[1] = Math.max(cur[1], n[1]);
      } else {
        if (cur) out.push(mkSeg(dir, g[0].a, cur));
        cur = [n[0], n[1], n[2], n[3]];
      }
    }
    if (cur) out.push(mkSeg(dir, g[0].a, cur));
  }
  return out;
}

function mkSeg(dir: Vec2, origin: Vec2, iv: [number, number, LineKind, string | undefined]): Seg {
  return {
    a: { x: origin.x + dir.x * iv[0], y: origin.y + dir.y * iv[0] },
    b: { x: origin.x + dir.x * iv[1], y: origin.y + dir.y * iv[1] },
    kind: iv[2],
    owner: iv[3],
  };
}

export function totalLen(segs: Seg[]): number {
  let s = 0;
  for (const x of segs) s += segLen(x);
  return s;
}

/** удалить дубликаты (общие рёбра, посчитанные дважды) */
export function dedupe(segs: Seg[], tol = 0.2): Seg[] {
  const seen = new Set<string>();
  const out: Seg[] = [];
  for (const s of segs) {
    const k = keyOf(s, tol) + ':' + s.kind;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * Скругление углов полигона. r<=0 — без скругления. steps — число сегментов дуги.
 * Возвращает новый полигон с подставленными дугами (полилиния).
 */
export const ARC_STEPS = 6;

export function roundCorners(pts: Vec2[], r: number, steps = ARC_STEPS): Vec2[] {
  if (r <= 0.01) return pts.slice();
  const n = pts.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const d1 = sub(prev, cur);
    const d2 = sub(next, cur);
    const l1 = Math.hypot(d1.x, d1.y);
    const l2 = Math.hypot(d2.x, d2.y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const u1 = mul(d1, 1 / l1);
    const u2 = mul(d2, 1 / l2);
    const cosA = u1.x * u2.x + u1.y * u2.y;
    const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
    if (ang < 0.02 || Math.PI - ang < 0.02) {
      out.push(cur);
      continue;
    }
    const t = Math.min(r, (l1 - 1e-6) / 2, (l2 - 1e-6) / 2, (l1 * Math.sin(ang / 2)) / 2);
    const tan = t / Math.tan(ang / 2);
    const p1 = { x: cur.x + u1.x * tan, y: cur.y + u1.y * tan };
    const p2 = { x: cur.x + u2.x * tan, y: cur.y + u2.y * tan };
    const bis = norm({ x: u1.x + u2.x, y: u1.y + u2.y });
    const rr = t;
    const c = { x: cur.x + bis.x * (t / Math.sin(ang / 2)), y: cur.y + bis.y * (t / Math.sin(ang / 2)) };
    const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
    let a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
    let delta = a2 - a1;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    out.push(p1);
    for (let k = 1; k < steps; k++) {
      const a = a1 + (delta * k) / steps;
      out.push({ x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr });
    }
    out.push(p2);
  }
  return out;
}

/** окружность/дуга как полилиния (для отверстий под ручку, окон, скруглений) */
export function circlePts(c: Vec2, r: number, steps = 24, a0 = 0, a1 = Math.PI * 2): Vec2[] {
  const out: Vec2[] = [];
  const n = Math.max(3, Math.round((steps * Math.abs(a1 - a0)) / (Math.PI * 2)) || 3);
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return out;
}

/**
 * Вырез-«язычок» (tuck tab): трапеция по центру отрезка [a..b], высотой h,
 * основанием w и со скруглёнными верхними углами.
 */
export function tabPoly(a: Vec2, b: Vec2, w: number, h: number, r: number): Vec2[] {
  const dir = norm(sub(b, a));
  const nrm = perp(dir);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const p1 = { x: cx - dir.x * w * 0.5, y: cy - dir.y * w * 0.5 };
  const p2 = { x: cx + dir.x * w * 0.5, y: cy + dir.y * w * 0.5 };
  const q1 = { x: p1.x + nrm.x * h, y: p1.y + nrm.y * h };
  const q2 = { x: p2.x + nrm.x * h, y: p2.y + nrm.y * h };
  // сужение к концу (классический язычок)
  const k = 0.16;
  const r1 = { x: q1.x + (q2.x - q1.x) * k, y: q1.y + (q2.y - q1.y) * k };
  const r2 = { x: q2.x - (q2.x - q1.x) * k, y: q2.y - (q2.y - q1.y) * k };
  return roundCorners([p1, p2, r2, r1], r);
}

/**
 * Удаление вырожденных рёбер (< minLen) и «сошедшихся» вершин после скругления.
 * Без этого roundCorners на остроугольном язычке даёт щели по 0.3 мм, которые
 * потом считаются как отдельные резы.
 */
export function cleanPoly(pts: Vec2[], minLen = 0.6): Vec2[] {
  let out = pts.slice();
  for (let pass = 0; pass < 3; pass++) {
    const next: Vec2[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      if (dist(a, b) < minLen) {
        if (dist(a, b) < minLen / 3) continue; // точки слипаются — выбрасываем a
        next.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        i++; // b «съеден»
        continue;
      }
      next.push(a);
    }
    out = next;
    if (out.length < 3) break;
  }
  // убираем почти-коллинейные точки (дуга, ставшая прямой)
  const res: Vec2[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const v1 = sub(b, a);
    const v2 = sub(c, b);
    const cross = v1.x * v2.y - v1.y * v2.x;
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (l1 * l2 > 1e-9 && Math.abs(cross) / (l1 * l2) < 0.008) continue;
    res.push(b);
  }
  return res.length >= 3 ? res : out;
}

export interface PolyPath {
  d: string;
}

/** SVG path из полигона (y переворачивается функцией transform у <g>) */
export function polyToPath(pts: Vec2[]): string {
  if (!pts.length) return '';
  let d = `M ${round3(pts[0].x)} ${round3(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${round3(pts[i].x)} ${round3(pts[i].y)}`;
  return d + ' Z';
}

export function segsToPath(segs: Seg[]): string {
  let d = '';
  for (const s of segs) d += `M ${round3(s.a.x)} ${round3(s.a.y)} L ${round3(s.b.x)} ${round3(s.b.y)}`;
  return d;
}

/**
 * Копии заготовки на штампе (2-up, 4-up …): слой реза/биговки тиражируется
 * по X с шагом «ширина заготовки + diePitch». Слои рамки (mark/tech) уже
 * нарисованы по всему штампу и не тиражируются.
 */
export function tileSegs(segs: Seg[], perDie: number, step: number): Seg[] {
  const n = Math.max(1, Math.round(perDie || 1));
  if (n <= 1 || step <= 0) return segs;
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const dx = i * step;
    for (const s of segs) {
      out.push({ a: { x: s.a.x + dx, y: s.a.y }, b: { x: s.b.x + dx, y: s.b.y }, kind: s.kind });
    }
  }
  return out;
}
