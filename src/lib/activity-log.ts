// =========================================================
// FILE: src/lib/activity-log.ts
// Логирование действий администраторов
// =========================================================

import { getAdminDb } from "./supabase";

export type ActionType =
  | "create"
  | "update"
  | "delete"
  | "status_change"
  | "issue"
  | "post"
  | "cancel"
  | "login"
  | "logout"
  | "export"
  | "bulk_update"
  | "bulk_delete";

export type EntityType =
  | "order"
  | "deal"
  | "payment"
  | "receipt"
  | "product"
  | "transport"
  | "delivery"
  | "settings"
  | "category"
  | "review"
  | "counterparty"
  | "salary"
  | "admin-user"
  | "cash-collection"
  | "purchase-plan"
  | "client-request"
  | "wp-intake"
  | "wp-shipment"
  | "wp-payment"
  | "wp-transport"
  | "wp-counterparty"
  | "rent-org"
  | "rent-tenant"
  | "rent-invoice"
  | "rent-payment";

interface LogEntry {
  adminId?: string;
  adminName: string;
  adminRole: string;
  action: ActionType;
  entityType: EntityType;
  entityId?: string;
  entityLabel?: string;
  details?: Record<string, any>;
  ipAddress?: string;
}

/**
 * Записать действие в лог.
 * Не бросает ошибки — молча логирует в консоль при сбое.
 */
export async function logActivity(entry: LogEntry): Promise<void> {
  try {
    const db = getAdminDb();
    await db.from("activity_logs").insert({
      admin_id: entry.adminId || null,
      admin_name: entry.adminName || "Система",
      admin_role: entry.adminRole || "system",
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId || "",
      entity_label: entry.entityLabel || "",
      details: entry.details || {},
      ip_address: entry.ipAddress || "",
    });
  } catch (error) {
    console.error("Activity log error:", error);
  }
}

/**
 * Вспомогательная функция: логирование с контекстом администратора.
 * Используется в API-маршрутах после requireAdminApi().
 */
export async function logAdminAction(
  adminName: string,
  adminRole: string,
  action: ActionType,
  entityType: EntityType,
  entityId: string,
  entityLabel: string,
  details?: Record<string, any>
): Promise<void> {
  await logActivity({
    adminName,
    adminRole,
    action,
    entityType,
    entityId,
    entityLabel,
    details,
  });
}

/**
 * Хелпер: получить имя и роль админа из сессии.
 * Возвращает объект для передачи в logAdminAction.
 */
export function getAdminContext(session: { username?: string; role?: string; display_name?: string } | null) {
  return {
    name: session?.display_name || session?.username || "Неизвестно",
    role: session?.role || "admin",
  };
}
