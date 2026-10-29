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
  assert.equal(getAvailableStockQty({ stockQty: null, inStock: true }), 0);
  assert.equal(isProductAvailable({ stockQty: null, inStock: true }), false);
  assert.equal(isOutOfStock({ stockQty: null, inStock: true }), true);

  assert.equal(getAvailableStockQty({ stockQty: 0, inStock: true }), 0);
  assert.equal(isProductAvailable({ stockQty: 0, inStock: true }), false);
  assert.equal(getAvailableStockQty({ stockQty: -4, inStock: true }), 0);
  assert.equal(isProductAvailable({ stockQty: -4, inStock: true }), false);

  assert.equal(getAvailableStockQty({ stockQty: 0.5, inStock: true }), 0);
  assert.equal(isProductAvailable({ stockQty: 0.5, inStock: true }), false);

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

  const rZero = evaluateOrderItemsStock([{ productId: "p-zero", quantity: 1 }], products);
  assert.equal(rZero.ok, false);
  assert.equal(rZero.items[0].status, "out_of_stock");
  assert.equal(rZero.items[0].availableQty, 0);

  const rNull = evaluateOrderItemsStock([{ productId: "p-null", quantity: 1 }], products);
  assert.equal(rNull.ok, false);
  assert.equal(rNull.items[0].status, "out_of_stock");

  const rMto = evaluateOrderItemsStock([{ productId: "p-mto", quantity: 1 }], products);
  assert.equal(rMto.ok, false);
  assert.equal(rMto.items[0].status, "made_to_order");

  const rHidden = evaluateOrderItemsStock([{ productId: "p-hidden", quantity: 1 }], products);
  assert.equal(rHidden.ok, false);
  assert.equal(rHidden.items[0].status, "unavailable");

  const rMissing = evaluateOrderItemsStock(
    [{ productId: "p-missing", name: "Удалённый товар", quantity: 1 }],
    products,
  );
  assert.equal(rMissing.ok, false);
  assert.equal(rMissing.items[0].status, "unavailable");
});

test("evaluateOrderItemsStock enforces independent stock limits for each linked product card", () => {
  const products = new Map([
    ["p-main", { id: "p-main", name: "Короб 600×400×400", stockQty: 10, isVisible: true, madeToOrder: false }],
    ["p-sibling-out", { id: "p-sibling-out", name: "Короб 400×300×300", stockQty: 0, isVisible: true, madeToOrder: false }],
  ]);

  const rTooMany = evaluateOrderItemsStock([{ productId: "p-main", quantity: 11 }], products);
  assert.equal(rTooMany.ok, false);
  assert.equal(rTooMany.items[0].status, "insufficient_stock");
  assert.equal(rTooMany.items[0].availableQty, 10);

  const rExact = evaluateOrderItemsStock([{ productId: "p-main", quantity: 10 }], products);
  assert.equal(rExact.ok, true);

  // Дублирующиеся строки одного товара суммируются против его остатка
  const rSplitLinesOver = evaluateOrderItemsStock(
    [
      { productId: "p-main", quantity: 6 },
      { productId: "p-main", quantity: 5 },
    ],
    products,
  );
  assert.equal(rSplitLinesOver.ok, false);
  assert.equal(rSplitLinesOver.items[0].status, "insufficient_stock");

  // Связанная карточка с остатком 0 блокируется даже при наличии остатка у главной карточки
  const rSiblingZero = evaluateOrderItemsStock(
    [{ productId: "p-sibling-out", quantity: 1 }],
    products,
  );
  assert.equal(rSiblingZero.ok, false);
  assert.equal(rSiblingZero.items[0].status, "out_of_stock");
});
