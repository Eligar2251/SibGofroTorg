#!/usr/bin/env node
// =========================================================
// FILE: scripts/build-full-migration.mjs
// Собирает ЕДИНЫЙ идемпотентный SQL-скрипт всей БД СибГофроТорг
// (`supabase/FULL_DATABASE_MIGRATION.sql`) из `supabase/schema.sql`
// и всех инкрементальных `supabase/migration_*.sql` в правильном
// порядке зависимостей, с защитой триггеров `DROP TRIGGER IF EXISTS`
// и финальной консолидацией CHECK-ограничений, RPC, RLS и Realtime.
// =========================================================

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SUPABASE_DIR = path.join(ROOT, "supabase");
const OUTPUT_PATH = path.join(SUPABASE_DIR, "FULL_DATABASE_MIGRATION.sql");

// Строгий топологический порядок миграций после базовой schema.sql
const ORDERED_MIGRATIONS = [
  // 1. Роли, сотрудники, навигация, журнал, синхронизация локалки и права владельца
  "migration_rbac_logs.sql",
  "migration_admin_nav_layouts.sql",
  "migration_admin_lawyer_role.sql",
  "migration_owner_role_and_money.sql",
  "migration_local_db_sync_and_emergency_auth.sql",

  // 2. Каталог, размеры, штрихкоды, связки, главная, согласие ПДн
  "migration_dimension_profiles.sql",
  "migration_cuttable.sql",
  "migration_made_to_order_min_qty.sql",
  "migration_product_barcodes.sql",
  "migration_product_links.sql",
  "migration_product_sale.sql",
  "migration_product_volume_and_label_colors.sql",
  "migration_purchase_price.sql",
  "migration_stock_sync.sql",
  "migration_home_tiles.sql",
  "migration_consent_log.sql",
  "migration_client_requests.sql",

  // 3. Заявки сайта и доставки
  "migration_deliveries.sql",
  "migration_order_ready_status.sql",
  "migration_order_in_delivery_status.sql",
  "migration_order_issue.sql",

  // 4. Склад, поставки, заказы учёта, комплектация, перевозки
  "migration_counterparty_cash.sql",
  "migration_price_tiers.sql",
  "migration_consignment_receipts.sql",
  "migration_consignment_manual.sql",
  "migration_partial_receipts.sql",
  "migration_partial_shipping.sql",
  "migration_transports.sql",
  "migration_receipt_transport_link.sql",
  "migration_receipt_debts.sql",
  "migration_deal_delivery_vat.sql",
  "migration_delivery_driver.sql",
  "migration_delivery_items.sql",
  "migration_deal_internal.sql",
  "migration_deal_reservation.sql",
  "migration_deal_archive_forecast.sql",
  "migration_supply_plans.sql",
  "migration_purchase_plans.sql",
  "migration_purchase_plan_images.sql",
  "migration_purchase_plan_ozon.sql",
  "migration_purchase_plan_spend.sql",
  "migration_purchase_payments.sql",
  "migration_warehouse_assemblies.sql",
  "migration_warehouse_product_history_indexes.sql",

  // 5. Банк, касса, 1С, карты, табели охраны
  "migration_1c_client_bank.sql",
  "migration_bank_account_transfers.sql",
  "migration_payment_balance_flags.sql",
  "migration_payment_cash_destination.sql",
  "migration_cash_collections.sql",
  "migration_cash_collection_expenses.sql",
  "migration_cash_collection_split.sql",
  "migration_vm_card.sql",
  "migration_duty_schedule_storage.sql",

  // 6. Калькулятор штанцформ (ML / расчёт)
  "migration_die_calc.sql",

  // 7. Управленческий учёт аренды
  "migration_rent_accounting.sql",
  "migration_rent_building.sql",
  "migration_rent_electricity.sql",

  // 8. Отдельный учёт макулатуры
  "migration_wastepaper_account.sql",
  "migration_wastepaper_branches_items.sql",
  "migration_wastepaper_products_payments.sql",
  "migration_wastepaper_third_party_funds.sql",
  "migration_wp_account_transfers.sql",
  "migration_wp_actual_weights.sql",
  "migration_wp_awaiting_weight.sql",
  "migration_wp_payment_details.sql",
  "migration_wp_payment_links.sql",
  "migration_wp_products_code.sql",
  "migration_wp_stock_manual.sql",
  "migration_wp_transport_link.sql",
  "migration_wp_transport_done.sql",

  // 9. Безопасность RLS, Security Invoker для вьюх и публикация Realtime
  "migration_rls_public_tables.sql",
  "migration_rls_users_orders.sql",
  "migration_fix_die_calc_view_security_invoker.sql",
  "migration_complete_app_backup.sql",
  "migration_realtime_admin.sql",
];

// Проверяем, что ни один файл migration_*.sql не забыт
const allMigrationFiles = fs
  .readdirSync(SUPABASE_DIR)
  .filter((f) => f.startsWith("migration_") && f.endsWith(".sql"))
  .sort();

const orderedSet = new Set(ORDERED_MIGRATIONS);
for (const file of allMigrationFiles) {
  if (!orderedSet.has(file)) {
    ORDERED_MIGRATIONS.push(file);
  }
}

/**
 * Делает каждый `CREATE TRIGGER <name> ... ON <table>` идемпотентным,
 * если непосредственно перед ним ещё нет `DROP TRIGGER IF EXISTS <name> ON <table>`.
 */
function makeTriggersIdempotent(sql) {
  return sql.replace(
    /(?<!DROP\s+TRIGGER\s+IF\s+EXISTS\s+\w+\s+ON\s+\w+;\s*\n?)CREATE\s+TRIGGER\s+([a-z0-9_]+)\s+((?:BEFORE|AFTER|INSTEAD\s+OF)[\s\S]*?\bON\s+([a-z0-9_.]+))/gi,
    (match, trigName, rest, tableName, offset, full) => {
      const lookbehind = full.slice(Math.max(0, offset - 180), offset);
      const dropRe = new RegExp(
        `DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${trigName}\\b`,
        "i"
      );
      if (dropRe.test(lookbehind)) return match;
      return `DROP TRIGGER IF EXISTS ${trigName} ON ${tableName};\nCREATE TRIGGER ${trigName} ${rest}`;
    }
  );
}

/**
 * Делает `CREATE POLICY <name> ON <table>` идемпотентным через `DROP POLICY IF EXISTS`.
 */
function makePoliciesIdempotent(sql) {
  return sql.replace(
    /CREATE\s+POLICY\s+("?[a-z0-9_]+"?)\s+ON\s+([a-z0-9_.]+)/gi,
    (match, policyName, tableName, offset, full) => {
      const lookbehind = full.slice(Math.max(0, offset - 180), offset);
      const cleanName = policyName.replace(/"/g, "");
      const dropRe = new RegExp(
        `DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"?${cleanName}"?\\s+ON`,
        "i"
      );
      if (dropRe.test(lookbehind)) return match;
      return `DROP POLICY IF EXISTS ${policyName} ON ${tableName};\n${match}`;
    }
  );
}

/** Убирает чисто диагностические SELECT в конце отдельных миграций. */
function stripDiagnosticSelects(sql, filename) {
  if (filename === "migration_owner_role_and_money.sql") {
    return sql.replace(/--\s*──\s*3\.\s*Проверка[\s\S]*$/i, "");
  }
  return sql;
}

const chunks = [];

chunks.push(`-- =====================================================================
-- ПОЛНАЯ ЕДИНАЯ МИГРАЦИЯ БАЗЫ ДАННЫХ СИБГОФРОТОРГ (PostgreSQL / Supabase)
-- Файл: supabase/FULL_DATABASE_MIGRATION.sql
--
-- Назначение:
--   Полное развёртывание ИЛИ обновление схемы БД в 1 запуск для переезда
--   на облачный Supabase (Supabase Cloud) или любой self-hosted Supabase.
--
-- Включает абсолютно ВСЕ миграции проекта (schema.sql + все ${ORDERED_MIGRATIONS.length} файла
-- migration_*.sql, включая прошлые и текущие пул-реквесты/мержи):
--   • Все 58 таблиц проекта (каталог, связки карточек product_link_groups,
--     заказы, склад, поставки, КМП-комплектации warehouse_assemblies,
--     перевозки, банк, касса, зарплаты, табели, штанцформы, аренда,
--     макулатура, журнал синхронизации локальной БД db_sync_runs и др.)
--   • Все представления с security_invoker = true (die_calc_job_stats), индексы и GIN-индексы
--   • Все функции и RPC (fn_next_counter, increment_review_helpful,
--     sync_product_in_stock, calculate_product_box_volume, fn_update_product_rating,
--     fn_increment_view_count, update_updated_at_column)
--   • Все триггеры, RLS-политики безопасности (152-ФЗ) и публикации Realtime
--
-- Скрипт на 100% ИДЕМПОТЕНТЕН: безопасно запускать как на чистой БД,
-- так и поверх существующей базы данных.
--
-- Как применить в облачном Supabase:
--   1. Откройте Supabase Dashboard → SQL Editor → New query
--   2. Вставьте содержимое этого файла целиком и нажмите Run
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
`);

// 1. Базовая схема
const baseSchemaRaw = fs.readFileSync(
  path.join(SUPABASE_DIR, "schema.sql"),
  "utf8"
);
chunks.push(
  `\n-- =====================================================================\n-- БАЗОВАЯ СХЕМА (supabase/schema.sql)\n-- =====================================================================\n` +
    makePoliciesIdempotent(makeTriggersIdempotent(baseSchemaRaw))
);

// 2. Все инкрементальные миграции
for (const file of ORDERED_MIGRATIONS) {
  const fullPath = path.join(SUPABASE_DIR, file);
  if (!fs.existsSync(fullPath)) continue;
  const raw = fs.readFileSync(fullPath, "utf8");
  const cleaned = makePoliciesIdempotent(
    makeTriggersIdempotent(stripDiagnosticSelects(raw, file))
  );
  chunks.push(
    `\n-- =====================================================================\n-- МИГРАЦИЯ: ${file}\n-- =====================================================================\n` +
      cleaned
  );
}

// 3. Финальная консолидация RPC, CHECK-ограничений, счётчиков и Realtime
chunks.push(`
-- =====================================================================
-- ФИНАЛЬНАЯ КОНСОЛИДАЦИЯ ОГРАНИЧЕНИЙ, RPC, СЧЁТЧИКОВ И REALTIME
-- Гарантирует, что объединённые наборы ролей и статусов полные.
-- =====================================================================

-- 1. Полный список ролей сотрудников админки (включая owner и wastepaper)
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
UPDATE admins SET role = 'admin' WHERE role IS NULL;
ALTER TABLE admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'lawyer', 'wastepaper'));

-- 2. Полный список статусов заявок с сайта (включая ready, in_delivery, issued)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'new',
    'confirmed',
    'processing',
    'in_progress',
    'ready',
    'in_delivery',
    'shipped',
    'issued',
    'completed',
    'cancelled',
    'rejected'
  ));

-- 3. Разметка сдачи кассы для третьей кассы (Карта В.М.)
ALTER TABLE bank_payments DROP CONSTRAINT IF EXISTS bank_payments_cash_destination_check;
ALTER TABLE bank_payments
  ADD CONSTRAINT bank_payments_cash_destination_check
  CHECK (cash_destination IN ('cash', 'card', 'vm_card'));

-- 4. RPC атомарного инкремента «Отзыв полезен»
CREATE OR REPLACE FUNCTION increment_review_helpful(review_id_param UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INT;
BEGIN
  UPDATE product_reviews
  SET helpful_count = COALESCE(helpful_count, 0) + 1
  WHERE id = review_id_param
  RETURNING helpful_count INTO new_count;
  RETURN COALESCE(new_count, 0);
END;
$$;

-- 5. Инициализация всех счётчиков документов
INSERT INTO doc_counters (key, value) VALUES
  ('receipt', 0),
  ('deal', 0),
  ('payment', 0),
  ('transport', 0),
  ('warehouse_assembly', 0),
  ('wp_intake', 0),
  ('wp_shipment', 0),
  ('wp_payment', 0),
  ('wp_transport', 0)
ON CONFLICT (key) DO NOTHING;

-- 6. Включение публикации Supabase Realtime для всех живых таблиц админки
DO $$
DECLARE
  t TEXT;
  wanted TEXT[] := ARRAY[
    'orders',
    'wastepaper_requests',
    'client_requests',
    'customer_deals',
    'warehouse_receipts',
    'warehouse_assemblies',
    'bank_payments',
    'bank_account_transfers',
    'salaries',
    'cash_collections',
    'products',
    'transports',
    'product_reviews',
    'product_questions',
    'activity_logs',
    'db_sync_runs',
    'rent_invoices',
    'rent_payments',
    'rent_meter_readings',
    'wp_intakes',
    'wp_shipments',
    'wp_payments',
    'wp_transports',
    'wp_counterparties',
    'wp_stock_adjustments',
    'wp_account_transfers'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY wanted LOOP
      IF EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- 7. Обновление кэша схемы PostgREST
NOTIFY pgrst, 'reload schema';
`);

const finalSql = chunks.join("\n");
fs.writeFileSync(OUTPUT_PATH, finalSql, "utf8");

const createdTables = new Set(
  [
    ...finalSql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+)/gi
    ),
  ].map((m) => m[1].toLowerCase())
);

console.log(
  `Built ${OUTPUT_PATH}: ${finalSql.split("\n").length} lines, ${createdTables.size} tables.`
);
