import { NextRequest, NextResponse } from "next/server";
import {
  collectCash,
  getCashCollections,
  getPendingCashPayments,
} from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    // ?pending=1 — наличные поступления, ещё не вошедшие в сдачу:
    // их размечают на «наличные / перевод» в момент сдачи кассы.
    const { searchParams } = new URL(request.url);
    if (searchParams.get("pending")) {
      const pending = await getPendingCashPayments();
      return NextResponse.json({ pending });
    }
    const collections = await getCashCollections();
    return NextResponse.json({ collections });
  } catch (error: any) {
    console.error("Get cash collections error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json().catch(() => ({}));

    // Разметка платежей: [{ paymentId, kind: "cash" | "transfer" }]
    const items = Array.isArray(body.items)
      ? body.items
          .map((it: any) => ({
            paymentId: String(it?.paymentId || "").trim(),
            kind: it?.kind === "transfer" ? ("transfer" as const) : ("cash" as const),
          }))
          .filter((it: { paymentId: string }) => it.paymentId)
      : undefined;

    const result = await collectCash(body.note || null, items);

    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "cash-collection",
      "cash-collection",
      `Сдана касса на ${result.amount} ₽ (наличными ${result.cashAmount} ₽, переводом ${result.transferAmount} ₽)`,
      {
        amount: result.amount,
        cashAmount: result.cashAmount,
        transferAmount: result.transferAmount,
      }
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("Collect cash error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
