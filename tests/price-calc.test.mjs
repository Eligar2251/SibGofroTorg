// =========================================================
// FILE: tests/price-calc.test.mjs
// Проверка расчётов массового изменения цен (src/lib/price-calc.ts):
//   • накрутка к закупке, маржа от цены, разница в рублях;
//   • цена из наценки и снижение цены на процент;
//   • режимы округления (в том числе «не опускать ниже расчётной»);
//   • цена, которую видит покупатель, с учётом скидки товара.
// Запуск: npm run test:price-calc
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";
import {
  ROUNDING_MODES,
  applyRounding,
  effectivePrice,
  formatPercent,
  marginPercent,
  marginTone,
  markupPercent,
  parsePriceInput,
  priceFromDecrease,
  priceFromMarkup,
  profitPerUnit,
  round2,
} from "../src/lib/price-calc.ts";

// ── Основные формулы ───────────────────────────────────────

test("накрутка считается от закупки, маржа — от цены", () => {
  // Купили за 100, продаём за 120:
  // накрутка = 20/100 = 20%, маржа = 20/120 = 16,67%
  assert.equal(markupPercent(120, 100), 20);
  assert.equal(marginPercent(120, 100), 16.67);
  assert.equal(profitPerUnit(120, 100), 20);
});

test("формулы совпадают с колонкой «Разница» на складе", () => {
  // На складе показывается «+{цена − закуп} ₽» и
  // Math.round(((цена − закуп) / цена) * 100)% — сверяем с эталоном.
  const price = 1350;
  const purchase = 900;
  const warehousePercent = Math.round(((price - purchase) / price) * 100);
  // В таблице склада процент округляется до целого — сверяем именно это.
  assert.equal(Math.round(marginPercent(price, purchase)), warehousePercent);
  assert.equal(profitPerUnit(price, purchase), price - purchase);
});

test("без закупочной цены проценты не считаются", () => {
  assert.equal(markupPercent(500, 0), null);
  assert.equal(markupPercent(500, null), null);
  assert.equal(markupPercent(500, undefined), null);
  assert.equal(marginPercent(500, 0), null);
  assert.equal(markupPercent(null, 100), null);
  assert.equal(profitPerUnit(500, null), null);
  // Закупка 0 ₽ — «не указана», а не бесплатный товар.
  assert.equal(marginPercent(500, ""), null);
  assert.equal(markupPercent(500, ""), null);
});

test("убыточный товар даёт отрицательную накрутку и маржу", () => {
  assert.equal(markupPercent(90, 100), -10);
  assert.equal(marginPercent(90, 100), -11.11);
  assert.equal(profitPerUnit(90, 100), -10);
  assert.equal(marginTone(marginPercent(90, 100)), "loss");
});

test("тон маржи: убыток — красный, меньше 10% — янтарный, дальше зелёный", () => {
  assert.equal(marginTone(-1), "loss");
  assert.equal(marginTone(0), "thin");
  assert.equal(marginTone(9.99), "thin");
  assert.equal(marginTone(10), "ok");
  assert.equal(marginTone(null), "unknown");
});

// ── Цена из наценки ───────────────────────────────────────

test("цена из наценки: закуп × (1 + %/100)", () => {
  assert.equal(priceFromMarkup(1000, 30), 1300);
  assert.equal(priceFromMarkup(275.5, 25), 344.38);
  assert.equal(priceFromMarkup(1000, 0), 1000);
});

test("нулевая/отрицательная закупка — закупка не 0 → цена null", () => {
  assert.equal(priceFromMarkup(0, 50), null);
  assert.equal(priceFromMarkup(null, 50), null);
  assert.equal(priceFromMarkup(100, null), null);
});

test("наценка ниже −100% не даёт отрицательную цену", () => {
  assert.equal(priceFromMarkup(100, -250), 0);
});

test("наценка применяется вместе с округлением", () => {
  assert.equal(priceFromMarkup(137, 35, "ruble"), 185); // 184.95 → 185
  assert.equal(priceFromMarkup(137, 35, "ruble_up"), 185);
  assert.equal(priceFromMarkup(137, 35, "ten_up"), 190);
  assert.equal(priceFromMarkup(137, 35, "none"), 184.95);
});

test("ползунок наценки: 40% на разные закупки", () => {
  const cost = 96.42;
  assert.equal(priceFromMarkup(cost, 40), 134.99);
  assert.equal(priceFromMarkup(cost, 40, "ruble"), 135);
});

// ── Снижение цены ─────────────────────────────────────────

test("снижение цены на процент считается от текущей цены", () => {
  assert.equal(priceFromDecrease(1000, 10), 900);
  assert.equal(priceFromDecrease(1234, 5), 1172.3);
  assert.equal(priceFromDecrease(1000, 0), 1000);
});

test("снижение на 100% даёт 0, больше — не уходит в минус", () => {
  assert.equal(priceFromDecrease(1000, 100), 0);
  assert.equal(priceFromDecrease(1000, 150), 0);
});

test("снижение с округлением вверх не уходит ниже нужного уровня скидки", () => {
  // 999 − 10% = 899.1 → округление вверх до 10 ₽ даёт 900 (не 890!)
  assert.equal(priceFromDecrease(999, 10, "ten_up"), 900);
  assert.equal(priceFromDecrease(999, 10, "ruble"), 899);
});

// ── Округление ────────────────────────────────────────────

test("режимы округления работают как подписаны в интерфейсе", () => {
  assert.equal(applyRounding(487.31, "none"), 487.31);
  assert.equal(applyRounding(487.31, "ruble"), 487);
  assert.equal(applyRounding(487.31, "ruble_up"), 488);
  assert.equal(applyRounding(487.31, "ten_up"), 490);
  assert.equal(applyRounding(487.31, "fifty_up"), 500);
  assert.equal(applyRounding(487.31, "psych9"), 489);
});

test("«вверх» никогда не опускает цену ниже расчётной", () => {
  for (const mode of ["ruble_up", "ten_up", "fifty_up", "psych9"]) {
    for (const value of [1, 9.99, 100, 487.31, 1234.56, 99999]) {
      assert.ok(
        applyRounding(value, mode) >= value,
        `${mode}: ${value} → ${applyRounding(value, mode)}`
      );
    }
  }
});

test("цена заканчивается на 9 (кроме уже готовых чисел)", () => {
  assert.equal(applyRounding(490, "psych9"), 499);
  assert.equal(applyRounding(499, "psych9"), 499);
  assert.equal(applyRounding(0.5, "psych9"), 9);
});

test("нулевая и отрицательная цена округляются в 0", () => {
  assert.equal(applyRounding(0, "psych9"), 0);
  assert.equal(applyRounding(-5, "ten_up"), 0);
});

test("в каждой подписи режима округления есть человеческий текст", () => {
  assert.ok(ROUNDING_MODES.length >= 5);
  for (const mode of ROUNDING_MODES) {
    assert.ok(mode.label.length > 3, mode.value);
  }
});

// ── Ввод и вывод ──────────────────────────────────────────

test("цена разбирается из строки: запятая, пробелы, знак рубля", () => {
  assert.equal(parsePriceInput("1 290"), 1290);
  assert.equal(parsePriceInput("1290,50"), 1290.5);
  assert.equal(parsePriceInput("1290.50 ₽"), 1290.5);
  assert.equal(parsePriceInput(""), null);
  assert.equal(parsePriceInput("   "), null);
  assert.equal(parsePriceInput("дорого"), null);
  assert.equal(parsePriceInput(null), null);
});

test("деньги всегда округляются до копеек", () => {
  assert.equal(round2(0.005), 0.01);
  assert.equal(round2(133.3333), 133.33);
  assert.equal(round2(Number.NaN), 0);
});

test("проценты печатаются по-русски и с прочерком вместо «пусто»", () => {
  assert.equal(formatPercent(16.666), "17%");
  assert.equal(formatPercent(16.666, 1), "16,7%");
  assert.equal(formatPercent(null), "—");
});

// ── Цена на сайте со скидкой ──────────────────────────────

test("цена покупателя учитывает скидку товара", () => {
  assert.equal(effectivePrice(1000, "percent", 10), 900);
  assert.equal(effectivePrice(1000, "fixed", 150), 850);
  assert.equal(effectivePrice(1000, null, null), 1000);
  assert.equal(effectivePrice(null, "percent", 10), null);
});

test("скидка не уводит цену покупателя ниже нуля", () => {
  assert.equal(effectivePrice(100, "fixed", 500), 0);
  assert.equal(effectivePrice(100, "percent", 150), 0);
});

test("сценарий «понижение цен»: 5 товаров, −10%, округление до 10 ₽ вверх", () => {
  const prices = [199, 1249, 87.5, 3490, 999.99];
  const result = prices.map((price) => priceFromDecrease(price, 10, "ten_up"));
  assert.deepEqual(result, [180, 1130, 80, 3150, 900]);
  for (let i = 0; i < prices.length; i += 1) {
    assert.ok(result[i] <= prices[i], "новая цена не должна быть выше старой");
  }
});

test("сценарий «автоматические цены»: 40% к закупке и проверка маржи", () => {
  const rows = [
    { purchase: 100, expected: 140 },
    { purchase: 250, expected: 350 },
    { purchase: 1234.5, expected: 1728.3 },
  ];
  for (const row of rows) {
    const price = priceFromMarkup(row.purchase, 40, "none");
    assert.equal(price, row.expected);
    // Маржа при наценке 40% всегда 28,57% — это и увидит админ.
    assert.equal(marginPercent(price, row.purchase), 28.57);
    assert.equal(markupPercent(price, row.purchase), 40);
  }
});
