// Этот файл скопирован из tools/die-calc скриптом `node tools/die-calc/scripts/sync-site.mjs`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
/**
 * exports.ts — скачивание файлов (SVG / DXF / PNG / отчёт / CSV / JSON) и печать PDF.
 * Всё на браузере, без зависимостей.
 */

import { renderUnfold, type Render2dOpts } from '@/lib/die-calc/render2d';
import { toDxf } from '@/lib/die-calc/export/dxf';
import { specCsv, specText } from '@/lib/die-calc/export/report';
import type { CalcResult } from '@/lib/die-calc/model';

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** JSON-пакет — то, что удобно класть в БД (Supabase calculations.result) или в API-ответ */
export function resultJson(res: CalcResult): string {
  return JSON.stringify(
    {
      version: 1,
      input: res.input,
      area: res.area,
      knives: res.knives,
      nesting: { sheet: res.nest.sheet, perSheet: res.nest.perSheet, utilization: res.nest.utilization, sheets: res.nest.sheets },
      cost: res.cost,
      derivation: res.geom.derivation,
      warnings: res.warnings,
      outline: res.outline.map((poly) => poly.map((p) => [p.x, p.y])),
    },
    null,
    2,
  );
}

export function exportSvg(res: CalcResult, o: Render2dOpts, name: string): void {
  downloadText(`${name}.svg`, renderUnfold(res, o), 'image/svg+xml;charset=utf-8');
}

export function exportJsonFallback(res: CalcResult, name: string): void {
  downloadText(`${name}.json`, resultJson(res), 'application/json;charset=utf-8');
}

export function exportDxf(res: CalcResult, name: string, includeDie = true): void {
  downloadText(`${name}.dxf`, toDxf(res, { includeDie }), 'application/dxf');
}

export function exportReport(res: CalcResult, name: string): void {
  downloadText(`${name}.txt`, specText(res), 'text/plain;charset=utf-8');
}

export function exportCsv(res: CalcResult, name: string): void {
  downloadText(`${name}.csv`, '\ufeff' + specCsv(res), 'text/csv;charset=utf-8');
}

/** PNG в нужном разрешении (для КП/мессенджеров): растрируем SVG через canvas */
export async function exportPng(res: CalcResult, o: Render2dOpts, name: string, dpi = 2): Promise<void> {
  const svg = renderUnfold(res, o);
  const png = await svgToPng(svg, dpi);
  if (!png) return;
  downloadBlob(`${name}.png`, png);
}

export async function svgToPng(svg: string, scale = 2): Promise<Blob | null> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('svg load error'));
      img.src = url;
    });
    const box = viewBoxOf(svg);
    const w = Math.round((box.w || img.width || 1000) * scale);
    const h = Math.round((box.h || img.height || 700) * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function viewBoxOf(svg: string): { w: number; h: number } {
  const m = /viewBox="([^"]+)"/.exec(svg);
  if (!m) return { w: 0, h: 0 };
  const p = m[1].trim().split(/[\s,]+/).map(Number);
  return { w: p[2] || 0, h: p[3] || 0 };
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** «Скачать PDF» без библиотек: открываем печать браузера на страницу с SVG 1:1 */
export function printPdf(title: string, svg: string, mmW: number, mmH: number): void {
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return;
  win.document.write(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><style>
@page { margin: 8mm; }
html,body{margin:0;padding:0;font-family:Inter,Arial,sans-serif}
h1{font-size:14px;margin:6px 8px}
svg{width:${mmW}mm;height:${mmH}mm;display:block;margin:0 8px}
@media print{h1{-webkit-print-color-adjust:exact}svg{-webkit-print-color-adjust:exact}}
</style></head><body><h1>${title}</h1>${svg}<script>setTimeout(function(){window.print()},250)</script></body></html>`,
  );
  win.document.close();
}
