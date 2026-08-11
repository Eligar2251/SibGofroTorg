// =========================================================
// FILE: src/lib/orders-sort.ts
// Варианты сортировки списка заявок. Живут в серверном модуле
// (без "use client"), потому что их читает и серверная страница
// (?sort=...), и клиентский селект. Импорт констант из
// "use client"-компонента в серверный даёт client-reference,
// у которого нет методов массива (ORDER_SORT_OPTIONS.some —
// не функция).
// =========================================================

export const ORDER_SORT_OPTIONS = [
  { value: "date_desc", label: "Сначала новые" },
  { value: "date_asc", label: "Сначала старые" },
  { value: "sum_desc", label: "Сумма: по убыванию" },
  { value: "sum_asc", label: "Сумма: по возрастанию" },
  { value: "name_asc", label: "Клиент: А → Я" },
] as const;

export type OrderSortId = (typeof ORDER_SORT_OPTIONS)[number]["value"];

export const DEFAULT_ORDER_SORT: OrderSortId = "date_desc";

export function isOrderSortId(value: string): value is OrderSortId {
  return ORDER_SORT_OPTIONS.some((o) => o.value === value);
}
