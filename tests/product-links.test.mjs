import test from "node:test";
import assert from "node:assert/strict";

import {
  NEW_PRODUCT_LINK_TOKEN,
  applyProductLinkUpdate,
  collapseLinkedProductsForStorefront,
  enrichProductsWithLinks,
  normalizeProductLinkGroups,
  removeProductFromLinkGroups,
  resolveLinkedCardLabels,
  resolveLinkedGroupTitle,
} from "../src/lib/product-links.ts";

function makeProduct(overrides = {}) {
  return {
    id: "p1",
    name: "Короб 600×400×400 мм",
    slug: "korob-600-400-400",
    sku: "BOX-600",
    categoryId: "cat-boxes",
    description: "",
    price: 55,
    basePrice: 55,
    priceWholesale: 48,
    minWholesaleQty: 100,
    stockQty: 40,
    inStock: true,
    isVisible: true,
    isPromo: false,
    isFeatured: false,
    images: [],
    imageUrl: "/media/box-600.jpg",
    dimensionLength: 600,
    dimensionWidth: 400,
    dimensionHeight: 400,
    dimensionUnit: "мм",
    ...overrides,
  };
}

test("applyProductLinkUpdate links newly created product via NEW_PRODUCT_LINK_TOKEN to existing card", () => {
  const updated = applyProductLinkUpdate([], "p-new", {
    linkedProductIds: ["p-existing", NEW_PRODUCT_LINK_TOKEN],
    primaryProductId: "p-existing",
    labels: { [NEW_PRODUCT_LINK_TOKEN]: "Новинка XL" },
    groupTitle: "Размер",
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].primaryProductId, "p-existing");
  assert.deepEqual(updated[0].productIds, ["p-existing", "p-new"]);
  assert.equal(updated[0].labels["p-new"], "Новинка XL");
  assert.equal(updated[0].groupTitle, "Размер");
});

test("applyProductLinkUpdate promotes primary card first and dissolves 2-card group on detach", () => {
  const initial = applyProductLinkUpdate([], "p-a", {
    linkedProductIds: ["p-a", "p-b", "p-c"],
    primaryProductId: "p-b",
    labels: { "p-a": "Малый", "p-b": "Средний", "p-c": "Большой" },
  });

  assert.equal(initial.length, 1);
  // Главная карточка всегда стоит первой
  assert.equal(initial[0].primaryProductId, "p-b");
  assert.deepEqual(initial[0].productIds, ["p-b", "p-a", "p-c"]);

  // Удаляем главную карточку p-b — группа остаётся из p-a и p-c, главной становится p-a
  const afterRemovePrimary = removeProductFromLinkGroups(initial, "p-b");
  assert.equal(afterRemovePrimary.length, 1);
  assert.equal(afterRemovePrimary[0].primaryProductId, "p-a");
  assert.deepEqual(afterRemovePrimary[0].productIds, ["p-a", "p-c"]);

  // Отвязываем p-a через пустой список — из 2 карточек остаётся 1, связка распадается
  const afterDetach = applyProductLinkUpdate(afterRemovePrimary, "p-a", {
    linkedProductIds: [],
  });
  assert.deepEqual(afterDetach, []);
});

test("resolveLinkedCardLabels and resolveLinkedGroupTitle compute smart Ozon labels", () => {
  const sizeBoxes = [
    makeProduct({ id: "b1", name: "Короб Т-23", dimensionLength: 400, dimensionWidth: 300, dimensionHeight: 200 }),
    makeProduct({ id: "b2", name: "Короб Т-23", dimensionLength: 600, dimensionWidth: 400, dimensionHeight: 400 }),
  ];
  assert.equal(resolveLinkedGroupTitle(sizeBoxes), "Размер");
  assert.deepEqual(resolveLinkedCardLabels(sizeBoxes), {
    b1: "400×300×200 мм",
    b2: "600×400×400 мм",
  });

  const colorTapes = [
    makeProduct({
      id: "t1",
      name: "Скотч упаковочный 48 мм прозрачный",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
    }),
    makeProduct({
      id: "t2",
      name: "Скотч упаковочный 48 мм коричневый",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
    }),
  ];
  assert.equal(resolveLinkedGroupTitle(colorTapes), "Вариант");
  assert.deepEqual(resolveLinkedCardLabels(colorTapes), {
    t1: "Прозрачный",
    t2: "Коричневый",
  });
});

test("collapseLinkedProductsForStorefront collapses linked cards into one Ozon card and respects search/stock match", () => {
  const pMain = makeProduct({
    id: "p-main",
    name: "Короб Т-24 600×400×400",
    slug: "korob-600",
    price: 65,
    stockQty: 0,
    inStock: false,
    dimensionLength: 600,
    dimensionWidth: 400,
    dimensionHeight: 400,
  });
  const pSmall = makeProduct({
    id: "p-small",
    name: "Короб Т-24 400×300×300",
    slug: "korob-400",
    price: 42,
    stockQty: 120,
    inStock: true,
    dimensionLength: 400,
    dimensionWidth: 300,
    dimensionHeight: 300,
  });
  const pHidden = makeProduct({
    id: "p-hidden",
    name: "Короб Т-24 800×500×500",
    slug: "korob-800",
    price: 95,
    stockQty: 15,
    inStock: true,
    isVisible: false,
    dimensionLength: 800,
    dimensionWidth: 500,
    dimensionHeight: 500,
  });
  const pSolo = makeProduct({
    id: "p-solo",
    name: "Стрейч-плёнка 500 мм",
    slug: "stretch-500",
    price: 490,
    stockQty: 30,
  });

  const groups = normalizeProductLinkGroups([
    {
      id: "grp-boxes",
      primaryProductId: "p-main",
      productIds: ["p-main", "p-small", "p-hidden"],
      labels: {},
      groupTitle: null,
    },
  ]);

  const enrichedAll = enrichProductsWithLinks(
    [pMain, pSmall, pHidden, pSolo],
    groups,
  );
  const visible = enrichedAll.filter((p) => p.isVisible !== false);

  // Обычный каталог: связка схлопнута в 1 карточку во главе с p-main, скрытый вариант исключён
  const collapsedDefault = collapseLinkedProductsForStorefront(visible, visible);
  assert.equal(collapsedDefault.length, 2);
  assert.equal(collapsedDefault[0].id, "p-main");
  assert.equal(collapsedDefault[0].linkedGroupAnyInStock, true);
  assert.equal(collapsedDefault[0].linkedCards.length, 2);
  assert.deepEqual(
    collapsedDefault[0].linkedCards.map((c) => c.id),
    ["p-main", "p-small"],
  );
  assert.equal(collapsedDefault[1].id, "p-solo");

  // Фильтр «только в наличии» / поиск по второстепенному размеру:
  // на плитке сразу активен совпавший вариант p-small, но переключатель хранит всю связку!
  const inStockMatched = visible.filter((p) => (p.stockQty ?? 0) >= 1);
  const collapsedFiltered = collapseLinkedProductsForStorefront(
    inStockMatched,
    visible,
    { preferMatchedVariant: true },
  );
  assert.equal(collapsedFiltered.length, 2);
  assert.equal(collapsedFiltered[0].id, "p-small");
  assert.deepEqual(
    collapsedFiltered[0].linkedCards.map((c) => c.id),
    ["p-main", "p-small"],
  );
});
