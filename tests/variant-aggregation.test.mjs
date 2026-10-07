import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateVariants,
  enrichProductsWithVariants,
} from "../src/lib/variant-aggregation.ts";

function makeProduct(overrides = {}) {
  return {
    id: "product-1",
    name: "Тестовый товар",
    slug: "test-product",
    price: 14,
    inStock: true,
    stockQty: 12,
    isPromo: false,
    isVisible: true,
    isFeatured: false,
    ...overrides,
  };
}

function makeVariant(id, { price = null, stockQty = 0 } = {}) {
  return {
    id,
    productId: "product-1",
    name: id,
    optionType: "color",
    sortOrder: 0,
    price,
    priceWholesale: null,
    sku: null,
    stockQty,
    inStock: stockQty > 0,
    images: [],
    imageUrl: null,
    isVisible: true,
  };
}

test("variant summaries never mutate the cached product base price or stock", () => {
  const baseProduct = makeProduct();
  const variants = [makeVariant("red", { price: 5 })];

  const withVariants = enrichProductsWithVariants(
    [baseProduct],
    new Map([[baseProduct.id, variants]]),
  )[0];

  assert.equal(withVariants.price, 5, "catalog summary uses the variant minimum");
  assert.equal(withVariants.basePrice, 14, "base price is preserved for product details");
  assert.equal(withVariants.stockQty, 12, "unconfigured variant stock inherits the product stock");
  assert.equal(withVariants.inStock, true);
  assert.equal(baseProduct.price, 14, "the source cached object stays unchanged");
  assert.equal(baseProduct.stockQty, 12);

  const afterDeletingVariants = enrichProductsWithVariants([baseProduct], new Map())[0];
  assert.equal(afterDeletingVariants.price, 14, "deleting variants restores the base price");
  assert.equal(afterDeletingVariants.stockQty, 12);
  assert.equal(afterDeletingVariants.hasVariants, false);
});

test("all-zero variant stock inherits the parent, but explicit variant stock is summed", () => {
  const product = makeProduct();
  const unconfigured = aggregateVariants([makeVariant("red"), makeVariant("blue")], product);
  assert.equal(unconfigured.variantStockManaged, false);
  assert.equal(unconfigured.totalStock, 12);
  assert.equal(unconfigured.anyInStock, true);

  const priceRange = aggregateVariants(
    [makeVariant("red", { price: 5 }), makeVariant("blue")],
    product,
  );
  assert.equal(priceRange.priceMin, 5);
  assert.equal(priceRange.priceMax, 14, "an empty variant price inherits the parent price");

  const configured = aggregateVariants(
    [makeVariant("red", { stockQty: 3 }), makeVariant("blue")],
    product,
  );
  assert.equal(configured.variantStockManaged, true);
  assert.equal(configured.totalStock, 3);
  assert.equal(configured.anyInStock, true);
});

test("an out-of-stock parent stays unavailable when variant quantities are unconfigured", () => {
  const product = makeProduct({ stockQty: 0 });
  const summary = aggregateVariants([makeVariant("red")], product);
  assert.equal(summary.variantStockManaged, false);
  assert.equal(summary.totalStock, 0);
  assert.equal(summary.anyInStock, false);
});
