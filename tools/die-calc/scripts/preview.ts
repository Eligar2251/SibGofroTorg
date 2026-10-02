/**
 * preview.ts — рендерит PNG-превью развертки и сборки (для визуальной проверки
 * и для картинок в README). Нужен @resvg/resvg-js (devDependency).
 * Запуск: `npm run preview:svg` → файлы в .tmp/preview/
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { baseSettings, calcBox, makeInput, renderUnfold, renderFold } from '../src/core/index';

const settings = baseSettings();
mkdirSync('.tmp/preview', { recursive: true });

const cases: Array<{ name: string; cons: 'lastochkin' | 'lotok' | 'yazyk' | 'bokovoy'; closure: 'none' | 'half' | 'tuck' | 'full' | 'glue'; L: number; W: number; H: number; profile: string; handle?: boolean }> = [
  { name: 'lastochkin-tuck', cons: 'lastochkin', closure: 'tuck', L: 240, W: 180, H: 60, profile: 'E', handle: true },
  { name: 'lastochkin-half', cons: 'lastochkin', closure: 'half', L: 125, W: 110, H: 115, profile: 'E' },
  { name: 'lotok-none', cons: 'lotok', closure: 'none', L: 255, W: 190, H: 60, profile: 'B' },
  { name: 'bokovoy-full', cons: 'bokovoy', closure: 'full', L: 240, W: 180, H: 60, profile: 'E' },
  { name: 'yazyk-tuck', cons: 'yazyk', closure: 'tuck', L: 300, W: 200, H: 90, profile: 'BC' },
  { name: 'penal-half', cons: 'lastochkin', closure: 'half', L: 100, W: 100, H: 350, profile: 'BC' },
];

// в песочнице нет системных шрифтов — берём woff2/ttf из public/fonts сайта
const fontDirs: string[] = [];
for (const dir of ['../../public/fonts', '/usr/share/fonts', '/System/Library/Fonts']) {
  if (existsSync(dir)) fontDirs.push(dir);
}
try {
  const out = execSync('fc-list 2>/dev/null | head -1').toString().trim();
  if (out) console.log('  fonts:', out);
} catch {
  /* fc-list отсутствует */
}

function png(svg: string, file: string, width = 1300): void {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'white',
    font: { loadSystemFonts: true, fontDirs, defaultFontFamily: 'sans-serif' },
  });
  writeFileSync(file, r.render().asPng());
  console.log('  wrote', file);
}

for (const c of cases) {
  const res = calcBox({
    input: makeInput({ L: c.L, W: c.W, H: c.H, profile: c.profile, construction: c.cons, closure: c.closure, handle: c.handle, qty: 1000 }),
    settings,
  });
  png(renderUnfold(res, { showDie: true, showDims: true, theme: 'light' }), `.tmp/preview/${c.name}.png`);
  png(renderFold(res, { progress: 1, size: 900 }), `.tmp/preview/${c.name}-3d.png`, 900);
  png(renderFold(res, { progress: 0.45, size: 900 }), `.tmp/preview/${c.name}-3d-mid.png`, 900);
  console.log(`  ${c.name}: заготовка ${res.area.blankW}×${res.area.blankH} мм, ${res.nest.perSheet} шт/лист, ножи ${res.knives.totalM} м`);
}
