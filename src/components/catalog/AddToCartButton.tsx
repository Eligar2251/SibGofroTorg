// src/components/catalog/AddToCartButton.tsx
"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/context/CartContext";
import { ShoppingCart, Check, Plus, Minus, Package } from "lucide-react";
import Link from "next/link";
import { ymGoal } from "@/lib/ym";
import {
  getAvailableStockQty,
  RESTOCK_INQUIRY_LABEL,
} from "@/lib/stock-availability";
import { PriceInquiryButton } from "./PriceInquiryButton";

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

  const effectivePrice = product.price;
  const effectiveStock = product.stockQty ?? 0;
  const effectiveImageUrl = product.imageUrl ?? null;
  const effectiveSku = product.sku ?? null;
  const effectiveName = product.name;

  const packSize =
    (product.packQty ?? 0) > 0 ? Math.max(1, Number(product.packQty)) : 1;
  const hasPacks = packSize > 1;
  const maxStock = getAvailableStockQty({ stockQty: effectiveStock });

  const [inputMode, setInputMode] = useState<InputMode>("pieces");
  const [inputValue, setInputValue] = useState<string>("1");
  const [added, setAdded] = useState(false);

  // При мгновенном переключении на связанную карточку сбрасываем количество к 1 шт.
  useEffect(() => {
    setInputMode("pieces");
    setInputValue("1");
    setAdded(false);
  }, [product.id, packSize]);

  const priceValue = effectivePrice || 0;
  const inCart = cart.find(
    (i) => i.productId === product.id && !i.variantId,
  );
  const remainingStock = Math.max(0, maxStock - (inCart?.quantity ?? 0));

  const totalPieces: number = (() => {
    if (remainingStock <= 0) return 0;
    const raw = parseInt(inputValue, 10);
    if (isNaN(raw) || raw < 1) {
      const fallback = inputMode === "packs" ? packSize : 1;
      return Math.min(fallback, remainingStock);
    }
    if (inputMode === "packs") {
      return Math.min(raw * packSize, remainingStock);
    }
    return Math.min(raw, remainingStock);
  })();

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
    remainingStock > 0
      ? inputMode === "packs"
        ? Math.max(1, Math.floor(remainingStock / packSize))
        : remainingStock
      : 1;

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
    if (totalPieces < 1 || maxStock <= 0 || remainingStock <= 0) return;
    addToCart(
      {
        productId: product.id,
        name: effectiveName,
        sku: effectiveSku,
        price: priceValue,
        imageUrl: effectiveImageUrl,
        maxStock,
      },
      totalPieces
    );
    ymGoal("add_to_cart", { product_id: product.id });
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  }

  if (maxStock <= 0) {
    return (
      <div className="atc-wrap">
        <div className="atc-pack-info" style={{ color: "var(--red)" }}>
          <Package size={14} />
          <span>Товар сейчас под заказ (нет на складе)</span>
        </div>
        <PriceInquiryButton
          productName={effectiveName}
          productSku={effectiveSku}
          productImageUrl={effectiveImageUrl}
          className="atc-noprice__btn"
          label={RESTOCK_INQUIRY_LABEL}
          kind="restock"
        />
      </div>
    );
  }

  if (effectivePrice == null || effectivePrice <= 0) {
    return (
      <div className="atc-noprice">
        <p>Цена рассчитывается индивидуально — оставьте заявку</p>
        <PriceInquiryButton
          productName={effectiveName}
          productSku={effectiveSku}
          productImageUrl={effectiveImageUrl}
          className="atc-noprice__btn"
          label="Узнать цену"
        />
      </div>
    );
  }

  return (
    <div className="atc-wrap">
      {hasPacks && (
        <div className="atc-pack-info">
          <div className="atc-pack-info__row">
            <Package size={14} style={{ color: "var(--kraft)", flexShrink: 0 }} />
            <span>
              В заводской упаковке: <strong>{packSize} шт.</strong>
            </span>
          </div>
          <div className="atc-pack-info__row">
            <span
              className="atc-pack-info__stock"
              style={{ color: maxStock <= 15 ? "var(--red)" : "var(--green)" }}
            >
              На складе: {maxStock} шт.
            </span>
          </div>
        </div>
      )}

      {!hasPacks && (
        <div className="atc-pack-info">
          <span>На складе: </span>
          <strong style={{ color: maxStock <= 15 ? "var(--red)" : "var(--green)" }}>
            {maxStock} шт.
          </strong>
        </div>
      )}

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
            onChange={(e) => handleChange(e.target.value)}
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

      <div className="atc-total">
        <span className="atc-total__label">Сумма бронирования:</span>
        <span className="atc-total__sum">
          {(priceValue * totalPieces).toLocaleString("ru-RU")}{"\u00a0₽"}
        </span>
      </div>

      <button
        type="button"
        onClick={handleAdd}
        disabled={remainingStock <= 0}
        className={`atc-btn${added ? " atc-btn--added" : ""}`}
      >
        {added ? (
          <><Check size={18} /> Добавлено в корзину!</>
        ) : remainingStock <= 0 ? (
          <><Check size={18} /> Весь доступный остаток в корзине</>
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
