// src/app/api/admin/reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getProductReviews, getProductReviewStats, createProductReview, incrementReviewHelpful, updateProductReview, deleteProductReview, getProductRating } from "@/lib/firestore-queries";
import { requireAdminApi } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");
    const limitCount = parseInt(searchParams.get("limit") || "20");
    const page = parseInt(searchParams.get("page") || "1");
    const offset = (page - 1) * limitCount;
    const sortBy = searchParams.get("sortBy") as "newest" | "helpful" | "rating_high" | "rating_low" || "newest";
    const status = searchParams.get("status") as "all" | "pending" | "approved" | "rejected" || "all";
    const search = searchParams.get("search") || "";

    if (!productId) {
      return NextResponse.json({ error: "Product ID required" }, { status: 400 });
    }

    const onlyApproved = status === "approved";
    const filterStatus = status !== "all" ? status : undefined;

    let q = {
      limitCount,
      offset,
      sortBy,
      onlyApproved,
    };

    if (filterStatus) {
      // We'll filter in the query function
    }

    const [reviews, stats] = await Promise.all([
      getProductReviews(productId, { limitCount, offset, sortBy, onlyApproved }),
      getProductReviewStats(productId),
    ]);

    // Filter by status if needed
    let filteredReviews = reviews;
    if (status === "pending") {
      filteredReviews = reviews.filter(r => r.moderationStatus === "pending");
    } else if (status === "rejected") {
      filteredReviews = reviews.filter(r => r.moderationStatus === "rejected");
    }

    return NextResponse.json({ 
      reviews: filteredReviews, 
      stats,
      totalPages: Math.ceil(stats.totalReviews / limitCount)
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

    return NextResponse.json({ success: true, reviewId });
  } catch (error) {
    console.error("Admin create review error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}