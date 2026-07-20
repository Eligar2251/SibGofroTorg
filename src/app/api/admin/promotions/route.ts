// src/app/api/admin/promotions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

function popupFields(body: Record<string, unknown>) {
  const delay = Math.min(3600, Math.max(0, Number(body.popupDelaySeconds) || 0));
  const duration = Math.min(
    300,
    Math.max(3, Number(body.popupDurationSeconds) || 15)
  );
  return {
    isPopup: body.isPopup === true,
    popupStartAt:
      typeof body.popupStartAt === "string" && body.popupStartAt.trim()
        ? body.popupStartAt.trim().slice(0, 30)
        : null,
    popupDelaySeconds: delay,
    popupDurationSeconds: duration,
  };
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const db = getAdminDb();
    const snap = await db.collection("promotions").orderBy("sortOrder", "asc").get();
    const promos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ promotions: promos });
  } catch (error) {
    console.error("Get promotions error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    if (!body.title) {
      return NextResponse.json({ error: "Заголовок обязателен" }, { status: 400 });
    }
    const db = getAdminDb();
    const docRef = await db.collection("promotions").add({
      title: body.title,
      subtitle: body.subtitle || null,
      badge: body.badge || null,
      imageUrl: body.imageUrl || null,
      linkType: body.linkType || "none",
      productId: body.productId || null,
      linkUrl: body.linkUrl || null,
      sortOrder: Number(body.sortOrder || 0),
      isVisible: body.isVisible ?? true,
      // New fields for deal card display
      icon: body.icon || null,
      color: body.color || null,
      light: body.light || null,
      deadline: body.deadline || null,
      ...popupFields(body),
      createdAt: FieldValue.serverTimestamp(),
    });
    revalidateTag("promotions", { expire: 0 });
    return NextResponse.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error("Create promotion error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
