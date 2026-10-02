/**
 * cost.ts — примерная стоимость штанцформы и тиража.
 *
 * Штамп = фанера (по площади штампа) + лазер + ножи по типам + гибка/сборка +
 * резина/выталкиватели + наценка.
 * Тираж = картон (по раскладке листа, а не по площади заготовки!) + высечка +
 * склейка/упаковка + наладка.
 * Все ставки — из PriceSettings (редактируются в UI), в коде цен нет.
 */

import type { AreaStats, BoxInput, CostResult, KnifeStats, NestResult, PriceSettings, Profile } from './model';

export interface CostArgs {
  box: BoxInput;
  profile: Profile;
  area: AreaStats;
  knives: KnifeStats;
  nest: NestResult;
  prices: PriceSettings;
  perDie: number;
}

const r0 = (n: number): number => Math.round(n);
const r2 = (n: number): number => Math.round(n * 100) / 100;

export function costOf(a: CostArgs): CostResult {
  const p = a.prices;
  const qty = Math.max(1, a.box.qty);

  /* ————— штамп ————— */
  // статистика ножей дана на ОДНУ заготовку, а на штампе их perDie —
  // поэтому длина реза, лазера и гибки умножается на число гнёзд
  const pd = Math.max(1, Math.round(a.perDie || 1));
  const K = {
    cut: a.knives.cutM * pd,
    crease: a.knives.creaseM * pd,
    perf: a.knives.perfM * pd,
    tech: a.knives.techM * pd,
    total: a.knives.totalM * pd,
  };
  const dieParts: CostResult['die']['parts'] = [];
  const plywood = a.area.dieAreaM2 * p.plywoodM2;
  dieParts.push({ label: `Фанера ${(a.area.dieW).toFixed(0)}×${(a.area.dieH).toFixed(0)} мм = ${a.area.dieAreaM2.toFixed(3)} м²`, value: r0(plywood) });
  const laser = K.total * p.laserPerM;
  dieParts.push({
    label: `Лазер фанеры ${K.total.toFixed(2)} м × ${p.laserPerM} ₽/м${pd > 1 ? ` (${pd} гнезда)` : ''}`,
    value: r0(laser),
  });
  const kn = K.cut * p.knifeCutPerM + K.crease * p.knifeCreasePerM + K.perf * p.knifePerfPerM + K.tech * p.knifeTechPerM;
  dieParts.push({
    label: `Ножи: рез ${K.cut.toFixed(2)} м, биговка ${K.crease.toFixed(2)} м, перф. ${K.perf.toFixed(2)} м, техно ${K.tech.toFixed(2)} м`,
    value: r0(kn),
  });
  const bend = K.total * p.bendPerM;
  dieParts.push({ label: `Гибка и установка ножей ${K.total.toFixed(2)} м`, value: r0(bend) });
  const rubber = a.area.dieAreaM2 * p.rubberPerM2;
  dieParts.push({ label: `Микро-резина и выталкиватели (${a.area.dieAreaM2.toFixed(3)} м²)`, value: r0(rubber) });
  dieParts.push({ label: 'Изготовление/сборка штампа', value: r0(p.dieSetup) });
  const dieSub = dieParts.reduce((s, x) => s + x.value, 0);
  const dieMargin = r0(dieSub * p.dieMargin);
  dieParts.push({ label: `Наценка ${(p.dieMargin * 100).toFixed(0)}%`, value: dieMargin });
  const dieTotal = dieSub + dieMargin;

  /* ————— тираж ————— */
  const batchParts: CostResult['batch']['parts'] = [];
  const sheetAreaM2 = (a.nest.sheet.w * a.nest.sheet.h) / 1e6;
  const perSheet = Math.max(1, a.nest.perSheet);
  const grossM2 = a.nest.perSheet > 0 ? sheetAreaM2 / perSheet : a.area.bboxAreaM2;
  const cardboardPerPcs = grossM2 * a.profile.priceM2 * (1 + p.waste);
  batchParts.push({
    label:
      a.nest.perSheet > 0
        ? `Картон ${a.profile.name}: ${grossM2.toFixed(4)} м²/шт (лист ${a.nest.sheet.name}, ${perSheet} шт/лист, отход ${(p.waste * 100).toFixed(0)}%)`
        : `Картон ${a.profile.name}: ${a.area.bboxAreaM2.toFixed(4)} м²/шт по габариту заготовки`,
    value: r2(cardboardPerPcs * qty),
  });
  const net = a.area.blankAreaM2 * a.profile.priceM2 * qty;
  batchParts.push({ label: `   в т.ч. полезная площадь заготовки ${a.area.blankAreaM2.toFixed(4)} м²/шт`, value: r2(net) });

  const strokes = qty / Math.max(1, a.perDie);
  const cutting = (strokes / 1000) * p.cutPer1000;
  batchParts.push({
    label: `Высечка ${(strokes / 1000).toFixed(2)} тыс. ударов × ${p.cutPer1000} ₽ (штамп на ${a.perDie} шт)`,
    value: r2(cutting),
  });
  if (p.gluePerPcs > 0) batchParts.push({ label: `Склейка ${p.gluePerPcs} ₽/шт`, value: r2(p.gluePerPcs * qty) });
  if (p.packPerPcs > 0) batchParts.push({ label: `Упаковка ${p.packPerPcs} ₽/шт`, value: r2(p.packPerPcs * qty) });
  batchParts.push({ label: 'Наладка пресса на заказ', value: r0(p.pressSetup) });
  const batchSub = batchParts.reduce((s, x) => s + x.value, 0);
  const batchMargin = r0(batchSub * p.batchMargin);
  batchParts.push({ label: `Маржа ${(p.batchMargin * 100).toFixed(0)}%`, value: batchMargin });
  const batchTotal = batchSub + batchMargin;

  const perPcs = batchTotal / qty;
  const perPcsWithDie = (batchTotal + dieTotal) / qty;
  const withVat = (batchTotal + dieTotal) * (1 + p.vat);

  return {
    die: { parts: dieParts, total: r0(dieTotal) },
    batch: { parts: batchParts, total: r0(batchTotal) },
    perPcs: r2(perPcs),
    perPcsWithDie: r2(perPcsWithDie),
    withVat: r0(withVat),
    sheetsNeeded: a.nest.sheets,
    cardboardPerPcs: r2(cardboardPerPcs),
    vat: p.vat,
    minutes: (strokes / Math.max(1, p.strokesPerHour)) * 60,
  };
}
