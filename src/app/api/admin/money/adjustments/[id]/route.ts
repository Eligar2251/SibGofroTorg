// =========================================================
// FILE: src/app/api/admin/money/adjustments/[id]/route.ts
// Отмена прямой правки счёта владельцем: запись удаляется, деньги
// возвращаются к прежнему состоянию. Факт отмены остаётся в журнале.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { deleteMoneyAdjustment } from "@/lib/money-accounts";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_money")) {
    return noStoreJson({ error: "Недостаточно прав" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const removed = await deleteMoneyAdjustment(id, {
      adminName: auth.displayName,
      adminRole: auth.role,
      ipAddress: clientIp(request),
    });
    if (!removed) {
      return noStoreJson({ error: "Правка не найдена" }, { status: 404 });
    }
    return noStoreJson({ success: true, removed });
  } catch (error) {
    console.error("Money adjustment cancel error:", error);
    return noStoreJson({ error: "Не удалось отменить правку" }, { status: 500 });
  }
}
