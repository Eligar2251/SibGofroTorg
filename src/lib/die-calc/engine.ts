// Этот файл скопирован из tools/die-calc скриптом `node tools/die-calc/scripts/sync-site.mjs`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
/**
 * engine.ts — из панелей шаблона делает всё остальное: линии слоёв, габарит,
 * площадь, длины ножей, штамп, зеркало «лицо печати», раскладку по листу и цену.
 *
 * Точка входа для интеграции: `calcBox({ input, settings })` → CalcResult.
 */

import {
  bboxOf,
  boxAreaMm2,
  boxH,
  boxW,
  dedupe,
  ensureCCW,
  mergeCollinear,
  polyArea,
  segLen,
  signedArea,
  totalLen,
  type Box,
  type LineKind,
  type Seg,
  type Vec2,
} from './geo';
import {
  CONSTRUCTIONS,
  DEFAULT_PRICES,
  type AreaStats,
  type BoxInput,
  type BuiltGeom,
  type CalcResult,
  type KnifeStats,
  type Panel,
  type PriceSettings,
  type Profile,
  type SheetFormat,
} from './model';
import { buildBlank, buildBokovoy, buildTray, computeDims, rr } from './templates';
import { nestBlank } from './nesting';
import { costOf } from './cost';

export const KINDS: LineKind[] = ['cut', 'crease', 'perf', 'tech', 'mark'];

/** цвета слоёв — как в CAD-чертежах заказчика */
export const LAYER_COLOR: Record<LineKind, string> = {
  cut: '#1a7f37', // зелёный — рез
  crease: '#1849a9', // синий пунктир — биговка
  perf: '#c92a2a', // красный пунктир — перфорация
  tech: '#868e96', // серый — технологические ножи
  mark: '#228be6', // голубой — маркировка/рамка штампа
};

export const LAYER_NAME: Record<LineKind, string> = {
  cut: 'Рез',
  crease: 'Биговка',
  perf: 'Перфорация',
  tech: 'Техно-ножи',
  mark: 'Маркировка',
};

export const LAYER_DASH: Record<LineKind, string> = {
  cut: 'none',
  crease: '7 4',
  perf: '2.5 2.5',
  tech: 'none',
  mark: '12 3 2 3',
};

/**
 * панели → линии.
 *  · если ребро панели лежит на линии сгиба (своём или соседской панели) — это биговка;
 *  · всё остальное — рез;
 *  · общее ребро «панель ↔ родитель» не должно считаться дважды (иначе длина реза
 *    завышается на всю цепочку сгибов).
 * Углы панелей скруглены, поэтому проверка «лежит на линии», а не «совпало с вершиной».
 */
export function linesFromGeom(geom: BuiltGeom): Record<LineKind, Seg[]> {
  const out: Record<LineKind, Seg[]> = { cut: [], crease: [], perf: [], tech: [], mark: [] };
  const hinges: Seg[] = [];
  for (const p of geom.panels) if (p.hinge) hinges.push({ a: p.hinge.p, b: p.hinge.q, kind: 'crease', owner: p.id });

  const onHinge = (a: Vec2, b: Vec2): boolean => {
    for (const h of hinges) {
      if (onSegment(h, a, 0.4) && onSegment(h, b, 0.4)) {
        const e = Math.atan2(b.y - a.y, b.x - a.x);
        const g = Math.atan2(h.b.y - h.a.y, h.b.x - h.a.x);
        let d = Math.abs(e - g) % Math.PI;
        if (d > Math.PI / 2) d = Math.PI - d;
        if (d < 0.02) return true;
      }
    }
    return false;
  };

  for (const p of geom.panels) {
    const n = p.pts.length;
    for (let i = 0; i < n; i++) {
      const a = p.pts[i];
      const b = p.pts[(i + 1) % n];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.6) continue;
      const kind: LineKind = onHinge(a, b) ? 'crease' : 'cut';
      out[kind].push({ a, b, kind, owner: p.id });
    }
  }
  // сами линии сгиба добавляем целиком: скруглённые углы «съедают» пару мм с краёв,
  // а в штампе правило идёт на всю ширину панели
  out.crease.push(...hinges);
  for (const h of geom.holes) {
    const n = h.length;
    for (let i = 0; i < n; i++) out.cut.push({ a: h[i], b: h[(i + 1) % n], kind: 'cut', owner: 'hole' });
  }
  for (const s of geom.extra) out[s.kind].push(s);
  out.crease = mergeCollinear(out.crease, 0.05);
  out.cut = mergeCollinear(dedupe(out.cut, 0.25), 0.05);
  out.perf = mergeCollinear(dedupe(out.perf, 0.25), 0.05);
  return out;
}

/** лежит ли точка на отрезке (с допуском tol) */
function onSegment(s: Seg, p: Vec2, tol: number): boolean {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return Math.hypot(p.x - s.a.x, p.y - s.a.y) <= tol;
  let t = ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(s.a.x + t * dx - p.x, s.a.y + t * dy - p.y) <= tol;
}

export function allPoints(geom: BuiltGeom): Vec2[] {
  const pts: Vec2[] = [];
  for (const p of geom.panels) pts.push(...p.pts);
  for (const s of geom.extra) pts.push(s.a, s.b);
  for (const h of geom.holes) pts.push(...h);
  return pts;
}

/** наружный контур (для DXF/PDF): полигоны панелей + вырезы */
export function outlinesOf(geom: BuiltGeom): Vec2[][] {
  return geom.panels.map((p) => ensureCCW(p.pts)).concat(geom.holes.map(ensureCCW));
}

export function blankAreaMm2(geom: BuiltGeom): number {
  let s = 0;
  for (const p of geom.panels) s += Math.abs(signedArea(ensureCCW(p.pts)));
  for (const h of geom.holes) s -= Math.abs(signedArea(ensureCCW(h)));
  return Math.max(0, s);
}

export function transformGeom(geom: BuiltGeom, fn: (p: Vec2) => Vec2): BuiltGeom {
  return {
    ...geom,
    panels: geom.panels.map((p) => ({
      ...p,
      pts: p.pts.map(fn),
      hinge: p.hinge ? { p: fn(p.hinge.p), q: fn(p.hinge.q) } : undefined,
    })),
    extra: geom.extra.map((s) => ({ ...s, a: fn(s.a), b: fn(s.b) })),
    holes: geom.holes.map((h) => h.map(fn)),
  };
}

/** перенос в первый квадрант: (0,0) — левый нижний угол заготовки */
export function normalizeToOrigin(geom: BuiltGeom): BuiltGeom {
  const b = bboxOf(allPoints(geom));
  return transformGeom(geom, (p) => ({ x: rr(p.x - b.x0), y: rr(p.y - b.y0) }));
}

/** parent='wall-l' → реальный id 'wall-l#3' (для дерева сгиба в 3D) */
export function resolveParents(panels: Panel[]): Panel[] {
  const byPrefix = new Map<string, string>();
  for (const p of panels) {
    const pre = p.id.split('#')[0];
    if (!byPrefix.has(pre)) byPrefix.set(pre, p.id);
  }
  return panels.map((p) => {
    if (!p.parent) return p;
    const id = byPrefix.get(p.parent);
    return id ? { ...p, parent: id } : p;
  });
}

/** техно-уголки в мусорной зоне штампа (по вашим чертежам 4 шт ≈ 0,795 м) */
export function techCorners(die: Box, lenMm: number): Seg[] {
  const out: Seg[] = [];
  const leg = lenMm / 2;
  const inset = 10;
  const corners: Array<[number, number, number, number]> = [
    [die.x0 + inset, die.y0 + inset, 1, 1],
    [die.x1 - inset, die.y0 + inset, -1, 1],
    [die.x0 + inset, die.y1 - inset, 1, -1],
    [die.x1 - inset, die.y1 - inset, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    out.push({ a: { x, y }, b: { x: x + sx * leg, y }, kind: 'tech' });
    out.push({ a: { x, y }, b: { x, y: y + sy * leg }, kind: 'tech' });
  }
  return out;
}

/** рамка штампа + прямоугольник маркировки (у вас ~0,9 м на 250×200) */
export function dieMarks(die: Box, label: { w: number; h: number }): Seg[] {
  const out: Seg[] = [];
  const r: Vec2[] = [
    { x: die.x0, y: die.y0 },
    { x: die.x1, y: die.y0 },
    { x: die.x1, y: die.y1 },
    { x: die.x0, y: die.y1 },
  ];
  for (let i = 0; i < 4; i++) out.push({ a: r[i], b: r[(i + 1) % 4], kind: 'mark' });
  const lx = rr(Math.min(die.x0 + 12, die.x1 - label.w - 12));
  const ly = rr(Math.max(die.y0 + 12, die.y1 - 12 - label.h));
  const lb: Vec2[] = [
    { x: lx, y: ly },
    { x: rr(lx + label.w), y: ly },
    { x: rr(lx + label.w), y: rr(ly + label.h) },
    { x: lx, y: rr(ly + label.h) },
  ];
  for (let i = 0; i < 4; i++) out.push({ a: lb[i], b: lb[(i + 1) % 4], kind: 'mark' });
  return out;
}

/**
 * Длины ножей. `steelM` — с вычетом перемычек (nicks), т.е. реально сколько
 * стальной ленты пойдёт в штамп; `totalM` — как считает CAD (по геометрии).
 */
export function knifeStats(
  segs: Record<LineKind, Seg[]>,
  nickEvery: number,
  nickLen: number,
  dieLayers: boolean,
): KnifeStats {
  const byKind = {} as Record<LineKind, number>;
  const segCount = {} as Record<LineKind, number>;
  let steel = 0;
  for (const k of KINDS) {
    segCount[k] = segs[k].length;
    if (dieLayers && k === 'mark') continue;
    for (const s of segs[k]) {
      const l = segLen(s);
      const nicks = nickEvery > 0 && !(dieLayers && k === 'mark') ? Math.floor(l / nickEvery) : 0;
      steel += Math.max(0, l - nicks * nickLen);
    }
  }
  // byKind хранит мм; в поля *M идёт перевод в метры (3 знака, как в CAD)
  const m = (mm: number): number => Math.round(mm) / 1000;
  const mm = (n: number): number => Math.round(n);
  for (const k of KINDS) byKind[k] = mm(totalLen(segs[k]));
  const sum = byKind.cut + byKind.crease + byKind.perf + byKind.tech;
  return {
    cutM: m(byKind.cut),
    creaseM: m(byKind.crease),
    perfM: m(byKind.perf),
    techM: m(byKind.tech),
    markM: m(byKind.mark),
    totalM: m(sum),
    outlineM: m(byKind.cut),
    steelM: m(steel),
    byKind,
    segCount,
  };
}

export interface CalcSettings {
  profiles: Profile[];
  sheets: SheetFormat[];
  prices: PriceSettings;
  /** прямоугольник маркировки на штампе, мм */
  labelSize?: { w: number; h: number };
}

export interface CalcBoxInput {
  input: BoxInput;
  settings: CalcSettings;
}

export function defaultSettings(): CalcSettings {
  return { profiles: [], sheets: [], prices: DEFAULT_PRICES };
}

/**
 * Главная функция расчёта. Всё в мм; площади в м²; длины ножей в м.
 */
export function calcBox(args: CalcBoxInput): CalcResult {
  const settings = args.settings;
  const box = args.input;
  const profiles = settings.profiles.length ? settings.profiles : [];
  const profile = profiles.find((p) => p.id === box.profileId) ?? profiles[0];
  if (!profile) throw new Error('Не задан ни один профиль картона');
  const warnings: string[] = [];

  let geom: BuiltGeom;
  if (box.construction === 'blank') {
    geom = buildBlank(box.blankW && box.blankW > 20 ? box.blankW : 300, box.blankH && box.blankH > 20 ? box.blankH : 200, box.options);
  } else {
    const dims = computeDims(box.L, box.W, box.H, profile.thickness, box.coef, box.closure, box.options);
    geom = box.construction === 'bokovoy' ? buildBokovoy(dims) : buildTray(dims, box.construction);
  }

  geom = normalizeToOrigin(geom);
  if (box.options.mirror) {
    const b = bboxOf(allPoints(geom));
    geom = normalizeToOrigin(transformGeom(geom, (p) => ({ x: rr(b.x1 - p.x), y: p.y })));
  }
  geom = { ...geom, panels: resolveParents(geom.panels) };

  const raw = linesFromGeom(geom);
  const blankBox = bboxOf(allPoints(geom));
  const perDie = Math.max(1, Math.round(box.options.perDie || 1));
  const pitch = Math.max(0, box.options.diePitch);
  const fm = Math.max(0, box.die.frameMargin);
  const die: Box = {
    x0: 0,
    y0: 0,
    x1: rr(boxW(blankBox) * perDie + pitch * (perDie - 1) + fm * 2),
    y1: rr(boxH(blankBox) + fm * 2),
  };

  const segs: Record<LineKind, Seg[]> = {
    cut: raw.cut,
    crease: raw.crease,
    perf: raw.perf,
    tech: box.options.techCorners ? mergeCollinear(techCorners(shiftBox(die, -fm, -fm), box.die.techCornerLen)) : [],
    mark: mergeCollinear(dieMarks(shiftBox(die, -fm, -fm), labelBox(geom, die, fm, settings.labelSize))),
  };

  const knives = knifeStats(segs, box.die.nickEvery, box.die.nickLen, true);

  const holesArea = geom.holes.reduce((s, h) => s + polyArea(ensureCCW(h)), 0);
  const blankArea = blankAreaMm2(geom);
  const area: AreaStats = {
    blankW: Math.round(boxW(blankBox) * 10) / 10,
    blankH: Math.round(boxH(blankBox) * 10) / 10,
    bboxAreaM2: roundN(boxAreaMm2(blankBox) / 1e6, 4),
    blankAreaM2: roundN(blankArea / 1e6, 4),
    holesAreaM2: roundN(holesArea / 1e6, 5),
    fillInBbox: boxAreaMm2(blankBox) > 0 ? roundN(blankArea / boxAreaMm2(blankBox), 3) : 0,
    dieW: boxW(die),
    dieH: boxH(die),
    dieAreaM2: roundN(boxAreaMm2(die) / 1e6, 4),
  };
  if (box.construction !== 'blank' && box.blankArea && box.blankArea > 1000) {
    area.blankAreaM2 = roundN(box.blankArea / 1e6, 4);
    warnings.push('Площадь заготовки взята вручную из CAD — раскладка и цена считают по ней.');
  }

  const nest = nestBlank(
    { w: area.blankW, h: area.blankH, areaMm2: blankArea },
    box.nesting,
    settings.sheets,
    Math.max(1, box.qty),
  );
  if (nest.perSheet === 0) warnings.push('Ни одна заготовка не влезает в выбранный лист — возьмите лист больше или уменьшите коробку.');

  const cost = costOf({ box, profile, area, knives, nest, prices: settings.prices, perDie });

  validate(box, profile, warnings);
  warnings.push(...geom.warnings);

  return {
    input: box,
    geom,
    segs: ([] as Seg[]).concat(segs.cut, segs.crease, segs.perf, segs.tech, segs.mark),
    segMap: segs,
    bbox: blankBox,
    die,
    outline: outlinesOf(geom),
    area,
    knives,
    nest,
    cost,
    warnings: Array.from(new Set(warnings)),
  };
}

/**
 * Рамка под маркировку на штампе. В ваших чертежах она стоит в левом верхнем
 * углу плиты, поэтому размер урезается по свободному углу: ширину не даём
 * залезть на панель, высоту — на пыльник/клапан.
 */
function labelBox(geom: BuiltGeom, die: Box, fm: number, want?: { w: number; h: number }): { w: number; h: number } {
  const w0 = want?.w ?? 250;
  const h0 = want?.h ?? 200;
  const m = geom.meta as { xB?: number; yB?: number; Wp?: number } | undefined;
  const freeW = m?.xB ? rr(m.xB + fm - 24) : rr(die.x1 - 24);
  const freeH = m?.xB && m.yB !== undefined && m.Wp ? rr(die.y1 + fm - (m.yB + m.Wp) - 36) : rr(die.y1 + fm - 24);
  return { w: Math.max(48, Math.min(w0, freeW)), h: Math.max(30, Math.min(h0, freeH)) };
}

const shiftBox = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
const roundN = (n: number, d: number): number => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);

function validate(box: BoxInput, profile: Profile, warnings: string[]): void {
  const cons = CONSTRUCTIONS.find((c) => c.id === box.construction);
  if (box.construction !== 'blank') {
    if (box.L < 40 || box.W < 40) warnings.push('Минимальные размеры дна: L, W ≥ 40 мм — иначе клапаны не держат форму.');
    if (box.H < 12) warnings.push('Минимальная высота стенки: H ≥ 12 мм.');
    if (box.H > box.L * 2.5) warnings.push(`Высота больше длины в ${(box.H / Math.max(1, box.L)).toFixed(1)}× — держит форму только боковой замок.`);
    if (profile.thickness > 3 && box.H < 30) warnings.push(`Профиль ${profile.flute} (${profile.thickness} мм) плохо гнётся при H < 30 мм.`);
    if (cons && cons.closures.indexOf(box.closure) < 0) {
      warnings.push(`Конструкция «${cons.name}» редко делается с закрытием «${box.closure}» — проверьте.`);
    }
  }
  if (box.qty <= 0) warnings.push('Укажите тираж.');
}
