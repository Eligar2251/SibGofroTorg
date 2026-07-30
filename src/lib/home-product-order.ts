export const ORDER_PRODUCTS_ORDER_SETTING_KEY = "order_products_order";

export function parseProductOrder(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export function sortByProductOrder<T extends { id: string }>(
  products: T[],
  order: string[]
): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...products].sort((a, b) => {
    const rankA = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  });
}
