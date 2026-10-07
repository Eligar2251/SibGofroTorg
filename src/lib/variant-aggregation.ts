import type { FirestoreProduct, ProductVariant } from "./types";

export interface VariantAggregate {
  hasVariants: boolean;
  variantCount: number;
  priceMin: number | null;
  priceMax: number | null;
  totalStock: number;
  anyInStock: boolean;
  /** Остаток задан по вариантам (есть хотя бы один вариант с количеством > 0). */
  variantStockManaged: boolean;
}

/**
 * Сводные данные по вариантам для каталога и страницы товара.
 *
 * Если ни у одного варианта не задан положительный остаток, варианты
 * используют общий остаток родительского товара. Как только остаток
 * задан хотя бы у одного варианта, включается раздельный учёт: нулевые
 * варианты считаются отсутствующими, положительные суммируются.
 */
export function aggregateVariants(
  variants: ProductVariant[] | undefined,
  product: Pick<FirestoreProduct, "price" | "stockQty" | "inStock">,
): VariantAggregate {
  if (!variants || variants.length === 0) {
    return {
      hasVariants: false,
      variantCount: 0,
      priceMin: product.price,
      priceMax: product.price,
      totalStock: Number(product.stockQty ?? 0),
      anyInStock: Number(product.stockQty ?? 0) > 0,
      variantStockManaged: false,
    };
  }

  const prices = variants
    .map((variant) =>
      variant.price != null && variant.price > 0 ? variant.price : product.price,
    )
    .filter((price): price is number => price != null && price > 0);
  const priceMin = prices.length > 0 ? Math.min(...prices) : null;
  const priceMax = prices.length > 0 ? Math.max(...prices) : null;
  const variantStockManaged = variants.some((variant) => variant.stockQty > 0);
  const productHasStock =
    product.inStock !== false &&
    (product.stockQty == null || Number(product.stockQty) > 0);
  const totalStock = variantStockManaged
    ? variants.reduce((sum, variant) => sum + Math.max(0, variant.stockQty || 0), 0)
    : Number(product.stockQty ?? 0);
  const anyInStock = variantStockManaged
    ? variants.some((variant) => variant.stockQty > 0)
    : productHasStock;

  return {
    hasVariants: true,
    variantCount: variants.length,
    priceMin,
    priceMax,
    totalStock,
    anyInStock,
    variantStockManaged,
  };
}

/**
 * Добавляет к товарам сводку по вариантам, не мутируя базовый массив.
 * fetchAllProducts держит товары в общем memory-кеше: если заменить в
 * нём базовую цену или остаток минимальным/сводным значением вариантов,
 * эти значения переживают удаление вариантов и попадают на витрину.
 */
export function enrichProductsWithVariants(
  baseProducts: FirestoreProduct[],
  variantsByProduct: ReadonlyMap<string, ProductVariant[]>,
): FirestoreProduct[] {
  return baseProducts.map((baseProduct) => {
    const product = { ...baseProduct };
    const variants = variantsByProduct.get(product.id) || [];
    const aggregate = aggregateVariants(variants, baseProduct);

    product.variants = variants;
    if (aggregate.hasVariants) product.basePrice = baseProduct.price;
    product.hasVariants = aggregate.hasVariants;
    product.variantCount = aggregate.variantCount;
    product.variantPriceMin = aggregate.priceMin;
    product.variantPriceMax = aggregate.priceMax;
    product.variantTotalStock = aggregate.totalStock;

    // Цена варианта нужна для надписи «от X ₽», но только в копии
    // товара для выдачи; исходная базовая цена остаётся нетронутой.
    if (aggregate.hasVariants && aggregate.priceMin != null) {
      product.price = aggregate.priceMin;
    }

    // Нулевые остатки у всех новых вариантов означают, что используется
    // общий остаток родительского товара. Не затираем его нулями.
    if (aggregate.variantStockManaged) {
      product.inStock = aggregate.anyInStock;
      product.stockQty = aggregate.totalStock;
    }

    return product;
  });
}
