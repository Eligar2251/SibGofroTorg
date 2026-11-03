// =========================================================
// FILE: tests/product-color-twin.test.mjs
// Модульные тесты копирования карточки товара и автогенерации
// связанной парной карточки другого цвета («бурый ↔ белый»).
// Запуск: npm run test:color-twin
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";

const {
  detectCardboardColor,
  resolveColorTwinMeta,
  buildColorTwinName,
  ensureColorInName,
  buildColorTwinMaterial,
  buildColorTwinSku,
  prepareProductCopyDraft,
} = await import("../src/lib/product-color-twin.ts");

test("Лоток № 60 бурый ↔ Лоток № 60 белый (в обе стороны)", () => {
  const fromBrown = resolveColorTwinMeta("Лоток № 60 бурый", "Т-24");
  assert.equal(fromBrown.sourceColor, "brown");
  assert.equal(fromBrown.targetColor, "white");
  assert.equal(fromBrown.buttonLabel, "Есть белый вариант");
  assert.equal(
    buildColorTwinName("Лоток № 60 бурый", fromBrown.targetColor),
    "Лоток № 60 белый",
  );

  const fromWhite = resolveColorTwinMeta("Лоток № 60 белый", "Т-24");
  assert.equal(fromWhite.sourceColor, "white");
  assert.equal(fromWhite.targetColor, "brown");
  assert.equal(fromWhite.buttonLabel, "Есть бурый вариант");
  assert.equal(
    buildColorTwinName("Лоток № 60 белый", fromWhite.targetColor),
    "Лоток № 60 бурый",
  );
});

test("Согласование рода, числа и регистра («Коробка бурая», «Дно бурое», «Лотки бурые», «(Бурый)»)", () => {
  assert.equal(
    buildColorTwinName("Коробка 600×400×400 бурая", "white"),
    "Коробка 600×400×400 белая",
  );
  assert.equal(
    buildColorTwinName("Коробка 600×400×400 белая", "brown"),
    "Коробка 600×400×400 бурая",
  );
  assert.equal(buildColorTwinName("Дно лотка бурое", "white"), "Дно лотка белое");
  assert.equal(
    buildColorTwinName("Лотки овощные бурые", "white"),
    "Лотки овощные белые",
  );
  assert.equal(
    buildColorTwinName("Гофрокороб 300×200×200 (Бурый)", "white"),
    "Гофрокороб 300×200×200 (Белый)",
  );
});

test("Если в исходном названии цвет ещё не написан — корректно подбирает окончание по существительному", () => {
  assert.equal(detectCardboardColor("Лоток № 60", null), null);
  assert.equal(ensureColorInName("Лоток № 60", "brown"), "Лоток № 60 бурый");
  assert.equal(buildColorTwinName("Лоток № 60", "white"), "Лоток № 60 белый");

  assert.equal(
    ensureColorInName("Коробка 300×200×150", "brown"),
    "Коробка 300×200×150 бурая",
  );
  assert.equal(
    buildColorTwinName("Коробка 300×200×150", "white"),
    "Коробка 300×200×150 белая",
  );
});

test("buildColorTwinSku и buildColorTwinMaterial аккуратно меняют суффиксы цвета", () => {
  assert.equal(buildColorTwinSku("Л-60-БР", "white"), "Л-60-БЛ");
  assert.equal(buildColorTwinSku("Л-60-БЛ", "brown"), "Л-60-БР");
  assert.equal(buildColorTwinSku("KB-600", "white"), "KB-600-БЕЛ");
  assert.equal(buildColorTwinMaterial("Т-24 бурый", "white"), "Т-24 белый");
  assert.equal(buildColorTwinMaterial("Т-24", "white"), "Т-24");
});

test("prepareProductCopyDraft переносит характеристики и цены, обнуляя остаток, штрихкод и связки", () => {
  const draft = prepareProductCopyDraft({
    id: "prod-1",
    name: "Коробка 600×400×400",
    sku: "KB-600",
    barcode: "4600000000019",
    price: 55,
    priceWholesale: 48,
    dimensionLength: 600,
    dimensionWidth: 400,
    dimensionHeight: 400,
    stockQty: 340,
    inStock: true,
    isFeatured: true,
    featuredOrder: 2,
    linkGroupId: "grp-1",
    linkedProductIds: ["prod-1", "prod-2"],
    images: [{ url: "/img/box.jpg", publicId: "" }],
  });

  assert.equal(draft.id, undefined);
  assert.equal(draft.sku, "");
  assert.equal(draft.barcode, null);
  assert.equal(draft.stockQty, 0);
  assert.equal(draft.inStock, false);
  assert.equal(draft.isFeatured, false);
  assert.equal(draft.linkGroupId, null);
  assert.deepEqual(draft.linkedProductIds, []);
  assert.equal(draft.price, 55);
  assert.equal(draft.priceWholesale, 48);
  assert.equal(draft.dimensionLength, 600);
  assert.equal(draft.images.length, 1);
});
