// =========================================================
// FILE: src/components/layout/CartPopup.tsx
// Попап над плавающей корзиной: количество и сумма.
// Появляется только при добавлении товара и сам не закрывается —
// прячется крестиком, «Скрыть» или переходом в корзину.
// =========================================================

"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Check, ShoppingCart, X } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { GlyphIcon } from "@/components/ui/Glyph";

function isCheckoutPath(pathname: string | null): boolean {
  return pathname === "/order" || (pathname?.startsWith("/order/") ?? false);
}

export function CartPopup() {
  const pathname = usePathname();
  const {
    lastAdded,
    hideCartDock,
    cartDockOpen,
    cart,
    totalItems,
    totalSum,
  } = useCart();

  if (isCheckoutPath(pathname) || !cartDockOpen || totalItems === 0) return null;

  const liveItem = lastAdded
    ? cart.find((item) => item.productId === lastAdded.productId)
    : null;
  const shown = liveItem
    ? {
        name: liveItem.name,
        imageUrl: liveItem.imageUrl,
        price: liveItem.price,
        qty: liveItem.quantity,
      }
    : null;
  const lineSum = shown ? shown.qty * shown.price : 0;

  return (
    <div className="cart-popup" role="status" aria-live="polite">
      <button
        type="button"
        className="cart-popup__close"
        onClick={hideCartDock}
        aria-label="Скрыть корзину"
      >
        <X size={16} />
      </button>

      <div className="cart-popup__head">
        <span className="cart-popup__check">
          <Check size={16} />
        </span>
        <span className="cart-popup__title">
          {shown ? "Товар в корзине" : "Корзина"}
        </span>
      </div>

      {shown && (
        <div className="cart-popup__product">
          <span className="cart-popup__img">
            {shown.imageUrl ? (
              <Image
                src={shown.imageUrl}
                alt={shown.name}
                fill
                sizes="56px"
                style={{ objectFit: "cover" }}
              />
            ) : (
              <GlyphIcon value="box" size={24} />
            )}
          </span>
          <span className="cart-popup__info">
            <span className="cart-popup__name">{shown.name}</span>
            <span className="cart-popup__meta">
              {shown.qty} шт. × {shown.price.toLocaleString("ru-RU")} ₽
            </span>
            <span className="cart-popup__line-sum">
              {lineSum.toLocaleString("ru-RU")} ₽
            </span>
          </span>
        </div>
      )}

      <div className="cart-popup__total">
        <span>В корзине: {totalItems} шт.</span>
        <span>{totalSum.toLocaleString("ru-RU")} ₽</span>
      </div>

      <div className="cart-popup__actions">
        <Link
          href="/order"
          className="cart-popup__btn cart-popup__btn--primary"
          onClick={hideCartDock}
        >
          <ShoppingCart size={16} />
          Перейти в корзину
        </Link>
        <button
          type="button"
          className="cart-popup__btn"
          onClick={hideCartDock}
        >
          Скрыть
        </button>
      </div>
    </div>
  );
}
