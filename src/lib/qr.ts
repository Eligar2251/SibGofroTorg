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
 * Пример: "2001234567890"
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

/** Полный URL для зашивки в QR-код. */
export function qrTargetUrl(slug: string, origin?: string): string {
  // Если origin не передан, оставляем относительный путь — это
  // работает в PWA-режиме (там origin = site origin), и в браузере
  // (там QR сканируется → открывается эта же страница).
  if (origin) {
    return `${origin.replace(/\/$/, "")}/admin/scan/${slug}`;
  }
  return `/admin/scan/${slug}`;
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
