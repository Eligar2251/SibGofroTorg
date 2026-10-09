import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExportRows,
  dateSpanOf,
  isExportableType,
  matchesDateRange,
  partLabelForIndex,
  sortExportRows,
  stripPartPhraseAny,
  summarize,
  syncPartPhrase,
} from "../src/lib/payment-export.ts";

/** Полный по реквизитам контрагент-поставщик. */
const CP_OK = {
  id: "cp-1",
  full_name: "ООО «Гофра Опт»",
  short_name: "Гофра Опт",
  bank_account: "40702810900000000001",
  bank_name: "АО «АЛЬФА-БАНК»",
  bank_city: "Москва",
  bik: "044525593",
  correspondent_account: "30101810200000000593",
  inn: "5401234567",
  kpp: "540101001",
};

/** Контрагент без банковских реквизитов. */
const CP_EMPTY = { id: "cp-2", full_name: "ИП Без Реквизитов", inn: null };

const RECEIPT = {
  id: "rec-1",
  number: 41,
  date: "2026-10-01",
  supplier: "ООО «Гофра Опт»",
  invoice_number: "СЧ-15",
  invoice_date: "2026-09-28",
  bank_account: null,
  bank_name: null,
  bank_city: null,
  bik: null,
  correspondent_account: null,
  inn: null,
  kpp: null,
};

function payment(overrides = {}) {
  return {
    id: "p-1",
    number: 101,
    date: "2026-10-09",
    counterparty: "ООО «Гофра Опт»",
    counterparty_id: "cp-1",
    receipt_ids: ["rec-1"],
    receipt_numbers: [41],
    amount: 10000,
    vat_rate: 22,
    vat_amount: 1803.28,
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

test("partLabelForIndex: одна часть — без подписи, несколько — по порядку", () => {
  assert.equal(partLabelForIndex(0, 1), "");
  assert.equal(partLabelForIndex(0, 0), "");
  assert.equal(partLabelForIndex(0, 2), "первая часть");
  assert.equal(partLabelForIndex(1, 2), "вторая часть");
  assert.equal(partLabelForIndex(2, 3), "третья часть");
  assert.equal(partLabelForIndex(11, 12), "12-я часть");
});

test("stripPartPhraseAny: вырезает фразу про часть, остальной текст не трогает", () => {
  assert.equal(
    stripPartPhraseAny("оплата второй части по счёту № 5 от 01 октября 2026."),
    "оплата по счёту № 5 от 01 октября 2026."
  );
  assert.equal(stripPartPhraseAny("оплата второй части."), "");
  assert.equal(stripPartPhraseAny("Оплата за тару по договору № 7"), "Оплата за тару по договору № 7");
  assert.equal(stripPartPhraseAny(""), "");
});

test("syncPartPhrase: подставляет актуальную часть в сохранённый текст", () => {
  assert.equal(
    syncPartPhrase("оплата первой части по счёту № 9 от 05 октября 2026.", "вторая часть"),
    "оплата второй части по счёту № 9 от 05 октября 2026."
  );
  // Платёж остался один — упоминание части убираем.
  assert.equal(
    syncPartPhrase("оплата первой части по счёту № 9.", ""),
    "оплата по счёту № 9."
  );
  // Своего текста нет — вернём пусто, назначение построится автоматически.
  assert.equal(syncPartPhrase("", "вторая часть"), "");
});

test("buildExportRows: части считаются по всем платежам поставки, а не по выборке", () => {
  const first = payment({ id: "p-1", number: 101, date: "2026-10-01", amount: 4000 });
  const second = payment({ id: "p-2", number: 102, date: "2026-10-09", amount: 6000 });

  // В выгрузку отдаём только вторую часть (первая ушла в банк раньше).
  const rows = buildExportRows([first, second], [CP_OK], [RECEIPT], {
    onlyIds: ["p-2"],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "p-2");
  assert.equal(rows[0].partTotal, 2);
  assert.equal(rows[0].partLabel, "вторая часть");
  assert.ok(rows[0].purpose.startsWith("оплата второй части"), rows[0].purpose);
  assert.ok(rows[0].purpose.includes("№ СЧ-15"), rows[0].purpose);
  assert.ok(rows[0].purpose.includes("от 28 сентября 2026"), rows[0].purpose);
});

test("buildExportRows: один платёж поставки — без подписи части", () => {
  const rows = buildExportRows([payment()], [CP_OK], [RECEIPT]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].partTotal, 1);
  assert.equal(rows[0].partLabel, "");
  assert.ok(rows[0].purpose.startsWith("оплата по счёту № СЧ-15"), rows[0].purpose);
  assert.equal(rows[0].receiptNumber, 41);
  assert.equal(rows[0].invoiceNumber, "СЧ-15");
  assert.equal(rows[0].issue, null);
  assert.equal(rows[0].payee?.inn, "5401234567");
  assert.equal(rows[0].payee?.bik, "044525593");
});

test("buildExportRows: сохранённое назначение важнее авто-текста, но часть пересчитывается", () => {
  const first = payment({ id: "p-1", number: 101 });
  const second = payment({
    id: "p-2",
    number: 102,
    payment_purpose: "оплата первой части по счёту № 9 от 05 октября 2026. В том числе НДС 22%.",
  });
  const rows = buildExportRows([first, second], [CP_OK], [RECEIPT]);
  const row = rows.find((r) => r.id === "p-2");
  assert.ok(row);
  assert.equal(row.partLabel, "вторая часть");
  assert.equal(
    row.purpose,
    "оплата второй части по счёту № 9 от 05 октября 2026. В том числе НДС 22%."
  );
});

test("buildExportRows: неполные реквизиты → issue и пустой payee", () => {
  const rows = buildExportRows(
    [
      payment({
        counterparty_id: "cp-2",
        counterparty: "ИП Без Реквизитов",
        receipt_ids: [],
        receipt_numbers: [],
      }),
    ],
    [CP_OK, CP_EMPTY],
    [RECEIPT]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payee, null);
  assert.match(rows[0].issue ?? "", /р\/с/);
  assert.match(rows[0].issue ?? "", /ИНН/);
  assert.equal(rows[0].counterparty, "ИП Без Реквизитов");
  // Платёж без поставки — часть одна.
  assert.equal(rows[0].partTotal, 1);
});

test("buildExportRows: внебалансовые «закрывашки» поставок без оплаты не выгружаются", () => {
  const rows = buildExportRows(
    [
      payment({ id: "p-1" }),
      payment({ id: "p-2", number: 102, exclude_from_balance: true, is_paid: true }),
    ],
    [CP_OK],
    [RECEIPT]
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["p-1"]
  );
  // Закрывашка не считается частью: оставшийся платёж — единственный.
  assert.equal(rows[0].partTotal, 1);
  assert.equal(rows[0].partLabel, "");
});

test("matchesDateRange / sortExportRows / dateSpanOf / summarize", () => {
  const a = buildExportRows([payment({ id: "p-1", number: 101, date: "2026-10-01" })], [CP_OK], [RECEIPT])[0];
  const b = buildExportRows(
    [
      payment({
        id: "p-2",
        number: 102,
        date: "2026-10-09",
        amount: 2500.5,
        is_paid: true,
        exported_at: "2026-10-08",
      }),
    ],
    [CP_OK],
    [RECEIPT]
  )[0];
  const c = buildExportRows(
    [payment({ id: "p-3", number: 103, date: "2026-10-15", amount: 100 })],
    [CP_OK],
    [RECEIPT]
  )[0];

  assert.equal(matchesDateRange(a, "2026-10-01", "2026-10-09"), true);
  assert.equal(matchesDateRange(c, "2026-10-01", "2026-10-09"), false);
  assert.equal(matchesDateRange(c, null, null), true);

  assert.deepEqual(
    sortExportRows([a, b, c]).map((r) => r.id),
    ["p-3", "p-2", "p-1"]
  );

  assert.deepEqual(dateSpanOf([a, b, c]), { from: "2026-10-01", to: "2026-10-15" });
  assert.deepEqual(dateSpanOf([]), { from: "", to: "" });

  const sum = summarize([a, b]);
  assert.equal(sum.count, 2);
  assert.equal(sum.total, 12500.5);
  assert.equal(sum.unpaid, 1);
  assert.equal(sum.unexported, 1);
});

// ─────────────────────────────────────────────────────────────
// Сквозная проверка: строки выгрузки → реальный файл Клиент-Банка.
// Здесь вызываются те же функции, что и POST /api/admin/warehouse/
// payments/export (buildExportRows → buildClientBankExchange → cp1251).
// ─────────────────────────────────────────────────────────────
const { buildClientBankExchange, ourCompanyParty } = await import(
  "../src/lib/client-bank-exchange.ts"
);
const { encodeWindows1251 } = await import("../src/lib/cp1251.ts");

test("файл 1CClientBankExchange: выбранные платежи, cp1251, вторая часть", () => {
  const first = payment({ id: "p-1", number: 101, date: "2026-10-01", amount: 4000 });
  const second = payment({ id: "p-2", number: 102, date: "2026-10-09", amount: 6000 });
  const rows = buildExportRows([first, second], [CP_OK], [RECEIPT], {
    onlyIds: ["p-2"],
  });

  const payer = ourCompanyParty();
  const docs = rows
    .filter((row) => row.payee)
    .map((row) => ({
      number: row.number,
      date: row.date,
      amount: row.amount,
      payer,
      payee: row.payee,
      priority: row.priority,
      paymentKind: row.paymentKind,
      paymentType: "электронно",
      purpose: row.purpose,
      vatRate: row.vatRate,
      vatAmount: row.vatAmount,
      partLabel: row.partLabel || null,
    }));

  const span = dateSpanOf(rows);
  const content = buildClientBankExchange({
    ourAccount: payer.account,
    dateFrom: span.from,
    dateTo: span.to,
    payments: docs,
  });

  // В файл попал ровно ОДИН документ — только выбранный.
  assert.equal(content.split("СекцияДокумент=Платежное поручение").length - 1, 1);
  assert.ok(content.startsWith("1CClientBankExchange\r\n"));
  assert.ok(content.includes("ВерсияФормата=1.03\r\n"));
  assert.ok(content.includes("Кодировка=Windows\r\n"));
  assert.ok(content.includes(`РасчСчет=${payer.account}\r\n`));
  assert.ok(content.includes("Номер=102\r\n"), content);
  assert.ok(!content.includes("Номер=101\r\n"), "невыбранный платёж не должен попасть в файл");
  assert.ok(content.includes("Дата=09.10.2026\r\n"));
  assert.ok(content.includes("Сумма=6000.00\r\n"));
  assert.ok(content.includes("ДатаНачала=09.10.2026\r\n"));
  assert.ok(content.includes("ДатаКонца=09.10.2026\r\n"));
  assert.ok(content.includes("ПолучательБИК=044525593\r\n"));
  assert.ok(content.includes("ПолучательИНН=5401234567\r\n"));
  assert.ok(content.includes("ПлательщикБИК=045004774\r\n"));
  assert.ok(
    content.includes("НазначениеПлатежа1=оплата второй части по счёту № СЧ-15 от 28 сентября 2026. В том числе НДС 22%.\r\n"),
    content.split("\r\n").filter((l) => l.startsWith("НазначениеПлатежа")).join(" | ")
  );
  assert.ok(content.includes("НазначениеПлатежа2=Сумма 6000-00\r\n"));
  // НДС берётся из vat_amount платежа (1803.28), а не пересчитывается.
  assert.ok(content.includes("НазначениеПлатежа3=В т.ч. НДС(22%) 1803-28\r\n"));
  assert.ok(content.endsWith("КонецФайла\r\n"));
  // CRLF везде, одиноких LF нет.
  assert.equal(content.replace(/\r\n/g, "").includes("\n"), false);

  // Кодировка: кириллица уходит в cp1251 (не UTF-8).
  const buf = encodeWindows1251(content);
  assert.ok(buf instanceof Uint8Array);
  // «о» в cp1251 = 0xEE, в UTF-8 — 0xD0 0xBE. Проверяем, что UTF-8-пар нет.
  const asUtf8 = Buffer.from(content, "utf8");
  assert.ok(buf.length < asUtf8.length, "cp1251 должен быть короче UTF-8");
});

test("isExportableType: расходники — да, наличные/карты/переводы — нет", () => {
  assert.equal(isExportableType("regular"), true);
  assert.equal(isExportableType("refund"), true);
  assert.equal(isExportableType("advertising"), true);
  assert.equal(isExportableType("website"), true);
  assert.equal(isExportableType("monthly"), true);
  assert.equal(isExportableType(null), true, "старые записи без типа — обычный платёж");
  assert.equal(isExportableType(undefined), true);
  assert.equal(isExportableType("cash"), false);
  assert.equal(isExportableType("ym_card"), false);
  assert.equal(isExportableType("vm_card"), false);
  assert.equal(isExportableType("transfer"), false);
  assert.equal(isExportableType("deposit"), false);
});

test("buildExportRows: сторонний расходник без поставки выгружается одной частью", () => {
  const rows = buildExportRows(
    [
      payment({
        id: "p-ad",
        number: 201,
        date: "2026-10-09",
        type: "advertising",
        receipt_ids: [],
        receipt_numbers: [],
        amount: 15000,
        comment: "Реклама Яндекс",
      }),
      payment({ id: "p-cash", number: 202, type: "cash" }),
    ],
    [CP_OK],
    [RECEIPT]
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["p-ad"]
  );
  assert.equal(rows[0].partTotal, 1);
  assert.equal(rows[0].partLabel, "");
  assert.equal(rows[0].issue, null);
  // Без поставки нет ни счёта, ни ПО — основанием становится комментарий,
  // иначе в банк уехало бы бессмысленное «оплата.»
  assert.equal(rows[0].purpose, "Реклама Яндекс");
});
