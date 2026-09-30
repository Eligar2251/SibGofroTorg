// =========================================================
// FILE: src/app/api/admin/money/adjustments/route.ts
// Прямая правка денежного счёта владельцем — без документов.
//
// Режимы:
//   set   — «сделать остаток равным N» (дельту считаем сами);
//   delta — «изменить на ±N».
// Факт правки уходит в журнал действий (entity_type = money-adjustment),
// который видят только владельцы.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { createMoneyAdjustment } from "@/lib/money-accounts";
import { getAccountBalance } from "@/lib/money-balances";
import { MONEY_ACCOUNT_IDS, type BankAccountId } from "@/lib/warehouse-shared";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_money")) {
    return noStoreJson({ error: "Недостаточно прав" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const account = String(body.account || "") as BankAccountId;
    if (!MONEY_ACCOUNT_IDS.includes(account)) {
      return noStoreJson({ error: "Неизвестный счёт" }, { status: 400 });
    }

    const mode = body.mode === "delta" ? "delta" : "set";
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) {
      return noStoreJson({ error: "Укажите сумму" }, { status: 400 });
    }
    if (Math.abs(amount) > 1_000_000_000) {
      return noStoreJson({ error: "Слишком большая сумма" }, { status: 400 });
    }

    const note = String(body.note || "").trim().slice(0, 300);
    const current = await getAccountBalance(account);
    const delta = round2(mode === "set" ? amount - current : amount);
    if (Math.abs(delta) < 0.01) {
      return noStoreJson(
        { error: "Остаток уже такой — менять нечего" },
        { status: 400 }
      );
    }

    const adjustment = await createMoneyAdjustment({
      account,
      delta,
      note,
      balanceAfter: round2(current + delta),
      adminName: auth.displayName,
      adminRole: auth.role,
      ipAddress: clientIp(request),
    });

    return noStoreJson({
      adjustment,
      balanceBefore: round2(current),
      balanceAfter: round2(current + delta),
    });
  } catch (error) {
    console.error("Money adjustment error:", error);
    return noStoreJson(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось изменить счёт. Проверьте, применена ли миграция money_adjustments.",
      },
      { status: 500 }
    );
  }
}
