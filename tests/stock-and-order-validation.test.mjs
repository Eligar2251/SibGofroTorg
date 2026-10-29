import test from "node:test";
import assert from "node:assert/strict";

import {
  getAvailableStockQty,
  isProductAvailable,
  isOutOfStock,
} from "../src/lib/stock-availability.ts";
import { buildStockLabel } from "../src/lib/scan.ts";
import { evaluateOrderItemsStock } from "../src/lib/order-stock-validation.ts";

test("stock availability relies strictly on stockQty and ignores manual inStock flag", () => {
  // Регрессия: пустой/null остаток при включённом inStock НЕ должен делать товар доступным
  assert.equal(getAvailableStockQty({ stockQty: null, inStock: true }), 0);
  assert.equal(isProductAvailable({ stockQty: null, inStock: true }), false);
  assert.equal(isOutOfStock({ stockQty: null, inStock: true }), true);

  // Регрессия: нулевой или отрицательный остаток при inStock=true — нет в наличии
  assert.equal(getAvailableStockQty({ stockQty: 0, inStock: true }), 0);
  assert.equal(isProductAvailable({ stockQty: 0, inStock: true }), false);
  assert.equal(getAvailableStockQty({ stockQty: -4, inStock: true }), 0);
  assert.equal(isProductAvailable({ stockQty: -4, inStock: true }), false);

  // Дробный остаток меньше 1 целой единицы не даёт положить 1 шт. в корзину
  assert.equal(getAvailableStockQty({ stockQty: 0.5, inStock: true }), 0);
  assert.equal(isProductAvailable({ stockQty: 0.5, inStock: true }), false);

  // Положительный остаток делает товар доступным независимо от устаревшего inStock=false
  assert.equal(getAvailableStockQty({ stockQty: 7, inStock: false }), 7);
  assert.equal(isProductAvailable({ stockQty: 7, inStock: false }), true);
  assert.equal(getAvailableStockQty({ stockQty: 3.8, inStock: false }), 3);
});

test("buildStockLabel marks null and non-positive stockQty as out of stock", () => {
  assert.deepEqual(buildStockLabel({ stockQty: null, inStock: true }), {
    text: "Нет в наличии",
    tone: "out",
  });
  assert.deepEqual(buildStockLabel({ stockQty: 0, inStock: true }), {
    text: "Нет в наличии",
    tone: "out",
  });
  assert.deepEqual(buildStockLabel({ stockQty: 5, inStock: false }), {
    text: "Мало: 5 шт",
    tone: "low",
  });
  assert.deepEqual(buildStockLabel({ stockQty: 25, inStock: false }), {
    text: "В наличии: 25 шт",
    tone: "ok",
  });
});

test("evaluateOrderItemsStock blocks ordering out-of-stock, null-stock, made-to-order, and hidden products", () => {
  const products = new Map([
    ["p-zero", { id: "p-zero", name: "Короб 0", stockQty: 0, isVisible: true, madeToOrder: false }],
    ["p-null", { id: "p-null", name: "Короб Null", stockQty: null, isVisible: true, madeToOrder: false }],
    ["p-mto", { id: "p-mto", name: "Короб под заказ", stockQty: 50, isVisible: true, madeToOrder: true }],
    ["p-hidden", { id: "p-hidden", name: "Скрытый короб", stockQty: 10, isVisible: false, madeToOrder: false }],
  ]);
  const variants = new Map();

  const rZero = evaluateOrderItemsStock(
    [{ productId: "p-zero", quantity: 1 }],
    products,
    variants,
  );
  assert.equal(rZero.ok, false);
  assert.equal(rZero.items[0].status, "out_of_stock");
  assert.equal(rZero.items[0].availableQty, 0);

  const rNull = evaluateOrderItemsStock(
    [{ productId: "p-null", quantity: 1 }],
    products,
    variants,
  );
  assert.equal(rNull.ok, false);
  assert.equal(rNull.items[0].status, "out_of_stock");

  const rMto = evaluateOrderItemsStock(
    [{ productId: "p-mto", quantity: 1 }],
    products,
    variants,
  );
  assert.equal(rMto.ok, false);
  assert.equal(rMto.items[0].status, "made_to_order");

  const rHidden = evaluateOrderItemsStock(
    [{ productId: "p-hidden", quantity: 1 }],
    products,
    variants,
  );
  assert.equal(rHidden.ok, false);
  assert.equal(rHidden.items[0].status, "unavailable");

  const rMissing = evaluateOrderItemsStock(
    [{ productId: "p-missing", name: "Удалённый товар", quantity: 1 }],
    products,
    variants,
  );
  assert.equal(rMissing.ok, false);
  assert.equal(rMissing.items[0].status, "unavailable");
});

test("evaluateOrderItemsStock enforces stock limits across regular products, pooled variants, and per-variant stock", () => {
  const products = new Map([
    ["p-ok", { id: "p-ok", name: "Короб 600", stockQty: 10, isVisible: true, madeToOrder: false }],
    ["p-pooled", { id: "p-pooled", name: "Скотч цветной", stockQty: 5, isVisible: true, madeToOrder: false }],
    ["p-split", { id: "p-split", name: "Плёнка", stockQty: 100, isVisible: true, madeToOrder: false }],
  ]);

  const variants = new Map([
    [
      "p-pooled",
      [
        { id: "v-red", productId: "p-pooled", name: "Красный", stockQty: 0, isVisible: true },
        { id: "v-blue", productId: "p-pooled", name: "Синий", stockQty: 0, isVisible: true },
      ],
    ],
    [
      "p-split",
      [
        { id: "v-in", productId: "p-split", name: "Белая", stockQty: 4, isVisible: true },
        { id: "v-out", productId: "p-split", name: "Чёрная", stockQty: 0, isVisible: true },
      ],
    ],
  ]);

  // Превышение остатка обычного товара
  const rTooMany = evaluateOrderItemsStock(
    [{ productId: "p-ok", quantity: 11 }],
    products,
    variants,
  );
  assert.equal(rTooMany.ok, false);
  assert.equal(rTooMany.items[0].status, "insufficient_stock");
  assert.equal(rTooMany.items[0].availableQty, 10);

  // Допустимое количество
  const rExact = evaluateOrderItemsStock(
    [{ productId: "p-ok", quantity: 10 }],
    products,
    variants,
  );
  assert.equal(rExact.ok, true);

  // Варианты с общим пулом родителя: 2 + 3 <= 5 — ок
  const rPoolOk = evaluateOrderItemsStock(
    [
      { productId: "p-pooled", variantId: "v-red", variantName: "Красный", quantity: 2 },
      { productId: "p-pooled", variantId: "v-blue", variantName: "Синий", quantity: 3 },
    ],
    products,
    variants,
  );
  assert.equal(rPoolOk.ok, true);
  assert.equal(rPoolOk.items[0].stockPoolId, "p-pooled");

  // Варианты с общим пулом родителя: 3 + 3 > 5 — отказ
  const rPoolOver = evaluateOrderItemsStock(
    [
      { productId: "p-pooled", variantId: "v-red", quantity: 3 },
      { productId: "p-pooled", variantId: "v-blue", quantity: 3 },
    ],
    products,
    variants,
  );
  assert.equal(rPoolOver.ok, false);
  assert.equal(rPoolOver.items[0].status, "insufficient_stock");

  // Раздельный учёт вариантов: нулевой вариант нельзя заказать даже при большом stockQty родителя
  const rSplitOut = evaluateOrderItemsStock(
    [{ productId: "p-split", variantId: "v-out", quantity: 1 }],
    products,
    variants,
  );
  assert.equal(rSplitOut.ok, false);
  assert.equal(rSplitOut.items[0].status, "out_of_stock");

  // Раздельный учёт вариантов: заказ без выбора variantId отклоняется
  const rSplitNoVariant = evaluateOrderItemsStock(
    [{ productId: "p-split", quantity: 1 }],
    products,
    variants,
  );
  assert.equal(rSplitNoVariant.ok, false);
  assert.equal(rSplitNoVariant.items[0].status, "unavailable");

  // Раздельный учёт вариантов: доступный вариант в пределах остатка проходит
  const rSplitOk = evaluateOrderItemsStock(
    [{ productId: "p-split", variantId: "v-in", quantity: 4 }],
    products,
    variants,
  );
  assert.equal(rSplitOk.ok, true);
});
