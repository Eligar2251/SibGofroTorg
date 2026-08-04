// src/app/api/admin/wastepaper/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWastepaperRequest,
  updateWastepaperRequestStatus,
} from "@/lib/supabase-queries";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const ALLOWED_STATUSES = ["new", "in_progress", "completed", "rejected"];
    if (!body.status || !ALLOWED_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: "Недопустимый статус заявки" },
        { status: 400 }
      );
    }
    await updateWastepaperRequestStatus(id, body.status);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "status_change",
      "order",
      id,
      `Заявка на макулатуру #${id.slice(0, 8)}: статус → ${body.status}`,
      { newStatus: body.status }
    );
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
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "order",
      id,
      `Удалена заявка на макулатуру #${id.slice(0, 8)}`,
      { table: "wastepaper_requests", deleted: true }
    );
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("Delete wastepaper request error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
