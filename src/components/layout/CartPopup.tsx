// =========================================================
// FILE: src/components/layout/CartPopup.tsx
// Всплывающее окно при добавлении товара в корзину: показывает
// добавленный товар, итог корзины и кнопку «Перейти в корзину».
// Показывается поверх страницы, в правом нижнем углу (над плавающей
// корзиной), и сам закрывается через несколько секунд.
// =========================================================

"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Check, ShoppingCart, X } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { GlyphIcon } from "@/components/ui/Glyph";

const AUTO_HIDE_MS = 5000;

export function CartPopup() {
  const { lastAdded, clearLastAdded, totalItems, totalSum } = useCart();

  // Автоматически прячем попап через несколько секунд после добавления.
  // Каждое новое добавление перезапускает таймер (эффект зависит от lastAdded).
  useEffect(() => {
    if (!lastAdded) return;
    const timer = setTimeout(() => clearLastAdded(), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [lastAdded, clearLastAdded]);

  if (!lastAdded) return null;

  return (
    <div className="cart-popup" role="status" aria-live="polite">
      <button
        type="button"
        className="cart-popup__close"
        onClick={clearLastAdded}
        aria-label="Закрыть уведомление"
      >
        <X size={16} />
      </button>

      <div className="cart-popup__head">
        <span className="cart-popup__check">
          <Check size={16} />
        </span>
        <span className="cart-popup__title">Товар добавлен в корзину</span>
      </div>

      <div className="cart-popup__product">
        <span className="cart-popup__img">
          {lastAdded.imageUrl ? (
            <Image
              src={lastAdded.imageUrl}
              alt={lastAdded.name}
              fill
              sizes="56px"
              style={{ objectFit: "cover" }}
            />
          ) : (
            <GlyphIcon value="box" size={24} />
          )}
        </span>
        <span className="cart-popup__info">
          <span className="cart-popup__name">{lastAdded.name}</span>
          <span className="cart-popup__meta">
            {lastAdded.qty} шт. × {lastAdded.price.toLocaleString("ru-RU")} ₽
          </span>
        </span>
      </div>

      <div className="cart-popup__total">
        <span>В корзине: {totalItems} шт.</span>
        <span>{totalSum.toLocaleString("ru-RU")} ₽</span>
      </div>

      <div className="cart-popup__actions">
        <Link
          href="/order"
          className="cart-popup__btn cart-popup__btn--primary"
          onClick={clearLastAdded}
        >
          <ShoppingCart size={16} />
          Перейти в корзину
        </Link>
        <button
          type="button"
          className="cart-popup__btn"
          onClick={clearLastAdded}
        >
          Продолжить покупки
        </button>
      </div>
    </div>
  );
}
