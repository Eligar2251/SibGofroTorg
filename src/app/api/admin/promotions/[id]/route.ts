// src/app/api/admin/promotions/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

function cleanPromotion(body: Record<string, unknown>) {
  const linkType = ["product", "url", "none"].includes(String(body.linkType))
    ? String(body.linkType)
    : "none";
  return {
    title: String(body.title || "").trim().slice(0, 200),
    subtitle: body.subtitle ? String(body.subtitle).slice(0, 500) : null,
    badge: body.badge ? String(body.badge).slice(0, 80) : null,
    imageUrl: body.imageUrl ? String(body.imageUrl).slice(0, 1000) : null,
    linkType,
    productId: linkType === "product" && body.productId ? String(body.productId) : null,
    linkUrl: linkType === "url" && body.linkUrl ? String(body.linkUrl).slice(0, 1000) : null,
    sortOrder: Number(body.sortOrder) || 0,
    isVisible: body.isVisible !== false,
    icon: body.icon ? String(body.icon).slice(0, 60) : null,
    color: body.color ? String(body.color).slice(0, 80) : null,
    light: body.light ? String(body.light).slice(0, 80) : null,
    deadline: body.deadline ? String(body.deadline).slice(0, 100) : null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const update = cleanPromotion(body);
    if (!update.title) {
      return NextResponse.json(
        { error: "Заголовок обязателен" },
        { status: 400 }
      );
    }
    const db = getAdminDb();
    await db.collection("promotions").doc(id).update(update);
    revalidateTag("promotions", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update promotion error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const db = getAdminDb();
    await db.collection("promotions").doc(id).delete();
    revalidateTag("promotions", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete promotion error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
