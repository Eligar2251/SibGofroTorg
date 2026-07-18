// src/app/api/products/[productId]/reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getProductReviews, getProductReviewStats, createProductReview, incrementReviewHelpful, hasUserPurchasedProduct, getUserOrderWithProduct } from "@/lib/firestore-queries";
import { requireUserApi } from "@/lib/user-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const { searchParams } = new URL(request.url);
    
    const limitCount = parseInt(searchParams.get("limit") || "10");
    const offset = parseInt(searchParams.get("offset") || "0");
    const sortBy = searchParams.get("sortBy") as "newest" | "helpful" | "rating_high" | "rating_low" || "newest";
    const onlyApproved = searchParams.get("onlyApproved") !== "false";

    const [reviews, stats] = await Promise.all([
      getProductReviews(productId, { limitCount, offset, sortBy, onlyApproved }),
      getProductReviewStats(productId),
    ]);

    return NextResponse.json({ reviews, stats });
  } catch (error) {
    console.error("Get product reviews error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth instanceof NextResponse) return auth;

    const { productId } = await params;
    const body = await request.json();
    const { rating, title, text, pros, cons, images } = body;

    // Validation
    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Рейтинг должен быть от 1 до 5" }, { status: 400 });
    }
    if (!text || text.trim().length < 10) {
      return NextResponse.json({ error: "Текст отзыва должен содержать минимум 10 символов" }, { status: 400 });
    }

    // Check if user purchased this product
    const hasPurchased = await hasUserPurchasedProduct(auth.uid, productId);
    if (!hasPurchased) {
      return NextResponse.json({ error: "Отзыв можно оставить только после покупки товара" }, { status: 403 });
    }

    const order = await getUserOrderWithProduct(auth.uid, productId);
    if (!order) {
      return NextResponse.json({ error: "Заказ с этим товаром не найден" }, { status: 404 });
    }

    const reviewId = await createProductReview({
      productId,
      userId: auth.uid,
      userName: auth.name || "Покупатель",
      userAvatar: null,
      orderId: order.id,
      rating,
      title: title || null,
      text: text.trim(),
      pros: pros?.trim() || null,
      cons: cons?.trim() || null,
      images: images || [],
      isVerifiedPurchase: true,
    });

    return NextResponse.json({ success: true, reviewId, message: "Отзыв отправлен на модерацию" });
  } catch (error) {
    console.error("Create product review error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    await params; // productId не нужен для инкремента, но сохраняем сигнатуру
    const body = await request.json();
    const { reviewId } = body;

    if (!reviewId || typeof reviewId !== "string") {
      return NextResponse.json(
        { error: "reviewId обязателен" },
        { status: 400 }
      );
    }

    const helpfulCount = await incrementReviewHelpful(reviewId);
    return NextResponse.json({ success: true, helpfulCount });
  } catch (error) {
    console.error("Increment review helpful error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}