// =========================================================
// FILE: src/lib/order-status.ts
// Единый справочник статусов заявки.
//
// Важно, что он один: в админке нужно видеть НЕ ТОЛЬКО свой служебный
// статус, но и ровно тот текст, который в этот момент видит клиент в
// личном кабинете. Раньше эти подписи жили в двух местах (кабинет и
// админка) и могли разойтись — тогда менеджер говорит клиенту одно,
// а тот видит у себя другое.
// =========================================================

export const ORDER_STATUSES = [
  "new",
  "in_progress",
  "ready",
  "issued",
  "completed",
  "rejected",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Что видит КЛИЕНТ в личном кабинете. */
export const CLIENT_STATUS_LABELS: Record<string, string> = {
  new: "В обработке",
  in_progress: "Сборка заказа",
  ready: "Готов к выдаче",
  issued: "Выдан",
  completed: "Выполнен",
  rejected: "Отменён",
};

/** Что видит МЕНЕДЖЕР в админке. */
export const ADMIN_STATUS_LABELS: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  ready: "Готов к выдаче",
  issued: "Выдан",
  completed: "Проведена",
  rejected: "Отменена",
};

/** CSS-класс бейджа админки под статус. */
export const ADMIN_STATUS_BADGE: Record<string, string> = {
  new: "admin-badge admin-badge--amber",
  in_progress: "admin-badge admin-badge--blue",
  ready: "admin-badge admin-badge--indigo",
  issued: "admin-badge admin-badge--teal",
  completed: "admin-badge admin-badge--green",
  rejected: "admin-badge admin-badge--red",
};

export function clientStatusLabel(status: string | null | undefined): string {
  return CLIENT_STATUS_LABELS[String(status || "new")] || "В обработке";
}

export function adminStatusLabel(status: string | null | undefined): string {
  return ADMIN_STATUS_LABELS[String(status || "new")] || "Новая";
}

export function adminStatusBadge(status: string | null | undefined): string {
  return (
    ADMIN_STATUS_BADGE[String(status || "new")] || "admin-badge admin-badge--amber"
  );
}

/** Статусы заявки на макулатуру — там свой, более короткий набор. */
export const WASTEPAPER_STATUS_LABELS: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Выполнена",
  rejected: "Отменена",
};
