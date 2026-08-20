// =========================================================
// FILE: src/components/layout/FloatingCart.tsx
// Плавающая кнопка-корзина: появляется только при добавлении товара
// и держится, пока пользователь её не скроет или не перейдёт в /order.
// =========================================================

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart, X } from "lucide-react";
import { useCart } from "@/context/CartContext";

function isCheckoutPath(pathname: string | null): boolean {
  return pathname === "/order" || (pathname?.startsWith("/order/") ?? false);
}

export function FloatingCart() {
  const pathname = usePathname();
  const { totalItems, totalSum, cartDockOpen, hideCartDock } = useCart();

  useEffect(() => {
    if (isCheckoutPath(pathname) && cartDockOpen) hideCartDock();
  }, [pathname, cartDockOpen, hideCartDock]);

  if (isCheckoutPath(pathname) || !cartDockOpen || totalItems === 0) return null;

  return (
    <div className="floating-cart-wrap">
      <button
        type="button"
        className="floating-cart__hide"
        onClick={hideCartDock}
        aria-label="Скрыть корзину"
      >
        <X size={12} />
      </button>
      <Link
        href="/order"
        className="floating-cart"
        onClick={hideCartDock}
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
    </div>
  );
}
