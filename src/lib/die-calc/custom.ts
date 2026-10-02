// Этот файл скопирован из tools/die-calc скриптом `node tools/die-calc/scripts/sync-site.mjs`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
/**
 * Своя штанцформа: произвольные контуры, ножи, биговки и размеры.
 * Координаты чертежа хранятся в миллиметрах, как на листе (Y вниз для удобства
 * рисования в SVG); перед расчётом геометрия нормализуется в начало координат.
 */

import { bboxOf, dedupe, mergeCollinear, polyArea, segLen, type LineKind, type Seg, type Vec2 } from './geo';
import { costOf } from './cost';
import { KINDS, knifeStats } from './engine';
import { nestBlank } from './nesting';
import type { CalcSettings } from './engine';
import type { AreaStats, BoxInput, BuiltGeom, CalcResult } from './model';

export type CustomLineKind = Exclude<LineKind, 'mark'>;
export type CustomPolygonRole = 'outline' | 'hole';

export interface CustomStroke {
  id: string;
  kind: CustomLineKind;
  a: Vec2;
  b: Vec2;
}

export interface CustomPolygon {
  id: string;
  name: string;
  role: CustomPolygonRole;
  points: Vec2[];
}

export interface CustomDimension {
  id: string;
  a: Vec2;
  b: Vec2;
  /** подпись размера; если пусто — показывается расстояние между точками */
  label?: string;
}

export interface CustomDrawing {
  version: 1;
  name: string;
  /** рабочая область редактора, мм */
  workspaceW: number;
  workspaceH: number;
  /** шаг координатной сетки, мм */
  gridStep: number;
  lines: CustomStroke[];
  polygons: CustomPolygon[];
  dimensions: CustomDimension[];
  /** точная площадь полигона из CAD, мм²; null — считать автоматически */
  areaOverrideMm2: number | null;
}

export function emptyCustomDrawing(): CustomDrawing {
  return {
    version: 1,
    name: 'Моя штанцформа',
    workspaceW: 600,
    workspaceH: 420,
    gridStep: 5,
    lines: [],
    polygons: [],
    dimensions: [],
    areaOverrideMm2: null,
  };
}

/** Валидация импорта .json и старых записей из базы. */
export function parseCustomDrawing(value: unknown): CustomDrawing | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const safeNumber = (n: unknown, fallback: number): number => {
    const v = typeof n === 'number' ? n : Number(n);
    return Number.isFinite(v) ? v : fallback;
  };
  const point = (v: unknown): Vec2 | null => {
    if (!v || typeof v !== 'object') return null;
    const p = v as Record<string, unknown>;
    const x = safeNumber(p.x, NaN);
    const y = safeNumber(p.y, NaN);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 100_000 && Math.abs(y) <= 100_000 ? { x, y } : null;
  };
  const id = (v: unknown, prefix: string, i: number): string => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, 100) : `${prefix}-${i + 1}`;
  };

  const lines: CustomStroke[] = Array.isArray(raw.lines)
    ? raw.lines.slice(0, 20_000).flatMap((item, i) => {
        if (!item || typeof item !== 'object') return [];
        const l = item as Record<string, unknown>;
        const a = point(l.a);
        const b = point(l.b);
        const kind = l.kind;
        if (!a || !b || !['cut', 'crease', 'perf', 'tech'].includes(String(kind))) return [];
        return [{ id: id(l.id, 'line', i), kind: kind as CustomLineKind, a, b }];
      })
    : [];

  const polygons: CustomPolygon[] = Array.isArray(raw.polygons)
    ? raw.polygons.slice(0, 2_000).flatMap((item, i) => {
        if (!item || typeof item !== 'object') return [];
        const p = item as Record<string, unknown>;
        const role = p.role;
        const points = Array.isArray(p.points) ? p.points.slice(0, 2_000).map(point).filter((x): x is Vec2 => !!x) : [];
        if (!['outline', 'hole'].includes(String(role)) || points.length < 3) return [];
        return [{ id: id(p.id, 'poly', i), name: String(p.name ?? '').slice(0, 100), role: role as CustomPolygonRole, points }];
      })
    : [];

  const dimensions: CustomDimension[] = Array.isArray(raw.dimensions)
    ? raw.dimensions.slice(0, 5_000).flatMap((item, i) => {
        if (!item || typeof item !== 'object') return [];
        const d = item as Record<string, unknown>;
        const a = point(d.a);
        const b = point(d.b);
        if (!a || !b) return [];
        const label = String(d.label ?? '').slice(0, 100);
        return [{ id: id(d.id, 'dim', i), a, b, ...(label ? { label } : {}) }];
      })
    : [];

  const area = raw.areaOverrideMm2 == null || raw.areaOverrideMm2 === '' ? null : safeNumber(raw.areaOverrideMm2, NaN);
  const drawing = emptyCustomDrawing();
  return {
    version: 1,
    name: String(raw.name ?? drawing.name).trim().slice(0, 120) || drawing.name,
    workspaceW: Math.min(10_000, Math.max(100, safeNumber(raw.workspaceW, drawing.workspaceW))),
    workspaceH: Math.min(10_000, Math.max(100, safeNumber(raw.workspaceH, drawing.workspaceH))),
    gridStep: Math.min(100, Math.max(0.1, safeNumber(raw.gridStep, drawing.gridStep))),
    lines,
    polygons,
    dimensions,
    areaOverrideMm2: area !== null && Number.isFinite(area) && area > 0 ? area : null,
  };
}

export interface TrayTemplateOptions {
  length: number;
  width: number;
  wall: number;
  name?: string;
}

/**
 * Стартовый пример для лотка: крестовая развёртка, 4 линии сгиба и треугольные
 * угловые ушки. Это только заготовка для редактирования — все точки можно менять.
 */
export function createTrayTemplate({ length, width, wall, name = 'Лоток с ушками' }: TrayTemplateOptions): CustomDrawing {
  const L = Math.max(20, Math.min(5_000, Number.isFinite(length) ? length : 240));
  const W = Math.max(20, Math.min(5_000, Number.isFinite(width) ? width : 180));
  const H = Math.max(5, Math.min(2_000, Number.isFinite(wall) ? wall : 50));
  const pad = 24;
  const x = pad + H;
  const y = pad + H;
  const shift = (p: Vec2): Vec2 => ({ x: p.x + x, y: p.y + y });
  const uid = (suffix: string): string => `tray-${suffix}`;
  const polygon: CustomPolygon = {
    id: uid('outline'),
    name: 'Наружный контур с ушками',
    role: 'outline',
    // От контура центрального дна наружу: на каждом углу — треугольный язычок.
    points: [
      { x: -H, y: 0 },
      { x: -H, y: W },
      { x: 0, y: W + H },
      { x: L, y: W + H },
      { x: L + H, y: W },
      { x: L + H, y: 0 },
      { x: L, y: -H },
      { x: 0, y: -H },
    ].map(shift),
  };
  const line = (id: string, a: Vec2, b: Vec2): CustomStroke => ({ id: uid(id), kind: 'crease', a: shift(a), b: shift(b) });
  const dimension = (id: string, a: Vec2, b: Vec2, label: string): CustomDimension => ({ id: uid(id), a: shift(a), b: shift(b), label });

  return {
    version: 1,
    name: name.trim() || 'Лоток с ушками',
    workspaceW: Math.ceil(L + 2 * H + 2 * pad),
    workspaceH: Math.ceil(W + 2 * H + 2 * pad),
    gridStep: 5,
    lines: [
      line('fold-bottom', { x: 0, y: 0 }, { x: L, y: 0 }),
      line('fold-top', { x: 0, y: W }, { x: L, y: W }),
      line('fold-left', { x: 0, y: 0 }, { x: 0, y: W }),
      line('fold-right', { x: L, y: 0 }, { x: L, y: W }),
      // Биговки у основания ушек: длина каждой равна высоте боковой стенки.
      line('ear-lower-left', { x: -H, y: 0 }, { x: 0, y: 0 }),
      line('ear-upper-left', { x: -H, y: W }, { x: 0, y: W }),
      line('ear-lower-right', { x: L, y: 0 }, { x: L + H, y: 0 }),
      line('ear-upper-right', { x: L, y: W }, { x: L + H, y: W }),
    ],
    polygons: [polygon],
    dimensions: [
      dimension('dim-bottom-l', { x: 0, y: W + 10 }, { x: L, y: W + 10 }, `Дно L · ${L} мм`),
      dimension('dim-bottom-w', { x: -12, y: 0 }, { x: -12, y: W }, `Дно W · ${W} мм`),
      dimension('dim-wall', { x: -H, y: -12 }, { x: 0, y: -12 }, `Стенка · ${H} мм`),
    ],
    areaOverrideMm2: null,
  };
}

/** Строит полноценный CalcResult, чтобы кастомная геометрия шла через те же лист/ножи/цену/экспорт. */
export function calculateCustomDrawing(drawing: CustomDrawing, input: BoxInput, settings: CalcSettings): CalcResult {
  const profile = settings.profiles.find((p) => p.id === input.profileId) ?? settings.profiles[0];
  if (!profile) throw new Error('Не задан профиль картона для пользовательской развертки');

  const polygons = drawing.polygons.filter((p) => p.points.length >= 3 && p.points.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)));
  const strokes = drawing.lines.filter((line) =>
    Number.isFinite(line.a.x) && Number.isFinite(line.a.y) && Number.isFinite(line.b.x) && Number.isFinite(line.b.y),
  );
  const allPts = [...polygons.flatMap((p) => p.points), ...strokes.flatMap((s) => [s.a, s.b])];
  const rawBounds = allPts.length
    ? bboxOf(allPts)
    : { x0: 0, y0: 0, x1: Math.max(1, drawing.workspaceW), y1: Math.max(1, drawing.workspaceH) };
  const rawW = rawBounds.x1 - rawBounds.x0;
  const rawH = rawBounds.y1 - rawBounds.y0;
  const blankW = Math.max(1, rawW);
  const blankH = Math.max(1, rawH);
  const mapPoint = (p: Vec2): Vec2 => ({ x: p.x - rawBounds.x0, y: rawBounds.y1 - p.y });
  const mappedPolygons = polygons.map((p) => ({ ...p, points: p.points.map(mapPoint) }));
  const kindList: CustomLineKind[] = ['cut', 'crease', 'perf', 'tech'];
  const segMap = {} as Record<LineKind, Seg[]>;
  for (const kind of KINDS) segMap[kind] = [];
  for (const line of strokes) {
    segMap[line.kind].push({ a: mapPoint(line.a), b: mapPoint(line.b), kind: line.kind, owner: line.id });
  }
  for (const polygon of mappedPolygons) {
    for (let i = 0; i < polygon.points.length; i++) {
      const a = polygon.points[i];
      const b = polygon.points[(i + 1) % polygon.points.length];
      if (segLen({ a, b, kind: 'cut' }) > 0.001) segMap.cut.push({ a, b, kind: 'cut', owner: polygon.id });
    }
  }
  for (const kind of kindList) segMap[kind] = mergeCollinear(dedupe(segMap[kind], 0.05), 0.05);

  const outerArea = mappedPolygons.filter((p) => p.role === 'outline').reduce((sum, p) => sum + polyArea(p.points), 0);
  const holesAreaMm2 = mappedPolygons.filter((p) => p.role === 'hole').reduce((sum, p) => sum + polyArea(p.points), 0);
  const bboxAreaMm2 = blankW * blankH;
  const hasOutline = outerArea > 0;
  const measuredArea = hasOutline ? Math.max(0, outerArea - holesAreaMm2) : bboxAreaMm2;
  const areaMm2 = drawing.areaOverrideMm2 && drawing.areaOverrideMm2 > 0 ? drawing.areaOverrideMm2 : measuredArea;
  const areaM2 = (n: number): number => Math.round((n / 1e6) * 10_000) / 10_000;
  const perDie = Math.max(1, Math.round(input.options.perDie || 1));
  const frameMargin = Math.max(0, input.die.frameMargin);
  const diePitch = Math.max(0, input.options.diePitch);
  const dieW = blankW * perDie + diePitch * (perDie - 1) + frameMargin * 2;
  const dieH = blankH + frameMargin * 2;
  const blankBox = { x0: 0, y0: 0, x1: blankW, y1: blankH };
  const die = { x0: 0, y0: 0, x1: dieW, y1: dieH };
  const normalizedInput: BoxInput = {
    ...input,
    construction: 'blank',
    closure: 'none',
    blankW,
    blankH,
    blankArea: areaMm2,
    qty: Math.max(1, Math.round(input.qty)),
    options: { ...input.options, perDie, techCorners: false },
  };
  const blankAreaM2 = areaM2(areaMm2);
  const area: AreaStats = {
    blankW: Math.round(blankW * 10) / 10,
    blankH: Math.round(blankH * 10) / 10,
    bboxAreaM2: areaM2(bboxAreaMm2),
    blankAreaM2,
    holesAreaM2: areaM2(holesAreaMm2),
    fillInBbox: bboxAreaMm2 > 0 ? Math.round((areaMm2 / bboxAreaMm2) * 1_000) / 1_000 : 0,
    dieW,
    dieH,
    dieAreaM2: areaM2(dieW * dieH),
  };
  const knives = knifeStats(segMap, normalizedInput.die.nickEvery, normalizedInput.die.nickLen, true);
  const sheetList = settings.sheets?.length ? settings.sheets : [];
  const nest = nestBlank({ w: blankW, h: blankH, areaMm2 }, normalizedInput.nesting, sheetList, normalizedInput.qty);
  const cost = costOf({ box: normalizedInput, profile, area, knives, nest, prices: settings.prices, perDie });

  const warnings: string[] = [];
  if (!hasOutline) warnings.push('Замкнутый внешний контур не нарисован: площадь картона ориентировочно считается по прямоугольному габариту.');
  if (rawW < 0.1 || rawH < 0.1) warnings.push('У чертежа нулевая ширина или высота — добавьте геометрию по второй оси.');
  if (holesAreaMm2 > outerArea && hasOutline) warnings.push('Площадь вырезов больше площади внешнего контура — проверьте контуры.');
  if (areaMm2 > bboxAreaMm2 * 1.001) warnings.push('Указанная площадь больше площади габарита — проверьте единицы измерения.');
  if (nest.perSheet === 0) warnings.push('Заготовка не помещается ни на один лист из справочника — выберите формат побольше или уменьшите размеры.');
  if (knives.totalM <= 0) warnings.push('Добавьте линии реза, биговки или перфорации — пока ножи не посчитаны.');
  if (drawing.areaOverrideMm2 && drawing.areaOverrideMm2 > 0) warnings.push('Полезная площадь задана вручную; размеры и длины ножей по-прежнему рассчитаны по нарисованным линиям.');

  const dimensions = drawing.dimensions.map((dimension) => ({ ...dimension, a: mapPoint(dimension.a), b: mapPoint(dimension.b) }));
  const geom: BuiltGeom = {
    panels: mappedPolygons.filter((p) => p.role === 'outline').map((p) => ({ id: p.id, role: 'bottom', pts: p.points })),
    extra: strokes.map((line) => ({ a: mapPoint(line.a), b: mapPoint(line.b), kind: line.kind, owner: line.id })),
    holes: mappedPolygons.filter((p) => p.role === 'hole').map((p) => p.points),
    derivation: [
      { label: 'Ширина контура', formula: 'максимум X − минимум X', value: area.blankW, unit: ' мм' },
      { label: 'Высота контура', formula: 'максимум Y − минимум Y', value: area.blankH, unit: ' мм' },
      { label: 'Площадь заготовки', formula: drawing.areaOverrideMm2 ? 'задана вручную' : hasOutline ? 'сумма контуров − вырезы' : 'прямоугольный габарит', value: areaMm2, unit: ' мм²' },
    ],
    warnings,
    meta: {},
    dimensions,
    custom: true,
  };

  return {
    input: normalizedInput,
    geom,
    segs: ([] as Seg[]).concat(segMap.cut, segMap.crease, segMap.perf, segMap.tech, segMap.mark),
    segMap,
    bbox: blankBox,
    die,
    outline: mappedPolygons.filter((p) => p.role === 'outline').map((p) => p.points),
    area,
    knives,
    nest,
    cost,
    warnings,
  };
}
