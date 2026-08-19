// =========================================================
// FILE: src/components/layout/FloatingCart.tsx
// Плавающая кнопка-корзина: показывается, когда в корзине есть
// товары, и всегда видна клиенту — сколько позиций добавлено
// и итоговая сумма. Ведёт на страницу оформления /order.
// =========================================================

"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/context/CartContext";

export function FloatingCart() {
  const { totalItems, totalSum } = useCart();

  if (totalItems === 0) return null;

  return (
    <Link
      href="/order"
      className="floating-cart"
      aria-label={`Перейти в корзину: ${totalItems} шт. на ${totalSum.toLocaleString("ru-RU")} ₽`}
    >
      <span className="floating-cart__icon">
        <ShoppingCart size={22} />
        <span className="floating-cart__count">
          {totalItems > 99 ? "99+" : totalItems}
        </span>
      </span>
      <span className="floating-cart__info">
        <span className="floating-cart__label">Корзина</span>
        <span className="floating-cart__sum">
          {totalSum.toLocaleString("ru-RU")} ₽
        </span>
      </span>
    </Link>
  );
}
