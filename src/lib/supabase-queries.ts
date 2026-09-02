// =========================================================
// FILE: src/lib/supabase-queries.ts
// Полная замена firestore-queries.ts — все запросы к Supabase (PostgreSQL).
// =========================================================

import { unstable_cache, revalidateTag } from "next/cache";
import { getAdminDb } from "./supabase";
import {
  computeBarcode,
  computeQrSlug,
  generateUniqueBarcode,
  isValidBarcode,
} from "./qr";
import { generatePickupCode } from "./pickup-code";
import {
  extractQueryDims,
  dimensionScore,
} from "./dimension-search";
import { isProductAvailable } from "./stock-availability";
import {
  WASTEPAPER_RATE_IDS,
  WASTEPAPER_RATE_DEFAULTS,
  wpRateSettingKey,
  parseWastepaperRate,
  type WastepaperRates,
} from "./wastepaper";
import type {
  FirestoreCategory,
  FirestoreProduct,
  FirestoreOrder,
  Promotion,
  PopupCampaign,
  ProductReview,
  ProductQuestion,
  ProductRating,
  ProductView,
  ProductVariant,
} from "./types";
import {
  aggregateVariants as aggregateVariantsPure,
  getCachedVariantsMap,
} from "./variants";
import {
  calculateBoxVolumeLiters,
  normalizeProductLabelColor,
} from "./product-fields";
import {
  parseHomeTileKind,
  productMatchesTile,
  productHasAnyTag,
  normalizeTag,
  sanitizeTagsForSave,
  sortHomeTiles,
  type HomeTile,
} from "./home-tiles";
import {
  parseSavedTemplates,
  PHOTO_TEMPLATES_LIMIT,
  PHOTO_TEMPLATES_SETTING_KEY,
  type SavedPhotoTemplate,
} from "./photo-template";

export const FEATURED_PRODUCTS_ORDER_SETTING_KEY = "featured_products_order";

// ── Переживаем отсутствие колонки products.barcode ──
// Миграция supabase/migration_product_barcodes.sql применяется вручную
// и может быть ещё не выполнена в конкретной БД. В таком случае
// PostgREST отвечает PGRST204 ("Could not find the 'barcode' column
// of 'products' in the schema cache") на ЛЮБУЮ запись, где присутствует
// ключ barcode. Сохранение товара ни в коем случае не должно из-за
// этого падать — поле при ретрае просто опускаем.
const BARCODE_COLUMN_MISSING_HINT =
  "[products] Колонки barcode нет в БД — запись сохранена без штрихкода. " +
  "Выполните миграцию supabase/migration_product_barcodes.sql в Supabase.";

function isMissingBarcodeColumnError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.details || "").toLowerCase();
  if (!msg.includes("barcode")) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("unknown column")
  );
}

/** Дружелюбная ошибка для операций, которым колонка обязательна. */
function barcodeColumnRequiredError(): Error {
  return new Error(
    "В базе данных ещё нет колонки barcode для товаров. " +
      "Выполните SQL-миграцию supabase/migration_product_barcodes.sql " +
      "(Supabase Dashboard → SQL Editor) и повторите."
  );
}

// ─── Helpers ───────────────────────────────────────────────

function slugify(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
    з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return text
    .toLowerCase()
    .replace(/[а-яё]/gi, (c) => map[c.toLowerCase()] || c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}

// ── Фото товара: единый вид ──
// В БД исторически могло встретиться два формата:
//   1) [{ url, publicId }] — текущий (Cloudinary);
//   2) ["https://…"] — строки (старые импорты/миграции).
// Если товар с images-строками открыть в карточке и пересохранить,
// форма брала `images[0]?.url` → undefined и ЗАТИРАЛА главное
// фото. Везде нормализуем к { url, publicId }.
export function normalizeProductImages(raw: any): { url: string; publicId: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { url: string; publicId: string }[] = [];
  for (const item of raw) {
    if (!item) continue;
    if (typeof item === "string") {
      const url = item.trim();
      if (url) out.push({ url, publicId: "" });
      continue;
    }
    const url = typeof item.url === "string" && item.url.trim()
      ? item.url.trim()
      : typeof item.secure_url === "string" && item.secure_url.trim()
        ? item.secure_url.trim()
        : "";
    if (!url) continue;
    out.push({ url, publicId: typeof item.publicId === "string" ? item.publicId : "" });
  }
  return out;
}

// Главное фото товара: первый непустой url из массива. Нужно,
// чтобы фото не пропадало у товаров, где оно задано только через
// image_url (например, импортом из Excel): форма всегда считает
// главным images[0], и без этого фоллбека стирала чужое фото.
export function firstImageUrl(images: { url: string }[]): string | null {
  const found = images.find((i) => i && typeof i.url === "string" && i.url.trim());
  return found ? found.url.trim() : null;
}

function isMissingMadeToOrderMinQtyColumnError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.details || "").toLowerCase();
  if (!msg.includes("made_to_order_min_qty")) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

function isMissingCuttableColumnError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.details || "").toLowerCase();
  if (!msg.includes("is_cuttable") && !msg.includes("cut_meters_per_roll") && !msg.includes("cut_price_per_meter") && !msg.includes("cut_unit_name")) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

function isMissingPurchasePriceColumnError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.details || "").toLowerCase();
  if (!msg.includes("purchase_price")) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

function isMissingProductLabelColorColumnError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.details || "").toLowerCase();
  if (!msg.includes("promo_label_color") && !msg.includes("promo_label_text_color")) {
    return false;
  }
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

function isMissingSaleColumnError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.details || "").toLowerCase();
  if (!msg.includes("is_sale")) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

function isMissingTagsColumnError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.details || "").toLowerCase();
  if (!msg.includes("tags")) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

function mapProductRow(row: any): FirestoreProduct {
  const images = normalizeProductImages(row.images);
  return {
    id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    categoryId: row.category_id || null,
    sku: row.sku || null,
    description: row.description || null,
    featuredOrder: row.sort_order != null ? Number(row.sort_order) : null,
    price: row.price != null ? Number(row.price) : null,
    priceWholesale: row.price_wholesale != null ? Number(row.price_wholesale) : null,
    purchasePrice: row.purchase_price != null ? Number(row.purchase_price) : null,
    minWholesaleQty: row.min_wholesale_qty != null ? Number(row.min_wholesale_qty) : null,
    dimensionLength: row.dimension_length != null ? Number(row.dimension_length) : null,
    dimensionWidth: row.dimension_width != null ? Number(row.dimension_width) : null,
    dimensionHeight: row.dimension_height != null ? Number(row.dimension_height) : null,
    dimensionUnit: row.dimension_unit || "мм",
    weight: row.weight != null ? Number(row.weight) : null,
    material: row.material || null,
    packQty: row.pack_qty != null ? Number(row.pack_qty) : null,
    volume: calculateBoxVolumeLiters(
      row.dimension_length,
      row.dimension_width,
      row.dimension_height,
      row.dimension_unit,
    ),
    note: row.note || null,
    inStock: row.in_stock ?? true,
    stockQty: row.stock_qty != null ? Number(row.stock_qty) : null,
    stockWarnQty: row.stock_warn_qty != null ? Number(row.stock_warn_qty) : null,
    // Постоянный штрихкод из БД. Может отсутствовать у товаров,
    // созданных до миграции — читающий код подставляет
    // детерминированный computeBarcode(id) как фоллбек.
    barcode: row.barcode || null,
    isPromo: row.is_promo ?? false,
    promoLabel: row.promo_label || null,
    tags: sanitizeTagsForSave(row.tags),
    promoLabelColor: normalizeProductLabelColor(row.promo_label_color),
    promoLabelTextColor: normalizeProductLabelColor(row.promo_label_text_color),
    madeToOrder: row.made_to_order ?? false,
    madeToOrderMinQty: row.made_to_order_min_qty != null ? Number(row.made_to_order_min_qty) : null,
    isCuttable: row.is_cuttable ?? false,
    cutMetersPerRoll: row.cut_meters_per_roll != null ? Number(row.cut_meters_per_roll) : null,
    cutPricePerMeter: row.cut_price_per_meter != null ? Number(row.cut_price_per_meter) : null,
    cutUnitName: row.cut_unit_name || "м",
    discountType: row.discount_type || null,
    discountValue: row.discount_value != null ? Number(row.discount_value) : null,
    discountBadge: row.discount_badge || null,
    isVisible: row.is_visible ?? true,
    isFeatured: row.is_featured ?? false,
    isSale: row.is_sale ?? false,
    // Главное фото: явный image_url, иначе первое из массива images —
    // самолечение для товаров, у которых фото задано лишь в одном из
    // двух мест (Excel задаёт image_url, форма — images).
    imageUrl: row.image_url || firstImageUrl(images) || null,
    images,
    viewCount: Number(row.view_count || 0),
    averageRating: Number(row.average_rating || 0),
    totalReviews: Number(row.total_reviews || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// ── QR + штрихкод ──
//
// `barcode` теперь ХРАНИТСЯ в БД (products.barcode, см.
// supabase/migration_product_barcodes.sql) — постоянный EAN-13,
// присваивается один раз и навсегда. У товаров, созданных до
// миграции, колонка пуста — тогда в post-обработке
// `getCachedProducts` подставляется детерминированный
// computeBarcode(id): это ровно тот код, что печатался на
// этикетках раньше, поэтому старые распечатки продолжают работать.
// Дозапись в БД — кнопкой «Обновить штрихкоды» (только для товаров
// без кода или с битым/дублирующимся) либо при следующем
// сохранении карточки товара (форма отправляет видимый код).
//
// `qrSlug` по-прежнему детерминированно из `id` (не хранится:
// меняться не должен никогда).

function mapReviewRow(row: any): ProductReview {
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id || "",
    userName: row.user_name || "",
    userAvatar: row.user_avatar || null,
    orderId: row.order_id || "",
    rating: Number(row.rating || 0),
    title: row.title || null,
    text: row.text || "",
    pros: row.pros || null,
    cons: row.cons || null,
    images: Array.isArray(row.images) ? row.images : [],
    isVerifiedPurchase: row.is_verified_purchase ?? false,
    helpfulCount: Number(row.helpful_count || 0),
    isApproved: row.is_approved ?? false,
    moderationStatus: row.moderation_status || "pending",
    moderationNote: row.moderation_note || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapQuestionRow(row: any): ProductQuestion {
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id || "",
    userName: row.user_name || "",
    userAvatar: row.user_avatar || null,
    question: row.question || "",
    answer: row.answer || null,
    answerAuthor: row.answer_author || null,
    answeredAt: toIso(row.answered_at),
    isAnswered: row.is_answered ?? false,
    helpfulCount: Number(row.helpful_count || 0),
    isApproved: row.is_approved ?? false,
    moderationStatus: row.moderation_status || "pending",
    moderationNote: row.moderation_note || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapRatingRow(row: any): ProductRating {
  return {
    productId: row.product_id,
    averageRating: Number(row.average_rating || 0),
    totalReviews: Number(row.total_reviews || 0),
    ratingDistribution: row.rating_distribution || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    updatedAt: toIso(row.updated_at),
  };
}

function mapViewRow(row: any): ProductView {
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id || null,
    sessionId: row.session_id || "",
    ipHash: row.ip_hash || null,
    userAgent: row.user_agent || null,
    referrer: row.referrer || null,
    viewedAt: toIso(row.viewed_at),
  };
}

// ─── Кэш ───────────────────────────────────────────────────
const DATA_REVALIDATE = 120;

async function fetchAllCategories(): Promise<FirestoreCategory[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });
  // Сеть/БД могут быть недоступны — не роняем страницу целиком,
  // отдаём пустой список (следующий запрос через revalidate перечитает).
  if (error) {
    console.error("fetchAllCategories error:", error?.message || error);
    return [];
  }
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    icon: row.icon || null,
    description: row.description || null,
    sortOrder: Number(row.sort_order || 0),
    isVisible: row.is_visible ?? true,
    imageUrl: row.image_url || null,
    createdAt: toIso(row.created_at),
  }));
}

const getCachedCategories = unstable_cache(
  fetchAllCategories,
  ["base-categories"],
  { revalidate: DATA_REVALIDATE, tags: ["categories"] }
);

let memoryProductsCache: { at: number; data: FirestoreProduct[] } | null = null;

async function fetchAllProducts(): Promise<FirestoreProduct[]> {
  const now = Date.now();
  if (memoryProductsCache && now - memoryProductsCache.at < DATA_REVALIDATE * 1000) {
    return memoryProductsCache.data;
  }
  try {
    const db = getAdminDb();
    const { data, error } = await db.from("products").select("*");
    if (error) throw error;
    const mapped = (data || []).map(mapProductRow);
    memoryProductsCache = { at: now, data: mapped };
    return mapped;
  } catch (error: any) {
    console.error("fetchAllProducts error:", error?.message || error);
    return memoryProductsCache?.data || [];
  }
}

/** Принудительный сброс memory-кеша товаров.
 *  Вызывается после любого write (create/update/delete), чтобы
 *  следующий запрос читал свежие данные из Supabase. */
export function invalidateProductsCache(): void {
  memoryProductsCache = null;
}

const getCachedProducts = unstable_cache(
  async () => {
    const products = await fetchAllProducts();
    // Подтягиваем сводку по вариантам: используется в каталоге для
    // «от X ₽», бейджа «Есть варианты», сводного остатка и т.п.
    // Сами варианты не тянем сюда — они нужны только на странице
    // товара и в админке (отдельные запросы).
    const productIds = products.map((p) => p.id);
    const variantsMap = await getCachedVariantsMap(productIds);
    for (const p of products) {
      const variants = variantsMap.get(p.id) || [];
      const agg = aggregateVariantsPure(variants, p);
      p.variants = variants;
      p.hasVariants = agg.hasVariants;
      p.variantCount = agg.variantCount;
      p.variantPriceMin = agg.priceMin;
      p.variantPriceMax = agg.priceMax;
      p.variantTotalStock = agg.totalStock;
      // Если у товара есть варианты — в карточке каталога
      // показываем «от X ₽» вместо обычной цены.
      if (agg.hasVariants && agg.priceMin != null) {
        p.price = agg.priceMin;
        p.inStock = agg.anyInStock;
        p.stockQty = agg.totalStock;
      }
      // Штрихкод: сначала постоянный код из БД; фоллбек —
      // детерминированный из id (старые товары до миграции, это тот
      // же код, что печатался на их этикетках). Ленивое вычисление
      // qrSlug: ~микросекунды на товар, кеш на 120с.
      p.barcode = p.barcode || computeBarcode(p.id);
      p.qrSlug = computeQrSlug(p.id);
    }
    return products;
  },
  ["base-products"],
  { revalidate: DATA_REVALIDATE, tags: ["products", "variants"] }
);

async function fetchProductReviewsRaw(productId: string): Promise<ProductReview[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("product_reviews")
    .select("*")
    .eq("product_id", productId)
    .limit(500);
  if (error) throw error;
  return (data || []).map(mapReviewRow);
}

const getCachedProductReviews = (productId: string) =>
  unstable_cache(
    async () => fetchProductReviewsRaw(productId),
    ["product-reviews", productId],
    { revalidate: DATA_REVALIDATE, tags: ["reviews", `reviews:${productId}`] }
  )();

// ─── Categories ────────────────────────────────────────────

export async function getCategories(): Promise<FirestoreCategory[]> {
  const cats = await getCachedCategories();
  return cats.filter((c) => c.isVisible !== false);
}

export async function getAllCategories(): Promise<FirestoreCategory[]> {
  return getCachedCategories();
}

export async function getCategoryBySlug(slug: string): Promise<FirestoreCategory | null> {
  const cats = await getCachedCategories();
  return cats.find((c) => c.slug === slug) || null;
}

// ─── Плитки главной (home_tiles) ───────────────────────────
// Витрина главной страницы: набор, порядок, картинки и правила
// отбора задаёт админ. Каталог этим не затрагивается.

function mapHomeTileRow(row: any): HomeTile {
  return {
    id: row.id,
    title: row.title || "",
    subtitle: row.subtitle || null,
    imageUrl: row.image_url || null,
    icon: row.icon || null,
    kind: parseHomeTileKind(row.kind),
    categoryId: row.category_id || null,
    tag: row.tag || null,
    accent: row.accent || null,
    sortOrder: Number(row.sort_order || 0),
    isVisible: row.is_visible ?? true,
  };
}

async function fetchAllHomeTiles(): Promise<HomeTile[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("home_tiles")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) {
    // Таблицы может ещё не быть (миграция не применена) — главная
    // в этом случае показывает плитки, собранные из категорий.
    console.error("fetchAllHomeTiles error:", error?.message || error);
    return [];
  }
  return sortHomeTiles((data || []).map(mapHomeTileRow));
}

const getCachedHomeTiles = unstable_cache(fetchAllHomeTiles, ["home-tiles"], {
  revalidate: DATA_REVALIDATE,
  tags: ["home-tiles"],
});

/** Все плитки, включая скрытые — для админки. */
export async function getAllHomeTiles(): Promise<HomeTile[]> {
  return getCachedHomeTiles();
}

/** Видимые плитки для главной страницы. */
export async function getHomeTiles(): Promise<HomeTile[]> {
  const tiles = await getCachedHomeTiles();
  return tiles.filter((t) => t.isVisible !== false);
}

/** Есть ли таблица home_tiles в базе (подсказка админу про миграцию). */
export async function homeTilesTableExists(): Promise<boolean> {
  try {
    const db = getAdminDb();
    const { error } = await db.from("home_tiles").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Товары одной плитки (в порядке каталога по умолчанию). */
export async function getProductsForTile(
  tile: Pick<HomeTile, "kind" | "categoryId" | "tag">,
  opts: { limitCount?: number } = {}
): Promise<FirestoreProduct[]> {
  const all = await getProducts({});
  const matched = all.filter((p) => productMatchesTile(p, tile));
  return opts.limitCount ? matched.slice(0, opts.limitCount) : matched;
}

function homeTilePayload(data: Record<string, any>): Record<string, any> {  const kind = parseHomeTileKind(data.kind);
  return {
    title: String(data.title || "").trim().slice(0, 120),
    subtitle: data.subtitle ? String(data.subtitle).slice(0, 300) : null,
    image_url: data.imageUrl ? String(data.imageUrl).slice(0, 1000) : null,
    icon: data.icon ? String(data.icon).slice(0, 60) : null,
    kind,
    category_id: kind === "category" && data.categoryId ? String(data.categoryId) : null,
    tag: kind === "tag" && data.tag ? String(data.tag).slice(0, 200) : null,
    accent: data.accent ? String(data.accent).slice(0, 40) : null,
    sort_order: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 0,
    is_visible: data.isVisible !== false,
  };
}

export async function createHomeTile(data: Record<string, any>): Promise<{ id: string }> {
  const db = getAdminDb();
  const { data: row, error } = await db
    .from("home_tiles")
    .insert(homeTilePayload(data))
    .select("id")
    .single();
  if (error) throw error;
  revalidateTag("home-tiles", { expire: 0 });
  return { id: row.id };
}

export async function updateHomeTile(id: string, data: Record<string, any>): Promise<void> {
  const db = getAdminDb();
  const { error } = await db
    .from("home_tiles")
    .update({ ...homeTilePayload(data), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  revalidateTag("home-tiles", { expire: 0 });
}

export async function deleteHomeTile(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("home_tiles").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("home-tiles", { expire: 0 });
}

/** Сохраняет порядок плиток: массив id в нужной последовательности. */
export async function reorderHomeTiles(ids: string[]): Promise<void> {
  const db = getAdminDb();
  await Promise.all(
    ids.map((id, index) =>
      db
        .from("home_tiles")
        .update({ sort_order: index, updated_at: new Date().toISOString() })
        .eq("id", id)
    )
  );
  revalidateTag("home-tiles", { expire: 0 });
}

// ─── Products ──────────────────────────────────────────────

function getProductDims(p: FirestoreProduct): number[] {
  const dims: number[] = [];
  for (const v of [p.dimensionLength, p.dimensionWidth, p.dimensionHeight]) {
    if (v != null && v > 0) dims.push(v);
  }
  return dims;
}

function parseFeaturedProductOrder(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((x) => String(x || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export async function getFeaturedProductOrderIds(): Promise<string[]> {
  const settings = await getSettings().catch(() => ({} as Record<string, string>));
  return parseFeaturedProductOrder(settings[FEATURED_PRODUCTS_ORDER_SETTING_KEY]);
}

function featuredRankFor(product: FirestoreProduct, orderMap: Map<string, number>): number {
  const bySettings = orderMap.get(product.id);
  if (bySettings != null) return bySettings;
  if (product.featuredOrder != null && Number.isFinite(product.featuredOrder)) {
    return 10_000 + Number(product.featuredOrder);
  }
  return Number.MAX_SAFE_INTEGER;
}

// Товары в наличии всегда выше отсутствующих; настраиваемый в админке
// порядок применяется в первую очередь к товарам в наличии (требование
// от 2026-09: «нет в наличии — выводится ниже тех, что есть»).
function defaultProductCompare(a: FirestoreProduct, b: FirestoreProduct, orderMap: Map<string, number>): number {
  const availA = isProductAvailable(a);
  const availB = isProductAvailable(b);
  if (availA !== availB) return availA ? -1 : 1;

  if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;

  const rankA = featuredRankFor(a, orderMap);
  const rankB = featuredRankFor(b, orderMap);
  if (rankA !== rankB) return rankA - rankB;

  const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (createdA !== createdB) return createdB - createdA;

  return a.name.localeCompare(b.name, "ru");
}

export async function getProducts(opts: {
  categoryId?: string;
  search?: string;
  sortBy?: string;
  limitCount?: number;
  promoOnly?: boolean;
  featuredOnly?: boolean;
  saleOnly?: boolean;
  /** Метки товара: берём товары, у которых есть ХОТЯ БЫ ОДНА из них.
   *  Учитываются и products.tags, и бейджи (promo_label / discount_badge). */
  tags?: string[];
  includeHidden?: boolean;
} = {}): Promise<FirestoreProduct[]> {
  let products = await getCachedProducts();

  if (!opts.includeHidden) {
    products = products.filter((p) => p.isVisible !== false);
  }

  if (opts.categoryId) {
    products = products.filter((p) => p.categoryId === opts.categoryId);
  }
  if (opts.promoOnly) products = products.filter((p) => p.isPromo);
  if (opts.featuredOnly) products = products.filter((p) => p.isFeatured);
  if (opts.saleOnly) products = products.filter((p) => p.isSale);
  if (opts.tags && opts.tags.length > 0) {
    const wanted = opts.tags.map((t) => normalizeTag(t)).filter(Boolean);
    products = products.filter((p) => productHasAnyTag(p, wanted));
  }

  const queryDims = opts.search ? extractQueryDims(opts.search) : null;

  if (opts.search) {
    const q = opts.search.toLowerCase();
    products = products
      .map((p) => {
        const name = p.name.toLowerCase();
        const sku = (p.sku || "").toLowerCase();
        const desc = (p.description || "").toLowerCase();
        let score = 0;
        if (name === q) score += 30;
        else if (name.startsWith(q)) score += 20;
        else if (name.includes(q)) score += 10;
        if (sku && sku.includes(q)) score += 15;
        if (desc && desc.includes(q)) score += 3;
        if (queryDims) {
          score += dimensionScore(queryDims, getProductDims(p)) * 25;
        }
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  }

  const featuredOrderIds =
    opts.featuredOnly || !opts.sortBy || opts.sortBy === "default"
      ? await getFeaturedProductOrderIds()
      : [];
  const featuredOrderMap = new Map(
    featuredOrderIds.map((id, index) => [id, index] as const)
  );

  switch (opts.sortBy) {
    case "price_asc":
      products.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      break;
    case "price_desc":
      products.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
      break;
    case "name":
      products.sort((a, b) => a.name.localeCompare(b.name, "ru"));
      break;
    case "newest":
      products.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
      break;
    default:
      products.sort((a, b) => defaultProductCompare(a, b, featuredOrderMap));
  }

  if (opts.limitCount) products = products.slice(0, opts.limitCount);
  return products;
}

/**
 * Облегчённая выборка для массового редактора: без описаний, штрихкодов,
 * фотографий и агрегации вариантов. Фото выбранных товаров загружаются
 * отдельно только на соответствующем шаге.
 */
export async function getProductsForBulkEditor(): Promise<FirestoreProduct[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("products")
    .select([
      "id",
      "name",
      "slug",
      "sku",
      "category_id",
      "price",
      "price_wholesale",
      "min_wholesale_qty",
      "material",
      "pack_qty",
      "note",
      "stock_qty",
      "in_stock",
      "is_visible",
      "is_promo",
      "is_featured",
      "is_sale",
      "promo_label",
    ].join(","))
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapProductRow);
}

export async function getProductById(id: string): Promise<FirestoreProduct | null> {
  const products = await getCachedProducts();
  return products.find((p) => p.id === id) || null;
}

/**
 * Сырой товар для админки — без агрегирования из вариантов и без
 * витринных подмен price/stockQty. Нужен на странице редактирования,
 * иначе админ видел производные значения (например, -1 из products или
 * суммарный variant stock) вместо того, что сохраняет в карточке.
 */
export async function getProductByIdForAdmin(id: string): Promise<FirestoreProduct | null> {
  const db = getAdminDb();
  const { data, error } = await db.from("products").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const product = mapProductRow(data);
  product.barcode = product.barcode || computeBarcode(product.id);
  product.qrSlug = computeQrSlug(product.id);
  return product;
}

export async function getProductBySlug(slug: string): Promise<FirestoreProduct | null> {
  const products = await getCachedProducts();
  return products.find((p) => p.slug === slug) || null;
}

/**
 * Версия для страницы товара: всегда подтягивает полный список
 * видимых вариантов (для UI «выбери цвет/размер»).
 * Использует кеш getCachedVariantsMap, так что дополнительный
 * запрос идёт только если данные устарели.
 */
export async function getProductBySlugForPage(
  slug: string,
): Promise<{ product: FirestoreProduct | null; variants: ProductVariant[] }> {
  const product = await getProductBySlug(slug);
  if (!product) return { product: null, variants: [] };
  // Берём кешированную карту (та же, что и в getCachedProducts) —
  // это сохраняет 1 запрос в БД.
  const map = await getCachedVariantsMap([product.id]);
  // Defensive: getCachedVariantsMap всегда возвращает Map, но если
  // на edge крутится старая версия, которая вернула что-то иное
  // (например, массив из-за двойного оборачивания productIds), то
  // без этой проверки мы получим "X.get is not a function" и страница
  // товара упадёт. Поэтому проверяем тип и при необходимости
  // восстанавливаем карту из entries.
  const variantsMap: Map<string, ProductVariant[]> =
    map instanceof Map
      ? map
      : new Map<string, ProductVariant[]>(
          Array.isArray(map) ? (map as Array<[string, ProductVariant[]]>) : []
        );
  const allVariants = variantsMap.get(product.id) || [];
  // Для страницы товара — только видимые
  return {
    product,
    variants: allVariants.filter((v) => v.isVisible),
  };
}

export async function getRelatedProducts(
  categoryId: string,
  excludeProductId: string,
  limitCount = 4
): Promise<FirestoreProduct[]> {
  const products = await getCachedProducts();
  return products
    .filter((p) => p.categoryId === categoryId && p.id !== excludeProductId && p.isVisible !== false)
    .slice(0, limitCount);
}

export async function createProduct(data: Record<string, any>): Promise<{ id: string }> {
  const db = getAdminDb();
  const slug = data.slug || slugify(data.name || "product");
  const calculatedVolume = calculateBoxVolumeLiters(
    data.dimensionLength,
    data.dimensionWidth,
    data.dimensionHeight,
    data.dimensionUnit,
  );
  const payload: Record<string, any> = {
    name: data.name || "",
    slug,
    category_id: data.categoryId || null,
    sku: data.sku || null,
    description: data.description || null,
    price: data.price ?? null,
    price_wholesale: data.priceWholesale ?? null,
    purchase_price: data.purchasePrice ?? null,
    min_wholesale_qty: data.minWholesaleQty ?? null,
    dimension_length: data.dimensionLength ?? null,
    dimension_width: data.dimensionWidth ?? null,
    dimension_height: data.dimensionHeight ?? null,
    dimension_unit: data.dimensionUnit || "мм",
    weight: data.weight ?? null,
    material: data.material || null,
    pack_qty: data.packQty ?? null,
    volume: calculatedVolume,
    note: data.note || null,
    in_stock: data.inStock ?? true,
    stock_qty: data.stockQty ?? null,
    stock_warn_qty: data.stockWarnQty ?? null,
    is_promo: data.isPromo ?? false,
    promo_label: data.promoLabel || null,
    tags: sanitizeTagsForSave(data.tags),
    promo_label_color: normalizeProductLabelColor(data.promoLabelColor),
    promo_label_text_color: normalizeProductLabelColor(data.promoLabelTextColor),
    made_to_order: data.madeToOrder ?? false,
    made_to_order_min_qty: data.madeToOrderMinQty ?? null,
    is_cuttable: data.isCuttable ?? false,
    cut_meters_per_roll: data.cutMetersPerRoll ?? null,
    cut_price_per_meter: data.cutPricePerMeter ?? null,
    cut_unit_name: data.cutUnitName || "м",
    discount_type: data.discountType || null,
    discount_value: data.discountValue ?? null,
    discount_badge: data.discountBadge || null,
    is_visible: data.isVisible ?? true,
    is_featured: data.isFeatured ?? false,
    is_sale: data.isSale ?? false,
    // Главное фото: если явное пусто — берём первое из массива.
    image_url: data.imageUrl || firstImageUrl(normalizeProductImages(data.images)) || null,
    images: normalizeProductImages(data.images),
    // Штрихкод админ может задать сам (валидируется на API-слое);
    // если не задан — сгенерируем сразу после вставки.
    barcode: data.barcode || null,
  };

  // Если в БД ещё нет колонки barcode/purchase_price (миграция не
  // применена), PostgREST отклоняет insert целиком (PGRST204). В таком
  // случае ПОВТОРЯЕМ запись без этих полей — товар должен сохраняться
  // всегда.
  let result: { id: string } | null = null;
  let insertErr: any = null;
  const first = await db.from("products").insert(payload).select("id").single();
  if (first.error) {
    insertErr = first.error;
    if (isMissingBarcodeColumnError(first.error)) {
      console.warn(BARCODE_COLUMN_MISSING_HINT);
      const { barcode: _bc, ...payloadNoBarcode } = payload;
      const retry = await db.from("products").insert(payloadNoBarcode).select("id").single();
      if (retry.error) throw retry.error;
      result = retry.data;
      insertErr = null;
    } else if (isMissingPurchasePriceColumnError(first.error)) {
      console.warn("[products] Колонки purchase_price нет — запись без закупочной цены");
      const { purchase_price: _pp, ...payloadNoPP } = payload;
      const retry2 = await db.from("products").insert(payloadNoPP).select("id").single();
      if (retry2.error) throw retry2.error;
      result = retry2.data;
      insertErr = null;
    } else if (isMissingMadeToOrderMinQtyColumnError(first.error)) {
      console.warn("[products] Колонки made_to_order_min_qty нет — запись без мин. кол-ва");
      const { made_to_order_min_qty: _moq, ...payloadNoMoq } = payload;
      const retry3 = await db.from("products").insert(payloadNoMoq).select("id").single();
      if (retry3.error) throw retry3.error;
      result = retry3.data;
      insertErr = null;
    } else if (isMissingCuttableColumnError(first.error)) {
      console.warn("[products] Колонки is_cuttable нет — запись без вариативности");
      const { is_cuttable: _cut, cut_meters_per_roll: _cmpr, cut_price_per_meter: _cppm, cut_unit_name: _cun, ...payloadNoCut } = payload;
      const retry4 = await db.from("products").insert(payloadNoCut).select("id").single();
      if (retry4.error) throw retry4.error;
      result = retry4.data;
      insertErr = null;
    } else if (isMissingProductLabelColorColumnError(first.error)) {
      console.warn("[products] Колонок цветов метки ещё нет — запись без цветов");
      const {
        promo_label_color: _labelColor,
        promo_label_text_color: _labelTextColor,
        ...payloadNoLabelColors
      } = payload;
      const retry5 = await db.from("products").insert(payloadNoLabelColors).select("id").single();
      if (retry5.error) throw retry5.error;
      result = retry5.data;
      insertErr = null;
    } else if (isMissingSaleColumnError(first.error)) {
      console.warn("[products] Колонки is_sale нет — запись без флага распродажи");
      const { is_sale: _sale, ...payloadNoSale } = payload;
      const retry6 = await db.from("products").insert(payloadNoSale).select("id").single();
      if (retry6.error) throw retry6.error;
      result = retry6.data;
      insertErr = null;
    } else if (isMissingTagsColumnError(first.error)) {
      console.warn(
        "[products] Колонки tags нет — запись без меток. " +
          "Выполните supabase/migration_home_tiles.sql в Supabase."
      );
      const { tags: _tags, ...payloadNoTags } = payload;
      const retry7 = await db.from("products").insert(payloadNoTags).select("id").single();
      if (retry7.error) throw retry7.error;
      result = retry7.data;
      insertErr = null;
    }
  } else {
    result = first.data;
  }
  if (insertErr) throw insertErr;
  if (!result) throw new Error("Не удалось создать товар");

  // Постоянный штрихкод сразу сохраняем в БД. Если админ ввёл свой
  // (уже уехал в insert выше) — ensure увидит его и ничего не
  // перезапишет («один штрихкод навсегда»).
  if (!data.barcode) {
    await ensureProductBarcode(result.id).catch((e) => {
      // Товар уже создан, штрихкод дозапишется кнопкой
      // «Обновить штрихкоды» или при следующем сохранении — не
      // валим всю операцию из-за вспомогательного шага.
      console.error("ensureProductBarcode (after create):", e);
    });
  }

  invalidateProductsCache();
  revalidateTag("products", { expire: 0 });
  return { id: result.id };
}

export async function updateProduct(id: string, data: Record<string, any>): Promise<void> {
  const db = getAdminDb();
  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  const fieldMap: Record<string, string> = {
    name: "name", slug: "slug", categoryId: "category_id", sku: "sku",
    description: "description", price: "price", priceWholesale: "price_wholesale",
    purchasePrice: "purchase_price",
    minWholesaleQty: "min_wholesale_qty", dimensionLength: "dimension_length",
    dimensionWidth: "dimension_width", dimensionHeight: "dimension_height",
    dimensionUnit: "dimension_unit", weight: "weight", material: "material",
    packQty: "pack_qty", volume: "volume", note: "note", inStock: "in_stock",
    stockQty: "stock_qty", stockWarnQty: "stock_warn_qty", isPromo: "is_promo",
    promoLabel: "promo_label", promoLabelColor: "promo_label_color",
    tags: "tags",
    promoLabelTextColor: "promo_label_text_color",
    madeToOrder: "made_to_order", madeToOrderMinQty: "made_to_order_min_qty",
    isCuttable: "is_cuttable", cutMetersPerRoll: "cut_meters_per_roll", cutPricePerMeter: "cut_price_per_meter", cutUnitName: "cut_unit_name",
    discountType: "discount_type", discountValue: "discount_value",
    discountBadge: "discount_badge", isVisible: "is_visible",
    isFeatured: "is_featured", isSale: "is_sale", imageUrl: "image_url", images: "images",
    // Штрихкод можно поменять только явно (форма товара). Значение
    // валидируется на API-слое; пустая строка = очистить (потом
    // дозапишется генерацией). Никакая другая правка товара колонку
    // не трогает — поля просто нет в data.
    barcode: "barcode",
  };
  for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
    if (data[jsKey] !== undefined) payload[dbKey] = data[jsKey];
  }

  if (
    "dimensionLength" in data &&
    "dimensionWidth" in data &&
    "dimensionHeight" in data
  ) {
    payload.volume = calculateBoxVolumeLiters(
      data.dimensionLength,
      data.dimensionWidth,
      data.dimensionHeight,
      data.dimensionUnit,
    );
  }
  if (data.tags !== undefined) {
    payload.tags = sanitizeTagsForSave(data.tags);
  }
  if (data.promoLabelColor !== undefined) {
    payload.promo_label_color = normalizeProductLabelColor(data.promoLabelColor);
  }
  if (data.promoLabelTextColor !== undefined) {
    payload.promo_label_text_color = normalizeProductLabelColor(data.promoLabelTextColor);
  }

  // ── Фото: нормализация + неубиваемое главное фото ──
  // Если вызывающий код передал массив images, приводим его к виду
  // [{url, publicId}] и «главным» делаем первый элемент, даже когда
  // imageUrl не передан вовсе (раньше форма с пустым массивом у товара,
  // чьё фото лежало только в image_url, затирала фото null'ом).
  if (data.images !== undefined) {
    const imgs = normalizeProductImages(data.images);
    payload.images = imgs;
    if (data.imageUrl !== undefined) {
      payload.image_url = data.imageUrl || firstImageUrl(imgs) || null;
    }
  }

  // Админка редактирует эти поля напрямую в карточке товара.
  // Приводим их к числам явно, чтобы в БД не оставались старые/битые
  // значения и чтобы UI после сохранения показывал именно то, что ввёл админ.
  if (data.stockQty !== undefined) {
    payload.stock_qty = data.stockQty == null || data.stockQty === ""
      ? null
      : Number(data.stockQty);
  }
  if (data.packQty !== undefined) {
    payload.pack_qty = data.packQty == null || data.packQty === ""
      ? null
      : Number(data.packQty);
  }
  if (data.madeToOrderMinQty !== undefined) {
    payload.made_to_order_min_qty = data.madeToOrderMinQty == null || data.madeToOrderMinQty === ""
      ? null
      : Math.max(1, Math.floor(Number(data.madeToOrderMinQty) || 0));
  }
  if (data.isCuttable !== undefined) {
    payload.is_cuttable = Boolean(data.isCuttable);
  }
  if (data.cutMetersPerRoll !== undefined) {
    payload.cut_meters_per_roll = data.cutMetersPerRoll == null || data.cutMetersPerRoll === ""
      ? null
      : Math.max(0.01, Number(data.cutMetersPerRoll) || 0);
  }
  if (data.cutPricePerMeter !== undefined) {
    payload.cut_price_per_meter = data.cutPricePerMeter == null || data.cutPricePerMeter === ""
      ? null
      : Math.max(0, Number(data.cutPricePerMeter) || 0);
  }
  if (data.cutUnitName !== undefined) {
    payload.cut_unit_name = data.cutUnitName ? String(data.cutUnitName).slice(0,20) : "м";
  }
  // Ретрай без barcode/purchase_price, если колонки ещё нет в БД (миграция не
  // применена) — сохранение товара не должно падать из-за этого.
  let { error } = await db.from("products").update(payload).eq("id", id);
  if (error && isMissingBarcodeColumnError(error) && "barcode" in payload) {
    console.warn(BARCODE_COLUMN_MISSING_HINT);
    const { barcode: _bc, ...payloadNoBarcode } = payload;
    ({ error } = await db.from("products").update(payloadNoBarcode).eq("id", id));
  }
  if (error && isMissingPurchasePriceColumnError(error) && "purchase_price" in payload) {
    console.warn("[products] Колонки purchase_price нет — сохранение без неё");
    const { purchase_price: _pp, ...payloadNoPP } = payload;
    ({ error } = await db.from("products").update(payloadNoPP).eq("id", id));
  }
  if (error && isMissingMadeToOrderMinQtyColumnError(error) && "made_to_order_min_qty" in payload) {
    console.warn("[products] Колонки made_to_order_min_qty нет — сохранение без неё");
    const { made_to_order_min_qty: _moq, ...payloadNoMoq } = payload;
    ({ error } = await db.from("products").update(payloadNoMoq).eq("id", id));
  }
  if (error && isMissingCuttableColumnError(error) && ("is_cuttable" in payload || "cut_meters_per_roll" in payload || "cut_price_per_meter" in payload)) {
    console.warn("[products] Колонки cuttable нет — сохранение без неё");
    const { is_cuttable: _cut, cut_meters_per_roll: _cmpr, cut_price_per_meter: _cppm, cut_unit_name: _cun, ...payloadNoCut } = payload;
    ({ error } = await db.from("products").update(payloadNoCut).eq("id", id));
  }
  if (error && isMissingProductLabelColorColumnError(error)) {
    console.warn("[products] Колонок цветов метки ещё нет — сохранение без цветов");
    const {
      promo_label_color: _labelColor,
      promo_label_text_color: _labelTextColor,
      ...payloadNoLabelColors
    } = payload;
    ({ error } = await db.from("products").update(payloadNoLabelColors).eq("id", id));
  }
  if (error && isMissingSaleColumnError(error) && "is_sale" in payload) {
    console.warn("[products] Колонки is_sale нет — сохранение без флага распродажи");
    const { is_sale: _sale, ...payloadNoSale } = payload;
    ({ error } = await db.from("products").update(payloadNoSale).eq("id", id));
  }
  if (error && isMissingTagsColumnError(error) && "tags" in payload) {
    console.warn(
      "[products] Колонки tags нет — сохранение без меток. " +
        "Выполните supabase/migration_home_tiles.sql в Supabase."
    );
    const { tags: _tags, ...payloadNoTags } = payload;
    ({ error } = await db.from("products").update(payloadNoTags).eq("id", id));
  }
  if (error) throw error;
  invalidateProductsCache();
  revalidateTag("products", { expire: 0 });
}

export async function deleteProduct(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("products").delete().eq("id", id);
  if (error) throw error;
  invalidateProductsCache();
  revalidateTag("products", { expire: 0 });
}

// ── Штрихкоды товаров (постоянные EAN-13 в products.barcode) ──

/** Все занятые штрихкоды каталога (для проверки уникальности). */
async function fetchUsedBarcodes(exceptIds?: Set<string>): Promise<Set<string>> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("products")
    .select("id, barcode")
    .not("barcode", "is", null)
    .limit(100000);
  if (error) {
    if (isMissingBarcodeColumnError(error)) throw barcodeColumnRequiredError();
    throw error;
  }
  const used = new Set<string>();
  for (const row of data || []) {
    if (exceptIds?.has(row.id)) continue;
    if (row.barcode) used.add(row.barcode);
  }
  return used;
}

/**
 * Гарантирует, что у товара есть штрихкод В БД. Если код уже есть —
 * ничего не делает (штрихкод постоянный и не меняется сам).
 * Если нет — генерирует уникальный (приоритет у детерминированного
 * computeBarcode(id), чтобы совпасть со старыми этикетками) и
 * сохраняет. Возвращает итоговый код и флаг «создан сейчас».
 */
export async function ensureProductBarcode(
  id: string
): Promise<{ barcode: string; created: boolean }> {
  const db = getAdminDb();
  const { data: row, error } = await db
    .from("products")
    .select("id, barcode")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingBarcodeColumnError(error)) throw barcodeColumnRequiredError();
    throw error;
  }
  if (!row) throw new Error("Товар не найден");
  if (row.barcode && isValidBarcode(row.barcode)) {
    return { barcode: row.barcode, created: false };
  }

  const used = await fetchUsedBarcodes(new Set([id]));
  const barcode = generateUniqueBarcode(id, used);
  const { error: upErr } = await db
    .from("products")
    .update({ barcode })
    .eq("id", id);
  if (upErr) {
    if (isMissingBarcodeColumnError(upErr)) throw barcodeColumnRequiredError();
    throw upErr;
  }

  invalidateProductsCache();
  revalidateTag("products", { expire: 0 });
  return { barcode, created: true };
}

/**
 * Принудительная перегенерация штрихкода одного товара — ручное
 * действие админа («сам решил изменить»). Старый код гасится.
 */
export async function regenerateProductBarcode(
  id: string
): Promise<{ barcode: string }> {
  const db = getAdminDb();
  const { data: row, error } = await db
    .from("products")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Товар не найден");

  const used = await fetchUsedBarcodes(new Set([id]));
  // Перегенерация — всегда солёный вариант, даже если
  // детерминированный свободен (он и есть старый код).
  let barcode = "";
  for (let salt = 1; salt < 1000; salt++) {
    const candidate = computeBarcode(`${id}#${salt}`);
    if (!used.has(candidate)) {
      barcode = candidate;
      break;
    }
  }
  if (!barcode) barcode = generateUniqueBarcode(id, used);

  const { error: upErr } = await db
    .from("products")
    .update({ barcode })
    .eq("id", id);
  if (upErr) {
    if (isMissingBarcodeColumnError(upErr)) throw barcodeColumnRequiredError();
    throw upErr;
  }

  invalidateProductsCache();
  revalidateTag("products", { expire: 0 });
  return { barcode };
}

export type BarcodeFixReport = {
  total: number;
  /** Сколько товаров получило новый штрихкод. */
  assigned: number;
  /** Сколько товаров уже имело валидный код — их не трогали. */
  skipped: number;
  /** Ошибки по отдельным товарам (id → сообщение). */
  errors: { id: string; name: string; error: string }[];
};

/**
 * Кнопка «Обновить штрихкоды»: проходит по каталогу и дозаписывает
 * штрихкод ТОЛЬКО товарам, у которых:
 *   • кода нет вовсе;
 *   • код битый (не EAN-13 / неверная контрольная сумма);
 *   • код ДУБЛИРУЕТСЯ у двух товаров (дубль получает новый код,
 *     первый по имени товар с этим кодом остаётся как есть).
 * Товары с валидным уникальным кодом НЕ меняются («не менял
 * постоянно — один штрихкод навсегда»).
 */
export async function fixMissingProductBarcodes(): Promise<BarcodeFixReport> {
  const db = getAdminDb();
  const { data: rows, error } = await db
    .from("products")
    .select("id, name, barcode")
    .order("created_at", { ascending: true })
    .limit(100000);
  if (error) {
    if (isMissingBarcodeColumnError(error)) throw barcodeColumnRequiredError();
    throw error;
  }

  const report: BarcodeFixReport = {
    total: (rows || []).length,
    assigned: 0,
    skipped: 0,
    errors: [],
  };

  // Множество занятых кодов наполняем по мере обхода: так дубль
  // (второй товар с тем же кодом) тоже попадёт в перегенерацию,
  // а первый — останется с исходным кодом.
  const used = new Set<string>();
  const pending: { id: string; name: string }[] = [];

  for (const row of rows || []) {
    const bc = (row.barcode || "").trim();
    if (bc && isValidBarcode(bc) && !used.has(bc)) {
      used.add(bc);
      report.skipped++;
    } else {
      pending.push({ id: row.id, name: row.name || "" });
    }
  }

  for (const item of pending) {
    try {
      const barcode = generateUniqueBarcode(item.id, used);
      const { error: upErr } = await db
        .from("products")
        .update({ barcode })
        .eq("id", item.id);
      if (upErr) throw upErr;
      used.add(barcode);
      report.assigned++;
    } catch (e) {
      report.errors.push({
        id: item.id,
        name: item.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (report.assigned > 0) {
    invalidateProductsCache();
    revalidateTag("products", { expire: 0 });
  }
  return report;
}

// ─── Orders ────────────────────────────────────────────────

function mapOrderRow(row: any): FirestoreOrder {
  return {
    id: row.id,
    type: row.type,
    customerType: row.customer_type,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerPhoneDigits: row.customer_phone_digits || null,
    userId: row.user_id || null,
    customerEmail: row.customer_email || null,
    communicationChannel: row.communication_channel,
    paymentMethod: row.payment_method || null,
    items: row.items || null,
    totalSum: row.total_sum != null ? Number(row.total_sum) : null,
    productInfo: row.product_info || null,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    comment: row.comment || null,
    channel: row.channel || null,
    status: row.status,
    closeReason: row.close_reason || null,
    pickupCode: row.pickup_code || null,
    issuedAt: toIso(row.issued_at),
    dealId: row.deal_id || null,
    dealNumber: row.deal_number != null ? Number(row.deal_number) : null,
    paymentId: row.payment_id || null,
    deliveryAddress: row.delivery_address || null,
    hasDelivery: row.has_delivery ?? false,
    deliveryType: row.delivery_type || null,
    deliveryCost: row.delivery_cost != null ? Number(row.delivery_cost) : null,
    deliveryPlannedDate: row.delivery_planned_date || null,
    deliveryReleasedAt: toIso(row.delivery_released_at),
    deliveryNote: row.delivery_note || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// ── Фильтр заявок по статусу ──
// «all»      — без фильтра;
// «active»   — рабочий список менеджера: новые + в работе + готовые к выдаче
//              (ничего не «исчезает» по мере продвижения заявки);
// «archived» — закрытые: проведённые + отменённые;
// конкретный статус или список через запятую — точный фильтр.
function applyOrderStatusFilter(q: any, status?: string): any {
  if (!status || status === "all") return q;
  if (status === "active") return q.in("status", ["new", "in_progress", "ready"]);
  if (status === "archived") return q.in("status", ["issued", "completed", "rejected"]);
  const parts = status.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return q;
  if (parts.length === 1) return q.eq("status", parts[0]);
  return q.in("status", parts);
}

export async function getOrders(opts: { limit?: number; status?: string } = {}): Promise<FirestoreOrder[]> {
  const db = getAdminDb();
  let q = db.from("orders").select("*").order("created_at", { ascending: false });
  q = applyOrderStatusFilter(q, opts.status);
  const { data, error } = await q.limit(opts.limit || 500);
  if (error) throw error;
  return (data || []).map(mapOrderRow);
}

export async function createOrder(data: Record<string, any>): Promise<{ id: string; pickupCode: string }> {
  const db = getAdminDb();
  const payload = {
    type: data.type || "order",
    customer_type: data.customerType || "individual",
    customer_name: data.customerName || "",
    customer_phone: data.customerPhone || "",
    customer_phone_digits: data.customerPhoneDigits || null,
    user_id: data.userId || null,
    customer_email: data.customerEmail || null,
    communication_channel: data.communicationChannel || "call",
    payment_method: data.paymentMethod || null,
    items: data.items || null,
    total_sum: data.totalSum ?? null,
    product_info: data.productInfo || null,
    quantity: data.quantity ?? null,
    comment: data.comment || null,
    channel: data.channel || "website",
    status: data.status || "new",
    company_name: data.companyName || null,
    short_name: data.shortName || null,
    inn: data.inn || null,
    kpp: data.kpp || null,
    ogrn: data.ogrn || null,
    legal_address: data.legalAddress || null,
    actual_address: data.actualAddress || null,
    tax_system: data.taxSystem || null,
    bank_account: data.bankAccount || null,
    bank_name: data.bankName || null,
    bik: data.bik || null,
    correspondent_account: data.correspondentAccount || null,
    delivery_address: data.deliveryAddress || null,
    has_delivery: data.hasDelivery ?? false,
    delivery_type: data.deliveryType || null,
    delivery_cost: data.deliveryCost ?? 0,
    delivery_note: data.deliveryNote || null,
  };

  // Код выдачи генерируем только для заказов (не для заявок «узнать цену»).
  // Уникальность гарантируем коротким циклом перегенерации при коллизии.
  const needsPickupCode = payload.type === "order";
  if (needsPickupCode) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generatePickupCode();
      const { data: clash } = await db
        .from("orders")
        .select("id")
        .eq("pickup_code", code)
        .maybeSingle();
      if (!clash) {
        (payload as Record<string, any>).pickup_code = code;
        break;
      }
    }
    if (!(payload as Record<string, any>).pickup_code) {
      // Крайне маловероятно — страховка от бесконечных коллизий.
      (payload as Record<string, any>).pickup_code = generatePickupCode(10);
    }
  }

  const { data: result, error } = await db.from("orders").insert(payload).select("id, pickup_code").single();
  if (error) throw error;
  revalidateTag("orders", { expire: 0 });
  return { id: result.id, pickupCode: result.pickup_code || null };
}

export async function updateOrderStatus(id: string, status: string, closeReason: string | null = null): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("orders").update({
    status,
    close_reason: closeReason,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
  revalidateTag("orders", { expire: 0 });
}

export async function deleteOrder(id: string): Promise<{ table: "orders" | "wastepaper_requests" | null; deleted: boolean }> {
  const db = getAdminDb();
  const cleanId = String(id || "").trim();
  if (!cleanId) throw new Error("Не указан ID заявки");

  // 1. Получаем заявку из основной таблицы заказов/уточнений.
  const { data: order, error: orderError } = await db
    .from("orders")
    .select("*")
    .eq("id", cleanId)
    .maybeSingle();

  // Если это не orders, пробуем таблицу макулатуры. Раньше такие заявки из-за
  // отсутствующего поля type могли отображаться как «На уточнение», а кнопка
  // удаления била не в тот endpoint.
  if (orderError || !order) {
    const { data: wastepaper } = await db
      .from("wastepaper_requests")
      .select("id")
      .eq("id", cleanId)
      .maybeSingle();
    if (wastepaper) {
      const { data: deletedRows, error: deleteWasteError } = await db
        .from("wastepaper_requests")
        .delete()
        .eq("id", cleanId)
        .select("id");
      if (deleteWasteError) throw deleteWasteError;
      if (!deletedRows || deletedRows.length === 0) {
        throw new Error("Заявка найдена в макулатуре, но не была удалена");
      }
      revalidateTag("wastepaper", { expire: 0 });
      revalidateTag("orders", { expire: 0 });
      return { table: "wastepaper_requests", deleted: true };
    }

    // Заявка уже отсутствует в обеих таблицах — считаем удаление идемпотентным.
    console.warn("deleteOrder: заявка не найдена, возможно уже удалена:", cleanId);
    revalidateTag("orders", { expire: 0 });
    revalidateTag("wastepaper", { expire: 0 });
    return { table: null, deleted: false };
  }
  
  // 2. Каскадное удаление связанных документов (каждый шаг обёрнут в try/catch,
  //    чтобы ошибка на одном шаге не блокировала остальные)
  
  if (order.deal_id) {
    const { data: deal } = await db.from("customer_deals").select("*").eq("id", order.deal_id).maybeSingle();
    if (deal) {
      // Возвращаем товары на склад, если заказ был проведён
      if (deal.status === "completed" && Array.isArray(deal.items)) {
        for (const item of deal.items) {
          try {
            const { data: product } = await db.from("products").select("stock_qty").eq("id", item.productId).maybeSingle();
            if (product) {
              const currentQty = Number(product.stock_qty || 0);
              const returnQty = Number(item.quantity || 0);
              await db.from("products").update({ 
                stock_qty: currentQty + returnQty,
                in_stock: (currentQty + returnQty) > 0
              }).eq("id", item.productId);
            }
          } catch (e) {
            console.error("deleteOrder: ошибка возврата товара на склад:", e);
          }
        }
      }
      // Удаляем связанные неоплаченные платежи по deal
      try {
        const { data: payments } = await db.from("bank_payments").select("*");
        const dealPayments = (payments || []).filter((p: any) => 
          Array.isArray(p.deal_ids) && p.deal_ids.map(String).includes(String(deal.id))
        );
        for (const payment of dealPayments) {
          const isAutoOrderPayment =
            order.payment_id && String(payment.id) === String(order.payment_id);
          const dealLinks = Array.isArray(payment.deal_ids) ? payment.deal_ids : [];
          const receiptLinks = Array.isArray(payment.receipt_ids) ? payment.receipt_ids : [];
          const onlyThisDeal =
            dealLinks.length === 1 &&
            String(dealLinks[0]) === String(deal.id) &&
            receiptLinks.length === 0;
          // Автоматический платёж из заявки (в т.ч. наличный, уже отмеченный
          // оплаченным) удаляем вместе с заявкой. Ручные оплаченные платежи
          // не трогаем.
          if (!payment.is_paid || (isAutoOrderPayment && onlyThisDeal)) {
            await db.from("bank_payments").delete().eq("id", payment.id);
          }
        }
      } catch (e) {
        console.error("deleteOrder: ошибка удаления платежей deal:", e);
      }
      // Удаляем заказ покупателя
      try {
        await db.from("customer_deals").delete().eq("id", order.deal_id);
      } catch (e) {
        console.error("deleteOrder: ошибка удаления deal:", e);
      }
    }
  }
  
  // 3. Удаляем автоматический платёж заявки, если он ещё существует без deal.
  if (order.payment_id) {
    try {
      const { data: payment } = await db
        .from("bank_payments")
        .select("*")
        .eq("id", order.payment_id)
        .maybeSingle();
      if (payment) {
        const dealLinks = Array.isArray(payment.deal_ids) ? payment.deal_ids : [];
        const receiptLinks = Array.isArray(payment.receipt_ids) ? payment.receipt_ids : [];
        if (dealLinks.length === 0 && receiptLinks.length === 0) {
          await db.from("bank_payments").delete().eq("id", payment.id);
        }
      }
    } catch (e) {
      console.error("deleteOrder: ошибка удаления прямого платежа заявки:", e);
    }
  }

  // 4. ВСЕГДА удаляем саму заявку и проверяем факт удаления.
  const { data: deletedRows, error } = await db
    .from("orders")
    .delete()
    .eq("id", cleanId)
    .select("id");
  if (error) throw error;
  if (!deletedRows || deletedRows.length === 0) {
    const { data: stillExists } = await db.from("orders").select("id").eq("id", cleanId).maybeSingle();
    if (stillExists) throw new Error("Заявка найдена, но не была удалена");
    return { table: "orders", deleted: false };
  }
  
  invalidateProductsCache();
  revalidateTag("orders", { expire: 0 });
  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("products", { expire: 0 });
  return { table: "orders", deleted: true };
}

export async function getOrderById(id: string): Promise<FirestoreOrder | null> {
  const db = getAdminDb();
  const { data, error } = await db.from("orders").select("*").eq("id", id).single();
  if (error || !data) return null;
  return mapOrderRow(data);
}

/** Заказы с доставкой (для вкладки «Доставки») */
export async function getDeliveryOrders(opts: {
  limit?: number;
  /** unreleased — не отпущенные; released — отпущенные; all — все с доставкой */
  filter?: "unreleased" | "released" | "all";
  /** YYYY-MM-DD — фильтр по запланированной дате */
  plannedDate?: string | null;
} = {}): Promise<FirestoreOrder[]> {
  const db = getAdminDb();
  let q = db
    .from("orders")
    .select("*")
    .eq("has_delivery", true)
    .order("delivery_planned_date", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false });

  if (opts.filter === "unreleased") {
    q = q.is("delivery_released_at", null);
  } else if (opts.filter === "released") {
    q = q.not("delivery_released_at", "is", null);
  }
  if (opts.plannedDate) {
    q = q.eq("delivery_planned_date", opts.plannedDate);
  }
  q = q.limit(opts.limit || 500);

  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(mapOrderRow);
}

/** Обновить поля доставки заказа */
export async function updateOrderDelivery(
  id: string,
  data: {
    hasDelivery?: boolean;
    deliveryType?: "free" | "paid" | null;
    deliveryCost?: number | null;
    deliveryAddress?: string | null;
    deliveryPlannedDate?: string | null;
    deliveryReleasedAt?: string | null;
    deliveryNote?: string | null;
    clearRelease?: boolean;
  }
): Promise<FirestoreOrder> {
  const db = getAdminDb();
  const payload: Record<string, any> = { updated_at: new Date().toISOString() };

  if (data.hasDelivery !== undefined) payload.has_delivery = data.hasDelivery;
  if (data.deliveryType !== undefined) payload.delivery_type = data.deliveryType;
  if (data.deliveryCost !== undefined) {
    // ★ Сумма определяет тариф: 0 ₽ — бесплатная доставка (например,
    //   персональные условия клиента при заказе ниже порога), > 0 ₽ —
    //   платная. Иначе ручной ноль «не сохранялся» и заказ оставался
    //   платным со старой суммой.
    const cost =
      data.deliveryCost == null ? 0 : Math.max(0, Number(data.deliveryCost) || 0);
    payload.delivery_cost = cost;
    payload.delivery_type = cost > 0 ? "paid" : "free";
  }
  if (data.deliveryAddress !== undefined) {
    payload.delivery_address = data.deliveryAddress
      ? String(data.deliveryAddress).trim().slice(0, 400)
      : null;
  }
  if (data.deliveryPlannedDate !== undefined) {
    payload.delivery_planned_date = data.deliveryPlannedDate || null;
  }
  if (data.clearRelease) {
    payload.delivery_released_at = null;
  } else if (data.deliveryReleasedAt !== undefined) {
    payload.delivery_released_at = data.deliveryReleasedAt;
  }
  if (data.deliveryNote !== undefined) {
    payload.delivery_note = data.deliveryNote
      ? String(data.deliveryNote).trim().slice(0, 1000)
      : null;
  }

  // Если доставку снимают — обнуляем связанные поля
  if (data.hasDelivery === false) {
    payload.delivery_type = null;
    payload.delivery_cost = 0;
    payload.delivery_planned_date = null;
    payload.delivery_released_at = null;
  }

  const { data: result, error } = await db
    .from("orders")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  revalidateTag("orders", { expire: 0 });
  revalidateTag("deliveries", { expire: 0 });
  return mapOrderRow(result);
}

// ─── Settings ──────────────────────────────────────────────

async function fetchSettings(): Promise<Record<string, string>> {
  const db = getAdminDb();
  const { data, error } = await db.from("settings").select("key, value");
  // При сбое сети отдаём пустые настройки — вызывающий код
  // подставляет дефолты (телефоны/адрес/цены из site-config).
  if (error) {
    console.error("fetchSettings error:", error?.message || error);
    return {};
  }
  const result: Record<string, string> = {};
  for (const row of data || []) {
    if (row.value != null) result[row.key] = row.value;
  }
  return result;
}

const getCachedSettings = unstable_cache(
  fetchSettings,
  ["settings"],
  { revalidate: DATA_REVALIDATE, tags: ["settings"] }
);

export async function getSettings(): Promise<Record<string, string>> {
  return getCachedSettings();
}

// ─── Библиотека шаблонов фото (конструктор карточек) ───────
// Шаблоны лежат в settings под одним JSON-ключом: отдельная таблица
// ради 3-5 записей избыточна, а так они переживают перезагрузку и
// доступны с любого устройства.

export async function getPhotoTemplates(): Promise<SavedPhotoTemplate[]> {
  const settings = await getSettings().catch(() => ({} as Record<string, string>));
  return parseSavedTemplates(settings[PHOTO_TEMPLATES_SETTING_KEY]);
}

export async function savePhotoTemplates(
  templates: SavedPhotoTemplate[]
): Promise<void> {
  await updateSettings({
    [PHOTO_TEMPLATES_SETTING_KEY]: JSON.stringify(
      templates.slice(0, PHOTO_TEMPLATES_LIMIT)
    ),
  });
}

export async function updateSettings(data: Record<string, string>): Promise<void> {
  const db = getAdminDb();
  for (const [key, value] of Object.entries(data)) {
    const { error } = await db.from("settings").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  revalidateTag("settings", { expire: 0 });
}

// ─── Wastepaper Rates ──────────────────────────────────────

export async function getWastepaperRates(): Promise<WastepaperRates> {
  const settings = await getSettings();
  const rates: Partial<WastepaperRates> = {};
  for (const id of WASTEPAPER_RATE_IDS) {
    const raw = settings[wpRateSettingKey(id)];
    rates[id] = parseWastepaperRate(raw, WASTEPAPER_RATE_DEFAULTS[id]);
  }
  return rates as WastepaperRates;
}

// ─── Promotions ────────────────────────────────────────────

export async function getPromotions(): Promise<Promotion[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("promotions").select("*").order("sort_order", { ascending: true });
  if (error) {
    console.error("getPromotions error:", error?.message || error);
    return [];
  }
  return (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle || null,
    badge: row.badge || null,
    imageUrl: row.image_url || null,
    linkType: row.link_type,
    productId: row.product_id || null,
    linkUrl: row.link_url || null,
    sortOrder: Number(row.sort_order || 0),
    isVisible: row.is_visible ?? true,
    icon: row.icon || null,
    color: row.color || null,
    light: row.light || null,
    deadline: row.deadline || null,
    isPopup: row.is_popup ?? false,
    popupStartAt: row.popup_start_at || null,
    popupDelaySeconds: row.popup_delay_seconds ?? null,
    popupDurationSeconds: row.popup_duration_seconds ?? null,
    createdAt: toIso(row.created_at),
  }));
}

/** Alias — страницы админки импортируют это имя */
export const getAllPromotions = getPromotions;

// ─── Popup Campaigns ───────────────────────────────────────

async function fetchAllPopupCampaigns(): Promise<PopupCampaign[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("popup_campaigns").select("*").order("sort_order", { ascending: true });
  // Попапы — не критичны: при сбое просто не показываем их.
  if (error) {
    console.error("fetchAllPopupCampaigns error:", error?.message || error);
    return [];
  }
  return (data || []).map((row: any) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    isActive: row.is_active ?? true,
    kicker: row.kicker || null,
    description: row.description || null,
    details: row.details || null,
    buttonText: row.button_text || null,
    buttonUrl: row.button_url || null,
    style: row.style || "info",
    imageUrl: row.image_url || null,
    startAt: row.start_at || null,
    endAt: row.end_at || null,
    delaySeconds: Number(row.delay_seconds || 0),
    durationSeconds: Number(row.duration_seconds || 20),
    frequency: row.frequency || "session",
    sortOrder: Number(row.sort_order || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));
}

const getCachedPopupCampaigns = unstable_cache(
  fetchAllPopupCampaigns,
  ["popup-campaigns"],
  { revalidate: DATA_REVALIDATE, tags: ["popup-campaigns"] }
);

export async function getAllPopupCampaigns(): Promise<PopupCampaign[]> {
  return getCachedPopupCampaigns();
}

// ─── Product Reviews ───────────────────────────────────────

export async function getProductReviews(
  productId: string,
  opts: { limitCount?: number; offset?: number; sortBy?: string; onlyApproved?: boolean } = {}
): Promise<ProductReview[]> {
  const { limitCount = 20, offset = 0, onlyApproved = true } = opts;
  let reviews = await getCachedProductReviews(productId);
  if (onlyApproved) {
    reviews = reviews.filter((r) => r.isApproved && r.moderationStatus === "approved");
  }
  switch (opts.sortBy) {
    case "helpful":
      reviews.sort((a, b) => b.helpfulCount - a.helpfulCount);
      break;
    case "oldest":
      reviews.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ta - tb;
      });
      break;
    default:
      reviews.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
  }
  return reviews.slice(offset, offset + limitCount);
}

export async function createProductReview(data: Omit<ProductReview, "id" | "createdAt" | "updatedAt" | "helpfulCount" | "isApproved" | "moderationStatus">): Promise<string> {
  const db = getAdminDb();
  const { data: result, error } = await db.from("product_reviews").insert({
    product_id: data.productId,
    user_id: data.userId,
    user_name: data.userName,
    user_avatar: data.userAvatar || null,
    order_id: data.orderId,
    rating: data.rating,
    title: data.title || null,
    text: data.text,
    pros: data.pros || null,
    cons: data.cons || null,
    images: data.images || [],
    is_verified_purchase: data.isVerifiedPurchase ?? false,
    is_approved: false,
    moderation_status: "pending",
  }).select("id").single();
  if (error) throw error;
  revalidateTag("reviews", { expire: 0 });
  revalidateTag(`reviews:${data.productId}`, { expire: 0 });
  return result.id;
}

export async function updateProductReview(id: string, data: Partial<ProductReview>): Promise<void> {
  const db = getAdminDb();
  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  if (data.isApproved !== undefined) payload.is_approved = data.isApproved;
  if (data.moderationStatus) payload.moderation_status = data.moderationStatus;
  if (data.moderationNote !== undefined) payload.moderation_note = data.moderationNote;
  const { error } = await db.from("product_reviews").update(payload).eq("id", id);
  if (error) throw error;
  revalidateTag("reviews", { expire: 0 });
  revalidateTag("products", { expire: 0 });
}

export async function deleteProductReview(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("product_reviews").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("reviews", { expire: 0 });
  revalidateTag("products", { expire: 0 });
}

export async function incrementReviewHelpful(reviewId: string): Promise<number> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("product_reviews")
    .update({ helpful_count: Number(new Date().getTime() % 1) === 0 ? 0 : 0 })
    .eq("id", reviewId)
    .select("helpful_count")
    .single();
  // Используем raw SQL для атомарного инкремента
  const { data: result, error: err2 } = await db.rpc("increment_review_helpful", { review_id_param: reviewId });
  if (err2) {
    // Fallback: read-modify-write
    const { data: review } = await db.from("product_reviews").select("helpful_count").eq("id", reviewId).single();
    const current = Number(review?.helpful_count || 0);
    await db.from("product_reviews").update({ helpful_count: current + 1 }).eq("id", reviewId);
    return current + 1;
  }
  return Number(result || 0);
}

export async function markReviewHelpful(reviewId: string, voterKey: string): Promise<{ helpfulCount: number; already: boolean }> {
  const db = getAdminDb();
  const { data: existing } = await db
    .from("review_helpful_votes")
    .select("id")
    .eq("review_id", reviewId)
    .eq("voter_key", voterKey)
    .maybeSingle();

  const { data: review } = await db.from("product_reviews").select("helpful_count").eq("id", reviewId).single();
  const current = Number(review?.helpful_count || 0);

  if (existing) {
    return { helpfulCount: current, already: true };
  }

  await db.from("review_helpful_votes").insert({ review_id: reviewId, voter_key: voterKey });
  await db.from("product_reviews").update({ helpful_count: current + 1 }).eq("id", reviewId);
  return { helpfulCount: current + 1, already: false };
}

// ─── Product Questions ─────────────────────────────────────

export async function getProductQuestions(
  productId: string,
  opts: { limitCount?: number; offset?: number; onlyApproved?: boolean; onlyAnswered?: boolean } = {}
): Promise<ProductQuestion[]> {
  const db = getAdminDb();
  const { limitCount = 10, offset = 0, onlyApproved = true, onlyAnswered = false } = opts;
  let q = db.from("product_questions").select("*").eq("product_id", productId);
  if (onlyApproved) q = q.eq("is_approved", true).eq("moderation_status", "approved");
  if (onlyAnswered) q = q.eq("is_answered", true);
  q = q.order("created_at", { ascending: false });
  if (offset > 0) q = q.range(offset, offset + limitCount - 1);
  else q = q.limit(limitCount);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(mapQuestionRow);
}

export async function getProductQuestionCount(productId: string, onlyApproved = true): Promise<number> {
  const db = getAdminDb();
  let q = db.from("product_questions").select("id", { count: "exact", head: true }).eq("product_id", productId);
  if (onlyApproved) q = q.eq("is_approved", true).eq("moderation_status", "approved");
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

export async function getAllProductQuestions(limitCount = 500): Promise<ProductQuestion[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("product_questions").select("*").order("created_at", { ascending: false }).limit(limitCount);
  if (error) throw error;
  return (data || []).map(mapQuestionRow);
}

export async function createProductQuestion(data: Omit<ProductQuestion, "id" | "createdAt" | "updatedAt" | "helpfulCount" | "isAnswered" | "isApproved" | "moderationStatus" | "answer" | "answerAuthor" | "answeredAt">): Promise<string> {
  const db = getAdminDb();
  const { data: result, error } = await db.from("product_questions").insert({
    product_id: data.productId,
    user_id: data.userId,
    user_name: data.userName,
    user_avatar: data.userAvatar || null,
    question: data.question,
    is_answered: false,
    helpful_count: 0,
    is_approved: false,
    moderation_status: "pending",
  }).select("id").single();
  if (error) throw error;
  revalidateTag("questions", { expire: 0 });
  return result.id;
}

export async function answerProductQuestion(questionId: string, answer: string, answerAuthor: "seller" | "admin" | "user", authorName: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("product_questions").update({
    answer,
    answer_author: answerAuthor,
    is_answered: true,
    answered_at: new Date().toISOString(),
  }).eq("id", questionId);
  if (error) throw error;
  revalidateTag("questions", { expire: 0 });
}

export async function updateProductQuestion(questionId: string, data: Partial<ProductQuestion>): Promise<void> {
  const db = getAdminDb();
  const payload: Record<string, any> = {};
  if (data.isApproved !== undefined) payload.is_approved = data.isApproved;
  if (data.moderationStatus) payload.moderation_status = data.moderationStatus;
  if (data.moderationNote !== undefined) payload.moderation_note = data.moderationNote;
  const { error } = await db.from("product_questions").update(payload).eq("id", questionId);
  if (error) throw error;
  revalidateTag("products", { expire: 0 });
}

export async function incrementQuestionHelpful(questionId: string): Promise<number> {
  const db = getAdminDb();
  const { data: q } = await db.from("product_questions").select("helpful_count").eq("id", questionId).single();
  const current = Number(q?.helpful_count || 0);
  await db.from("product_questions").update({ helpful_count: current + 1 }).eq("id", questionId);
  return current + 1;
}

// ─── Product Ratings ───────────────────────────────────────

export async function getProductRating(productId: string): Promise<ProductRating | null> {
  const db = getAdminDb();
  const { data, error } = await db.from("product_ratings").select("*").eq("product_id", productId).maybeSingle();
  if (error || !data) return null;
  return mapRatingRow(data);
}

export async function updateProductRating(productId: string): Promise<void> {
  // В Supabase это делает триггер fn_update_product_rating автоматически
  // Но оставим функцию для совместимости — вызываем пересчёт через SQL
  const db = getAdminDb();
  const { data: reviews } = await db.from("product_reviews")
    .select("rating")
    .eq("product_id", productId)
    .eq("is_approved", true)
    .eq("moderation_status", "approved");

  if (!reviews || reviews.length === 0) {
    await db.from("product_ratings").upsert({
      product_id: productId,
      average_rating: 0,
      total_reviews: 0,
      rating_distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    });
    await db.from("products").update({ average_rating: 0, total_reviews: 0 }).eq("id", productId);
    return;
  }

  const totalReviews = reviews.length;
  const sumRating = reviews.reduce((s: number, r: any) => s + Number(r.rating || 0), 0);
  const averageRating = Math.round((sumRating / totalReviews) * 10) / 10;
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach((r: any) => {
    const rating = Number(r.rating || 0);
    if (rating >= 1 && rating <= 5) distribution[rating as keyof typeof distribution]++;
  });

  await db.from("product_ratings").upsert({
    product_id: productId,
    average_rating: averageRating,
    total_reviews: totalReviews,
    rating_distribution: distribution,
  });
  await db.from("products").update({ average_rating: averageRating, total_reviews: totalReviews }).eq("id", productId);
}

// ─── Product Views ─────────────────────────────────────────

export async function recordProductView(productId: string, view: { userId?: string | null; sessionId: string; ipHash?: string | null; userAgent?: string | null; referrer?: string | null }): Promise<{ viewCount: number }> {
  const db = getAdminDb();
  const { error } = await db.from("product_views").insert({
    product_id: productId,
    user_id: view.userId || null,
    session_id: view.sessionId,
    ip_hash: view.ipHash || null,
    user_agent: view.userAgent || null,
    referrer: view.referrer || null,
  });
  if (error) console.error("recordProductView error:", error.message);
  // view_count обновляется триггером
  const { data: product } = await db.from("products").select("view_count").eq("id", productId).single();
  return { viewCount: Number(product?.view_count || 0) };
}

export async function getProductViewCount(productId: string): Promise<number> {
  const db = getAdminDb();
  const { data } = await db.from("products").select("view_count").eq("id", productId).single();
  return Number(data?.view_count || 0);
}

// ─── Wastepaper Requests ───────────────────────────────────

export async function getWastepaperRequests(opts: { limit?: number; status?: string } = {}): Promise<any[]> {
  const db = getAdminDb();
  let q = db.from("wastepaper_requests").select("*").order("created_at", { ascending: false });
  q = applyOrderStatusFilter(q, opts.status);
  const { data, error } = await q.limit(opts.limit || 200);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    type: "wastepaper",
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    wastepaperType: row.wastepaper_type,
    weight: Number(row.weight || 0),
    deliveryMethod: row.delivery_method,
    estimatedPayout: Number(row.estimated_payout || 0),
    comment: row.comment || "",
    status: row.status,
    createdAt: toIso(row.created_at),
  }));
}

export async function updateWastepaperRequestStatus(id: string, status: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("wastepaper_requests").update({ status }).eq("id", id);
  if (error) throw error;
  revalidateTag("wastepaper", { expire: 0 });
}

export async function deleteWastepaperRequest(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("wastepaper_requests").delete().eq("id", id);
  if (error) throw error;
  revalidateTag("wastepaper", { expire: 0 });
}

// ─── User Purchase Check ───────────────────────────────────

export async function hasUserPurchasedProduct(userId: string, productId: string): Promise<boolean> {
  const db = getAdminDb();
  const { data } = await db.from("orders")
    .select("items")
    .eq("user_id", userId)
    .in("status", ["completed", "in_progress", "ready"])
    .eq("type", "order")
    .limit(100);
  if (!data) return false;
  for (const order of data) {
    if (order.items && Array.isArray(order.items)) {
      if (order.items.some((item: any) => item.productId === productId)) return true;
    }
  }
  return false;
}

export async function getUserOrderWithProduct(userId: string, productId: string): Promise<any | null> {
  const db = getAdminDb();
  const { data } = await db.from("orders")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["completed", "in_progress", "ready"])
    .eq("type", "order")
    .limit(100);
  if (!data) return null;
  for (const row of data) {
    if (row.items && Array.isArray(row.items)) {
      if (row.items.some((item: any) => item.productId === productId)) {
        return {
          id: row.id,
          type: row.type,
          status: row.status,
          items: row.items,
          totalSum: row.total_sum,
        };
      }
    }
  }
  return null;
}

// ─── Review Stats ──────────────────────────────────────────

export async function getProductReviewStats(productId: string) {
  const reviews = (await getCachedProductReviews(productId)).filter(
    (r) => r.isApproved === true && r.moderationStatus === "approved"
  );
  const totalReviews = reviews.length;
  if (totalReviews === 0) {
    return { averageRating: 0, totalReviews: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }, withPhotos: 0, withProsCons: 0 };
  }
  const sumRating = reviews.reduce((s, r) => s + (r.rating || 0), 0);
  const averageRating = Math.round((sumRating / totalReviews) * 10) / 10;
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let withPhotos = 0;
  let withProsCons = 0;
  reviews.forEach((r) => {
    const rating = r.rating || 0;
    if (rating >= 1 && rating <= 5) distribution[rating as keyof typeof distribution]++;
    if (r.images && r.images.length > 0) withPhotos++;
    if ((r.pros && r.pros.trim()) || (r.cons && r.cons.trim())) withProsCons++;
  });
  return { averageRating, totalReviews, distribution, withPhotos, withProsCons };
}

async function fetchAllProductReviews(limitCount: number): Promise<ProductReview[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("product_reviews").select("*").order("created_at", { ascending: false }).limit(limitCount);
  if (error) throw error;
  return (data || []).map(mapReviewRow);
}

export async function getAllProductReviews(limitCount = 500): Promise<ProductReview[]> {
  return unstable_cache(
    async () => fetchAllProductReviews(limitCount),
    ["all-product-reviews", String(limitCount)],
    { revalidate: DATA_REVALIDATE, tags: ["reviews"] }
  )();
}

export async function getGlobalReviewStats() {
  const db = getAdminDb();
  const { data } = await db.from("product_reviews").select("rating, images, pros, cons, moderation_status");
  const reviews = data || [];
  const totalReviews = reviews.length;
  let withPhotos = 0, withProsCons = 0, sumRating = 0, pendingCount = 0, approvedCount = 0;
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach((r: any) => {
    const rating = Number(r.rating || 0);
    sumRating += rating;
    if (rating >= 1 && rating <= 5) distribution[rating as keyof typeof distribution]++;
    if (r.images && Array.isArray(r.images) && r.images.length > 0) withPhotos++;
    if ((r.pros && String(r.pros).trim()) || (r.cons && String(r.cons).trim())) withProsCons++;
    if (r.moderation_status === "pending") pendingCount++;
    if (r.moderation_status === "approved") approvedCount++;
  });
  return {
    averageRating: totalReviews > 0 ? Math.round((sumRating / totalReviews) * 10) / 10 : 0,
    totalReviews, distribution, withPhotos, withProsCons, pendingCount, approvedCount,
  };
}

// ─── Category helpers ──────────────────────────────────────

export async function createCategory(data: Record<string, any>): Promise<{ id: string; slug: string }> {
  const db = getAdminDb();
  const slug = data.slug || slugify(data.name || "category");
  const { data: result, error } = await db.from("categories").insert({
    name: data.name || "",
    slug,
    icon: data.icon || null,
    description: data.description || null,
    sort_order: data.sortOrder || 0,
    is_visible: data.isVisible ?? true,
    image_url: data.imageUrl || null,
  }).select("id, slug").single();
  if (error) throw error;
  revalidateTag("categories", { expire: 0 });
  return { id: result.id, slug: result.slug || slug };
}

/**
 * Удаляет категорию. Товары, привязанные к ней, не удаляются — у них
 * сбрасывается category_id в NULL (они становятся «Без категории»).
 * В БД связи категория↔товар логическая (без FK), поэтому чистим
 * ссылки руками перед удалением самой категории.
 */
export async function deleteCategory(id: string): Promise<void> {
  const db = getAdminDb();
  const { error: unlinkError } = await db
    .from("products")
    .update({ category_id: null })
    .eq("category_id", id);
  if (unlinkError) throw unlinkError;

  const { error } = await db.from("categories").delete().eq("id", id);
  if (error) throw error;

  invalidateProductsCache();
  revalidateTag("categories", { expire: 0 });
  revalidateTag("products", { expire: 0 });
}

// ─── Client Requests: ручные заявки клиентов (CRM) ─────────
// Не связаны с заказами сайта: фиксируют обращение клиента
// (звонок/мессенджер/визит), что нужно и ход работы.

export interface ClientRequest {
  id: string;
  customerName: string;
  customerPhone: string;
  contactMethod: string;
  subject: string;
  comment: string;
  status: string;
  closeReason: string | null;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

function mapClientRequest(row: any): ClientRequest {
  return {
    id: row.id,
    customerName: row.customer_name || "",
    customerPhone: row.customer_phone || "",
    contactMethod: row.contact_method || "call",
    subject: row.subject || "",
    comment: row.comment || "",
    status: row.status || "new",
    closeReason: row.close_reason ?? null,
    createdBy: row.created_by || "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getClientRequests(
  opts: { limit?: number; status?: string } = {}
): Promise<ClientRequest[]> {
  const db = getAdminDb();
  let q = db
    .from("client_requests")
    .select("*")
    .order("created_at", { ascending: false });
  q = applyOrderStatusFilter(q, opts.status);
  const { data, error } = await q.limit(opts.limit || 500);
  if (error) throw error;
  return (data || []).map(mapClientRequest);
}

export async function createClientRequest(data: {
  customerName: string;
  customerPhone?: string;
  contactMethod?: string;
  subject: string;
  comment?: string;
  createdBy?: string;
}): Promise<{ id: string }> {
  const db = getAdminDb();
  const { data: result, error } = await db
    .from("client_requests")
    .insert({
      customer_name: data.customerName,
      customer_phone: data.customerPhone || "",
      contact_method: data.contactMethod || "call",
      subject: data.subject,
      comment: data.comment || null,
      status: "new",
      created_by: data.createdBy || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: result.id };
}

export async function updateClientRequest(
  id: string,
  patch: {
    customerName?: string;
    customerPhone?: string;
    contactMethod?: string;
    subject?: string;
    comment?: string;
    status?: string;
    closeReason?: string | null;
  }
): Promise<void> {
  const db = getAdminDb();
  const row: Record<string, any> = {};
  if (patch.customerName !== undefined) row.customer_name = patch.customerName;
  if (patch.customerPhone !== undefined) row.customer_phone = patch.customerPhone;
  if (patch.contactMethod !== undefined) row.contact_method = patch.contactMethod;
  if (patch.subject !== undefined) row.subject = patch.subject;
  if (patch.comment !== undefined) row.comment = patch.comment || null;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.closeReason !== undefined) row.close_reason = patch.closeReason || null;
  if (Object.keys(row).length === 0) return;
  const { error } = await db.from("client_requests").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteClientRequest(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("client_requests").delete().eq("id", id);
  if (error) throw error;
}
