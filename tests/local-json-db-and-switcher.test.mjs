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
        async upsert(batch) {
          remoteMemory[table] = [...(remoteMemory[table] || []), ...batch];
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

test("Переключатель БД + Auto-Failover: при падении Supabase getAdminDb() прозрачно работает через локальную JSON-БД", async () => {
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

  assert.equal(error, null);
  assert.equal(products.length, 2);
  assert.equal(getDbFailoverState().activeFallbackBackend, "local");

  // 2. Переключаем явно в режим "local" — прямое чтение/запись в JSON-БД без сети
  saveDbRuntimeConfig({ activeBackend: "local" });
  assert.equal(getDbRuntimeConfig().activeBackend, "local");
  assert.equal(getDbFailoverState().activeFallbackBackend, null);

  const { data: insertedSetting, error: setErr } = await adminDb
    .from("settings")
    .upsert({ key: "company_name", value: "СибГофроТорг" })
    .select("*")
    .single();
  assert.equal(setErr, null);
  assert.equal(insertedSetting.value, "СибГофроТорг");
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

test("Автоматическая локальная копия каждые 2–3 минуты на указанный пользователем диск: запись, ротация и автовосстановление", async () => {
  // 1. Проверяем настройку по умолчанию (150 сек = 2,5 минуты) и привязку внешнего диска
  const check = validateBackupDirectory(customUserDiskDir);
  assert.equal(check.ok, true);

  const cfg = saveDbRuntimeConfig({
    activeBackend: "local",
    autoBackupEnabled: true,
    autoBackupIntervalSec: 150, // 2,5 минуты
    customBackupDir: customUserDiskDir,
    maxBackupSnapshots: 3,
  });

  assert.equal(cfg.autoBackupEnabled, true);
  assert.equal(cfg.autoBackupIntervalSec, 150);
  assert.equal(cfg.customBackupDir, customUserDiskDir);

  // 2. Создаём 5 архивных копий подряд и проверяем, что ротация оставила ровно 3 свежих файла
  const snapshotsDir = path.join(customUserDiskDir, "snapshots");
  fs.mkdirSync(snapshotsDir, { recursive: true });
  for (let i = 1; i <= 4; i++) {
    const fakeSnapPath = path.join(
      snapshotsDir,
      `sibgofrotorg-2026-11-03_10-0${i}-00.json`
    );
    fs.writeFileSync(
      fakeSnapPath,
      JSON.stringify(exportLocalDbSnapshot(), null, 2),
      "utf8"
    );
    const ts = new Date(Date.now() - (10 - i) * 60_000);
    fs.utimesSync(fakeSnapPath, ts, ts);
  }

  const runRes = await runServerAutoBackupNow({ force: true });
  assert.equal(runRes.ok, true);
  assert.equal(
    fs.existsSync(path.join(customUserDiskDir, "sibgofrotorg-latest.json")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(customUserDiskDir, "local-db.json")),
    true
  );

  const status = getAutoBackupStatus();
  assert.equal(status.targetDir, path.resolve(customUserDiskDir));
  assert.equal(status.intervalSec, 150);
  assert.equal(
    status.snapshotsCount,
    3,
    "Ротация должна оставить ровно maxBackupSnapshots = 3 последних снимка"
  );

  // 3. Удаляем все товары в рабочей БД, затем восстанавливаем из архивного снимка с диска
  const db = getLocalJsonDbClient();
  await db.from("products").delete().neq("id", "none");
  assert.equal((getLocalDbSummary().tableCounts.products || 0), 0);

  const restoredSummary = restoreDiskBackupSnapshot(
    status.recentSnapshots[0].filename,
    "replace"
  );
  assert.equal(restoredSummary.tableCounts.products, 2);

  // 4. Имитируем полную потерю папки приложения (.sgt-data/local-db.json удалён),
  //    но внешний диск пользователя с автобэкапом подключён — база должна подняться сама!
  const mainDbPath = path.join(tmpDir, "local-db.json");
  fs.unlinkSync(mainDbPath);
  resetLocalJsonDbCache();

  const { data: autoRecoveredProducts, error: recErr } = await db
    .from("products")
    .select("id, name");
  assert.equal(recErr, null);
  assert.equal(
    autoRecoveredProducts.length,
    2,
    "Локальная БД должна автоматически восстановиться с указанного пользователем диска бэкапа"
  );
});

test("Двусторонняя синхронизация Supabase ↔ Локалка: очередь офлайн-правок/удалений не теряется при восстановлении БД", async () => {
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

