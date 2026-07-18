// src/app/api/admin/questions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getProductQuestions, getProductQuestionCount, answerProductQuestion, updateProductQuestion, deleteProductQuestion } from "@/lib/firestore-queries";
import { requireAdminApi } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");
    const limitCount = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");
    const status = searchParams.get("status") as "all" | "pending" | "approved" | "rejected" || "all";
    const search = searchParams.get("search") || "";
    const answered = searchParams.get("answered") as "all" | "answered" | "unanswered" || "all";

    if (!productId) {
      return NextResponse.json({ error: "Product ID required" }, { status: 400 });
    }

    const onlyApproved = status === "approved";
    const onlyRejected = status === "rejected";
    const onlyPending = status === "pending";

    let questions;
    if (onlyApproved) {
      questions = await getProductQuestions(productId, { 
        limitCount, 
        offset, 
        onlyApproved: true,
        onlyAnswered: answered === "answered" ? true : answered === "unanswered" ? false : undefined,
      });
    } else if (onlyPending) {
      questions = await getProductQuestions(productId, { 
        limitCount, 
        offset, 
        onlyApproved: false,
        onlyAnswered: answered === "answered" ? true : answered === "unanswered" ? false : undefined,
      });
    } else if (onlyRejected) {
      // For rejected, we need to get all and filter
      questions = await getProductQuestions(productId, { 
        limitCount: 1000, 
        offset: 0, 
        onlyApproved: false,
        onlyAnswered: answered === "answered" ? true : answered === "unanswered" ? false : undefined,
      });
      questions = questions.filter(q => q.moderationStatus === "rejected");
    } else {
      // all statuses
      questions = await getProductQuestions(productId, { 
        limitCount, 
        offset, 
        onlyApproved: false,
        onlyAnswered: answered === "answered" ? true : answered === "unanswered" ? false : undefined,
      });
      if (status !== "all") {
        questions = questions.filter(q => q.moderationStatus === status);
      }
    }

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      questions = questions.filter(q => 
        q.question.toLowerCase().includes(searchLower) ||
        q.userName.toLowerCase().includes(searchLower)
      );
    }

    // Apply pagination after search
    const totalCount = questions.length;
    const paginatedQuestions = questions.slice(offset, offset + limitCount);
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