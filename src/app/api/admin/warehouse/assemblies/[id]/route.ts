// =========================================================
// FILE: src/app/api/admin/warehouse/assemblies/[id]/route.ts
// Отмена проведения (сторно) и удаление документа комплектации КМП-….
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import {
  cancelWarehouseAssembly,
  deleteWarehouseAssembly,
} from "@/lib/warehouse-assembly-store";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body?.action && body.action !== "cancel") {
      return NextResponse.json(
        { error: "Неизвестное действие" },
        { status: 400 }
      );
    }

    const updated = await cancelWarehouseAssembly(id);

    await logActivity({
      adminName: auth.displayName || auth.username || "Администратор",
      adminRole: auth.role || "admin",
      action: "cancel",
      entityType: "assembly",
      entityId: updated.id,
      entityLabel: `Отменена комплектация КМП-${updated.number} (остатки возвращены)`,
      details: {
        number: updated.number,
        spentItems: updated.spentItems,
        producedItems: updated.producedItems,
      },
    });

    return NextResponse.json({ ok: true, assembly: updated });
  } catch (e: any) {
    console.error("[warehouse/assemblies PATCH]", e);
    return NextResponse.json(
      { error: e?.message || "Ошибка отмены комплектации" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    await deleteWarehouseAssembly(id);

    await logActivity({
      adminName: auth.displayName || auth.username || "Администратор",
      adminRole: auth.role || "admin",
      action: "delete",
      entityType: "assembly",
      entityId: id,
      entityLabel: `Удалён документ комплектации (${id})`,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[warehouse/assemblies DELETE]", e);
    return NextResponse.json(
      { error: e?.message || "Ошибка удаления комплектации" },
      { status: 400 }
    );
  }
}
