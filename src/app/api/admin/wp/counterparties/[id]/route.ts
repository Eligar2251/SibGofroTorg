// src/app/api/admin/wp/counterparties/[id]/route.ts
// Отдельный учёт макулатуры: контрагенты (изменение, удаление).
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWpCounterparty,
  requireWastepaperApi,
  upsertWpCounterparty,
} from "@/lib/wastepaper-account";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const item = await upsertWpCounterparty({
      id,
      name: String(body.name || ""),
      roles: Array.isArray(body.roles) ? body.roles.map(String) : [],
      phone: body.phone ?? null,
      address: body.address ?? null,
      contactPerson: body.contactPerson ?? null,
      inn: body.inn ?? null,
      comment: body.comment ?? null,
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "wp-counterparty",
      id,
      `Контрагент макулатуры: ${item.name}`,
      { roles: item.roles }
    );
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("WP counterparty update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteWpCounterparty(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "wp-counterparty",
      id,
      `Удалён контрагент макулатуры #${id.slice(0, 8)}`
    );
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("WP counterparty delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
