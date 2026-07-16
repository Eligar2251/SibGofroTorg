// =========================================================
// FILE: src/lib/firestore-queries.ts
// =========================================================

import { FieldValue, type Query } from "firebase-admin/firestore";
import { getAdminDb } from "./firebase-admin";
import { FirestoreCategory, FirestoreProduct, FirestoreOrder } from "./types";

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

// ─── Orders ───────────────────────────────────────────────

export async function createOrder(
  data: Omit<FirestoreOrder, "id" | "status" | "createdAt" | "updatedAt"> & {
    customerPhoneDigits?: string | null;
    userId?: string | null;
  }
) {
  const db = getAdminDb();

  return db.runTransaction(async (transaction) => {
    // 1) Все чтения
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

    // 2) Записи
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

    // Возвращаем полные данные для уведомлений (не только id)
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