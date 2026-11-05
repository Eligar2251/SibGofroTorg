// =========================================================
// FILE: tests/local-json-db-and-switcher.test.mjs
// Тесты автономной локальной JSON-БД, резервного копирования,
// переключения серверов БД в админке, Auto-Failover и единого
// SQL-скрипта миграции FULL_DATABASE_MIGRATION.sql.
// Запуск: npm run test:local-db
// =========================================================

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Изолированная временная папка для тестов, чтобы не мусорить в рабочем дереве
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sgt-local-db-test-"));
process.env.SGT_DATA_DIR = tmpDir;

const {
  ORDERED_BACKUP_TABLES,
  exportLocalDbSnapshot,
  getLocalDbSummary,
  getLocalJsonDbClient,
  importLocalDbSnapshot,
  pushLocalDbToRemoteSupabase,
  replayPendingMutationsToRemoteSupabase,
  resetLocalJsonDbCache,
  syncBidirectionalSupabaseAndLocal,
  syncRemoteSupabaseToLocal,
} = await import("../src/lib/local-json-db.ts");

const {
  SGT_LOCAL_DB_AUTH_STANDARD,
  verifyLocalDbEmergencyDocument,
} = await import("../src/lib/local-db-secret.ts");

const {
  getDbFailoverState,
  getDbRuntimeConfig,
  resetDbRuntimeConfigCache,
  resolveSupabaseCredentials,
  saveDbRuntimeConfig,
  toPublicDbConfigView,
} = await import("../src/lib/db-runtime-config.ts");

const { getAdminDb } = await import("../src/lib/supabase.ts");

const {
  getAutoBackupStatus,
  restoreDiskBackupSnapshot,
  runServerAutoBackupNow,
  stopAutoBackupScheduler,
  validateBackupDirectory,
} = await import("../src/lib/auto-backup-scheduler.ts");

const customUserDiskDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "sgt-user-backup-disk-")
);

test.after(() => {
  stopAutoBackupScheduler();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(customUserDiskDir, { recursive: true, force: true });
});

test("LocalJsonSupabaseClient: триггеры products (in_stock, volume), фильтры PostgREST (.contains, .or, .range, count) и RPC", async () => {
  resetLocalJsonDbCache();
  const db = getLocalJsonDbClient();

  // 1. Вставка товаров: проверка авто-UUID, sync_product_in_stock и calculate_product_box_volume
  const { data: p1, error: e1 } = await db
    .from("products")
    .insert({
      name: "Гофрокороб 600×400×400 Т-24 бурый",
      slug: "korob-600-400-400",
      sku: "KB-600",
      price: 58,
      stock_qty: 120,
      dimension_length: 600,
      dimension_width: 400,
      dimension_height: 400,
      dimension_unit: "мм",
    })
    .select("*")
    .single();

  assert.equal(e1, null);
  assert.ok(p1.id);
  assert.equal(p1.in_stock, true);
  // 600 * 400 * 400 / 1_000_000 = 96 л
  assert.equal(p1.volume, 96);

  const { data: p2 } = await db
    .from("products")
    .insert({
      name: "Гофролист Т-23 белый",
      slug: "list-t23-white",
      sku: "GL-23",
      price: 42,
      stock_qty: 0.4,
    })
    .select("*")
    .single();
  assert.equal(p2.in_stock, false);

  // 2. count: exact + head: true
  const headRes = await db
    .from("products")
    .select("id", { count: "exact", head: true });
  assert.equal(headRes.data, null);
  assert.equal(headRes.count, 2);

  // 3. .or(...) с ilike и eq
  const { data: orMatches } = await db
    .from("products")
    .select("id, sku")
    .or("name.ilike.%белый%,sku.eq.KB-600")
    .order("price", { ascending: true });
  assert.equal(orMatches.length, 2);
  assert.equal(orMatches[0].sku, "GL-23");

  // 4. .contains(...) с JSON-строкой (как в warehouse.ts getProductStockSummary)
  await db.from("warehouse_receipts").insert({
    id: "rec-100",
    number: 100,
    date: "2026-11-01",
    supplier: "ООО ГофроПак",
    status: "posted",
    items: [{ productId: p1.id, name: p1.name, quantity: 50, price: 32 }],
  });

  const { data: matchedReceipts } = await db
    .from("warehouse_receipts")
    .select("id, number")
    .contains("items", JSON.stringify([{ productId: p1.id }]));
  assert.equal(matchedReceipts.length, 1);
  assert.equal(matchedReceipts[0].number, 100);

  // 5. Составной upsert (onConflict: "counterparty_id,product_id")
  await db
    .from("supplier_prices")
    .upsert(
      { counterparty_id: "cp-1", product_id: p1.id, price: 30 },
      { onConflict: "counterparty_id,product_id" }
    );
  await db
    .from("supplier_prices")
    .upsert(
      { counterparty_id: "cp-1", product_id: p1.id, price: 34 },
      { onConflict: "counterparty_id,product_id" }
    );
  const { data: spRows } = await db.from("supplier_prices").select("*");
  assert.equal(spRows.length, 1);
  assert.equal(spRows[0].price, 34);

  // 6. RPC fn_next_counter: видит уже существующий ПО-100 и выдаёт 101!
  const { data: nextRecNo } = await db.rpc("fn_next_counter", {
    p_key: "receipt",
  });
  assert.equal(nextRecNo, 101);
});

test("Экспорт/импорт JSON-бэкапа и двусторонняя синхронизация с удалённым клиентом", async () => {
  const snap = exportLocalDbSnapshot();
  assert.equal(snap.app, "SibGofroTorg");
  assert.ok(snap.totalRows >= 4);

  // Проверим выгрузку локального бэкапа в мок-клиент «облачного Supabase #2»
  const remoteMemory = {};
  const mockCloudSupabase = {
    from(table) {
      return {
        select() {
          return {
            async range(from, to) {
              const arr = remoteMemory[table] || [];
              return { data: arr.slice(from, to + 1), error: null };
            },
          };
        },
        async upsert(batch, options) {
          const keys = (options?.onConflict || "id").split(",");
          remoteMemory[table] ||= [];
          for (const row of batch) {
            const index = remoteMemory[table].findIndex((existing) => keys.every((key) => existing[key] === row[key]));
            if (index === -1) remoteMemory[table].push(row);
            else remoteMemory[table][index] = row;
          }
          return { data: batch, error: null };
        },
      };
    },
  };

  const pushRes = await pushLocalDbToRemoteSupabase(mockCloudSupabase);
  assert.equal(pushRes.failedTables.length, 0);
  assert.ok(pushRes.pushedRows >= 4);
  assert.equal(remoteMemory.products.length, 2);

  // Добавим новую запись на «удалённом сервере» и снимем полный снимок обратно в JSON
  remoteMemory.products.push({
    id: "cloud-prod-3",
    name: "Скотч упаковочный 48мм",
    slug: "skotch-48",
    price: 95,
    stock_qty: 50,
    in_stock: true,
  });

  const syncRes = await syncRemoteSupabaseToLocal(
    mockCloudSupabase,
    "Supabase Cloud Test"
  );
  assert.equal(syncRes.failedTables.length, 0);
  assert.equal(syncRes.summary.tableCounts.products, 3);

  // Импорт сохранённого снапшота в режиме replace возвращает прежнее число товаров (2)
  const restored = importLocalDbSnapshot(snap, "replace");
  assert.equal(restored.tableCounts.products, 2);
  assert.ok(getLocalDbSummary().exists);
});

test("При отказе Supabase серверный локальный файл не становится рабочей БД и доступен только для чтения", async () => {
  resetDbRuntimeConfigCache();

  // 1. Включаем режим Primary с заведомо недоступным портом (имитация упавшего сервера БД)
  saveDbRuntimeConfig({
    activeBackend: "primary",
    autoFailover: true,
    mirrorWritesToLocal: true,
    primary: {
      label: "Упавший Бегет Supabase",
      url: "http://127.0.0.1:1",
      serviceRoleKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret_test_key_1234",
      anonKey: "",
    },
    secondary: {
      label: "Supabase Cloud",
      url: "",
      serviceRoleKey: "",
      anonKey: "",
    },
  });

  // Секретный ключ замаскирован в публичном представлении
  const pubView = toPublicDbConfigView();
  assert.ok(pubView.primary.serviceRoleKeyMasked.includes("••••"));
  assert.ok(!pubView.primary.serviceRoleKeyMasked.includes("secret_test_key"));

  // Запрос через единый getAdminDb() НЕ падает 500-ошибкой, а уходит в Auto-Failover на JSON-БД!
  const adminDb = getAdminDb();
  const { data: products, error } = await adminDb
    .from("products")
    .select("id, name");

  assert.equal(error.code, "DB_UNAVAILABLE");
  assert.equal(products, null);
  assert.notEqual(getDbFailoverState().activeFallbackBackend, "local");
  saveDbRuntimeConfig({ activeBackend: "local" });
  const read = await adminDb.from("products").select("id, name");
  assert.equal(read.error, null);
  assert.equal(read.data.length, 2);
  const prior = fs.readFileSync(path.join(tmpDir, "local-db.json"), "utf8");
  const write = await adminDb.from("settings").upsert({ key: "company_name", value: "СибГофроТорг" });
  assert.equal(write.error.code, "LOCAL_SERVER_DISABLED");
  assert.equal(fs.readFileSync(path.join(tmpDir, "local-db.json"), "utf8"), prior);
});

test("Successful remote reads and writes never mirror into old server JSON", async () => {
  const oldFetch = globalThis.fetch;
  const names = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECONDARY_URL"];
  const previous = names.map(n => process.env[n]);
  try {
    names.forEach(n => delete process.env[n]);
    saveDbRuntimeConfig({ activeBackend:"primary", autoFailover:false, mirrorWritesToLocal:true,
      primary:{url:"https://example.test",serviceRoleKey:"synthetic-key"} });
    const file = path.join(tmpDir, "local-db.json");
    const before = fs.readFileSync(file, "utf8");
    globalThis.fetch = async () => new Response(JSON.stringify([{id:"new",name:"changed"}]), {status:200,headers:{"content-type":"application/json"}});
    assert.equal((await getAdminDb().from("admins").select("*")).error, null);
    assert.equal((await getAdminDb().from("products").insert({id:"new",name:"changed"})).error, null);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  } finally {
    globalThis.fetch = oldFetch;
    names.forEach((n,i) => previous[i] === undefined ? delete process.env[n] : process.env[n] = previous[i]);
  }
});

test("supabase/FULL_DATABASE_MIGRATION.sql содержит все 58 таблиц проекта и дублирует ВСЕ migration_*.sql", () => {
  const sqlPath = path.join(
    process.cwd(),
    "supabase",
    "FULL_DATABASE_MIGRATION.sql"
  );
  assert.equal(fs.existsSync(sqlPath), true);
  const sql = fs.readFileSync(sqlPath, "utf8");

  for (const table of ORDERED_BACKUP_TABLES) {
    assert.match(
      sql,
      new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\b`, "i"),
      `Таблица ${table} должна присутствовать в FULL_DATABASE_MIGRATION.sql`
    );
  }

  // Проверяем, что ВСЕ инкрементальные миграции из supabase/ продублированы в едином файле
  const allMigrations = fs
    .readdirSync(path.join(process.cwd(), "supabase"))
    .filter((f) => f.startsWith("migration_") && f.endsWith(".sql"));

  assert.ok(allMigrations.length >= 73);
  for (const mig of allMigrations) {
    assert.equal(
      sql.includes(`МИГРАЦИЯ: ${mig}`),
      true,
      `Файл миграции ${mig} должен быть включён в FULL_DATABASE_MIGRATION.sql`
    );
  }

  assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+fn_next_counter/i);
  assert.match(
    sql,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+increment_review_helpful/i
  );
  assert.match(sql, /CREATE\s+OR\s+REPLACE\s+VIEW\s+die_calc_job_stats/i);
});

test("Серверные плановые и ручные бэкапы отключены без удаления старых файлов", async () => {
  fs.mkdirSync(customUserDiskDir, { recursive: true });
  const existing = path.join(customUserDiskDir, "old.json");
  fs.writeFileSync(existing, "legacy-data");
  saveDbRuntimeConfig({ activeBackend:"local", autoBackupEnabled:true, customBackupDir:customUserDiskDir });
  const result = await runServerAutoBackupNow({ force:true });
  assert.equal(result.ok, false);
  assert.match(result.error, /отключены/);
  assert.equal(getAutoBackupStatus().enabled, false);
  assert.equal(fs.readFileSync(existing, "utf8"), "legacy-data");
  assert.equal(fs.existsSync(path.join(customUserDiskDir, "sibgofrotorg-latest.json")), false);
});

test("Двусторонняя синхронизация Supabase ↔ Локалка: очередь офлайн-правок/удалений не теряется при восстановлении БД", async () => {
  // Independent initial state: earlier tests deliberately leave offline writes.
  importLocalDbSnapshot({ tables: {}, pendingMutations: [] }, "replace");
  const localDb = getLocalJsonDbClient();

  // Создаём изолированный «удалённый сервер Supabase» на базе второго экземпляра памяти
  const remoteTables = {
    products: [
      { id: "rem-1", name: "Коробка с сервера", price: 25, stock_qty: 100 },
      { id: "rem-to-delete", name: "Удалить офлайн", price: 10, stock_qty: 5 },
    ],
    doc_counters: [{ key: "deal", value: 42 }],
  };

  const fakeRemoteSupabase = {
    from(table) {
      if (!remoteTables[table]) remoteTables[table] = [];
      let delFilters = [];
      let eqFilter = null;
      return {
        select() {
          return {
            eq(col, val) {
              eqFilter = { col, val };
              return this;
            },
            async maybeSingle() {
              const found = remoteTables[table].find(
                (r) => !eqFilter || r[eqFilter.col] === eqFilter.val
              );
              return { data: found || null, error: null };
            },
            async range(from, to) {
              return {
                data: remoteTables[table].slice(from, to + 1),
                error: null,
              };
            },
            then(resolve) {
              return Promise.resolve({
                data: remoteTables[table],
                error: null,
              }).then(resolve);
            },
          };
        },
        async upsert(rows, opts) {
          const pkCols = (opts?.onConflict || "id").split(",");
          for (const row of rows) {
            const idx = remoteTables[table].findIndex((ex) =>
              pkCols.every((c) => String(ex[c]) === String(row[c]))
            );
            if (idx >= 0) remoteTables[table][idx] = { ...remoteTables[table][idx], ...row };
            else remoteTables[table].push({ ...row });
          }
          return { data: rows, error: null };
        },
        delete() {
          return {
            eq(col, val) {
              delFilters.push({ col, val });
              return this;
            },
            then(resolve) {
              remoteTables[table] = remoteTables[table].filter(
                (r) => !delFilters.every((f) => String(r[f.col]) === String(f.val))
              );
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
        },
      };
    },
  };

  // 1. Первичный экспорт из Supabase → в локалку
  await syncRemoteSupabaseToLocal(fakeRemoteSupabase, "Test Cloud", {
    replayPendingFirst: false,
  });
  assert.equal(getLocalDbSummary().tableCounts.products, 2);
  assert.equal(getLocalDbSummary().pendingMutationsCount, 0);

  // 2. Во время «падения» Supabase создаём новый товар офлайн и удаляем старый в локалке
  await localDb.from("products").insert({
    id: "offline-created-1",
    name: "Создана офлайн при упавшей БД",
    price: 55,
    stock_qty: 300,
  });
  await localDb.from("products").delete().eq("id", "rem-to-delete");

  assert.equal(getLocalDbSummary().pendingMutationsCount, 2);

  // 3. Одновременно на сервере кто-то добавил товар rem-2
  remoteTables.products.push({
    id: "rem-2",
    name: "Новый серверный товар",
    price: 40,
    stock_qty: 50,
  });

  // 4. Запускаем двустороннюю синхронизацию: офлайн-вставка и офлайн-удаление уходят в Supabase,
  //    а rem-2 скачивается в локалку!
  const bi = await syncBidirectionalSupabaseAndLocal(
    fakeRemoteSupabase,
    "Test Cloud"
  );

  assert.equal(bi.replayedUpserts, 1);
  assert.equal(bi.replayedDeletes, 1);
  assert.equal(getLocalDbSummary().pendingMutationsCount, 0);

  const remoteIds = remoteTables.products.map((p) => p.id).sort();
  assert.deepEqual(remoteIds, ["offline-created-1", "rem-1", "rem-2"]);

  const { data: localAfterSync } = await localDb
    .from("products")
    .select("id")
    .order("id");
  assert.deepEqual(
    localAfterSync.map((p) => p.id),
    ["offline-created-1", "rem-1", "rem-2"]
  );
});

test("Аварийный беспарольный вход по локальному файлу БД: стандартный секретный код, полный путь и защита от подделки", async () => {
  const localDb = getLocalJsonDbClient();
  await localDb.from("admins").upsert(
    {
      id: "adm-owner-1",
      username: "vadim_owner",
      role: "owner",
      display_name: "Вадим (Владелец)",
      is_active: true,
    },
    { onConflict: "id" }
  );

  const expectedDiskPath = "D:\\SibGofroBackup\\sibgofrotorg-latest.json";
  const snapshot = exportLocalDbSnapshot(expectedDiskPath);

  // 1. В документе по стандарту присутствуют секретный код, подпись и полный путь файла
  assert.ok(snapshot.secretAccessCode?.startsWith("SGT-KEY-"));
  assert.equal(snapshot.fileFullPath, expectedDiskPath);
  assert.equal(
    snapshot.sgtEmergencyAuth?.standard,
    SGT_LOCAL_DB_AUTH_STANDARD
  );

  // 2. Подлинный файл успешно проходит проверку, считывает полный путь и аккаунт владельца
  const okCheck = verifyLocalDbEmergencyDocument(snapshot);
  assert.equal(okCheck.valid, true);
  assert.equal(okCheck.embeddedFullPath, expectedDiskPath);
  assert.equal(okCheck.adminAccount.username, "vadim_owner");
  assert.equal(okCheck.adminAccount.role, "owner");

  // 3. Файл без секретного кода отклоняется
  const withoutSecret = { ...snapshot, secretAccessCode: undefined, sgtEmergencyAuth: undefined };
  const noSecretCheck = verifyLocalDbEmergencyDocument(withoutSecret);
  assert.equal(noSecretCheck.valid, false);
  assert.match(noSecretCheck.error || "", /секретный код/i);

  // 4. Чужой/поддельный секретный код отклоняется
  const forged = {
    ...snapshot,
    secretAccessCode: "SGT-KEY-0000000000000000000000000000000000000000000000000000000000000000",
    sgtEmergencyAuth: {
      ...snapshot.sgtEmergencyAuth,
      secretAccessCode: "SGT-KEY-0000000000000000000000000000000000000000000000000000000000000000",
    },
  };
  const forgedCheck = verifyLocalDbEmergencyDocument(forged);
  assert.equal(forgedCheck.valid, false);

  // 5. Файл с изменённой подписью блока авторизации отклоняется
  const tamperedSig = {
    ...snapshot,
    sgtEmergencyAuth: {
      ...snapshot.sgtEmergencyAuth,
      signature: "deadbeef".repeat(8),
    },
  };
  const tamperedCheck = verifyLocalDbEmergencyDocument(tamperedSig);
  assert.equal(tamperedCheck.valid, false);
});

test("Новые ключи Supabase (Publishable key sb_publishable_… и Secret key sb_secret_…) поддерживаются наравне с legacy", () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevPub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const prevSec = process.env.SUPABASE_SECRET_KEY;
  const prevLegacyAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const prevLegacyService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    saveDbRuntimeConfig({
      primary: { url: "", anonKey: "", serviceRoleKey: "" },
    });
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = "https://new-cloud-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_12345";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key_67890";
    resetDbRuntimeConfigCache();

    const resolved = resolveSupabaseCredentials("primary");
    assert.equal(resolved.configured, true);
    assert.equal(resolved.url, "https://new-cloud-project.supabase.co");
    assert.equal(resolved.anonKey, "sb_publishable_test_key_12345");
    assert.equal(resolved.serviceRoleKey, "sb_secret_test_key_67890");
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevPub === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = prevPub;
    if (prevSec === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = prevSec;
    if (prevLegacyAnon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevLegacyAnon;
    if (prevLegacyService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevLegacyService;
    resetDbRuntimeConfigCache();
  }
});

test("Вьюха die_calc_job_stats использует security_invoker = true, а аварийный баннер Beget подключён в макет", () => {
  const fixSql = fs.readFileSync(
    path.join(process.cwd(), "supabase", "migration_fix_die_calc_view_security_invoker.sql"),
    "utf8"
  );
  const fullSql = fs.readFileSync(
    path.join(process.cwd(), "supabase", "FULL_DATABASE_MIGRATION.sql"),
    "utf8"
  );

  assert.match(fixSql, /security_invoker\s*=\s*true/i);
  assert.match(fullSql, /CREATE OR REPLACE VIEW (?:public\.)?die_calc_job_stats\s+WITH\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
  assert.doesNotMatch(fullSql, /CREATE OR REPLACE VIEW (?:public\.)?die_calc_job_stats\s+AS\b/i);
  assert.match(fullSql, /ALTER FUNCTION public\.fn_next_counter\(TEXT\) SET search_path = public/i);

  const bannerSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "components", "layout", "BegetEmergencyBanner.tsx"),
    "utf8"
  );
  const chromeSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "components", "layout", "ConditionalChrome.tsx"),
    "utf8"
  );
  assert.match(bannerSrc, /Beget/i);
  assert.match(bannerSrc, /\+7 913 915 81 46/);
  assert.match(bannerSrc, /sk2-tdstm@mail\.ru/);
  assert.match(chromeSrc, /<BegetEmergencyBanner\s*\/>/);
});




test("VPS credentials come from current environment even after saving settings", () => {
  const names = ["SUPABASE_SECONDARY_URL", "SUPABASE_SECONDARY_SECRET_KEY", "SUPABASE_SECONDARY_PUBLISHABLE_KEY"];
  const before = names.map((n) => process.env[n]);
  try {
    saveDbRuntimeConfig({ secondary: { url: "https://old.example", serviceRoleKey: "old-key" } });
    process.env.SUPABASE_SECONDARY_URL = "https://vps.example/";
    process.env.SUPABASE_SECONDARY_SECRET_KEY = "vps-secret-1";
    process.env.SUPABASE_SECONDARY_PUBLISHABLE_KEY = "vps-pub";
    saveDbRuntimeConfig({ autoFailover: true });
    assert.equal(resolveSupabaseCredentials("secondary").url, "https://vps.example");
    process.env.SUPABASE_SECONDARY_SECRET_KEY = "vps-secret-2";
    assert.equal(resolveSupabaseCredentials("secondary").serviceRoleKey, "vps-secret-2");
    delete process.env.SUPABASE_SECONDARY_SECRET_KEY;
    assert.equal(resolveSupabaseCredentials("secondary").configured, false);
    assert.equal(resolveSupabaseCredentials("secondary").serviceRoleKey, "");
  } finally {
    names.forEach((n, i) => before[i] === undefined ? delete process.env[n] : process.env[n] = before[i]);
  }
});

test("failed and concurrent offline changes are retained during replay", async () => {
  importLocalDbSnapshot({ tables: {}, pendingMutations: [] }, "replace");
  const db = getLocalJsonDbClient();
  await db.from("products").insert({ id: "pending-race", name: "first" });
  const missing = { from: () => ({ upsert: async () => ({ error: { code: "PGRST205", message: "table missing" } }) }) };
  const fail = await replayPendingMutationsToRemoteSupabase(missing);
  assert.equal(fail.remainingMutations, 1);
  await assert.rejects(syncRemoteSupabaseToLocal(missing, "missing"), /не все локальные изменения/i);
  assert.equal(getLocalDbSummary().pendingMutationsCount, 1);
  const concurrent = { from: () => ({ upsert: async () => {
    await db.from("products").update({ name: "newer" }).eq("id", "pending-race");
    return { error: null };
  } }) };
  const res = await replayPendingMutationsToRemoteSupabase(concurrent);
  assert.equal(res.remainingMutations, 1);
  const snapshot = exportLocalDbSnapshot();
  assert.equal(snapshot.pendingMutations[0].row.name, "newer");
});

test("timeout still applies when Supabase supplies an AbortSignal", async () => {
  const { createDirectSupabaseClient } = await import("../src/lib/supabase-server-engine.ts");
  const originalFetch = globalThis.fetch;
  let seenSignal = false;
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    seenSignal = !!options.signal;
    options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  try {
    const client = createDirectSupabaseClient("https://timeout.example", "some-key", 30);
    const start = Date.now();
    const result = await client.from("products").select("*").abortSignal(new AbortController().signal);
    assert.ok(seenSignal);
    assert.ok(result.error);
    assert.ok(Date.now() - start < 3000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote failover is read-only until explicitly promoted, including RPC", async () => {
  const { recordDbFailover, clearDbFailoverState } = await import("../src/lib/db-runtime-config.ts");
  const names = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECONDARY_URL"];
  const previous = names.map((n) => process.env[n]);
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    names.forEach((n) => delete process.env[n]);
    saveDbRuntimeConfig({ activeBackend: "primary", autoFailover: true,
      primary: { url: "https://primary.example", serviceRoleKey: "primary-key" },
      secondary: { url: "https://secondary.example", serviceRoleKey: "secondary-key" } });
    recordDbFailover("secondary", "primary unavailable");
    globalThis.__sgtDbFailoverState = undefined;
    assert.equal(getDbFailoverState().activeFallbackBackend, "secondary");
    globalThis.__sgtDbFailoverState.failedAt = "2000-01-01T00:00:00.000Z";
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify([{ id: "secondary" }]), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const rows = await getAdminDb().from("products").select("*");
    const rpc = await getAdminDb().rpc("some_test_function");
    assert.equal(rows.error, null);
    assert.equal(rpc.error.code, "DB_FAILOVER_READ_ONLY");
    const mutation = await getAdminDb().from("products").update({name:"x"}).eq("id","secondary");
    assert.equal(mutation.error.code, "DB_FAILOVER_READ_ONLY");
    assert.equal(requests.length, 1);
    assert.ok(requests.every((url) => url.startsWith("https://secondary.example/")));
  } finally {
    clearDbFailoverState();
    globalThis.fetch = originalFetch;
    names.forEach((n, i) => previous[i] === undefined ? delete process.env[n] : process.env[n] = previous[i]);
  }
});

test("ambiguous remote writes and RPC are never replayed to another database", async () => {
  const { clearDbFailoverState } = await import("../src/lib/db-runtime-config.ts");
  const names = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECONDARY_URL"];
  const previous = names.map((n) => process.env[n]);
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    names.forEach((n) => delete process.env[n]);
    saveDbRuntimeConfig({ activeBackend:"primary", autoFailover:true,
      primary:{url:"https://uncertain-primary.example",serviceRoleKey:"key-primary"},
      secondary:{url:"https://uncertain-secondary.example",serviceRoleKey:"key-secondary"} });
    clearDbFailoverState();
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      if (String(url).startsWith("https://uncertain-primary.example/")) throw new Error("fetch failed: connection reset after send");
      return new Response(JSON.stringify([{id:"duplicate"}]),{status:200,headers:{"content-type":"application/json"}});
    };
    const inserted=await getAdminDb().from("products").insert({id:"one",name:"test"});
    assert.equal(inserted.error.code,"DB_WRITE_OUTCOME_UNKNOWN");
    assert.match(inserted.error.message,/могла сохраниться/);
    assert.equal(requests.length,1);
    assert.equal(getDbFailoverState().activeFallbackBackend,null);
    requests.length=0;
    const rpc=await getAdminDb().rpc("fn_next_counter",{p_key:"deal"});
    assert.equal(rpc.error.code,"DB_WRITE_OUTCOME_UNKNOWN");
    assert.equal(requests.length,1);
    assert.equal(getDbFailoverState().activeFallbackBackend,null);
  } finally {
    clearDbFailoverState(); globalThis.fetch=originalFetch;
    names.forEach((n,i)=>previous[i]===undefined ? delete process.env[n] : process.env[n]=previous[i]);
  }
});
