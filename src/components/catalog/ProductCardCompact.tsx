"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/context/CartContext";
import { Plus, Minus, ShoppingCart, Check, Package } from "lucide-react";

interface CompactProduct {
  id: string;
  name: string;
  slug: string;
  sku?: string | null;
  price: number | null;
  priceWholesale?: number | null;
  minWholesaleQty?: number | null;
  packQty?: number | null;
  imageUrl?: string | null;
  inStock?: boolean;
  promoLabel?: string | null;
  madeToOrder?: boolean | null;
  stockQty?: number | null;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  material?: string | null;
}

export function ProductCardCompact({
  product,
  highlight,
}: {
  product: CompactProduct;
  highlight?: boolean;
}) {
  const { addToCart, cart } = useCart();
  const packSize = product.packQty ? Math.max(1, Number(product.packQty)) : 1;
  const maxStock = product.stockQty ?? null;

  const [qty, setQty] = useState(packSize);
  const [inputVal, setInputVal] = useState(String(packSize));
  const [added, setAdded] = useState(false);
  const [showHover, setShowHover] = useState(false);

  const inCart = cart.find((i) => i.productId === product.id);

  const dims =
    product.dimensionLength && product.dimensionWidth
      ? `${product.dimensionLength}×${product.dimensionWidth}${
          product.dimensionHeight ? `×${product.dimensionHeight}` : ""
        } ${product.dimensionUnit || "мм"}`
      : null;

  function clampQty(val: number) {
    const clamped = Math.max(1, val);
    return maxStock ? Math.min(maxStock, clamped) : clamped;
  }

  function dec(e: React.MouseEvent) {
    e.preventDefault();
    const next = clampQty(qty - packSize < 1 ? 1 : qty - packSize);
    setQty(next);
    setInputVal(String(next));
  }

  function inc(e: React.MouseEvent) {
    e.preventDefault();
    const next = clampQty(qty + packSize);
    setQty(next);
    setInputVal(String(next));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputVal(e.target.value);
  }

  function handleInputBlur() {
    const parsed = parseInt(inputVal, 10);
    if (isNaN(parsed) || parsed < 1) {
      setQty(1);
      setInputVal("1");
    } else {
      const clamped = clampQty(parsed);
      setQty(clamped);
      setInputVal(String(clamped));
    }
  }

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    if (!product.price || product.madeToOrder) return;
    addToCart(
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        imageUrl: product.imageUrl,
        maxStock,
      },
      qty
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  const totalPrice = product.price ? product.price * qty : 0;
  const isWholesale =
    product.priceWholesale &&
    product.minWholesaleQty &&
    qty >= product.minWholesaleQty;

  return (
    <div
      className={`pcc${highlight ? " pcc--highlight" : ""}`}
      onMouseEnter={() => setShowHover(true)}
      onMouseLeave={() => setShowHover(false)}
    >
      {/* ── Фото ── */}
      <Link href={`/catalog/product/${product.slug}`} className="pcc__media">
        {product.promoLabel && (
          <span className="pcc__badge pcc__badge--promo">{product.promoLabel}</span>
        )}
        {!product.inStock && (
          <span className="pcc__badge pcc__badge--out">Нет в наличии</span>
        )}
        {maxStock !== null && maxStock > 0 && maxStock <= 20 && (
          <span className="pcc__badge pcc__badge--low">Осталось {maxStock}</span>
        )}

        <div className="pcc__img">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              sizes="220px"
              style={{ objectFit: "cover" }}
            />
          ) : (
            <span className="pcc__img-placeholder">📦</span>
          )}

          {/* Hover-оверлей с характеристиками */}
          {showHover && (dims || product.material) && (
            <div className="pcc__hover-overlay">
              {dims && (
                <div className="pcc__hover-row">
                  <span className="pcc__hover-label">Размер</span>
                  <span className="pcc__hover-val">{dims}</span>
                </div>
              )}
              {product.material && (
                <div className="pcc__hover-row">
                  <span className="pcc__hover-label">Марка</span>
                  <span className="pcc__hover-val">{product.material}</span>
                </div>
              )}
              {packSize > 1 && (
                <div className="pcc__hover-row">
                  <span className="pcc__hover-label">В пачке</span>
                  <span className="pcc__hover-val">{packSize} шт.</span>
                </div>
              )}
              {maxStock !== null && (
                <div className="pcc__hover-row">
                  <span className="pcc__hover-label">Склад</span>
                  <span
                    className="pcc__hover-val"
                    style={{ color: maxStock > 0 ? "#5dcb61" : "#ef4444" }}
                  >
                    {maxStock > 0 ? `${maxStock} шт.` : "нет"}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </Link>

      {/* ── Тело ── */}
      <div className="pcc__body">
        {product.sku && <div className="pcc__sku">Арт: {product.sku}</div>}

        <Link href={`/catalog/product/${product.slug}`} className="pcc__name">
          {product.name}
          {dims && <span className="pcc__name-dims">{dims}</span>}
        </Link>

        {/* Цена — шт + партия */}
        <div className="pcc__prices">
          {product.madeToOrder ? (
            <span className="pcc__price-muted pcc__price-muted--mto">
              Под заказ
            </span>
          ) : product.price != null ? (
            <>
              <div className="pcc__price-main">
                <span className="pcc__price-val">
                  {product.price.toLocaleString("ru-RU")}
                </span>
                <span className="pcc__price-rub">₽/шт</span>
              </div>
              {product.priceWholesale && product.minWholesaleQty && (
                <div className="pcc__price-wholesale">
                  <Package size={9} />
                  от {product.minWholesaleQty} шт. —{" "}
                  <strong>{product.priceWholesale.toLocaleString("ru-RU")} ₽</strong>
                </div>
              )}
            </>
          ) : (
            <span className="pcc__price-muted">Цена по запросу</span>
          )}
          {inCart && (
            <span className="pcc__in-cart">✓ в корзине: {inCart.quantity}</span>
          )}
        </div>

        {/* Управление количеством */}
        {product.madeToOrder ? (
          <Link
            href={`/catalog/product/${product.slug}`}
            className="pcc__inquiry-btn"
          >
            Оставить заявку
          </Link>
        ) : product.price != null ? (
          <>
            <div className="pcc__actions">
              <div className="pcc__stepper">
                <button
                  className="pcc__stepper-btn"
                  onClick={dec}
                  aria-label="Уменьшить"
                >
                  <Minus size={11} />
                </button>
                <input
                  className="pcc__stepper-input"
                  type="number"
                  min={1}
                  max={maxStock ?? undefined}
                  value={inputVal}
                  onChange={handleInputChange}
                  onBlur={handleInputBlur}
                  onClick={(e) => e.preventDefault()}
                  aria-label="Количество"
                />
                <button
                  className="pcc__stepper-btn"
                  onClick={inc}
                  aria-label="Увеличить"
                >
                  <Plus size={11} />
                </button>
              </div>
              <button
                onClick={handleAdd}
                className={`pcc__add-btn${added ? " pcc__add-btn--added" : ""}`}
                aria-label="В корзину"
              >
                {added ? <Check size={14} /> : <ShoppingCart size={14} />}
              </button>
            </div>

            {/* Сумма за выбранное количество */}
            {qty > 1 && (
              <div className="pcc__qty-total">
                {qty} шт. ={" "}
                <strong>
                  {(isWholesale
                    ? (product.priceWholesale ?? product.price) * qty
                    : totalPrice
                  ).toLocaleString("ru-RU")}{" "}
                  ₽
                </strong>
                {isWholesale && (
                  <span className="pcc__qty-discount"> опт</span>
                )}
              </div>
            )}
          </>
        ) : (
          <Link
            href={`/catalog/product/${product.slug}`}
            className="pcc__inquiry-btn"
          >
            Узнать цену
          </Link>
        )}
      </div>
    </div>
  );
}