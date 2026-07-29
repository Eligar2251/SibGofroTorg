import { NextRequest, NextResponse } from "next/server";
import {
  collectCash,
  closeOldCashPayments,
  getCashCollections,
  getPendingCashPayments,
  normalizeCashKind,
} from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";
import { getSettings } from "@/lib/supabase-queries";
import {
  CASH_CARD_HOLDER_SETTING_KEY,
  DEFAULT_CASH_CARD_HOLDER,
} from "@/lib/warehouse-shared";
import { logAdminAction } from "@/lib/activity-log";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    // ?pending=1 — наличные поступления кассы, ещё не вошедшие в сдачу.
    // Безналичные платежи расчётного счёта сюда не попадают.
    // При сдаче их размечают: «на карту (инкассация)» или «наличными».
    const { searchParams } = new URL(request.url);
    if (searchParams.get("pending")) {
      const [cashData, settings] = await Promise.all([
        getPendingCashPayments(),
        getSettings().catch(() => ({} as Record<string, string>)),
      ]);
      // Имя получателя инкассации на карту настраивается в «Настройках».
      const cardHolder =
        String(settings[CASH_CARD_HOLDER_SETTING_KEY] || "").trim() ||
        DEFAULT_CASH_CARD_HOLDER;
      return NextResponse.json({
        pending: cashData.pending,
        // Наличные траты (ЗП и прочее): уменьшают сумму к сдаче.
        expenses: cashData.expenses,
        cardHolder,
      });
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

    // action=close — закрыть старые наличные платежи без инкассации.
    // Нужно, когда инкассация ведётся с определённой даты, а в кассе
    // висят более ранние платежи: сдавать их не надо, надо убрать.
    if (body.action === "close") {
      const ids = Array.isArray(body.paymentIds) ? body.paymentIds : [];
      const res = await closeOldCashPayments(ids);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "cash-collection",
        "cash-close",
        `Закрыто ${res.closed} наличных платежей на ${res.amount} ₽ без инкассации`,
        { closed: res.closed, amount: res.amount }
      );
      return NextResponse.json({ success: true, ...res });
    }

    // Разметка платежей: [{ paymentId, kind: "card" | "cash" }]
    // "card" — инкассация на карту, "cash" — оставить в кассе на следующий день.
    const items = Array.isArray(body.items)
      ? body.items
          .map((it: any) => ({
            paymentId: String(it?.paymentId || "").trim(),
            kind: normalizeCashKind(it?.kind),
            // Ручная разбивка платежа: наличка / карта / расход.
            // Суммы проверяются на сервере против суммы платежа.
            cashAmount:
              it?.cashAmount != null ? Number(it.cashAmount) : undefined,
            cardAmount:
              it?.cardAmount != null ? Number(it.cardAmount) : undefined,
            expenseAmount:
              it?.expenseAmount != null ? Number(it.expenseAmount) : undefined,
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
      `Закрыта смена на ${result.amount} ₽ (оставлено в кассе ${result.cashAmount} ₽, на карту ${result.transferAmount} ₽)`,
      {
        amount: result.amount,
        cashAmount: result.cashAmount,
        cardAmount: result.transferAmount,
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
