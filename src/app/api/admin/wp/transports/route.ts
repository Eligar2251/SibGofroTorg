// src/app/api/admin/wp/transports/route.ts
// Отдельный учёт макулатуры: перевозки за макулатурой (список, создание).
import { NextRequest, NextResponse } from "next/server";
import {
  createWpTransport,
  getWpTransports,
  requireWastepaperApi,
} from "@/lib/wastepaper-account";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const items = await getWpTransports(300);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("WP transports list error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const item = await createWpTransport(
      {
        date: String(body.date || ""),
        startTime: body.startTime ?? null,
        driverName: body.driverName ?? null,
        driverPhone: body.driverPhone ?? null,
        vehicle: body.vehicle ?? null,
        note: body.note ?? null,
        items: Array.isArray(body.items) ? body.items : [],
        status: body.status === "active" ? "active" : "planned",
      },
      auth.displayName
    );
    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "wp-transport",
      item.id,
      `Перевозка ТМ-${item.number} на ${item.date}, остановок: ${item.items.length}`,
      { totalPlannedKg: item.totalPlannedKg }
    );
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("WP transport create error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
