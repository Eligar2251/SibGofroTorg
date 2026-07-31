// src/app/api/admin/client-requests/[id]/route.ts
// Ручные заявки клиентов (CRM): изменение и удаление.
import { NextRequest, NextResponse } from "next/server";
import {
  deleteClientRequest,
  getClientRequests,
  updateClientRequest,
} from "@/lib/supabase-queries";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";

const CONTACT_METHODS = [
  "call",
  "whatsapp",
  "telegram",
  "max",
  "email",
  "visit",
  "other",
];
const STATUSES = ["new", "in_progress", "completed", "rejected"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();

    const patch: Parameters<typeof updateClientRequest>[1] = {};

    // Смена статуса (с опциональным итогом/причиной закрытия)
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) {
        return NextResponse.json(
          { error: "Недопустимый статус" },
          { status: 400 }
        );
      }
      patch.status = body.status;
      // При любой смене статуса причину/итог заменяем новым
      // значением; если его не передали — очищаем.
      patch.closeReason =
        body.closeReason !== undefined
          ? String(body.closeReason || "").trim() || null
          : null;
    }

    // Редактирование содержимого заявки
    if (body.customerName !== undefined) {
      const v = String(body.customerName || "").trim();
      if (!v) {
        return NextResponse.json(
          { error: "Укажите имя клиента или название компании" },
          { status: 400 }
        );
      }
      patch.customerName = v;
    }
    if (body.subject !== undefined) {
      const v = String(body.subject || "").trim();
      if (!v) {
        return NextResponse.json(
          { error: "Укажите, что нужно клиенту" },
          { status: 400 }
        );
      }
      patch.subject = v;
    }
    if (body.customerPhone !== undefined) {
      patch.customerPhone = String(body.customerPhone || "").trim();
    }
    if (body.contactMethod !== undefined) {
      patch.contactMethod = CONTACT_METHODS.includes(body.contactMethod)
        ? body.contactMethod
        : "call";
    }
    if (body.comment !== undefined) {
      patch.comment = String(body.comment || "").trim();
    }

    await updateClientRequest(id, patch);

    const isStatusChange = body.status !== undefined;
    const label = isStatusChange
      ? `Заявка клиента #${id.slice(0, 8)}: статус → ${body.status}`
      : `Заявка клиента #${id.slice(0, 8)} отредактирована`;
    await logAdminAction(
      auth.displayName,
      auth.role,
      isStatusChange ? "status_change" : "update",
      "client-request",
      id,
      label,
      isStatusChange
        ? { newStatus: body.status, reason: patch.closeReason || undefined }
        : { edited: true }
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update client request error:", error);
    return NextResponse.json(
      { error: "Не удалось обновить заявку" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    // Подпись в лог — что именно удалили (до удаления)
    let label = `Заявка клиента #${id.slice(0, 8)}`;
    try {
      const found = await getClientRequests({ status: "all", limit: 1000 });
      const item = found.find((r) => r.id === id);
      if (item) {
        label = `Удалена заявка клиента: ${item.customerName} — «${item.subject.slice(0, 80)}»`;
      }
    } catch {
      /* безымянный лог тоже допустим */
    }
    await deleteClientRequest(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "client-request",
      id,
      label,
      { table: "client_requests", deleted: true }
    );
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("Delete client request error:", error);
    return NextResponse.json(
      { error: "Не удалось удалить заявку" },
      { status: 500 }
    );
  }
}
