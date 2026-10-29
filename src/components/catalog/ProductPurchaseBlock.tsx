"use client";

import { useMemo } from "react";
import { AddToCartButton } from "./AddToCartButton";

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
  unavailable?: boolean;
  unavailableSlot?: React.ReactNode;
}

export function ProductPurchaseBlock({
  product,
  unavailable = false,
  unavailableSlot,
}: ProductPurchaseBlockProps) {
  const productForButton = useMemo(
    () => product,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      product.id,
      product.price,
      product.stockQty,
      product.packQty,
      product.imageUrl,
      product.sku,
      product.name,
    ],
  );

  if (unavailable) {
    return <div className="purchase-block-unavailable">{unavailableSlot}</div>;
  }

  return (
    <div className="purchase-block">
      <AddToCartButton product={productForButton} />
    </div>
  );
}
