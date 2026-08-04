// src/app/api/admin/wp/payments/[id]/route.ts
// Отдельный учёт макулатуры: ручные платежи (изменение, удаление).
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWpManualPayment,
  requireWastepaperApi,
  updateWpManualPayment,
} from "@/lib/wastepaper-account";
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
    const item = await updateWpManualPayment(id, {
      ...(body.date !== undefined ? { date: String(body.date) } : {}),
      ...(body.direction !== undefined
        ? { direction: body.direction === "outgoing" ? ("outgoing" as const) : ("incoming" as const) }
        : {}),
      ...(body.account !== undefined
        ? { account: body.account === "bank" ? ("bank" as const) : ("cash" as const) }
        : {}),
      ...(body.counterpartyId !== undefined ? { counterpartyId: body.counterpartyId } : {}),
      ...(body.counterpartyName !== undefined
        ? { counterpartyName: String(body.counterpartyName) }
        : {}),
      ...(body.amount !== undefined ? { amount: Number(body.amount) } : {}),
      ...(body.isPaid !== undefined ? { isPaid: Boolean(body.isPaid) } : {}),
      ...(body.paidAt !== undefined ? { paidAt: body.paidAt } : {}),
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "wp-payment",
      id,
      `Платёж макулатуры №${item.number}: ${item.amount} ₽`,
      {
        direction: item.direction,
        account: item.account,
        ...(body.isPaid !== undefined ? { isPaid: item.isPaid } : {}),
      }
    );
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("WP payment update error:", error);
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
    await deleteWpManualPayment(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "wp-payment",
      id,
      `Удалён платёж макулатуры #${id.slice(0, 8)}`
    );
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("WP payment delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
