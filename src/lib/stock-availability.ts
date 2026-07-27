// =========================================================
// FILE: src/lib/stock-availability.ts
// =========================================================
// Единое правило «есть ли товар на складе» для всего сайта.
//
// Товара нет в наличии, если снят флаг «в наличии» ИЛИ остаток на складе
// нулевой/отрицательный. В этом случае на витрине цена не показывается:
// вместо неё выводится «Нет в наличии» и кнопка «Уточнить поступление»,
// которая создаёт обычную автозаявку (тот же поток, что и «Узнать цену»).

export interface StockAvailabilityInput {
  inStock?: boolean | null;
  stockQty?: number | null;
}

/** Товар доступен к покупке: флаг «в наличии» и положительный остаток. */
export function isProductAvailable(product: StockAvailabilityInput): boolean {
  if (product.inStock === false) return false;
  // stockQty === null означает «остаток не ведётся» — доверяем флагу inStock.
  if (product.stockQty != null && Number(product.stockQty) <= 0) return false;
  return true;
}

/** Товара нет на складе — цену скрываем, предлагаем уточнить поступление. */
export function isOutOfStock(product: StockAvailabilityInput): boolean {
  return !isProductAvailable(product);
}

/** Подпись вместо цены для отсутствующего товара. */
export const OUT_OF_STOCK_LABEL = "Нет в наличии";

/** Подпись кнопки автозаявки для отсутствующего товара. */
export const RESTOCK_INQUIRY_LABEL = "Уточнить поступление";
