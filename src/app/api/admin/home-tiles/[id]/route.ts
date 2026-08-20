// =========================================================
// FILE: src/app/api/admin/home-tiles/[id]/route.ts
// Плитка главной: изменение и удаление.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { deleteHomeTile, updateHomeTile } from "@/lib/supabase-queries";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    if (!String(body.title || "").trim()) {
      return NextResponse.json({ error: "Название обязательно" }, { status: 400 });
    }
    await updateHomeTile(id, body);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update home tile error:", error);
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
    await deleteHomeTile(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete home tile error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
