/**
 * templates.ts — параметрическая геометрия четырёх конструкций самосборных
 * гофрокоробов + режим «готовая заготовка».
 *
 * Общая топология — «звезда» (как в реальных чертежах штанцформ):
 *
 *      [клапан] [стенка H] [дно W] [стенка H] [клапан]     — по Y
 *      [клапан] [стенка H] [дно L] [стенка H] [клапан]      — по X
 *      в 4 углах — пыльники под 45°
 *
 * Поэтому габарит заготовки по краям коробки:
 *      blankW = sSide + Hp + Lp + Hp + sSide (+ sGlue)
 *      blankH = sFront + Hf + Wp + Hp + sBack
 * где Lp/Wp/Hp — панели дна и стенок с припуском на толщину картона.
 *
 * Все припуски берутся из Coef (model.ts): их можно калибровать по чертежам,
 * не трогая геометрию. Точность раскроя — 0.5 мм (у вас на чертежах 548,5).
 */

import { cleanPoly, v, rect, roundCorners, tabPoly, type Vec2, type Seg } from './geo';
import type { BuiltGeom, ClosureId, Coef, Options, Panel } from './model';

/** округление под станок: 0.5 мм */
export const rr = (n: number): number => Math.round(n * 2) / 2;

export interface Dims {
  L: number;
  W: number;
  H: number;
  /** толщина картона */
  t: number;
  /** панели с припуском */
  Lp: number;
  Wp: number;
  Hp: number;
  /** передняя стенка (у лотка — ниже) */
  Hf: number;
  /** внешние клапаны */
  sSide: number;
  sFront: number;
  sBack: number;
  /** клеевой клапан */
  sGlue: number;
  /** выступ за кромку клапана: язычок (tuck) или ушки (half) */
  sTab: number;
  coef: Coef;
  closure: ClosureId;
  opts: Options;
}

const allow = (dim: number, a: { k: number; c: number; kt: number }, t: number): number =>
  rr(dim * a.k + a.c + a.kt * t);

/**
 * Размер заготовки «в плане» — единственное, что нужно для площади и раскладки.
 * Длины клапанов — из таблицы coef.flaps[closure], её и подгоняет калибровка.
 */
export function computeDims(
  L: number,
  W: number,
  H: number,
  t: number,
  coef: Coef,
  closure: ClosureId,
  opts: Options,
): Dims {
  const Lp = rr(L + allow(L, coef.allowL, t));
  const Wp = rr(W + allow(W, coef.allowW, t));
  const Hp = rr(H + allow(H, coef.allowH, t));
  const Hf = coef.frontK >= 1 ? Hp : rr(Hp * coef.frontK);

  // правила клапанов берутся из таблицы coef.flaps — их подгоняет калибровка
  const r = coef.flaps[closure] ?? coef.flaps.none;
  const minFlap = closure === 'none' ? 24 : 12;
  const sSide = rr(Math.max(minFlap, Lp * r.sideFrac + r.sideAdd + (closure === 'half' ? coef.overlap : 0)));
  const sFront = rr(Math.max(minFlap, Wp * r.frontFrac + r.frontAdd));
  const sBack = rr(Math.max(minFlap, Wp * r.backFrac + r.backAdd));
  const sGlue = closure === 'glue' ? rr(coef.glueFlap || 30) : 0;
  const withTab = closure === 'tuck' || closure === 'full';
  const sTab = rr(withTab ? coef.tabH : closure === 'half' ? Math.min(coef.ear * 0.9, Hp * 0.45) : 0);

  return { L, W, H, t, Lp, Wp, Hp, Hf, sSide, sFront, sBack, sGlue, sTab, coef, closure, opts };
}

export interface Derived {
  blankW: number;
  blankH: number;
  xB: number;
  yB: number;
}

export function derived(d: Dims): Derived {
  // габарит «по краям коробки»: цепочка панелей + выступ язычка/ушек
  const blankW = rr(d.sSide + d.Hp + d.Lp + d.Hp + d.sSide + d.sGlue);
  const blankH = rr(d.sFront + d.Hf + d.Wp + d.Hp + d.sBack + d.sTab);
  return { blankW, blankH, xB: rr(d.sSide + d.Hp), yB: rr(d.sFront + d.Hf) };
}

let seq = 0;
function mk(
  id: string,
  role: Panel['role'],
  pts: Vec2[],
  hinge?: { p: Vec2; q: Vec2 },
  fold = 0,
  parent?: string,
  step = 0,
): Panel {
  return { id: `${id}#${(seq += 1)}`, role, pts: cleanPoly(pts), hinge, fold, parent, step };
}

/** «стадиум» (скруглённый паз) — отверстие под ручку */
export function stadium(cx: number, cy: number, w: number, h: number, steps = 10): Vec2[] {
  const r = h / 2;
  const half = w / 2 - r > 0 ? w / 2 - r : 0;
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / steps;
    pts.push(v(rr(cx + half + r * Math.cos(a)), rr(cy + r * Math.sin(a))));
  }
  for (let i = steps; i >= 0; i--) {
    const a = Math.PI / 2 + (Math.PI * i) / steps;
    pts.push(v(rr(cx - half + r * Math.cos(a)), rr(cy + r * Math.sin(a))));
  }
  return pts;
}

/** пыльники в углах: треугольники со срезанными острыми концами */
function dustFlaps(d: Dims, g: Derived, R: number): Panel[] {
  const { xB, yB } = g;
  const Hp = d.Hp;
  const xR = rr(xB + d.Lp);
  const yT = rr(yB + d.Wp);
  const defs: Array<{ id: string; pts: Vec2[]; hinge: [Vec2, Vec2]; parent: string }> = [
    {
      id: 'dust-bl',
      pts: [v(rr(xB - Hp), yB), v(xB, yB), v(rr(xB - Hp), rr(yB - d.Hf))],
      hinge: [v(rr(xB - Hp), yB), v(xB, yB)],
      parent: 'wall-l',
    },
    {
      id: 'dust-br',
      pts: [v(xR, yB), v(rr(xR + Hp), yB), v(rr(xR + Hp), rr(yB - d.Hf))],
      hinge: [v(xR, yB), v(rr(xR + Hp), yB)],
      parent: 'wall-r',
    },
    {
      id: 'dust-tl',
      pts: [v(rr(xB - Hp), yT), v(xB, yT), v(rr(xB - Hp), rr(yT + Hp))],
      hinge: [v(rr(xB - Hp), yT), v(xB, yT)],
      parent: 'wall-l',
    },
    {
      id: 'dust-tr',
      pts: [v(xR, yT), v(rr(xR + Hp), yT), v(rr(xR + Hp), rr(yT + Hp))],
      hinge: [v(xR, yT), v(rr(xR + Hp), yT)],
      parent: 'wall-r',
    },
  ];
  return defs.map((c) =>
    mk(c.id, 'dust', roundCorners(c.pts, R), { p: c.hinge[0], q: c.hinge[1] }, 90, c.parent, 5),
  );
}

interface Frame {
  xB: number;
  yB: number;
  yFree: number;
  yBackTop: number;
  xR: number;
  xL: number;
}

function frame(d: Dims, g: Derived): Frame {
  return {
    xB: g.xB,
    yB: g.yB,
    xR: rr(g.xB + d.Lp),
    xL: rr(g.xB - d.Hp),
    yFree: rr(g.yB - d.Hf),
    yBackTop: rr(g.yB + d.Wp + d.Hp),
  };
}

function deriveRows(d: Dims, g: Derived): BuiltGeom['derivation'] {
  const c = d.coef;
  const r = c.flaps[d.closure] ?? c.flaps.none;
  const f = (n: number): string => String(Math.round(n * 10) / 10);
  return [
    { label: 'Панель дна Lp', formula: `${d.L} + (${c.allowL.k}·${d.L} + ${c.allowL.c} + ${c.allowL.kt}·${f(d.t)})`, value: d.Lp, unit: 'мм' },
    { label: 'Панель дна Wp', formula: `${d.W} + (${c.allowW.k}·${d.W} + ${c.allowW.c} + ${c.allowW.kt}·${f(d.t)})`, value: d.Wp, unit: 'мм' },
    { label: 'Стенка Hp', formula: `${d.H} + (${c.allowH.k}·${d.H} + ${c.allowH.c} + ${c.allowH.kt}·${f(d.t)})`, value: d.Hp, unit: 'мм' },
    { label: 'Передняя стенка Hf', formula: c.frontK >= 1 ? '= Hp' : `${c.frontK}·Hp`, value: d.Hf, unit: 'мм' },
    {
      label: 'Боковой клапан sSide',
      formula: `${f(r.sideFrac)}·Lp + ${f(r.sideAdd)}${d.closure === 'half' ? ` + overlap ${f(c.overlap)}` : ''}`,
      value: d.sSide,
      unit: 'мм',
    },
    { label: 'Передний клапан sFront', formula: `${f(r.frontFrac)}·Wp + ${f(r.frontAdd)}`, value: d.sFront, unit: 'мм' },
    { label: 'Клапан-крышка sBack', formula: `${f(r.backFrac)}·Wp + ${f(r.backAdd)}`, value: d.sBack, unit: 'мм' },
    { label: 'Язычок / ушки sTab', formula: d.sTab ? `tabH=${f(c.tabH)} (tuck/full), min(ear, 0.45·Hp) (half)` : 'нет', value: d.sTab, unit: 'мм' },
    { label: 'Клеевой клапан', formula: c.glueFlap ? `${f(c.glueFlap)}` : 'нет', value: d.sGlue, unit: 'мм' },
    { label: 'ГАБАРИТ заготовки W', formula: 'sSide + Hp + Lp + Hp + sSide (+ glue)', value: g.blankW, unit: 'мм' },
    { label: 'ГАБАРИТ заготовки H', formula: 'sFront + Hf + Wp + Hp + sBack (+ tab)', value: g.blankH, unit: 'мм' },
  ];
}

/**
 * Базовый builder для «Ласточкин хвост» / «С замочком-язычком» / «Лоток».
 * Отличия конструкций — в флаге mode (фигурный вырез, ушки, язычок).
 */
export function buildTray(
  d: Dims,
  mode: 'lastochkin' | 'yazyk' | 'lotok',
): BuiltGeom {
  const g = derived(d);
  const fr = frame(d, g);
  const c = d.coef;
  const R = c.cornerR;
  const panels: Panel[] = [];
  const extra: Seg[] = [];
  const holes: Vec2[][] = [];
  const warnings: string[] = [];
  const { xB, yB, xR, yFree, yBackTop } = fr;
  const backTop = rr(yBackTop + d.sBack);

  // ————— дно
  panels.push(mk('bottom', 'bottom', rect(xB, yB, d.Lp, d.Wp)));

  // ————— стенки
  const frontPts =
    mode === 'lotok' && d.closure === 'none' && c.frontCut > 2
      ? lotokFrontEdge(d, xB, xR, yFree, yB)
      : rect(xB, yFree, d.Lp, d.Hf);
  panels.push(mk('wall-f', 'front', frontPts, { p: v(xB, yB), q: v(xR, yB) }, 90, 'bottom', 1));
  panels.push(mk('wall-b', 'back', rect(xB, yB + d.Wp, d.Lp, d.Hp), { p: v(xB, yB + d.Wp), q: v(xR, yB + d.Wp) }, 90, 'bottom', 1));
  panels.push(mk('wall-l', 'side', rect(fr.xL, yB, d.Hp, d.Wp), { p: v(xB, yB), q: v(xB, rr(yB + d.Wp)) }, 90, 'bottom', 2));
  panels.push(mk('wall-r', 'side', rect(xR, yB, d.Hp, d.Wp), { p: v(xR, yB), q: v(xR, rr(yB + d.Wp)) }, 90, 'bottom', 2));

  // ————— внешние клапаны (4)
  panels.push(mk('flap-f', 'flap', roundCorners(rect(xB, rr(yFree - d.sFront), d.Lp, d.sFront), R), { p: v(xB, yFree), q: v(xR, yFree) }, 90, 'wall-f', 3));
  panels.push(mk('flap-b', 'lid', roundCorners(rect(xB, yBackTop, d.Lp, d.sBack), R), { p: v(xB, yBackTop), q: v(xR, yBackTop) }, 90, 'wall-b', 3));
  panels.push(mk('flap-l', 'flap', roundCorners(rect(rr(fr.xL - d.sSide), yB, d.sSide, d.Wp), R), { p: v(fr.xL, yB), q: v(fr.xL, rr(yB + d.Wp)) }, 90, 'wall-l', 4));
  panels.push(mk('flap-r', 'flap', roundCorners(rect(rr(xR + d.Hp), yB, d.sSide, d.Wp), R), { p: v(rr(xR + d.Hp), yB), q: v(rr(xR + d.Hp), rr(yB + d.Wp)) }, 90, 'wall-r', 4));

  // ————— пыльники
  panels.push(...dustFlaps(d, g, R));

  // ————— замок: язычок + паз
  const withTab = d.closure === 'tuck' || d.closure === 'full';
  if (withTab) {
    const tabW = rr(Math.min(c.tabW, d.Lp * 0.5));
    const tabH = rr(c.tabH);
    const a = v(rr(xB + d.Lp / 2 - tabW / 2), backTop);
    const b = v(rr(xB + d.Lp / 2 + tabW / 2), backTop);
    panels.push(mk('tab', 'ear', tabPoly(a, b, tabW, tabH, R), { p: a, q: b }, 90, 'flap-b', 6));
    const slotW = rr(tabW + 4);
    const slotH = rr(Math.max(6, tabH * 0.5));
    const sy = rr(yFree + slotH * 0.5);
    holes.push([
      v(rr(xB + d.Lp / 2 - slotW / 2), sy),
      v(rr(xB + d.Lp / 2 + slotW / 2), sy),
      v(rr(xB + d.Lp / 2 + slotW / 2), rr(sy + slotH)),
      v(rr(xB + d.Lp / 2 - slotW / 2), rr(sy + slotH)),
    ]);
  }

  // ————— замок «half»: ушки-«ласточкин хвост» на кромке задней стенки
  if (d.closure === 'half') {
    const e = rr(c.ear);
    const tuck = rr(Math.min(e * 0.9, d.Hp * 0.45));
    for (const [id, x0, x1] of [
      ['ear-l', xB, rr(xB + e)],
      ['ear-r', rr(xR - e), xR],
    ] as Array<[string, number, number]>) {
      const pts = [v(x0, yBackTop), v(x1, yBackTop), v(rr(x1 - tuck * 0.4), rr(yBackTop + tuck)), v(rr(x0 + tuck * 0.4), rr(yBackTop + tuck))];
      panels.push(mk(id, 'ear', roundCorners(pts, R * 0.5), { p: v(x0, yBackTop), q: v(x1, yBackTop) }, 90, 'wall-b', 6));
    }
  }

  // ————— футляр: боковые отгибы крышки
  if (d.closure === 'full') {
    const w = rr(Math.max(22, d.Hp * 0.85));
    for (const [id, x, dir] of [
      ['lid-l', xB, -1],
      ['lid-r', xR, 1],
    ] as Array<[string, number, number]>) {
      const pts = [
        v(x, yBackTop),
        v(rr(x + dir * w), yBackTop),
        v(rr(x + dir * w * 0.7), rr(yBackTop + d.sBack - 2)),
        v(rr(x + dir * w * 0.3), rr(yBackTop + d.sBack - 2)),
      ];
      panels.push(mk(id, 'ear', roundCorners(pts, R), { p: v(x, yBackTop), q: v(x, rr(yBackTop + d.sBack)) }, 90, 'flap-b', 6));
    }
  }

  // ————— склейка
  if (d.closure === 'glue') {
    const xg = rr(xR + d.Hp + d.sSide);
    panels.push(mk('flap-g', 'glue', rect(xg, yB, d.sGlue, d.Wp), { p: v(xg, yB), q: v(xg, rr(yB + d.Wp)) }, 0, 'wall-r', 0));
    for (const dx of [3.5, rr(d.sGlue - 3.5)]) {
      extra.push({ a: v(rr(xg + dx), rr(yB + 4)), b: v(rr(xg + dx), rr(yB + d.Wp - 4)), kind: 'perf' });
    }
  }

  // ————— ручка
  if (d.opts.handle) {
    const hw = rr(Math.min(d.opts.handleW, d.Lp * 0.6));
    const hh = rr(Math.min(d.opts.handleH, d.Hf * 0.55));
    holes.push(stadium(rr(xB + d.Lp / 2), rr(yB - d.Hf * 0.5), hw, hh));
  }

  // ————— двойная биговка
  if (d.opts.doubleCrease) {
    const off = rr(d.t + 1.5);
    for (const p of panels) {
      if (!p.hinge) continue;
      const dx = p.hinge.q.x - p.hinge.p.x;
      const dy = p.hinge.q.y - p.hinge.p.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * off;
      const ny = (dx / len) * off;
      extra.push({ a: v(rr(p.hinge.p.x + nx), rr(p.hinge.p.y + ny)), b: v(rr(p.hinge.q.x + nx), rr(p.hinge.q.y + ny)), kind: 'crease', owner: p.id });
    }
  }

  // ————— перфорация по линии отрыва крышки
  if (d.opts.perforation && d.closure !== 'none') {
    extra.push({ a: v(xB, yBackTop), b: v(xR, yBackTop), kind: 'perf' });
  }

  if (d.Hp < 12) warnings.push('Стенка меньше 12 мм — биговка и склейка держат плохо.');
  if (d.W < 40 || d.L < 40) warnings.push('Малый внутренний размер: проверьте, что узкие клапаны не перекрывают друг друга.');
  if (d.closure === 'tuck' && d.sBack < d.Wp * 0.6) warnings.push('Клапан короче верха коробки — язычку не за что цепляться.');

  return {
    panels,
    extra,
    holes,
    warnings,
    meta: { xB, yB, Lp: d.Lp, Wp: d.Wp, Hp: d.Hp, Hf: d.Hf, sSide: d.sSide, sFront: d.sFront, sBack: d.sBack, blankW: g.blankW, blankH: g.blankH },
    derivation: deriveRows(d, g),
  };
}

/** передняя стенка кондитерского лотка с фигурным вырезом по верхней кромке */
function lotokFrontEdge(d: Dims, xB: number, xR: number, yFree: number, yB: number): Vec2[] {
  const c = d.coef;
  const w = rr(d.Lp * 0.3);
  const depth = rr(Math.min(c.frontCut, d.Hf * 0.65));
  const cx = rr((xB + xR) / 2);
  const arc: Vec2[] = [];
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI - (Math.PI * i) / 18;
    arc.push(v(rr(cx + w * Math.cos(a)), rr(yFree + depth * Math.sin(a))));
  }
  return [v(xB, yFree), ...arc, v(xR, yFree), v(xR, yB), v(xB, yB)];
}

/* ═════════════════════════ Замок боковой с ушками ═════════════════════════ */

/**
 * Отличается от «Ласточкин хвост» тем, что закрывают верх именно боковые
 * клапаны (sSide), а передний/задний — короткие пыльники; ушки цепляются за
 * пазы в передней и задней стенках.
 */
export function buildBokovoy(d: Dims): BuiltGeom {
  const base = buildTray(d, 'lastochkin');
  const g = derived(d);
  const fr = frame(d, g);
  const holes = base.holes.slice();
  const warnings = base.warnings.slice();
  const slotW = rr(d.coef.ear * 1.3);
  const slotH = rr(Math.max(9, d.Hp * 0.32));
  // пазы под ушки: в верхней кромке передней и задней стенок
  for (const y of [rr(fr.yFree + slotH * 0.3), rr(fr.yBackTop - slotH * 1.3)]) {
    for (const x of [rr(fr.xB - slotW * 0.35), rr(fr.xR - slotW * 0.65)]) {
      const y0 = Math.max(y, rr(fr.yFree + 1));
      holes.push([v(x, y0), v(rr(x + slotW), y0), v(rr(x + slotW), rr(y0 + slotH)), v(x, rr(y0 + slotH))]);
    }
  }
  if (d.sSide * 2 < d.Lp) warnings.push('Боковые клапаны не смыкаются вверху — увеличьте sSide или смените закрытие.');
  return { ...base, holes, warnings };
}

/* ═════════════════════════ режим «по готовой заготовке» ═════════════════════════ */

export function buildBlank(blankW: number, blankH: number, opts: Options): BuiltGeom {
  const w = rr(blankW);
  const h = rr(blankH);
  const panels: Panel[] = [mk('blank', 'bottom', rect(0, 0, w, h))];
  const holes: Vec2[][] = [];
  if (opts.handle) holes.push(stadium(rr(w / 2), rr(h * 0.82), rr(Math.min(opts.handleW, w * 0.5)), rr(Math.min(opts.handleH, h * 0.3))));
  return {
    panels,
    extra: [],
    holes,
    warnings: [],
    meta: { blankW: w, blankH: h, Lp: w, Wp: h, Hp: 0, Hf: 0, sSide: 0, sFront: 0, sBack: 0, xB: 0, yB: 0 },
    derivation: [
      { label: 'Габарит заготовки W', formula: 'введено вручную (по чертежу матрицы)', value: w, unit: 'мм' },
      { label: 'Габарит заготовки H', formula: 'введено вручную (по чертежу матрицы)', value: h, unit: 'мм' },
    ],
  };
}

export type { Coef };
