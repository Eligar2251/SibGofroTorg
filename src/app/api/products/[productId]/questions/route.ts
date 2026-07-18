// src/app/api/products/[productId]/questions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getProductQuestions, createProductQuestion, incrementQuestionHelpful } from "@/lib/firestore-queries";
import { getServerSession } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const { searchParams } = new URL(request.url);
    
    const limitCount = parseInt(searchParams.get("limit") || "10");
    const offset = parseInt(searchParams.get("offset") || "0");
    const onlyApproved = searchParams.get("onlyApproved") !== "false";
    const onlyAnswered = searchParams.get("onlyAnswered") === "true";

    const questions = await getProductQuestions(productId, { 
      limitCount, 
      offset, 
      onlyApproved, 
      onlyAnswered 
    });

    return NextResponse.json({ questions });
  } catch (error) {
    console.error("Get product questions error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
    }

    const { productId } = await params;
    const body = await request.json();
    const { question } = body;

    if (!question || question.trim().length < 5) {
      return NextResponse.json({ error: "Вопрос должен содержать минимум 5 символов" }, { status: 400 });
    }

    const questionId = await createProductQuestion({
      productId,
      userId: session.userId,
      userName: session.name || "Покупатель",
      userAvatar: session.avatar || null,
      question: question.trim(),
    });

    return NextResponse.json({ success: true, questionId, message: "Вопрос отправлен на модерацию" });
  } catch (error) {
    console.error("Create product question error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}