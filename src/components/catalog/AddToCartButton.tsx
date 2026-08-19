// src/components/product/AddToCartButton.tsx
"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/context/CartContext";
import { ShoppingCart, Check, Plus, Minus, Package } from "lucide-react";
import Link from "next/link";
import { ymGoal } from "@/lib/ym";
import type { ProductVariant } from "@/lib/types";

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
  /**
   * Текущий выбранный вариант. Если null — кнопка работает
   * со старой логикой (один товар, без вариантов). Если
   * задан — используем его цену/остаток/имя.
   */
  selectedVariant?: ProductVariant | null;
  /**
   * Полный список вариантов — нужен, чтобы заблокировать
   * «Добавить в корзину», если ВСЕ варианты распроданы
   * (показываем кнопку «Оставить заявку»).
   */
  allVariants?: ProductVariant[];
}

type InputMode = "pieces" | "packs";

export function AddToCartButton({
  product,
  selectedVariant = null,
  allVariants = [],
}: AddToCartButtonProps) {
  const { addToCart, cart } = useCart();

  // Если задан вариант — его цена/остаток/имя «главнее» product.
  // null-поля у варианта → fallback на product.
  const effectivePrice =
    selectedVariant?.price != null ? selectedVariant.price : product.price;
  const effectiveStock =
    selectedVariant != null
      ? selectedVariant.stockQty
      : product.stockQty != null
        ? product.stockQty
        : null;
  const effectiveImageUrl =
    selectedVariant?.imageUrl ?? product.imageUrl ?? null;
  const effectiveSku =
    selectedVariant?.sku ?? product.sku ?? null;
  const effectiveName = selectedVariant
    ? selectedVariant.name
      ? `${product.name} / ${selectedVariant.name}`
      : product.name
    : product.name;

  const packSize =
    (selectedVariant?.packQty ?? product.packQty ?? 0) > 0
      ? Math.max(1, Number(selectedVariant?.packQty ?? product.packQty))
      : 1;
  const hasPacks = packSize > 1;
  const maxStock = effectiveStock != null ? Number(effectiveStock) : null;

  const [inputMode, setInputMode] = useState<InputMode>("pieces");
  // По умолчанию добавляем 1 штуку (не целую заводскую пачку).
  const [inputValue, setInputValue] = useState<string>("1");
  const [added, setAdded] = useState(false);

  // При смене варианта — сбрасываем qty-input к 1 шт.
  // Иначе клиент может увидеть «9999 шт» от предыдущего выбора и не заметить.
  useEffect(() => {
    setInputValue("1");
    setAdded(false);
  }, [selectedVariant?.id, packSize]);

  const priceValue = effectivePrice || 0;
  // Ищем в корзине именно эту позицию (товар + вариант).
  const inCart = cart.find(
    (i) =>
      i.productId === product.id &&
      (i.variantId ?? null) === (selectedVariant?.id ?? null),
  );

  const totalPieces: number = (() => {
    const raw = parseInt(inputValue, 10);
    if (isNaN(raw) || raw < 1) return inputMode === "packs" ? packSize : 1;
    if (inputMode === "packs") {
      const pieces = raw * packSize;
      return maxStock !== null ? Math.min(pieces, maxStock) : pieces;
    }
    return maxStock !== null ? Math.min(raw, maxStock) : raw;
  })();

  // Если у выбранного варианта остаток = 0 — блокируем кнопку
  // «В корзину» и предлагаем «Оставить заявку».
  const selectedIsOut = selectedVariant != null && selectedVariant.stockQty <= 0;
  // Если у товара в принципе есть варианты, но ни один не выбран
  // (например, только что зашли и ещё не кликнули) — кнопка
  // работает, но без варианта в корзине.
  const allVariantsOut =
    allVariants.length > 0 && allVariants.every((v) => v.stockQty <= 0);

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
        variantId: selectedVariant?.id ?? null,
        variantName: selectedVariant?.name ?? null,
        name: effectiveName,
        sku: effectiveSku,
        price: priceValue,
        imageUrl: effectiveImageUrl,
        maxStock,
      },
      totalPieces
    );
    ymGoal("add_to_cart", {
      product_id: product.id,
      variant_id: selectedVariant?.id ?? undefined,
    });
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

  // Если выбранный вариант распродан ИЛИ все варианты распроданы —
  // блокируем кнопку, показываем «Нет в наличии».
  if (selectedIsOut || allVariantsOut) {
    return (
      <div className="atc-wrap">
        <div className="atc-pack-info" style={{ color: "var(--red)" }}>
          <Package size={14} />
          <span>
            {selectedVariant
              ? `Вариант «${selectedVariant.name}» распродан`
              : "Все варианты распроданы"}
            {maxStock === 0 ? "" : ` — оставьте заявку, уточним поступление`}
          </span>
        </div>
        <Link
          href="/order"
          className="atc-noprice__btn"
          style={{ display: "block", textAlign: "center" }}
        >
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
          <div className="atc-pack-info__row">
            <Package size={14} style={{ color: "var(--kraft)", flexShrink: 0 }} />
            <span>
              В заводской упаковке: <strong>{packSize} шт.</strong>
            </span>
          </div>
          {maxStock !== null && (
            <div className="atc-pack-info__row">
              <span
                className="atc-pack-info__stock"
                style={{ color: maxStock <= 15 ? "var(--red)" : "var(--green)" }}
              >
                На складе: {maxStock} шт.
              </span>
            </div>
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

      {/* Итоговая сумма */}
      <div className="atc-total">
        <span className="atc-total__label">Сумма бронирования:</span>
        <span className="atc-total__sum">
          {(priceValue * totalPieces).toLocaleString("ru-RU")}{"\u00a0₽"}
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