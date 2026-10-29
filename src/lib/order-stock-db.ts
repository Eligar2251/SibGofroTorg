// =========================================================
// FILE: src/lib/order-stock-db.ts
// Чтение актуальных складских остатков из БД (без кеша) для
// проверки корзины и оформления заказа.
// =========================================================

import { getAdminDb } from "./supabase";
import {
  evaluateOrderItemsStock,
  type OrderStockCheckItem,
  type OrderStockValidationResult,
  type StockProductRecord,
} from "./order-stock-validation";

export async function validateOrderItemsAgainstLiveDb(
  items: OrderStockCheckItem[],
): Promise<OrderStockValidationResult> {
  const productIds = [
    ...new Set(
      items
        .map((it) => String(it.productId || "").trim())
        .filter(Boolean),
    ),
  ];

  const productsMap = new Map<string, StockProductRecord>();

  if (productIds.length > 0) {
    const db = getAdminDb();

    const { data: productRows, error: prodErr } = await db
      .from("products")
      .select("id, name, stock_qty, is_visible, made_to_order")
      .in("id", productIds);

    if (prodErr) {
      throw prodErr;
    }

    for (const row of productRows || []) {
      const parsedQty = row.stock_qty != null ? Number(row.stock_qty) : 0;
      productsMap.set(String(row.id), {
        id: String(row.id),
        name: String(row.name || ""),
        stockQty: Number.isFinite(parsedQty) ? parsedQty : 0,
        isVisible: row.is_visible !== false,
        madeToOrder: row.made_to_order === true,
      });
    }
  }

  return evaluateOrderItemsStock(items, productsMap);
}
