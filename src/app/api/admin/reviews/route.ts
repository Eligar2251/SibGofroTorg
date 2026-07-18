// src/app/api/admin/reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  getProductReviews,
  getProductReviewStats,
  getAllProductReviews,
  getGlobalReviewStats,
  getProducts,
  createProductReview,
} from "@/lib/firestore-queries";
import { requireAdminApi } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");
    const limitCount = parseInt(searchParams.get("limit") || "20");
    const page = parseInt(searchParams.get("page") || "1");
    const status = (searchParams.get("status") || "all") as
      | "all"
      | "pending"
      | "approved"
      | "rejected";
    const search = (searchParams.get("search") || "").trim().toLowerCase();

    /* Карта productId → название товара для обогащения отзывов */
    const products = await getProducts({});
    const productNameMap = new Map(products.map((p) => [p.id, p.name]));

    let allReviews;
    let stats;

    if (productId) {
      /* Режим одного товара */
      [allReviews, stats] = await Promise.all([
        getProductReviews(productId, {
          limitCount: 500,
          sortBy: "newest",
          onlyApproved: false,
        }),
        getProductReviewStats(productId),
      ]);
    } else {
      /* Режим всех товаров */
      [allReviews, stats] = await Promise.all([
        getAllProductReviews(500),
        getGlobalReviewStats(),
      ]);
    }

    /* Фильтр по статусу */
    let filtered = allReviews;
    if (status !== "all") {
      filtered = filtered.filter((r) => r.moderationStatus === status);
    }

    /* Поиск по тексту, автору, товару */
    if (search) {
      filtered = filtered.filter((r) => {
        const productName = (productNameMap.get(r.productId) || "").toLowerCase();
        return (
          r.text?.toLowerCase().includes(search) ||
          (r.title && r.title.toLowerCase().includes(search)) ||
          r.userName?.toLowerCase().includes(search) ||
          productName.includes(search)
        );
      });
    }

    const totalAfterFilter = filtered.length;
    const offset = (page - 1) * limitCount;
    const paged = filtered.slice(offset, offset + limitCount);

    const enriched = paged.map((r) => ({
      ...r,
      productName: productNameMap.get(r.productId) || null,
    }));

    return NextResponse.json({
      reviews: enriched,
      stats,
      total: totalAfterFilter,
      totalPages: Math.max(1, Math.ceil(totalAfterFilter / limitCount)),
    });
  } catch (error) {
    console.error("Admin get reviews error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { productId, rating, title, text, pros, cons, images, userId, userName, userAvatar, orderId, isVerifiedPurchase } = body;

    if (!productId || !rating || !text) {
      return NextResponse.json({ error: "Недостаточно данных" }, { status: 400 });
    }

    const reviewId = await createProductReview({
      productId,
      userId: userId || "admin",
      userName: userName || "Администратор",
      userAvatar: userAvatar || null,
      orderId: orderId || "admin-manual",
      rating,
      title: title || null,
      text: text.trim(),
      pros: pros?.trim() || null,
      cons: cons?.trim() || null,
      images: images || [],
      isVerifiedPurchase: isVerifiedPurchase ?? false,
    });

    revalidateTag("reviews", { expire: 0 });
    return NextResponse.json({ success: true, reviewId });
  } catch (error) {
    console.error("Admin create review error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}