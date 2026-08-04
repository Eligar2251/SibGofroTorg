// src/app/api/admin/wp/payments/route.ts
// Отдельный учёт макулатуры: ручные платежи (список, создание).
// Используются для движений денег, не привязанных к приёму/сдаче:
// например, полученные на предприятии деньги, внесённые позже.
import { NextRequest, NextResponse } from "next/server";
import {
  createWpManualPayment,
  getWpManualPayments,
  requireWastepaperApi,
} from "@/lib/wastepaper-account";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const items = await getWpManualPayments(1000);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("WP payments list error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const item = await createWpManualPayment(
      {
        date: String(body.date || ""),
        direction: body.direction === "outgoing" ? "outgoing" : "incoming",
        account: body.account === "bank" ? "bank" : "cash",
        counterpartyId: body.counterpartyId || null,
        counterpartyName: String(body.counterpartyName || ""),
        amount: Number(body.amount) || 0,
        isPaid: body.isPaid !== undefined ? Boolean(body.isPaid) : true,
        paidAt: body.paidAt ?? null,
        comment: body.comment ?? null,
      },
      auth.displayName
    );
    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "wp-payment",
      item.id,
      `Платёж макулатуры №${item.number}: ${
        item.direction === "incoming" ? "приход" : "расход"
      } ${item.amount} ₽ (${item.account === "cash" ? "наличка" : "безнал"})`,
      { direction: item.direction, amount: item.amount, account: item.account }
    );
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("WP payment create error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
