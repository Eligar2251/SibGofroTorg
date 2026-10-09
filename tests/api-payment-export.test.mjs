// =========================================================
// FILE: tests/api-payment-export.test.mjs
// Сквозной тест API-роута выгрузки платёжек:
//   GET  /api/admin/warehouse/payments/export?list=1  — список с галочками
//   POST /api/admin/warehouse/payments/export         — файл по выбранным id
// Вызываются НАСТОЯЩИЕ обработчики из route.ts; Supabase и админ-сессия
// подменены двойниками (tests/stubs/*), поэтому тест не ходит в сеть.
// Запуск: npm run test:export-api
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";

const { GET, POST } = await import(
  "../src/app/api/admin/warehouse/payments/export/route.ts"
);
const { resetStubDb, STUB_UPDATES } = await import("./stubs/stub-supabase.ts");

const CP = {
  id: "cp-1",
  full_name: "ООО «Гофра Опт»",
  bank_account: "40702810900000000001",
  bank_name: "АО «АЛЬФА-БАНК»",
  bank_city: "Москва",
  bik: "044525593",
  correspondent_account: "30101810200000000593",
  inn: "5401234567",
  kpp: "540101001",
};

const RECEIPT = {
  id: "rec-1",
  number: 41,
  date: "2026-10-01",
  supplier: "ООО «Гофра Опт»",
  invoice_number: "СЧ-15",
  invoice_date: "2026-09-28",
};

function payment(overrides = {}) {
  return {
    id: "p-1",
    number: 101,
    date: "2026-10-01",
    direction: "outgoing",
    type: "regular",
    counterparty: "ООО «Гофра Опт»",
    counterparty_id: "cp-1",
    receipt_ids: ["rec-1"],
    receipt_numbers: [41],
    amount: 4000,
    vat_rate: 22,
    vat_amount: 721.31,
    is_paid: false,
    exclude_from_balance: false,
    exported_at: null,
    payment_purpose: null,
    payment_priority: 5,
    payment_kind: "01",
    comment: "Оплата поставщику по приходному ордеру ПО-41",
    ...overrides,
  };
}

/** Поставка, разбитая на 2 части: первая проведена, вторая — нет. */
function seedSplitPayments() {
  resetStubDb({
    bank_payments: [
      payment({ id: "p-1", number: 101, date: "2026-10-01", amount: 4000, is_paid: true, exported_at: "2026-10-01" }),
      payment({ id: "p-2", number: 102, date: "2026-10-09", amount: 6000 }),
      // Входящий платёж покупателя — в выгрузку не попадает.
      payment({ id: "p-3", number: 103, date: "2026-10-09", direction: "incoming" }),
      // «Закрывашка» поставки без оплаты — тоже не попадает.
      payment({ id: "p-4", number: 104, date: "2026-10-09", exclude_from_balance: true, is_paid: true }),
    ],
    counterparties: [CP],
    warehouse_receipts: [RECEIPT],
  });
}

function url(query) {
  return new Request(`http://localhost/api/admin/warehouse/payments/export${query}`);
}

test("GET ?list=1: показывает и проведённые, и НЕ проведённые платежи дня", async () => {
  seedSplitPayments();
  const res = await GET(url("?list=1&from=2026-10-09&to=2026-10-09"));
  assert.equal(res.status, 200);
  const body = await res.json();

  // Входящий и внебалансовый отфильтрованы; не проведённый — на месте.
  assert.deepEqual(
    body.rows.map((r) => r.id),
    ["p-2"]
  );
  assert.equal(body.rows[0].isPaid, false);
  assert.equal(body.rows[0].partTotal, 2);
  assert.equal(body.rows[0].partLabel, "вторая часть");
  assert.equal(body.rows[0].issue, null);
  assert.deepEqual(body.range, { from: "2026-10-09", to: "2026-10-09" });
  assert.equal(body.summary.count, 1);
  assert.equal(body.summary.unpaid, 1);
  // totals — по всем платежам поставщикам, не только за день.
  assert.equal(body.totals.count, 2);
  assert.equal(body.totals.unexported, 1);
});

test("GET ?list=1&all=1: «Показать все платежи» — без фильтра по дате", async () => {
  seedSplitPayments();
  const res = await GET(url("?list=1&all=1"));
  const body = await res.json();

  assert.equal(body.allDates, true);
  assert.deepEqual(
    body.rows.map((r) => r.id),
    ["p-2", "p-1"]
  );
  assert.deepEqual(body.range, { from: null, to: null });
});

test("GET ?list=1 без параметров: по умолчанию сегодня", async () => {
  seedSplitPayments();
  const today = new Date().toISOString().slice(0, 10);
  const res = await GET(url("?list=1"));
  const body = await res.json();
  assert.deepEqual(body.range, { from: today, to: today });
});

test("GET ?list=1: битая дата → 400", async () => {
  seedSplitPayments();
  const res = await GET(url("?list=1&from=09.10.2026"));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /YYYY-MM-DD/);
});

test("POST: в файл попадает только выбранный платёж, exported_at проставляется", async () => {
  seedSplitPayments();
  const res = await POST(
    new Request("http://localhost/api/admin/warehouse/payments/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["p-2"] }),
    })
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Export-Count"), "1");
  assert.equal(res.headers.get("X-Export-From"), "2026-10-09");
  assert.equal(res.headers.get("X-Export-To"), "2026-10-09");
  assert.match(res.headers.get("Content-Type") || "", /charset=windows-1251/);
  assert.match(res.headers.get("Content-Disposition") || "", /kl_to_1c_2026-10-09_2026-10-09\.txt/);

  const bytes = await res.arrayBuffer();
  // Тело — Windows-1251, поэтому декодируем именно в cp1251.
  const text = new TextDecoder("windows-1251").decode(bytes);
  assert.equal(text.split("СекцияДокумент").length - 1, 1);
  assert.ok(text.includes("Номер=102\r\n"));
  assert.ok(!text.includes("Номер=101\r\n"));
  assert.ok(!text.includes("Номер=103\r\n"));
  assert.ok(!text.includes("Номер=104\r\n"));
  // Часть платежа — по фактическому количеству частей поставки (их 2),
  // хотя в файл уходит только вторая.
  assert.ok(
    text.includes(
      "НазначениеПлатежа1=оплата второй части по счёту № СЧ-15 от 28 сентября 2026. В том числе НДС 22%.\r\n"
    ),
    text.split("\r\n").filter((l) => l.startsWith("НазначениеПлатежа")).join(" | ")
  );
  assert.ok(text.includes("Получатель1=ООО «Гофра Опт»\r\n"));
  assert.ok(text.endsWith("КонецФайла\r\n"));

  // Отметка о выгрузке — ровно по выбранному платежу.
  assert.equal(STUB_UPDATES.length, 1);
  assert.match(String(STUB_UPDATES[0].values.exported_at), /^\d{4}-\d{2}-\d{2}$/);
});

test("POST: без id → 400", async () => {
  seedSplitPayments();
  const res = await POST(
    new Request("http://localhost/api/admin/warehouse/payments/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    })
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Выберите хотя бы один/);
});

test("POST: несуществующий id → 400 с просьбой обновить список", async () => {
  seedSplitPayments();
  const res = await POST(
    new Request("http://localhost/api/admin/warehouse/payments/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["p-2", "nope"] }),
    })
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Обновите список/);
});

test("POST: неполные реквизиты получателя → 400 и файл не формируется", async () => {
  resetStubDb({
    bank_payments: [
      payment({
        id: "p-9",
        number: 109,
        receipt_ids: [],
        receipt_numbers: [],
        counterparty_id: "cp-empty",
        counterparty: "ИП Без Реквизитов",
      }),
    ],
    counterparties: [{ id: "cp-empty", full_name: "ИП Без Реквизитов" }],
    warehouse_receipts: [],
  });

  const res = await POST(
    new Request("http://localhost/api/admin/warehouse/payments/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["p-9"] }),
    })
  );
  assert.equal(res.status, 400);
  const error = (await res.json()).error;
  assert.match(error, /ПЛ-109/);
  assert.match(error, /р\/с/);
  assert.equal(STUB_UPDATES.length, 0);
});

test("POST: входящий платёж выбрать нельзя — его нет в исходящих", async () => {
  seedSplitPayments();
  const res = await POST(
    new Request("http://localhost/api/admin/warehouse/payments/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["p-3"] }),
    })
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Обновите список/);
});

test("GET ?list=1: сторонний расходник (реклама) виден в списке и выгружается", async () => {
  resetStubDb({
    bank_payments: [
      payment({
        id: "p-ad",
        number: 201,
        date: "2026-10-09",
        type: "advertising",
        receipt_ids: [],
        receipt_numbers: [],
        amount: 15000,
        vat_rate: 0,
        vat_amount: 0,
        comment: "Реклама Яндекс Директ",
      }),
      // Наличные и внутренний перевод на карту в выгрузку не попадают.
      payment({ id: "p-cash", number: 202, date: "2026-10-09", type: "cash" }),
      payment({ id: "p-tr", number: 203, date: "2026-10-09", type: "transfer" }),
    ],
    counterparties: [CP],
    warehouse_receipts: [],
  });

  const listRes = await GET(url("?list=1&from=2026-10-09&to=2026-10-09"));
  const list = await listRes.json();
  assert.deepEqual(
    list.rows.map((r) => r.id),
    ["p-ad"]
  );
  assert.equal(list.rows[0].isPaid, false);
  assert.equal(list.rows[0].purpose, "Реклама Яндекс Директ");

  const res = await POST(
    new Request("http://localhost/api/admin/warehouse/payments/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["p-ad"] }),
    })
  );
  assert.equal(res.status, 200);
  const text = new TextDecoder("windows-1251").decode(await res.arrayBuffer());
  assert.ok(text.includes("Номер=201\r\n"));
  assert.ok(text.includes("НазначениеПлатежа1=Реклама Яндекс Директ\r\n"), text);
  assert.ok(text.includes("НазначениеПлатежа3=Без НДС\r\n"));
});
