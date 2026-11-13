// =========================================================
// FILE: tests/product-services.test.mjs
// Формат позиции «услуга»: правила, быстрое создание из документа
// и миграция на реальном Postgres (PGlite).
// =========================================================

import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

import {
  buildQuickProduct,
  filterStockAffectingItems,
  isServiceProduct,
  normalizeServiceFlag,
  productKind,
  productKindLabel,
  quickDocumentLine,
  quickNameKey,
  stockAffectingItemIds,
} from "@/lib/product-service";

test("флаг услуги читается из любых форм (формула, строка, число)", () => {
  for (const truthy of [true, 1, "true", "1", "on", "yes", "Услуга"]) {
    assert.equal(normalizeServiceFlag(truthy), true, String(truthy));
  }
  for (const falsy of [false, 0, "", "false", "no", null, undefined, {}, [], "товар"]) {
    assert.equal(normalizeServiceFlag(falsy), false, JSON.stringify(falsy) ?? String(falsy));
  }
  assert.equal(productKind({ isService: "on" }), "service");
  assert.equal(productKind({}), "goods");
  assert.equal(productKind(null), "goods");
  assert.equal(isServiceProduct({ isService: 1 }), true);
  assert.equal(productKindLabel({ isService: true }), "Услуга");
  assert.equal(productKindLabel({ isService: false }), "Товар");
});

test("быстрая позиция: черновик карточки без склада и без публикации", () => {
  const { payload, error } = buildQuickProduct({
    name: "  Резка   в   размер  ",
    price: "1 200,50",
    quantity: "12",
    isService: true,
  });
  assert.equal(error, null);
  assert.equal(payload.name, "Резка в размер", "лишние пробелы сворачиваем");
  assert.equal(payload.price, 1200.5);
  assert.equal(payload.quantity, 12);
  assert.equal(payload.isService, true);
  // Ключевые правила: не публикуем, остаток не заводим.
  assert.equal(payload.isVisible, false);
  assert.equal(payload.stockQty, 0);
  assert.match(payload.note, /услуга/i);

  const goods = buildQuickProduct({ name: "Короб 400", price: 30, quantity: 5 });
  assert.equal(goods.error, null);
  assert.equal(goods.payload.isService, false);
  assert.equal(goods.payload.isVisible, false);
  assert.match(goods.payload.note, /размер/i);
});

test("быстрая позиция: проверки и безопасные значения по умолчанию", () => {
  assert.equal(buildQuickProduct({ name: "   " }).error, "Укажите название позиции");
  assert.equal(buildQuickProduct({ name: "Я" }).error, "Название слишком короткое");
  assert.equal(buildQuickProduct({ name: "Услуга", price: "-5" }).error, "Цена не может быть отрицательной");

  // Количество не обязано быть валидным — берём 1; дробное округляем до 3 знаков.
  assert.equal(buildQuickProduct({ name: "Паллета", quantity: "" }).payload.quantity, 1);
  assert.equal(buildQuickProduct({ name: "Паллета", quantity: "-3" }).payload.quantity, 1);
  assert.equal(buildQuickProduct({ name: "Паллета", quantity: "abc" }).payload.quantity, 1);
  assert.equal(buildQuickProduct({ name: "Паллета", quantity: "5.9999" }).payload.quantity, 6);
  assert.equal(buildQuickProduct({ name: "Паллета", quantity: "1e9" }).payload.quantity, 100000);
  assert.equal(buildQuickProduct({ name: "Паллета" }).payload.price, null);
  assert.equal(buildQuickProduct({ name: "  Очень   длинное ".padEnd(400, " name") }).payload.name.length, 200);
});

test("ключ названия работает как с контрагентами: дубли не плодим", () => {
  assert.equal(quickNameKey("  Резка   в размер "), "резка в размер");
  assert.equal(quickNameKey("РЕЗКА В РАЗМЕР"), "резка в размер");
  assert.equal(quickNameKey("Резка\nв размер"), "резка в размер");
  assert.equal(quickNameKey("услуга Ёлка"), "услуга елка", "ё приравниваем к е");
  assert.notEqual(quickNameKey("Резка в размер"), quickNameKey("Резка рулонов"));
});

test("строка документа: сумма = цена × количество", () => {
  const { payload } = buildQuickProduct({ name: "Доставка", price: 350.45, quantity: 3, isService: true });
  const line = quickDocumentLine(payload);
  assert.equal(line.name, "Доставка");
  assert.equal(line.price, 350.45);
  assert.equal(line.quantity, 3);
  assert.equal(line.lineTotal, 1051.35);

  const noPrice = quickDocumentLine(buildQuickProduct({ name: "Услуга" }).payload);
  assert.equal(noPrice.price, 0);
  assert.equal(noPrice.quantity, 1);
  assert.equal(noPrice.lineTotal, 0);
});

test("склад двигают только товары: услуги отфильтрованы", () => {
  const items = [
    { productId: "a", quantity: 5 },
    { productId: "b", quantity: 2 },
    { productId: "", quantity: 9 },
    null,
    { productId: "a", quantity: 1 },
  ];
  const services = new Set(["b"]);
  assert.deepEqual(stockAffectingItemIds(items, services), ["a", "a"]);
  assert.deepEqual(
    filterStockAffectingItems(items, services).map((i) => i?.productId),
    ["a", "a"]
  );
  // Без услуг ничего не меняется (БД без миграции = поведение как раньше).
  assert.deepEqual(
    filterStockAffectingItems(items, new Set()).length,
    items.filter((i) => String(i?.productId || "").trim()).length
  );
});

test("миграция услуг: колонка, значение по умолчанию, идемпотентность", async () => {
  const sql = fs.readFileSync("supabase/migration_product_services.sql", "utf8");
  // Правила проекта: скрипт вставляется в Supabase SQL Editor на пул-режиме,
  // поэтому проверяем исполняемые операторы (пояснения в -- комментах не в счёт).
  const executable = sql.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(executable, /^\s*BEGIN\s*;/im, "BEGIN запрещён на пул-режиме");
  assert.doesNotMatch(executable, /^\s*COMMIT\s*;/im);
  assert.doesNotMatch(executable, /SET LOCAL/i);
  assert.doesNotMatch(executable, /CREATE TEMP/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_service BOOLEAN DEFAULT FALSE/);

  const db = new PGlite();
  await db.exec(`
    CREATE TABLE products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL DEFAULT '',
      price numeric,
      stock_qty numeric DEFAULT 0,
      is_visible boolean DEFAULT TRUE
    );
  `);

  await db.exec(sql);
  await db.exec(sql); // повторно — безопасно

  await db.exec("INSERT INTO products (name, price) VALUES ('Короб', 10)");
  await db.exec("INSERT INTO products (name, price, is_service) VALUES ('Резка', 100, TRUE)");

  const goods = await db.query(
    "SELECT is_visible, is_service, stock_qty FROM products WHERE name = 'Короб'"
  );
  assert.equal(goods.rows[0].is_service, false, "по умолчанию — товар");
  assert.equal(goods.rows[0].is_visible, true, "миграция не трогает видимость товаров");

  const service = await db.query(
    "SELECT is_service, stock_qty FROM products WHERE name = 'Резка'"
  );
  assert.equal(service.rows[0].is_service, true);
  assert.equal(Number(service.rows[0].stock_qty), 0, "услуга приходит без остатка");

  const idx = await db.query(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'products' AND indexname = 'idx_products_is_service'"
  );
  assert.equal(idx.rows.length, 1, "частичный индекс для отбора услуг");
  await db.close();
});

test("права доступа и ответ маршрута быстрого создания", () => {
  const route = fs.readFileSync("src/app/api/admin/products/quick/route.ts", "utf8");
  assert.match(route, /requireAdminApi\(\)/, "без сессии админки создавать нельзя");
  assert.match(route, /buildQuickProduct\(body/, "валидация одна на всех");
  assert.match(route, /quickNameKey\(payload\.name\)/, "поиск существующей карточки по названию");
  assert.match(route, /createProduct\(\{/, "создание через обычный слой товаров");
  assert.match(route, /isVisible: false/, "черновик не публикуется на сайт");
  assert.match(route, /stockQty: 0/, "остаток не заводим — приход будет строкой поставки");
});

test("карточка и склад знают про формат позиции", () => {
  const queries = fs.readFileSync("src/lib/supabase-queries.ts", "utf8");
  assert.match(queries, /isService: row\.is_service === true,/);
  assert.match(queries, /is_service: normalizeServiceFlag\(data\.isService\),/);
  assert.match(queries, /isService: "is_service",/);
  assert.match(queries, /payload\.is_service = normalizeServiceFlag\(data\.isService\);/);
  // БД без миграции не должна падать: есть ретраи и на записи, и на обновлении.
  assert.match(queries, /isMissingServiceColumnError\(first\.error\)/);
  assert.match(queries, /isMissingServiceColumnError\(error\) && "is_service" in payload/);

  const warehouse = fs.readFileSync("src/lib/warehouse.ts", "utf8");
  assert.match(warehouse, /async function serviceProductIdsOf/, "должен быть общий определитель услуг");
  assert.match(warehouse, /normalizeServiceFlag\(\(product as any\)\.is_service\)\) return;/, "adjustStock пропускает услугу");
  assert.match(warehouse, /filterStockAffectingItems\(list, services\)/, "applyStockDelta не трогает услуги");
  assert.match(warehouse, /isService: row\.is_service === true,/);
  assert.match(warehouse, /Услуга не имеет склада/, "ручная правка остатка по услуге должна объяснять причину");

  const form = fs.readFileSync("src/components/admin/ProductFormClient.tsx", "utf8");
  assert.match(form, /isService: isServiceChecked,/);
  assert.match(form, /isVisible: isServiceChecked \? false :/, "услугу на сайт не пускаем");
  assert.match(form, /\.\.\.\(isServiceChecked\s*\n?\s*\? \{\}\s*\n?\s*: \{/, "остаток при отметке услуги не переписывается");

  const picker = fs.readFileSync("src/components/admin/ProductPicker.tsx", "utf8");
  assert.match(picker, /onPick: \(p: PickerProduct, quantity\?: number\) => void;/);
  assert.match(picker, /fetch\("\/api\/admin\/products\/quick"/, "пикер умеет создавать позицию сам");
  assert.match(picker, /isService\?: boolean \| null;/);

  const manager = fs.readFileSync("src/components/admin/WarehouseManager.tsx", "utf8");
  assert.match(manager, /stockRowsAll\.filter\(\(row\) => !row\.isService\)/, "в остатках услуг нет");
  assert.match(manager, /serviceProductIds\.has\(String\(it\?\.productId \|\| ""\)\)/, "дефицит по услугам не считаем");
});
