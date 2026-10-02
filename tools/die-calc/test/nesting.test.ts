/**
 * раскладка по листу, длины ножей и деньги. Запуск: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcBox,
  makeInput,
  baseSettings,
  fitAll,
  calibReport,
  meanAbsError,
  DEFAULT_COEF,
  DEFAULT_NESTING,
  DEFAULT_PRICES,
  packOnce,
  nestOnSheet,
  type BoxInput,
  type SheetFormat,
} from '../src/core/index';

const sheet: SheetFormat = { id: 't', name: '1800×2400', w: 1800, h: 2400 };

const boxInput = (over: Partial<BoxInput> = {}): BoxInput => ({
  ...makeInput({ L: 240, W: 180, H: 60, profile: 'E', construction: 'lastochkin', closure: 'tuck', qty: 5000 }),
  ...over,
});

const res = calcBox({ input: boxInput(), settings: baseSettings() });

test('раскладка: 12 заготовок 550×513 с листа 1800×2400', () => {
  const p = packOnce({ w: 550, h: 513, areaMm2: 550 * 513 * 0.646 }, sheet.w, sheet.h, DEFAULT_NESTING);
  assert.ok(p.perSheet >= 12, `${p.perSheet} шт — раскладка деградировала`);
  assert.equal(res.nest.perSheet, 12);
});

test('листов на тираж хватает, полезная площадь в пределах листа', () => {
  assert.equal(res.nest.sheets, Math.ceil(5000 / res.nest.perSheet));
  assert.equal(res.nest.sheets, 417);
  assert.ok(res.nest.layout.length === res.nest.perSheet);
  for (const it of res.nest.layout) {
    assert.ok(it.x >= 0 && it.y >= 0);
    assert.ok(it.x + it.w <= res.nest.sheetBox.x1 + 0.01, 'заготовка не вылезает за лист');
    assert.ok(it.y + it.h <= res.nest.sheetBox.y1 + 0.01);
  }
  assert.ok(res.nest.utilization > 0.4 && res.nest.utilization < 1);
});

test('лист меньше — штук с листа меньше; лист больше — не меньше', () => {
  const small = nestOnSheet({ w: 550, h: 513, areaMm2: 550 * 513 }, { id: 's', name: 's', w: 1000, h: 1200 }, DEFAULT_NESTING, 100);
  assert.ok(small.perSheet < res.nest.perSheet);
  const big = nestOnSheet({ w: 550, h: 513, areaMm2: 550 * 513 }, { id: 'b', name: 'b', w: 2000, h: 3000 }, DEFAULT_NESTING, 100);
  assert.ok(big.perSheet >= res.nest.perSheet);
});

test('если не влезает — предупреждение, а не деление на ноль', () => {
  const r = calcBox({
    input: boxInput({ L: 500, W: 400, H: 150, profileId: 'B', construction: 'lotok', closure: 'none' }),
    settings: baseSettings({ sheets: [{ id: 'tiny', name: 'малыш', w: 300, h: 300 }] }),
  });
  assert.equal(r.nest.perSheet, 0);
  assert.equal(r.nest.sheets, 0);
  assert.ok(r.warnings.some((w) => w.includes('не влезает')));
  assert.ok(Number.isFinite(r.cost.batch.total));
});

test('ножи: сумма слоёв сходится с итогом, сталь короче за счёт перемычек', () => {
  const k = res.knives;
  assert.ok(Math.abs(k.cutM + k.creaseM + k.perfM + k.techM - k.totalM) < 0.01);
  assert.ok(k.steelM <= k.totalM + 1e-6 && k.steelM > k.totalM * 0.85, `сталь ${k.steelM} при ${k.totalM}`);
  assert.ok(k.cutM > 2 && k.cutM < 4, `рез ${k.cutM} м`);
  assert.ok(k.creaseM > 1.5 && k.creaseM < 2.5, `биг ${k.creaseM} м`);
  assert.ok(k.outlineM > 2 && k.outlineM < 3.2, `периметр ${k.outlineM} м`);
});

test('перемычки (ники) режут длину стали, но не длину ножей', () => {
  const noNick = calcBox({ input: boxInput({ die: { ...makeInput({ L: 1, W: 1, H: 1 }).die, nickEvery: 0 } }), settings: baseSettings() });
  assert.ok(noNick.knives.steelM >= res.knives.steelM);
  assert.ok(Math.abs(noNick.knives.totalM - res.knives.totalM) < 0.01, 'геометрия та же');
});

test('цена картона = площадь полигона × цена м² (E = 36 ₽/м²)', () => {
  const prof = baseSettings().profiles.find((p) => p.id === 'E');
  assert.ok(prof);
  assert.equal(prof.priceM2, 36, 'микрогофра E — 36 ₽/м², как договорились');
  assert.equal(baseSettings().profiles.find((p) => p.id === 'B')?.priceM2, 38, 'гофра B — 38 ₽/м²');
  // платят за весь «слот» в листе, а не за чистую полигону — иначе в минус
  const slotM2 = (res.nest.sheet.w * res.nest.sheet.h) / 1e6 / res.nest.perSheet;
  const per = slotM2 * prof.priceM2 * (1 + DEFAULT_PRICES.waste);
  assert.ok(Math.abs(res.cost.cardboardPerPcs - per) < 0.02, `${res.cost.cardboardPerPcs} vs ${per.toFixed(3)}`);
  const net = res.area.blankAreaM2 * prof.priceM2;
  assert.ok(net < res.cost.cardboardPerPcs, 'полезная площадь дешевле, чем слот листа');
  assert.ok(res.cost.batch.parts.some((p) => p.label.includes('полезная площадь')));
});

test('тираж, НДС 20% и себестоимость за штуку', () => {
  assert.ok(res.cost.batch.total > 1000);
  const gross = res.cost.batch.total + res.cost.die.total;
  assert.equal(Math.round((res.cost.withVat / gross) * 100) / 100, 1.2, 'НДС 20% на тираж и оснастку');
  assert.ok(Math.abs(res.cost.perPcs - res.cost.batch.total / 5000) < 0.02);
  assert.ok(res.cost.perPcsWithDie > res.cost.perPcs, 'оснастка распределяется на тираж');
  assert.ok(res.cost.minutes > 60 && res.cost.minutes < 140, `${res.cost.minutes} мин`);
});

test('штамп дорожает вместе с габаритом; 2-up — шире и дороже', () => {
  const small = calcBox({ input: boxInput({ L: 120, W: 90, H: 40 }), settings: baseSettings() });
  assert.ok(small.cost.die.total < res.cost.die.total);
  const base = makeInput({ L: 240, W: 180, H: 60, profile: 'E', construction: 'lastochkin', closure: 'tuck' });
  const two = calcBox({
    input: { ...base, options: { ...base.options, perDie: 2 } },
    settings: baseSettings(),
  });
  assert.ok(two.area.dieW > res.area.dieW + 500, '2-up шире на заготовку');
  assert.ok(two.cost.die.total > res.cost.die.total);
  // статистика ножей — на одну заготовку, а в штампе их две
  assert.ok(Math.abs(two.knives.cutM - res.knives.cutM) < 0.01);
  const kn = (r: typeof res): number => r.cost.die.parts.find((p) => p.label.toLowerCase().includes('нож'))?.value ?? 0;
  assert.ok(kn(two) > kn(res) * 1.8, 'в цене штампа ножи учтены для обеих заготовок');
});

test('калибровка по эталонным чертежам уменьшает ошибку габарита', () => {
  const st = baseSettings();
  const before = meanAbsError(calibReport(DEFAULT_COEF, st.profiles));
  const fit = fitAll(st.profiles);
  assert.ok(meanAbsError(fit.after) <= before, `${meanAbsError(fit.after)} ≤ ${before}`);
  assert.equal(fit.after.length, 6, 'калибруются 6 чертежей из 9');
  // дефолты уже запечены по этим же чертежам: 4 из 6 — точнее 2%
  const exact = fit.after.filter((r) => r.errPct <= 2).length;
  assert.ok(exact >= 4, `точнее 2% только ${exact} из 6`);
});

test('штамп 2-up: ножи и лазер считаются по обоим гнёздам', () => {
  const base = makeInput({ L: 240, W: 180, H: 60, profile: 'E', construction: 'lastochkin', closure: 'tuck', qty: 5000 });
  const two = calcBox({ input: { ...base, options: { ...base.options, perDie: 2 } }, settings: baseSettings() });
  const kn = (r: typeof res): number => r.cost.die.parts.find((p) => p.label.startsWith('Ножи'))?.value ?? 0;
  const lz = (r: typeof res): number => r.cost.die.parts.find((p) => p.label.startsWith('Лазер'))?.value ?? 0;
  assert.ok(Math.abs(kn(two) - kn(res) * 2) <= 2, `${kn(two)} vs ${kn(res) * 2}`);
  assert.ok(Math.abs(lz(two) - lz(res) * 2) <= 2, 'лазер по длине реза обоих гнёзд');
  assert.ok(Math.abs(two.knives.cutM - res.knives.cutM) < 0.01, 'статистика ножей — на одну заготовку');
  // ударов втрое меньше нет: тираж делится на число гнёзд
  assert.ok(Math.abs(two.cost.batch.parts.find((p) => p.label.startsWith('Высечка'))!.value - res.cost.batch.parts.find((p) => p.label.startsWith('Высечка'))!.value / 2) < 2);
  assert.ok(two.nest.perSheet >= res.nest.perSheet, 'с листа при 2-up штук не меньше');
});
