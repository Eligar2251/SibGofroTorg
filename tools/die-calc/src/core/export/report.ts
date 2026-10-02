/**
 * report.ts — текстовый отчёт (спецификация), CSV и сводка для КП.
 * Возвращает строки; скачиванием файла занимается UI (см. ui/exports.ts).
 */

import { LAYER_NAME } from '../engine';
import type { CalcResult } from '../model';

const n1 = (n: number): string => (Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) : n.toFixed(1));
const money = (n: number, cur: string): string => `${Math.round(n).toLocaleString('ru-RU')} ${cur}`;

export function specText(res: CalcResult, title?: string): string {
  const i = res.input;
  const cur = '₽';
  const lines: string[] = [];
  lines.push(title ?? `Штанцформа / заготовка — ${i.construction} ${n1(i.L)}×${n1(i.W)}×${n1(i.H)} мм, профиль ${i.profileId}`);
  lines.push('');
  lines.push('ГЕОМЕТРИЯ');
  for (const d of res.geom.derivation) {
    lines.push(`  ${d.label.padEnd(26, ' ')} = ${d.formula} → ${n1(d.value)}${d.unit ?? ''}`);
  }
  lines.push('');
  lines.push('ПЛОЩАДЬ (по краям коробки, без запаса на штамп)');
  lines.push(`  габарит заготовки            ${n1(res.area.blankW)} × ${n1(res.area.blankH)} мм = ${res.area.bboxAreaM2.toFixed(4)} м²`);
  lines.push(`  площадь полигона заготовки     ${res.area.blankAreaM2.toFixed(4)} м² (заполнение габарита ${(res.area.fillInBbox * 100).toFixed(1)}%)`);
  lines.push(`  вырезы/отверстия               ${res.area.holesAreaM2.toFixed(5)} м²`);
  lines.push(`  штамп (заготовка + ${n1(i.die.frameMargin)} мм)  ${n1(res.area.dieW)} × ${n1(res.area.dieH)} мм = ${res.area.dieAreaM2.toFixed(4)} м²`);
  lines.push('');
  lines.push('РАСКЛАДКА ПО ЛИСТУ');
  lines.push(`  лист ${res.nest.sheet.name}, отступ ${n1(i.nesting.edgeMargin)}, зазор ${n1(i.nesting.gapX)}×${n1(i.nesting.gapY)}`);
  lines.push(`  с одного листа: ${res.nest.perSheet} шт; полезный выход ${(res.nest.utilization * 100).toFixed(1)}%`);
  lines.push(`  на тираж ${i.qty} шт нужно листов: ${res.nest.sheets}`);
  lines.push('');
  lines.push('ДЛИНЫ НОЖЕЙ, м');
  for (const k of ['cut', 'crease', 'perf', 'tech', 'mark'] as const) {
    lines.push(`  ${LAYER_NAME[k].padEnd(26, ' ')} ${res.knives.byKind[k].toFixed(3)} м  (${res.knives.segCount[k]} лин.)`);
  }
  lines.push(`  ${'ИТОГО (рез+биговка+перф+техно)'.padEnd(26, ' ')} ${res.knives.totalM.toFixed(3)} м`);
  lines.push(`  ${'сталь с вычетом перемычек'.padEnd(26, ' ')} ${res.knives.steelM.toFixed(3)} м`);
  lines.push('');
  lines.push('СТОИМОСТЬ');
  lines.push('  штамп:');
  for (const p of res.cost.die.parts) lines.push(`    ${p.label.padEnd(52, ' ')} ${money(p.value, cur)}`);
  lines.push(`    ${'ИТОГО штамп'.padEnd(52, ' ')} ${money(res.cost.die.total, cur)}`);
  lines.push('  тираж:');
  for (const p of res.cost.batch.parts) lines.push(`    ${p.label.padEnd(52, ' ')} ${money(p.value, cur)}`);
  lines.push(`    ${'ИТОГО тираж'.padEnd(52, ' ')} ${money(res.cost.batch.total, cur)}`);
  lines.push('');
  lines.push(`  цена за штуку (тираж)          ${money(res.cost.perPcs, cur)}`);
  lines.push(`  цена за штуку с окупаемой оснасткой ${money(res.cost.perPcsWithDie, cur)}`);
  lines.push(`  итого с НДС ${(0.2 * 100).toFixed(0)}%                    ${money(res.cost.withVat, cur)}`);
  if (res.warnings.length) {
    lines.push('');
    lines.push('ПРЕДУПРЕЖДЕНИЯ');
    for (const w of res.warnings) lines.push(`  ! ${w}`);
  }
  return lines.join('\n');
}

export function specCsv(res: CalcResult): string {
  const rows: string[][] = [['параметр', 'значение', 'ед.']];
  const i = res.input;
  const push = (k: string, v: string | number, u = ''): void => void rows.push([k, String(v), u]);
  push('конструкция', i.construction);
  push('закрытие', i.closure);
  push('L внутр', n1(i.L), 'мм');
  push('W внутр', n1(i.W), 'мм');
  push('H внутр', n1(i.H), 'мм');
  push('профиль', i.profileId);
  push('габарит заготовки W', n1(res.area.blankW), 'мм');
  push('габарит заготовки H', n1(res.area.blankH), 'мм');
  push('площадь габарита', res.area.bboxAreaM2.toFixed(4), 'м2');
  push('площадь заготовки', res.area.blankAreaM2.toFixed(4), 'м2');
  push('штамп W', n1(res.area.dieW), 'мм');
  push('штамп H', n1(res.area.dieH), 'мм');
  push('площадь штампа', res.area.dieAreaM2.toFixed(4), 'м2');
  push('лист', res.nest.sheet.name, 'мм');
  push('шт с листа', res.nest.perSheet);
  push('листов на тираж', res.nest.sheets);
  push('выход полезный', (res.nest.utilization * 100).toFixed(1), '%');
  push('ножи рез', res.knives.cutM.toFixed(3), 'м');
  push('ножи биговка', res.knives.creaseM.toFixed(3), 'м');
  push('ножи перфорация', res.knives.perfM.toFixed(3), 'м');
  push('ножи техно', res.knives.techM.toFixed(3), 'м');
  push('ножи всего', res.knives.totalM.toFixed(3), 'м');
  push('стоимость штампа', Math.round(res.cost.die.total), '₽');
  push('стоимость тиража', Math.round(res.cost.batch.total), '₽');
  push('цена за штуку', res.cost.perPcs.toFixed(2), '₽');
  push('цена за штуку с оснасткой', res.cost.perPcsWithDie.toFixed(2), '₽');
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

/** «карточка товара» для каталога: сколько коробок с листа и цена за штуку */
export function quickCard(res: CalcResult): {
  perSheet: number;
  boxesFromSheet: number;
  pricePerPcs: number;
  pricePerPcsWithDie: number;
  blank: string;
  utilization: string;
} {
  return {
    perSheet: res.nest.perSheet,
    boxesFromSheet: res.nest.perSheet * Math.max(1, res.nest.sheets),
    pricePerPcs: res.cost.perPcs,
    pricePerPcsWithDie: res.cost.perPcsWithDie,
    blank: `${n1(res.area.blankW)}×${n1(res.area.blankH)} мм`,
    utilization: `${(res.nest.utilization * 100).toFixed(0)}%`,
  };
}
