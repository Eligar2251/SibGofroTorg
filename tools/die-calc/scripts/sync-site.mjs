/**
 * sync-site.mjs — перенос калькулятора в приложение (Next.js App Router).
 *
 *   node scripts/sync-site.mjs          # скопировать и переписать импорты
 *   node scripts/sync-site.mjs --check   # проверить, что в сайте не отстало
 *
 * Зачем: ядро и UI живут в tools/die-calc (тут их удобно тестировать и
 * рендерить превью), а работают — в админке сайта. Держать две копии руками
 * нельзя, поэтому синхронизация скриптом: он меняет только пути импорта.
 *
 *   tools/die-calc/src/core/**  ->  src/lib/die-calc/**
 *   tools/die-calc/src/ui/**    ->  src/components/admin/die-calc/**
 *   tools/die-calc/src/ui/ui.css->  src/app/admin-die-calc.css
 */

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.resolve(TOOL, '../..');
const check = process.argv.includes('--check');

const list = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** правка путей импорта: '../core/x' -> '@/lib/die-calc/x', ui.css -> app/admin-die-calc.css */
function rewrite(src) {
  return src
    .replace(/from '(\.\.\/core)\/index'/g, "from '@/lib/die-calc'")
    .replace(/from '(\.\.\/core)(\/[^']+)?'/g, (_m, _a, rest) => `from '@/lib/die-calc${rest ?? ''}'`)
    .replace(/import '\.\/ui\.css'/g, "import '@/app/admin-die-calc.css'")
    .replace(/from '\.\/core\/index'/g, "from '@/lib/die-calc'");
}

const BANNER = `// Этот файл скопирован из tools/die-calc скриптом \`node tools/die-calc/scripts/sync-site.mjs\`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
`;

const targets = [
  { from: path.join(TOOL, 'src/core'), to: path.join(SITE, 'src/lib/die-calc'), rewriteImports: false },
  { from: path.join(TOOL, 'src/ui'), to: path.join(SITE, 'src/components/admin/die-calc'), rewriteImports: true },
];

const diff = [];
for (const t of targets) {
  for (const file of list(t.from)) {
    if (file.endsWith('.css')) continue;
    const rel = path.relative(t.from, file);
    let out = readFileSync(file, 'utf8');
    if (t.rewriteImports) out = rewrite(out);
    if (!out.startsWith('// Этот файл скопирован')) out = BANNER + out;
    const dst = path.join(t.to, rel);
    const cur = existsSync(dst) ? readFileSync(dst, 'utf8') : null;
    if (cur === out) continue;
    diff.push(path.relative(SITE, dst));
    if (!check) {
      mkdirSync(path.dirname(dst), { recursive: true });
      writeFileSync(dst, out);
    }
  }
}

// стили — отдельным файлом в src/app, как принято в админке
const cssSrc = path.join(TOOL, 'src/ui/ui.css');
const cssDst = path.join(SITE, 'src/app/admin-die-calc.css');
const css = `/* Скопировано из tools/die-calc/src/ui/ui.css скриптом sync-site.mjs. */\n` + readFileSync(cssSrc, 'utf8');
if (existsSync(cssDst) ? readFileSync(cssDst, 'utf8') !== css : true) {
  diff.push(path.relative(SITE, cssDst));
  if (!check) writeFileSync(cssDst, css);
}

if (check && diff.length) {
  console.error('Копии в приложении отстают:\n  ' + diff.join('\n  ') + '\nЗапустите: node tools/die-calc/scripts/sync-site.mjs');
  process.exit(1);
}
console.log(check ? 'синхронно ✓' : `обновлено файлов: ${diff.length || '— (всё уже совпадает)'}`);
if (!check && diff.length) for (const f of diff) console.log('  wrote', f);
void rmSync;
