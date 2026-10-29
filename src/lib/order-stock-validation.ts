// =========================================================
// FILE: src/lib/order-stock-validation.ts
// Проверка фактического складского остатка позиций корзины и заказа.
// Каждая карточка товара — самостоятельная складская единица (products).
// =========================================================

import { getAvailableStockQty } from "./stock-availability";

export interface OrderStockCheckItem {
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  name?: string | null;
  quantity: number;
}

export interface StockProductRecord {
  id: string;
  name: string;
  stockQty: number | null;
  isVisible: boolean;
  madeToOrder: boolean;
}

export type OrderItemStockStatus =
  | "ok"
  | "out_of_stock"
  | "insufficient_stock"
  | "made_to_order"
  | "unavailable";

export interface EvaluatedOrderItemStock {
  productId: string;
  variantId: string | null;
  lineKey: string;
  displayName: string;
  requestedQty: number;
  availableQty: number;
  stockPoolId: string | null;
  status: OrderItemStockStatus;
  error: string | null;
}

export interface OrderStockValidationResult {
  ok: boolean;
  error: string | null;
  items: EvaluatedOrderItemStock[];
}

export function buildCartLineKey(
  productId: string,
  variantId?: string | null,
): string {
  return `${productId}::${variantId || ""}`;
}

export function evaluateOrderItemsStock(
  items: OrderStockCheckItem[],
  productsMap: ReadonlyMap<string, StockProductRecord>,
): OrderStockValidationResult {
  const poolRequested = new Map<string, number>();

  interface ResolvedDraft {
    productId: string;
    variantId: string | null;
    lineKey: string;
    displayName: string;
    requestedQty: number;
    availableQty: number;
    stockPoolId: string | null;
    poolKey: string | null;
    earlyStatus: OrderItemStockStatus | null;
    earlyError: string | null;
  }

  const drafts: ResolvedDraft[] = items.map((raw) => {
    const productId = String(raw.productId || "").trim();
    const variantId = raw.variantId ? String(raw.variantId).trim() : null;
    const requestedQty = Math.max(1, Math.round(Number(raw.quantity) || 1));
    const lineKey = buildCartLineKey(productId, variantId);
    const product = productsMap.get(productId);

    const baseLabel =
      (raw.name && String(raw.name).trim()) ||
      product?.name ||
      "Товар";
    const displayName =
      raw.variantName && !baseLabel.includes(raw.variantName)
        ? `${baseLabel} (${raw.variantName})`
        : baseLabel;

    if (!product || product.isVisible === false) {
      return {
        productId,
        variantId,
        lineKey,
        displayName,
        requestedQty,
        availableQty: 0,
        stockPoolId: null,
        poolKey: null,
        earlyStatus: "unavailable",
        earlyError: `Товар «${displayName}» сейчас недоступен для заказа.`,
      };
    }

    if (product.madeToOrder) {
      return {
        productId,
        variantId,
        lineKey,
        displayName,
        requestedQty,
        availableQty: 0,
        stockPoolId: null,
        poolKey: null,
        earlyStatus: "made_to_order",
        earlyError: `Товар «${displayName}» изготавливается под заказ — оставьте заявку на расчёт.`,
      };
    }

    const availableQty = getAvailableStockQty({ stockQty: product.stockQty });
    const poolKey = `product:${product.id}`;
    poolRequested.set(poolKey, (poolRequested.get(poolKey) || 0) + requestedQty);

    return {
      productId,
      variantId,
      lineKey,
      displayName,
      requestedQty,
      availableQty,
      stockPoolId: product.id,
      poolKey,
      earlyStatus: null,
      earlyError: null,
    };
  });

  const evaluated: EvaluatedOrderItemStock[] = drafts.map((d) => {
    if (d.earlyStatus) {
      return {
        productId: d.productId,
        variantId: d.variantId,
        lineKey: d.lineKey,
        displayName: d.displayName,
        requestedQty: d.requestedQty,
        availableQty: d.availableQty,
        stockPoolId: d.stockPoolId,
        status: d.earlyStatus,
        error: d.earlyError,
      };
    }

    if (d.availableQty <= 0) {
      return {
        productId: d.productId,
        variantId: d.variantId,
        lineKey: d.lineKey,
        displayName: d.displayName,
        requestedQty: d.requestedQty,
        availableQty: 0,
        stockPoolId: d.stockPoolId,
        status: "out_of_stock",
        error: `Товар «${d.displayName}» закончился на складе — он доступен только под заказ.`,
      };
    }

    const totalForPool = d.poolKey
      ? poolRequested.get(d.poolKey) || d.requestedQty
      : d.requestedQty;

    if (totalForPool > d.availableQty) {
      return {
        productId: d.productId,
        variantId: d.variantId,
        lineKey: d.lineKey,
        displayName: d.displayName,
        requestedQty: d.requestedQty,
        availableQty: d.availableQty,
        stockPoolId: d.stockPoolId,
        status: "insufficient_stock",
        error: `На складе осталось только ${d.availableQty} шт. товара «${d.displayName}» (в заказе ${totalForPool} шт.).`,
      };
    }

    return {
      productId: d.productId,
      variantId: d.variantId,
      lineKey: d.lineKey,
      displayName: d.displayName,
      requestedQty: d.requestedQty,
      availableQty: d.availableQty,
      stockPoolId: d.stockPoolId,
      status: "ok",
      error: null,
    };
  });

  const firstFailed = evaluated.find((it) => it.status !== "ok");
  return {
    ok: !firstFailed,
    error: firstFailed?.error || null,
    items: evaluated,
  };
}
