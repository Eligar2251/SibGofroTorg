// =========================================================
// FILE: tests/price-list.test.mjs
// Проверка расчёта прайс-листа по объёмам (src/lib/price-list.ts):
//   • обычная цена = закупка × (1 + наценка/100);
//   • цены столбцов = обычная цена × (1 − скидка/100);
//   • ручные цены не пересчитываются и не округляются;
//   • границы столбцов, подписи, пересчёт скидки ↔ накрутки;
//   • формат денег и проверка «мусора» из localStorage.
// Запуск: npm run test:price-list
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BASE_MARKUP,
  DEFAULT_PRICE_TIERS,
  computePriceListRow,
  discountForMarkup,
  formatMoney,
  markupForDiscount,
  moneyInputValue,
  normalizeDiscount,
  normalizeMarkup,
  resolveCategoryPricing,
  sanitizeCategoryMargins,
  sanitizePriceTiers,
  tierFrom,
  tierLabel,
  toPrice,
} from "../src/lib/price-list.ts";

const tiers = DEFAULT_PRICE_TIERS.map((tier) => ({ ...tier }));

// ── Столбцы объёмов ────────────────────────────────────────

test("подписи столбцов по умолчанию: до 100 / 100–500 / 500–1000 / от 1000", () => {
  assert.deepEqual(
    tiers.map((_, index) => tierLabel(tiers, index)),
    ["до 100", "от 100 до 500", "от 500 до 1000", "от 1000"]
  );
  assert.deepEqual(
    tiers.map((_, index) => tierFrom(tiers, index)),
    [0, 100, 500, 1000]
  );
});

test("подписи следуют за изменёнными границами", () => {
  const custom = tiers.map((tier) => ({ ...tier }));
  custom[0].upTo = 50;
  custom[1].upTo = 200;
  custom[2].upTo = 800;
  assert.deepEqual(
    custom.map((_, index) => tierLabel(custom, index)),
    ["до 50", "от 50 до 200", "от 200 до 800", "от 800"]
  );
});

test("испорченные столбцы из localStorage заменяются значениями по умолчанию", () => {
  // Не четыре столбца.
  assert.deepEqual(
    sanitizePriceTiers([{ upTo: 100 }, { upTo: null }]).map((t) => t.upTo),
    [100, 500, 1000, null]
  );
  // Границы не возрастают.
  assert.deepEqual(
    sanitizePriceTiers([
      { upTo: 500 },
      { upTo: 100 },
      { upTo: 1000 },
      { upTo: null },
    ]).map((t) => t.upTo),
    [100, 500, 1000, null]
  );
  // Последний столбец обязан быть без верхней границы.
  assert.deepEqual(
    sanitizePriceTiers([
      { upTo: 100 },
      { upTo: 500 },
      { upTo: 1000 },
      { upTo: 5000 },
    ]).map((t) => t.upTo),
    [100, 500, 1000, null]
  );
  // Годные значения сохраняются (включая скидки и выключенный столбец).
  const stored = sanitizePriceTiers([
    { id: "t1", upTo: 50, discount: 0, enabled: true },
    { id: "t2", upTo: 150, discount: 3.5, enabled: false },
    { id: "t3", upTo: 700, discount: -2, enabled: true },
    { id: "t4", upTo: null, discount: 12, enabled: true },
  ]);
  assert.equal(stored[0].upTo, 50);
  assert.equal(stored[1].discount, 3.5);
  assert.equal(stored[1].enabled, false);
  assert.equal(stored[2].discount, -2);
  assert.equal(stored[3].upTo, null);
});

// ── Обычная цена и столбцы ─────────────────────────────────

test("обычная цена = закупка + 30%, цены столбцов убывают", () => {
  const row = computePriceListRow({
    purchase: 100,
    baseMarkup: DEFAULT_BASE_MARKUP,
    rounding: "ruble",
    tiers,
  });
  assert.equal(row.base, 130);
  assert.equal(row.baseManual, false);
  assert.equal(row.tiers.t1, 130); // без скидки
  assert.equal(row.tiers.t2, 124); // 123,5 → до рубля
  assert.equal(row.tiers.t3, 117);
  assert.equal(row.tiers.t4, 111); // 110,5 → до рубля
  assert.equal(row.markupPercent, 30);
});

test("наценка 30% и скидки столбцов задаются в процентах", () => {
  const row = computePriceListRow({
    purchase: 1000,
    baseMarkup: 40,
    rounding: "none",
    tiers: [
      { id: "a", upTo: 10, discount: 0, enabled: true },
      { id: "b", upTo: 20, discount: 20, enabled: true },
      { id: "c", upTo: 30, discount: -10, enabled: true },
      { id: "d", upTo: null, discount: 50, enabled: true },
    ],
  });
  assert.equal(row.base, 1400);
  assert.equal(row.tiers.a, 1400);
  assert.equal(row.tiers.b, 1120);
  assert.equal(row.tiers.c, 1540); // отрицательная скидка = наценка
  assert.equal(row.tiers.d, 700);
});

test("округление применяется к автоматическим ценам", () => {
  const row = computePriceListRow({
    purchase: 275.5,
    baseMarkup: 30,
    rounding: "ten_up",
    tiers,
  });
  // 275,5 × 1,3 = 358,15 → вверх до 10 = 360
  assert.equal(row.base, 360);
  assert.equal(row.tiers.t1, 360); // 360 → 360
  assert.equal(row.tiers.t2, 350); // 342 → вверх до 10 = 350
  assert.equal(row.tiers.t3, 330); // 324 → 330
  assert.equal(row.tiers.t4, 310); // 306 → 310
});

test("ручная обычная цена важнее расчёта и не округляется", () => {
  const row = computePriceListRow({
    purchase: 100,
    baseOverride: 149.5,
    baseMarkup: 30,
    rounding: "ten_up",
    tiers,
  });
  assert.equal(row.base, 149.5);
  assert.equal(row.baseManual, true);
  assert.equal(row.tiers.t1, 150); // 149,5 → вверх до 10 (скидка 0)
  assert.equal(row.tiers.t2, 150); // 142,025 → вверх до 10
  assert.equal(row.tiers.t3, 140); // 134,55 → вверх до 10
  assert.equal(row.tiers.t4, 130); // 127,075 → вверх до 10
  assert.equal(row.markupPercent, 49.5);
});

test("ручная цена столбца не пересчитывается и помечается", () => {
  const row = computePriceListRow({
    purchase: 100,
    baseMarkup: 30,
    rounding: "ruble",
    tiers,
    tierOverrides: { t2: 99.9, t3: 0, t4: null },
  });
  assert.equal(row.tiers.t1, 130);
  assert.equal(row.tiers.t2, 99.9);
  assert.equal(row.manualTiers.t2, true);
  // 0 и null — это не ручная цена, а «пусто» → считаем автоматически.
  assert.equal(row.tiers.t3, 117);
  assert.equal(row.manualTiers.t3, false);
  assert.equal(row.tiers.t4, 111);
  assert.equal(row.manualTiers.t4, false);
});

test("без закупки цен нет, но ручная цена остаётся", () => {
  const empty = computePriceListRow({
    purchase: null,
    baseMarkup: 30,
    rounding: "ruble",
    tiers,
  });
  assert.equal(empty.base, null);
  assert.equal(empty.tiers.t1, null);

  const manual = computePriceListRow({
    purchase: null,
    baseOverride: 120,
    baseMarkup: 30,
    rounding: "ruble",
    tiers,
  });
  assert.equal(manual.base, 120);
  assert.equal(manual.tiers.t1, 120);
  assert.equal(manual.tiers.t4, 102);
  assert.equal(manual.markupPercent, null);
});

test("выключенный столбец не попадает в расчёт", () => {
  const row = computePriceListRow({
    purchase: 100,
    baseMarkup: 30,
    rounding: "ruble",
    tiers: tiers.map((tier) =>
      tier.id === "t2" ? { ...tier, enabled: false } : tier
    ),
  });
  assert.equal(row.tiers.t2, undefined);
  assert.equal(row.tiers.t1, 130);
});

test("цена = 0 или отрицательная — это «нет значения», а не цена", () => {
  assert.equal(toPrice(0), null);
  assert.equal(toPrice(-10), null);
  assert.equal(toPrice(""), null);
  assert.equal(toPrice("1 234,56"), 1234.56);
  assert.equal(toPrice("abc"), null);
});

// ── Проценты ───────────────────────────────────────────────

test("скидка ↔ накрутка к закупке при базовой наценке 30%", () => {
  // База +30%, скидка 10% → 130 × 0,9 = 117 → накрутка к закупке +17%.
  assert.equal(markupForDiscount(30, 10), 17);
  // Хотим накрутку +25% при базе +30% → скидка 3,85%.
  assert.equal(discountForMarkup(30, 25), 3.85);
  // Обратный пересчёт возвращает исходную накрутку.
  assert.equal(markupForDiscount(30, discountForMarkup(30, 25)), 25);
});

test("проценты из localStorage не выходят за разумные пределы", () => {
  assert.equal(normalizeMarkup("abc"), DEFAULT_BASE_MARKUP);
  assert.equal(normalizeMarkup(-500), -90);
  assert.equal(normalizeMarkup(100000), 1000);
  assert.equal(normalizeMarkup("30"), 30);
  assert.equal(normalizeDiscount("abc"), 0);
  assert.equal(normalizeDiscount(-1000), -500);
  assert.equal(normalizeDiscount(500), 100);
  assert.equal(normalizeDiscount(7.25), 7.25);
});

// ── Формат денег ───────────────────────────────────────────

test("деньги печатаются с пробелами и запятой", () => {
  assert.equal(formatMoney(1234), "1 234");
  assert.equal(formatMoney(1234.5), "1 234,50");
  assert.equal(formatMoney(0.99), "0,99");
  assert.equal(formatMoney(null), "—");
  assert.equal(formatMoney(undefined), "—");
  assert.equal(moneyInputValue(1234.5), "1234.5");
  assert.equal(moneyInputValue(null), "");
});

// ── Наценки и скидки по категориям ───────────────

test("без настроек категории — общие наценка и скидки", () => {
  const resolved = resolveCategoryPricing("cat-1", {}, 30, tiers);
  assert.equal(resolved.baseMarkup, 30);
  assert.deepEqual(
    resolved.tiers.map((t) => t.discount),
    [0, 5, 10, 15]
  );
  // Незнакомая категория и null — тоже общие настройки.
  assert.equal(
    resolveCategoryPricing("nope", { "cat-1": { markup: 50, tierDiscounts: {} } }, 30, tiers).baseMarkup,
    30
  );
  assert.equal(
    resolveCategoryPricing(null, {}, 30, tiers).baseMarkup,
    30
  );
});

test("категория переопределяет наценку и скидки столбцов", () => {
  const resolved = resolveCategoryPricing(
    "cat-1",
    {
      "cat-1": {
        markup: 50,
        tierDiscounts: { t2: 2, t4: null },
      },
    },
    30,
    tiers
  );
  assert.equal(resolved.baseMarkup, 50);
  // t2 переопределён, t4 явно null — общая скидка,
  // t1 и t3 — общие.
  assert.deepEqual(
    resolved.tiers.map((t) => t.discount),
    [0, 2, 10, 15]
  );
  // Исходные столбцы не меняются.
  assert.deepEqual(
    tiers.map((t) => t.discount),
    [0, 5, 10, 15]
  );
});

test("переопределённая категория меняет цену товара", () => {
  const row = computePriceListRow({
    purchase: 100,
    baseMarkup: 30,
    rounding: "none",
    tiers,
    ...resolveCategoryPricing(
      "cat-1",
      { "cat-1": { markup: 100, tierDiscounts: { t4: 50 } } },
      30,
      tiers
    ),
    // resolveCategoryPricing возвращает { baseMarkup, tiers } —
    // они перезаписывают общие выше по spread.
  });
  // Закупка 100 × (1 + 100%) = 200; столбец «от 1000»:
  // 200 × (1 − 50%) = 100.
  assert.equal(row.base, 200);
  assert.equal(row.tiers.t1, 200);
  assert.equal(row.tiers.t4, 100);
});

test("испорченные наценки категорий из localStorage", () => {
  const categoryIds = new Set(["c1", "c2"]);
  const tierIds = new Set(["t1", "t2", "t3", "t4"]);

  // Незнакомые категории и столбцы выкидываются.
  assert.deepEqual(
    sanitizeCategoryMargins(
      {
        c1: { markup: 40, tierDiscounts: { t1: 3, "tX": 99 } },
        "ghost": { markup: 99 },
        c2: "мусор",
      },
      categoryIds,
      tierIds
    ),
    { c1: { markup: 40, tierDiscounts: { t1: 3 } } }
  );

  // Пустые настройки исчезают — категория «как общие».
  assert.deepEqual(
    sanitizeCategoryMargins(
      { c1: { markup: null, tierDiscounts: {} } },
      categoryIds,
      tierIds
    ),
    {}
  );

  // Проценты обрезаются в пределы.
  const cleaned = sanitizeCategoryMargins(
    { c1: { markup: 10000, tierDiscounts: { t1: -900 } } },
    categoryIds,
    tierIds
  );
  assert.equal(cleaned.c1.markup, 1000);
  assert.equal(cleaned.c1.tierDiscounts.t1, -500);
});
