"use client";

import { useEffect, useState } from "react";
import { toSameOriginMediaUrl } from "@/lib/media";
import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/context/CartContext";
import { PriceInquiryButton } from "./PriceInquiryButton";
import {
  getAvailableStockQty,
  isOutOfStock,
  OUT_OF_STOCK_LABEL,
  RESTOCK_INQUIRY_LABEL,
} from "@/lib/stock-availability";
import { GlyphIcon } from "@/components/ui/Glyph";
import { EditableQuantityInput } from "@/components/ui/EditableQuantityInput";
import { ShoppingCart, Package, Clock3, Plus, Minus } from "lucide-react";
import { ymGoal } from "@/lib/ym";
import { formatProductSize } from "@/lib/product-size";
import { getCardDiscount } from "@/lib/product-card";
import {
  normalizeProductLabelColor,
  DEFAULT_PRODUCT_LABEL_COLOR,
  DEFAULT_PRODUCT_LABEL_TEXT_COLOR,
} from "@/lib/product-fields";
import type { LinkedCardOption } from "@/lib/product-links";

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
  promoLabelColor?: string | null;
  promoLabelTextColor?: string | null;
  madeToOrder?: boolean | null;
  madeToOrderMinQty?: number | null;
  isCuttable?: boolean | null;
  cutMetersPerRoll?: number | null;
  cutPricePerMeter?: number | null;
  cutUnitName?: string | null;
  stockQty?: number | null;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  dimensionValues?: import("@/lib/dimension-profiles").DimensionValue[] | null;
  basePrice?: number | null;
  discountType?: "percent" | "fixed" | null;
  discountValue?: number | null;
  discountBadge?: string | null;
  material?: string | null;
  linkGroupId?: string | null;
  isGroupPrimary?: boolean;
  linkedGroupTitle?: string | null;
  linkedVariantLabel?: string | null;
  linkedCards?: LinkedCardOption[];
}

export function ProductCardCompact({
  product,
  highlight,
  orderMode: _orderMode = false,
}: {
  product: CompactProduct;
  highlight?: boolean;
  /** Карточка показана в специальном блоке «Товары под заказ». */
  orderMode?: boolean;
}) {
  const { addToCart, updateQty, removeFromCart, openCartDock, cart } = useCart();

  const linkedCards =
    Array.isArray(product.linkedCards) && product.linkedCards.length >= 2
      ? product.linkedCards
      : null;

  const [selectedCardId, setSelectedCardId] = useState<string>(product.id);
  useEffect(() => {
    setSelectedCardId(product.id);
  }, [product.id]);

  const activeLinked = linkedCards
    ? linkedCards.find((c) => c.id === selectedCardId) || linkedCards[0]
    : null;

  const current: CompactProduct = activeLinked ? activeLinked : product;

  const packSize = current.packQty ? Math.max(1, Number(current.packQty)) : 1;
  const maxStock = getAvailableStockQty(current);
  const outOfStock = isOutOfStock(current);

  const [showHover, setShowHover] = useState(false);

  const inCart = cart.find((i) => i.productId === current.id && !i.variantId);
  const atMaxStock = inCart != null && inCart.quantity >= maxStock;

  const dims = formatProductSize(current);
  const discount = getCardDiscount(current);
  const displayPrice = discount.price;

  // Есть ли у вариантов разные фото — если да, показываем миниатюры прямо в чипах
  const hasDistinctVariantThumbs = Boolean(
    linkedCards &&
      linkedCards.filter((c) => Boolean(c.imageUrl)).length >= 2 &&
      new Set(linkedCards.map((c) => c.imageUrl || "")).size > 1,
  );

  function cartPayload() {
    return {
      productId: current.id,
      name: current.name,
      sku: current.sku,
      price: displayPrice as number,
      imageUrl: current.imageUrl,
      maxStock,
    };
  }

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!current.price || current.madeToOrder || outOfStock || maxStock < 1) return;
    addToCart(cartPayload(), 1);
    ymGoal("add_to_cart", { product_id: current.id });
  }

  function handleInc(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!current.price || current.madeToOrder || outOfStock || maxStock < 1) return;
    if (!inCart) {
      handleAdd(e);
      return;
    }
    const next = Math.min(inCart.quantity + 1, maxStock);
    if (next === inCart.quantity) return;
    updateQty(current.id, next);
    openCartDock({
      productId: current.id,
      name: current.name,
      imageUrl: current.imageUrl,
      price: displayPrice as number,
      qty: next,
    });
  }

  function handleDec(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!inCart) return;
    if (inCart.quantity <= 1) {
      removeFromCart(current.id);
      return;
    }
    const next = inCart.quantity - 1;
    updateQty(current.id, next);
    if (current.price != null) {
      openCartDock({
        productId: current.id,
        name: current.name,
        imageUrl: current.imageUrl,
        price: displayPrice as number,
        qty: next,
      });
    }
  }

  function handleManualQty(next: number) {
    const qty = Math.min(next, maxStock);
    if (qty < 1 || !inCart || !current.price || current.madeToOrder || outOfStock) return;
    updateQty(current.id, qty);
    openCartDock({
      productId: current.id,
      name: current.name,
      imageUrl: current.imageUrl,
      price: displayPrice as number,
      qty,
    });
  }

  return (
    <div
      className={`pcc${highlight ? " pcc--highlight" : ""}`}
      onMouseEnter={() => setShowHover(true)}
      onMouseLeave={() => setShowHover(false)}
    >
      {/* ── Фото ── */}
      <Link href={`/catalog/product/${current.slug}`} className="pcc__media">
        {current.promoLabel && (
          <span
            className="pcc__badge pcc__badge--promo"
            style={{
              backgroundColor:
                normalizeProductLabelColor(current.promoLabelColor) ||
                DEFAULT_PRODUCT_LABEL_COLOR,
              color:
                normalizeProductLabelColor(current.promoLabelTextColor) ||
                DEFAULT_PRODUCT_LABEL_TEXT_COLOR,
            }}
          >
            {current.promoLabel}
          </span>
        )}
        {discount.badge && (
          <span
            className={`pcc__badge pcc__badge--discount${current.promoLabel ? " pcc__badge--discount-shift" : ""}`}
          >
            {discount.badge}
          </span>
        )}
        {outOfStock && !current.madeToOrder && (
          <span className="pcc__badge pcc__badge--out">{OUT_OF_STOCK_LABEL}</span>
        )}
        {!current.madeToOrder && maxStock > 0 && maxStock <= 20 && (
          <span className="pcc__badge pcc__badge--low">Осталось {maxStock}</span>
        )}

        <div className="pcc__img">
          {current.imageUrl ? (
            <Image
              src={toSameOriginMediaUrl(current.imageUrl)}
              alt={current.name}
              fill
              sizes="(max-width: 640px) 44vw, (max-width: 1100px) 30vw, 260px"
              loading={highlight ? "eager" : "lazy"}
              fetchPriority={highlight ? "high" : "auto"}
              style={{ objectFit: "contain" }}
            />
          ) : (
            <span className="pcc__img-placeholder"><GlyphIcon value="box" size={40} /></span>
          )}

          {/* Hover-оверлей с характеристиками */}
          {showHover && (dims || current.material) && (
            <div className="pcc__hover-overlay">
              {dims && (
                <div className="pcc__hover-row">
                  <span className="pcc__hover-label">Размер</span>
                  <span className="pcc__hover-val">{dims}</span>
                </div>
              )}
              {current.material && (
                <div className="pcc__hover-row">
                  <span className="pcc__hover-label">Марка</span>
                  <span className="pcc__hover-val">{current.material}</span>
                </div>
              )}
              {packSize > 1 && (
                <div className="pcc__hover-row">
                  <span className="pcc__hover-label">В пачке</span>
                  <span className="pcc__hover-val">{packSize} шт.</span>
                </div>
              )}
              {!current.madeToOrder && (
                <div className="pcc__hover-row">
                  <span className="pcc__hover-label">Склад</span>
                  <span
                    className="pcc__hover-val"
                    style={{ color: maxStock > 0 ? "#5dcb61" : "#ef4444" }}
                  >
                    {maxStock > 0 ? `${maxStock} шт.` : "под заказ"}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </Link>

      {/* ── Тело ── */}
      <div className="pcc__body">
        {current.sku && <div className="pcc__sku">Арт: {current.sku}</div>}

        <Link href={`/catalog/product/${current.slug}`} className="pcc__name">
          {current.name}
        </Link>

        {dims && <div className="pcc__dims">{dims}</div>}

        {/* Мгновенный переключатель связанных карточек (как на Ozon — 0 мс, без перезагрузки) */}
        {linkedCards && (
          <div
            className="pcc__linked-options"
            role="tablist"
            aria-label={product.linkedGroupTitle || "Варианты товара"}
          >
            {linkedCards.map((opt) => {
              const isSelected = opt.id === current.id;
              const optOut = isOutOfStock(opt) || Boolean(opt.madeToOrder);
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedCardId(opt.id);
                  }}
                  className={
                    "pcc__linked-chip" +
                    (isSelected ? " pcc__linked-chip--active" : "") +
                    (optOut ? " pcc__linked-chip--out" : "")
                  }
                  title={
                    optOut
                      ? `${opt.name} — под заказ`
                      : opt.price != null
                        ? `${opt.name} — ${opt.price.toLocaleString("ru-RU")} ₽`
                        : opt.name
                  }
                >
                  {hasDistinctVariantThumbs && opt.imageUrl && (
                    <span className="pcc__linked-chip-thumb" aria-hidden="true">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={toSameOriginMediaUrl(opt.imageUrl)} alt="" />
                    </span>
                  )}
                  <span className="pcc__linked-chip-label">{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Цена */}
        <div className="pcc__prices">
          {current.madeToOrder ? (
            <span className="pcc__price-muted pcc__price-muted--mto">
              Под заказ
              {current.madeToOrderMinQty && current.madeToOrderMinQty > 1
                ? ` от ${current.madeToOrderMinQty} шт.`
                : ""}
            </span>
          ) : displayPrice != null ? (
            <>
              <div className="pcc__price-main">
                <span className={`pcc__price-val${discount.oldPrice != null ? " pcc__price-val--sale" : ""}`}>
                  {displayPrice.toLocaleString("ru-RU")}
                </span>
                <span className="pcc__price-rub">₽/шт</span>
                {discount.oldPrice != null && (
                  <span className="pcc__price-old">
                    {discount.oldPrice.toLocaleString("ru-RU")} ₽
                  </span>
                )}
              </div>
              {current.priceWholesale && current.minWholesaleQty && (
                <div className="pcc__price-wholesale">
                  <Package size={9} />
                  от {current.minWholesaleQty} шт. —{" "}
                  <strong>{current.priceWholesale.toLocaleString("ru-RU")} ₽</strong>
                </div>
              )}
              {outOfStock && (
                <span className="pcc__price-muted pcc__price-muted--out">
                  {OUT_OF_STOCK_LABEL}
                </span>
              )}
            </>
          ) : outOfStock ? (
            <span className="pcc__price-muted pcc__price-muted--out">
              {OUT_OF_STOCK_LABEL}
            </span>
          ) : (
            <span className="pcc__price-muted">Цена по запросу</span>
          )}
          {!current.madeToOrder && outOfStock && (
            <span className="pcc__mto-note">
              <Clock3 size={10} />
              Под заказ
              {current.madeToOrderMinQty && current.madeToOrderMinQty > 1
                ? ` от ${current.madeToOrderMinQty} шт.`
                : " · 2–3 дня"}
            </span>
          )}
        </div>

        {/* Действие: В корзину / Степпер / Заявка на поставку */}
        {current.madeToOrder ? (
          <PriceInquiryButton
            productName={current.name}
            productSku={current.sku}
            productImageUrl={current.imageUrl}
            className="pcc__inquiry-btn"
            label="Узнать цену"
          />
        ) : outOfStock ? (
          <PriceInquiryButton
            productName={current.name}
            productSku={current.sku}
            productImageUrl={current.imageUrl}
            className="pcc__inquiry-btn"
            label={RESTOCK_INQUIRY_LABEL}
            kind="restock"
          />
        ) : current.price == null ? (
          <PriceInquiryButton
            productName={current.name}
            productSku={current.sku}
            productImageUrl={current.imageUrl}
            className="pcc__inquiry-btn"
            label="Узнать цену"
          />
        ) : current.price != null ? (
          <div className="pcc__actions">
            {inCart ? (
              <div className="pcc__stepper">
                <button
                  type="button"
                  className="pcc__stepper-btn"
                  onClick={handleDec}
                  aria-label="Уменьшить количество"
                >
                  <Minus size={14} />
                </button>
                <EditableQuantityInput
                  value={inCart.quantity}
                  max={maxStock}
                  className="pcc__stepper-input"
                  ariaLabel="Количество"
                  onCommit={handleManualQty}
                />
                <button
                  type="button"
                  className="pcc__stepper-btn"
                  onClick={handleInc}
                  disabled={atMaxStock}
                  aria-label="Увеличить количество"
                >
                  <Plus size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleAdd}
                className="pcc__add-btn pcc__add-btn--wide"
                aria-label="Добавить в корзину"
              >
                <ShoppingCart size={14} /> В корзину
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
