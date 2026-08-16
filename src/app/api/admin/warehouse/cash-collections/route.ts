import { NextRequest, NextResponse } from "next/server";
import {
  collectCash,
  closeOldCashPayments,
  restoreClosedOldCashPayments,
  getCashCollections,
  getPendingCashPayments,
} from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    // ?pending=1 — ещё не отмеченные операции двух касс за сегодня и
    // незакрытые прошлые смены. Уже сохранённые даты остаются в истории.
    const { searchParams } = new URL(request.url);
    if (searchParams.get("pending")) {
      const cashData = await getPendingCashPayments();
      return NextResponse.json({
        pending: cashData.pending,
        closed: cashData.closed,
        expenses: cashData.expenses,
        dailySummaries: cashData.dailySummaries,
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

    // Откат ошибочного закрытия старой версии: возвращает наличный приход
    // в баланс и снова показывает его в списке настройки смены.
    if (body.action === "restore") {
      const ids = Array.isArray(body.paymentIds) ? body.paymentIds : [];
      const result = await restoreClosedOldCashPayments(ids);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "cash-collection",
        "cash-restore",
        `Возвращено ${result.restored} старых наличных платежей на ${result.amount} ₽`,
        result
      );
      return NextResponse.json({ success: true, ...result });
    }

    // action=close — только убрать старые платежи из списка сдачи.
    // Баланс и сами платежи новая версия не меняет.
    if (body.action === "close") {
      const ids = Array.isArray(body.paymentIds) ? body.paymentIds : [];
      const res = await closeOldCashPayments(ids, body.date || null);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "cash-collection",
        "cash-close",
        `Закрыто ${res.closed} наличных платежей за ${res.date} на ${res.amount} ₽ без перевода`,
        { closed: res.closed, amount: res.amount, date: res.date }
      );
      return NextResponse.json({ success: true, ...res });
    }

    // Закрытие смены лишь фиксирует, какие наличные и переводы на ЮМ
    // вошли в отчёт. Никаких новых переводов или списаний здесь нет.
    const items = Array.isArray(body.items)
      ? body.items
          .map((item: any) => ({
            paymentId: String(item?.paymentId || "").trim(),
          }))
          .filter((item: { paymentId: string }) => item.paymentId)
      : undefined;

    const result = await collectCash(
      body.note || null,
      items,
      body.date || null
    );

    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "cash-collection",
      "cash-collection",
      `Сохранена сводка за ${result.date}: наличные ${result.cashIncomeAmount} ₽, ЮМ ${result.transferAmount} ₽, без движений денег`,
      {
        date: result.date,
        incomeAmount: result.amount,
        cashIncomeAmount: result.cashIncomeAmount,
        ymIncomeAmount: result.transferAmount,
        closingBalance: result.cashAmount,
        accountingOnly: true,
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
