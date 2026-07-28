// src/components/catalog/ProductPurchaseBlock.tsx
//
// Клиентский блок покупки на странице товара: «обёртка» над
// VariantPicker + AddToCartButton. Вариант выбирается в picker,
// передаётся в AddToCartButton — там же показывается актуальная
// цена/остаток выбранного варианта и блокируется кнопка, если
// вариант распродан.
//
// Всё это нужно, потому что:
//   1. ProductPage — серверный компонент (Next.js App Router),
//      в нём нельзя использовать useState.
//   2. AddToCartButton не знает про список вариантов — только
//      про один выбранный. Связь «управляемый picker →
//      управляемый AddToCartButton» живёт в этом компоненте.

"use client";

import { useState, useMemo } from "react";
import { VariantPicker } from "./VariantPicker";
import { AddToCartButton } from "./AddToCartButton";
import type { ProductVariant } from "@/lib/types";

export interface ProductPurchaseBlockProps {
  product: {
    id: string;
    name: string;
    sku?: string | null;
    price: number | null;
    imageUrl?: string | null;
    stockQty?: number | null;
    packQty?: number | null;
  };
  /** Только видимые варианты. Если пусто — VariantPicker не
   *  рендерится, кнопка работает со старой логикой (один
   *  товар без вариантов). */
  variants: ProductVariant[];
  /**
   * Если true — клиент не может положить товар в корзину
   * (нет в наличии, цена по запросу, под заказ). В этом
   * случае рендерится PriceInquiryButton в AddToCartButton.
   */
  unavailable?: boolean;
  /** Контент, который рендерится вместо AddToCartButton,
   *  если товар недоступен. Используется страницей товара
   *  для отрисовки «Уточнить цену» / «Под заказ» / «Нет
   *  в наличии». */
  unavailableSlot?: React.ReactNode;
}

export function ProductPurchaseBlock({
  product,
  variants,
  unavailable = false,
  unavailableSlot,
}: ProductPurchaseBlockProps) {
  // Локальный state выбранного варианта. null = не выбран
  // (например, у товара вообще нет вариантов).
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);

  // Если выбран вариант — заменяем product.price/stock на
  // данные варианта (только если они не null — иначе fallback
  // на product). Но т.к. AddToCartButton сам умеет работать
  // с selectedVariant, передаём ему product как есть, а
  // вариант — отдельным пропсом.

  // Мемоизация: чтобы AddToCartButton не перерисовывался на
  // каждый клик по chip-у варианта, если product не менялся.
  const productForButton = useMemo(
    () => product,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [product.id, product.price, product.stockQty, product.packQty, product.imageUrl, product.sku],
  );

  // Если товар недоступен — только слот unavailable
  if (unavailable) {
    return <div className="purchase-block-unavailable">{unavailableSlot}</div>;
  }

  return (
    <div className="purchase-block">
      {variants.length > 0 && (
        <VariantPicker variants={variants} onSelectVariant={setSelectedVariant} />
      )}
      <AddToCartButton
        product={productForButton}
        selectedVariant={selectedVariant}
        allVariants={variants}
      />
    </div>
  );
}
