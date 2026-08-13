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
    // ?pending=1 — данные для фактической сводки смены. Только наличный
    // приход кассы, расходы и перенос; без банка, ЮМ и переводов.
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

    // Закрытие смены лишь фиксирует, какие наличные платежи вошли в отчёт.
    // Никаких направлений, переводов и ручных списаний здесь больше нет.
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
      `Сохранена сводка кассы за ${result.date}: приход ${result.amount} ₽, остаток ${result.cashAmount} ₽`,
      {
        date: result.date,
        incomeAmount: result.amount,
        closingBalance: result.cashAmount,
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
