// src/app/api/admin/wp/intakes/route.ts
// Отдельный учёт макулатуры: приёмы от клиентов (список, создание).
import { NextRequest, NextResponse } from "next/server";
import {
  createWpIntake,
  ensureWpBranch,
  ensureWpCounterparty,
  getWpIntakes,
  requireWastepaperApi,
} from "@/lib/wastepaper-account";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const items = await getWpIntakes(1000);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("WP intakes list error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    // Контрагент по желанию попадает в общий справочник, чтобы адрес/телефон
    // подтягивались при следующем приёме (флаг saveCounterparty). Новый адрес
    // существующего контрагента автоматически становится его точкой (филиалом).
    const branch = {
      address: body.address ? String(body.address) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      contactPerson: body.contactPerson ? String(body.contactPerson) : undefined,
      label: body.branchLabel ? String(body.branchLabel) : undefined,
    };
    let counterpartyId = body.counterpartyId || null;
    if (!counterpartyId && body.saveCounterparty && body.counterpartyName) {
      const saved = await ensureWpCounterparty(
        String(body.counterpartyName),
        "supplier",
        branch
      );
      counterpartyId = saved.id;
    } else if (counterpartyId && branch.address) {
      await ensureWpBranch(counterpartyId, branch);
    }
    const item = await createWpIntake(
      {
        date: String(body.date || ""),
        counterpartyId,
        counterpartyName: String(body.counterpartyName || ""),
        address: body.address ?? null,
        phone: body.phone ?? null,
        contactPerson: body.contactPerson ?? null,
        items: Array.isArray(body.items) ? body.items : undefined,
        wastepaperType: String(body.wastepaperType || "cardboard"),
        weightKg: Number(body.weightKg) || 0,
        pricePerKg: Number(body.pricePerKg) || 0,
        account: body.account === "bank" ? "bank" : "cash",
        isPaid: Boolean(body.isPaid),
        paidAt: body.paidAt ?? null,
        transportId: body.transportId || null,
        transportItemId: body.transportItemId || null,
        comment: body.comment ?? null,
      },
      auth.displayName
    );
    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "wp-intake",
      item.id,
      `Приём макулатуры №${item.number}: ${item.counterpartyName}, ${item.weightKg} кг`,
      { total: item.total, account: item.account }
    );
    return NextResponse.json({ success: true, item, counterpartyId });
  } catch (error) {
    console.error("WP intake create error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
