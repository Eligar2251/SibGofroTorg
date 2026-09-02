// =========================================================
// FILE: src/app/api/admin/user-orders/[id]/route.ts
// Ручное вмешательство менеджера в заявку конкретного клиента:
// правка состава (PATCH) и удаление (DELETE).
//
// Статус здесь намеренно НЕ меняется: для этого уже есть
// /api/admin/orders/[id] (со всей логикой связи с учётом) и
// /api/admin/issue/[id] (выдача). Дублировать их означало бы завести
// второй путь смены статуса в обход проверок связки с заказом ЗК.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, hasPermission } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";
import { deleteOrder } from "@/lib/supabase-queries";
import { reviseWebsiteOrderByManager } from "@/lib/warehouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  try {
    const body = await request.json();
    const result = await reviseWebsiteOrderByManager(id, {
      items: Array.isArray(body.items) ? body.items : [],
      comment: body.comment ?? null,
    });

    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "order",
      id,
      `Состав заявки #${id.slice(0, 8)} изменён вручную из кабинета клиента`,
      { totalSum: result.totalSum }
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Admin cabinet order update error:", error);
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
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "delete")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const result = await deleteOrder(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "order",
      id,
      result.deleted
        ? `Удалена заявка #${id.slice(0, 8)} из кабинета клиента`
        : `Заявка #${id.slice(0, 8)} уже отсутствовала в базе`,
      result
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Admin cabinet order delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 500 }
    );
  }
}
