// src/app/api/admin/wp/account-transfers/[id]/route.ts
// Учёт макулатуры: правка и удаление перевода между счетами.
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWpAccountTransfer,
  requireWastepaperApi,
  updateWpAccountTransfer,
} from "@/lib/wastepaper-account";
import { WP_ACCOUNT_LABELS, type WpAccount } from "@/lib/wastepaper-account-shared";
import { logAdminAction } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const item = await updateWpAccountTransfer(id, {
      ...(body.date !== undefined ? { date: String(body.date) } : {}),
      ...(body.fromAccount !== undefined
        ? { fromAccount: String(body.fromAccount) as WpAccount }
        : {}),
      ...(body.toAccount !== undefined
        ? { toAccount: String(body.toAccount) as WpAccount }
        : {}),
      ...(body.amount !== undefined ? { amount: Number(body.amount) } : {}),
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "wp-transfer",
      id,
      `Перевод №${item.number}: ${WP_ACCOUNT_LABELS[item.fromAccount]} → ${WP_ACCOUNT_LABELS[item.toAccount]}, ${item.amount} ₽`,
      { from: item.fromAccount, to: item.toAccount, amount: item.amount }
    );
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("WP account transfer update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireWastepaperApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteWpAccountTransfer(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "wp-transfer",
      id,
      `Удалён перевод между счетами #${id.slice(0, 8)}`
    );
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("WP account transfer delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
