// =========================================================
// FILE: src/lib/product-links-store.ts
// Хранилище связок карточек товаров (как на Ozon).
//
// Основное место: таблица product_link_groups (миграция
// supabase/migration_product_links.sql). Если миграцию ещё не
// запускали в конкретной БД, автоматически используется ключ
// `product_link_groups` в базовой таблице `settings` — поэтому
// объединение карточек работает сразу после деплоя без ручного SQL.
// =========================================================

import { getAdminDb } from "./supabase";
import {
  applyProductLinkUpdate,
  findProductLinkGroup,
  normalizeProductLinkGroups,
  removeProductFromLinkGroups,
  type ProductLinkGroup,
  type ProductLinkUpdateInput,
} from "./product-links";

const TABLE = "product_link_groups";
const SETTINGS_KEY = "product_link_groups";
const CACHE_TTL_MS = 120_000;

let tableMissingUntil = 0;
let memoryGroupsCache: { groups: ProductLinkGroup[]; expiresAt: number } | null =
  null;

export function invalidateProductLinksCache(): void {
  memoryGroupsCache = null;
}

function isMissingTableError(
  error: { code?: string; message?: string; details?: string } | null,
): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = String(error.message || error.details || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|schema cache|Could not find the table/i.test(msg)
  );
}

function parseJsonValue(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw ?? null;
}

async function readFromSettings(): Promise<ProductLinkGroup[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (error) {
    console.error("[product-links] read settings fallback error:", error);
    return [];
  }
  return normalizeProductLinkGroups(parseJsonValue(data?.value));
}

async function writeToSettings(groups: ProductLinkGroup[]): Promise<void> {
  const db = getAdminDb();
  const normalized = normalizeProductLinkGroups(groups);
  const { error } = await db.from("settings").upsert({
    key: SETTINGS_KEY,
    value: JSON.stringify(normalized),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function readFromTable(): Promise<
  { ok: true; groups: ProductLinkGroup[] } | { ok: false }
> {
  if (Date.now() < tableMissingUntil) return { ok: false };
  const db = getAdminDb();
  const { data, error } = await db
    .from(TABLE)
    .select("id, primary_product_id, product_ids, labels, group_title")
    .order("updated_at", { ascending: true });
  if (error) {
    if (isMissingTableError(error)) {
      tableMissingUntil = Date.now() + 5 * 60_000;
      return { ok: false };
    }
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    // Если таблицу только что создали миграцией, а связки раньше лежали в settings —
    // прозрачно подхватываем их из settings.
    const fromSettings = await readFromSettings();
    return { ok: true, groups: fromSettings };
  }

  return { ok: true, groups: normalizeProductLinkGroups(rows) };
}

async function writeToTable(groups: ProductLinkGroup[]): Promise<boolean> {
  if (Date.now() < tableMissingUntil) return false;
  const db = getAdminDb();
  const normalized = normalizeProductLinkGroups(groups);
  const now = new Date().toISOString();

  if (normalized.length > 0) {
    const upsertRows = normalized.map((g) => ({
      id: g.id,
      primary_product_id: g.primaryProductId,
      product_ids: g.productIds,
      labels: g.labels || {},
      group_title: g.groupTitle || null,
      updated_at: now,
    }));
    const { error: upsertErr } = await db.from(TABLE).upsert(upsertRows);
    if (upsertErr) {
      if (isMissingTableError(upsertErr)) {
        tableMissingUntil = Date.now() + 5 * 60_000;
        return false;
      }
      throw upsertErr;
    }
  }

  // Удаляем устаревшие группы, которых больше нет в списке
  const { data: existingRows, error: listErr } = await db
    .from(TABLE)
    .select("id");
  if (!listErr && Array.isArray(existingRows)) {
    const keepIds = new Set(normalized.map((g) => g.id));
    const staleIds = existingRows
      .map((r: any) => String(r.id))
      .filter((id) => !keepIds.has(id));
    if (staleIds.length > 0) {
      await db.from(TABLE).delete().in("id", staleIds);
    }
  }

  return true;
}

/** Читает актуальный список всех групп связок карточек (с memory-кешем). */
export async function getProductLinkGroups(opts?: {
  bypassCache?: boolean;
}): Promise<ProductLinkGroup[]> {
  if (
    !opts?.bypassCache &&
    memoryGroupsCache &&
    memoryGroupsCache.expiresAt > Date.now()
  ) {
    return memoryGroupsCache.groups;
  }

  try {
    const fromTable = await readFromTable();
    const groups = fromTable.ok ? fromTable.groups : await readFromSettings();
    memoryGroupsCache = {
      groups,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return groups;
  } catch (err) {
    console.error("getProductLinkGroups error:", err);
    return [];
  }
}

export async function getProductLinkGroupForProduct(
  productId: string,
): Promise<ProductLinkGroup | null> {
  const groups = await getProductLinkGroups({ bypassCache: true });
  return findProductLinkGroup(groups, productId);
}

/** Сохраняет полный список групп (в таблицу + зеркало в settings для надёжности). */
async function persistProductLinkGroups(
  groups: ProductLinkGroup[],
): Promise<ProductLinkGroup[]> {
  const normalized = normalizeProductLinkGroups(groups);
  const wroteTable = await writeToTable(normalized);
  // Всегда поддерживаем консистентную копию в settings, если таблица отсутствует
  // или чтобы при переездах данные никогда не терялись.
  if (!wroteTable) {
    await writeToSettings(normalized);
  } else {
    await writeToSettings(normalized).catch(() => {});
  }
  memoryGroupsCache = {
    groups: normalized,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return normalized;
}

/** Обновляет связку карточек для конкретного созданного/отредактированного товара. */
export async function saveProductLinkForProduct(
  targetProductId: string,
  input: ProductLinkUpdateInput,
): Promise<ProductLinkGroup[]> {
  const current = await getProductLinkGroups({ bypassCache: true });
  const updated = applyProductLinkUpdate(current, targetProductId, input);
  return persistProductLinkGroups(updated);
}

/** Удаляет товар из связок (при удалении товара). */
export async function removeProductFromLinksStore(
  productId: string,
): Promise<void> {
  const current = await getProductLinkGroups({ bypassCache: true });
  if (!current.some((g) => g.productIds.includes(productId))) return;
  const updated = removeProductFromLinkGroups(current, productId);
  await persistProductLinkGroups(updated);
}
