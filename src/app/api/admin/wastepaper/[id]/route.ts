// src/app/api/admin/wastepaper/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWastepaperRequest,
  updateWastepaperRequestStatus,
} from "@/lib/firestore-queries";
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
    if (!body.status) {
      return NextResponse.json({ error: "Статус обязателен" }, { status: 400 });
    }
    await updateWastepaperRequestStatus(id, body.status);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update wastepaper request error:", error);
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
    await deleteWastepaperRequest(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete wastepaper request error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
