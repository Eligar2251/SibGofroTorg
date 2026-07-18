// src/app/api/admin/questions/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getProductQuestions,
  getAllProductQuestions,
  getProducts,
  answerProductQuestion,
  updateProductQuestion,
  deleteProductQuestion,
} from "@/lib/firestore-queries";
import { requireAdminApi } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");
    const limitCount = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");
    const status =
      (searchParams.get("status") as
        | "all"
        | "pending"
        | "approved"
        | "rejected") || "all";
    const search = searchParams.get("search") || "";
    const answered =
      (searchParams.get("answered") as "all" | "answered" | "unanswered") ||
      "all";

    /* Карта productId → название товара */
    const products = await getProducts({});
    const productNameMap = new Map(products.map((p) => [p.id, p.name]));

    let questions = productId
      ? await getProductQuestions(productId, {
          limitCount: 500,
          offset: 0,
          onlyApproved: false,
        })
      : await getAllProductQuestions(500);

    /* Фильтр по статусу модерации */
    if (status !== "all") {
      questions = questions.filter((q) => q.moderationStatus === status);
    }

    /* Фильтр по наличию ответа */
    if (answered === "answered") {
      questions = questions.filter((q) => q.isAnswered);
    } else if (answered === "unanswered") {
      questions = questions.filter((q) => !q.isAnswered);
    }

    /* Поиск по тексту, автору, товару */
    if (search) {
      const searchLower = search.toLowerCase();
      questions = questions.filter(
        (q) =>
          q.question.toLowerCase().includes(searchLower) ||
          (q.answer && q.answer.toLowerCase().includes(searchLower)) ||
          q.userName.toLowerCase().includes(searchLower) ||
          (productNameMap.get(q.productId) || "")
            .toLowerCase()
            .includes(searchLower)
      );
    }

    // Пагинация после всех фильтров
    const totalCount = questions.length;
    const paginatedQuestions = questions
      .slice(offset, offset + limitCount)
      .map((q) => ({
        ...q,
        productName: productNameMap.get(q.productId) || null,
      }));
    const totalPages = Math.ceil(totalCount / limitCount);

    return NextResponse.json({ 
      questions: paginatedQuestions, 
      totalCount,
      totalPages,
      currentPage: Math.floor(offset / limitCount) + 1,
    });
  } catch (error) {
    console.error("Get admin questions error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}