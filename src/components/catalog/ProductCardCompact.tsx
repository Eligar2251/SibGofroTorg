"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/context/CartContext";
import { PriceInquiryButton } from "./PriceInquiryButton";
import {
  isOutOfStock,
  OUT_OF_STOCK_LABEL,
  RESTOCK_INQUIRY_LABEL,
} from "@/lib/stock-availability";
import { GlyphIcon } from "@/components/ui/Glyph";
import { ShoppingCart, Package, Clock3, Plus, Minus } from "lucide-react";
import { ymGoal } from "@/lib/ym";
import {
  normalizeProductLabelColor,
  DEFAULT_PRODUCT_LABEL_COLOR,
  DEFAULT_PRODUCT_LABEL_TEXT_COLOR,
} from "@/lib/product-fields";

/** Склонение для «N вариантов» на карточке. */
function pluralVariants(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "вариант";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "варианта";
  return "вариантов";
}

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
  material?: string | null;
  // ── Сводка по вариантам (если они у товара есть).
  //    Присылается сразу с getCachedProducts → здесь просто
  //    показываем «от X ₽» и бейдж «N вариантов».
  hasVariants?: boolean;
  variantCount?: number;
  variantPriceMin?: number | null;
  variantPriceMax?: number | null;
  variantTotalStock?: number;
}

export function ProductCardCompact({
  product,
  highlight,
  orderMode = false,
}: {
  product: CompactProduct;
  highlight?: boolean;
  /** Карточка показана в специальном блоке «Товары под заказ». */
  orderMode?: boolean;
}) {
  const { addToCart, updateQty, removeFromCart, openCartDock, cart } = useCart();
  const packSize = product.packQty ? Math.max(1, Number(product.packQty)) : 1;
  const maxStock = product.stockQty ?? null;
  // Нет на складе — купить нельзя (кнопка «Уточнить поступление»), но
  // если у товара задана цена, показываем её.
  const outOfStock = isOutOfStock(product);
  const orderOffer = orderMode && outOfStock;

  const [showHover, setShowHover] = useState(false);

  const inCart = cart.find((i) => i.productId === product.id);
  const atMaxStock =
    inCart != null && maxStock != null && inCart.quantity >= maxStock;

  const dims =
    product.dimensionLength && product.dimensionWidth
      ? `${product.dimensionLength}×${product.dimensionWidth}${
          product.dimensionHeight ? `×${product.dimensionHeight}` : ""
        } ${product.dimensionUnit || "мм"}`
      : null;

  function cartPayload() {
    return {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price as number,
      imageUrl: product.imageUrl,
      maxStock,
    };
  }

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!product.price || product.madeToOrder || outOfStock) return;
    addToCart(cartPayload(), 1);
    ymGoal("add_to_cart", { product_id: product.id });
  }

  function handleInc(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!product.price || product.madeToOrder || outOfStock) return;
    if (!inCart) {
      handleAdd(e);
      return;
    }
    const next =
      maxStock != null ? Math.min(inCart.quantity + 1, maxStock) : inCart.quantity + 1;
    if (next === inCart.quantity) return;
    updateQty(product.id, next);
    openCartDock({
      productId: product.id,
      name: product.name,
      imageUrl: product.imageUrl,
      price: product.price,
      qty: next,
    });
  }

  function handleDec(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!inCart) return;
    if (inCart.quantity <= 1) {
      removeFromCart(product.id);
      return;
    }
    const next = inCart.quantity - 1;
    updateQty(product.id, next);
    if (product.price != null) {
      openCartDock({
        productId: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        price: product.price,
        qty: next,
      });
    }
  }

  return (
    <div
      className={`pcc${highlight ? " pcc--highlight" : ""}`}
      onMouseEnter={() => setShowHover(true)}
      onMouseLeave={() => setShowHover(false)}
    >
      {/* ── Фото ── */}
      <Link href={`/catalog/product/${product.slug}`} className="pcc__media">
        {product.promoLabel && (
          <span
            className="pcc__badge pcc__badge--promo"
            style={{
              // Цвет метки всегда задаётся инлайном: так смена цвета в админке
              // сразу отражается на сайте и не «перебивается» CSS-фоллбеком.
              backgroundColor:
                normalizeProductLabelColor(product.promoLabelColor) ||
                DEFAULT_PRODUCT_LABEL_COLOR,
              color:
                normalizeProductLabelColor(product.promoLabelTextColor) ||
                DEFAULT_PRODUCT_LABEL_TEXT_COLOR,
            }}
          >
            {product.promoLabel}
          </span>
        )}
        {outOfStock && (
          <span className="pcc__badge pcc__badge--out">{OUT_OF_STOCK_LABEL}</span>
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
              sizes="(max-width: 640px) 44vw, (max-width: 1100px) 30vw, 260px"
              /* Раньше здесь стоял priority={highlight}: Next добавлял
                 <link rel="preload"> на первую карточку КАЖДОЙ секции
                 (главная, каталог, подборки) — браузер ругался
                 "preloaded but not used". Достаточно eager-загрузки. */
              loading={highlight ? "eager" : "lazy"}
              fetchPriority={highlight ? "high" : "auto"}
              /* Фото целиком в плитке: без обрезки кромок (contain).
                 Отступ от краёв задаётся в CSS (.pcc__img img). */
              style={{ objectFit: "contain" }}
            />
          ) : (
            <span className="pcc__img-placeholder"><GlyphIcon value="box" size={40} /></span>
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
        </Link>

        {/* Размер — отдельной строкой под названием (не внутри ссылки):
           раньше висел внутри .pcc__name и «съедался» 2-строчным
           line-clamp, когда название длинное. Теперь всегда виден. */}
        {dims && <div className="pcc__dims">{dims}</div>}

        {/* Цена — шт + партия. Если у товара есть варианты,
           показываем «от X ₽» (по минимальной цене).
           У товаров «под заказ» и без цены цену не выводим;
           у остальных цена видна всегда — в том числе когда
           товара нет в наличии (тогда ниже метка «Нет в наличии»,
           а вместо кнопки покупки — «Уточнить поступление»). */}
        <div className="pcc__prices">
          {product.madeToOrder ? (
            <span className="pcc__price-muted pcc__price-muted--mto">
              Под заказ{product.madeToOrderMinQty ? ` от ${product.madeToOrderMinQty} шт.` : ""}
            </span>
          ) : product.price != null ? (
            <>
              <div className="pcc__price-main">
                {/* «от» — только когда есть варианты с разной ценой */}
                {product.hasVariants && product.variantPriceMin !== product.variantPriceMax && (
                  <span className="pcc__price-from">от{"\u00a0"}</span>
                )}
                <span className="pcc__price-val">
                  {product.price.toLocaleString("ru-RU")}
                </span>
                <span className="pcc__price-rub">₽/шт</span>
              </div>
              {/* Бейдж «N вариантов» — намекает, что есть выбор */}
              {product.hasVariants && product.variantCount ? (
                <div className="pcc__variants-badge">
                  {product.variantCount}{" "}
                  {pluralVariants(product.variantCount)}
                </div>
              ) : null}
              {product.priceWholesale && product.minWholesaleQty && (
                <div className="pcc__price-wholesale">
                  <Package size={9} />
                  от {product.minWholesaleQty} шт. —{" "}
                  <strong>{product.priceWholesale.toLocaleString("ru-RU")} ₽</strong>
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
          {orderOffer && (
            <span className="pcc__mto-note">
              <Clock3 size={10} />
              Под заказ{product.madeToOrderMinQty ? ` от ${product.madeToOrderMinQty} шт.` : " · 2–3 дня"}
            </span>
          )}
        </div>

        {/* Управление количеством: степпер без суммы на карточке —
           итог показывается в попапе над плавающей корзиной. */}
        {orderOffer ? (
          <PriceInquiryButton
            productName={product.name}
            productSku={product.sku}
            productImageUrl={product.imageUrl}
            className="pcc__inquiry-btn"
            label="Заказать поставку"
            kind="restock"
          />
        ) : outOfStock ? (
          <PriceInquiryButton
            productName={product.name}
            productSku={product.sku}
            productImageUrl={product.imageUrl}
            className="pcc__inquiry-btn"
            label={RESTOCK_INQUIRY_LABEL}
            kind="restock"
          />
        ) : product.madeToOrder ? (
          <PriceInquiryButton
            productName={product.name}
            productSku={product.sku}
            productImageUrl={product.imageUrl}
            className="pcc__inquiry-btn"
            label="Узнать цену"
          />
        ) : product.price == null ? (
          <PriceInquiryButton
            productName={product.name}
            productSku={product.sku}
            productImageUrl={product.imageUrl}
            className="pcc__inquiry-btn"
            label="Узнать цену"
          />
        ) : product.price != null ? (
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
                <span className="pcc__stepper-input" aria-live="polite">
                  {inCart.quantity}
                </span>
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