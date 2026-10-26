// =========================================================
// FILE: tests/deal-archive.test.mjs
// Архив заказов: счета оплаты и сортировка по времени добавления.
// =========================================================

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEAL_ACCOUNT_IDS,
  buildDealAccountsMap,
  dealCreationTime,
  dealMatchesAccount,
  dealPrimaryAccount,
  formatDealCreatedAt,
  getDealAccounts,
  paymentAccount,
  paymentDealAccount,
  sortDeals,
} from "../src/lib/deal-archive.ts";
import { getBankSummary, isImmediateVmPayment } from "../src/lib/warehouse-shared.ts";

function payment(overrides = {}) {
  return {
    id: `pay-${Math.random()}`,
    number: 1,
    date: "2026-10-26",
    direction: "incoming",
    type: "regular",
    cashDestination: null,
    counterparty: "Покупатель",
    dealIds: [],
    dealNumbers: [],
    receiptIds: [],
    receiptNumbers: [],
    amount: 0,
    vatRate: 22,
    vatAmount: 0,
    isPaid: true,
    ...overrides,
  };
}

function deal(overrides = {}) {
  return {
    id: "deal-1",
    number: 1,
    date: "2026-10-26",
    customerName: "Покупатель",
    items: [],
    total: 0,
    bankAdjustment: 0,
    vatRate: 22,
    vatAmount: 0,
    status: "completed",
    createdAt: "2026-10-26T05:00:00.000Z",
    ...overrides,
  };
}

test("paymentDealAccount различает кассу, обе карты и расчётный счёт", () => {
  const cases = [
    [{ type: "cash", cashDestination: null }, "cash"],
    [{ type: "cash", cashDestination: "cash" }, "cash"],
    [{ type: "vm_card", cashDestination: null }, "vm_card"],
    [{ type: "cash", cashDestination: "vm_card" }, "vm_card"],
    [{ type: "ym_card", cashDestination: null }, "ym_card"],
    [{ type: "transfer", cashDestination: "card" }, "ym_card"],
    [{ type: "cash", cashDestination: "card" }, "ym_card"],
    [{ type: "regular", cashDestination: null }, "bank"],
    [{ type: "refund", cashDestination: null }, "bank"],
  ];
  for (const [fields, expected] of cases) {
    assert.equal(
      paymentDealAccount(payment(fields)),
      expected,
      `тип ${fields.type} / направление ${fields.cashDestination}`,
    );
  }
  assert.equal(paymentDealAccount(payment({ direction: "outgoing", type: "cash" })), null);
  // Для карточки платежа направление не важно: расход тоже списывается
  // с конкретного счёта.
  assert.equal(paymentAccount({ type: "cash", cashDestination: null }), "cash");
  assert.equal(paymentAccount({ type: "vm_card", cashDestination: null }), "vm_card");
  assert.equal(paymentAccount({ type: "cash", cashDestination: "card" }), "ym_card");
});

test("buildDealAccountsMap собирает все счета частичной оплаты и не теряет переводы", () => {
  const accounts = buildDealAccountsMap(
    [
      payment({ id: "p1", number: 12, dealIds: ["d1"], type: "cash", amount: 100.505, isPaid: true }),
      payment({ id: "p2", number: 10, dealIds: ["d1"], type: "cash", amount: 50, isPaid: false }),
      payment({ id: "p3", number: 11, dealIds: ["d1"], type: "vm_card", amount: 75 }),
      payment({ id: "p4", number: 9, dealIds: ["d1"], type: "cash", cashDestination: "card", amount: 25 }),
      payment({ id: "p5", number: 8, dealIds: ["d1"], direction: "outgoing", type: "cash", amount: 999 }),
      payment({ id: "p6", number: 7, dealIds: ["d2"], type: "regular", amount: 300 }),
    ],
    new Set(["d3"]),
  );

  const d1 = getDealAccounts("d1", accounts);
  assert.deepEqual(d1.map((entry) => entry.account), ["cash", "vm_card", "ym_card"]);
  assert.equal(d1[0].amount, 150.51, "наличные части складываются и округляются до копеек");
  assert.deepEqual(d1[0].paymentNumbers, [10, 12], "номера ПЛ отсортированы");
  assert.equal(d1[0].hasPending, true, "непроведённый платёж помечен");
  assert.equal(d1[1].amount, 75);
  assert.equal(d1[2].amount, 25, "наличка с переводом на карту ЮМ не попала в кассу");
  assert.equal(dealPrimaryAccount(d1), "cash", "основной счёт — с максимальной суммой");

  assert.deepEqual(getDealAccounts("d2", accounts).map((e) => e.account), ["bank"]);
  assert.deepEqual(getDealAccounts("d3", accounts), [
    {
      account: "cash",
      amount: 0,
      paymentNumbers: [],
      hasPending: false,
      inferred: true,
    },
  ]);
  assert.deepEqual(getDealAccounts("unknown", accounts), []);
  assert.equal(DEAL_ACCOUNT_IDS.length, 4);
});

test("dealMatchesAccount отдельно выводит кассу, карту В.М. и карту ЮМ", () => {
  const accounts = buildDealAccountsMap([
    payment({ dealIds: ["cash"], type: "cash", amount: 100 }),
    payment({ dealIds: ["vm"], type: "vm_card", amount: 100 }),
    payment({ dealIds: ["ym"], type: "ym_card", amount: 100 }),
    payment({ dealIds: ["bank"], type: "regular", amount: 100 }),
  ]);

  const entries = (id) => getDealAccounts(id, accounts);
  assert.equal(dealMatchesAccount("all", entries("cash")), true);
  assert.equal(dealMatchesAccount("cash", entries("cash")), true);
  assert.equal(dealMatchesAccount("vm_card", entries("cash")), false);
  assert.equal(dealMatchesAccount("vm_card", entries("vm")), true);
  assert.equal(dealMatchesAccount("ym_card", entries("ym")), true);
  assert.equal(dealMatchesAccount("bank", entries("bank")), true);
  assert.equal(dealMatchesAccount("unknown", entries("none")), true);
  assert.equal(dealMatchesAccount("unknown", entries("cash")), false);
});

test("sortDeals ставит свежие заказы выше даже в рамках одного дня", () => {
  const deals = [
    deal({ id: "old", number: 900, date: "2026-10-26", createdAt: "2026-10-26T05:00:01.000Z" }),
    deal({ id: "new", number: 1, date: "2026-10-26", createdAt: "2026-10-26T05:00:59.000Z" }),
    deal({ id: "middle", number: 500, date: "2026-10-26", createdAt: "2026-10-26T05:00:30.000Z" }),
    deal({ id: "no-created", number: 2, date: "2026-10-25", createdAt: null }),
  ];
  const accounts = new Map();

  assert.deepEqual(
    sortDeals(deals, { key: "created", direction: "desc", accounts }).map((d) => d.id),
    ["new", "middle", "old", "no-created"],
  );
  assert.deepEqual(
    sortDeals(deals, { key: "created", direction: "asc", accounts }).map((d) => d.id),
    ["no-created", "old", "middle", "new"],
  );

  assert.ok(dealCreationTime(deals[1]) > dealCreationTime(deals[0]));
  assert.equal(dealCreationTime(deals[3]), Date.parse("2026-10-25T00:00:00+07:00"));
});

test("sortDeals при одинаковом времени добавления использует номер заказа", () => {
  const createdAt = "2026-10-26T05:00:00.000Z";
  const deals = [
    deal({ id: "a", number: 10, createdAt }),
    deal({ id: "b", number: 30, createdAt }),
    deal({ id: "c", number: 20, createdAt }),
  ];
  assert.deepEqual(
    sortDeals(deals, { key: "created", direction: "desc", accounts: new Map() }).map((d) => d.number),
    [30, 20, 10],
  );
});

test("сортировка по счёту группирует кассу, В.М., ЮМ, р/с и заказы без счёта", () => {
  const accounts = buildDealAccountsMap([
    payment({ dealIds: ["bank"], type: "regular", amount: 100 }),
    payment({ dealIds: ["ym"], type: "ym_card", amount: 100 }),
    payment({ dealIds: ["cash"], type: "cash", amount: 100 }),
    payment({ dealIds: ["vm"], type: "vm_card", amount: 100 }),
  ]);
  const deals = [
    deal({ id: "bank", number: 4, date: "2026-10-20", createdAt: "2026-10-20T01:00:00Z" }),
    deal({ id: "ym", number: 3, date: "2026-10-21", createdAt: "2026-10-21T01:00:00Z" }),
    deal({ id: "none", number: 5, date: "2026-10-22", createdAt: "2026-10-22T01:00:00Z" }),
    deal({ id: "cash", number: 1, date: "2026-10-23", createdAt: "2026-10-23T01:00:00Z" }),
    deal({ id: "vm", number: 2, date: "2026-10-24", createdAt: "2026-10-24T01:00:00Z" }),
  ];
  assert.deepEqual(
    sortDeals(deals, { key: "account", direction: "desc", accounts }).map((d) => d.id),
    ["cash", "vm", "ym", "bank", "none"],
  );
});

test("наличка с пометкой «карта В.М.» не попадает в кассовый остаток", () => {
  const marked = payment({
    id: "vm-marked",
    date: "2026-10-26",
    type: "cash",
    cashDestination: "vm_card",
    amount: 100,
    isPaid: true,
  });
  assert.equal(isImmediateVmPayment(marked), true);
  const summary = getBankSummary([marked], [], [], "2026-10-26");
  assert.equal(summary.vmCardBalance, 100);
  assert.equal(summary.cashBalance, 0);
});

test("formatDealCreatedAt показывает минуты и секунды по Новосибирску", () => {
  assert.equal(
    formatDealCreatedAt("2026-10-26T05:23:45.000Z"),
    "26.10.2026, 12:23:45",
  );
  assert.equal(formatDealCreatedAt("2026-10-26"), "26.10.2026");
  assert.equal(formatDealCreatedAt(null), "—");
});
