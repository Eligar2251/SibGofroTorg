// =========================================================
// FILE: src/lib/firestore-queries.ts
// =========================================================

import { FieldValue, type Query } from "firebase-admin/firestore";
import { getAdminDb } from "./firebase-admin";
import { FirestoreCategory, FirestoreProduct, FirestoreOrder, Promotion } from "./types";

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
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

// ─── Categories ───────────────────────────────────────────

export async function getCategories(): Promise<FirestoreCategory[]> {
  const db = getAdminDb();
  const snap = await db.collection("categories").orderBy("sortOrder", "asc").get();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...(data as Omit<FirestoreCategory, "id">),
        createdAt: serializeTimestamp(data.createdAt),
      };
    })
    .filter((c) => c.isVisible !== false);
}

export async function getAllCategories(): Promise<FirestoreCategory[]> {
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

export async function getCategoryBySlug(
  slug: string
): Promise<FirestoreCategory | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("categories")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const data = snap.docs[0].data();
  return {
    id: snap.docs[0].id,
    ...(data as Omit<FirestoreCategory, "id">),
    createdAt: serializeTimestamp(data.createdAt),
  };
}

// ─── Products ─────────────────────────────────────────────

export async function getProducts(opts?: {
  categoryId?: string;
  search?: string;
  sortBy?: string;
  limitCount?: number;
  promoOnly?: boolean;
  featuredOnly?: boolean;
}): Promise<FirestoreProduct[]> {
  const db = getAdminDb();
  let q: Query = db.collection("products");

  if (opts?.categoryId) {
    q = q.where("categoryId", "==", opts.categoryId);
  }
  if (opts?.promoOnly) {
    q = q.where("isPromo", "==", true);
  }
  if (opts?.featuredOnly) {
    q = q.where("isFeatured", "==", true);
  }

  const snap = await q.get();
  let filteredResults = snap.docs
    .map((d) => mapProduct(d.id, d.data()))
    .filter((p) => p.isVisible !== false);

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

export async function getProductBySlug(
  slug: string
): Promise<FirestoreProduct | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("products")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return mapProduct(snap.docs[0].id, snap.docs[0].data());
}

export async function getProductById(
  id: string
): Promise<FirestoreProduct | null> {
  if (!id || typeof id !== "string") return null;
  try {
    const db = getAdminDb();
    const snap = await db.collection("products").doc(id).get();
    if (!snap.exists) return null;
    return mapProduct(snap.id, snap.data()!);
  } catch (error) {
    console.error("❌ Error fetching product:", error);
    return null;
  }
}

export async function getProductCount(categoryId?: string): Promise<number> {
  const db = getAdminDb();
  let q: Query = db.collection("products").where("isVisible", "==", true);
  if (categoryId) {
    q = q.where("categoryId", "==", categoryId);
  }
  const snap = await q.get();
  return snap.size;
}

export async function getRelatedProducts(
  categoryId: string,
  excludeId: string,
  limitCount = 4
): Promise<FirestoreProduct[]> {
  if (!categoryId) return [];
  const db = getAdminDb();
  const snap = await db
    .collection("products")
    .where("categoryId", "==", categoryId)
    .where("isVisible", "==", true)
    .limit(limitCount + 1)
    .get();

  return snap.docs
    .filter((d) => d.id !== excludeId)
    .slice(0, limitCount)
    .map((d) => mapProduct(d.id, d.data()));
}

// ─── Promotions / Special Offers ──────────────────────────

export async function getPromotions(): Promise<Promotion[]> {
  const db = getAdminDb();
  const snap = await db.collection("promotions").orderBy("sortOrder", "asc").get();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...(data as Omit<Promotion, "id">),
        createdAt: serializeTimestamp(data.createdAt),
      };
    })
    .filter((p) => p.isVisible !== false);
}

export async function getAllPromotions(): Promise<Promotion[]> {
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
}): Promise<FirestoreOrder[]> {
  const db = getAdminDb();
  let q: Query = db.collection("orders").orderBy("createdAt", "desc");

  if (opts?.status && opts.status !== "all") {
    q = db
      .collection("orders")
      .where("status", "==", opts.status)
      .orderBy("createdAt", "desc");
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
    icon: data.icon || "📦",
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

// =========================================================
// FILE: src/lib/firestore-queries.ts
// =========================================================

import { FieldValue, type Query } from "firebase-admin/firestore";
import { getAdminDb } from "./firebase-admin";
import { FirestoreCategory, FirestoreProduct, FirestoreOrder, Promotion, ProductReview, ProductQuestion, ProductRating, ProductView } from "./types";

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
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

// ─── Categories ───────────────────────────────────────────

export async function getCategories(): Promise<FirestoreCategory[]> {
  const db = getAdminDb();
  const snap = await db.collection("categories").orderBy("sortOrder", "asc").get();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...(data as Omit<FirestoreCategory, "id">),
        createdAt: serializeTimestamp(data.createdAt),
      };
    })
    .filter((c) => c.isVisible !== false);
}

export async function getAllCategories(): Promise<FirestoreCategory[]> {
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

export async function getCategoryBySlug(
  slug: string
): Promise<FirestoreCategory | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("categories")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const data = snap.docs[0].data();
  return {
    id: snap.docs[0].id,
    ...(data as Omit<FirestoreCategory, "id">),
    createdAt: serializeTimestamp(data.createdAt),
  };
}

// ─── Products ─────────────────────────────────────────────

export async function getProducts(opts?: {
  categoryId?: string;
  search?: string;
  sortBy?: string;
  limitCount?: number;
  promoOnly?: boolean;
  featuredOnly?: boolean;
}): Promise<FirestoreProduct[]> {
  const db = getAdminDb();
  let q: Query = db.collection("products");

  if (opts?.categoryId) {
    q = q.where("categoryId", "==", opts.categoryId);
  }
  if (opts?.promoOnly) {
    q = q.where("isPromo", "==", true);
  }
  if (opts?.featuredOnly) {
    q = q.where("isFeatured", "==", true);
  }

  const snap = await q.get();
  let filteredResults = snap.docs
    .map((d) => mapProduct(d.id, d.data()))
    .filter((p) => p.isVisible !== false);

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

export async function getProductBySlug(
  slug: string
): Promise<FirestoreProduct | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("products")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return mapProduct(snap.docs[0].id, snap.docs[0].data());
}

export async function getProductById(
  id: string
): Promise<FirestoreProduct | null> {
  if (!id || typeof id !== "string") return null;
  try {
    const db = getAdminDb();
    const snap = await db.collection("products").doc(id).get();
    if (!snap.exists) return null;
    return mapProduct(snap.id, snap.data()!);
  } catch (error) {
    console.error("❌ Error fetching product:", error);
    return null;
  }
}

export async function getProductCount(categoryId?: string): Promise<number> {
  const db = getAdminDb();
  let q: Query = db.collection("products").where("isVisible", "==", true);
  if (categoryId) {
    q = q.where("categoryId", "==", categoryId);
  }
  const snap = await q.get();
  return snap.size;
}

export async function getRelatedProducts(
  categoryId: string,
  excludeId: string,
  limitCount = 4
): Promise<FirestoreProduct[]> {
  if (!categoryId) return [];
  const db = getAdminDb();
  const snap = await db
    .collection("products")
    .where("categoryId", "==", categoryId)
    .where("isVisible", "==", true)
    .limit(limitCount + 1)
    .get();

  return snap.docs
    .filter((d) => d.id !== excludeId)
    .slice(0, limitCount)
    .map((d) => mapProduct(d.id, d.data()));
}

// ─── Promotions / Special Offers ──────────────────────────

export async function getPromotions(): Promise<Promotion[]> {
  const db = getAdminDb();
  const snap = await db.collection("promotions").orderBy("sortOrder", "asc").get();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...(data as Omit<Promotion, "id">),
        createdAt: serializeTimestamp(data.createdAt),
      };
    })
    .filter((p) => p.isVisible !== false);
}

export async function getAllPromotions(): Promise<Promotion[]> {
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
}): Promise<FirestoreOrder[]> {
  const db = getAdminDb();
  let q: Query = db.collection("orders").orderBy("createdAt", "desc");

  if (opts?.status && opts.status !== "all") {
    q = db
      .collection("orders")
      .where("status", "==", opts.status)
      .orderBy("createdAt", "desc");
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
    icon: data.icon || "📦",
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

export async function getSettings() {
  const db = getAdminDb();
  const snap = await db.collection("settings").doc("main").get();
  return snap.exists ? snap.data() || {} : {};
}

export async function updateSettings(data: Record<string, string>) {
  const db = getAdminDb();
  await db.collection("settings").doc("main").set(data, { merge: true });
}

export async function deleteOrder(id: string) {
  const db = getAdminDb();
  await db.collection("orders").doc(id).delete();
}

// =========================================================
// PRODUCT INTERACTIONS: Reviews, Questions, Views, Ratings
// =========================================================

// --- Product Views ---

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

  // Check if this session already viewed this product recently (within 30 min)
  const recentViewSnap = await db
    .collection("productViews")
    .where("productId", "==", productId)
    .where("sessionId", "==", options.sessionId)
    .where("viewedAt", ">", new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .limit(1)
    .get();

  const isUnique = recentViewSnap.empty;

  if (isUnique) {
    // Record the view
    const viewRef = db.collection("productViews").doc();
    await viewRef.set({
      productId,
      userId: options.userId ?? null,
      sessionId: options.sessionId,
      ipHash: options.ipHash ?? null,
      userAgent: options.userAgent ?? null,
      referrer: options.referrer ?? null,
      viewedAt: now,
    });

    // Increment product view count atomically
    const productRef = db.collection("products").doc(productId);
    await productRef.update({
      viewCount: FieldValue.increment(1),
      updatedAt: now,
    });
  }

  // Get current view count
  const productSnap = await db.collection("products").doc(productId).get();
  const viewCount = productSnap.data()?.viewCount || 0;

  return { isUnique, viewCount };
}

export async function getProductViewCount(productId: string): Promise<number> {
  const db = getAdminDb();
  const productSnap = await db.collection("products").doc(productId).get();
  return productSnap.data()?.viewCount || 0;
}

// --- Product Reviews ---

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
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
    isApproved: data.isApproved ?? false,
    moderationStatus: data.moderationStatus || "pending",
    moderationNote: data.moderationNote || null,
  };
}

export async function getProductReviews(
  productId: string,
  options: {
    limitCount?: number;
    offset?: number;
    onlyApproved?: boolean;
    sortBy?: "newest" | "helpful" | "rating_high" | "rating_low";
  } = {}
): Promise<ProductReview[]> {
  const db = getAdminDb();
  const { limitCount = 10, offset = 0, onlyApproved = true, sortBy = "newest" } = options;

  let q: Query = db
    .collection("productReviews")
    .where("productId", "==", productId);

  if (onlyApproved) {
    q = q.where("isApproved", "==", true).where("moderationStatus", "==", "approved");
  }

  switch (sortBy) {
    case "helpful":
      q = q.orderBy("helpfulCount", "desc").orderBy("createdAt", "desc");
      break;
    case "rating_high":
      q = q.orderBy("rating", "desc").orderBy("createdAt", "desc");
      break;
    case "rating_low":
      q = q.orderBy("rating", "asc").orderBy("createdAt", "desc");
      break;
    default:
      q = q.orderBy("createdAt", "desc");
  }

  if (offset > 0) {
    q = q.offset(offset);
  }
  q = q.limit(limitCount);

  const snap = await q.get();
  return snap.docs.map((d) => mapReview(d.id, d.data()));
}

export async function getProductReviewCount(productId: string, onlyApproved = true): Promise<number> {
  const db = getAdminDb();
  let q: Query = db.collection("productReviews").where("productId", "==", productId);
  if (onlyApproved) {
    q = q.where("isApproved", "==", true).where("moderationStatus", "==", "approved");
  }
  const snap = await q.get();
  return snap.size;
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

// --- Product Questions ---

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
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
    isApproved: data.isApproved ?? false,
    moderationStatus: data.moderationStatus || "pending",
  };
}

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

// --- Product Ratings ---

function mapRating(data: FirebaseFirestore.DocumentData): ProductRating {
  return {
    productId: data.productId || "",
    averageRating: data.averageRating || 0,
    totalReviews: data.totalReviews || 0,
    ratingDistribution: data.ratingDistribution || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

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
  const db = getAdminDb();
  
  const reviewsSnap = await db
    .collection("productReviews")
    .where("productId", "==", productId)
    .where("isApproved", "==", true)
    .where("moderationStatus", "==", "approved")
    .get();

  const reviews = reviewsSnap.docs.map(d => d.data());
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

// =========================================================
// PRODUCT INTERACTIONS: Reviews, Questions, Views, Ratings
// =========================================================

// --- Product Views ---

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

  // Check if this session already viewed this product recently (within 30 min)
  const recentViewSnap = await db
    .collection("productViews")
    .where("productId", "==", productId)
    .where("sessionId", "==", options.sessionId)
    .where("viewedAt", ">", new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .limit(1)
    .get();

  const isUnique = recentViewSnap.empty;

  if (isUnique) {
    // Record the view
    const viewRef = db.collection("productViews").doc();
    await viewRef.set({
      productId,
      userId: options.userId ?? null,
      sessionId: options.sessionId,
      ipHash: options.ipHash ?? null,
      userAgent: options.userAgent ?? null,
      referrer: options.referrer ?? null,
      viewedAt: now,
    });

    // Increment product view counter
    const productRef = db.collection("products").doc(productId);
    await productRef.update({
      viewCount: FieldValue.increment(1),
      updatedAt: now,
    });
  }

  // Get updated view count
  const productSnap = await db.collection("products").doc(productId).get();
  const viewCount = productSnap.data()?.viewCount || 0;

  return { isUnique, viewCount };
}

export async function getProductViewCount(productId: string): Promise<number> {
  const db = getAdminDb();
  const snap = await db.collection("products").doc(productId).get();
  return snap.data()?.viewCount || 0;
}

// --- Product Reviews ---

export async function getProductReviews(
  productId: string,
  opts?: {
    limitCount?: number;
    offset?: number;
    onlyApproved?: boolean;
    sortBy?: "newest" | "helpful" | "rating_high" | "rating_low";
  }
): Promise<ProductReview[]> {
  const db = getAdminDb();
  let q: Query = db
    .collection("productReviews")
    .where("productId", "==", productId);

  if (opts?.onlyApproved !== false) {
    q = q.where("isApproved", "==", true);
  }

  switch (opts?.sortBy) {
    case "helpful":
      q = q.orderBy("helpfulCount", "desc").orderBy("createdAt", "desc");
      break;
    case "rating_high":
      q = q.orderBy("rating", "desc").orderBy("createdAt", "desc");
      break;
    case "rating_low":
      q = q.orderBy("rating", "asc").orderBy("createdAt", "desc");
      break;
    default:
      q = q.orderBy("createdAt", "desc");
  }

  if (opts?.offset) {
    q = q.offset(opts.offset);
  }
  if (opts?.limitCount) {
    q = q.limit(opts.limitCount);
  }

  const snap = await q.get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...(data as Omit<ProductReview, "id">),
      createdAt: serializeTimestamp(data.createdAt),
      updatedAt: serializeTimestamp(data.updatedAt),
    };
  });
}

export async function getProductReviewStats(productId: string): Promise<{
  averageRating: number;
  totalReviews: number;
  ratingDistribution: { 5: number; 4: number; 3: number; 2: number; 1: number };
}> {
  const db = getAdminDb();
  const snap = await db
    .collection("productReviews")
    .where("productId", "==", productId)
    .where("isApproved", "==", true)
    .get();

  if (snap.empty) {
    return {
      averageRating: 0,
      totalReviews: 0,
      ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    };
  }

  const reviews = snap.docs.map((d) => d.data() as ProductReview);
  const totalReviews = reviews.length;
  const sumRatings = reviews.reduce((acc, r) => acc + r.rating, 0);
  const averageRating = totalReviews > 0 ? sumRatings / totalReviews : 0;

  const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach((r) => {
    if (r.rating >= 1 && r.rating <= 5) {
      ratingDistribution[r.rating as keyof typeof ratingDistribution]++;
    }
  });

  return { averageRating, totalReviews, ratingDistribution };
}

export async function createProductReview(
  data: Omit<ProductReview, "id" | "createdAt" | "updatedAt" | "helpfulCount" | "isApproved" | "moderationStatus">
): Promise<string> {
  const db = getAdminDb();
  const reviewRef = await db.collection("productReviews").add({
    ...data,
    helpfulCount: 0,
    isApproved: false, // Requires moderation
    moderationStatus: "pending",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Update product rating aggregate
  await updateProductRatingAggregate(data.productId);

  return reviewRef.id;
}

export async function updateProductReview(
  reviewId: string,
  data: Partial<ProductReview>
): Promise<void> {
  const db = getAdminDb();
  await db.collection("productReviews").doc(reviewId).update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // If approval status changed, update aggregate
  if (data.isApproved !== undefined || data.moderationStatus) {
    const reviewSnap = await db.collection("productReviews").doc(reviewId).get();
    if (reviewSnap.exists) {
      await updateProductRatingAggregate(reviewSnap.data()!.productId);
    }
  }
}

export async function deleteProductReview(reviewId: string): Promise<void> {
  const db = getAdminDb();
  const reviewSnap = await db.collection("productReviews").doc(reviewId).get();
  const productId = reviewSnap.data()?.productId;
  await db.collection("productReviews").doc(reviewId).delete();
  if (productId) {
    await updateProductRatingAggregate(productId);
  }
}

export async function incrementReviewHelpful(reviewId: string): Promise<void> {
  const db = getAdminDb();
  await db.collection("productReviews").doc(reviewId).update({
    helpfulCount: FieldValue.increment(1),
  });
}

async function updateProductRatingAggregate(productId: string): Promise<void> {
  const db = getAdminDb();
  const stats = await getProductReviewStats(productId);

  const ratingRef = db.collection("productRatings").doc(productId);
  await ratingRef.set({
    productId,
    averageRating: Math.round(stats.averageRating * 10) / 10,
    totalReviews: stats.totalReviews,
    ratingDistribution: stats.ratingDistribution,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Also update product document for quick access
  await db.collection("products").doc(productId).update({
    averageRating: Math.round(stats.averageRating * 10) / 10,
    totalReviews: stats.totalReviews,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function getProductRating(productId: string): Promise<ProductRating | null> {
  const db = getAdminDb();
  const snap = await db.collection("productRatings").doc(productId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return {
    ...data,
    updatedAt: serializeTimestamp(data.updatedAt),
  } as ProductRating;
}

// --- Product Questions ---

export async function getProductQuestions(
  productId: string,
  opts?: {
    limitCount?: number;
    offset?: number;
    onlyApproved?: boolean;
    onlyAnswered?: boolean;
  }
): Promise<ProductQuestion[]> {
  const db = getAdminDb();
  let q: Query = db
    .collection("productQuestions")
    .where("productId", "==", productId);

  if (opts?.onlyApproved !== false) {
    q = q.where("isApproved", "==", true);
  }
  if (opts?.onlyAnswered) {
    q = q.where("isAnswered", "==", true);
  }

  q = q.orderBy("createdAt", "desc");

  if (opts?.offset) {
    q = q.offset(opts.offset);
  }
  if (opts?.limitCount) {
    q = q.limit(opts.limitCount);
  }

  const snap = await q.get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...(data as Omit<ProductQuestion, "id">),
      createdAt: serializeTimestamp(data.createdAt),
      updatedAt: serializeTimestamp(data.updatedAt),
      answeredAt: serializeTimestamp(data.answeredAt),
    };
  });
}

export async function createProductQuestion(
  data: Omit<ProductQuestion, "id" | "createdAt" | "updatedAt" | "helpfulCount" | "isApproved" | "moderationStatus" | "isAnswered" | "answer" | "answerAuthor" | "answeredAt">
): Promise<string> {
  const db = getAdminDb();
  const questionRef = await db.collection("productQuestions").add({
    ...data,
    helpfulCount: 0,
    isApproved: false,
    moderationStatus: "pending",
    isAnswered: false,
    answer: null,
    answerAuthor: null,
    answeredAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return questionRef.id;
}

export async function answerProductQuestion(
  questionId: string,
  answer: string,
  answerAuthor: "seller" | "admin" | "user",
  answeredBy: string
): Promise<void> {
  const db = getAdminDb();
  await db.collection("productQuestions").doc(questionId).update({
    answer,
    answerAuthor,
    isAnswered: true,
    answeredAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateProductQuestion(
  questionId: string,
  data: Partial<ProductQuestion>
): Promise<void> {
  const db = getAdminDb();
  await db.collection("productQuestions").doc(questionId).update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteProductQuestion(questionId: string): Promise<void> {
  const db = getAdminDb();
  await db.collection("productQuestions").doc(questionId).delete();
}

export async function incrementQuestionHelpful(questionId: string): Promise<void> {
  const db = getAdminDb();
  await db.collection("productQuestions").doc(questionId).update({
    helpfulCount: FieldValue.increment(1),
  });
}

// --- Helper: Check if user purchased product ---
export async function hasUserPurchasedProduct(
  userId: string,
  productId: string
): Promise<boolean> {
  const db = getAdminDb();
  const snap = await db
    .collection("orders")
    .where("userId", "==", userId)
    .where("status", "in", ["completed", "in_progress"])
    .limit(10)
    .get();

  for (const doc of snap.docs) {
    const order = doc.data() as FirestoreOrder;
    if (order.items?.some((item) => item.productId === productId)) {
      return true;
    }
  }
  return false;
}

export async function getUserOrderWithProduct(
  userId: string,
  productId: string
): Promise<FirestoreOrder | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("orders")
    .where("userId", "==", userId)
    .where("status", "in", ["completed", "in_progress"])
    .limit(20)
    .get();

  for (const doc of snap.docs) {
    const order = doc.data() as FirestoreOrder;
    if (order.items?.some((item) => item.productId === productId)) {
      return { id: doc.id, ...order };
    }
  }
  return null;
}
