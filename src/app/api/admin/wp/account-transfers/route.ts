// src/app/api/admin/wp/account-transfers/route.ts
// Учёт макулатуры: переводы денег между счетами модуля
// (безнал ↔ наличка ↔ сторонние). Внутреннее движение: внешний
// приход/расход не создаётся, двигаются только остатки счетов.
import { NextRequest, NextResponse } from "next/server";
import {
  createWpAccountTransfer,
  getWpAccountTransfers,
  requireWastepaperApi,
} from "@/lib/wastepaper-account";
import { WP_ACCOUNT_LABELS, type WpAccount } from "@/lib/wastepaper-account-shared";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ items: await getWpAccountTransfers(500) });
  } catch (error) {
    console.error("WP account transfers list error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const item = await createWpAccountTransfer(
      {
        date: String(body.date || ""),
        fromAccount: (body.fromAccount === "cash" || body.fromAccount === "third_party"
          ? body.fromAccount
          : "bank") as WpAccount,
        toAccount: (body.toAccount === "bank" || body.toAccount === "third_party"
          ? body.toAccount
          : "cash") as WpAccount,
        amount: Number(body.amount) || 0,
        comment: body.comment ?? null,
      },
      auth.displayName
    );
    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "wp-transfer",
      item.id,
      `Перевод №${item.number}: ${WP_ACCOUNT_LABELS[item.fromAccount]} → ${WP_ACCOUNT_LABELS[item.toAccount]}, ${item.amount} ₽`,
      { from: item.fromAccount, to: item.toAccount, amount: item.amount }
    );
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("WP account transfer create error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
