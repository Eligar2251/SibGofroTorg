/**
 * экспорт: DXF для ЧПУ, SVG развёртки, 3D-сборка, спецификация.
 * Запуск: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcBox,
  makeInput,
  baseSettings,
  toDxf,
  DXF_LAYER,
  specText,
  specCsv,
  quickCard,
  renderUnfold,
  renderFold,
} from '../src/core/index';

const res = calcBox({
  input: makeInput({ L: 240, W: 180, H: 60, profile: 'E', construction: 'lastochkin', closure: 'tuck', qty: 5000 }),
  settings: baseSettings(),
});

test('DXF: корректная структура R12 и слои штанцформы', () => {
  const dxf = toDxf(res, { label: '0427-240*180*60-E' });
  const lines = dxf.split('\n');
  assert.ok(!dxf.includes("'SECTION"), 'кавычек в DXF быть не должно');
  assert.equal(lines[0], '0');
  assert.equal(lines[1], 'SECTION');
  assert.deepEqual(lines.slice(-2), ['0', 'EOF'], 'заканчивается на 0 / EOF');
  assert.equal(lines.length % 2, 0, 'ровно пары «код/значение»');
  assert.equal(lines.filter((l) => l === 'ENDSEC').length, lines.filter((l) => l === 'SECTION').length);
  for (let i = 0; i < lines.length; i += 2) {
    assert.ok(/^-?\d+$/.test(lines[i]), `код DXF на строке ${i}: «${lines[i]}»`);
  }
  for (const name of ['CUT', 'CREASE', 'PERF', 'TECH', 'MARK']) {
    const layer = Object.values(DXF_LAYER).find((l) => l.name.toUpperCase().includes(name));
    assert.ok(layer, `слой ${name} описан`);
    assert.ok(dxf.includes(layer.name), `слой ${name} в таблице слоёв`);
  }
  assert.ok(dxf.includes('0427-240*180*60-E'), 'надпись с артикулом на месте');
});

test('DXF: все координаты конечны и лежат в габарите штампа', () => {
  const lines = toDxf(res).split('\n');
  const dxf = lines.join('\n');
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    if (lines[i] === '10') xs.push(Number(lines[i + 1]));
    if (lines[i] === '20') ys.push(Number(lines[i + 1]));
  }
  assert.ok(xs.length > 100 && xs.length === ys.length, `пар координат: ${xs.length}/${ys.length}`);
  for (const n of xs.concat(ys)) assert.ok(Number.isFinite(n), `NaN в DXF: ${n}`);
  const fm = res.input.die.frameMargin;
  const plate = { x0: -fm, y0: -fm, x1: res.die.x1 - fm, y1: res.die.y1 - fm };
  assert.ok(Math.max(...xs) <= plate.x1 + 0.01 && Math.min(...xs) >= plate.x0 - 0.01, 'xs в габарите плиты');
  assert.ok(Math.max(...ys) <= plate.y1 + 0.01 && Math.min(...ys) >= plate.y0 - 0.01, 'ys в габарите плиты');
  assert.ok(dxf.includes('10\n' + String(-fm)), 'EXTMIN = левый нижний угол плиты');
});

test('DXF без штампа — только изделие (рез/биг/перф)', () => {
  const full = toDxf(res, { includeDie: true });
  const dxf = toDxf(res, { includeDie: false });
  const cnt = (s: string, w: string): number => s.split(w).length - 1;
  assert.ok(cnt(dxf, DXF_LAYER.mark.name) < cnt(full, DXF_LAYER.mark.name), 'рамки и маркировки вEntities нет');
  assert.ok(!dxf.includes(DXF_LAYER.tech.name));
  assert.ok(dxf.includes(DXF_LAYER.cut.name));
  assert.ok(dxf.includes(DXF_LAYER.crease.name));
});

test('SVG развёртки: слои, размеры, никакого NaN', () => {
  const svg = renderUnfold(res, { showDie: true, showDims: true, showFills: true, theme: 'light' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  for (const l of ['layer-cut', 'layer-crease', 'layer-tech', 'layer-mark']) {
    assert.ok(svg.includes(l), l);
  }
  assert.ok(!svg.includes('layer-perf'), 'перфорации в демке нет — слоя тоже нет');
  const perfBase = makeInput({ L: 240, W: 180, H: 60, profile: 'E', construction: 'lastochkin', closure: 'tuck' });
  const withPerf = calcBox({
    input: { ...perfBase, options: { ...perfBase.options, perforation: true } },
    settings: baseSettings(),
  });
  assert.ok(renderUnfold(withPerf, { theme: 'light' }).includes('layer-perf'), 'перфорация — отдельным слоем');
  assert.ok(withPerf.knives.perfM > 0.1, `${withPerf.knives.perfM} м перфорации`);
  assert.ok(svg.includes('550'), 'подпись ширины заготовки');
  assert.ok(svg.includes('513'), 'подпись высоты заготовки');
  assert.ok(!svg.includes('NaN'), 'NaN в SVG недопустим');
  assert.ok(!svg.includes('>undefined<'), 'undefined в SVG недопустим');
});

test('SVG: отключение слоёв и размеров уменьшает вывод', () => {
  const full = renderUnfold(res, { showDie: true, showDims: true, showFills: true, theme: 'dark' });
  const thin = renderUnfold(res, { showDie: false, showDims: false, showFills: false, theme: 'dark', layers: { mark: false, tech: false, perf: false } });
  assert.ok(thin.length < full.length);
  assert.ok(!thin.includes('layer-mark'));
  assert.ok(thin.includes('viewBox'));
  assert.ok(thin.includes('layer-cut'), 'рез остаётся');
});

test('3D-сборка: панелей столько же, сколько в развёртке', () => {
  const flat = renderFold(res, { progress: 0, yaw: -58, pitch: 26, theme: 'light' });
  const folded = renderFold(res, { progress: 1, yaw: -58, pitch: 26, theme: 'light' });
  const n = res.geom.panels.length;
  for (const svg3d of [flat, folded]) {
    assert.ok(svg3d.startsWith('<svg'), '3D — это svg');
    assert.ok((svg3d.match(/<path/g) || []).length >= n, 'граней не меньше, чем панелей');
  }
  // грани + «толщина» по силуэту: граней всегда больше, чем панелей, но не астрономически
  for (const [name, svg3d] of [['flat', flat], ['folded', folded]] as const) {
    const f = (svg3d.match(/fill-opacity/g) || []).length;
    assert.ok(f >= n && f <= n * 24, `${name}: ${f} граней при ${n} панелях`);
  }
  assert.ok(folded.includes('сборка 100%'), 'подпись прогресса сборки');
  assert.ok(flat.includes('сборка 0%'));
  assert.ok(!folded.includes('NaN'), 'NaN в 3D недопустим');
  assert.notEqual(flat, folded, 'прогресс сборки реально меняет картинку');
});

test('спецификация: человекочитаемый текст, CSV и карточка', () => {
  const txt = specText(res, '0427');
  assert.ok(txt.includes('0427'));
  assert.ok(/550/.test(txt) && /513/.test(txt), 'габарит заготовки в тексте');
  assert.ok(txt.includes('36') || txt.includes('картон'), 'цена картона/профиль');
  const csv = specCsv(res);
  const rows = csv.trim().split('\n');
  assert.ok(rows.length > 8, `${rows.length} строк CSV`);
  for (const r of rows) assert.equal(r.split(';').length >= 2, true);
  const card = quickCard(res);
  assert.equal(card.perSheet, 12);
  assert.equal(card.blank, '550×513 мм');
  assert.ok(card.utilization.endsWith('%'));
});

test('экспорт не падает на «пустых» конструкциях', () => {
  for (const over of [
    { construction: 'blank' as const, blankW: 400, blankH: 300 },
    { construction: 'lotok' as const, closure: 'none' as const },
    { construction: 'bokovoy' as const, closure: 'full' as const },
    { construction: 'yazyk' as const, closure: 'half' as const },
  ]) {
    const r = calcBox({ input: { ...makeInput({ L: 240, W: 180, H: 60, profile: 'E', qty: 1000 }), ...over }, settings: baseSettings() });
    assert.ok(r.segMap.cut.length > 0, `${over.construction}: нет линий реза`);
    assert.ok(toDxf(r).length > 1000, over.construction);
    assert.ok(renderUnfold(r, { theme: 'light' }).includes('<svg'), over.construction);
    assert.ok(r.area.blankAreaM2 > 0.01, over.construction);
  }
});

test('штамп 2-up: и в SVG, и в DXF видно оба гнезда', () => {
  const base = makeInput({ L: 240, W: 180, H: 60, profile: 'E', construction: 'lastochkin', closure: 'tuck' });
  const two = calcBox({ input: { ...base, options: { ...base.options, perDie: 2 } }, settings: baseSettings() });
  const svg = renderUnfold(two, { theme: 'light', showDie: true, showDims: true, showFills: true });
  // копии: заливка, биговка, рез — по 2 гнезда; рамка и техно — без дублей
  assert.equal((svg.match(/transform="translate/g) || []).length, 6, 'копии: заливка + биг + рез');
  const cnt = (dxf: string, layer: string): number => dxf.split('\n').filter((l, i, a) => l === 'LINE' && a[i + 1] === '8' && a[i + 2] === layer).length;
  assert.equal(cnt(toDxf(two), 'CUT'), cnt(toDxf(res), 'CUT') * 2, 'в DXF линии реза продублированы');
});
