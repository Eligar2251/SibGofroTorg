/**
 * Обучение на сохранённых расчётах: среднее по подтверждённым записям,
 * поправка габарита (она же «матрица») и множитель цены.
 * Запуск: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_COEF,
  DEFAULT_PROFILES,
  applyPriceFactor,
  baseSettings,
  calcBox,
  geoLessonFor,
  learnedCoefs,
  learnModel,
  makeInput,
  median,
  packJob,
  priceFactorFor,
  sampleFromRow,
  type BoxInput,
  type ConstructionId,
  type Coef,
  type DieCalcSample,
} from '../src/core/index';

const est = (L: number, W: number, H: number, coef: Coef = DEFAULT_COEF.lastochkin): { w: number; h: number; perPcs: number } => {
  const input: BoxInput = { ...makeInput({ L, W, H, profile: 'E', construction: 'lastochkin', closure: 'tuck', qty: 5000 }), coef };
  const res = calcBox({ input, settings: baseSettings() });
  return { w: res.area.blankW, h: res.area.blankH, perPcs: res.cost.perPcs };
};

const sample = (over: Partial<DieCalcSample> = {}): DieCalcSample => ({
  id: 'x',
  name: '',
  construction: 'lastochkin',
  closure: 'tuck',
  profileId: 'E',
  L: 240,
  W: 180,
  H: 60,
  qty: 5000,
  estBlankW: 550,
  estBlankH: 513,
  estPricePerPcs: 28,
  estCoef: null,
  estPrices: null,
  factBlankW: null,
  factBlankH: null,
  factPricePerPcs: null,
  factPriceBatch: null,
  factQty: null,
  createdAt: '2026-01-01',
  ...over,
});

test('median: чётный/нечётный набор и пусто', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('обучение: поправка габарита уменьшает ошибку на реальных размерах', () => {
  const sizes: Array<[number, number, number]> = [
    [240, 180, 60],
    [300, 200, 80],
    [200, 150, 50],
    [420, 300, 120],
  ];
  // «цех» стабильно даёт заготовку на 10 и 8 мм больше, чем считает дефолт
  const samples = sizes.map(([L, W, H], i) => {
    const e = est(L, W, H);
    return sample({
      id: `s${i}`,
      L,
      W,
      H,
      estBlankW: Math.round(e.w * 10) / 10,
      estBlankH: Math.round(e.h * 10) / 10,
      factBlankW: Math.round((e.w + 10) * 10) / 10,
      factBlankH: Math.round((e.h + 8) * 10) / 10,
      createdAt: `2026-01-0${i + 1}`,
    });
  });

  const model = learnModel(samples, DEFAULT_PROFILES.map((p) => ({ ...p })), { minGeoSamples: 2 });
  const lesson = geoLessonFor(model, 'lastochkin');
  assert.ok(lesson, 'урок по геометрии появился');
  assert.equal(lesson!.n, 4);
  assert.ok(lesson!.fitted, 'записей хватило на подгонку');
  assert.ok(
    lesson!.errAfterMm < lesson!.errBeforeMm,
    `ошибка должна упасть: было ${lesson!.errBeforeMm} мм, стало ${lesson!.errAfterMm} мм`,
  );
  // таблица припусков реально изменилась (какой именно лист уедет — решает
  // спуск, поэтому сравниваем всю структуру, а не отдельное поле)
  assert.notEqual(JSON.stringify(lesson!.coef), JSON.stringify(DEFAULT_COEF.lastochkin), 'припуски сдвинуты');
});

test('обучение: цена — медиана, а не среднее (выбросы не тянут прайс)', () => {
  const base = sample({ estPricePerPcs: 28 });
  const samples = [
    { ...base, id: 'a', factPricePerPcs: 28 * 1.1 },
    { ...base, id: 'b', factPricePerPcs: 28 * 1.1 },
    { ...base, id: 'c', factPricePerPcs: 28 * 1.12 },
    // срыв тиража / «по знакомству»: не должно утаскивать всю группу
    { ...base, id: 'd', factPricePerPcs: 28 * 3 },
    { ...base, id: 'e', factPriceBatch: 28 * 5000 * 0.4, factQty: 5000 },
  ].map((s) => sample(s));

  const model = learnModel(samples, DEFAULT_PROFILES.map((p) => ({ ...p })));
  const f = priceFactorFor(model, { construction: 'lastochkin', closure: 'tuck', profileId: 'E' });
  assert.ok(f.n >= 3, `группа набрана (${f.n})`);
  assert.ok(Math.abs(f.k - 1.1) < 0.03, `медиана ≈ 1.1, а не среднее с выбросом: ${f.k}`);
  assert.ok(f.k < 1.25, 'выброс ×3 не попал в множитель');
  assert.equal(f.label.includes('Ласточкин'), true, 'группа подписана человеком');
});

test('обучение: цепочка fallback — нет группы, берём конструкцию, потом весь прайс', () => {
  const samples = [
    sample({ id: 'a', construction: 'lotok', closure: 'glue', estPricePerPcs: 20, factPricePerPcs: 22 }),
    sample({ id: 'b', construction: 'lotok', closure: 'glue', estPricePerPcs: 20, factPricePerPcs: 22.4 }),
  ];
  const model = learnModel(samples, DEFAULT_PROFILES.map((p) => ({ ...p })));

  // та же конструкция, другой замок и профиль → срабатывает уровень «конструкция»
  const viaCons = priceFactorFor(model, { construction: 'lotok', closure: 'tuck', profileId: 'B' });
  assert.ok(viaCons.n >= 2, 'считана группа конструкции');
  assert.ok(Math.abs(viaCons.k - 1.11) < 0.06, `×1.11 около среднего по лотку: ${viaCons.k}`);

  // чужая конструкция → общий множитель по всему прайсу
  const viaAll = priceFactorFor(model, { construction: 'yazyk', closure: 'tuck', profileId: 'E' });
  assert.ok(viaAll.n >= 2, 'взята группа «весь прайс»');

  // пустая модель → правки нет
  const empty = priceFactorFor(null, { construction: 'yazyk', closure: 'tuck', profileId: 'E' });
  assert.equal(empty.k, 1);
  assert.equal(empty.n, 0);
});

test('обучение: без фактов ничего не меняется', () => {
  const model = learnModel([sample({ id: 'a' }), sample({ id: 'b', closure: 'half' })], DEFAULT_PROFILES.map((p) => ({ ...p })));
  assert.equal(model.geo.length, 0, 'геометрия не тронута');
  assert.deepEqual(learnedCoefs(DEFAULT_COEF, model).applied, [], 'коэффициенты не подменены');
  assert.match(model.notes.join(' '), /нет/i);
  assert.equal(learnedCoefs(DEFAULT_COEF, model).coefs.lastochkin.allowL.c, DEFAULT_COEF.lastochkin.allowL.c);
});

test('обучение: мало записей — подгонку не запускаем', () => {
  const e = est(240, 180, 60);
  const model = learnModel(
    [sample({ id: 'only', estBlankW: e.w, estBlankH: e.h, factBlankW: e.w + 12, factBlankH: e.h + 10 })],
    DEFAULT_PROFILES.map((p) => ({ ...p })),
    { minGeoSamples: 2 },
  );
  const lesson = model.geo.find((g) => g.construction === 'lastochkin');
  assert.ok(lesson, 'урок описан');
  assert.equal(lesson!.fitted, false, 'но не применён');
  assert.equal(geoLessonFor(model, 'lastochkin'), null, 'движок его не берёт');
  assert.deepEqual(learnedCoefs(DEFAULT_COEF, model).applied, []);
});

test('обучение: меняет только свою конструкцию, остальные коэффициенты целы', () => {
  const mk = (n: number, i: number): DieCalcSample => {
    const e = est(200 + i * 30, 150 + i * 20, 40 + i * 10);
    return sample({ id: `g${n}`, L: 200 + i * 30, W: 150 + i * 20, H: 40 + i * 10, estBlankW: e.w, estBlankH: e.h, factBlankW: e.w + 12, factBlankH: e.h + 9 });
  };
  const model = learnModel([mk(1, 0), mk(2, 1), mk(3, 2)], DEFAULT_PROFILES.map((p) => ({ ...p })));
  const current: Record<ConstructionId, Coef> = { ...DEFAULT_COEF, lotok: { ...DEFAULT_COEF.lotok, ear: 33 } };
  const merged = learnedCoefs(current, model);
  assert.deepEqual(merged.applied, ['lastochkin'], 'применена только выученная конструкция');
  assert.equal(merged.coefs.lotok.ear, 33, 'ручная правка лотка сохранилась');
  assert.notEqual(
    JSON.stringify(merged.coefs.lastochkin),
    JSON.stringify(DEFAULT_COEF.lastochkin),
    'ласточкин хвост подправлен',
  );
});

test('пакет в базу: колонки совпадают с расчётом, из строки читается то же', () => {
  const input = makeInput({ L: 240, W: 180, H: 60, profile: 'E', construction: 'lastochkin', closure: 'tuck', qty: 5000 });
  const settings = baseSettings();
  const res = calcBox({ input, settings });
  const payload = packJob(res, {
    orderNo: '1200-10-25',
    prices: settings.prices,
    profiles: settings.profiles,
    sheets: settings.sheets,
  });
  assert.equal(payload.construction, 'lastochkin');
  assert.equal(payload.closure, 'tuck');
  assert.equal(payload.qty, 5000);
  assert.equal(payload.blank_w, Math.round(res.area.blankW * 10) / 10);
  assert.equal(payload.die_w, Math.round(res.area.dieW * 10) / 10);
  assert.equal(payload.price_per_pcs, Math.round(res.cost.perPcs * 100) / 100);
  assert.equal(payload.name.includes('ЛХ-0427'), true, 'маркировка собрана из кода и размеров');
  assert.equal(payload.settings.input.L, 240);
  assert.ok(payload.result.cost, 'снимок результата лежит в jsonb');

  // строка, которую вернул Supabase → образец обучения
  const row = {
    ...payload,
    id: '11111111-1111-1111-1111-111111111111',
    l_mm: '240.00',
    w_mm: '180.00',
    h_mm: '60.00',
    fact_blank_w: '560.00',
    fact_blank_h: '521.00',
    fact_price_per_pcs: '30.50',
    fact_price_batch: null,
    fact_qty: 5000,
    created_at: '2026-01-05T00:00:00Z',
  };
  const s = sampleFromRow(row as unknown as Record<string, unknown>);
  assert.ok(s);
  assert.equal(s!.L, 240);
  assert.equal(s!.estBlankW, Math.round(res.area.blankW * 10) / 10);
  assert.equal(s!.factBlankW, 560);
  assert.equal(s!.factPricePerPcs, 30.5);
  assert.ok(s!.estCoef, 'коэффициенты, на которых считали, доехали до обучения');
  assert.equal(s!.profileId, 'E');

  // мусор/чужая конструкция → null, а не исключение
  assert.equal(sampleFromRow({ construction: 'nope', closure: 'tuck' }), null);
  assert.equal(sampleFromRow({}), null);
});

test('применение множителя цены: пропорции сохраняются, НДС считается', () => {
  const input = makeInput({ L: 240, W: 180, H: 60, profile: 'E', construction: 'lastochkin', closure: 'tuck', qty: 5000 });
  const res = calcBox({ input, settings: baseSettings() });
  const scaled = applyPriceFactor(res.cost, 1.1);
  assert.equal(scaled.k, 1.1);
  assert.ok(Math.abs(scaled.perPcs / res.cost.perPcs - 1.1) < 0.01);
  assert.ok(scaled.withVat > scaled.batch, 'НДС начислен на скорректированную партию');
  // k=1 → ровно то, что посчитало ядро
  const one = applyPriceFactor(res.cost, 1);
  assert.equal(one.perPcs, Math.round(res.cost.perPcs * 100) / 100);
  // мусор не роняет расчёт
  assert.equal(applyPriceFactor(res.cost, 0).k, 1);
});
