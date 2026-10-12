// =========================================================
// FILE: tests/pallet.test.mjs
// Тесты кратности коробок паллете 1200×800 (src/lib/pallet.ts).
// =========================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  fitsPallet,
  isPalletBox,
  isPalletShippingBox,
  palletLayout,
  palletCells,
  footprintRank,
  formatPalletFootprint,
  PALLET_FRIENDLY_MM,
} from "@/lib/pallet";

test("габариты, кратные паллете 1200×800, проходят проверку", () => {
  for (const mm of PALLET_FRIENDLY_MM) {
    assert.equal(fitsPallet(mm), true, `${mm} мм должен проходить`);
  }
});

test("габариты, не делящие паллету, отсеиваются", () => {
  for (const mm of [130, 150, 230, 250, 285, 350, 500, 700, 900, 1000]) {
    assert.equal(fitsPallet(mm), false, `${mm} мм не должен проходить`);
  }
});

test("пустые и невозможные значения не считаются паллетными", () => {
  assert.equal(fitsPallet(null), false);
  assert.equal(fitsPallet(undefined), false);
  assert.equal(fitsPallet(0), false);
  assert.equal(fitsPallet(-600), false);
  assert.equal(fitsPallet(1500), false, "больше длинной стороны паллеты");
  assert.equal(fitsPallet(50), false, "мельче минимального габарита коробки");
});

test("коробка паллетная, только если ВСЕ габариты кратны паллете", () => {
  assert.equal(
    isPalletBox({ dimensionLength: 600, dimensionWidth: 400, dimensionHeight: 400 }),
    true,
    "600×400×400 — эталон WB (Ящик № 670)"
  );
  assert.equal(
    isPalletBox({ dimensionLength: 800, dimensionWidth: 600, dimensionHeight: 600 }),
    true,
    "800×600×600 — тоже кратен паллете"
  );
  assert.equal(
    isPalletBox({ dimensionLength: 600, dimensionWidth: 300, dimensionHeight: 230 }),
    false,
    "высота 230 мм не делит ни 1200, ни 800"
  );
  assert.equal(
    isPalletBox({ dimensionLength: 800, dimensionWidth: 400, dimensionHeight: 500 }),
    false,
    "высота 500 мм — не паллетная"
  );
  assert.equal(
    isPalletBox({ dimensionLength: 600, dimensionWidth: 400, dimensionHeight: 285 }),
    false,
    "высота 285 мм — не паллетная"
  );
  assert.equal(
    isPalletBox({ dimensionLength: 600, dimensionWidth: 400, dimensionHeight: null }),
    false,
    "без высоты размер не подтверждён — не показываем"
  );
  assert.equal(isPalletBox(null), false);
});

test("раскладка слоя: 600×400 — 4 короба без остатка", () => {
  const layout = palletLayout(600, 400);
  assert.equal(layout.perLayer, 4);
  assert.equal(layout.full, true);
  assert.equal(layout.acrossMm, 600);
  assert.equal(layout.alongMm, 400);
  assert.equal(layout.leftoverMm, 0);
});

test("раскладка слоя: 400×300 разворачивается и даёт 8 коробов", () => {
  const layout = palletLayout(400, 300);
  assert.equal(layout.perLayer, 8, "4 короба вдоль 1200 × 2 вдоль 800");
  assert.equal(layout.full, true);
  assert.equal(layout.acrossMm, 300, "на паллету короб ложится стороной 300");
  assert.equal(layout.alongMm, 400);
});

test("раскладка слоя: 600×300 — 4 короба и полоса 200 мм", () => {
  const layout = palletLayout(600, 300);
  assert.equal(layout.perLayer, 4);
  assert.equal(layout.full, false);
  assert.equal(layout.leftoverMm, 200);
});

test("раскладка слоя: 800×600 — 2 короба, 1200×800 — 1 короб", () => {
  assert.equal(palletLayout(800, 600).perLayer, 2);
  assert.equal(palletLayout(800, 600).full, true);
  assert.equal(palletLayout(1200, 800).perLayer, 1);
  assert.equal(palletLayout(1200, 800).full, true);
  assert.equal(palletLayout(600, 200).perLayer, 8);
  assert.equal(palletLayout(200, 300).perLayer, 16);
});

test("короб больше паллеты раскладки не имеет", () => {
  assert.equal(palletLayout(1500, 400), null);
  assert.equal(palletLayout(null, 400), null);
  assert.equal(palletCells(1500, 400), null);
});

test("координаты коробов на схеме в реальных пропорциях", () => {
  const result = palletCells(600, 400);
  assert.ok(result);
  assert.equal(result.cells.length, 4);
  assert.deepEqual(result.cells[0], { left: 0, top: 0, width: 50, height: 50 });
  assert.deepEqual(result.cells[1], { left: 50, top: 0, width: 50, height: 50 });
  assert.deepEqual(result.cells[2], { left: 0, top: 50, width: 50, height: 50 });
  // 600×300: слой закрыт не полностью — короба не растягиваются на всю схему
  const partial = palletCells(600, 300);
  assert.equal(partial.cells.length, 4);
  assert.equal(partial.cells[0].height, 37.5);
});

test("ходовые размеры идут первыми в подборке", () => {
  assert.ok(footprintRank(600, 400) < footprintRank(400, 300));
  assert.ok(footprintRank(800, 600) < footprintRank(200, 200));
  assert.equal(footprintRank(600, 400), footprintRank(400, 600), "порядок сторон не важен");
  assert.ok(footprintRank(null, 400) >= 8);
});

test("подпись размера — как в карточках каталога", () => {
  assert.equal(formatPalletFootprint(600, 400), "600×400");
});

test("мелкие короба не считаем паллетной отгрузочной тарой", () => {
  assert.equal(
    isPalletShippingBox({ dimensionLength: 100, dimensionWidth: 100, dimensionHeight: 100 }),
    false,
    "100×100×100 — вложение, а не тара для отгрузки"
  );
  assert.equal(
    isPalletShippingBox({ dimensionLength: 200, dimensionWidth: 200, dimensionHeight: 200 }),
    false
  );
  assert.equal(
    isPalletShippingBox({ dimensionLength: 300, dimensionWidth: 200, dimensionHeight: 200 }),
    true
  );
  assert.equal(
    isPalletShippingBox({ dimensionLength: 600, dimensionWidth: 400, dimensionHeight: 400 }),
    true
  );
  assert.equal(
    isPalletShippingBox({ dimensionLength: 600, dimensionWidth: 400, dimensionHeight: 285 }),
    false,
    "габарит не кратен паллете — не отгрузочная тара"
  );
});
