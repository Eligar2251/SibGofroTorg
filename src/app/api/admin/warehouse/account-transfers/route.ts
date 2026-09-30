import { NextRequest, NextResponse } from "next/server";
import { createAccountTransfer } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";
import type { BankAccountId } from "@/lib/warehouse-shared";

const ACCOUNTS: BankAccountId[] = ["cash", "bank", "ym_card", "vm_card"];

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const fromAccount = String(body.fromAccount || "") as BankAccountId;
    const toAccount = String(body.toAccount || "") as BankAccountId;
    if (!ACCOUNTS.includes(fromAccount) || !ACCOUNTS.includes(toAccount)) {
      return NextResponse.json({ error: "Выберите источник и получателя" }, { status: 400 });
    }
    const result = await createAccountTransfer({
      date: String(body.date || ""),
      fromAccount,
      toAccount,
      amount: Number(body.amount),
      comment: body.comment ?? null,
      createdBy: auth.displayName,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Create account transfer error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
