// =========================================================
// FILE: tests/media-csp-audit.test.mjs — страховка от блокировки картинок политикой CSP
//
// Сайт отдаёт `img-src 'self' data: blob:` (+ Яндекс для Метрики). Значит любой
// <img> или new Image(), получивший наружный адрес напрямую (например
// https://res.cloudinary.com/...), браузером НЕ грузится: файл в облаке есть,
// в базе есть, а на экране пусто. Чтобы это не возвращалось по одному месту
// за раз, тест проходит по всему src/ и требует, чтобы изображение шло через
// toSameOriginMediaUrl() / наш /media / data: / blob:.

import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = "src";

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(full, out);
    } else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Конец открывающего тега: '>' на нулевой глубине {…} и вне строк. */
function tagEnd(text, from) {
  let depth = 0;
  let quote = "";
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return i;
  }
  return Math.min(text.length, from + 800);
}

/** Значение атрибута: text[attrStart-1] — открывающий { или ". */
function attrValue(text, attrStart, open) {
  if (open !== "{") {
    const close = attrStart > 0 ? text.slice(0, attrStart).match(/["'`]/)?.[0] : '"';
    const end = text.indexOf(close || '"', attrStart);
    return end === -1 ? text.slice(attrStart, attrStart + 120) : text.slice(attrStart, end);
  }
  let depth = 1;
  let quote = "";
  for (let i = attrStart; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(attrStart, i);
    }
  }
  return text.slice(attrStart, attrStart + 120);
}

/** Комментарии и шаблонные строки не JSX-разметка: вырезаем, чтобы не пугать сканер. */
function stripNonJsx(text) {
  return text
    .replace(/`[\s\S]*?`/g, (m) => " ".repeat(Math.min(m.length, 1)))
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function isSafeSrc(value) {
  const v = value.trim();
  if (!v) return false;
  if (v.includes("toSameOriginMediaUrl")) return true;
  // Статика: наш же /api, /images, data:/blob:
  if (/^["'`]/.test(v)) {
    const body = v.replace(/^["'`]/, "").replace(/["'`]$/, "");
    if (body.startsWith("/") || body.startsWith("data:") || body.startsWith("blob:")) return true;
    // Метрика: mc.yandex.ru явно разрешён в img-src
    if (/mc\.yandex\.ru/.test(body)) return true;
  }
  // Шаблонная строка `/api/admin/qr/...`
  if (v.startsWith("`") && (v.slice(1).startsWith("/") || /mc\.yandex\.ru/.test(v))) return true;
  if (v.includes("URL.createObjectURL") || v.includes("createObjectURL")) return true;
  return false;
}

const files = sourceFiles(ROOT);

test("каждый <img> в src/ получает только внутренний адрес (/media, /api, data:)", () => {
  assert.ok(files.length > 100, "не нашёл исходники — сломан обход каталога");
  const bad = [];
  // Смысл проверки — фото из базы (Cloudinary и т.п.). Локальные data:-картинки
  // и переменные вида *DataUrl блокироваться не могут, их не трогаем.
  const MEDIA_FIELD = /\.(imageUrl|image_url|secureUrl|secure_url|photoUrl|photo_url|avatarUrl|avatar_url|coverUrl|cover_url|thumbUrl|thumbnail|imageurl|image|photo|avatar|cover|src|url)\b/i;
  for (const file of files) {
    const text = stripNonJsx(fs.readFileSync(file, "utf8"));
    let i = 0;
    while ((i = text.indexOf("<img", i)) !== -1) {
      const after = text[i + 4];
      if (after && !/[\s/>]/.test(after)) {
        i += 4;
        continue;
      }
      const end = tagEnd(text, i);
      const tag = text.slice(i, end + 1);
      const m = /\bsrc\s*=\s*[{"`]/.exec(tag);
      if (m) {
        const start = i + m.index + m[0].length;
        const open = text[start - 1];
        const value = attrValue(text, start, open);
        const line = text.slice(0, i).split("\n").length;
        const escape = text.slice(Math.max(0, i - 240), i);
        const looksLikePhotoField = MEDIA_FIELD.test(value) && !/DataUrl|ObjectUrl|BlobUrl/.test(value);
        if (looksLikePhotoField && !isSafeSrc(value) && !escape.includes("csp-allow")) {
          bad.push(`${file}:${line}  src={${value.trim().slice(0, 60)}}`);
        }
      }
      i = end + 1;
    }
  }
  assert.deepEqual(bad, [], "CSP (img-src 'self') заблокирует эти картинки:\n" + bad.join("\n"));
});

test("canvas в редакторах грузит картинки через /media или локальный blob:", () => {
  const bad = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (!/new Image\(/.test(text)) continue;
    const usesLocal = /URL\.createObjectURL/.test(text);
    const usesProxy = text.includes("toSameOriginMediaUrl");
    if (usesLocal && usesProxy) continue;
    // Каждое присваивание .src должно быть безопасным выражением.
    let m;
    const re = /\.src\s*=\s*([^;\n]+)/g;
    while ((m = re.exec(text))) {
      const value = m[1];
      const ok =
        usesProxy ||
        (usesLocal && !/https?:/.test(value)) ||
        /^(["'`])\/|["'`](data:|blob:)/.test(value.trim()) ||
        /createObjectURL|toSameOriginMediaUrl/.test(value);
      if (!ok) {
        const line = text.slice(0, m.index).split("\n").length;
        bad.push(`${file}:${line}  .src = ${value.trim().slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(bad, [], "canvas получит tainted/заблокированный источник:\n" + bad.join("\n"));
});

test("лоадер next/image тоже переводит внешние адреса в /media", () => {
  const loader = fs.readFileSync("src/lib/image-loader.ts", "utf8");
  assert.match(loader, /toSameOriginMediaUrl\(src\)/);
  assert.match(loader, /startsWith\(`\$\{MEDIA_PREFIX\}\/`\)/, "иначе next/image уйдёт на чужой хост");
});
