// src/app/api/admin/promotions/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const db = getAdminDb();
    await db.collection("promotions").doc(id).update({
      ...body,
      updatedAt: FieldValue.serverTimestamp(),
    });
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
