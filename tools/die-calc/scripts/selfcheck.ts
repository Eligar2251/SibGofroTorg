/**
 * selfcheck.ts — сверка движка с 9 эталонными чертежами + полный расчёт демки.
 * Запуск: `npm run check` (esbuild бандлит в .tmp/selfcheck.mjs, затем node).
 */

import { calcBox, baseSettings } from '../src/core/index';
import { FIXTURES, CALIBRATABLE } from '../src/core/fixtures';
import { calibReport, fitAll, meanAbsError } from '../src/core/calibrate';
import { DEFAULT_COEF, DEFAULT_DIE, DEFAULT_NESTING, DEFAULT_OPTIONS, makeInput } from '../src/core/index';
import { buildTray, computeDims } from '../src/core/templates';
import { linesFromGeom, normalizeToOrigin } from '../src/core/engine';

const pad = (s: string | number, n: number): string => String(s).padEnd(n, ' ');

console.log('\n=== 1. Габарит заготовки по эталонным чертежам (до калибровки) ===\n');
console.log(pad('чертёж', 24) + pad('внутр. L×W×H', 18) + pad('факт W×H', 16) + pad('расчёт W×H', 16) + pad('Δ', 12) + 'Δ%');
const settings = baseSettings();
const beforeRows = calibReport(DEFAULT_COEF, settings.profiles);
const byId = new Map(FIXTURES.map((f) => [f.id, f]));
let maxBefore = 0;
for (const r of beforeRows) {
  const f = byId.get(r.id);
  const err = `${r.dW > 0 ? '+' : ''}${r.dW} / ${r.dH > 0 ? '+' : ''}${r.dH}`;
  maxBefore = Math.max(maxBefore, Math.abs(r.dW), Math.abs(r.dH));
  console.log(
    pad(`${r.mark} (${r.id})`, 24) +
      pad(`${f?.L}×${f?.W}×${f?.H}`, 18) +
      pad(`${r.actualW}×${r.actualH}`, 16) +
      pad(`${r.predW}×${r.predH}`, 16) +
      pad(err, 12) +
      `${r.errPct}%`,
  );
}
console.log(`\nсредняя ошибка по габариту: ${meanAbsError(beforeRows)} мм, максимум ${maxBefore} мм`);
console.log('не калибруется: ' + FIXTURES.filter((f) => !f.construction).map((f) => `${f.mark} [${f.note}]`).join(', '));

console.log('\n=== 2. Автоподгонка припусков по тем же чертежам ===\n');
const fit = fitAll(settings.profiles);
console.log(pad('чертёж', 24) + pad('факт W×H', 16) + pad('после подгонки', 16) + pad('Δ', 12) + 'Δ%');
for (const r of fit.after) {
  console.log(
    pad(r.mark, 24) +
      pad(`${r.actualW}×${r.actualH}`, 16) +
      pad(`${r.predW}×${r.predH}`, 16) +
      pad(`${r.dW > 0 ? '+' : ''}${r.dW} / ${r.dH > 0 ? '+' : ''}${r.dH}`, 12) +
      `${r.errPct}%`,
  );
}
console.log(`\nсредняя ошибка после подгонки: ${meanAbsError(fit.after)} мм (было ${meanAbsError(fit.before)} мм)`);
for (const k of ['lastochkin', 'lotok', 'yazyk', 'bokovoy'] as const) {
  const c = fit.coefs[k];
  const r = (w: string, x: { sideFrac: number; sideAdd: number; frontFrac: number; frontAdd: number; backFrac: number; backAdd: number }): string =>
    `  ${k}/${w}: side ${x.sideFrac}·Lp+${x.sideAdd} · front ${x.frontFrac}·Wp+${x.frontAdd} · back ${x.backFrac}·Wp+${x.backAdd}`;
  console.log(`${k}: allowL.c=${c.allowL.c} allowW.c=${c.allowW.c} allowH.c=${c.allowH.c} allowH.k=${c.allowL.k}`);
  for (const closure of ['none', 'half', 'tuck', 'full', 'glue'] as const) console.log(r(closure, c.flaps[closure]));
}

console.log('\n=== 3. Длины ножей: факт vs расчёт (без подгонки, тот же шаблон) ===\n');
for (const f of CALIBRATABLE) {
  if (!f.construction) continue;
  const input = makeInput({ L: f.L, W: f.W, H: f.H, profile: f.profile, construction: f.construction, closure: f.closure, qty: 1000 });
  const res = calcBox({ input, settings });
  const kn = res.knives;
  // на чертеже длины ножей — по ВСЕМУ штампу: заготовка × perDie + техно-уголки
  const mine = kn.cutM * f.perDie + kn.creaseM * f.perDie + kn.perfM * f.perDie + kn.techM;
  const dTot = mine - f.knives.total;
  console.log(
    pad(f.mark, 24) +
      pad(`рез ${kn.cutM.toFixed(2)}/${(f.knives.cut / f.perDie).toFixed(2)}`, 22) +
      pad(`биг ${kn.creaseM.toFixed(2)}/${(f.knives.crease / f.perDie).toFixed(2)}`, 18) +
      pad(`штамп ${mine.toFixed(2)}/${f.knives.total}`, 20) +
      `${dTot > 0 ? '+' : ''}${dTot.toFixed(2)} м (${((dTot / f.knives.total) * 100).toFixed(0)}%)`,
  );
}

console.log('\n=== 4. Полный расчёт демки 0427-240×180×60 E, 5000 шт ===\n');
const demo = calcBox({
  input: makeInput({ L: 240, W: 180, H: 60, profile: 'E', construction: 'lastochkin', closure: 'tuck', qty: 5000 }),
  settings,
});
console.log('  заготовка            ', `${demo.area.blankW}×${demo.area.blankH} мм`);
console.log('  площадь габарита     ', `${demo.area.bboxAreaM2} м²`);
console.log('  площадь полигона     ', `${demo.area.blankAreaM2} м² (заполнение ${(demo.area.fillInBbox * 100).toFixed(1)}%)`);
console.log('  штамп                ', `${demo.area.dieW}×${demo.area.dieH} = ${demo.area.dieAreaM2} м²`);
console.log('  лист / с листа       ', `${demo.nest.sheet.name} → ${demo.nest.perSheet} шт, выход ${(demo.nest.utilization * 100).toFixed(1)}%, листов ${demo.nest.sheets}`);
console.log('  ножи (м)             ', `рез ${demo.knives.cutM}, биг ${demo.knives.creaseM}, перф ${demo.knives.perfM}, техно ${demo.knives.techM}, всего ${demo.knives.totalM}, сталь ${demo.knives.steelM}`);
console.log('  штамп ₽              ', demo.cost.die.total);
console.log('  тираж ₽              ', demo.cost.batch.total, '| за штуку', demo.cost.perPcs, '| с оснасткой', demo.cost.perPcsWithDie);
console.log('  картон ₽/шт          ', demo.cost.cardboardPerPcs);
console.log('  предупреждения       ', demo.warnings.length ? demo.warnings : 'нет');
console.log('  панель/клапаны       ', demo.geom.derivation.map((d) => `${d.label.split(' ')[0]}=${d.value}`).join(' '));

console.log('\n=== 5. Проверки инвариантов ===\n');
const t = (name: string, ok: boolean, extra = ''): void => void console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name} ${extra}`);

// 5.1 сумма панелей == площадь полигона (нет наложений)
const dims = computeDims(240, 180, 60, 1.6, DEFAULT_COEF.lastochkin, 'tuck', DEFAULT_OPTIONS);
const geom = normalizeToOrigin(buildTray(dims, 'lastochkin'));
const polyArea = (await import('../src/core/geo')).polyArea;
const sumPanels = geom.panels.reduce((s, p) => s + polyArea(p.pts), 0);
const sumHoles = geom.holes.reduce((s, p) => s + polyArea(p), 0);
t('панели не перекрываются (площадь = Σ панелей − Σ вырезов)', Math.abs(sumPanels - sumHoles - demo.area.blankAreaM2 * 1e6) < 300, `Δ=${Math.round(sumPanels - sumHoles - demo.area.blankAreaM2 * 1e6)} мм²`);

// 5.2 нет общих рёбер реза (каждый рез уникален)
const lines = linesFromGeom(geom);
const mids = new Set<string>();
let dup = 0;
for (const s of lines.cut) {
  const k = `${Math.round((s.a.x + s.b.x) / 2)}:${Math.round((s.a.y + s.b.y) / 2)}`;
  if (mids.has(k)) dup++;
  mids.add(k);
}
t('нет дублей линий реза', dup === 0, `дублей=${dup}`);

// 5.3 bbox == sum of panels chain
const chainX = lines.cut.length > 0;
t('геометрия построена (есть линии реза)', chainX, `${lines.cut.length} линий реза, ${lines.crease.length} биговок`);

// 5.4 tech corners = 4 × 199 мм = 0.795 м (как в чертежах)
t('техно-уголки = 0.795 м при 4×199 мм', Math.abs(4 * DEFAULT_DIE.techCornerLen / 1000 - 0.795) < 0.03);

// 5.5 масштаб: при L→2L заготовка растёт не линейно, но монотонно
const big = calcBox({ input: makeInput({ L: 480, W: 360, H: 120, profile: 'E', construction: 'lastochkin', closure: 'tuck', qty: 100 }), settings });
t('монотонность: 2× размер ⇒ заготовка больше', big.area.blankW > demo.area.blankW * 1.5);

// 5.6 лист: количество не убывает при росте листа
const small = settings.sheets[0];
const bigSheet = settings.sheets[settings.sheets.length - 1];
const nestSmall = calcBox({ input: { ...makeInput({ L: 240, W: 180, H: 60, construction: 'lastochkin', closure: 'tuck' }), nesting: { ...DEFAULT_NESTING } }, settings: { ...settings, sheets: [small] } });
const nestBig = calcBox({ input: { ...makeInput({ L: 240, W: 180, H: 60, construction: 'lastochkin', closure: 'tuck' }) }, settings: { ...settings, sheets: [bigSheet] } });
t('чем больше лист, тем больше шт/лист', nestBig.nest.perSheet >= nestSmall.nest.perSheet, `${small.name}: ${nestSmall.nest.perSheet} → ${bigSheet.name}: ${nestBig.nest.perSheet}`);

console.log('\n=== 6. Нормы времени (для справки) ===');
console.log(`  высечка ${demo.input.qty} шт при ${settings.prices.strokesPerHour} уд/ч = ${demo.cost.minutes.toFixed(0)} мин чистового времени`);
console.log('');

console.log('\n=== 7. Фит коэффициентов (JSON для дефолтов) ===');
console.log(JSON.stringify(fit.coefs, null, 1));
