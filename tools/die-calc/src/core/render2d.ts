/**
 * render2d.ts — развертка как строка SVG (без React, чтобы можно было рендерить
 * на сервере, в тестах и в превью). Оси: X вправо, Y вверх (переворачиваем сами).
 *
 * Слои и цвета — как в вашем CAD:
 *   рез — зелёный сплошной, биговка — синий пунктир, перфорация — красный пунктир,
 *   техно-ножи — серый, маркировка/рамка штампа — голубой.
 */

import { tileSegs } from './geo';
import { LAYER_COLOR, LAYER_DASH, LAYER_NAME } from './engine';
import type { LineKind, Seg } from './geo';
import { segsToPath } from './geo';
import type { CalcResult } from './model';

export interface Render2dOpts {
  /**
   * Рамка штампа, техно-уголки, рамка маркировки. По умолчанию ВЫКЛЮЧЕНО:
   * на экране и в PNG нужна вырезанная заготовка коробки, а не плита штампа.
   * Для «производственного» чертежа (и для DXF) включайте явно.
   */
  showDie?: boolean;
  /** размерные линии и размерная цепочка */
  showDims?: boolean;
  /** light fill of panels (видно «тело» заготовки) */
  showFills?: boolean;
  layers?: Partial<Record<LineKind, boolean>>;
  strokeWidth?: number;
  title?: string;
  note?: string;
  /** фон: 'light' — белая (для печати/PDF), 'dark' — для тёмной темы сайта */
  theme?: 'light' | 'dark';
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PANEL_FILL: Record<string, string> = {
  bottom: '#f0d9b5',
  wall: '#f5e3c8',
  front: '#f5e3c8',
  back: '#f5e3c8',
  side: '#f7e8d0',
  flap: '#fbf0dd',
  lid: '#fbf0dd',
  dust: '#fdeedd',
  ear: '#fbf0dd',
  glue: '#f7e8d0',
};

export function renderUnfold(res: CalcResult, o: Render2dOpts = {}): string {
  const showDie = o.showDie ?? false;
  const showDims = o.showDims ?? true;
  const showFills = o.showFills ?? true;
  const sw = o.strokeWidth ?? 1;
  const dark = o.theme === 'dark';
  const fm = Math.max(0, res.input.die.frameMargin);
  const blankW = res.area.blankW;
  const blankH = res.area.blankH;

  const x0 = showDie ? -fm : 0;
  const x1 = showDie ? blankW + fm : blankW;
  const y0 = showDie ? -fm : 0;
  const y1 = showDie ? blankH + fm : blankH;
  const padL = showDims ? 42 : 8;
  const padB = showDims ? 46 : 8;
  const padT = showDims ? (showDie ? 56 : 44) : 8;
  const vb = {
    x0: Math.min(x0, 0) - padL,
    x1: Math.max(x1, blankW) + 14,
    y0: Math.min(y0, 0) - padB,
    y1: Math.max(y1, blankH) + padT,
  };
  const W = vb.x1 - vb.x0;
  const H = vb.y1 - vb.y0;
  // экранные координаты: sy = -y (viewBox начинается с -vb.y1), т.е. +Y на чертеже = вверх
  const Y = (y: number): number => y;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(vb.x0)} ${f(-vb.y1)} ${f(W)} ${f(H)}" width="100%" preserveAspectRatio="xMidYMid meet" font-family="Inter, Arial, sans-serif">`,
  );
  parts.push(
    `<rect x="${f(vb.x0)}" y="${f(-vb.y1)}" width="${f(W)}" height="${f(H)}" fill="${dark ? '#101418' : '#ffffff'}"/>`,
  );
  void Y;

  // ————— гнёзда на штампе (2-up, 4-up …): изделие повторяется по X
  const perDie = Math.max(1, Math.round(res.input.options.perDie || 1));
  const stepX = f(res.bbox.x1 - res.bbox.x0 + (res.input.options.diePitch || 0));
  const inAllSeats = (inner: string): string =>
    perDie <= 1
      ? inner
      : Array.from({ length: perDie }, (_, i) => `<g transform="translate(${f(i * stepX)} 0)">${inner}</g>`).join('');

  // ————— панели (заливка)
  if (showFills) {
    let fill = '';
    for (const p of res.geom.panels) {
      const d = p.pts.map((pt, i) => `${i ? 'L' : 'M'} ${f(pt.x)} ${f(-Y(pt.y))}`).join(' ') + ' Z';
      fill += `<path d="${d}" fill="${dark ? mixKraft(p.role) : PANEL_FILL[p.role] ?? '#f3e4cb'}" fill-opacity="${dark ? 0.35 : 0.85}" stroke="none"/>`;
    }
    for (const h of res.geom.holes) {
      const d = h.map((pt, i) => `${i ? 'L' : 'M'} ${f(pt.x)} ${f(-Y(pt.y))}`).join(' ') + ' Z';
      fill += `<path d="${d}" fill="${dark ? '#101418' : '#ffffff'}" stroke="none"/>`;
    }
    parts.push(inAllSeats(fill));
  }

  // ————— линии по слоям
  const order: LineKind[] = ['mark', 'tech', 'crease', 'perf', 'cut'];
  for (const kind of order) {
    if (o.layers && o.layers[kind] === false) continue;
    if (!showDie && (kind === 'mark' || kind === 'tech')) continue;
    const segs: Seg[] = res.segMap[kind] ?? [];
    if (!segs.length) continue;
    const dash = LAYER_DASH[kind];
    parts.push(
      `<g class="layer layer-${kind}" data-layer="${kind}" data-name="${esc(LAYER_NAME[kind])}" stroke="${LAYER_COLOR[kind]}" stroke-width="${f(sw * (kind === 'cut' ? 1.6 : 1.15))}" fill="none" ${dash !== 'none' ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="butt">`,
    );
    // рамка и техно-углы рисуются по всей плите, их не тиражируем
    const onPlate = kind === 'mark' || kind === 'tech';
    const drawn = onPlate ? segs : tileSegs(segs, perDie, stepX);
    const path = `<path d="${segsToPath(drawn.map((s) => ({ ...s, a: { x: s.a.x, y: -Y(s.a.y) }, b: { x: s.b.x, y: -Y(s.b.y) } })))}"/>`;
    parts.push(onPlate ? path : inAllSeats(path));
    parts.push('</g>');
  }

  // ————— размеры
  if (showDims) {
    const col = dark ? '#8ea0b0' : '#5b6470';
    parts.push(`<g stroke="${col}" fill="${col}" stroke-width="0.5" font-size="11">`);
    parts.push(dimH(0, blankW, Y, y0 - 16, `W заготовки = ${num(blankW)}`));
    parts.push(dimV(0, blankH, x0 - 16, Y, `H заготовки = ${num(blankH)}`));
    const m = res.geom.meta;
    if (m.Lp) {
      const yChain = Math.max(blankH, y1) + 16;
      parts.push(
        chainH(
          [
            { v: m.sSide },
            { v: m.Hp },
            { v: m.Lp },
            { v: m.Hp },
            { v: m.sSide },
          ],
          -yChain,
          0,
        ),
      );
      parts.push(
        chainV(
          [
            { v: m.sFront },
            { v: m.Hf },
            { v: m.Wp },
            { v: m.Hp },
            { v: m.sBack },
          ],
          Math.max(blankW, x1) + 18,
          Y,
        ),
      );
    }
    parts.push('</g>');
    if (res.die && showDie) {
      parts.push(
        `<g font-size="10" fill="${dark ? '#7f93a5' : '#8a94a0'}"><text x="${f(Math.min(x0, 0))}" y="${f(-Y(y0 - 30))}">штамп ${num(res.die.x1)}×${num(res.die.y1)} мм = заготовка + ${num(fm)} мм с каждой стороны</text></g>`,
      );
    }
  }

  const title = o.title ?? `${res.input.construction}-${num(res.input.L)}*${num(res.input.W)}*${num(res.input.H)}`;
  parts.push(
    `<g font-size="13" fill="${dark ? '#d7e2ec' : '#22282f'}"><text x="${f(vb.x0)}" y="${f(-(-vb.y1 + 15))}">${esc(title)}</text>` +
      (o.note ? `<text x="${f(vb.x0)}" y="${f(-(-vb.y1 + 31))}" font-size="10" fill="${dark ? '#8ea0b0' : '#6b7480'}">${esc(o.note)}</text>` : '') +
      '</g>',
  );
  parts.push('</svg>');
  return parts.join('\n');
}

function chainH(segs: Array<{ v: number }>, y: number, xStart: number): string {
  let x = xStart;
  let out = '';
  for (const s of segs) {
    out += tick(x, y) + tick(x + s.v, y) + `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x + s.v)}" y2="${f(y)}"/>`;
    out += `<text x="${f(x + s.v / 2)}" y="${f(y - 4)}" text-anchor="middle" font-size="9" stroke="none">${num(s.v)}</text>`;
    x += s.v;
  }
  return out + `<line x1="${f(xStart)}" y1="${f(y - 9)}" x2="${f(x)}" y2="${f(y - 9)}" stroke-opacity="0.45"/>`;
}

function chainV(segs: Array<{ v: number }>, x: number, Y: (y: number) => number): string {
  let y = 0;
  let out = '';
  for (const s of segs) {
    const a = -Y(y);
    const b = -Y(y + s.v);
    out += `<line x1="${f(x)}" y1="${f(a)}" x2="${f(x)}" y2="${f(b)}"/>`;
    out += tick(x, a) + tick(x, b);
    out += `<text x="${f(x + 3)}" y="${f((a + b) / 2)}" font-size="9" stroke="none" transform="rotate(-90 ${f(x + 3)} ${f((a + b) / 2)})">${num(s.v)}</text>`;
    y += s.v;
  }
  return out;
}

const tick = (x: number, y: number): string => `<line x1="${f(x - 4)}" y1="${f(y - 4)}" x2="${f(x + 4)}" y2="${f(y + 4)}"/>`;

function dimH(x0: number, x1: number, Y: (y: number) => number, yMm: number, label: string): string {
  const y = -Y(yMm);
  return (
    `<line x1="${f(x0)}" y1="${f(y)}" x2="${f(x1)}" y2="${f(y)}"/>` +
    `<line x1="${f(x0)}" y1="${f(y - 5)}" x2="${f(x0)}" y2="${f(y + 5)}"/><line x1="${f(x1)}" y1="${f(y - 5)}" x2="${f(x1)}" y2="${f(y + 5)}"/>` +
    `<text x="${f((x0 + x1) / 2)}" y="${f(y + 14)}" text-anchor="middle" font-size="11" stroke="none">${esc(label)}</text>`
  );
}

function dimV(y0: number, y1: number, x: number, Y: (y: number) => number, label: string): string {
  const a = -Y(y0);
  const b = -Y(y1);
  return (
    `<line x1="${f(x)}" y1="${f(a)}" x2="${f(x)}" y2="${f(b)}"/>` +
    `<line x1="${f(x - 5)}" y1="${f(a)}" x2="${f(x + 5)}" y2="${f(a)}"/><line x1="${f(x - 5)}" y1="${f(b)}" x2="${f(x + 5)}" y2="${f(b)}"/>` +
    `<text x="${f(x - 4)}" y="${f((a + b) / 2)}" text-anchor="middle" font-size="11" stroke="none" transform="rotate(-90 ${f(x - 4)} ${f((a + b) / 2)})">${esc(label)}</text>`
  );
}

const f = (n: number): number => Math.round(n * 100) / 100;
const num = (n: number): string => (Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) : n.toFixed(1));

function mixKraft(role: string): string {
  return role === 'bottom' ? '#6b5233' : role === 'dust' ? '#5a462c' : '#61492d';
}
