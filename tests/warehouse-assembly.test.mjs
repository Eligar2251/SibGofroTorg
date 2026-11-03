// =========================================================
// FILE: tests/warehouse-assembly.test.mjs
// Модульные тесты комплектации / разукомплектации номенклатуры (1С)
// и стандартной формулы цены коробки из листа:
//   цена_коробки = (цена_листа_из_последнего_прихода / коробок_с_листа) + 2 ₽
// Запуск: npm run test:assembly
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";

const {
  prepareAssemblyPlan,
  computeStandardBoxUnitCost,
  computeAssemblyStockDeltas,
  extractAssemblyPresets,
  summarizeProductAssemblies,
  normalizeWarehouseAssemblies,
  isSelfAssemblySupplierName,
} = await import("../src/lib/warehouse-assembly.ts");

function makeCatalog() {
  return new Map([
    [
      "sheet-t24",
      {
        id: "sheet-t24",
        name: "Гофролист Т-24 2000×1200",
        sku: "GL-2000-1200",
        stockQty: 500,
        purchasePrice: 49,
        price: 75,
      },
    ],
    [
      "insert-pad",
      {
        id: "insert-pad",
        name: "Вкладыш картонный",
        sku: "VK-01",
        stockQty: 300,
        purchasePrice: 6,
        price: 12,
      },
    ],
    [
      "box-600",
      {
        id: "box-600",
        name: "Коробка 600×400×400 Т-24",
        sku: "KB-600",
        stockQty: 20,
        purchasePrice: 30,
        price: 55,
      },
    ],
    [
      "box-300",
      {
        id: "box-300",
        name: "Коробка 300×200×200 Т-24",
        sku: "KB-300",
        stockQty: 0,
        purchasePrice: null,
        price: 25,
      },
    ],
  ]);
}

test("computeStandardBoxUnitCost и isSelfAssemblySupplierName: стандартная формула +2 ₽", () => {
  // Лист 36 ₽, с 1 листа получается 3 коробки → 36 / 3 + 2 = 14 ₽
  assert.equal(
    computeStandardBoxUnitCost({ sheetPrice: 36, boxesPerSheet: 3 }),
    14
  );
  // Лист 49 ₽, с 1 листа 2 коробки → 49 / 2 + 2 = 26,5 ₽
  assert.equal(
    computeStandardBoxUnitCost({ sheetPrice: 49, boxesPerSheet: 2 }),
    26.5
  );
  assert.equal(isSelfAssemblySupplierName("СибГофроТорг"), true);
  assert.equal(isSelfAssemblySupplierName("ООО «СибГофроТорг»"), true);
  assert.equal(isSelfAssemblySupplierName("ООО «ГофроПак»"), false);
});

test("prepareAssemblyPlan: берёт цену листа с последнего прихода поставщика и считает (цена_листа / выход) + 2 ₽", () => {
  // В карточке листа устаревшая цена 49 ₽, но в последнем приходе ПО-142 цена листа = 36 ₽.
  // С 100 листов получается 300 коробок (3 коробки с 1 листа):
  // 36 / 3 + 2 = 14 ₽/шт., сумма прихода = 4200 ₽.
  const plan = prepareAssemblyPlan({
    kind: "assembly",
    date: "2026-10-30",
    spent: [{ productId: "sheet-t24", quantity: 100 }],
    produced: [{ productId: "box-600", quantity: 300 }],
    productsById: makeCatalog(),
    latestSupplierPrices: {
      "sheet-t24": {
        productId: "sheet-t24",
        price: 36,
        receiptNumber: 142,
        supplier: "ООО «ГофроПак»",
        source: "receipt",
      },
    },
    updatePurchasePrice: true,
    comment: "Раскрой партии под склад",
  });

  assert.equal(plan.totalCost, 3600);
  assert.equal(plan.boxesPerSheet, 3);
  assert.equal(plan.spentItems[0].unitCost, 36);
  assert.equal(plan.spentItems[0].sourceReceiptNumber, 142);
  assert.equal(plan.producedItems[0].unitCost, 14);
  assert.equal(plan.producedItems[0].lineCost, 4200);
  assert.equal(plan.producedItems[0].isManualPrice, false);
  assert.equal(plan.producedTotalCost, 4200);
  assert.equal(plan.producedItems[0].previousPurchasePrice, 30);
});

test("prepareAssemblyPlan: позволяет пользователю вручную задать свою цену прихода вместо автоформулы", () => {
  const plan = prepareAssemblyPlan({
    kind: "assembly",
    date: "2026-10-30",
    spent: [{ productId: "sheet-t24", quantity: 100 }],
    produced: [{ productId: "box-600", quantity: 200, unitPrice: 29.9 }],
    productsById: makeCatalog(),
  });

  assert.equal(plan.producedItems[0].unitCost, 29.9);
  assert.equal(plan.producedItems[0].lineCost, 5980);
  assert.equal(plan.producedItems[0].isManualPrice, true);
});

test("prepareAssemblyPlan: запрещает комплектовать товар сам в себя", () => {
  assert.throws(
    () =>
      prepareAssemblyPlan({
        spent: [{ productId: "sheet-t24", quantity: 10 }],
        produced: [{ productId: "sheet-t24", quantity: 20 }],
        productsById: makeCatalog(),
      }),
    /Исходный и получаемый товар должны отличаться/
  );
});

test("prepareAssemblyPlan: блокирует нехватку остатка по умолчанию и разрешает при allowNegativeStock", () => {
  assert.throws(
    () =>
      prepareAssemblyPlan({
        spent: [{ productId: "sheet-t24", quantity: 600 }],
        produced: [{ productId: "box-600", quantity: 1200 }],
        productsById: makeCatalog(),
      }),
    /Недостаточно остатка «Гофролист Т-24 2000×1200»: на складе 500 шт\., требуется 600 шт\./
  );

  const allowed = prepareAssemblyPlan({
    spent: [{ productId: "sheet-t24", quantity: 600 }],
    produced: [{ productId: "box-600", quantity: 1200 }],
    productsById: makeCatalog(),
    allowNegativeStock: true,
  });
  assert.equal(allowed.spentItems[0].quantity, 600);
});

test("prepareAssemblyPlan: многокомпонентная сборка (2 исходных → 1 комплект) и раскрой на 2 позиции", () => {
  const kitPlan = prepareAssemblyPlan({
    spent: [
      { productId: "sheet-t24", quantity: 50 }, // 50 * 49 = 2450
      { productId: "insert-pad", quantity: 100 }, // 100 * 6 = 600
    ],
    produced: [{ productId: "box-600", quantity: 100 }],
    productsById: makeCatalog(),
  });
  assert.equal(kitPlan.totalCost, 3050);
  // 3050 / 100 + 2 = 32,5 ₽/шт.
  assert.equal(kitPlan.producedItems[0].unitCost, 32.5);

  const splitPlan = prepareAssemblyPlan({
    spent: [{ productId: "sheet-t24", quantity: 100 }],
    produced: [
      { productId: "box-600", quantity: 100 },
      { productId: "box-300", quantity: 120 },
    ],
    surchargeRub: 0,
    productsById: makeCatalog(),
  });
  const allocated =
    splitPlan.producedItems[0].lineCost + splitPlan.producedItems[1].lineCost;
  assert.equal(Math.round(allocated * 100) / 100, 4900);
});

test("computeAssemblyStockDeltas: сторно (direction = -1) и spentOnly", () => {
  const doc = {
    spentItems: [
      {
        productId: "sheet-t24",
        name: "Лист",
        sku: null,
        quantity: 80,
        unitCost: 49,
        lineCost: 3920,
      },
    ],
    producedItems: [
      {
        productId: "box-600",
        name: "Коробка",
        sku: null,
        quantity: 160,
        unitCost: 26.5,
        lineCost: 4240,
      },
    ],
  };
  assert.deepEqual(computeAssemblyStockDeltas(doc, 1), [
    { productId: "sheet-t24", delta: -80 },
    { productId: "box-600", delta: 160 },
  ]);
  assert.deepEqual(computeAssemblyStockDeltas(doc, -1), [
    { productId: "sheet-t24", delta: 80 },
    { productId: "box-600", delta: -160 },
  ]);
  assert.deepEqual(computeAssemblyStockDeltas(doc, -1, { spentOnly: true }), [
    { productId: "sheet-t24", delta: 80 },
  ]);
});

test("summarizeProductAssemblies: не удваивает остаток при наличии связанной поставки ПО-… от СибГофроТорг", () => {
  const docs = normalizeWarehouseAssemblies([
    {
      id: "asm-1",
      number: 1,
      date: "2026-10-30",
      status: "posted",
      kind: "assembly",
      linkedReceiptId: "rec-sgt-10",
      linkedReceiptNumber: 10,
      spentItems: [
        {
          productId: "sheet-t24",
          name: "Гофролист Т-24",
          sku: "GL",
          quantity: 100,
          unitCost: 36,
          lineCost: 3600,
        },
      ],
      producedItems: [
        {
          productId: "box-600",
          name: "Коробка 600",
          sku: "KB",
          quantity: 300,
          unitCost: 14,
          lineCost: 4200,
        },
      ],
    },
  ]);

  const presets = extractAssemblyPresets(docs);
  assert.equal(presets.length, 1);
  assert.equal(presets[0].ratio, 3);

  const sheetMoves = summarizeProductAssemblies(docs, "sheet-t24");
  assert.equal(sheetMoves.assembledOutQty, 100);
  assert.equal(sheetMoves.netQty, -100);

  const boxMoves = summarizeProductAssemblies(docs, "box-600");
  // Информативно показываем +300 шт., но netQty = 0, т.к. +300 уже в postedReceiptQty по ПО-10!
  assert.equal(boxMoves.assembledInQty, 300);
  assert.equal(boxMoves.netQty, 0);

  // Проверка формулы ownStockQty: на складе 300, продано 0, приход по ПО-10 = 300, netQty = 0 → расхождение 0!
  const ownBoxes = 300 + 0 - 300 - boxMoves.netQty;
  assert.equal(ownBoxes, 0);
});
