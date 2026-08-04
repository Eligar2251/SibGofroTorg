// src/app/api/admin/wp/intakes/[id]/route.ts
// Отдельный учёт макулатуры: приёмы (изменение, оплата, отмена, удаление).
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWpIntake,
  requireWastepaperApi,
  setWpIntakeCancelled,
  updateWpIntake,
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

    // Спец-действия: отмена / восстановление приёма.
    if (body.action === "cancel" || body.action === "restore") {
      const cancelled = body.action === "cancel";
      await setWpIntakeCancelled(id, cancelled);
      await logAdminAction(
        auth.displayName,
        auth.role,
        cancelled ? "cancel" : "update",
        "wp-intake",
        id,
        `${cancelled ? "Отменён" : "Восстановлен"} приём макулатуры #${id.slice(0, 8)}`
      );
      return NextResponse.json({ success: true });
    }

    // Быстрое переключение «оплачен» без остальных полей.
    const item = await updateWpIntake(id, {
      ...(body.date !== undefined ? { date: String(body.date) } : {}),
      ...(body.counterpartyId !== undefined ? { counterpartyId: body.counterpartyId } : {}),
      ...(body.counterpartyName !== undefined
        ? { counterpartyName: String(body.counterpartyName) }
        : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.wastepaperType !== undefined
        ? { wastepaperType: String(body.wastepaperType) }
        : {}),
      ...(body.weightKg !== undefined ? { weightKg: Number(body.weightKg) } : {}),
      ...(body.pricePerKg !== undefined ? { pricePerKg: Number(body.pricePerKg) } : {}),
      ...(body.account !== undefined
        ? { account: body.account === "bank" ? ("bank" as const) : ("cash" as const) }
        : {}),
      ...(body.isPaid !== undefined ? { isPaid: Boolean(body.isPaid) } : {}),
      ...(body.paidAt !== undefined ? { paidAt: body.paidAt } : {}),
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "wp-intake",
      id,
      `Приём макулатуры №${item.number}: ${item.counterpartyName}, ${item.weightKg} кг`,
      {
        total: item.total,
        account: item.account,
        ...(body.isPaid !== undefined ? { isPaid: item.isPaid } : {}),
      }
    );
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("WP intake update error:", error);
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
    await deleteWpIntake(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "wp-intake",
      id,
      `Удалён приём макулатуры #${id.slice(0, 8)}`
    );
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("WP intake delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
