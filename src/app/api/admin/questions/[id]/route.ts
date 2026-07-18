// src/app/api/admin/questions/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { answerProductQuestion, updateProductQuestion, deleteProductQuestion, incrementQuestionHelpful } from "@/lib/firestore-queries";
import { requireAdminApi } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const { action, answer, answerAuthor, moderationNote } = body;

    if (action === "answer") {
      if (!answer || answer.trim().length < 2) {
        return NextResponse.json({ error: "Ответ должен содержать минимум 2 символа" }, { status: 400 });
      }
      if (!answerAuthor || !["seller", "admin"].includes(answerAuthor)) {
        return NextResponse.json({ error: "Неверный автор ответа" }, { status: 400 });
      }
      await answerProductQuestion(id, answer.trim(), answerAuthor, "admin");
      return NextResponse.json({ success: true });
    }

    if (action === "approve" || action === "reject") {
      await updateProductQuestion(id, {
        isApproved: action === "approve",
        moderationStatus: action === "approve" ? "approved" : "rejected",
        moderationNote: moderationNote || null,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "helpful") {
      const count = await incrementQuestionHelpful(id);
      return NextResponse.json({ success: true, helpfulCount: count });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    console.error("Admin update question error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    await deleteProductQuestion(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin delete question error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}