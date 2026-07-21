// =========================================================
// FILE: src/lib/firestore-queries.ts
// =========================================================

import { FieldValue, type Query } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";
import { getAdminDb } from "./firebase-admin";
import {
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

function slugify(text: string): string {
  const map: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "yo",
    ж: "zh",
    з: "z",
    и: "i",
    й: "j",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "kh",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
  };
  return text
    .toLowerCase()
    .replace(/[а-яё]/gi, (c) => map[c.toLowerCase()] || c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function serializeTimestamp(ts: any): string | null {
  if (!ts) return null;
  if (typeof ts.toDate === "function") {
    return ts.toDate().toISOString();
  }
  if (ts._seconds !== undefined) {
    return new Date(ts._seconds * 1000).toISOString();
  }
  if (ts.seconds !== undefined) {
    return new Date(ts.seconds * 1000).toISOString();
  }
  if (typeof ts === "string") {
    return ts;
  }
  return null;
}

function mapProduct(id: string, data: FirebaseFirestore.DocumentData): FirestoreProduct {
  return {
    id,
    name: data.name || "",
    slug: data.slug || "",
    categoryId: data.categoryId || null,
    sku: data.sku || null,
    description: data.description || null,
    price:
      data.price !== undefined && data.price !== null ? Number(data.price) : null,
    priceWholesale:
      data.priceWholesale !== undefined && data.priceWholesale !== null
        ? Number(data.priceWholesale)
        : null,
    minWholesaleQty:
      data.minWholesaleQty !== undefined && data.minWholesaleQty !== null
        ? Number(data.minWholesaleQty)
        : null,
    dimensionLength:
      data.dimensionLength !== undefined && data.dimensionLength !== null
        ? Number(data.dimensionLength)
        : null,
    dimensionWidth:
      data.dimensionWidth !== undefined && data.dimensionWidth !== null
        ? Number(data.dimensionWidth)
        : null,
    dimensionHeight:
      data.dimensionHeight !== undefined && data.dimensionHeight !== null
        ? Number(data.dimensionHeight)
        : null,
    dimensionUnit: data.dimensionUnit || "мм",
    weight:
      data.weight !== undefined && data.weight !== null
        ? Number(data.weight)
        : null,
    material: data.material || null,
    packQty:
      data.packQty !== undefined && data.packQty !== null
        ? Number(data.packQty)
        : null,
    volume:
      data.volume !== undefined && data.volume !== null
        ? Number(data.volume)
        : null,
    note: data.note || null,
    inStock: data.inStock ?? true,
    stockQty:
      data.stockQty !== undefined && data.stockQty !== null
        ? Number(data.stockQty)
        : null,
    isPromo: data.isPromo ?? false,
    promoLabel: data.promoLabel || null,
    madeToOrder: data.madeToOrder ?? false,
    discountType: data.discountType || null,
    discountValue:
      data.discountValue !== undefined && data.discountValue !== null
        ? Number(data.discountValue)
        : null,
    discountBadge: data.discountBadge || null,
    isVisible: data.isVisible ?? true,
    isFeatured: data.isFeatured ?? false,
    imageUrl: data.imageUrl || null,
    images: data.images || [],
    viewCount: data.viewCount || 0,
    averageRating: data.averageRating || 0,
    totalReviews: data.totalReviews || 0,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function mapReview(id: string, data: FirebaseFirestore.DocumentData): ProductReview {
  return {
    id,
    productId: data.productId || "",
    userId: data.userId || "",
    userName: data.userName || "",
    userAvatar: data.userAvatar || null,
    orderId: data.orderId || "",
    rating: data.rating || 0,
    title: data.title || null,
    text: data.text || "",
    pros: data.pros || null,
    cons: data.cons || null,
    images: data.images || [],
    isVerifiedPurchase: data.isVerifiedPurchase ?? false,
    helpfulCount: data.helpfulCount || 0,
    isApproved: data.isApproved ?? false,
    moderationStatus: data.moderationStatus || "pending",
    moderationNote: data.moderationNote || null,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function mapQuestion(id: string, data: FirebaseFirestore.DocumentData): ProductQuestion {
  return {
    id,
    productId: data.productId || "",
    userId: data.userId || "",
    userName: data.userName || "",
    userAvatar: data.userAvatar || null,
    question: data.question || "",
    answer: data.answer || null,
    answerAuthor: data.answerAuthor || null,
    answeredAt: serializeTimestamp(data.answeredAt),
    isAnswered: data.isAnswered ?? false,
    helpfulCount: data.helpfulCount || 0,
    isApproved: data.isApproved ?? false,
    moderationStatus: data.moderationStatus || "pending",
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function mapRating(data: FirebaseFirestore.DocumentData): ProductRating {
  return {
    productId: data.productId || "",
    averageRating: data.averageRating || 0,
    totalReviews: data.totalReviews || 0,
    ratingDistribution: data.ratingDistribution || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function mapView(data: FirebaseFirestore.DocumentData): ProductView {
  return {
    id: data.id || "",
    productId: data.productId || "",
    userId: data.userId || null,
    sessionId: data.sessionId || "",
    ipHash: data.ipHash || null,
    userAgent: data.userAgent || null,
    referrer: data.referrer || null,
    viewedAt: serializeTimestamp(data.viewedAt),
  };
}

// ─── Кэш горячих выборок (Data Cache Next.js) ─────────────
/* Страницы (ISR) и API читают данные из кэша — без похода в Firestore
   на каждый запрос. Актуальность: TTL 120с (вровень с ISR страниц)
   + точечный сброс revalidateTag(...) при изменениях в админке. */
const DATA_REVALIDATE = 120;

async function fetchAllCategories(): Promise<FirestoreCategory[]> {
  const db = getAdminDb();
  const snap = await db.collection("categories").orderBy("sortOrder", "asc").get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...(data as Omit<FirestoreCategory, "id">),
      createdAt: serializeTimestamp(data.createdAt),
    };
  });
}

const getCachedCategories = unstable_cache(
  fetchAllCategories,
  ["base-categories"],
  { revalidate: DATA_REVALIDATE, tags: ["categories"] }
);

async function fetchAllProducts(): Promise<FirestoreProduct[]> {
  const db = getAdminDb();
  const snap = await db.collection("products").get();
  return snap.docs.map((d) => mapProduct(d.id, d.data()));
}

const getCachedProducts = unstable_cache(
  fetchAllProducts,
  ["base-products"],
  { revalidate: DATA_REVALIDATE, tags: ["products"] }
);

async function fetchProductReviewsRaw(productId: string): Promise<ProductReview[]> {
  const db = getAdminDb();
  /* Одиночный фильтр без составного индекса (см. getProductReviews) */
  const snap = await db
    .collection("productReviews")
    .where("productId", "==", productId)
    .limit(500)
    .get();
  return snap.docs.map((d) => mapReview(d.id, d.data()));
}

/* Фабрика кэша с тегом на конкретный товар — сбрасываем точечно */
const getCachedProductReviews = (productId: string) =>
  unstable_cache(
    async () => fetchProductReviewsRaw(productId),
    ["product-reviews", productId],
    {
      revalidate: DATA_REVALIDATE,
      tags: ["reviews", `reviews:${productId}`],
    }
  )();

// ─── Categories ───────────────────────────────────────────

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

// ─── Products ─────────────────────────────────────────────

export async function getProducts(opts?: {
  categoryId?: string;
  search?: string;
  sortBy?: string;
  limitCount?: number;
  promoOnly?: boolean;
  featuredOnly?: boolean;
  includeHidden?: boolean;
}): Promise<FirestoreProduct[]> {
  /* База — общий кэш товаров (см. getCachedProducts), фильтры в памяти */
  let filteredResults = await getCachedProducts();

  if (!opts?.includeHidden) {
    filteredResults = filteredResults.filter((p) => p.isVisible !== false);
  }

  if (opts?.categoryId) {
    filteredResults = filteredResults.filter(
      (p) => p.categoryId === opts.categoryId
    );
  }
  if (opts?.promoOnly) {
    filteredResults = filteredResults.filter((p) => p.isPromo === true);
  }
  if (opts?.featuredOnly) {
    filteredResults = filteredResults.filter((p) => p.isFeatured === true);
  }

  if (opts?.search) {
    const s = opts.search.toLowerCase();
    filteredResults = filteredResults.filter(
      (p) =>
        p.name?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s)
    );
  }

  switch (opts?.sortBy) {
    case "price_asc":
      filteredResults.sort(
        (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)
      );
      break;
    case "price_desc":
      filteredResults.sort(
        (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity)
      );
      break;
    case "newest":
      filteredResults.sort((a, b) => {
        const getTime = (val: any): number => {
          if (!val) return 0;
          return new Date(val).getTime();
        };
        return getTime(b.createdAt) - getTime(a.createdAt);
      });
      break;
    default:
      filteredResults.sort(
        (a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0)
      );
  }

  if (opts?.limitCount) {
    filteredResults = filteredResults.slice(0, opts.limitCount);
  }

  return filteredResults;
}

export async function getProductBySlug(slug: string): Promise<FirestoreProduct | null> {
  const products = await getCachedProducts();
  return products.find((p) => p.slug === slug) || null;
}

export async function getProductById(id: string): Promise<FirestoreProduct | null> {
  if (!id || typeof id !== "string") return null;
  try {
    const products = await getCachedProducts();
    return products.find((p) => p.id === id) || null;
  } catch (error) {
    console.error("Error fetching product:", error);
    return null;
  }
}

export async function getProductCount(categoryId?: string): Promise<number> {
  let products = (await getCachedProducts()).filter(
    (p) => p.isVisible !== false
  );
  if (categoryId) {
    products = products.filter((p) => p.categoryId === categoryId);
  }
  return products.length;
}

export async function getRelatedProducts(
  categoryId: string,
  excludeId: string,
  limitCount = 4
): Promise<FirestoreProduct[]> {
  if (!categoryId) return [];
  const products = (await getCachedProducts()).filter(
    (p) => p.isVisible !== false && p.categoryId === categoryId
  );
  return products.filter((p) => p.id !== excludeId).slice(0, limitCount);
}

// ─── Promotions / Special Offers ──────────────────────────

async function fetchAllPromotions(): Promise<Promotion[]> {
  const db = getAdminDb();
  const snap = await db.collection("promotions").orderBy("sortOrder", "asc").get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...(data as Omit<Promotion, "id">),
      createdAt: serializeTimestamp(data.createdAt),
    };
  });
}

const getCachedPromotions = unstable_cache(
  fetchAllPromotions,
  ["base-promotions"],
  { revalidate: DATA_REVALIDATE, tags: ["promotions"] }
);

export async function getPromotions(): Promise<Promotion[]> {
  return (await getCachedPromotions()).filter((p) => p.isVisible !== false);
}

export async function getAllPromotions(): Promise<Promotion[]> {
  return getCachedPromotions();
}

// ─── Standalone popup campaigns ───────────────────────────

async function fetchAllPopupCampaigns(): Promise<PopupCampaign[]> {
  const db = getAdminDb();
  const snap = await db
    .collection("popupCampaigns")
    .orderBy("sortOrder", "asc")
    .get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: String(data.title || ""),
      kicker: data.kicker || null,
      description: data.description || null,
      details: data.details || null,
      imageUrl: data.imageUrl || null,
      buttonText: data.buttonText || null,
      buttonUrl: data.buttonUrl || null,
      style: ["info", "promo", "important"].includes(data.style)
        ? data.style
        : "info",
      isActive: data.isActive !== false,
      startAt: data.startAt || null,
      endAt: data.endAt || null,
      delaySeconds: Math.max(0, Number(data.delaySeconds) || 0),
      durationSeconds: Math.max(5, Number(data.durationSeconds) || 20),
      frequency: ["session", "day", "always"].includes(data.frequency)
        ? data.frequency
        : "session",
      sortOrder: Number(data.sortOrder) || 0,
      isProductType: !!data.isProductType,
      isStoryType: !!data.isStoryType,
      discountPercent: data.discountPercent || null,
      stockLevel: data.stockLevel || null,
      tags: data.tags || null,
      oldPrice: data.oldPrice || null,
      newPrice: data.newPrice || null,
      timerSeconds: data.timerSeconds || null,
      createdAt: serializeTimestamp(data.createdAt),
      updatedAt: serializeTimestamp(data.updatedAt),
    } as PopupCampaign;
  });
}

const getCachedPopupCampaigns = unstable_cache(
  fetchAllPopupCampaigns,
  ["base-popup-campaigns"],
  { revalidate: DATA_REVALIDATE, tags: ["popup-campaigns"] }
);

export async function getAllPopupCampaigns(): Promise<PopupCampaign[]> {
  return getCachedPopupCampaigns();
}

// ─── Orders ───────────────────────────────────────────────

export async function createOrder(
  data: Omit<FirestoreOrder, "id" | "status" | "createdAt" | "updatedAt"> & {
    customerPhoneDigits?: string | null;
    userId?: string | null;
  }
) {
  const db = getAdminDb();

  return db.runTransaction(async (transaction) => {
    const stockUpdates: {
      ref: FirebaseFirestore.DocumentReference;
      newStock: number;
    }[] = [];

    if (data.type === "order" && data.items && data.items.length > 0) {
      for (const item of data.items) {
        if (!item.productId) continue;
        const productRef = db.collection("products").doc(String(item.productId));
        const productSnap = await transaction.get(productRef);
        if (!productSnap.exists) continue;

        const productData = productSnap.data() || {};
        if (
          productData.stockQty !== undefined &&
          productData.stockQty !== null
        ) {
          const currentStock = Number(productData.stockQty ?? 0);
          const qty = Math.max(1, Number(item.quantity || 1));
          const newStock = Math.max(0, currentStock - qty);
          stockUpdates.push({ ref: productRef, newStock });
        }
      }
    }

    for (const update of stockUpdates) {
      transaction.update(update.ref, {
        stockQty: update.newStock,
        inStock: update.newStock > 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const newOrderRef = db.collection("orders").doc();
    const finalOrderData = {
      ...data,
      userId: data.userId ?? null,
      customerPhoneDigits: data.customerPhoneDigits ?? null,
      status: "new" as const,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(newOrderRef, finalOrderData);

    return {
      id: newOrderRef.id,
      ...data,
      userId: data.userId ?? null,
      customerPhoneDigits: data.customerPhoneDigits ?? null,
      status: "new" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function getOrders(opts?: {
  status?: string;
  limit?: number;
}): Promise<FirestoreOrder[]> {
  const db = getAdminDb();
  let q: Query = db.collection("orders").orderBy("createdAt", "desc");

  if (opts?.status && opts.status !== "all") {
    q = db
      .collection("orders")
      .where("status", "==", opts.status)
      .orderBy("createdAt", "desc");
  }

  if (opts?.limit) {
    q = q.limit(opts.limit);
  }

  const snap = await q.get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...(data as Omit<FirestoreOrder, "id">),
      createdAt: serializeTimestamp(data.createdAt),
      updatedAt: serializeTimestamp(data.updatedAt),
    };
  });
}

export async function updateOrderStatus(
  id: string,
  status: string,
  closeReason?: string | null
) {
  const db = getAdminDb();
  const payload: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (closeReason) {
    payload.closeReason = closeReason;
  } else if (closeReason === null) {
    payload.closeReason = null;
  }
  await db.collection("orders").doc(id).update(payload);
}

// ─── Categories / Products CRUD ───────────────────────────

export async function createCategory(data: {
  name: string;
  icon?: string;
  description?: string;
}) {
  const db = getAdminDb();
  const docRef = await db.collection("categories").add({
    name: data.name,
    slug: slugify(data.name),
    icon: data.icon || "box",
    description: data.description || null,
    sortOrder: 0,
    isVisible: true,
    imageUrl: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: docRef.id, slug: slugify(data.name) };
}

export async function createProduct(data: Record<string, unknown>) {
  const db = getAdminDb();
  const slug = slugify(String(data.name || "product")) + "-" + Date.now().toString(36);
  const docRef = await db.collection("products").add({
    ...data,
    slug,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: docRef.id, slug };
}

export async function updateProduct(id: string, data: Record<string, unknown>) {
  const db = getAdminDb();
  await db
    .collection("products")
    .doc(id)
    .update({
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    });
}

export async function deleteProduct(id: string) {
  const db = getAdminDb();
  await db.collection("products").doc(id).delete();
}

// ─── Settings ─────────────────────────────────────────────

async function fetchSettings() {
  const db = getAdminDb();
  const snap = await db.collection("settings").doc("main").get();
  return snap.exists ? snap.data() || {} : {};
}

export const getSettings = unstable_cache(fetchSettings, ["base-settings"], {
  revalidate: DATA_REVALIDATE,
  tags: ["settings"],
});

export async function updateSettings(data: Record<string, string>) {
  const db = getAdminDb();
  await db.collection("settings").doc("main").set(data, { merge: true });
}

export async function deleteOrder(id: string) {
  const db = getAdminDb();
  await db.collection("orders").doc(id).delete();
}

export async function deleteProductQuestion(questionId: string) {
  const db = getAdminDb();
  await db.collection("productQuestions").doc(questionId).delete();
}

export async function deleteProductReview(reviewId: string) {
  const db = getAdminDb();
  await db.collection("productReviews").doc(reviewId).delete();
}

// ─── Product Views ────────────────────────────────────────

/**
 * Записывает просмотр товара.
 * Уникальный зритель = +1 навсегда: ни обновление страницы, ни повторные
 * переходы не накручивают счётчик.
 *
 * Дедупликация — по детерминированному ID документа {productId}__{viewerKey}:
 * viewerKey = userId (для авторизованных) либо долгоживущий sessionId из
 * localStorage (для анонимов). Транзакция устраняет гонки (двойной клик,
 * React StrictMode, два запроса параллельно).
 */
export async function recordProductView(
  productId: string,
  options: {
    userId?: string | null;
    sessionId: string;
    ipHash?: string | null;
    userAgent?: string | null;
    referrer?: string | null;
  }
): Promise<{ isUnique: boolean; viewCount: number }> {
  const db = getAdminDb();
  const now = FieldValue.serverTimestamp();

  const viewerKey = options.userId
    ? `u_${options.userId}`
    : `s_${options.sessionId}`;
  const docId = `${productId}__${viewerKey}`
    .replace(/\//g, "_")
    .slice(0, 300);

  const viewRef = db.collection("productViews").doc(docId);
  const productRef = db.collection("products").doc(productId);

  let isUnique = false;

  await db.runTransaction(async (tx) => {
    const viewSnap = await tx.get(viewRef);
    if (!viewSnap.exists) {
      tx.set(viewRef, {
        productId,
        userId: options.userId ?? null,
        sessionId: options.sessionId,
        ipHash: options.ipHash ?? null,
        userAgent: options.userAgent ?? null,
        referrer: options.referrer ?? null,
        viewedAt: now,
      });
      // merge — у старых товаров поля viewCount может не быть
      tx.set(
        productRef,
        { viewCount: FieldValue.increment(1), updatedAt: now },
        { merge: true }
      );
      isUnique = true;
    }
  });

  const productSnap = await productRef.get();
  const viewCount = productSnap.data()?.viewCount || 0;

  return { isUnique, viewCount };
}

export async function getProductViewCount(productId: string): Promise<number> {
  const db = getAdminDb();
  const productSnap = await db.collection("products").doc(productId).get();
  return productSnap.data()?.viewCount || 0;
}

// ─── Product Reviews ──────────────────────────────────────

export async function getProductReviews(
  productId: string,
  options: {
    limitCount?: number;
    offset?: number;
    onlyApproved?: boolean;
    sortBy?: "newest" | "helpful" | "rating_high" | "rating_low";
  } = {}
): Promise<ProductReview[]> {
  const { limitCount = 10, offset = 0, onlyApproved = true, sortBy = "newest" } = options;

  /* Данные — из общего кэша отзывов товара (см. getCachedProductReviews);
     фильтрацию, сортировку и пагинацию выполняем в памяти:
     составные запросы Firestore требовали бы индекса и без него падали. */
  let reviews = await getCachedProductReviews(productId);

  if (onlyApproved) {
    reviews = reviews.filter(
      (r) => r.isApproved === true && r.moderationStatus === "approved"
    );
  }

  const createdMs = (r: ProductReview): number => {
    const v = r.createdAt;
    if (!v) return 0;
    if (typeof v === "string") return Date.parse(v) || 0;
    if (typeof v === "number") return v;
    if (v instanceof Date) return v.getTime();
    if (typeof v?.toDate === "function") return v.toDate().getTime();
    return 0;
  };

  switch (sortBy) {
    case "helpful":
      reviews.sort((a, b) => b.helpfulCount - a.helpfulCount || createdMs(b) - createdMs(a));
      break;
    case "rating_high":
      reviews.sort((a, b) => b.rating - a.rating || createdMs(b) - createdMs(a));
      break;
    case "rating_low":
      reviews.sort((a, b) => a.rating - b.rating || createdMs(b) - createdMs(a));
      break;
    default:
      reviews.sort((a, b) => createdMs(b) - createdMs(a));
  }

  return reviews.slice(offset, offset + limitCount);
}

export async function getProductReviewCount(productId: string, onlyApproved = true): Promise<number> {
  const reviews = await getCachedProductReviews(productId);
  if (!onlyApproved) return reviews.length;
  return reviews.filter(
    (r) => r.isApproved === true && r.moderationStatus === "approved"
  ).length;
}

export async function createProductReview(data: Omit<ProductReview, "id" | "createdAt" | "updatedAt" | "helpfulCount" | "isApproved" | "moderationStatus">): Promise<string> {
  const db = getAdminDb();
  const docRef = await db.collection("productReviews").add({
    ...data,
    helpfulCount: 0,
    isApproved: false,
    moderationStatus: "pending",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return docRef.id;
}

export async function updateProductReview(id: string, data: Partial<ProductReview>) {
  const db = getAdminDb();
  await db.collection("productReviews").doc(id).update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function incrementReviewHelpful(reviewId: string): Promise<number> {
  const db = getAdminDb();
  const reviewRef = db.collection("productReviews").doc(reviewId);
  await reviewRef.update({
    helpfulCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const snap = await reviewRef.get();
  return snap.data()?.helpfulCount || 0;
}

/**
 * Отметка «полезно» у отзыва — один голос от одного уникального
 * посетителя (uid авторизованного пользователя или ID анонимного
 * из localStorage). Дедупликация детерминированным документом
 * + транзакцией: повторный клик/гонка запросов не меняет счётчик.
 */
export async function markReviewHelpful(
  reviewId: string,
  voterKey: string
): Promise<{ helpfulCount: number; already: boolean }> {
  const db = getAdminDb();
  const safeVoter = voterKey.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
  if (!safeVoter) throw new Error("voterKey обязателен");

  const reviewRef = db.collection("productReviews").doc(reviewId);
  const voteRef = db
    .collection("reviewHelpfulVotes")
    .doc(`${reviewId}__${safeVoter}`.slice(0, 1400));

  return db.runTransaction(async (tx) => {
    const [voteSnap, reviewSnap] = await Promise.all([
      tx.get(voteRef),
      tx.get(reviewRef),
    ]);
    if (!reviewSnap.exists) throw new Error("Отзыв не найден");
    const current: number = reviewSnap.data()?.helpfulCount || 0;

    if (voteSnap.exists) {
      /* Этот посетитель уже голосовал — счётчик не трогаем */
      return { helpfulCount: current, already: true };
    }

    tx.set(voteRef, {
      reviewId,
      voterKey: safeVoter,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(reviewRef, {
      helpfulCount: current + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { helpfulCount: current + 1, already: false };
  });
}

// ─── Product Questions ────────────────────────────────────

export async function getProductQuestions(
  productId: string,
  options: {
    limitCount?: number;
    offset?: number;
    onlyApproved?: boolean;
    onlyAnswered?: boolean;
  } = {}
): Promise<ProductQuestion[]> {
  const db = getAdminDb();
  const { limitCount = 10, offset = 0, onlyApproved = true, onlyAnswered = false } = options;

  let q: Query = db
    .collection("productQuestions")
    .where("productId", "==", productId);

  if (onlyApproved) {
    q = q.where("isApproved", "==", true).where("moderationStatus", "==", "approved");
  }
  if (onlyAnswered) {
    q = q.where("isAnswered", "==", true);
  }

  q = q.orderBy("createdAt", "desc");

  if (offset > 0) {
    q = q.offset(offset);
  }
  q = q.limit(limitCount);

  const snap = await q.get();
  return snap.docs.map((d) => mapQuestion(d.id, d.data()));
}

export async function getProductQuestionCount(productId: string, onlyApproved = true): Promise<number> {
  const db = getAdminDb();
  let q: Query = db.collection("productQuestions").where("productId", "==", productId);
  if (onlyApproved) {
    q = q.where("isApproved", "==", true).where("moderationStatus", "==", "approved");
  }
  const snap = await q.get();
  return snap.size;
}

/**
 * Все вопросы по всем товарам (для админки), сортировка по дате убыванию.
 */
export async function getAllProductQuestions(
  limitCount = 500
): Promise<ProductQuestion[]> {
  const db = getAdminDb();
  const snap = await db
    .collection("productQuestions")
    .orderBy("createdAt", "desc")
    .limit(limitCount)
    .get();
  return snap.docs.map((d) => mapQuestion(d.id, d.data()));
}

export async function createProductQuestion(data: Omit<ProductQuestion, "id" | "createdAt" | "updatedAt" | "helpfulCount" | "isAnswered" | "isApproved" | "moderationStatus" | "answer" | "answerAuthor" | "answeredAt">): Promise<string> {
  const db = getAdminDb();
  const docRef = await db.collection("productQuestions").add({
    ...data,
    answer: null,
    answerAuthor: null,
    answeredAt: null,
    isAnswered: false,
    helpfulCount: 0,
    isApproved: false,
    moderationStatus: "pending",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return docRef.id;
}

export async function answerProductQuestion(
  questionId: string,
  answer: string,
  answerAuthor: "seller" | "admin" | "user",
  authorName: string
) {
  const db = getAdminDb();
  await db.collection("productQuestions").doc(questionId).update({
    answer,
    answerAuthor,
    isAnswered: true,
    answeredAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateProductQuestion(questionId: string, data: Partial<ProductQuestion>) {
  const db = getAdminDb();
  await db.collection("productQuestions").doc(questionId).update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function incrementQuestionHelpful(questionId: string): Promise<number> {
  const db = getAdminDb();
  const questionRef = db.collection("productQuestions").doc(questionId);
  await questionRef.update({
    helpfulCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const snap = await questionRef.get();
  return snap.data()?.helpfulCount || 0;
}

// ─── Product Ratings ──────────────────────────────────────

export async function getProductRating(productId: string): Promise<ProductRating | null> {
  const db = getAdminDb();
  const snap = await db.collection("productRatings").doc(productId).get();
  if (!snap.exists) return null;
  return mapRating(snap.data()!);
}

export async function updateProductRating(productId: string): Promise<void> {
  const db = getAdminDb();
  
  // Calculate rating from approved reviews
  const reviewsSnap = await db
    .collection("productReviews")
    .where("productId", "==", productId)
    .where("isApproved", "==", true)
    .where("moderationStatus", "==", "approved")
    .get();

  if (reviewsSnap.empty) {
    // No reviews - reset rating
    await db.collection("productRatings").doc(productId).set({
      productId,
      averageRating: 0,
      totalReviews: 0,
      ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const reviews = reviewsSnap.docs.map((d) => d.data());
  const totalReviews = reviews.length;
  const sumRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
  const averageRating = Math.round((sumRating / totalReviews) * 10) / 10; // 1 decimal place

  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach((r) => {
    const rating = r.rating || 0;
    if (rating >= 1 && rating <= 5) {
      distribution[rating as keyof typeof distribution]++;
    }
  });

  await db.collection("productRatings").doc(productId).set({
    productId,
    averageRating,
    totalReviews,
    ratingDistribution: distribution,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ─── User Product Purchase Check ──────────────────────────

export async function hasUserPurchasedProduct(userId: string, productId: string): Promise<boolean> {
  const db = getAdminDb();
  
  // Check completed orders with this product
  const ordersSnap = await db
    .collection("orders")
    .where("userId", "==", userId)
    .where("status", "in", ["completed", "in_progress"])
    .where("type", "==", "order")
    .limit(100)
    .get();

  for (const orderDoc of ordersSnap.docs) {
    const orderData = orderDoc.data();
    if (orderData.items && Array.isArray(orderData.items)) {
      const hasProduct = orderData.items.some((item: any) => item.productId === productId);
      if (hasProduct) return true;
    }
  }
  
  return false;
}

export async function getUserOrderWithProduct(userId: string, productId: string): Promise<any | null> {
  const db = getAdminDb();
  
  const ordersSnap = await db
    .collection("orders")
    .where("userId", "==", userId)
    .where("status", "in", ["completed", "in_progress"])
    .where("type", "==", "order")
    .limit(100)
    .get();

  for (const orderDoc of ordersSnap.docs) {
    const orderData = orderDoc.data();
    if (orderData.items && Array.isArray(orderData.items)) {
      const hasProduct = orderData.items.some((item: any) => item.productId === productId);
      if (hasProduct) {
        return { id: orderDoc.id, ...orderData };
      }
    }
  }
  
  return null;
}

export async function getProductReviewStats(productId: string) {
  /* Данные — из общего кэша отзывов товара, одобрение фильтруем в памяти
     (см. getCachedProductReviews) */
  const reviews = (await getCachedProductReviews(productId)).filter(
    (r) => r.isApproved === true && r.moderationStatus === "approved"
  );
  const totalReviews = reviews.length;
  
  if (totalReviews === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
      distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      withPhotos: 0,
      withProsCons: 0,
    };
  }

  const sumRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
  const averageRating = Math.round((sumRating / totalReviews) * 10) / 10;
  
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let withPhotos = 0;
  let withProsCons = 0;
  
  reviews.forEach((r) => {
    const rating = r.rating || 0;
    if (rating >= 1 && rating <= 5) {
      distribution[rating as keyof typeof distribution]++;
    }
    if (r.images && r.images.length > 0) withPhotos++;
    if ((r.pros && r.pros.trim()) || (r.cons && r.cons.trim())) withProsCons++;
  });

  return {
    averageRating,
    totalReviews,
    distribution,
    withPhotos,
    withProsCons,
  };
}

/**
 * Все отзывы по всем товарам (для админки), сортировка по дате убыванию.
 */
async function fetchAllProductReviews(limitCount: number): Promise<ProductReview[]> {
  const db = getAdminDb();
  const snap = await db
    .collection("productReviews")
    .orderBy("createdAt", "desc")
    .limit(limitCount)
    .get();
  return snap.docs.map((d) => mapReview(d.id, d.data()));
}

export async function getAllProductReviews(
  limitCount = 500
): Promise<ProductReview[]> {
  return unstable_cache(
    async () => fetchAllProductReviews(limitCount),
    ["all-product-reviews", String(limitCount)],
    { revalidate: DATA_REVALIDATE, tags: ["reviews"] }
  )();
}

/**
 * Сводная статистика по всем отзывам (для админки).
 * Считаем по коллекции целиком — объём отзывов небольшой.
 */
export async function getGlobalReviewStats() {
  const db = getAdminDb();
  const snap = await db.collection("productReviews").get();
  const reviews = snap.docs.map((d) => d.data());

  const totalReviews = reviews.length;
  let withPhotos = 0;
  let withProsCons = 0;
  let sumRating = 0;
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let pendingCount = 0;
  let approvedCount = 0;

  reviews.forEach((r) => {
    const rating = r.rating || 0;
    sumRating += rating;
    if (rating >= 1 && rating <= 5) {
      distribution[rating as keyof typeof distribution]++;
    }
    if (r.images && r.images.length > 0) withPhotos++;
    if ((r.pros && r.pros.trim()) || (r.cons && r.cons.trim())) withProsCons++;
    if (r.moderationStatus === "pending") pendingCount++;
    if (r.moderationStatus === "approved") approvedCount++;
  });

  return {
    averageRating:
      totalReviews > 0 ? Math.round((sumRating / totalReviews) * 10) / 10 : 0,
    totalReviews,
    distribution,
    withPhotos,
    withProsCons,
    pendingCount,
    approvedCount,
  };
}