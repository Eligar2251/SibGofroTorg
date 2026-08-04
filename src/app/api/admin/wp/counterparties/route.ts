// src/app/api/admin/wp/counterparties/route.ts
// Отдельный учёт макулатуры: контрагенты (список, создание).
import { NextRequest, NextResponse } from "next/server";
import {
  getWpCounterparties,
  requireWastepaperApi,
  upsertWpCounterparty,
} from "@/lib/wastepaper-account";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const items = await getWpCounterparties();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("WP counterparties list error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const item = await upsertWpCounterparty({
      name: String(body.name || ""),
      roles: Array.isArray(body.roles) ? body.roles.map(String) : [],
      phone: body.phone ?? null,
      address: body.address ?? null,
      contactPerson: body.contactPerson ?? null,
      inn: body.inn ?? null,
      comment: body.comment ?? null,
      createdBy: auth.displayName,
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "wp-counterparty",
      item.id,
      `Контрагент макулатуры: ${item.name}`,
      { roles: item.roles }
    );
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("WP counterparty create error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
