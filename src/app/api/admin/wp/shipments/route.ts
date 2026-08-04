// src/app/api/admin/wp/shipments/route.ts
// Отдельный учёт макулатуры: сдачи на предприятие (список, создание).
import { NextRequest, NextResponse } from "next/server";
import {
  createWpShipment,
  ensureWpCounterparty,
  getWpShipments,
  requireWastepaperApi,
} from "@/lib/wastepaper-account";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const items = await getWpShipments(500);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("WP shipments list error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    let enterpriseId = body.enterpriseId || null;
    if (!enterpriseId && body.saveCounterparty && body.enterpriseName) {
      const saved = await ensureWpCounterparty(String(body.enterpriseName), "enterprise");
      enterpriseId = saved.id;
    }
    const item = await createWpShipment(
      {
        date: String(body.date || ""),
        enterpriseId,
        enterpriseName: String(body.enterpriseName || ""),
        wastepaperType: String(body.wastepaperType || "cardboard"),
        weightKg: Number(body.weightKg) || 0,
        pricePerKg: Number(body.pricePerKg) || 0,
        account: body.account === "cash" ? "cash" : "bank",
        isPaid: Boolean(body.isPaid),
        paidAt: body.paidAt ?? null,
        comment: body.comment ?? null,
      },
      auth.displayName
    );
    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "wp-shipment",
      item.id,
      `Сдача макулатуры №${item.number}: ${item.enterpriseName}, ${item.weightKg} кг`,
      { total: item.total, account: item.account }
    );
    return NextResponse.json({ success: true, item, enterpriseId });
  } catch (error) {
    console.error("WP shipment create error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
