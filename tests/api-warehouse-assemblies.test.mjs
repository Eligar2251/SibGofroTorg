// =========================================================
// FILE: tests/api-warehouse-assemblies.test.mjs
// Сквозной тест API-роутов комплектации номенклатуры (1С):
//   • автоприход выпуска поставкой ПО-… от «СибГофроТорг»
//   • выбор цены листа из последнего прихода внешнего поставщика
//   • стандартная формула (цена_листа / коробок_с_листа) + 2 ₽ и ручная цена
//   • сторно и удаление со снятием связанной поставки ПО-…
// Запуск: npm run test:assembly-api
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";

const { GET, POST } = await import(
  "../src/app/api/admin/warehouse/assemblies/route.ts"
);
const { PATCH, DELETE } = await import(
  "../src/app/api/admin/warehouse/assemblies/[id]/route.ts"
);
const {
  STUB_DB,
  STUB_MISSING_TABLES,
  resetStubDb,
} = await import("./stubs/stub-supabase.ts");

function seedProductsWithReceipts() {
  resetStubDb({
    products: [
      {
        id: "prod-sheet",
        name: "Гофролист Т-24 2000×1200",
        sku: "GL-24",
        stock_qty: 500,
        in_stock: true,
        purchase_price: 50, // старая цена в карточке
        price: 80,
      },
      {
        id: "prod-box",
        name: "Коробка 600×400×400",
        sku: "KB-600",
        stock_qty: 0,
        in_stock: false,
        purchase_price: 28,
        price: 55,
      },
    ],
    // Два прихода поставщиков + один старый автоприход СибГофроТорг (должен игнорироваться)
    warehouse_receipts: [
      {
        id: "rec-old",
        number: 5,
        date: "2026-10-01",
        supplier: "ООО «Старый Поставщик»",
        status: "posted",
        items: [{ productId: "prod-sheet", name: "Лист", quantity: 200, price: 42 }],
        received_items: [{ productId: "prod-sheet", receivedQty: 200 }],
      },
      {
        id: "rec-latest",
        number: 12,
        date: "2026-10-25",
        supplier: "ООО «ГофроПак»",
        status: "posted",
        items: [{ productId: "prod-sheet", name: "Лист", quantity: 300, price: 36 }],
        received_items: [{ productId: "prod-sheet", receivedQty: 300 }],
      },
      {
        id: "rec-self",
        number: 15,
        date: "2026-10-28",
        supplier: "СибГофроТорг",
        status: "posted",
        items: [{ productId: "prod-sheet", name: "Лист", quantity: 10, price: 99 }],
        received_items: [{ productId: "prod-sheet", receivedQty: 10 }],
      },
    ],
    doc_counters: [{ key: "receipt", value: 15 }],
    counterparties: [],
    supplier_prices: [],
    bank_payments: [],
    transports: [],
    warehouse_assemblies: [],
    settings: [],
    activity_logs: [],
  });
}

function getStock(productId) {
  const row = STUB_DB.products.rows.find((r) => r.id === productId);
  return {
    stockQty: Number(row?.stock_qty),
    inStock: Boolean(row?.in_stock),
    purchasePrice: row?.purchase_price ?? null,
  };
}

test("POST + PATCH (сторно): берёт 36 ₽ с последнего прихода ПО-12, считает 36/3+2=14 ₽, создаёт ПО от СибГофроТорг и откатывает", async () => {
  seedProductsWithReceipts();

  const postRes = await POST(
    new Request("http://localhost/api/admin/warehouse/assemblies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "assembly",
        date: "2026-10-30",
        spentProductId: "prod-sheet",
        spentQty: 100,
        producedProductId: "prod-box",
        producedQty: 300,
        updatePurchasePrice: true,
        comment: "Партия коробок из листа",
      }),
    })
  );

  assert.equal(postRes.status, 200);
  const { assembly } = await postRes.json();
  assert.equal(assembly.number, 1);
  assert.equal(assembly.status, "posted");
  // Цена листа взята с ПО-12 (36 ₽), игнорируя старую карточку (50 ₽) и СибГофроТорг (99 ₽)
  assert.equal(assembly.spentItems[0].unitCost, 36);
  assert.equal(assembly.totalCost, 3600);
  // Формула: 36 / 3 + 2 = 14 ₽/шт.
  assert.equal(assembly.producedItems[0].unitCost, 14);
  assert.equal(assembly.producedTotalCost, 4200);
  assert.ok(assembly.linkedReceiptId);
  assert.equal(assembly.linkedReceiptNumber, 16);

  // Проверим созданную поставку ПО-16 от «СибГофроТорг»
  const createdReceipt = STUB_DB.warehouse_receipts.rows.find(
    (r) => r.id === assembly.linkedReceiptId
  );
  assert.ok(createdReceipt);
  assert.equal(createdReceipt.supplier, "СибГофроТорг");
  assert.equal(createdReceipt.status, "posted");
  assert.equal(createdReceipt.total, 4200);
  assert.equal(createdReceipt.items[0].price, 14);
  assert.equal(createdReceipt.items[0].quantity, 300);

  // Платежи без оплаты помечены exclude_from_balance = true и is_paid = true (долга нет!)
  assert.equal(STUB_DB.bank_payments.rows.length, 1);
  assert.equal(STUB_DB.bank_payments.rows[0].exclude_from_balance, true);
  assert.equal(STUB_DB.bank_payments.rows[0].is_paid, true);

  // Остатки ровно без задвоения: листы 500 → 400, коробки 0 → 300, закупочная = 14 ₽
  assert.deepEqual(getStock("prod-sheet"), {
    stockQty: 400,
    inStock: true,
    purchasePrice: 50,
  });
  assert.deepEqual(getStock("prod-box"), {
    stockQty: 300,
    inStock: true,
    purchasePrice: 14,
  });

  // GET возвращает и документ КМП-1, и карту последних цен поставщиков
  const listRes = await GET();
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.equal(listBody.assemblies.length, 1);
  assert.equal(listBody.latestSupplierPrices["prod-sheet"].price, 36);
  assert.equal(listBody.latestSupplierPrices["prod-sheet"].receiptNumber, 12);

  // PATCH (сторно): возвращает листы до 500, коробки обратно в 0, удаляет ПО-16 и возвращает закупочную 28 ₽
  const cancelRes = await PATCH(
    new Request(
      `http://localhost/api/admin/warehouse/assemblies/${assembly.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      }
    ),
    { params: Promise.resolve({ id: assembly.id }) }
  );
  assert.equal(cancelRes.status, 200);
  const cancelBody = await cancelRes.json();
  assert.equal(cancelBody.assembly.status, "cancelled");

  assert.deepEqual(getStock("prod-sheet"), {
    stockQty: 500,
    inStock: true,
    purchasePrice: 50,
  });
  assert.deepEqual(getStock("prod-box"), {
    stockQty: 0,
    inStock: false,
    purchasePrice: 28,
  });
  assert.equal(
    STUB_DB.warehouse_receipts.rows.some(
      (r) => r.id === assembly.linkedReceiptId
    ),
    false
  );
});

test("POST: принимает пользовательскую цену прихода produced.unitPrice при ручной корректировке", async () => {
  seedProductsWithReceipts();

  const res = await POST(
    new Request("http://localhost/api/admin/warehouse/assemblies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spent: [{ productId: "prod-sheet", quantity: 50 }],
        produced: [{ productId: "prod-box", quantity: 100, unitPrice: 21.5 }],
      }),
    })
  );
  assert.equal(res.status, 200);
  const { assembly } = await res.json();
  assert.equal(assembly.producedItems[0].unitCost, 21.5);
  assert.equal(assembly.producedItems[0].isManualPrice, true);
  const receipt = STUB_DB.warehouse_receipts.rows.find(
    (r) => r.id === assembly.linkedReceiptId
  );
  assert.equal(receipt.items[0].price, 21.5);
  assert.equal(receipt.total, 2150);
});

test("POST: отклоняет списание больше остатка на складе без порчи остатков", async () => {
  seedProductsWithReceipts();

  const res = await POST(
    new Request("http://localhost/api/admin/warehouse/assemblies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spent: [{ productId: "prod-sheet", quantity: 999 }],
        produced: [{ productId: "prod-box", quantity: 1998 }],
      }),
    })
  );

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Недостаточно остатка/);
  assert.equal(getStock("prod-sheet").stockQty, 500);
  assert.equal(getStock("prod-box").stockQty, 0);
});

test("Фолбэк в settings: работает без таблицы warehouse_assemblies и удаляет со сторно ПО", async () => {
  seedProductsWithReceipts();
  STUB_MISSING_TABLES.push("warehouse_assemblies");

  const postRes = await POST(
    new Request("http://localhost/api/admin/warehouse/assemblies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spent: [{ productId: "prod-sheet", quantity: 40 }],
        produced: [{ productId: "prod-box", quantity: 80 }],
      }),
    })
  );
  assert.equal(postRes.status, 200);
  const { assembly } = await postRes.json();

  assert.equal(getStock("prod-sheet").stockQty, 460);
  assert.equal(getStock("prod-box").stockQty, 80);
  assert.equal(STUB_DB.settings.rows.length, 1);

  const delRes = await DELETE(
    new Request(
      `http://localhost/api/admin/warehouse/assemblies/${assembly.id}`,
      {
        method: "DELETE",
      }
    ),
    { params: Promise.resolve({ id: assembly.id }) }
  );
  assert.equal(delRes.status, 200);
  assert.equal(getStock("prod-sheet").stockQty, 500);
  assert.equal(getStock("prod-box").stockQty, 0);

  const listAfter = await (await GET()).json();
  assert.equal(listAfter.assemblies.length, 0);
});
