// src/app/api/admin/wp/transports/[id]/route.ts
// Отдельный учёт макулатуры: перевозки (правки, статусы, оформление
// приёмов по забранным остановкам, удаление).
import { NextRequest, NextResponse } from "next/server";
import {
  createWpIntakesFromTransport,
  deleteWpTransport,
  requireWastepaperApi,
  setWpTransportStatus,
  updateWpTransport,
} from "@/lib/wastepaper-account";
import { WP_TRANSPORT_STATUS_LABELS } from "@/lib/wastepaper-account-shared";
import type { WpTransportStatus } from "@/lib/wastepaper-account-shared";
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

    // Спец-действие: оформить приёмы по остановкам «Забрано».
    if (body.action === "create_intakes") {
      const result = await createWpIntakesFromTransport(id, auth.displayName);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "create",
        "wp-intake",
        id,
        `По перевозке оформлено приёмов: ${result.created}`
      );
      return NextResponse.json({ success: true, created: result.created });
    }

    // Спец-действие: смена статуса перевозки («В пути», «Завершена», «Отменена»).
    if (body.action === "status" || (body.status && body.items === undefined)) {
      const status = String(body.status || "") as WpTransportStatus;
      if (!(status in WP_TRANSPORT_STATUS_LABELS)) {
        return NextResponse.json({ error: "Недопустимый статус" }, { status: 400 });
      }
      await setWpTransportStatus(id, status);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "status_change",
        "wp-transport",
        id,
        `Перевозка макулатуры: статус «${WP_TRANSPORT_STATUS_LABELS[status]}»`
      );
      return NextResponse.json({ success: true });
    }

    // Обычное редактирование (в т.ч. быстрые правки остановок после ЧП).
    const item = await updateWpTransport(id, {
      date: String(body.date || ""),
      startTime: body.startTime ?? null,
      driverName: body.driverName ?? null,
      driverPhone: body.driverPhone ?? null,
      vehicle: body.vehicle ?? null,
      note: body.note ?? null,
      items: Array.isArray(body.items) ? body.items : [],
      ...(body.status !== undefined ? { status: body.status } : {}),
    });
    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "wp-transport",
      id,
      `Перевозка ТМ-${item.number} на ${item.date}, остановок: ${item.items.length}`,
      { totalPlannedKg: item.totalPlannedKg, status: item.status }
    );
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("WP transport update error:", error);
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
    await deleteWpTransport(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "wp-transport",
      id,
      `Удалена перевозка макулатуры #${id.slice(0, 8)}`
    );
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("WP transport delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
