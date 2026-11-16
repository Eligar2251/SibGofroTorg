// =========================================================
// FILE: src/lib/product-service.ts
// Формат позиции: ТОВАР или УСЛУГА.
//
// Услуга (резка, доставка, упаковка, нанесение логотипа, аренда ...) — это
// строка учёта с ценой, но НЕ складская позиция:
//   • остаток не заводится и не меняется (ни поставкой, ни отгрузкой);
//   • не участвует в резерве, инвентаризации и «остатках» на складе;
//   • не публикуется на сайте (is_visible = false), карточка остаётся
//     внутренней — её дозаполняют позже;
//   • при быстром создании из документа (поставка/заказ) размеры не нужны.
//
// Хранится одним флагом products.is_service (см.
// supabase/migration_product_services.sql) — по той же схеме, что и
// is_cuttable/made_to_order: старый код без миграции продолжает работать,
// просто флаг считается false.
// =========================================================

export const PRODUCT_KIND_GOODS = "goods" as const;
export const PRODUCT_KIND_SERVICE = "service" as const;

export type ProductKind = typeof PRODUCT_KIND_GOODS | typeof PRODUCT_KIND_SERVICE;

/** Флаг читаем из строки («on», "true", "1"), числа и boolean — везде одно правило. */
export function normalizeServiceFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "on" || v === "yes" || v === "услуга";
  }
  return false;
}

export function productKind(product: { isService?: unknown } | null | undefined): ProductKind {
  return normalizeServiceFlag(product?.isService) ? PRODUCT_KIND_SERVICE : PRODUCT_KIND_GOODS;
}

export function isServiceProduct(product: { isService?: unknown } | null | undefined): boolean {
  return productKind(product) === PRODUCT_KIND_SERVICE;
}

export function productKindLabel(product: { isService?: unknown } | null | undefined): string {
  return isServiceProduct(product) ? "Услуга" : "Товар";
}

/** Товары, которые двигают склад (услуги — нет). */
export function stockAffectingItemIds(
  items: Array<{ productId?: unknown } | null | undefined>,
  serviceIds: Iterable<string>
): string[] {
  const services = serviceIds instanceof Set ? serviceIds : new Set(serviceIds);
  const out: string[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.productId || "").trim();
    if (!id || services.has(id)) continue;
    out.push(id);
  }
  return out;
}

/** Только складские позиции из списка документов (для applyStockDelta и т.п.). */
export function filterStockAffectingItems<T extends { productId?: unknown }>(
  items: T[],
  serviceIds: Iterable<string>
): T[] {
  const services = serviceIds instanceof Set ? serviceIds : new Set(serviceIds);
  return (Array.isArray(items) ? items : []).filter((item) => {
    const id = String(item?.productId || "").trim();
    return Boolean(id) && !services.has(id);
  });
}

// ─── Быстрое создание позиции из окна поставки / заказа ───

export const QUICK_NAME_MAX = 200;

export interface QuickProductDraft {
  name?: unknown;
  price?: unknown;
  quantity?: unknown;
  isService?: unknown;
}

export interface QuickProductPayload {
  name: string;
  price: number | null;
  isService: boolean;
  /** Количество в позиции документа — не остаток! Остаток всегда 0. */
  quantity: number;
  /** Карточка-черновик: на сайт не публикуем, склад не трогаем. */
  isVisible: false;
  stockQty: 0;
  note: string;
}

/** Ключ поиска «такой же позиции уже есть» — как в ensureCounterparty. */
export function quickNameKey(name: unknown): string {
  return String(name ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/ё/g, "е")
    .replace(/Ё/g, "Е")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Нормализация черновика. Возвращает { error } вместо исключения — маршрут
 * отдаёт понятный текст прямо в форму пикера.
 */
export function buildQuickProduct(draft: QuickProductDraft): {
  payload: QuickProductPayload;
  error: string | null;
} {
  const name = String(draft.name ?? "").replace(/\s+/g, " ").trim().slice(0, QUICK_NAME_MAX);
  const isService = normalizeServiceFlag(draft.isService);
  const price = cleanNumber(draft.price);
  const rawQty = cleanNumber(draft.quantity);
  // Пустое, нулевое или отрицательное количество в документе бессмысленно
  // (строка с нулём всё равно отфильтровывается) — считаем одной единицей.
  const quantity =
    rawQty == null || !(rawQty > 0) ? 1 : Math.min(100_000, Math.round(rawQty * 1000) / 1000);

  if (!name) {
    return { payload: {} as QuickProductPayload, error: "Укажите название позиции" };
  }
  if (name.length < 2) {
    return { payload: {} as QuickProductPayload, error: "Название слишком короткое" };
  }
  if (price != null && price < 0) {
    return { payload: {} as QuickProductPayload, error: "Цена не может быть отрицательной" };
  }

  return {
    payload: {
      name,
      price: price != null ? Math.round(price * 100) / 100 : null,
      isService,
      quantity,
      isVisible: false,
      stockQty: 0,
      note: isService
        ? "Создано из документа учёта (услуга). Остаток на складе не ведётся."
        : "Создано из документа учёта. Заполните размеры и артикул в карточке.",
    },
    error: null,
  };
}

/** Позиция документа для строки поставки/заказа по созданной карточке. */
export function quickDocumentLine(payload: QuickProductPayload): {
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
} {
  const price = payload.price ?? 0;
  const quantity = payload.quantity > 0 ? payload.quantity : 1;
  return {
    name: payload.name,
    price,
    quantity,
    lineTotal: Math.round(price * quantity * 100) / 100,
  };
}
