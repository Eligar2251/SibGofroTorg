// =========================================================
// FILE: tests/api-bulk-prices.test.mjs
// Сквозной тест массового сохранения цен:
//   POST /api/admin/products/prices/bulk
// Вызывается НАСТОЯЩИЙ обработчик из route.ts; админ-сессия, Supabase и
// кеш Next подменены двойниками (tests/stubs/*), сеть не используется.
//
// Что проверяем (это же обещано в интерфейсе):
//   • меняет только те поля, что пришли: цена — всегда, закупка — только
//     если передана, скидка снимается только по флагу;
//   • отчёт по строкам: сколько сохранили и что именно не удалось;
//   • мусорные данные отклоняются целиком, до записи в базу;
//   • база без миграции purchase_price не мешает сохранить цены;
//   • каждое сохранение попадает в журнал действий админки.
// Запуск: npm run test:prices
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";

const { POST } = await import("../src/app/api/admin/products/prices/bulk/route.ts");
const { resetStubDb, STUB_DB, STUB_UPDATES, STUB_INSERTS, STUB_FAIL_ON_COLUMNS } =
  await import("./stubs/stub-supabase.ts");
const { REVALIDATED_TAGS, __setRevalidateThrows } = await import("./stubs/next-cache-stub.ts");

function product(overrides = {}) {
  return {
    id: "p-1",
    name: "Гофрокороб 400×300×200",
    price: 100,
    purchase_price: 60,
    discount_type: null,
    discount_value: null,
    ...overrides,
  };
}

function seed(products = [product()]) {
  resetStubDb({ products });
}

function post(body) {
  return POST(
    new Request("http://localhost/api/admin/products/prices/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function rowById(id) {
  return STUB_DB.products.rows.find((row) => row.id === id);
}

test("цена сохраняется, закупка и скидка не трогаются, если не переданы", async () => {
  seed([product({ id: "p-1", price: 100, purchase_price: 60, discount_type: "percent", discount_value: 5 })]);
  const res = await post({ rows: [{ id: "p-1", price: 89 }] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.updated, 1);
  assert.equal(body.purchaseUpdated, 0);

  const saved = rowById("p-1");
  assert.equal(saved.price, 89);
  assert.equal(saved.purchase_price, 60, "закупка не должна меняться без явной передачи");
  assert.equal(saved.discount_type, "percent", "скидка снимается только по флагу");
  assert.ok(saved.updated_at, "проставляем updated_at");

  const payload = STUB_UPDATES.at(-1).values;
  assert.ok(!("purchase_price" in payload));
  assert.ok(!("discount_type" in payload));
});

test("закупочная цена сохраняется, когда она реально изменилась", async () => {
  seed([product({ id: "p-1", purchase_price: 60 })]);
  const res = await post({ rows: [{ id: "p-1", price: 130, purchasePrice: 100 }] });
  const body = await res.json();
  assert.equal(body.updated, 1);
  assert.equal(body.purchaseUpdated, 1);
  assert.equal(rowById("p-1").purchase_price, 100);
});

test("скидка снимается по флагу clearDiscount", async () => {
  seed([product({ discount_type: "percent", discount_value: 10 })]);
  const res = await post({ rows: [{ id: "p-1", price: 100, clearDiscount: true }] });
  const body = await res.json();
  assert.equal(body.discountsCleared, 1);
  assert.equal(rowById("p-1").discount_type, null);
  assert.equal(rowById("p-1").discount_value, null);
});

test("массовое понижение: одна цена проставляется списку товаров", async () => {
  seed([
    product({ id: "p-1", price: 500 }),
    product({ id: "p-2", price: 700 }),
    product({ id: "p-3", price: 900 }),
  ]);
  const res = await post({
    rows: [
      { id: "p-1", price: 450 },
      { id: "p-2", price: 450 },
      { id: "p-3", price: 450 },
    ],
  });
  const body = await res.json();
  assert.equal(body.updated, 3);
  assert.deepEqual(
    STUB_DB.products.rows.map((row) => row.price),
    [450, 450, 450]
  );
});

test("автоматические цены: каждой строке своя цена из наценки", async () => {
  seed([
    product({ id: "p-1", price: 100, purchase_price: 100 }),
    product({ id: "p-2", price: 100, purchase_price: 250 }),
  ]);
  const res = await post({
    rows: [
      { id: "p-1", price: 140 },
      { id: "p-2", price: 350 },
    ],
  });
  const body = await res.json();
  assert.equal(body.updated, 2);
  assert.equal(rowById("p-1").price, 140);
  assert.equal(rowById("p-2").price, 350);
});

test("пустой список — 400 и никаких записей", async () => {
  seed();
  const res = await post({ rows: [] });
  assert.equal(res.status, 400);
  assert.equal(STUB_UPDATES.length, 0);
});

test("мусорные данные отклоняются целиком, до первой записи в базу", async () => {
  seed([product({ id: "p-1" }), product({ id: "p-2" })]);
  const cases = [
    { rows: [{ id: "p-1" }], note: "нет цены" },
    { rows: [{ id: "p-1", price: "дорого" }], note: "цена не число" },
    { rows: [{ id: "p-1", price: -5 }], note: "отрицательная цена" },
    { rows: [{ price: 100 }], note: "нет товара" },
    { rows: [{ id: "p-1", price: 100, purchasePrice: -1 }], note: "отрицательная закупка" },
  ];
  for (const item of cases) {
    resetStubDb({ products: [product({ id: "p-1" }), product({ id: "p-2" })] });
    const res = await post({ rows: item.rows });
    assert.equal(res.status, 400, item.note);
    assert.equal(STUB_UPDATES.length, 0, `${item.note}: не должно быть записей в базу`);
  }
  assert.ok(cases.length > 0);
});

test("слишком большой список за один раз — 413 с понятным текстом", async () => {
  seed();
  const rows = Array.from({ length: 2001 }, (_, i) => ({ id: `p-${i}`, price: 100 }));
  const res = await post({ rows });
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.match(body.error, /2000/);
  assert.equal(STUB_UPDATES.length, 0);
});

test("база без колонки purchase_price: цена всё равно сохраняется", async () => {
  seed([product({ id: "p-1", purchase_price: 60 })]);
  STUB_FAIL_ON_COLUMNS.push("purchase_price");
  const res = await post({ rows: [{ id: "p-1", price: 120, purchasePrice: 80 }] });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.updated, 1);
  assert.equal(rowById("p-1").price, 120);
  assert.equal(rowById("p-1").purchase_price, 60, "на базе без миграции закупка остаётся прежней");
});

test("неизвестный товар: ошибка строки не срывает сохранение остальных", async () => {
  seed([
    product({ id: "p-1" }),
    // p-2 намеренно отсутствует в «базе»: update не найдёт ни строки.
  ]);
  const res = await post({
    rows: [
      { id: "p-1", price: 111 },
      { id: "p-2", price: 222 },
    ],
  });
  const body = await res.json();
  assert.equal(body.updated, 1);
  assert.equal(rowById("p-1").price, 111);
});

test("сохранение попадает в журнал действий админки и сбрасывает кеш товаров", async () => {
  seed([product({ id: "p-1" })]);
  REVALIDATED_TAGS.length = 0;
  await post({ rows: [{ id: "p-1", price: 77 }] });
  assert.ok(REVALIDATED_TAGS.includes("products"), "кеш товаров должен сбрасываться");

  const logEntry = STUB_INSERTS.find((entry) => entry.table === "activity_logs");
  assert.ok(logEntry, "должна быть запись в журнале действий");
  assert.equal(logEntry.values.action, "bulk_update");
  assert.equal(logEntry.values.entity_type, "product");
  assert.match(String(logEntry.values.details.rows), /1/);
  assert.equal(logEntry.values.details.updated, 1);
  // Кто и что поставил: в деталях есть цены строк.
  assert.deepEqual(logEntry.values.details.sample, [{ id: "p-1", price: 77, purchasePrice: undefined }]);
  assert.equal(logEntry.values.admin_name, "Владелец");
});

test("если сброс кеша падает, цены всё равно сохранены и ответ успешный", async () => {
  seed([product({ id: "p-1", price: 100 })]);
  __setRevalidateThrows(true);
  try {
    const res = await post({ rows: [{ id: "p-1", price: 55 }] });
    assert.equal(res.status, 200);
    assert.equal(rowById("p-1").price, 55);
  } finally {
    __setRevalidateThrows(false);
  }
});

test("товар удалили в другой вкладке: строка помечается как не найденная", async () => {
  seed([product({ id: "p-1" }), product({ id: "p-2" })]);
  const res = await post({
    rows: [
      { id: "p-1", price: 150 },
      { id: "p-9", price: 250 },
    ],
  });
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.updated, 1);
  assert.equal(body.failed.length, 1);
  assert.equal(body.failed[0].id, "p-9");
  assert.match(body.failed[0].error, /не найден/);
});
