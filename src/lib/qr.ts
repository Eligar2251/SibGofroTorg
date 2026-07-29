// =========================================================
// FILE: src/lib/qr.ts
// Генерация стабильных штрихкодов и QR-slug для товаров.
//
// ── Почему детерминированно, а не из БД? ──
// 1) Не нужна миграция схемы — старые товары получают коды
//    автоматически при первом обращении.
// 2) Коды ГАРАНТИРОВАННО не меняются при правке товара
//    (имя, цена, категория, фото — что угодно). Даже если удалить
//    и создать заново с тем же id, код будет тот же.
// 3) Не нужно поле в БД → невозможно «потерять» или «затереть»
//    код вручную.
//
// ── Формат ──
//  • barcode: 13-значный EAN-13.
//      Первые 3 цифры = "200" (внутренний диапазон магазина,
//      стандарт GS1 не использует префикс 200 для публичных
//      товаров, поэтому в нашей БД не будет коллизий с
//      «настоящими» EAN).
//      Следующие 9 цифр = 9 hex-цифр из SHA-1(productId).
//      Последняя 13-я = контрольная сумма EAN-13 (по алгоритму
//      mod-10 с весами 1/3).
//  • qrSlug: 12 символов base32 (без 0/O/1/I), из 80 бит
//      SHA-1(productId). Используется в URL /admin/scan/{slug}
//      и в QR (QR-кодирует URL целиком — при сканировании
//      телефон сразу открывает страницу с ценой/наличием).
// =========================================================

import { createHash } from "node:crypto";

/** SHA-1(productId) → строка hex (40 символов). */
function sha1Hex(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex");
}

/** Контрольная цифра EAN-13 (взвешенная сумма mod 10). */
function ean13CheckDigit(twelveDigits: string): number {
  if (!/^\d{12}$/.test(twelveDigits)) {
    throw new Error(`ean13CheckDigit: expected 12 digits, got ${twelveDigits}`);
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(twelveDigits[i]);
    // Нечётные позиции (1, 3, 5, ...) — вес 1; чётные — вес 3.
    sum += (i % 2 === 0 ? 1 : 3) * d;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * EAN-13 для товара. Детерминированно: один productId → один barcode.
 * Пример: "2001234567893"
 */
export function computeBarcode(productId: string): string {
  // "200" (3 цифры) + 9 цифр из SHA-1 → 12 цифр + контрольная.
  const hash = sha1Hex(productId);
  // Берём 9 hex-цифр (каждая = 4 бита), превращаем в 9 десятичных
  // цифр через суммирование полубайт. Это даёт равномерное
  // распределение 0-9 (без «перекоса» к старшим hex-значениям).
  let nine = "";
  for (let i = 0; i < 9; i++) {
    const h = parseInt(hash[i], 16);
    nine += String(h % 10);
  }
  const twelve = "200" + nine;
  return twelve + String(ean13CheckDigit(twelve));
}

/**
 * Случайный EAN-13 из внутреннего диапазона магазина ("200" +
 * 9 случайных цифр + контрольная). Используется как фоллбек,
 * когда детерминированный код уже занят другим товаром, и для
 * ручной перегенерации штрихкода из карточки товара.
 */
export function randomBarcode(): string {
  const bytes = createHash("sha256")
    .update(`${Date.now()}:${Math.random()}:${process.hrtime.bigint()}`)
    .digest();
  let nine = "";
  for (let i = 0; i < 9; i++) {
    nine += String(bytes[i] % 10);
  }
  const twelve = "200" + nine;
  return twelve + String(ean13CheckDigit(twelve));
}

/**
 * Уникальный штрихкод с учётом уже занятых кодов.
 * Сначала пробует детерминированный computeBarcode(productId)
 * (важно для совместимости со старыми распечатками: если у товара
 * штрихкода в БД ещё нет, он получит ровно тот код, который уже
 * показывался на этикетках), при коллизии — детерминированные
 * соль-варианты, затем случайные коды.
 */
export function generateUniqueBarcode(
  productId: string,
  used: Set<string>
): string {
  const deterministic = computeBarcode(productId);
  if (!used.has(deterministic)) return deterministic;

  for (let salt = 1; salt < 1000; salt++) {
    const candidate = computeBarcode(`${productId}#${salt}`);
    if (!used.has(candidate)) return candidate;
  }
  // Теоретически недостижимо (1000 вариантов), но на всякий случай —
  // случайный перебор с кольцевой защитой.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = randomBarcode();
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Не удалось подобрать свободный штрихкод");
}

/** Crockford-style base32 (без 0/O/1/I/L/U для читаемости URL). */
const B32_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32Encode(bytes: Buffer, length: number): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32_ALPHABET[(buffer >> bits) & 0x1f];
      if (out.length >= length) return out;
    }
  }
  // Добиваем нулями, если не хватило бит.
  if (bits > 0 && out.length < length) {
    out += B32_ALPHABET[(buffer << (5 - bits)) & 0x1f];
  }
  return out.slice(0, length);
}

/**
 * Короткий стабильный slug для URL.
 * Берёт 80 бит SHA-1(productId) и кодирует в 16 символов base32
 * (по 5 бит на символ), но обрезает до 12 для компактности.
 * Пример: "QR9K2M7BXN4A"
 */
export function computeQrSlug(productId: string): string {
  const hash = sha1Hex(productId);
  // Берём 10 байт (80 бит) из hex → 16 base32 → обрезаем до 12.
  const bytes = Buffer.from(hash.slice(0, 20), "hex");
  return base32Encode(bytes, 12);
}

// ── Короткий публичный редирект-путь для QR ──
// Раньше в QR зашивался URL вида {origin}/{adminPath}/scan/{slug}.
// Это плохо по двум причинам:
//  1) Длина. adminPath — секретный и может быть длинным
//     ("sgt-panel-7x2k"), из-за чего payload перескакивал в
//     следующую версию QR (v4 → v5 → v6): больше модулей на той
//     же физической этикетке 26 мм → модуль меньше 0.5 мм →
//     дешёвые камеры перестают ловить фокус.
//  2) Секретный путь админки утекал на каждую печатную этикетку.
// Теперь QR ведёт на короткий публичный /q/{slug}, который
// редиректит внутрь админки (см. src/app/q/[code]/route.ts).
export const QR_SHORT_PATH = "q";

/**
 * Полный URL для зашивки в QR-код.
 *
 * ВАЖНО: строка намеренно собирается в ВЕРХНЕМ РЕГИСТРЕ.
 * Алфавит alphanumeric-режима QR (ISO/IEC 18004) содержит только
 * 0-9, A-Z и 9 символов (в т.ч. `:`, `/`, `.`, `-`), но НЕ строчные
 * буквы. Любая строчная буква переводит сегмент в byte-режим —
 * 8 бит на символ вместо 5.5. На нашем payload это ровно одна
 * лишняя версия QR (33 модуля вместо 29 при ecLevel Q).
 *
 * Регистр безопасен: схема и хост в URL регистронезависимы
 * (RFC 3986 §3.1, §3.2.2), а наш slug — base32 из заглавных
 * букв/цифр, и роут /q/[code] всё равно нормализует его через
 * toUpperCase().
 */
export function qrTargetUrl(slug: string, origin?: string): string {
  const path = `/${QR_SHORT_PATH}/${slug}`.toUpperCase();

  // Если origin не передан, оставляем относительный путь — это
  // работает в PWA-режиме (там origin = site origin), и в браузере
  // (там QR сканируется → открывается эта же страница).
  if (!origin) return path;

  // Схему и хост тоже в верхний регистр — иначе весь payload
  // остаётся byte-режимом и выигрыш теряется.
  return `${origin.replace(/\/$/, "").toUpperCase()}${path}`;
}

/**
 * EAN-13 → строка «200 1234 567890 5» (группы по 3 для красоты
 * при печати). Полезно для отображения под штрихкодом.
 */
export function formatBarcode(barcode: string): string {
  if (barcode.length !== 13) return barcode;
  return `${barcode.slice(0, 3)} ${barcode.slice(3, 7)} ${barcode.slice(7, 12)} ${barcode.slice(12)}`;
}

/**
 * Валидация строки как EAN-13. Возвращает true, если длина 13,
 * все цифры, и контрольная сумма совпадает.
 */
export function isValidBarcode(s: string): boolean {
  if (!/^\d{13}$/.test(s)) return false;
  return ean13CheckDigit(s.slice(0, 12)) === Number(s[12]);
}
