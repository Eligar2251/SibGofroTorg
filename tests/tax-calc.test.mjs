// =========================================================
// FILE: tests/tax-calc.test.mjs
// Налоги и прибыль ООО на ОСНО (октябрь 2026):
// НДС 22%, налог на прибыль 25%.
// Запуск: npm run test:tax
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROFIT_TAX_RATE,
  DEFAULT_VAT_RATE,
  computeUnitTaxes,
  normalizeTaxRate,
  summarizeTaxes,
} from "../src/lib/tax-calc.ts";

const rates = {
  vatRate: DEFAULT_VAT_RATE, // 22
  profitTaxRate: DEFAULT_PROFIT_TAX_RATE, // 25
  pricesIncludeVat: true,
};

test("ставки по умолчанию: НДС 22%, прибыль 25%", () => {
  assert.equal(DEFAULT_VAT_RATE, 22);
  assert.equal(DEFAULT_PROFIT_TAX_RATE, 25);
});

test("цены с НДС: выручка, НДС, прибыль, налог, чистыми", () => {
  // Цена 1 220 ₽ (с НДС), закупка 610 ₽ (с НДС).
  const unit = computeUnitTaxes(1220, 610, rates);
  assert.notEqual(unit, null);
  assert.equal(unit.revenueNet, 1000); // 1220 / 1,22
  assert.equal(unit.vatInRevenue, 220);
  assert.equal(unit.costNet, 500); // 610 / 1,22
  assert.equal(unit.vatDeduction, 110);
  assert.equal(unit.vatPayable, 110); // 220 − 110
  assert.equal(unit.profitBeforeTax, 500); // 1000 − 500
  assert.equal(unit.profitTax, 125); // 500 × 25%
  assert.equal(unit.netProfit, 375); // 500 − 125
  assert.equal(unit.netMarginPercent, 37.5); // 375 / 1000
});

test("цены без НДС: налог сверху, прибыль та же", () => {
  const withoutVat = { ...rates, pricesIncludeVat: false };
  const unit = computeUnitTaxes(1000, 500, withoutVat);
  assert.equal(unit.revenueNet, 1000);
  assert.equal(unit.vatInRevenue, 220); // 1000 × 22%
  assert.equal(unit.costNet, 500);
  assert.equal(unit.vatDeduction, 110);
  assert.equal(unit.vatPayable, 110);
  assert.equal(unit.profitBeforeTax, 500);
  assert.equal(unit.profitTax, 125);
  assert.equal(unit.netProfit, 375);
});

test("без закупки или без цены — считать нечего", () => {
  assert.equal(computeUnitTaxes(null, 100, rates), null);
  assert.equal(computeUnitTaxes(100, null, rates), null);
  assert.equal(computeUnitTaxes(0, 100, rates), null);
  assert.equal(computeUnitTaxes(100, -5, rates), null);
});

test("убыточная позиция: налога на прибыль нет", () => {
  // Закупка дороже цены — убыток, налог не начисляется.
  const unit = computeUnitTaxes(122, 1220, rates);
  assert.equal(unit.profitBeforeTax, -900); // 100 − 1000
  assert.equal(unit.profitTax, 0);
  assert.equal(unit.netProfit, -900);
});

test("НДС 0%: налога нет, прибыль = разница цен", () => {
  const noVat = { ...rates, vatRate: 0 };
  const unit = computeUnitTaxes(1000, 500, noVat);
  assert.equal(unit.revenueNet, 1000);
  assert.equal(unit.vatInRevenue, 0);
  assert.equal(unit.vatDeduction, 0);
  assert.equal(unit.vatPayable, 0);
  assert.equal(unit.profitBeforeTax, 500);
  assert.equal(unit.netProfit, 375);
});

test("сводка: выручка по всем ценам, прибыль — по товарам с закупкой", () => {
  const summary = summarizeTaxes(
    [
      { price: 1220, purchase: 610, qty: 2 }, // прибыль 375 × 2
      { price: 122, purchase: null, qty: 10 }, // закупки нет
      { price: null, purchase: 100, qty: 1 }, // цены нет
    ],
    rates
  );
  assert.equal(summary.pricedCount, 2);
  assert.equal(summary.costedCount, 1);
  assert.equal(summary.missingPurchaseCount, 1);
  // Выручка: 1220×2 + 122×10 = 2440 + 1220 = 3660
  assert.equal(summary.revenueGross, 3660);
  // Выручка без НДС: 1000×2 + 100×10 = 3000
  assert.equal(summary.revenueNet, 3000);
  // НДС в выручке: 220×2 + 22×10 = 660
  assert.equal(summary.vatInRevenue, 660);
  // Себестоимость только одной позиции: 610×2 = 1220
  assert.equal(summary.costGross, 1220);
  // НДС к уплате — вычет только от закупки с НДС
  assert.equal(summary.vatPayable, 660 - 220);
  // Прибыль: (1000−500)×2 = 1000; налог 250; чистыми 750
  assert.equal(summary.profitBeforeTax, 1000);
  assert.equal(summary.profitTax, 250);
  assert.equal(summary.netProfit, 750);
  assert.equal(summary.netMarginPercent, 25); // 750 / 3000
});

test("сводка без закупок: прибыль не считается (null)", () => {
  const summary = summarizeTaxes(
    [{ price: 1220, purchase: null, qty: 1 }],
    rates
  );
  assert.equal(summary.pricedCount, 1);
  assert.equal(summary.costedCount, 0);
  assert.equal(summary.profitBeforeTax, null);
  assert.equal(summary.netProfit, null);
  // Выручка и НДС всё равно считаются.
  assert.equal(summary.revenueGross, 1220);
  assert.equal(summary.vatInRevenue, 220);
});

test("план продаж умножает суммы сводки", () => {
  const summary = summarizeTaxes(
    [{ price: 1220, purchase: 610, qty: 5 }],
    rates
  );
  assert.equal(summary.revenueGross, 6100);
  assert.equal(summary.netProfit, 1875); // 375 × 5
});

test("ставки из поля ввода обрезаются в разумные пределы", () => {
  assert.equal(normalizeTaxRate("abc", 22), 22);
  assert.equal(normalizeTaxRate(-5, 22), 0);
  assert.equal(normalizeTaxRate(99, 25), 50);
  assert.equal(normalizeTaxRate(20, 22), 20);
});
