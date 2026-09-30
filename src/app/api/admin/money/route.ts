// =========================================================
// FILE: src/app/api/admin/money/route.ts
// Денежные счета владельца: текущие остатки + журнал прямых правок.
// Доступ — только роль owner (hasPermission "view_money").
// =========================================================

import { NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { getMoneyAdjustments } from "@/lib/money-accounts";
import { loadMoneyBalances } from "@/lib/money-balances";
import {
  BANK_ACCOUNT_LABELS,
  MONEY_ACCOUNT_IDS,
} from "@/lib/warehouse-shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "view_money")) {
    return noStoreJson({ error: "Недостаточно прав" }, { status: 403 });
  }

  try {
    const [summary, adjustments] = await Promise.all([
      loadMoneyBalances(),
      getMoneyAdjustments(),
    ]);

    const balanceByAccount: Record<string, number> = {
      cash: summary.cashBalance,
      bank: summary.bankBalance,
      ym_card: summary.ymCardBalance,
      vm_card: summary.vmCardBalance,
    };
    const forecastByAccount: Record<string, number> = {
      cash: summary.cashBalance,
      bank: summary.bankForecast,
      ym_card: summary.ymForecast,
      vm_card: summary.vmForecast,
    };

    return noStoreJson({
      accounts: MONEY_ACCOUNT_IDS.map((id) => ({
        id,
        label: BANK_ACCOUNT_LABELS[id],
        balance: Math.round(balanceByAccount[id] * 100) / 100,
        forecast: Math.round(forecastByAccount[id] * 100) / 100,
        negative: balanceByAccount[id] < -0.009,
      })),
      total: Math.round(summary.balance * 100) / 100,
      adjustments,
    });
  } catch (error) {
    console.error("Owner money balance error:", error);
    return noStoreJson({ error: "Не удалось посчитать остатки" }, { status: 500 });
  }
}
