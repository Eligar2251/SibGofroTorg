// src/app/api/admin/wp/shipments/[id]/route.ts
// Отдельный учёт макулатуры: сдачи (изменение, оплата, отмена, удаление).
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWpShipment,
  requireWastepaperApi,
  setWpShipmentCancelled,
  updateWpShipment,
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

    if (body.action === "cancel" || body.action === "restore") {
      const cancelled = body.action === "cancel";
      await setWpShipmentCancelled(id, cancelled);
      await logAdminAction(
        auth.displayName,
        auth.role,
        cancelled ? "cancel" : "update",
        "wp-shipment",
        id,
        `${cancelled ? "Отменена" : "Восстановлена"} сдача макулатуры #${id.slice(0, 8)}`
      );
      return NextResponse.json({ success: true });
    }

    const item = await updateWpShipment(id, {
      ...(body.date !== undefined ? { date: String(body.date) } : {}),
      ...(body.enterpriseId !== undefined ? { enterpriseId: body.enterpriseId } : {}),
      ...(body.enterpriseName !== undefined
        ? { enterpriseName: String(body.enterpriseName) }
        : {}),
      ...(body.wastepaperType !== undefined
        ? { wastepaperType: String(body.wastepaperType) }
        : {}),
      ...(body.weightKg !== undefined ? { weightKg: Number(body.weightKg) } : {}),
      ...(body.pricePerKg !== undefined ? { pricePerKg: Number(body.pricePerKg) } : {}),
      ...(body.account !== undefined
        ? { account: body.account === "cash" ? ("cash" as const) : ("bank" as const) }
        : {}),
      ...(body.isPaid !== undefined ? { isPaid: Boolean(body.isPaid) } : {}),
      ...(body.paidAt !== undefined ? { paidAt: body.paidAt } : {}),
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "wp-shipment",
      id,
      `Сдача макулатуры №${item.number}: ${item.enterpriseName}, ${item.weightKg} кг`,
      {
        total: item.total,
        account: item.account,
        ...(body.isPaid !== undefined ? { isPaid: item.isPaid } : {}),
      }
    );
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("WP shipment update error:", error);
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
    await deleteWpShipment(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "wp-shipment",
      id,
      `Удалена сдача макулатуры #${id.slice(0, 8)}`
    );
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("WP shipment delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
