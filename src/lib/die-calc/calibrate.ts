// Этот файл скопирован из tools/die-calc скриптом `node tools/die-calc/scripts/sync-site.mjs`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
/**
 * calibrate.ts — автоподгонка припусков по эталонным чертежам (fixtures.ts).
 *
 * Идея: геометрия шаблона не меняется, меняется только таблица коэффициентов
 * Coef. Координатный спуск минимизирует Σ|ΔW| + |ΔH| по габариту заготовки
 * (именно его видно с чертежа) плюс слабый регуляризатор, чтобы коэффициенты
 * не уезжали в физический бред.
 */

import { computeDims, derived } from './templates';
import { CALIBRATABLE, type Fixture } from './fixtures';
import {
  DEFAULT_COEF,
  cloneCoef,
  type ClosureId,
  type Coef,
  type ConstructionId,
  type Profile,
} from './model';

export interface CalibRow {
  id: string;
  mark: string;
  construction: ConstructionId | null;
  closure: ClosureId;
  actualW: number;
  actualH: number;
  predW: number;
  predH: number;
  dW: number;
  dH: number;
  /** средняя ошибка в % на два габарита */
  errPct: number;
}

const thicknessOf = (profile: string, profiles: Profile[]): number =>
  (profiles.find((p) => p.flute === profile || p.id === profile) ?? profiles[0]).thickness;

export function predictBlank(f: Fixture, coef: Coef, t: number): { w: number; h: number } {
  if (!f.construction) return { w: f.blankW, h: f.blankH };
  const d = computeDims(f.L, f.W, f.H, t, coef, f.closure, {
    handle: false,
    handleW: 0,
    handleH: 0,
    doubleCrease: false,
    perforation: false,
    techCorners: false,
    mirror: false,
    perDie: f.perDie,
    diePitch: 12,
  });
  const g = derived(d);
  return { w: g.blankW, h: g.blankH };
}

export function calibReport(coefs: Record<ConstructionId, Coef>, profiles: Profile[]): CalibRow[] {
  return CALIBRATABLE.map((f) => {
    const t = thicknessOf(f.profile, profiles);
    const coef = f.construction ? coefs[f.construction] : DEFAULT_COEF.lastochkin;
    const p = predictBlank(f, coef, t);
    const dW = Math.round((p.w - f.blankW) * 10) / 10;
    const dH = Math.round((p.h - f.blankH) * 10) / 10;
    const errPct = Math.round((((Math.abs(dW) + Math.abs(dH)) / 2) / ((f.blankW + f.blankH) / 2)) * 1000) / 10;
    return {
      id: f.id,
      mark: f.mark,
      construction: f.construction,
      closure: f.closure,
      actualW: f.blankW,
      actualH: f.blankH,
      predW: p.w,
      predH: p.h,
      dW,
      dH,
      errPct,
    };
  });
}

interface Leaf {
  get: (c: Coef) => number;
  set: (c: Coef, v: number) => void;
  min: number;
  max: number;
  step: number;
  /** вес регуляризатора (0 — не тянуть к дефолту) */
  reg: number;
}

/** общие припуски (не зависят от закрытия) */
function sharedLeaves(): Leaf[] {
  const num = (get: (c: Coef) => number, set: (c: Coef, v: number) => void, min: number, max: number, step: number, reg = 0.2): Leaf => ({
    get,
    set,
    min,
    max,
    step,
    reg,
  });
  return [
    num((c) => c.allowL.c, (c, v) => (c.allowL.c = v), -10, 24, 0.5),
    num((c) => c.allowL.k, (c, v) => (c.allowL.k = v), 0, 0.05, 0.002),
    num((c) => c.allowW.c, (c, v) => (c.allowW.c = v), -10, 24, 0.5),
    num((c) => c.allowW.kt, (c, v) => (c.allowW.kt = v), 0, 2.5, 0.1),
    num((c) => c.allowH.c, (c, v) => (c.allowH.c = v), -10, 24, 0.5),
    num((c) => c.allowH.kt, (c, v) => (c.allowH.kt = v), 0, 3, 0.1),
  ];
}

const num = (
  get: (c: Coef) => number,
  set: (c: Coef, v: number) => void,
  min: number,
  max: number,
  step: number,
  reg = 0.4,
): Leaf => ({ get, set, min, max, step, reg });

function leavesFor(closure: ClosureId): Leaf[] {
  const rule = (c: Coef) => c.flaps[closure];
  return [
    num((c) => rule(c).sideFrac, (c, v) => (rule(c).sideFrac = v), -0.6, 1.8, 0.01),
    num((c) => rule(c).sideAdd, (c, v) => (rule(c).sideAdd = v), -60, 160, 1),
    num((c) => rule(c).frontFrac, (c, v) => (rule(c).frontFrac = v), -0.6, 1.8, 0.01),
    num((c) => rule(c).frontAdd, (c, v) => (rule(c).frontAdd = v), -60, 160, 1),
    num((c) => rule(c).backFrac, (c, v) => (rule(c).backFrac = v), -0.6, 1.8, 0.01),
    num((c) => rule(c).backAdd, (c, v) => (rule(c).backAdd = v), -60, 160, 1),
  ];
}

function objective(
  coef: Coef,
  fixtures: Fixture[],
  thickness: (f: Fixture) => number,
  base: Coef,
  leaves: Leaf[],
): number {
  let s = 0;
  for (const f of fixtures) {
    const p = predictBlank(f, coef, thickness(f));
    s += Math.abs(p.w - f.blankW) + Math.abs(p.h - f.blankH);
  }
  s /= Math.max(1, fixtures.length);
  for (const l of leaves) {
    const range = Math.max(1e-6, l.max - l.min);
    s += l.reg * Math.pow((l.get(coef) - l.get(base)) / range, 2) * 25;
  }
  return s;
}

function descent(coef: Coef, obj: (c: Coef) => number, leaves: Leaf[], passes = 16): void {
  let cur = obj(coef);
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (const leaf of leaves) {
      for (const dir of [1, -1]) {
        const prev = leaf.get(coef);
        let bestV = cur;
        let best = 0;
        for (const k of [1, 2, 3, 5, 8, 13, 21, 34, 55]) {
          const cand = prev + dir * leaf.step * k;
          if (cand < leaf.min || cand > leaf.max) break;
          leaf.set(coef, Math.round(cand * 1000) / 1000);
          const val = obj(coef);
          if (val < bestV - 1e-9) {
            bestV = val;
            best = cand - prev;
          }
        }
        if (best !== 0) {
          leaf.set(coef, Math.round((prev + best) * 1000) / 1000);
          cur = bestV;
          improved = true;
        } else {
          leaf.set(coef, prev);
        }
      }
    }
    if (!improved) break;
  }
}

/**
 * Подгонка одного coef по списку эталонов (одна конструкция).
 * Сначала общие припуски по всем эталонам, потом — правило клапанов каждого
 * закрытия отдельно: иначе «half» и «tuck» тянут одни и те же числа в разные стороны.
 */
export function fitCoef(base: Coef, fixtures: Fixture[], profiles: Profile[]): { coef: Coef; err: number } {
  const coef = cloneCoef(base);
  const thickness = (f: Fixture): number => thicknessOf(f.profile, profiles);
  const all = fixtures;

  descent(
    coef,
    (c) => objective(c, all, thickness, base, sharedLeaves()),
    sharedLeaves(),
  );

  const groups = new Map<ClosureId, Fixture[]>();
  for (const f of fixtures) {
    const list = groups.get(f.closure) ?? [];
    list.push(f);
    groups.set(f.closure, list);
  }
  for (const [closure, list] of Array.from(groups)) {
    const leaves = leavesFor(closure);
    descent(coef, (c) => objective(c, list, thickness, base, leaves), leaves);
  }

  // выступ замка (язычок/ушки) — общий для нескольких закрытий, поэтому его
  // подгоняем последним и сразу по всем подходящим эталонам, иначе группы
  // «tuck» и «full» перетянули бы одно и то же число в разные стороны.
  const tabFix = all.filter((f) => f.closure === 'tuck' || f.closure === 'full');
  if (tabFix.length) {
    const leaves = [num((c) => c.tabH, (c, v) => (c.tabH = v), 0, 30, 0.5, 0.6)];
    descent(coef, (c) => objective(c, tabFix, thickness, base, leaves), leaves);
  }
  const earFix = all.filter((f) => f.closure === 'half');
  if (earFix.length) {
    const leaves = [num((c) => c.ear, (c, v) => (c.ear = v), 4, 60, 1, 0.6)];
    descent(coef, (c) => objective(c, earFix, thickness, base, leaves), leaves);
  }

  const rows = calibReport(
    {
      ...DEFAULT_COEF,
      ...(fixtures.length && fixtures[0].construction ? { [fixtures[0].construction]: coef } : {}),
    } as Record<ConstructionId, Coef>,
    profiles,
  );
  const mine = rows.filter((r) => fixtures.some((f) => f.id === r.id));
  const err = mine.reduce((s, r) => s + Math.abs(r.dW) + Math.abs(r.dH), 0) / Math.max(1, mine.length);
  return { coef, err: Math.round(err * 10) / 10 };
}

/** подгонка всех конструкций сразу (по каждой — свои эталоны) */
export function fitAll(profiles: Profile[], extra: Fixture[] = []): {
  coefs: Record<ConstructionId, Coef>;
  before: CalibRow[];
  after: CalibRow[];
} {
  const fixtures = CALIBRATABLE.concat(extra);
  const byCons = new Map<ConstructionId, Fixture[]>();
  for (const f of fixtures) {
    if (!f.construction) continue;
    const list = byCons.get(f.construction) ?? [];
    list.push(f);
    byCons.set(f.construction, list);
  }
  const coefs = {} as Record<ConstructionId, Coef>;
  for (const key of ['lastochkin', 'lotok', 'yazyk', 'bokovoy', 'blank'] as ConstructionId[]) {
    const list = byCons.get(key);
    const base = DEFAULT_COEF[key];
    if (!list || !list.length) {
      coefs[key] = cloneCoef(base);
      continue;
    }
    coefs[key] = fitCoef(base, list, profiles).coef;
  }
  const before = calibReport(DEFAULT_COEF as Record<ConstructionId, Coef>, profiles);
  const after = calibReport(coefs, profiles);
  return { coefs, before, after };
}

export const meanAbsError = (rows: CalibRow[]): number => {
  const s = rows.reduce((a, r) => a + Math.abs(r.dW) + Math.abs(r.dH), 0);
  return rows.length ? Math.round((s / (rows.length * 2)) * 10) / 10 : 0;
};
