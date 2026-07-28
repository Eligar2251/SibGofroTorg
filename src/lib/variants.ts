// src/lib/variants.ts
//
// CRUD-функции для таблицы product_variants + хелперы для агрегации.
// Используются:
//   • серверной частью (getServerSideProps, API endpoints)
//   • админкой (страница товара в /[adminPath]/products/[id])
//   • публичной частью (каталог «от X ₽», страница товара, корзина)
//
// Архитектура:
//   product_variants — отдельная таблица, логически связана с
//   products. У одного товара может быть 0..N вариантов.
//   Товары БЕЗ вариантов продолжают работать как раньше — данные
//   читаются прямо из products.

import { revalidateTag, unstable_cache } from "next/cache";
import { getAdminDb } from "./supabase";
import { invalidateProductsCache } from "./supabase-queries";
import type { ProductVariant, ResolvedVariant, FirestoreProduct } from "./types";
import { resolveVariant } from "./types";

/** Сырое значение строки из БД → null. */
function nullIfEmpty(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.trim() ? s : null;
}

function mapVariantRow(row: any): ProductVariant {
  const stockQty = Number(row.stock_qty || 0);
  return {
    id: row.id,
    productId: String(row.product_id || ""),
    name: String(row.name || ""),
    optionType: String(row.option_type || ""),
    colorHex: nullIfEmpty(row.color_hex),
    sortOrder: Number(row.sort_order || 0),
    price: row.price != null ? Number(row.price) : null,
    priceWholesale: row.price_wholesale != null ? Number(row.price_wholesale) : null,
    sku: nullIfEmpty(row.sku),
    stockQty,
    stockWarnQty: row.stock_warn_qty != null ? Number(row.stock_warn_qty) : null,
    inStock: stockQty > 0,
    images: Array.isArray(row.images) ? row.images : [],
    imageUrl: nullIfEmpty(row.image_url),
    dimensionLength: row.dimension_length != null ? Number(row.dimension_length) : null,
    dimensionWidth: row.dimension_width != null ? Number(row.dimension_width) : null,
    dimensionHeight: row.dimension_height != null ? Number(row.dimension_height) : null,
    dimensionUnit: nullIfEmpty(row.dimension_unit),
    weight: row.weight != null ? Number(row.weight) : null,
    packQty: row.pack_qty != null ? Number(row.pack_qty) : null,
    isVisible: row.is_visible !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ====================================================================
// ЧТЕНИЕ
// ====================================================================

/**
 * Все варианты одного товара. Возвращаются и видимые, и скрытые
 * (для админки) — публичный код фильтрует по isVisible.
 */
export async function getProductVariants(productId: string): Promise<ProductVariant[]> {
  if (!productId) return [];
  const db = getAdminDb();
  const { data, error } = await db
    .from("product_variants")
    .select("*")
    .eq("product_id", productId)
    .order("option_type", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error("getProductVariants error:", error);
    return [];
  }
  return (data || []).map(mapVariantRow);
}

/** Только видимые (для публичной части). */
export async function getVisibleProductVariants(
  productId: string,
): Promise<ProductVariant[]> {
  const all = await getProductVariants(productId);
  return all.filter((v) => v.isVisible);
}

/**
 * Разрешённые варианты — уже «смешаны» с product (где variant поле
 * NULL → берём с product). Возвращаются только видимые.
 *
 * Удобно для страницы товара: один объект, который отдаётся в
 * UI без дополнительных проверок «а что если у variant не указана
 * цена?».
 */
export async function getResolvedVariants(
  product: FirestoreProduct,
): Promise<ResolvedVariant[]> {
  const variants = await getVisibleProductVariants(product.id);
  return variants.map((v) => resolveVariant(v, product));
}

/** Один вариант по id (для корзины, заказа, админки). */
export async function getProductVariant(
  variantId: string,
): Promise<ProductVariant | null> {
  if (!variantId) return null;
  const db = getAdminDb();
  const { data, error } = await db
    .from("product_variants")
    .select("*")
    .eq("id", variantId)
    .maybeSingle();
  if (error || !data) return null;
  return mapVariantRow(data);
}

/**
 * Карта «все варианты по productId» — для пакетной загрузки
 * (каталог, лента «Похожие товары»). Кешируется на 60 секунд.
 */
export const getCachedVariantsMap = unstable_cache(
  async (productIds: string[]) => {
    if (productIds.length === 0) return new Map<string, ProductVariant[]>();
    const db = getAdminDb();
    const { data, error } = await db
      .from("product_variants")
      .select("*")
      .in("product_id", productIds)
      .eq("is_visible", true)
      .order("option_type", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) {
      console.error("getCachedVariantsMap error:", error);
      return new Map<string, ProductVariant[]>();
    }
    const map = new Map<string, ProductVariant[]>();
    for (const row of data || []) {
      const v = mapVariantRow(row);
      const list = map.get(v.productId) || [];
      list.push(v);
      map.set(v.productId, list);
    }
    return map;
  },
  ["variants-map"],
  { revalidate: 60, tags: ["variants"] },
);

// ====================================================================
// АГРЕГАЦИЯ (используется в каталоге)
// ====================================================================

/**
 * Сводные данные по вариантам для карточки каталога:
 *   • min/max цена — для «от X ₽»
 *   • общий остаток — для сводного бейджа «В наличии»
 *   • признак «hasVariants» — чтобы UI знал, что у товара
//     есть выбор (например, чтобы показать плашку «Есть варианты»)
//   • variantCount — для пометки «3 цвета»
 *
 * Если вариантов нет — возвращает нулевые сводные, и карточка
 * каталога ведёт себя как обычный товар без вариантов.
 */
export function aggregateVariants(
  variants: ProductVariant[] | undefined,
  product: Pick<FirestoreProduct, "price" | "stockQty">,
): {
  hasVariants: boolean;
  variantCount: number;
  priceMin: number | null;
  priceMax: number | null;
  totalStock: number;
  // Есть ли хотя бы один вариант в наличии
  anyInStock: boolean;
} {
  if (!variants || variants.length === 0) {
    return {
      hasVariants: false,
      variantCount: 0,
      priceMin: product.price,
      priceMax: product.price,
      totalStock: Number(product.stockQty ?? 0),
      anyInStock: Number(product.stockQty ?? 0) > 0,
    };
  }

  const prices = variants
    .map((v) => v.price)
    .filter((p): p is number => p != null && p > 0);
  const priceMin = prices.length > 0 ? Math.min(...prices) : null;
  const priceMax = prices.length > 0 ? Math.max(...prices) : null;
  const totalStock = variants.reduce((s, v) => s + (v.stockQty || 0), 0);
  const anyInStock = variants.some((v) => v.stockQty > 0);

  return {
    hasVariants: true,
    variantCount: variants.length,
    priceMin,
    priceMax,
    totalStock,
    anyInStock,
  };
}

// ====================================================================
// ЗАПИСЬ (используется админкой)
// ====================================================================

export interface VariantInput {
  id?: string; // Если задан — обновляем; нет — создаём
  name: string;
  optionType: string;
  colorHex?: string | null;
  sortOrder?: number;
  price?: number | null;
  priceWholesale?: number | null;
  sku?: string | null;
  stockQty?: number;
  stockWarnQty?: number | null;
  images?: { url: string; publicId: string }[];
  imageUrl?: string | null;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  weight?: number | null;
  packQty?: number | null;
  isVisible?: boolean;
}

function buildVariantPayload(input: VariantInput, productId: string) {
  return {
    product_id: productId,
    name: input.name.trim(),
    option_type: input.optionType.trim(),
    color_hex: input.colorHex || null,
    sort_order: input.sortOrder ?? 0,
    price: input.price != null && input.price > 0 ? input.price : null,
    price_wholesale:
      input.priceWholesale != null && input.priceWholesale > 0
        ? input.priceWholesale
        : null,
    sku: input.sku || null,
    stock_qty: Math.max(0, Math.floor(input.stockQty ?? 0)),
    stock_warn_qty: input.stockWarnQty ?? null,
    images: input.images ?? [],
    image_url: input.imageUrl || null,
    dimension_length: input.dimensionLength ?? null,
    dimension_width: input.dimensionWidth ?? null,
    dimension_height: input.dimensionHeight ?? null,
    dimension_unit: input.dimensionUnit || null,
    weight: input.weight ?? null,
    pack_qty: input.packQty ?? null,
    is_visible: input.isVisible !== false,
    updated_at: new Date().toISOString(),
  };
}

/** Создать или обновить один вариант. */
export async function saveVariant(
  productId: string,
  input: VariantInput,
): Promise<{ id: string }> {
  const db = getAdminDb();
  const payload = buildVariantPayload(input, productId);
  if (input.id) {
    const { error } = await db
      .from("product_variants")
      .update(payload)
      .eq("id", input.id);
    if (error) throw error;
    revalidateTag("variants", { expire: 0 });
    invalidateProductsCache();
    return { id: input.id };
  }
  const { data, error } = await db
    .from("product_variants")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  revalidateTag("variants", { expire: 0 });
  invalidateProductsCache();
  return { id: data.id };
}

/**
 * Сохранить пачку вариантов: создаёт новые, обновляет существующие,
 * удаляет те, чьи id не пришли.
 */
export async function saveVariantsBatch(
  productId: string,
  items: VariantInput[],
): Promise<{ created: number; updated: number; deleted: number }> {
  const db = getAdminDb();
  const existing = await getProductVariants(productId);
  const incomingIds = new Set(items.map((i) => i.id).filter(Boolean) as string[]);
  const toDelete = existing
    .filter((e) => !incomingIds.has(e.id))
    .map((e) => e.id);

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const item of items) {
    if (item.id) {
      await saveVariant(productId, item);
      updated += 1;
    } else {
      await saveVariant(productId, item);
      created += 1;
    }
  }

  if (toDelete.length > 0) {
    const { error } = await db
      .from("product_variants")
      .delete()
      .in("id", toDelete);
    if (error) throw error;
    deleted = toDelete.length;
  }

  revalidateTag("variants", { expire: 0 });
  invalidateProductsCache();
  return { created, updated, deleted };
}

/** Удалить один вариант. */
export async function deleteVariant(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("product_variants").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("variants", { expire: 0 });
  invalidateProductsCache();
}

/** Удалить все варианты товара. Используется при удалении товара. */
export async function deleteProductVariants(productId: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db
    .from("product_variants")
    .delete()
    .eq("product_id", productId);
  if (error) throw error;
  revalidateTag("variants", { expire: 0 });
}
