// =========================================================
// FILE: src/lib/supabase-queries.ts
// Полная замена firestore-queries.ts — все запросы к Supabase (PostgreSQL).
// =========================================================

import { unstable_cache } from "next/cache";
import { getAdminDb } from "./supabase";
import {
  extractQueryDims,
  dimensionScore,
} from "./dimension-search";
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
} from "./types";

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

function mapProductRow(row: any): FirestoreProduct {
  return {
    id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    categoryId: row.category_id || null,
    sku: row.sku || null,
    description: row.description || null,
    price: row.price != null ? Number(row.price) : null,
    priceWholesale: row.price_wholesale != null ? Number(row.price_wholesale) : null,
    minWholesaleQty: row.min_wholesale_qty != null ? Number(row.min_wholesale_qty) : null,
    dimensionLength: row.dimension_length != null ? Number(row.dimension_length) : null,
    dimensionWidth: row.dimension_width != null ? Number(row.dimension_width) : null,
    dimensionHeight: row.dimension_height != null ? Number(row.dimension_height) : null,
    dimensionUnit: row.dimension_unit || "мм",
    weight: row.weight != null ? Number(row.weight) : null,
    material: row.material || null,
    packQty: row.pack_qty != null ? Number(row.pack_qty) : null,
    volume: row.volume != null ? Number(row.volume) : null,
    note: row.note || null,
    inStock: row.in_stock ?? true,
    stockQty: row.stock_qty != null ? Number(row.stock_qty) : null,
    stockWarnQty: row.stock_warn_qty != null ? Number(row.stock_warn_qty) : null,
    isPromo: row.is_promo ?? false,
    promoLabel: row.promo_label || null,
    madeToOrder: row.made_to_order ?? false,
    discountType: row.discount_type || null,
    discountValue: row.discount_value != null ? Number(row.discount_value) : null,
    discountBadge: row.discount_badge || null,
    isVisible: row.is_visible ?? true,
    isFeatured: row.is_featured ?? false,
    imageUrl: row.image_url || null,
    images: Array.isArray(row.images) ? row.images : [],
    viewCount: Number(row.view_count || 0),
    averageRating: Number(row.average_rating || 0),
    totalReviews: Number(row.total_reviews || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

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
  if (error) throw error;
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

const getCachedProducts = unstable_cache(
  fetchAllProducts,
  ["base-products"],
  { revalidate: DATA_REVALIDATE, tags: ["products"] }
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

// ─── Products ──────────────────────────────────────────────

function getProductDims(p: FirestoreProduct): number[] {
  const dims: number[] = [];
  for (const v of [p.dimensionLength, p.dimensionWidth, p.dimensionHeight]) {
    if (v != null && v > 0) dims.push(v);
  }
  return dims;
}

export async function getProducts(opts: {
  categoryId?: string;
  search?: string;
  sortBy?: string;
  limitCount?: number;
  promoOnly?: boolean;
  featuredOnly?: boolean;
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
      products.sort((a, b) => {
        if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
        return 0;
      });
  }

  if (opts.limitCount) products = products.slice(0, opts.limitCount);
  return products;
}

export async function getProductById(id: string): Promise<FirestoreProduct | null> {
  const products = await getCachedProducts();
  return products.find((p) => p.id === id) || null;
}

export async function getProductBySlug(slug: string): Promise<FirestoreProduct | null> {
  const products = await getCachedProducts();
  return products.find((p) => p.slug === slug) || null;
}

export async function createProduct(data: Record<string, any>): Promise<{ id: string }> {
  const db = getAdminDb();
  const slug = data.slug || slugify(data.name || "product");
  const payload = {
    name: data.name || "",
    slug,
    category_id: data.categoryId || null,
    sku: data.sku || null,
    description: data.description || null,
    price: data.price ?? null,
    price_wholesale: data.priceWholesale ?? null,
    min_wholesale_qty: data.minWholesaleQty ?? null,
    dimension_length: data.dimensionLength ?? null,
    dimension_width: data.dimensionWidth ?? null,
    dimension_height: data.dimensionHeight ?? null,
    dimension_unit: data.dimensionUnit || "мм",
    weight: data.weight ?? null,
    material: data.material || null,
    pack_qty: data.packQty ?? null,
    volume: data.volume ?? null,
    note: data.note || null,
    in_stock: data.inStock ?? true,
    stock_qty: data.stockQty ?? null,
    stock_warn_qty: data.stockWarnQty ?? null,
    is_promo: data.isPromo ?? false,
    promo_label: data.promoLabel || null,
    made_to_order: data.madeToOrder ?? false,
    discount_type: data.discountType || null,
    discount_value: data.discountValue ?? null,
    discount_badge: data.discountBadge || null,
    is_visible: data.isVisible ?? true,
    is_featured: data.isFeatured ?? false,
    image_url: data.imageUrl || null,
    images: data.images || [],
  };
  const { data: result, error } = await db.from("products").insert(payload).select("id").single();
  if (error) throw error;
  return { id: result.id };
}

export async function updateProduct(id: string, data: Record<string, any>): Promise<void> {
  const db = getAdminDb();
  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  const fieldMap: Record<string, string> = {
    name: "name", slug: "slug", categoryId: "category_id", sku: "sku",
    description: "description", price: "price", priceWholesale: "price_wholesale",
    minWholesaleQty: "min_wholesale_qty", dimensionLength: "dimension_length",
    dimensionWidth: "dimension_width", dimensionHeight: "dimension_height",
    dimensionUnit: "dimension_unit", weight: "weight", material: "material",
    packQty: "pack_qty", volume: "volume", note: "note", inStock: "in_stock",
    stockQty: "stock_qty", stockWarnQty: "stock_warn_qty", isPromo: "is_promo",
    promoLabel: "promo_label", madeToOrder: "made_to_order",
    discountType: "discount_type", discountValue: "discount_value",
    discountBadge: "discount_badge", isVisible: "is_visible",
    isFeatured: "is_featured", imageUrl: "image_url", images: "images",
  };
  for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
    if (data[jsKey] !== undefined) payload[dbKey] = data[jsKey];
  }
  const { error } = await db.from("products").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteProduct(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("products").delete().eq("id", id);
  if (error) throw error;
}

// ─── Orders ────────────────────────────────────────────────

export async function getOrders(opts: { limit?: number; status?: string } = {}): Promise<FirestoreOrder[]> {
  const db = getAdminDb();
  let q = db.from("orders").select("*").order("created_at", { ascending: false });
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q.limit(opts.limit || 500);
  if (error) throw error;
  return (data || []).map((row: any) => ({
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
    dealId: row.deal_id || null,
    dealNumber: row.deal_number != null ? Number(row.deal_number) : null,
    paymentId: row.payment_id || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));
}

export async function createOrder(data: Record<string, any>): Promise<{ id: string }> {
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
  };
  const { data: result, error } = await db.from("orders").insert(payload).select("id").single();
  if (error) throw error;
  return { id: result.id };
}

export async function updateOrderStatus(id: string, status: string, closeReason: string | null = null): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("orders").update({
    status,
    close_reason: closeReason,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

export async function deleteOrder(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("orders").delete().eq("id", id);
  if (error) throw error;
}

export async function getOrderById(id: string): Promise<FirestoreOrder | null> {
  const db = getAdminDb();
  const { data, error } = await db.from("orders").select("*").eq("id", id).single();
  if (error || !data) return null;
  return {
    id: data.id,
    type: data.type,
    customerType: data.customer_type,
    customerName: data.customer_name,
    customerPhone: data.customer_phone,
    customerPhoneDigits: data.customer_phone_digits || null,
    userId: data.user_id || null,
    customerEmail: data.customer_email || null,
    communicationChannel: data.communication_channel,
    paymentMethod: data.payment_method || null,
    items: data.items || null,
    totalSum: data.total_sum != null ? Number(data.total_sum) : null,
    productInfo: data.product_info || null,
    quantity: data.quantity != null ? Number(data.quantity) : null,
    comment: data.comment || null,
    channel: data.channel || null,
    status: data.status,
    closeReason: data.close_reason || null,
    dealId: data.deal_id || null,
    dealNumber: data.deal_number != null ? Number(data.deal_number) : null,
    paymentId: data.payment_id || null,
    createdAt: toIso(data.created_at),
    updatedAt: toIso(data.updated_at),
  };
}

// ─── Settings ──────────────────────────────────────────────

async function fetchSettings(): Promise<Record<string, string>> {
  const db = getAdminDb();
  const { data, error } = await db.from("settings").select("key, value");
  if (error) throw error;
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

export async function updateSettings(data: Record<string, string>): Promise<void> {
  const db = getAdminDb();
  for (const [key, value] of Object.entries(data)) {
    const { error } = await db.from("settings").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
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
  if (error) throw error;
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

// ─── Popup Campaigns ───────────────────────────────────────

async function fetchAllPopupCampaigns(): Promise<PopupCampaign[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("popup_campaigns").select("*").order("sort_order", { ascending: true });
  if (error) throw error;
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
  opts: { limitCount?: number; sortBy?: string; onlyApproved?: boolean } = {}
): Promise<ProductReview[]> {
  const { limitCount = 20, onlyApproved = true } = opts;
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
  return reviews.slice(0, limitCount);
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
}

export async function deleteProductReview(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("product_reviews").delete().eq("id", id);
  if (error) throw error;
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
}

export async function updateProductQuestion(questionId: string, data: Partial<ProductQuestion>): Promise<void> {
  const db = getAdminDb();
  const payload: Record<string, any> = {};
  if (data.isApproved !== undefined) payload.is_approved = data.isApproved;
  if (data.moderationStatus) payload.moderation_status = data.moderationStatus;
  if (data.moderationNote !== undefined) payload.moderation_note = data.moderationNote;
  const { error } = await db.from("product_questions").update(payload).eq("id", questionId);
  if (error) throw error;
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

export async function getWastepaperRequests(limit = 200): Promise<any[]> {
  const db = getAdminDb();
  const { data, error } = await db.from("wastepaper_requests").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
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
}

export async function deleteWastepaperRequest(id: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.from("wastepaper_requests").delete().eq("id", id);
  if (error) throw error;
}

// ─── User Purchase Check ───────────────────────────────────

export async function hasUserPurchasedProduct(userId: string, productId: string): Promise<boolean> {
  const db = getAdminDb();
  const { data } = await db.from("orders")
    .select("items")
    .eq("user_id", userId)
    .in("status", ["completed", "in_progress"])
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
    .in("status", ["completed", "in_progress"])
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

export async function createCategory(data: Record<string, any>): Promise<{ id: string }> {
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
  }).select("id").single();
  if (error) throw error;
  return { id: result.id };
}
