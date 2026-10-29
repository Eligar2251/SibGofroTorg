// =========================================================
// FILE: src/lib/product-card.ts
// Данные товара для плитки (ProductCardCompact) — одно место.
// =========================================================

import type { FirestoreProduct } from "./types";
import { getProductEffectivePrice } from "./types";
import type { DimensionValue } from "./dimension-profiles";
import type { LinkedCardOption } from "./product-links";

export interface CardDiscountSource {
  price: number | null;
  basePrice?: number | null;
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
    linkGroupId: p.linkGroupId ?? null,
    isGroupPrimary: p.isGroupPrimary ?? true,
    linkedGroupTitle: p.linkedGroupTitle ?? null,
    linkedVariantLabel: p.linkedVariantLabel ?? null,
    linkedCards: (p.linkedCards ?? undefined) as LinkedCardOption[] | undefined,
  };
}

export type CardProduct = ReturnType<typeof toCardProduct>;
