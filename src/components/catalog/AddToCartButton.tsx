// src/components/product/AddToCartButton.tsx
"use client";

import { useState } from "react";
import { useCart } from "@/context/CartContext";
import { ShoppingCart, Check, Plus, Minus, Package } from "lucide-react";
import Link from "next/link";
import { ymGoal } from "@/lib/ym";

interface AddToCartButtonProps {
  product: {
    id: string;
    name: string;
    sku?: string | null;
    price: number | null;
    imageUrl?: string | null;
    stockQty?: number | null;
    packQty?: number | null;
  };
}

type InputMode = "pieces" | "packs";

export function AddToCartButton({ product }: AddToCartButtonProps) {
  const { addToCart, cart } = useCart();

  const packSize = product.packQty ? Math.max(1, Number(product.packQty)) : 1;
  const hasPacks = packSize > 1;
  const maxStock = product.stockQty != null ? Number(product.stockQty) : null;

  const [inputMode, setInputMode] = useState<InputMode>("pieces");
  const [inputValue, setInputValue] = useState<string>(String(packSize > 1 ? packSize : 1));
  const [added, setAdded] = useState(false);

  const priceValue = product.price || 0;
  const inCart = cart.find((i) => i.productId === product.id);

  const totalPieces: number = (() => {
    const raw = parseInt(inputValue, 10);
    if (isNaN(raw) || raw < 1) return inputMode === "packs" ? packSize : 1;
    if (inputMode === "packs") {
      const pieces = raw * packSize;
      return maxStock !== null ? Math.min(pieces, maxStock) : pieces;
    }
    return maxStock !== null ? Math.min(raw, maxStock) : raw;
  })();

  const packsCount = hasPacks ? Math.floor(totalPieces / packSize) : null;
  const remainder = hasPacks ? totalPieces % packSize : 0;

  function switchMode(mode: InputMode) {
    if (mode === inputMode) return;
    if (mode === "packs") {
      const pieces = parseInt(inputValue, 10) || 1;
      const packs = Math.max(1, Math.floor(pieces / packSize));
      setInputValue(String(packs));
    } else {
      const packs = parseInt(inputValue, 10) || 1;
      setInputValue(String(packs * packSize));
    }
    setInputMode(mode);
  }

  const minVal = 1;
  const maxVal =
    maxStock !== null
      ? inputMode === "packs"
        ? Math.floor(maxStock / packSize)
        : maxStock
      : undefined;

  function clamp(val: number) {
    let result = Math.max(minVal, val);
    if (maxVal !== undefined) result = Math.min(maxVal, result);
    return result;
  }

  function handleChange(val: string) {
    setInputValue(val);
  }

  function handleBlur() {
    const num = parseInt(inputValue, 10);
    if (isNaN(num) || num < 1) {
      setInputValue(String(minVal));
    } else {
      setInputValue(String(clamp(num)));
    }
  }

  function increment() {
    const cur = parseInt(inputValue, 10) || 0;
    setInputValue(String(clamp(cur + 1)));
  }

  function decrement() {
    const cur = parseInt(inputValue, 10) || 1;
    setInputValue(String(clamp(cur - 1)));
  }

  function handleAdd() {
    if (totalPieces < 1) return;
    addToCart(
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        price: priceValue,
        imageUrl: product.imageUrl,
        maxStock,
      },
      totalPieces
    );
    ymGoal("add_to_cart", { product_id: product.id });
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  }

  if (!product.price) {
    return (
      <div className="atc-noprice">
        <p>Цена рассчитывается индивидуально — оставьте заявку</p>
        <Link href="/order" className="atc-noprice__btn">
          Оставить заявку
        </Link>
      </div>
    );
  }

  return (
    <div className="atc-wrap">
      {/* Инфо о пачке */}
      {hasPacks && (
        <div className="atc-pack-info">
          <Package size={14} style={{ color: "var(--kraft)", flexShrink: 0 }} />
          <span>
            В заводской упаковке: <strong>{packSize} шт.</strong>
          </span>
          {maxStock !== null && (
            <span
              className="atc-pack-info__stock"
              style={{ color: maxStock <= 15 ? "var(--red)" : "var(--green)" }}
            >
              На складе: {maxStock} шт.
            </span>
          )}
        </div>
      )}

      {!hasPacks && maxStock !== null && (
        <div className="atc-pack-info">
          <span>На складе: </span>
          <strong style={{ color: maxStock <= 15 ? "var(--red)" : "var(--green)" }}>
            {maxStock} шт.
          </strong>
        </div>
      )}

      {/* Переключатель режима */}
      {hasPacks && (
        <div className="atc-mode-switcher">
          <button
            type="button"
            onClick={() => switchMode("pieces")}
            className={`atc-mode-btn${inputMode === "pieces" ? " atc-mode-btn--active" : ""}`}
          >
            По штукам
          </button>
          <button
            type="button"
            onClick={() => switchMode("packs")}
            className={`atc-mode-btn${inputMode === "packs" ? " atc-mode-btn--active" : ""}`}
          >
            Пачками ({packSize} шт.)
          </button>
        </div>
      )}

      {/* Выбор количества */}
      <div className="atc-qty-row">
        <div className="atc-qty-label">
          {inputMode === "packs" ? "Количество пачек:" : "Количество штук:"}
          {inCart && (
            <span className="atc-in-cart">в корзине: {inCart.quantity} шт.</span>
          )}
        </div>
        <div className="atc-stepper">
          <button
            type="button"
            className="atc-stepper__btn"
            onClick={decrement}
            aria-label="Меньше"
          >
            <Minus size={15} />
          </button>
          <input
            type="number"
            className="atc-stepper__input"
            value={inputValue}
            onChange={e => handleChange(e.target.value)}
            onBlur={handleBlur}
            min={minVal}
            max={maxVal}
            aria-label="Количество"
          />
          <button
            type="button"
            className="atc-stepper__btn"
            onClick={increment}
            aria-label="Больше"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      {/* Расшифровка пачек */}
      {hasPacks && (
        <div className="atc-breakdown">
          {inputMode === "packs" ? (
            <span>
              Итого к заказу: <strong>{totalPieces} шт.</strong>
            </span>
          ) : (
            <span>
              {packsCount !== null && packsCount > 0 ? `${packsCount} пач.` : ""}
              {remainder > 0 ? ` + ${remainder} шт.` : ""}
              {" = "}
              <strong>{totalPieces} шт.</strong>
            </span>
          )}
        </div>
      )}

      {/* Итоговая сумма */}
      <div className="atc-total">
        <span className="atc-total__label">Сумма бронирования:</span>
        <span className="atc-total__sum">
          {(priceValue * totalPieces).toLocaleString("ru-RU")} ₽
        </span>
      </div>

      {/* Кнопка */}
      <button
        type="button"
        onClick={handleAdd}
        className={`atc-btn${added ? " atc-btn--added" : ""}`}
      >
        {added ? (
          <><Check size={18} /> Добавлено в корзину!</>
        ) : (
          <><ShoppingCart size={18} /> Добавить в корзину</>
        )}
      </button>

      {inCart && (
        <Link href="/order" className="atc-goto-cart">
          Перейти к оформлению заказа →
        </Link>
      )}
    </div>
  );
}