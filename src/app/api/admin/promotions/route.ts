// src/app/api/admin/promotions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

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
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error("Create promotion error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
