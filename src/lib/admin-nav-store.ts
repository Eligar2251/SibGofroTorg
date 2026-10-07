// =========================================================
// FILE: src/lib/admin-nav-store.ts
// Раскладка меню админки — по одной записи на пользователя.
//
// Основное место: таблица admin_nav_layouts (миграция
// supabase/migration_admin_nav_layouts.sql). Если таблицу
// ещё не применили, пишем в settings под ключом
// admin_nav_layout:<username> — функция работает сразу,
// без ручного SQL. Оба варианта — база, не localStorage.
// =========================================================

import { getAdminDb } from "@/lib/supabase";
import {
  adminNavLayoutSettingKey,
  type AdminNavLayout,
} from "@/lib/admin-nav";

const TABLE = "admin_nav_layouts";

let tableMissingUntil = 0;

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|schema cache|Could not find the table/i.test(message)
  );
}

function assertUsername(username: string): string {
  const safe = String(username || "").trim();
  if (!safe || safe.length > 64 || /[\u0000-\u001f]/.test(safe)) {
    throw new Error("Некорректный пользователь");
  }
  return safe;
}

function parseStored(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value ?? null;
}

async function readSettings(username: string): Promise<unknown | null> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("key", adminNavLayoutSettingKey(username))
    .maybeSingle();
  if (error) throw error;
  return parseStored(data?.value);
}

async function writeSettings(username: string, layout: AdminNavLayout): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("settings").upsert({
    key: adminNavLayoutSettingKey(username),
    value: JSON.stringify(layout),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function deleteSettings(username: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db
    .from("settings")
    .delete()
    .eq("key", adminNavLayoutSettingKey(username));
  if (error) throw error;
}

async function readTable(
  username: string,
): Promise<{ ok: true; layout: unknown | null } | { ok: false }> {
  if (Date.now() < tableMissingUntil) return { ok: false };
  const db = getAdminDb();
  const { data, error } = await db
    .from(TABLE)
    .select("layout")
    .eq("username", username)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) {
      tableMissingUntil = Date.now() + 5 * 60_000;
      return { ok: false };
    }
    throw error;
  }
  return { ok: true, layout: parseStored(data?.layout) };
}

async function writeTable(username: string, layout: AdminNavLayout): Promise<boolean> {
  if (Date.now() < tableMissingUntil) return false;
  const db = getAdminDb();
  const { error } = await db.from(TABLE).upsert({
    username,
    layout,
    updated_at: new Date().toISOString(),
  });
  if (!error) return true;
  if (missingTable(error)) {
    tableMissingUntil = Date.now() + 5 * 60_000;
    return false;
  }
  throw error;
}

async function deleteTable(username: string): Promise<boolean> {
  if (Date.now() < tableMissingUntil) return false;
  const db = getAdminDb();
  const { error } = await db.from(TABLE).delete().eq("username", username);
  if (!error) return true;
  if (missingTable(error)) {
    tableMissingUntil = Date.now() + 5 * 60_000;
    return false;
  }
  throw error;
}

export async function readAdminNavLayout(username: string): Promise<unknown | null> {
  const user = assertUsername(username);
  const table = await readTable(user);
  if (table.ok) {
    if (table.layout != null) return table.layout;
    const legacy = await readSettings(user);
    if (legacy != null) return legacy;
    return null;
  }
  return readSettings(user);
}

export async function writeAdminNavLayout(
  username: string,
  layout: AdminNavLayout,
): Promise<void> {
  const user = assertUsername(username);
  const storedInTable = await writeTable(user, layout);
  if (storedInTable) {
    await deleteSettings(user).catch(() => {
      /* дубль в settings не критичен: чтение сначала смотрит таблицу */
    });
    return;
  }
  await writeSettings(user, layout);
}

export async function deleteAdminNavLayout(username: string): Promise<void> {
  const user = assertUsername(username);
  await deleteTable(user);
  await deleteSettings(user);
}
