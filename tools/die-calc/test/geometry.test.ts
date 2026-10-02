/**
 * геометрия + сборка штанцформы. Запуск: `npm test`.
 *
 * Главное, что здесь закреплено: габарит заготовки по умолчанию совпадает с
 * реальными штампами из fixtures.ts (см. также `npm run check`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcBox,
  makeInput,
  baseSettings,
  quickEstimate,
  computeDims,
  derived,
  DEFAULT_COEF,
  polyArea,
  cleanPoly,
  mergeCollinear,
  ensureCCW,
  foldTransforms,
  type V3,
  v,
} from '../src/core/index';

const demo = (over: Record<string, unknown> = {}): ReturnType<typeof calcBox> =>
  calcBox({
    input: makeInput({ L: 240, W: 180, H: 60, profile: 'E', construction: 'lastochkin', closure: 'tuck', qty: 1000, ...over }) as never,
    settings: baseSettings(),
  });

test('площадь многоугольника и ориентация', () => {
  const rect = [v(0, 0), v(10, 0), v(10, 5), v(0, 5)];
  assert.equal(polyArea(rect), 50, 'площадь всегда положительная');
  assert.equal(polyArea(ensureCCW(rect)), 50);
  assert.ok(polyArea(ensureCCW(rect.slice().reverse())) === polyArea(rect), 'ориентация на площадь не влияет');
});

test('cleanPoly убирает точки на одной линии и дубли', () => {
  const pts = [v(0, 0), v(5, 0), v(10, 0), v(10, 10), v(0, 10), v(0, 0)];
  const c = cleanPoly(pts);
  assert.equal(c.length, 4);
  assert.ok(polyArea(ensureCCW(c)) > 99);
});

test('mergeCollinear склеивает линии в полилинии', () => {
  const segs = mergeCollinear([
    { a: v(0, 0), b: v(10, 0), kind: 'cut' },
    { a: v(10, 0), b: v(20, 0), kind: 'cut' },
    { a: v(20, 0), b: v(20, 8), kind: 'cut' },
  ]);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].b.x, 20);
});

test('габарит заготовки = чертёж 0427 (240×180×60, E, ласточкин хвост + язычок)', () => {
  const d = computeDims(240, 180, 60, 1.4, DEFAULT_COEF.lastochkin, 'tuck', makeInput({ L: 1, W: 1, H: 1 }).options);
  const g = derived(d);
  assert.equal(g.blankW, 550, 'ширина по вашему чертежу 550');
  assert.equal(g.blankH, 513, 'высота по вашему чертежу 513');
});

test('движок рисует ровно тот же габарит, что и формула', () => {
  const res = demo();
  assert.equal(res.area.blankW, 550);
  assert.equal(res.area.blankH, 513);
  assert.equal(res.die.x1, 630, 'штамп = заготовка + 40 мм с каждой стороны');
  assert.equal(res.die.y1, 593);
});

test('площадь заготовки — по контуру высечки, а не по штампу', () => {
  const res = demo();
  assert.ok(res.area.bboxAreaM2 > res.area.blankAreaM2, 'полигон всегда меньше габарита');
  assert.ok(res.area.fillInBbox > 0.5 && res.area.fillInBbox < 0.85, `заполнение ${res.area.fillInBbox}`);
  assert.equal(Math.round(res.area.bboxAreaM2 * 1e4) / 1e4, 0.2822);
});

test('панели не перекрываются, дублей линий реза нет', () => {
  const res = demo();
  const sum = res.geom.panels.reduce((s, p) => s + Math.abs(polyArea(ensureCCW(p.pts))), 0);
  const holes = res.geom.holes.reduce((s, h) => s + Math.abs(polyArea(ensureCCW(h))), 0);
  assert.ok(Math.abs(sum - holes - res.area.blankAreaM2 * 1e6) < 400, 'расхождение — только округление 0,5 мм');
  const seen = new Set<string>();
  let dup = 0;
  for (const s of res.segMap.cut) {
    const k = [s.a.x, s.a.y, s.b.x, s.b.y].join(',');
    const k2 = [s.b.x, s.b.y, s.a.x, s.a.y].join(',');
    if (seen.has(k) || seen.has(k2)) dup++;
    seen.add(k);
  }
  assert.equal(dup, 0, 'нож на одном месте дважды не ставится');
});

test('биговки отличаются от реза и лежат внутри заготовки', () => {
  const res = demo();
  assert.equal(res.segMap.cut.length, 83);
  assert.equal(res.segMap.crease.length, 9);
  const bb = res.bbox;
  for (const s of res.segMap.crease) {
    assert.ok(s.a.x >= bb.x0 - 0.01 && s.a.x <= bb.x1 + 0.01);
    assert.ok(s.a.y >= bb.y0 - 0.01 && s.a.y <= bb.y1 + 0.01);
  }
});

test('техно-уголки: 4 отсечки по периметру клапанов', () => {
  const res = demo();
  assert.ok(res.knives.techM > 0.7 && res.knives.techM < 0.9, `${res.knives.techM} м`);
});

test('режим «по чертежу матрицы» берёт габарит вручную', () => {
  const q = quickEstimate({ L: 0, W: 0, H: 0, blank: { w: 400, h: 300 } });
  assert.equal(q.blank.w, 400);
  assert.equal(q.blank.h, 300);
  assert.equal(Math.round(q.blank.areaM2 * 1e4) / 1e4, 0.12);
});

test('некорректные размеры дают предупреждение, а не падение', () => {
  const res = calcBox({ input: makeInput({ L: 20, W: 20, H: 5 }), settings: baseSettings() });
  assert.ok(res.warnings.some((w) => w.includes('Минимальные размеры')));
});

test('сборка: панели соединены по линиям сгиба, ничего не висит в воздухе', () => {
  const res = demo();
  const byId = new Map(res.geom.panels.map((q) => [q.id, q]));
  const distToPolyline = (pt: { x: number; y: number }, pts: Array<{ x: number; y: number }>): number => {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1e-6;
      const tt = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2));
      best = Math.min(best, Math.hypot(pt.x - (a.x + tt * dx), pt.y - (a.y + tt * dy)));
    }
    return best;
  };
  // 1) в плоском чертеже линия сгиба каждого клапана лежит на контуре родителя
  for (const q of res.geom.panels) {
    if (!q.hinge || !q.parent) continue;
    const par = byId.get(q.parent);
    assert.ok(par, `${q.id}: нет родителя ${q.parent}`);
    assert.ok(distToPolyline(q.hinge.p, par.pts) < 0.6, `${q.id}: сгиб не на кромке ${q.parent}`);
    assert.ok(distToPolyline(q.hinge.q, par.pts) < 0.6, `${q.id}: сгиб не на кромке ${q.parent}`);
  }
  // 2) в собранном виде общий край не расходится (толщина картона + послойный зазор)
  for (const prog of [0.5, 1]) {
    const xf = foldTransforms(res, prog);
    for (const q of res.geom.panels) {
      if (!q.hinge || !q.parent || !q.fold) continue;
      const T = xf.get(q.id)!;
      const P = xf.get(q.parent)!;
      const at = (h: { x: number; y: number }): V3 => ({ x: h.x, y: h.y, z: 0 });
      for (const h of [q.hinge.p, q.hinge.q]) {
        const a = T(at(h));
        const b = P(at(h));
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1.6, `${q.id} при ${prog}: расхождение краёв ${(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toFixed(2)} мм`);
      }
    }
  }
  // 3) стенки стоят вертикально вверх, а не вбок/вниз
  const f1 = foldTransforms(res, 1);
  for (const q of res.geom.panels.filter((s) => (s.step ?? 0) > 0 && (s.step ?? 0) <= 2)) {
    const T = f1.get(q.id)!;
    const zs = q.pts.map((pt) => T({ x: pt.x, y: pt.y, z: 0 }).z);
    assert.ok(Math.min(...zs) > -0.01, `${q.id}: стенка уходит под дно`);
    assert.ok(Math.max(...zs) > res.geom.meta.Hp * 0.95, `${q.id}: стенка не поднялась`);
  }
  // 4) крышка лежит НА коробке (z ≈ Hp), а не болтается выше/ниже
  const lid = res.geom.panels.find((q) => q.role === 'lid');
  if (lid) {
    const T = f1.get(lid.id)!;
    for (const pt of lid.pts) {
      const z = T({ x: pt.x, y: pt.y, z: 0 }).z;
      assert.ok(Math.abs(z - res.geom.meta.Hp) < 1.5, `крышка на z=${z.toFixed(1)} вместо ${res.geom.meta.Hp}`);
    }
  }
});
