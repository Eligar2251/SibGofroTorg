/**
 * render3d.ts — сборка коробки: дерево панелей гнётся вокруг линий биговки,
 * проекция ортографическая, сортировка «дальше — раньше» (painter), толщина
 * картона — экструзией по нормали. Без three.js, чтобы ядро оставалось
 * переносимым (тот же код работает в node при генерации превью/PDF).
 *
 * progress: 0 = плоская развертка, 1 = собранная коробка.
 */

import type { CalcResult } from './model';
import type { Panel } from './model';
import { rr } from './templates';

interface V3 {
  x: number;
  y: number;
  z: number;
}

type XF = (p: V3) => V3;

const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len3 = (a: V3): number => Math.hypot(a.x, a.y, a.z) || 1;
const nrm = (a: V3): V3 => ({ x: a.x / len3(a), y: a.y / len3(a), z: a.z / len3(a) });

/** поворот вокруг произвольной оси (точка a, направление u) на rad — формула Родрига */
function rotAbout(a: V3, u: V3, rad: number): XF {
  const k = nrm(u);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const kc = 1 - c;
  return (p: V3): V3 => {
    const w = sub3(p, a);
    return {
      x: a.x + w.x * c + (k.y * w.z - k.z * w.y) * s + k.x * (k.x * w.x + k.y * w.y + k.z * w.z) * kc,
      y: a.y + w.y * c + (k.z * w.x - k.x * w.z) * s + k.y * (k.x * w.x + k.y * w.y + k.z * w.z) * kc,
      z: a.z + w.z * c + (k.x * w.y - k.y * w.x) * s + k.z * (k.x * w.x + k.y * w.y + k.z * w.z) * kc,
    };
  };
}

const id: XF = (p) => p;
const flat = (p: { x: number; y: number }): V3 => v3(p.x, p.y, 0);

export interface Fold3dOpts {
  progress?: number;
  /** градусы */
  yaw?: number;
  pitch?: number;
  /** зум, 1 = автопо размерам */
  zoom?: number;
  thickness?: number;
  theme?: 'light' | 'dark';
  showCutOutline?: boolean;
  size?: number;
}

const OUT_COLOR: Record<string, [string, string]> = {
  bottom: ['#c98d54', '#e0b483'],
  wall: ['#c08449', '#dcb07c'],
  front: ['#c08449', '#dcb07c'],
  back: ['#c08449', '#dcb07c'],
  side: ['#b87d44', '#d6a975'],
  flap: ['#cf9460', '#e6bd8c'],
  lid: ['#cf9460', '#e6bd8c'],
  dust: ['#b87d44', '#d3a56f'],
  ear: ['#a8713c', '#cb9c66'],
  glue: ['#a8713c', '#cb9c66'],
};

export function renderFold(res: CalcResult, o: Fold3dOpts = {}): string {
  const p = Math.max(0, Math.min(1, o.progress ?? 1));
  const yaw = ((o.yaw ?? -58) * Math.PI) / 180;
  const pitch = ((o.pitch ?? 26) * Math.PI) / 180;
  const t = o.thickness ?? Math.max(0.6, res.input.options.handle ? 2 : 2);
  const dark = o.theme === 'dark';
  const panels = res.geom.panels;
  const meta = res.geom.meta;

  // «внутрь» коробки — вверх по +Z от центра дна
  const center = v3(meta.xB + meta.Lp / 2, meta.yB + meta.Wp / 2, 0);

  const byId = new Map<string, Panel>();
  for (const q of panels) byId.set(q.id, q);
  const order = panels.slice().sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  const xf = new Map<string, XF>();

  const parentXF = (q: Panel): XF => (q.parent ? xf.get(q.parent) ?? id : id);

  for (const q of order) {
    const parent = parentXF(q);
    if (!q.hinge || !q.fold) {
      xf.set(q.id, parent);
      continue;
    }
    const a = flat(q.hinge.p);
    const b = flat(q.hinge.q);
    const u = { x: b.x - a.x, y: b.y - a.y, z: 0 };
    const deg = q.fold;
    // знак сгиба: клапан/стенка должны «пойти» к центру коробки (внутрь)
    const c0 = centroid(q.pts);
    const test = (sign: number): V3 => parent(rotAbout(a, u, (sign * deg * Math.PI) / 180)(c0));
    const dPlus = len3(sub3(test(1), v3(center.x, center.y, meta.Hp * 0.5)));
    const dMinus = len3(sub3(test(-1), v3(center.x, center.y, meta.Hp * 0.5)));
    const sign = dPlus <= dMinus ? 1 : -1;
    const rad = (sign * deg * Math.PI * p) / 180;
    xf.set(q.id, (pt: V3): V3 => parent(rotAbout(a, u, rad)(pt)));
  }

  // камера
  const eyeDir = nrm(v3(Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)));
  const worldUp = v3(0, 0, 1);
  const right = nrm(cross(eyeDir, worldUp));
  const up = cross(right, eyeDir);

  // центр сцены и масштаб
  const all = panels.flatMap((q) => q.pts.map((pt) => (xf.get(q.id) ?? id)(flat(pt))));
  const bb = { min: v3(Infinity, Infinity, Infinity), max: v3(-Infinity, -Infinity, -Infinity) };
  for (const q of all) {
    bb.min = { x: Math.min(bb.min.x, q.x), y: Math.min(bb.min.y, q.y), z: Math.min(bb.min.z, q.z) };
    bb.max = { x: Math.max(bb.max.x, q.x), y: Math.max(bb.max.y, q.y), z: Math.max(bb.max.z, q.z) };
  }
  const c = v3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2);
  const span = Math.max(len3(sub3(bb.max, bb.min)), 1);
  const size = o.size ?? 600;
  const scale = ((o.zoom ?? 1) * (size * 0.82)) / span;

  const proj = (q: V3): { sx: number; sy: number; d: number } => {
    const w = sub3(q, c);
    return { sx: size / 2 + dot(w, right) * scale, sy: size / 2 - dot(w, up) * scale, d: dot(w, eyeDir) };
  };

  interface Face {
    pts: Array<{ sx: number; sy: number }>;
    depth: number;
    fill: string;
    stroke: string;
    op: number;
  }
  const faces: Face[] = [];

  for (const q of panels) {
    const T = xf.get(q.id) ?? id;
    const pts3 = q.pts.map((pt) => T(flat(pt)));
    if (pts3.length < 3) continue;
    const nrm3 = faceNormal(pts3);
    const shade = Math.abs(dot(nrm3, eyeDir));
    const [outer, inner] = OUT_COLOR[q.role] ?? OUT_COLOR.wall;
    const frontFacing = dot(nrm3, eyeDir) > 0;
    const base = frontFacing ? outer : inner;
    const lum = 0.45 + 0.55 * shade;
    const projected = pts3.map(proj);
    const depth = projected.reduce((s, x) => s + x.d, 0) / projected.length;
    faces.push({
      pts: projected.map((x) => ({ sx: x.sx, sy: x.sy })),
      depth,
      fill: shadeColor(base, lum),
      stroke: dark ? 'rgba(255,255,255,0.25)' : 'rgba(60,35,10,0.55)',
      op: 1,
    });

    // толщина: боковые грани только там, где ребро на силуэте
    if (t > 0.05 && p > 0.02) {
      const off = v3(-nrm3.x * t, -nrm3.y * t, -nrm3.z * t);
      const cx2 = projected.reduce((s, x) => ({ x: s.x + x.sx / projected.length, y: s.y + x.sy / projected.length }), { x: 0, y: 0 });
      const area2 = signedArea2(projected);
      const wind = area2 > 0 ? 1 : -1;
      for (let i = 0; i < projected.length; i++) {
        const a2 = projected[i];
        const b2 = projected[(i + 1) % projected.length];
        const ex = b2.sx - a2.sx;
        const ey = b2.sy - a2.sy;
        const nx = ey * wind;
        const ny = -ex * wind;
        const mx = (a2.sx + b2.sx) / 2;
        const my = (a2.sy + b2.sy) / 2;
        if (nx * (mx - cx2.x) + ny * (my - cx2.y) <= 0) continue;
        const a3 = proj(add3(pts3[i], off));
        const b3 = proj(add3(pts3[(i + 1) % pts3.length], off));
        faces.push({
          pts: [
            { sx: a2.sx, sy: a2.sy },
            { sx: b2.sx, sy: b2.sy },
            { sx: b3.sx, sy: b3.sy },
            { sx: a3.sx, sy: a3.sy },
          ],
          depth: (a2.d + b2.d + a3.d + b3.d) / 4 - 0.01,
          fill: shadeColor(base, 0.34 + 0.2 * shade),
          stroke: 'none',
          op: 1,
        });
      }
    }
  }

  // painter: depth = проекция на направление «к глазу», поэтому рисуем от дальних
  // (маленький depth) к ближним — иначе грани перекрываются наоборот
  faces.sort((a, b) => a.depth - b.depth);

  const body = faces
    .map(
      (fc) =>
        `<path d="${fc.pts.map((q, i) => `${i ? 'L' : 'M'} ${r2(q.sx)} ${r2(q.sy)}`).join(' ')} Z" fill="${fc.fill}" stroke="${fc.stroke}" stroke-width="0.7" fill-opacity="${fc.op}"/>`,
    )
    .join('');

  const bg = dark ? '#101418' : '#f7f3ec';
  const pct = Math.round(p * 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" preserveAspectRatio="xMidYMid meet">
<rect width="${size}" height="${size}" fill="${bg}"/>
${body}
<g font-family="Inter, Arial, sans-serif" font-size="12" fill="${dark ? '#93a5b5' : '#6b7480'}"><text x="10" y="${size - 10}">сборка ${pct}%</text></g>
</svg>`;
}

function add3(a: V3, b: V3): V3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function centroid(pts: Array<{ x: number; y: number }>): V3 {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return v3(x / pts.length, y / pts.length, 0);
}

function faceNormal(pts: V3[]): V3 {
  const a = pts[0];
  const b = pts[Math.min(1, pts.length - 1)];
  const c = pts[Math.min(2, pts.length - 1)];
  const n = cross(sub3(b, a), sub3(c, a));
  const out = nrm(n);
  return out.z < 0 ? v3(-out.x, -out.y, -out.z) : out;
}

function signedArea2(pts: Array<{ sx: number; sy: number }>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.sx * b.sy - b.sx * a.sy;
  }
  return s / 2;
}

function shadeColor(hex: string, lum: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(Math.max(0, Math.min(1, lum)) * x + 22));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

const r2 = (n: number): number => rr(n * 100) / 100;
