// =========================================================
// FILE: tests/api-product-services.test.mjs
// Сквозная проверка формата «услуга» на настоящих API-роутах склада:
//   • поставка с услугой — деньги есть, склад не меняется;
//   • заказ с услугой — отгружается товар, услуга проходит мимо склада;
//   • ручная правка остатка и инвентаризация услуг не трогают;
//   • быстрое создание позиции из окна документа (черновик карточки).
// Запуск: npm run test:services
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";

const { POST: createReceiptReq } = await import(
  "../src/app/api/admin/warehouse/receipts/route.ts"
);
const { PATCH: patchReceiptReq } = await import(
  "../src/app/api/admin/warehouse/receipts/[id]/route.ts"
);
const { POST: createDealReq } = await import(
  "../src/app/api/admin/warehouse/deals/route.ts"
);
const { PATCH: patchDealReq } = await import(
  "../src/app/api/admin/warehouse/deals/[id]/route.ts"
);
const { POST: quickCreateReq } = await import(
  "../src/app/api/admin/products/quick/route.ts"
);
const { setWarehouseStock, applyStockRevision } = await import(
  "../src/lib/warehouse.ts"
);
const { STUB_DB, resetStubDb, STUB_FAIL_ON_COLUMNS } = await import(
  "./stubs/stub-supabase.ts"
);

const TODAY = "2026-11-13";

function seed() {
  resetStubDb({
    products: [
      {
        id: "p-box",
        name: "Коробка 400×300×200",
        sku: "KB-400",
        slug: "korobka-400",
        price: 120,
        price_wholesale: 90,
        purchase_price: 60,
        stock_qty: 10,
        in_stock: true,
        is_visible: true,
        is_service: false,
      },
      {
        id: "p-cut",
        name: "Резка в размер",
        sku: null,
        slug: "rezka-v-razmer",
        price: 50,
        price_wholesale: null,
        purchase_price: null,
        stock_qty: 0,
        in_stock: false,
        is_visible: false,
        is_service: true,
      },
    ],
    warehouse_receipts: [],
    customer_deals: [],
    bank_payments: [],
    counterparties: [],
    supplier_prices: [],
    doc_counters: [
      { key: "receipt", value: 1 },
      { key: "deal", value: 1 },
    ],
    transports: [],
    warehouse_assemblies: [],
    settings: [],
    activity_logs: [],
    admin_events: [],
  });
}

function row(productId) {
  return STUB_DB.products.rows.find((r) => r.id === productId);
}

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mustJson(res) {
  const data = await res.json().catch(() => null);
  if (res.status !== 200) {
    throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

test("поставка: услуга участвует в сумме, но на склад по ней ничего не приходует", async () => {
  seed();

  const created = await mustJson(
    await createReceiptReq(
      jsonRequest("http://localhost/api/admin/warehouse/receipts", {
        date: TODAY,
        supplier: "ООО «ГофроПак»",
        noPayment: true,
        items: [
          { productId: "p-box", name: "Коробка 400×300×200", quantity: 5, lineTotal: 300 },
          { productId: "p-cut", name: "Резка в размер", quantity: 3, lineTotal: 150 },
        ],
      })
    )
  );
  assert.ok(created.id, "поставка должна создаться");

  const receipt = row0(created.id);
  assert.equal(Number(receipt.total), 450, "сумма поставки включает услугу");
  assert.equal(receipt.status, "draft");

  await mustJson(
    await patchReceiptReq(
      new Request(`http://localhost/api/admin/warehouse/receipts/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post" }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    )
  );

  assert.equal(Number(row("p-box").stock_qty), 15, "коробок стало 10 + 5");
  assert.equal(Number(row("p-cut").stock_qty), 0, "услуга на склад не встала");
  assert.equal(Boolean(row("p-cut").in_stock), false, "и «в наличии» у услуги не загорается");
});

function row0(id) {
  return STUB_DB.warehouse_receipts.rows.find((r) => r.id === id);
}

test("заказ: услуга проходит мимо склада, резерв и дефицит по ней не считается", async () => {
  seed();

  const created = await mustJson(
    await createDealReq(
      jsonRequest("http://localhost/api/admin/warehouse/deals", {
        date: TODAY,
        customerName: "ИП Петров",
        isReserved: true,
        items: [
          { productId: "p-box", name: "Коробка 400×300×200", quantity: 4, lineTotal: 480 },
          { productId: "p-cut", name: "Резка в размер", quantity: 4, lineTotal: 200 },
        ],
      })
    )
  );
  const deal = STUB_DB.customer_deals.rows.find((r) => r.id === created.id);
  assert.equal(Number(deal.total), 680, "итог заказа включает услугу");

  await mustJson(
    await patchDealReq(
      new Request(`http://localhost/api/admin/warehouse/deals/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post" }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    )
  );

  assert.equal(Number(row("p-box").stock_qty), 6, "коробок: 10 − 4");
  assert.equal(Number(row("p-cut").stock_qty), 0, "услуга склад не сдвинула (ни в минус, ни в плюс)");
});

test("отмена заказа возвращает на склад только товар", async () => {
  seed();
  const created = await mustJson(
    await createDealReq(
      jsonRequest("http://localhost/api/admin/warehouse/deals", {
        date: TODAY,
        customerName: "ИП Сидоров",
        items: [
          { productId: "p-box", name: "Коробка", quantity: 2, lineTotal: 240 },
          { productId: "p-cut", name: "Резка", quantity: 2, lineTotal: 100 },
        ],
      })
    )
  );
  const id = created.id;
  const patch = async (body) =>
    await mustJson(
      await patchDealReq(
        new Request(`http://localhost/api/admin/warehouse/deals/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) }
      )
    );

  await patch({ action: "post" });
  assert.equal(Number(row("p-box").stock_qty), 8);
  await patch({ action: "cancel", reason: "ошибка менеджера" });
  assert.equal(Number(row("p-box").stock_qty), 10, "возврат только по товару");
  assert.equal(Number(row("p-cut").stock_qty), 0, "услугу «возвращать» некуда");
});

test("массовый редактор цен: остаток услуги не пишет, цену — пишет", async () => {
  seed();
  const { PUT: bulkPut } = await import("../src/app/api/admin/products/bulk/route.ts");

  const res = await bulkPut(
    new Request("http://localhost/api/admin/products/bulk", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        products: [
          { id: "p-box", stockQty: 42, price: 125 },
          { id: "p-cut", stockQty: 77, price: 65 },
        ],
      }),
    })
  );
  assert.equal(res.status, 200, JSON.stringify(await res.json().catch(() => null)));
  assert.equal(Number(row("p-box").stock_qty), 42, "товар — остаток обновлён");
  assert.equal(Number(row("p-box").price), 125);
  assert.equal(Number(row("p-cut").stock_qty), 0, "услуга: остаток не трогаем");
  assert.equal(Boolean(row("p-cut").in_stock), false, "и «в наличии» у услуги не загорается");
  assert.equal(Number(row("p-cut").price), 65, "цену услуги править можно");
});

test("ручная правка остатка и инвентаризация услуг не касаются", async () => {
  seed();

  await assert.rejects(
    () => setWarehouseStock("p-cut", 25),
    /Услуга не имеет склада/,
    "ручной остаток по услуге невозможен"
  );
  assert.equal(Number(row("p-cut").stock_qty), 0);

  const revision = await applyStockRevision([
    { productId: "p-box", name: "Коробка", accountedQty: 10, actualQty: 9 },
    { productId: "p-cut", name: "Резка", accountedQty: 0, actualQty: 100 },
  ]);
  assert.equal(revision.updated, 1, "пересчитан только товар");
  assert.deepEqual(revision.changes.map((c) => c.productId), ["p-box"]);
  assert.equal(Number(row("p-box").stock_qty), 9);
  assert.equal(Number(row("p-cut").stock_qty), 0, "услуга в инвентаризации пропущена");
});

test("быстрое создание позиции: черновик карточки, дубли по названию не плодим", async () => {
  seed();

  const created = await mustJson(
    await quickCreateReq(
      jsonRequest("http://localhost/api/admin/products/quick", {
        name: "  Доставка   по городу ",
        price: "350,50",
        quantity: 2,
        isService: true,
      })
    )
  );
  assert.equal(created.reused, false);
  assert.equal(created.isService, true);
  assert.equal(created.stockQty, 0);
  assert.equal(created.name, "Доставка по городу");

  const products = STUB_DB.products.rows;
  const stored = products.find((r) => r.id === created.id);
  assert.equal(stored.is_service, true);
  assert.equal(stored.is_visible, false, "черновик не публикуется на сайт");
  assert.equal(Number(stored.stock_qty), 0, "остаток не заводим — приход будет строкой поставки");
  assert.equal(Number(stored.price), 350.5);

  // Та же позиция повторно — новая карточка не создаётся (как с контрагентами).
  const again = await mustJson(
    await quickCreateReq(
      jsonRequest("http://localhost/api/admin/products/quick", {
        name: "доставка ПО ГОРОДУ",
        price: 400,
        quantity: 1,
        isService: true,
      })
    )
  );
  assert.equal(again.reused, true);
  assert.equal(again.id, created.id);
  assert.equal(
    products.filter((r) => String(r.name).toLowerCase() === "доставка по городу").length,
    1,
    "одна карточка на обе поставки"
  );

  // Товар по названию существующего товара — тоже переиспользуем карточку.
  const goods = await mustJson(
    await quickCreateReq(
      jsonRequest("http://localhost/api/admin/products/quick", {
        name: "Коробка 400×300×200",
        price: 130,
        quantity: 3,
      })
    )
  );
  assert.equal(goods.id, "p-box");
  assert.equal(goods.reused, true);
  assert.equal(goods.isService, false);

  // Новый товар без флага услуги — обычная карточка-черновик.
  const fresh = await mustJson(
    await quickCreateReq(
      jsonRequest("http://localhost/api/admin/products/quick", {
        name: "Паллета деревянная",
        price: 900,
        quantity: 12,
      })
    )
  );
  assert.equal(fresh.isService, false);
  assert.equal(fresh.stockQty, 0);
  const freshRow = STUB_DB.products.rows.find((r) => r.id === fresh.id);
  assert.match(String(freshRow.note), /размер/i, "в карточке подсказка, что её надо дозаполнить");
});

test("быстрое создание: ошибки валидации и работа без колонки is_service", async () => {
  seed();

  const bad = await quickCreateReq(
    jsonRequest("http://localhost/api/admin/products/quick", { name: "   " })
  );
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /название/i);

  const shorter = await quickCreateReq(
    jsonRequest("http://localhost/api/admin/products/quick", { name: "Я" })
  );
  assert.equal(shorter.status, 400);

  // Пустая строка названия — 400, а не 500.
  const empty = await quickCreateReq(
    jsonRequest("http://localhost/api/admin/products/quick", { price: 10 })
  );
  assert.equal(empty.status, 400);
});

test("БД без миграции услуг: сохранение карточки не падает, флаг просто не пишется", async () => {
  seed();
  const { PATCH: patchProduct } = await import(
    "../src/app/api/admin/products/[id]/route.ts"
  );

  STUB_FAIL_ON_COLUMNS.push("is_service");
  const res = await patchProduct(
    new Request("http://localhost/api/admin/products/p-box", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isService: true, stockQty: 999, name: "Коробка 400×300×200" }),
    }),
    { params: Promise.resolve({ id: "p-box" }) }
  );
  assert.equal(res.status, 200, JSON.stringify(await res.json().catch(() => null)));
  const stored = row("p-box");
  assert.equal(stored.is_service, false, "колонки нет в БД — флаг не записан");
  assert.equal(Number(stored.stock_qty), 10, "остаток не поехал: у услуги его не ведут");
  assert.equal(stored.name, "Коробка 400×300×200", "остальные поля сохранились");
  STUB_FAIL_ON_COLUMNS.length = 0;

  // С применённой миграцией — обычное сохранение работает.
  const ok = await patchProduct(
    new Request("http://localhost/api/admin/products/p-box", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isService: true }),
    }),
    { params: Promise.resolve({ id: "p-box" }) }
  );
  assert.equal(ok.status, 200);
  assert.equal(row("p-box").is_service, true);
  assert.equal(Number(row("p-box").stock_qty), 10, "перевод в услуги остаток не обнуляет");
});
