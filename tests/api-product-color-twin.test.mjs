// =========================================================
// FILE: tests/api-product-color-twin.test.mjs
// Сквозной тест POST /api/admin/products с опцией createColorTwin:
// проверяет одновременное создание бурого + белого (и наоборот) товаров
// и их автоматическое объединение в одну связку карточек.
// Запуск: npm run test:color-twin-api
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";

const { POST } = await import("../src/app/api/admin/products/route.ts");
const { invalidateProductLinksCache } = await import(
  "../src/lib/product-links-store.ts"
);
const { STUB_DB, resetStubDb } = await import("./stubs/stub-supabase.ts");

function seedEmptyCatalog() {
  invalidateProductLinksCache();
  resetStubDb({
    products: [],
    product_link_groups: [],
    settings: [],
  });
}

test("POST /api/admin/products: «Лоток № 60 бурый» + Есть белый вариант создаёт и связывает 2 карточки", async () => {
  seedEmptyCatalog();

  const res = await POST(
    new Request("http://localhost/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Лоток № 60 бурый",
        sku: "Л-60-БР",
        price: 42,
        priceWholesale: 38,
        dimensionLength: 380,
        dimensionWidth: 285,
        dimensionHeight: 95,
        material: "Т-24 бурый",
        stockQty: 150,
        isVisible: true,
        createColorTwin: {
          enabled: true,
          twinPrice: 46,
        },
      }),
    }),
  );

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.id);
  assert.ok(data.twinId);
  assert.notEqual(data.id, data.twinId);
  assert.equal(data.twinName, "Лоток № 60 белый");

  assert.equal(STUB_DB.products.rows.length, 2);
  const brown = STUB_DB.products.rows.find((r) => r.id === data.id);
  const white = STUB_DB.products.rows.find((r) => r.id === data.twinId);
  assert.equal(brown.name, "Лоток № 60 бурый");
  assert.equal(brown.stock_qty, 150);
  assert.equal(white.name, "Лоток № 60 белый");
  assert.equal(white.sku, "Л-60-БЛ");
  assert.equal(white.material, "Т-24 белый");
  assert.equal(white.price, 46);
  assert.equal(white.stock_qty, 0);
  assert.notEqual(brown.slug, white.slug);

  // Проверяем, что обе карточки объединены в одну группу «Цвет» с подписями Бурый / Белый
  assert.equal(STUB_DB.product_link_groups.rows.length, 1);
  const grp = STUB_DB.product_link_groups.rows[0];
  assert.deepEqual(grp.product_ids, [data.id, data.twinId]);
  assert.equal(grp.group_title, "Цвет");
  assert.equal(grp.labels[data.id], "Бурый");
  assert.equal(grp.labels[data.twinId], "Белый");
});

test("POST /api/admin/products: «Лоток № 60 белый» + Есть бурый вариант создаёт связанную бурую карточку", async () => {
  seedEmptyCatalog();

  const res = await POST(
    new Request("http://localhost/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Лоток № 60 белый",
        price: 46,
        stockQty: 50,
        isVisible: true,
        createColorTwin: {
          enabled: true,
        },
      }),
    }),
  );

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.twinName, "Лоток № 60 бурый");

  const white = STUB_DB.products.rows.find((r) => r.id === data.id);
  const brown = STUB_DB.products.rows.find((r) => r.id === data.twinId);
  assert.equal(white.name, "Лоток № 60 белый");
  assert.equal(brown.name, "Лоток № 60 бурый");
  assert.equal(brown.price, 46);

  const grp = STUB_DB.product_link_groups.rows[0];
  assert.deepEqual(grp.product_ids, [data.id, data.twinId]);
  assert.equal(grp.labels[data.id], "Белый");
  assert.equal(grp.labels[data.twinId], "Бурый");
});
