// Этот файл скопирован из tools/die-calc скриптом `node tools/die-calc/scripts/sync-site.mjs`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
/**
 * nesting.ts — раскладка заготовок на листе гофрокартона.
 *
 * Считает не «в лоб» по габариту, а перебором:
 *   1) только ориентация A;
 *   2) только ориентация B (поворот на 90°);
 *   3) гильотинная схема «2 зоны»: слева j колонок A, остальное добираем B
 *      (и то же самое по горизонтали).
 * Этого хватает, чтобы сойтись с ручной раскладкой технолога с точностью ±несколько %.
 */

import type { NestPlacement, NestResult, NestingSettings as NestSettings, SheetFormat } from './model';

export interface BlankSize {
  w: number;
  h: number;
  /** площадь полигона заготовки, мм² */
  areaMm2: number;
}

const MAX_PLACEMENTS = 400;

interface GridOpts {
  gapX: number;
  gapY: number;
  margin: number;
}

function grid(
  x0: number,
  y0: number,
  width: number,
  height: number,
  bw: number,
  bh: number,
  o: GridOpts,
  rot: boolean,
  out: NestPlacement[],
): number {
  if (bw <= 0 || bh <= 0) return 0;
  const cols = Math.floor((width + o.gapX) / (bw + o.gapX));
  const rows = Math.floor((height + o.gapY) / (bh + o.gapY));
  if (cols <= 0 || rows <= 0) return 0;
  if (out.length + cols * rows <= MAX_PLACEMENTS) {
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        out.push({ x: x0 + i * (bw + o.gapX), y: y0 + j * (bh + o.gapY), w: bw, h: bh, rot });
      }
    }
  }
  return cols * rows;
}

export interface NestAttempt {
  perSheet: number;
  placements: NestPlacement[];
  cols: number;
  rows: number;
  kind: 'A' | 'B' | 'mix';
}

/** одна ориентация + гильотинные комбинации */
export function packOnce(blank: BlankSize, sheetW: number, sheetH: number, s: NestSettings): NestAttempt {
  const o: GridOpts = { gapX: s.gapX, gapY: s.gapY, margin: s.edgeMargin };
  const W = sheetW - 2 * o.margin;
  const H = sheetH - 2 * o.margin;
  const bw = blank.w;
  const bh = blank.h;
  const candidates: NestAttempt[] = [];

  const one = (rot: boolean): NestAttempt => {
    const p: NestPlacement[] = [];
    const w = rot ? bh : bw;
    const h = rot ? bw : bh;
    const n = grid(o.margin, o.margin, W, H, w, h, o, rot, p);
    const cols = Math.floor((W + o.gapX) / (w + o.gapX));
    const rows = Math.floor((H + o.gapY) / (h + o.gapY));
    return { perSheet: n, placements: p, cols, rows, kind: rot ? 'B' : 'A' };
  };

  candidates.push(one(false));
  if (s.allowRotate && Math.abs(bw - bh) > 0.01) candidates.push(one(true));

  if (s.allowRotate) {
    // вертикальный резак: j колонок «A» слева, справа добиваем «B»
    const colsA = Math.floor((W + o.gapX) / (bw + o.gapX));
    for (let j = 1; j <= colsA; j++) {
      const used = j * (bw + o.gapX) - o.gapX;
      if (used > W) break;
      const p: NestPlacement[] = [];
      const nA = grid(o.margin, o.margin, used, H, bw, bh, o, false, p);
      const rest = W - used - o.gapX;
      const nB = rest > 0 ? grid(o.margin + used + o.gapX, o.margin, rest, H, bh, bw, o, true, p) : 0;
      candidates.push({ perSheet: nA + nB, placements: p, cols: j, rows: nA, kind: 'mix' });
    }
    const rowsA = Math.floor((H + o.gapY) / (bh + o.gapY));
    for (let j = 1; j <= rowsA; j++) {
      const used = j * (bh + o.gapY) - o.gapY;
      if (used > H) break;
      const p: NestPlacement[] = [];
      const nA = grid(o.margin, o.margin, W, used, bw, bh, o, false, p);
      const rest = H - used - o.gapY;
      const nB = rest > 0 ? grid(o.margin, o.margin + used + o.gapY, W, rest, bh, bw, o, true, p) : 0;
      candidates.push({ perSheet: nA + nB, placements: p, cols: nA, rows: j, kind: 'mix' });
    }
  }

  candidates.sort((a, b) => b.perSheet - a.perSheet);
  return candidates[0] ?? { perSheet: 0, placements: [], cols: 0, rows: 0, kind: 'A' };
}

export function nestOnSheet(blank: BlankSize, sheet: SheetFormat, s: NestSettings, qty: number): NestResult {
  const best = packOnce(blank, sheet.w, sheet.h, s);
  const sheetArea = sheet.w * sheet.h;
  const perSheet = Math.max(0, best.perSheet);
  const utilization = sheetArea > 0 && perSheet > 0 ? Math.min(1, (perSheet * blank.areaMm2) / sheetArea) : 0;
  return {
    sheet,
    cols: best.cols,
    rows: best.rows,
    perSheet,
    sheets: perSheet > 0 ? Math.ceil(qty / perSheet) : 0,
    utilization,
    layout: best.placements,
    sheetBox: { x0: 0, y0: 0, x1: sheet.w, y1: sheet.h },
  };
}

/** автоподбор: лучший лист по «штук с листа», при равенстве — по цене листа */
export function nestBlank(blank: BlankSize, s: NestSettings, sheets: SheetFormat[], qty: number): NestResult {
  const list = sheets && sheets.length ? sheets : [fallbackSheet(blank, s)];
  let best = nestOnSheet(blank, list[0], s, qty);
  for (const sh of list) {
    const r = nestOnSheet(blank, sh, s, qty);
    const better =
      r.perSheet > best.perSheet ||
      (r.perSheet === best.perSheet && r.sheet.w * r.sheet.h < best.sheet.w * best.sheet.h);
    if (better) best = r;
  }
  return best;
}

export function allNests(blank: BlankSize, s: NestSettings, sheets: SheetFormat[], qty: number): NestResult[] {
  return sheets
    .map((sh) => nestOnSheet(blank, sh, s, qty))
    .filter((r) => r.perSheet > 0)
    .sort((a, b) => b.perSheet / (b.sheet.w * b.sheet.h) - a.perSheet / (a.sheet.w * a.sheet.h));
}

function fallbackSheet(blank: BlankSize, s: NestSettings): SheetFormat {
  const r = (n: number): number => Math.ceil(n / 50) * 50;
  const w = r(blank.w + 2 * s.edgeMargin + s.gapX);
  const h = r(blank.h + 2 * s.edgeMargin + s.gapY);
  return { id: 'auto', name: `Авто ${w}×${h}`, w, h };
}
