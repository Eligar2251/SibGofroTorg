// =========================================================
// FILE: src/lib/orders-labels.ts
// Общие подписи/тона статусов заявок для ДЕСКТОПНОЙ таблицы
// (orders/page.tsx) и мобильных карточек (orders/OrdersMobile.tsx).
// До разделения слоёв константы жили в page.tsx и не были доступны
// клиентскому мобильному компоненту без дублирования.
// =========================================================

/** Подпись статуса заявки (ru). */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  ready: "Готов к выдаче",
  issued: "Выдан",
  completed: "Проведена",
  rejected: "Отменена",
  // Фильтр-агрегат: заявки, с которыми менеджеры сейчас работают.
  active: "Активные",
};

/** Тон статуса — одинаков и для admin-badge, и для мобильных чипов. */
export type OrderStatusTone =
  | "amber"
  | "blue"
  | "indigo"
  | "teal"
  | "green"
  | "red";

export const ORDER_STATUS_TONE: Record<string, OrderStatusTone> = {
  new: "amber",
  in_progress: "blue",
  ready: "indigo",
  issued: "teal",
  completed: "green",
  rejected: "red",
  active: "blue",
};

/** Значок и подпись типа заявки. */
export function orderTypeMeta(order: {
  type?: string | null;
}): { label: string; icon: string; tone: OrderStatusTone } {
  if (order.type === "wastepaper") {
    return { label: "За макулатуру", icon: "recycle", tone: "green" };
  }
  if (order.type === "order") {
    return { label: "Заявка-заказ", icon: "box", tone: "indigo" };
  }
  return { label: "На уточнение", icon: "chat", tone: "teal" };
}

export const ORDER_COMM_LABELS: Record<
  string,
  { token: string; text: string }
> = {
  call: { token: "phone", text: "Звонок" },
  whatsapp: { token: "chat", text: "WhatsApp" },
  telegram: { token: "send", text: "Telegram" },
  max: { token: "chats", text: "Макс" },
  email: { token: "mail", text: "Почта" },
  self: { token: "truck", text: "Привезут сами" },
  pickup: { token: "truck", text: "Нужен вывоз" },
};

export const ORDER_PAYMENT_LABELS: Record<
  string,
  { token: string; text: string }
> = {
  transfer: { token: "card", text: "Перевод" },
  cash: { token: "cash", text: "Наличные" },
  invoice: { token: "receipt", text: "Счёт" },
};

export const ORDER_FILTER_OPTIONS = [
  { value: "active", label: "Активные" },
  { value: "new", label: "Новые" },
  { value: "in_progress", label: "В работе" },
  { value: "ready", label: "Готов к выдаче" },
  { value: "issued", label: "Выданные" },
  { value: "completed", label: "Проведённые" },
  { value: "rejected", label: "Отменённые" },
  { value: "all", label: "Все" },
];

/** Дата заявки в человекочитаемом виде (dd.MM.yyyy HH:mm). */
export function formatOrderDate(raw: unknown): string {
  if (!raw) return "—";
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  if (typeof raw === "number") return new Date(raw).toLocaleString("ru-RU");
  if (
    typeof raw === "object" &&
    raw !== null &&
    "seconds" in (raw as Record<string, unknown>)
  ) {
    const seconds = Number((raw as { seconds: number }).seconds);
    if (!isNaN(seconds)) return new Date(seconds * 1000).toLocaleString("ru-RU");
  }
  return "—";
}

/** createdAt → мс, для сортировки. */
export function orderCreatedMs(raw: unknown): number {
  if (!raw) return 0;
  if (typeof raw === "string") return Date.parse(raw) || 0;
  if (typeof raw === "number") return raw;
  if (
    typeof raw === "object" &&
    raw !== null &&
    "seconds" in (raw as Record<string, unknown>)
  ) {
    return Number((raw as { seconds: number }).seconds) * 1000;
  }
  return 0;
}
