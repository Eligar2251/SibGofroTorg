// src/app/api/admin/reviews/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { updateProductReview, deleteProductReview, incrementReviewHelpful } from "@/lib/firestore-queries";
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
    const { action, moderationNote } = body;

    if (action === "approve" || action === "reject") {
      await updateProductReview(id, {
        isApproved: action === "approve",
        moderationStatus: action === "approve" ? "approved" : "rejected",
        moderationNote: moderationNote || null,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "helpful") {
      const count = await incrementReviewHelpful(id);
      return NextResponse.json({ success: true, helpfulCount: count });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    console.error("Admin update review error:", error);
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
    await deleteProductReview(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin delete review error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}