// =========================================================
// FILE: src/lib/sql-dump-service.ts
// Серверная сборка SQL-дампа данных: снимок → текст файла.
//
// Источник снимка:
//   • "primary" | "secondary" — Supabase через RPC sgt_export_app_data();
//   • "local" — рабочая копия на этом ПК (работает и без БД, и без интернета,
//     поэтому дамп доступен даже во время аварии).
// Порядок вставки таблиц берётся из внешних ключей файла схемы
// (`supabase/FULL_DATABASE_MIGRATION.sql`); если файла нет — порядок
// алфавитный, об этом скажет warning в ответе.
// =========================================================
import fs from "node:fs";
import path from "node:path";
import { captureFullSnapshot } from "./full-backup";
import { resolveSupabaseCredentials, type DbBackendMode } from "./db-runtime-config";
import { isPcLocalServer, readConfiguredPcSnapshot } from "./pc-local-runtime";
import { buildSqlDataDump, foreignKeyParentsFromSql, type SqlDumpResult } from "./sql-data-dump";

export type SqlDumpSource = Extract<DbBackendMode, "primary" | "secondary"> | "local";
export const SQL_DUMP_SOURCES: SqlDumpSource[] = ["primary", "secondary", "local"];

export function isSqlDumpSource(value: unknown): value is SqlDumpSource {
  return value === "primary" || value === "secondary" || value === "local";
}

export type SqlDumpBundle = SqlDumpResult & { source: SqlDumpSource; sourceLabel: string; exportedAt: string };

const SCHEMA_FILE = path.join("supabase", "FULL_DATABASE_MIGRATION.sql");

function readSchemaSql(): { sql: string; note: string | null } {
  try {
    return { sql: fs.readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), SCHEMA_FILE), "utf8"), note: null };
  } catch {
    // Локальный запуск без репозитория (или образ без supabase/): порядок станет алфавитным.
    return { sql: "", note: "Файл схемы FULL_DATABASE_MIGRATION.sql не найден — порядок таблиц в дампе алфавитный." };
  }
}

export function sqlDumpSourceLabel(source: SqlDumpSource): string {
  if (source === "local") return "Локальная копия на этом ПК";
  return resolveSupabaseCredentials(source).label;
}

export async function createSqlDataDump(options: { source: SqlDumpSource; verify?: boolean }): Promise<SqlDumpBundle> {
  const source = options.source;
  let snapshot: unknown;
  if (source === "local") {
    if (!isPcLocalServer()) throw new Error("Локальная копия доступна только при запуске сайта на этом ПК (SGT_PC_LOCAL_SERVER=1). Для выгрузки с Supabase выберите базу №1 или №2.");
    snapshot = readConfiguredPcSnapshot();
  } else {
    snapshot = await captureFullSnapshot(source);
  }
  const { sql: schemaSql, note } = readSchemaSql();
  const parsed = schemaSql ? foreignKeyParentsFromSql(schemaSql) : {};
  // Пустая карта означает «файл схемы не разобрался»: тогда работает статическая
  // карта проекта, а не алфавитный порядок.
  const fromFile = Object.keys(parsed).length ? parsed : undefined;
  const result = buildSqlDataDump(snapshot, {
    foreignKeyParents: fromFile,
    sourceLabel: sqlDumpSourceLabel(source),
    verify: options.verify !== false,
  });
  const extra = [note, fromFile ? null : "Внешние ключи не найдены в файле схемы — использован порядок из статической карты проекта."].filter(Boolean) as string[];
  const warnings = [...result.warnings, ...extra];
  const exportedAt = typeof (snapshot as { exportedAt?: unknown }).exportedAt === "string" ? (snapshot as { exportedAt: string }).exportedAt : "";
  return { ...result, warnings, source, sourceLabel: sqlDumpSourceLabel(source), exportedAt };
}
