// src/app/api/admin/wp/shipments/route.ts
// Отдельный учёт макулатуры: сдачи на предприятие (список, создание).
import { NextRequest, NextResponse } from "next/server";
import {
  createWpShipment,
  ensureWpBranch,
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
    // Новый адрес предприятия автоматически становится его точкой (филиалом),
    // чтобы в следующий раз адрес/телефон подставлялись сами.
    const branch = {
      address: body.address ? String(body.address) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      contactPerson: body.contactPerson ? String(body.contactPerson) : undefined,
      label: body.branchLabel ? String(body.branchLabel) : undefined,
    };
    let enterpriseId = body.enterpriseId || null;
    if (!enterpriseId && body.saveCounterparty && body.enterpriseName) {
      const saved = await ensureWpCounterparty(
        String(body.enterpriseName),
        "enterprise",
        branch
      );
      enterpriseId = saved.id;
    } else if (enterpriseId && branch.address) {
      await ensureWpBranch(enterpriseId, branch);
    }
    const item = await createWpShipment(
      {
        date: String(body.date || ""),
        enterpriseId,
        enterpriseName: String(body.enterpriseName || ""),
        address: body.address ?? null,
        phone: body.phone ?? null,
        contactPerson: body.contactPerson ?? null,
        items: Array.isArray(body.items) ? body.items : undefined,
        wastepaperType: String(body.wastepaperType || "cardboard"),
        weightKg: Number(body.weightKg) || 0,
        // Фактические веса и деньги из формы сдачи — без них поля
        // «Отгружено / Принято / Поступление» не сохранялись при создании.
        shippedWeightKg: Number(body.shippedWeightKg) || 0,
        acceptedWeightKg: Number(body.acceptedWeightKg) || 0,
        receivedAmount: Number(body.receivedAmount) || 0,
        pricePerKg: Number(body.pricePerKg) || 0,
        account: body.account === "cash" ? "cash" : "bank",
        isPaid: Boolean(body.isPaid),
        paidAt: body.paidAt ?? null,
        needsTransport: body.needsTransport === true,
        transportPlannedDate: body.transportPlannedDate ?? null,
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
