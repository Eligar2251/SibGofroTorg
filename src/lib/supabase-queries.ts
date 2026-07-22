// =========================================================
// src/lib/supabase-queries.ts
// Запросы к Supabase с учётом RLS-политик (free tier, только DB)
// =========================================================

import { supabase } from "./supabase";
import type {
  FirestoreCategory,
  FirestoreProduct,
  Promotion,
  PopupCampaign,
  FirestoreOrder,
  ProductReview,
  ProductQuestion,
  ProductRating,
  ProductView,
} from "./types";

/* ─── Утилиты ────────────────────────────────────────────── */

function checkClient() {
  if (!supabase) throw new Error("Supabase клиент не инициализирован. Проверь .env переменные.");
  return supabase;
}

/* ─── Категории ──────────────────────────────────────────── */

export async function getSupabaseCategories(): Promise<FirestoreCategory[]> {
  const sb = checkClient();
  const { data, error } = await sb
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .eq("is_visible", true);
  if (error) {
    console.error("[Supabase] categories error:", error.message);
    return [];
  }
  return (data || []).map((d: any) => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    icon: d.icon,
    description: d.description,
    sortOrder: d.sort_order,
    isVisible: d.is_visible,
    imageUrl: d.image_url,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));
}

/* ─── Товары ─────────────────────────────────────────────── */

export async function getSupabaseProducts(opts?: {
  categoryId?: string;
  limitCount?: number;
  promoOnly?: boolean;
  featuredOnly?: boolean;
  includeHidden?: boolean;
}): Promise<FirestoreProduct[]> {
  const sb = checkClient();
  let query = sb.from("products").select("*");

  if (!opts?.includeHidden) {
    query = query.eq("is_visible", true);
  }
  if (opts?.categoryId) {
    query = query.eq("category_id", opts.categoryId);
  }
  if (opts?.promoOnly) {
    query = query.eq("is_promo", true);
  }
  if (opts?.featuredOnly) {
    query = query.eq("is_featured", true);
  }

  const { data, error } = await query
    .order("name", { ascending: true })
    .limit(opts?.limitCount || 500);

  if (error) {
    console.error("[Supabase] products error:", error.message);
    return [];
  }

  return (data || []).map((d: any) => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    categoryId: d.category_id,
    sku: d.sku,
    description: d.description,
    price: d.price ? Number(d.price) : null,
    priceWholesale: d.price_wholesale ? Number(d.price_wholesale) : null,
    minWholesaleQty: d.min_wholesale_qty ? Number(d.min_wholesale_qty) : null,
    dimensionLength: d.dimension_length ? Number(d.dimension_length) : null,
    dimensionWidth: d.dimension_width ? Number(d.dimension_width) : null,
    dimensionHeight: d.dimension_height ? Number(d.dimension_height) : null,
    dimensionUnit: d.dimension_unit || "мм",
    weight: d.weight ? Number(d.weight) : null,
    material: d.material,
    packQty: d.pack_qty ? Number(d.pack_qty) : null,
    volume: d.volume ? Number(d.volume) : null,
    note: d.note,
    inStock: d.in_stock ?? true,
    stockQty: d.stock_qty ? Number(d.stock_qty) : null,
    stockWarnQty: d.stock_warn_qty ? Number(d.stock_warn_qty) : null,
    isPromo: d.is_promo ?? false,
    promoLabel: d.promo_label,
    madeToOrder: d.made_to_order ?? false,
    discountType: d.discount_type,
    discountValue: d.discount_value ? Number(d.discount_value) : null,
    discountBadge: d.discount_badge,
    isVisible: d.is_visible ?? true,
    isFeatured: d.is_featured ?? false,
    imageUrl: d.image_url,
    images: Array.isArray(d.images) ? d.images : [],
    viewCount: d.view_count || 0,
    averageRating: d.average_rating ? Number(d.average_rating) : 0,
    totalReviews: d.total_reviews || 0,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));
}

export async function getSupabaseProductBySlug(slug: string): Promise<FirestoreProduct | null> {
  const sb = checkClient();
  const { data, error } = await sb
    .from("products")
    .select("*")
    .eq("slug", slug)
    .eq("is_visible", true)
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    categoryId: data.category_id,
    sku: data.sku,
    description: data.description,
    price: data.price ? Number(data.price) : null,
    priceWholesale: data.price_wholesale ? Number(data.price_wholesale) : null,
    minWholesaleQty: data.min_wholesale_qty ? Number(data.min_wholesale_qty) : null,
    dimensionLength: data.dimension_length ? Number(data.dimension_length) : null,
    dimensionWidth: data.dimension_width ? Number(data.dimension_width) : null,
    dimensionHeight: data.dimension_height ? Number(data.dimension_height) : null,
    dimensionUnit: data.dimension_unit || "мм",
    weight: data.weight ? Number(data.weight) : null,
    material: data.material,
    packQty: data.pack_qty ? Number(data.pack_qty) : null,
    volume: data.volume ? Number(data.volume) : null,
    note: data.note,
    inStock: data.in_stock ?? true,
    stockQty: data.stock_qty ? Number(data.stock_qty) : null,
    stockWarnQty: data.stock_warn_qty ? Number(data.stock_warn_qty) : null,
    isPromo: data.is_promo ?? false,
    promoLabel: data.promo_label,
    madeToOrder: data.made_to_order ?? false,
    discountType: data.discount_type,
    discountValue: data.discount_value ? Number(data.discount_value) : null,
    discountBadge: data.discount_badge,
    isVisible: data.is_visible ?? true,
    isFeatured: data.is_featured ?? false,
    imageUrl: data.image_url,
    images: Array.isArray(data.images) ? data.images : [],
    viewCount: data.view_count || 0,
    averageRating: data.average_rating ? Number(data.average_rating) : 0,
    totalReviews: data.total_reviews || 0,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  } as FirestoreProduct;
}

/* ─── Заказы ────────────────────────────────────────────── */

export async function getSupabaseOrders(opts?: { status?: string; limit?: number }): Promise<FirestoreOrder[]> {
  const sb = checkClient();
  let query = sb.from("orders").select("*").order("created_at", { ascending: false });
  if (opts?.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  if (opts?.limit) {
    query = query.limit(opts.limit);
  }
  const { data, error } = await query;
  if (error) {
    console.error("[Supabase] orders error:", error.message);
    return [];
  }
  return (data || []).map((d: any) => ({
    id: d.id,
    type: d.type,
    customerType: d.customer_type,
    customerName: d.customer_name,
    customerPhone: d.customer_phone,
    customerPhoneDigits: d.customer_phone_digits,
    userId: d.user_id,
    customerEmail: d.customer_email,
    communicationChannel: d.communication_channel,
    paymentMethod: d.payment_method,
    items: Array.isArray(d.items) ? d.items : [],
    totalSum: d.total_sum ? Number(d.total_sum) : undefined,
    productInfo: d.product_info,
    quantity: d.quantity,
    comment: d.comment,
    channel: d.channel,
    status: d.status,
    closeReason: d.close_reason,
    dealId: d.deal_id,
    dealNumber: d.deal_number,
    paymentId: d.payment_id,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));
}

export async function createSupabaseOrder(orderData: Partial<FirestoreOrder> & { userId?: string | null }) {
  const sb = checkClient();
  const payload = {
    type: orderData.type || "order",
    user_id: orderData.userId || null,
    customer_type: orderData.customerType || "individual",
    customer_name: orderData.customerName || "",
    customer_phone: orderData.customerPhone || "",
    customer_phone_digits: orderData.customerPhoneDigits || null,
    customer_email: orderData.customerEmail || null,
    communication_channel: orderData.communicationChannel || "telegram",
    payment_method: orderData.paymentMethod || "transfer",
    items: orderData.items || [],
    total_sum: orderData.totalSum || 0,
    product_info: orderData.productInfo || null,
    quantity: orderData.quantity || 1,
    comment: orderData.comment || null,
    channel: orderData.channel || null,
    status: "new" as const,
  };
  const { data, error } = await sb.from("orders").insert(payload).select().single();
  if (error) {
    console.error("[Supabase] create order error:", error.message);
    return null;
  }
  return { id: data.id, ...payload, createdAt: data.created_at, updatedAt: data.updated_at };
}

/* ─── Промо / Акции ──────────────────────────────────────── */

export async function getSupabasePromotions(): Promise<Promotion[]> {
  const sb = checkClient();
  const { data, error } = await sb
    .from("promotions")
    .select("*")
    .order("sort_order", { ascending: true })
    .eq("is_visible", true);
  if (error) {
    console.error("[Supabase] promotions error:", error.message);
    return [];
  }
  return (data || []).map((d: any) => ({
    id: d.id,
    title: d.title,
    subtitle: d.subtitle,
    badge: d.badge,
    imageUrl: d.image_url,
    linkType: d.link_type,
    productId: d.product_id,
    linkUrl: d.link_url,
    sortOrder: d.sort_order,
    isVisible: d.is_visible,
    icon: d.icon,
    color: d.color,
    light: d.light,
    deadline: d.deadline,
    isPopup: d.is_popup,
    popupStartAt: d.popup_start_at,
    popupDelaySeconds: d.popup_delay_seconds,
    popupDurationSeconds: d.popup_duration_seconds,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));
}

/* ─── Попап-кампании ────────────────────────────────────── */

export async function getSupabasePopupCampaigns(): Promise<PopupCampaign[]> {
  const sb = checkClient();
  const { data, error } = await sb
    .from("popup_campaigns")
    .select("*")
    .order("sort_order", { ascending: true })
    .eq("is_active", true);
  if (error) {
    console.error("[Supabase] popup campaigns error:", error.message);
    return [];
  }
  return (data || []).map((d: any) => ({
    id: d.id,
    type: d.type,
    title: d.title,
    isActive: d.is_active,
    kicker: d.kicker,
    description: d.description,
    details: Array.isArray(d.details) ? d.details : null,
    buttonText: d.button_text,
    buttonUrl: d.button_url,
    style: d.style,
    imageUrl: d.image_url,
    startAt: d.start_at,
    endAt: d.end_at,
    delaySeconds: d.delay_seconds,
    durationSeconds: d.duration_seconds,
    frequency: d.frequency,
    sortOrder: d.sort_order,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));
}

/* ─── Отзывы о товарах ──────────────────────────────────── */

export async function getSupabaseProductReviews(productId: string, opts?: { limitCount?: number; onlyApproved?: boolean }) {
  const sb = checkClient();
  let query = sb
    .from("product_reviews")
    .select("*")
    .eq("product_id", productId);
  if (opts?.onlyApproved !== false) {
    query = query.eq("is_approved", true).eq("moderation_status", "approved");
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(opts?.limitCount || 50);
  if (error) {
    console.error("[Supabase] reviews error:", error.message);
    return [];
  }
  return (data || []).map((d: any) => ({
    id: d.id,
    productId: d.product_id,
    userId: d.user_id,
    userName: d.user_name,
    userAvatar: d.user_avatar,
    orderId: d.order_id,
    rating: d.rating,
    title: d.title,
    text: d.text,
    pros: d.pros,
    cons: d.cons,
    images: Array.isArray(d.images) ? d.images : [],
    isVerifiedPurchase: d.is_verified_purchase ?? false,
    helpfulCount: d.helpful_count || 0,
    isApproved: d.is_approved ?? false,
    moderationStatus: d.moderation_status || "pending",
    moderationNote: d.moderation_note,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));
}

export async function createSupabaseProductReview(data: Partial<ProductReview> & { userId?: string }) {
  const sb = checkClient();
  const payload = {
    product_id: data.productId,
    user_id: data.userId || null,
    user_name: data.userName || "",
    user_avatar: data.userAvatar || null,
    order_id: data.orderId || null,
    rating: data.rating || 5,
    title: data.title || null,
    text: data.text || "",
    pros: data.pros || null,
    cons: data.cons || null,
    images: data.images || [],
    is_verified_purchase: data.isVerifiedPurchase ?? false,
    is_approved: false,
    moderation_status: "pending",
    helpful_count: 0,
  };
  const { data: result, error } = await sb.from("product_reviews").insert(payload).select().single();
  if (error) {
    console.error("[Supabase] create review error:", error.message);
    return null;
  }
  return result?.id || null;
}

/* ─── Вопросы о товарах ──────────────────────────────────── */

export async function getSupabaseProductQuestions(productId: string, opts?: { limitCount?: number; onlyAnswered?: boolean }) {
  const sb = checkClient();
  let query = sb
    .from("product_questions")
    .select("*")
    .eq("product_id", productId)
    .eq("is_approved", true)
    .eq("moderation_status", "approved");
  if (opts?.onlyAnswered) {
    query = query.eq("is_answered", true);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(opts?.limitCount || 20);
  if (error) {
    console.error("[Supabase] questions error:", error.message);
    return [];
  }
  return (data || []).map((d: any) => ({
    id: d.id,
    productId: d.product_id,
    userId: d.user_id,
    userName: d.user_name,
    userAvatar: d.user_avatar,
    question: d.question,
    answer: d.answer,
    answerAuthor: d.answer_author,
    answeredAt: d.answered_at,
    isAnswered: d.is_answered ?? false,
    helpfulCount: d.helpful_count || 0,
    isApproved: d.is_approved ?? false,
    moderationStatus: d.moderation_status || "pending",
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));
}

export async function createSupabaseProductQuestion(data: Partial<ProductQuestion> & { userId?: string }) {
  const sb = checkClient();
  const payload = {
    product_id: data.productId,
    user_id: data.userId || null,
    user_name: data.userName || "",
    user_avatar: data.userAvatar || null,
    question: data.question || "",
    is_approved: false,
    moderation_status: "pending",
    helpful_count: 0,
    is_answered: false,
  };
  const { data: result, error } = await sb.from("product_questions").insert(payload).select().single();
  if (error) {
    console.error("[Supabase] create question error:", error.message);
    return null;
  }
  return result?.id || null;
}

/* ─── Просмотры товаров ─────────────────────────────────── */

export async function recordSupabaseProductView(
  productId: string,
  options: { userId?: string | null; sessionId: string; ipHash?: string | null; userAgent?: string | null; referrer?: string | null }
): Promise<{ isUnique: boolean; viewCount?: number }> {
  const sb = checkClient();
  // Дедупликация через составной ключ в таблице (без транзакций в anon-режиме можно просто попытаться вставить)
  // Для простоты в бесплатном тарифе: попытка вставки + проверка уникальности через unique-индекс (если настроен)
  // Здесь делаем простую вставку с уникальным doc-ключом через составной id (генерируем детерминированно)
  const docId = `${productId}__${options.userId ? `u_${options.userId}` : `s_${options.sessionId}`}`.replace(/\//g, "_").slice(0, 300);

  const { error } = await sb.from("product_views").insert({
    id: docId,
    product_id: productId,
    user_id: options.userId || null,
    session_id: options.sessionId,
    ip_hash: options.ipHash || null,
    user_agent: options.userAgent || null,
    referrer: options.referrer || null,
  }).select();

  if (error) {
    // Вероятно, запись уже существует (конфликт) или ошибка RLS
    // Возвращаем isUnique = false
    return { isUnique: false };
  }

  // Увеличиваем счётчик просмотров товара напрямую (без функций, т.к. без Functions в бесплатном тарифе)
  const { data: current } = await sb.from("products").select("view_count").eq("id", productId).single();
  if (current) {
    await sb.from("products").update({ view_count: (current.view_count || 0) + 1, updated_at: new Date().toISOString() }).eq("id", productId);
  }

  return { isUnique: true };
}

/* ─── Макулатура ─────────────────────────────────────────── */

export async function getSupabaseWastepaperRequests(opts?: { status?: string; limit?: number }) {
  const sb = checkClient();
  let query = sb.from("wastepaper_requests").select("*").order("created_at", { ascending: false });
  if (opts?.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  if (opts?.limit) query = query.limit(opts.limit);
  const { data, error } = await query;
  if (error) {
    console.error("[Supabase] wastepaper error:", error.message);
    return [];
  }
  return (data || []).map((d: any) => ({
    id: d.id,
    source: "wastepaper",
    type: "wastepaper",
    customerType: "individual",
    customerName: d.customer_name || "",
    customerPhone: d.customer_phone || "",
    customerEmail: d.customer_email || null,
    communicationChannel: d.delivery_method || null,
    wastepaperType: d.wastepaper_type || null,
    weight: Number(d.weight || 0),
    deliveryMethod: d.delivery_method || null,
    estimatedPayout: Number(d.estimated_payout || 0),
    productInfo: d.wastepaper_type ? `Макулатура: ${d.wastepaper_type}` : "Макулатура",
    comment: d.comment || null,
    status: d.status || "new",
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));
}

export async function createSupabaseWastepaperRequest(data: {
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  wastepaperType?: string | null;
  weight?: number;
  deliveryMethod?: string | null;
  estimatedPayout?: number;
  comment?: string | null;
  userId?: string | null;
}) {
  const sb = checkClient();
  const payload = {
    user_id: data.userId || null,
    customer_name: data.customerName,
    customer_phone: data.customerPhone,
    customer_email: data.customerEmail || null,
    wastepaper_type: data.wastepaperType || null,
    weight: data.weight || 0,
    delivery_method: data.deliveryMethod || null,
    estimated_payout: data.estimatedPayout || 0,
    comment: data.comment || null,
    status: "new",
  };
  const { data: result, error } = await sb.from("wastepaper_requests").insert(payload).select().single();
  if (error) {
    console.error("[Supabase] create wastepaper error:", error.message);
    return null;
  }
  return { id: result?.id, ...payload, createdAt: result?.created_at };
}

/* ─── Настройки ──────────────────────────────────────────── */

export async function getSupabaseSettings() {
  const sb = checkClient();
  const { data, error } = await sb.from("settings").select("*").eq("id", "main").single();
  if (error) {
    console.error("[Supabase] settings error:", error.message);
    return {};
  }
  const content = data?.content || {};
  return {
    id: data?.id,
    ...content,
    createdAt: data?.created_at,
    updatedAt: data?.updated_at,
  } as any;
}

/* =========================================================
 * Примечание по RLS-политикам и защите:
 *
 * 1. ВСЕ таблицы с ENABLE ROW LEVEL SECURITY.
 * 2. Админские операции требуют записи в таблице `admins`
 *    с `user_id = auth.uid()`.
 * 3. Пользователи видят только свои заказы (`user_id = auth.uid()`)
 *    и могут вставлять отзывы/вопросы/просмотры/заявки.
 * 4. Публичные данные (товары, категории, акции, одобренные
 *    отзывы/вопросы) читаются без авторизации — через SELECT-политики `USING (TRUE)`.
 * 5. Нет функций (Functions) и бакетов (Storage) — только чистая БД.
 * 6. Для использования в продакшене добавьте `service_role` ключ
 *    для серверных операций, но тогда RLS будет обходиться.
 * ========================================================= */
