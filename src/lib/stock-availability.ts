// =========================================================
// FILE: src/lib/stock-availability.ts
// Единое правило «есть ли товар на складе» для всего сайта.
// Наличие определяется строго по фактическому остатку на складе
// (stockQty), без ручного переключателя «В наличии».
// =========================================================

export interface StockAvailabilityInput {
  inStock?: boolean | null;
  stockQty?: number | null;
}

/**
 * Доступное к заказу на сайте целое количество единиц со склада.
 * null / undefined / <= 0 / дробный остаток меньше 1 ед. → 0.
 */
export function getAvailableStockQty(product: StockAvailabilityInput): number {
  if (product.stockQty == null) return 0;
  const qty = Number(product.stockQty);
  if (!Number.isFinite(qty) || qty < 1) return 0;
  return Math.floor(qty);
}

/** Товар доступен к покупке со склада только при положительном остатке (≥ 1 шт.). */
export function isProductAvailable(product: StockAvailabilityInput): boolean {
  return getAvailableStockQty(product) > 0;
}

/** Товара нет на складе — покупка в корзину недоступна, доступен заказ поставки («Под заказ»). */
export function isOutOfStock(product: StockAvailabilityInput): boolean {
  return !isProductAvailable(product);
}

/** Подпись статуса для отсутствующего на складе товара. */
export const OUT_OF_STOCK_LABEL = "Нет в наличии";

/** Подпись пометки «Под заказ» для товара с нулевым остатком. */
export const OUT_OF_STOCK_ORDER_NOTE = "Под заказ · 2–3 дня";

/** Подпись кнопки заявки на поставку отсутствующего товара. */
export const RESTOCK_INQUIRY_LABEL = "Заказать поставку";
