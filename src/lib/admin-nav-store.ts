// =========================================================
// FILE: src/lib/admin-nav-store.ts
// Серверное хранилище персональных настроек навигации админки.
// Одна строка на пользователя (ключ — логин), настройки — JSONB.
// Используется раскладкой админки (первичная загрузка меню) и
// маршрутом /api/admin/nav-settings (чтение/запись/сброс).
// =========================================================

import { getAdminDb } from "@/lib/supabase";
import {
  normalizeNavSettings,
  ADMIN_NAV_ITEMS,
  type AdminNavSettingsDto,
} from "@/lib/admin-nav";

const KNOWN_KEYS = ADMIN_NAV_ITEMS.map((item) => item.key);
const TABLE = "admin_nav_settings";

function cleanUsername(username: string): string {
  return username.trim().slice(0, 64);
}

/** Настройки навигации пользователя; null — если их нет/таблицы нет. */
export async function getAdminNavSettings(
  username: string
): Promise<AdminNavSettingsDto | null> {
  const name = cleanUsername(username);
  if (!name) return null;
  try {
    const db = getAdminDb();
    const { data, error } = await db
      .from(TABLE)
      .select("settings")
      .eq("username", name)
      .maybeSingle();
    if (error || !data) return null;
    const raw = (data as { settings?: unknown }).settings;
    // JSONB приходит объектом; на случай старой записи строкой —
    // пробуем распарсить.
    const parsed = typeof raw === "string" ? safeJsonParse(raw) : raw;
    return normalizeNavSettings(parsed, KNOWN_KEYS);
  } catch (error) {
    // Таблица ещё не создана (миграция не применена) или сеть
    // недоступна — навигация работает со списком по умолчанию.
    console.warn("[admin-nav] Не удалось прочитать настройки меню:", error);
    return null;
  }
}

/** Сохраняет настройки навигации пользователя (upsert). */
export async function saveAdminNavSettings(
  username: string,
  settings: AdminNavSettingsDto
): Promise<void> {
  const name = cleanUsername(username);
  if (!name) throw new Error("Пустой логин");
  const db = getAdminDb();
  const { error } = await db.from(TABLE).upsert(
    {
      username: name,
      settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "username" }
  );
  if (error) throw error;
}

/** Сброс настроек к значениям по умолчанию (удаляет строку). */
export async function deleteAdminNavSettings(username: string): Promise<void> {
  const name = cleanUsername(username);
  if (!name) return;
  const db = getAdminDb();
  const { error } = await db.from(TABLE).delete().eq("username", name);
  if (error) throw error;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
