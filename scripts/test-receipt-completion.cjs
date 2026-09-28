// Run: node scripts/test-receipt-completion.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Load the pure shared logic without Next.js or a database connection.
function loadTs(file) {
  const filename = path.resolve(__dirname, file);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name) => loadTs(path.resolve(path.dirname(filename), `${name}.ts`)),
    module,
    module.exports
  );
  return module.exports;
}

const { isReceiptArchived, buildReceiptDebtRows } = loadTs("../src/lib/warehouse-shared.ts");
const receipt = {
  id: "receipt-1", number: 1, date: "2026-09-28", supplier: "Поставщик",
  status: "draft", total: 1000,
  items: [{ productId: "box", name: "Коробка", quantity: 100, price: 10, lineTotal: 1000 }],
  receivedItems: [{ productId: "box", receivedQty: 60 }],
};
assert.equal(isReceiptArchived(receipt), false, "Partial acceptance remains active");
assert.deepEqual(buildReceiptDebtRows([receipt]), [], "Unconfirmed shortage is not a debt");
const finished = { ...receipt, transportFinishedAt: "2026-09-28T10:00:00Z" };
assert.equal(isReceiptArchived(finished), true, "Explicit completion archives a partial receipt");
assert.equal(finished.status, "draft", "Completion must not fake full warehouse acceptance");
assert.equal(finished.receivedItems[0].receivedQty, 60);
const debts = buildReceiptDebtRows([finished]);
assert.equal(debts.length, 1);
assert.equal(debts[0].direction, "supplier_owes");
assert.equal(debts[0].quantity, 40);
assert.equal(debts[0].amount, 400);
assert.equal(isReceiptArchived({ ...receipt, status: "posted" }), true);
assert.equal(isReceiptArchived({ ...receipt, receivedItems: [], transportFinishedAt: null }), false,
  "Cancellation returns the receipt to active documents");
assert.deepEqual([receipt, finished].filter(isReceiptArchived), [finished]);
assert.deepEqual([receipt, finished].filter((r) => !isReceiptArchived(r)), [receipt]);
console.log("Receipt completion regression checks passed");
