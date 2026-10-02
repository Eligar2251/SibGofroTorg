/**
 * dxf.ts — экспорт DXF R12 (ASCII). Слои: CUT / CREASE / PERF / TECH / MARK,
 * единицы — мм ($INSUNITS = 4), масштаб 1:1 — файл можно кидать в AutoCAD,
 * LibreCAD, Rhino, VisorCAM и т.д.
 *
 * Скругления вынесены цепочкой коротких LINE (R12 не имеет LWPOLYLINE), поэтому
 * файл открывается везде. Если нужен экспорт с дугами — берите outline и
 * подставьте свои дуги: возьмите res.outline и замените цепочки LINE на ARC.
 */

import { LAYER_NAME } from '../engine';
import { tileSegs, type LineKind } from '../geo';
import type { CalcResult } from '../model';

export const DXF_LAYER: Record<LineKind, { name: string; color: number }> = {
  cut: { name: 'CUT', color: 3 },
  crease: { name: 'CREASE', color: 5 },
  perf: { name: 'PERF', color: 1 },
  tech: { name: 'TECH', color: 8 },
  mark: { name: 'MARK', color: 4 },
};

const KINDS: LineKind[] = ['cut', 'crease', 'perf', 'tech', 'mark'];

export function toDxf(res: CalcResult, opts: { label?: string; includeDie?: boolean } = {}): string {
  const withDie = opts.includeDie ?? true;
  // рамка/техно-углы нарисованы со сдвигом -fm, поэтому плита штампа в координатах
  // чертежа занимает [-fm … die - fm]; держим это в уме для EXTMIN/EXTMAX и надписи
  const fm = Math.max(0, res.input.die.frameMargin);
  const plate = { x0: -fm, y0: -fm, x1: res.die.x1 - fm, y1: res.die.y1 - fm };
  const dimensionMarks = res.geom.dimensions ?? [];
  const customGeometry = !!res.geom.custom;
  const layers = KINDS.filter((k) => (withDie ? true : k === 'cut' || k === 'crease' || k === 'perf' || (customGeometry && k === 'tech')));
  const ext = dimensionMarks.reduce(
    (box, mark) => ({
      x0: Math.min(box.x0, mark.a.x, mark.b.x),
      y0: Math.min(box.y0, mark.a.y, mark.b.y),
      x1: Math.max(box.x1, mark.a.x, mark.b.x),
      y1: Math.max(box.y1, mark.a.y, mark.b.y),
    }),
    { ...plate },
  );
  const out: string[] = [];
  const pair = (code: number, value: string | number): void => {
    out.push(String(code), String(value));
  };

  // ————— HEADER
  out.push('0', 'SECTION', '2', 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1009');
  pair(9, '$INSBASE');
  out.push('10', '0', '20', '0', '30', '0');
  pair(9, '$EXTMIN');
  out.push('10', rt(ext.x0), '20', rt(ext.y0), '30', '0');
  pair(9, '$EXTMAX');
  out.push('10', rt(ext.x1), '20', rt(ext.y1), '30', '0');
  pair(9, '$LUNITS');
  pair(70, 2);
  pair(9, '$LUPREC');
  pair(70, 2);
  pair(9, '$INSUNITS');
  pair(70, 4);
  out.push('0', 'ENDSEC');

  // ————— TABLES / LAYER
  out.push('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(layers.length + (dimensionMarks.length ? 1 : 0) + 1));
  layerRow('0', 7);
  for (const k of layers) layerRow(DXF_LAYER[k].name, DXF_LAYER[k].color);
  if (dimensionMarks.length) layerRow('DIM', 9);
  out.push('0', 'ENDTAB', '0', 'ENDSEC');

  // ————— ENTITIES
  out.push('0', 'SECTION', '2', 'ENTITIES');
  // изделие на штампе может быть не одно (2-up / 4-up) — гнёзда тиражируем,
  // слои рамки и техно-углов остаются «на весь штамп»
  const perDie = Math.max(1, Math.round(res.input.options.perDie || 1));
  const stepX = res.bbox.x1 - res.bbox.x0 + (res.input.options.diePitch || 0);
  for (const k of KINDS) {
    if (!layers.includes(k)) continue;
    const isProductLayer = k === 'cut' || k === 'crease' || k === 'perf' || (customGeometry && k === 'tech');
    const segs = isProductLayer ? tileSegs(res.segMap[k], perDie, stepX) : res.segMap[k];
    for (const s of segs) {
      out.push('0', 'LINE', '8', DXF_LAYER[k].name);
      out.push('10', rt(s.a.x), '20', rt(s.a.y), '30', '0');
      out.push('11', rt(s.b.x), '21', rt(s.b.y), '31', '0');
    }
  }
  for (const mark of dimensionMarks) {
    const label = mark.label?.trim() || `${num(Math.hypot(mark.b.x - mark.a.x, mark.b.y - mark.a.y))} мм`;
    out.push('0', 'LINE', '8', 'DIM');
    out.push('10', rt(mark.a.x), '20', rt(mark.a.y), '30', '0');
    out.push('11', rt(mark.b.x), '21', rt(mark.b.y), '31', '0');
    out.push('0', 'TEXT', '8', 'DIM', '10', rt((mark.a.x + mark.b.x) / 2), '20', rt((mark.a.y + mark.b.y) / 2 + 5), '30', '0', '40', '6', '1', safe(label));
  }
  const label =
    opts.label ??
    `${res.input.construction}-${num(res.input.L)}*${num(res.input.W)}*${num(res.input.H)}-${
      res.input.profileId
    } | ${num(res.area.blankW)}×${num(res.area.blankH)} мм | ножи ${res.knives.totalM.toFixed(2)} м`;
  if (withDie) out.push('0', 'TEXT', '8', DXF_LAYER.mark.name, '10', rt(plate.x0 + 10), '20', rt(plate.y1 - 24), '30', '0', '40', '8', '1', safe(label));
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');

  function layerRow(name: string, color: number): void {
    out.push('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS');
  }
}

const rt = (n: number): string => (Math.round(n * 1000) / 1000).toFixed(3);
const num = (n: number): string => (Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) : n.toFixed(1));
const safe = (s: string): string => s.replace(/[\x00-\x1f]/g, ' ').replace(/[{}]/g, '');

export const LAYER_LABEL = LAYER_NAME;
