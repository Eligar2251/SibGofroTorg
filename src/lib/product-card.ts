// =========================================================
// FILE: src/lib/product-card.ts
// Данные товара для плитки (ProductCardCompact) — одно место.
//
// Раньше каждая страница (каталог, категория, главная) собирала
// объект для плитки вручную и «забывала» поля скидки — поэтому
// бейдж скидки был только на странице товара, а в плитках нет.
// =========================================================

import type { FirestoreProduct } from "./types";
import { getProductEffectivePrice } from "./types";
import type { DimensionValue } from "./dimension-profiles";

export interface CardDiscountSource {
  price: number | null;
  basePrice?: number | null;
  hasVariants?: boolean;
  discountType?: "percent" | "fixed" | null;
  discountValue?: number | null;
  discountBadge?: string | null;
}

/** Цена со скидкой, старая цена и подпись бейджа — как на странице товара. */
export function getCardDiscount(p: CardDiscountSource): {
  price: number | null;
  oldPrice: number | null;
  badge: string | null;
} {
  const base = p.basePrice ?? p.price;
  const effective = getProductEffectivePrice({
    price: base,
    discountType: p.discountType ?? null,
    discountValue: p.discountValue ?? null,
  });
  const hasDiscount = base != null && effective != null && effective < base;
  const percent =
    hasDiscount && base ? Math.round((1 - (effective as number) / base) * 100) : 0;
  const badge = hasDiscount
    ? (p.discountBadge || "").trim() || (percent > 0 ? `−${percent}%` : "Скидка")
    : null;
  // У товара с вариантами крупная цена — «от» минимальной цены варианта
  // (как на странице товара), скидка показывается бейджем.
  if (p.hasVariants) return { price: p.price, oldPrice: null, badge };
  return {
    price: hasDiscount ? effective : p.price,
    oldPrice: hasDiscount ? base : null,
    badge,
  };
}

/** Сериализация товара для плитки: всё, что нужно карточке, без лишнего. */
export function toCardProduct(p: FirestoreProduct) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? null,
    price: p.price,
    basePrice: p.basePrice ?? null,
    priceWholesale: p.priceWholesale ?? null,
    minWholesaleQty: p.minWholesaleQty ?? null,
    packQty: p.packQty ?? null,
    imageUrl: p.imageUrl ?? null,
    inStock: p.inStock,
    promoLabel: p.promoLabel ?? null,
    promoLabelColor: p.promoLabelColor ?? null,
    promoLabelTextColor: p.promoLabelTextColor ?? null,
    madeToOrder: p.madeToOrder ?? false,
    madeToOrderMinQty: p.madeToOrderMinQty ?? null,
    isCuttable: p.isCuttable ?? false,
    cutMetersPerRoll: p.cutMetersPerRoll ?? null,
    cutPricePerMeter: p.cutPricePerMeter ?? null,
    cutUnitName: p.cutUnitName || "м",
    stockQty: p.stockQty ?? null,
    dimensionLength: p.dimensionLength ?? null,
    dimensionWidth: p.dimensionWidth ?? null,
    dimensionHeight: p.dimensionHeight ?? null,
    dimensionUnit: p.dimensionUnit ?? null,
    dimensionValues: (p.dimensionValues ?? null) as DimensionValue[] | null,
    material: p.material ?? null,
    discountType: p.discountType ?? null,
    discountValue: p.discountValue ?? null,
    discountBadge: p.discountBadge ?? null,
    hasVariants: p.hasVariants ?? false,
    variantCount: p.variantCount ?? 0,
    variantPriceMin: p.variantPriceMin ?? null,
    variantPriceMax: p.variantPriceMax ?? null,
    variantTotalStock: p.variantTotalStock ?? 0,
  };
}

export type CardProduct = ReturnType<typeof toCardProduct>;
