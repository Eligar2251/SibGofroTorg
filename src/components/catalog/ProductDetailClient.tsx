"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  BadgeCheck,
  Barcode,
  FileText,
  MapPin,
  MessageSquare,
  ShoppingCart,
} from "lucide-react";
import { ProductCardCompact } from "./ProductCardCompact";
import { ProductPurchaseBlock } from "./ProductPurchaseBlock";
import { PriceInquiryButton } from "./PriceInquiryButton";
import { MarkdownText } from "./MarkdownText";
import { ProductViewTracker } from "./ProductViewTracker";
import { Stars } from "./Stars";
import { ReviewForm } from "./ReviewForm";
import { ReviewHelpfulButton } from "./ReviewHelpfulButton";
import { GlyphIcon } from "@/components/ui/Glyph";
import { toSameOriginMediaUrl } from "@/lib/media";
import {
  normalizeProductLabelColor,
  DEFAULT_PRODUCT_LABEL_COLOR,
  DEFAULT_PRODUCT_LABEL_TEXT_COLOR,
} from "@/lib/product-fields";
import {
  OUT_OF_STOCK_LABEL,
  RESTOCK_INQUIRY_LABEL,
} from "@/lib/stock-availability";
import type { CardProduct } from "@/lib/product-card";

export interface PdpReviewItem {
  id: string;
  userName: string;
  userAvatar: string | null;
  rating: number;
  date: string;
  isVerifiedPurchase: boolean;
  title: string | null;
  text: string;
  pros: string | null;
  cons: string | null;
  images: { url: string }[];
  helpfulCount: number;
}

export interface PdpReviewStats {
  averageRating: number;
  totalReviews: number;
  distribution: Record<number, number>;
}

export interface PdpCardEntry {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  label: string;
  isPrimary: boolean;
  categoryName: string | null;
  categorySlug: string | null;
  description: string | null;
  imageUrl: string | null;
  galleryImages: { url: string; alt: string }[];
  promoLabel: string | null;
  promoLabelColor: string | null;
  promoLabelTextColor: string | null;
  madeToOrder: boolean;
  madeToOrderMinQty: number | null;
  outOfStock: boolean;
  stockQty: number | null;
  packQty: number | null;
  displayPrice: number | null;
  oldPrice: number | null;
  discountPercent: number;
  priceWholesale: number | null;
  minWholesaleQty: number | null;
  specs: { label: string; value: string }[];
  reviews: PdpReviewItem[];
  reviewStats: PdpReviewStats;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function ProductDetailClient({
  initialProductId,
  cards,
  groupTitle,
  related,
  siteAddress,
  siteName,
}: {
  initialProductId: string;
  cards: PdpCardEntry[];
  groupTitle: string;
  related: CardProduct[];
  siteAddress: string;
  siteName: string;
}) {
  const [activeId, setActiveId] = useState<string>(initialProductId);
  const [activeImgIdx, setActiveImgIdx] = useState<number>(0);

  useEffect(() => {
    setActiveId(initialProductId);
    setActiveImgIdx(0);
  }, [initialProductId]);

  // Поддержка кнопок Назад/Вперёд браузера при переключении URL без перезагрузки
  useEffect(() => {
    function handlePopState() {
      const path = window.location.pathname || "";
      const prefix = "/catalog/product/";
      if (!path.startsWith(prefix)) return;
      const currentSlug = decodeURIComponent(path.slice(prefix.length));
      const matched = cards.find((c) => c.slug === currentSlug);
      if (matched) {
        setActiveId(matched.id);
        setActiveImgIdx(0);
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [cards]);

  const product = cards.find((c) => c.id === activeId) || cards[0];
  const hasLinkedCards = cards.length >= 2;

  function handleSelectLinkedCard(next: PdpCardEntry) {
    if (next.id === product.id) return;
    setActiveId(next.id);
    setActiveImgIdx(0);

    // Мгновенно обновляем адресную строку и title без сетевых запросов
    if (typeof window !== "undefined") {
      const targetUrl = `/catalog/product/${next.slug}`;
      if (window.location.pathname !== targetUrl) {
        window.history.replaceState(null, "", targetUrl);
      }
      document.title = `${next.name} купить в Новосибирске — ${siteName}`;
    }
  }

  const galleryImages = product.galleryImages;
  const hasThumbs = galleryImages.length > 1;
  const activeImage =
    galleryImages[activeImgIdx] ||
    galleryImages[0] ||
    (product.imageUrl ? { url: product.imageUrl, alt: product.name } : null);

  const breadcrumbTrail = [
    { name: "Главная", url: "/" },
    { name: "Каталог", url: "/catalog" },
    ...(product.categoryName && product.categorySlug
      ? [
          {
            name: product.categoryName,
            url: `/catalog/${product.categorySlug}`,
          },
        ]
      : []),
    { name: product.name, url: null as string | null },
  ];

  const { averageRating, totalReviews } = product.reviewStats;

  return (
    <>
      <ProductViewTracker key={product.id} productId={product.id} />

      {/* ══ ХЛЕБНЫЕ КРОШКИ ══ */}
      <div className="pdp-breadcrumb-bar">
        <div className="container-wide">
          <div className="breadcrumbs pdp-breadcrumbs">
            <div className="breadcrumbs-left">
              {breadcrumbTrail.map((item, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="bc-sep">›</span>}
                  {item.url ? (
                    <Link href={item.url} className="bc-link">
                      {item.name}
                    </Link>
                  ) : (
                    <span className="bc-current">{item.name}</span>
                  )}
                </React.Fragment>
              ))}
            </div>

            {product.sku && (
              <div className="breadcrumbs-right">
                <span className="bc-sku">
                  <Barcode size={14} strokeWidth={2} />
                  Артикул: {product.sku}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ ОСНОВНОЙ БЛОК ══ */}
      <div className="container-wide pdp-main-wrap">
        <div
          className={`product-page${hasThumbs ? "" : " product-page--no-thumbs"}`}
        >
          {/* ── 1. МИНИАТЮРЫ (только если фото больше одного) ── */}
          {hasThumbs && (
            <div className="gallery-thumbs">
              {galleryImages.map((img, idx) => (
                <button
                  key={`${product.id}-thumb-${idx}`}
                  type="button"
                  onClick={() => setActiveImgIdx(idx)}
                  className={`thumb${idx === activeImgIdx ? " active" : ""}`}
                  style={{ padding: 0, cursor: "pointer" }}
                  aria-label={`Фото ${idx + 1}`}
                >
                  <Image
                    src={toSameOriginMediaUrl(img.url)}
                    alt={img.alt}
                    width={72}
                    height={72}
                    style={{ objectFit: "cover", width: "100%", height: "100%" }}
                  />
                </button>
              ))}
            </div>
          )}

          {/* ── 2. ГЛАВНОЕ ФОТО ── */}
          <div className="gallery-main">
            {activeImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={toSameOriginMediaUrl(activeImage.url)}
                alt={activeImage.alt || product.name}
                className="gallery-main__img"
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
            ) : (
              <span className="pdp-img-placeholder">
                <GlyphIcon value="box" size={64} />
              </span>
            )}
            {(product.promoLabel || product.discountPercent > 0) && (
              <div className="gallery-badges">
                {product.promoLabel && (
                  <span
                    className="badge-promo"
                    style={{
                      backgroundColor:
                        normalizeProductLabelColor(product.promoLabelColor) ||
                        DEFAULT_PRODUCT_LABEL_COLOR,
                      color:
                        normalizeProductLabelColor(
                          product.promoLabelTextColor,
                        ) || DEFAULT_PRODUCT_LABEL_TEXT_COLOR,
                    }}
                  >
                    {product.promoLabel}
                  </span>
                )}
                {product.discountPercent > 0 && (
                  <span className="badge-discount">
                    −{product.discountPercent}%
                  </span>
                )}
              </div>
            )}
            {product.madeToOrder ? (
              <span className="badge-stock badge-stock--out">
                <span className="badge-stock__label">
                  <span className="pdp-stock-dot pdp-stock-dot--out" />
                  Под заказ
                </span>
              </span>
            ) : !product.outOfStock ? (
              <span className="badge-stock badge-stock--in">
                <span className="badge-stock__label">
                  <span className="pdp-stock-dot pdp-stock-dot--in" />
                  В наличии
                </span>
                {product.stockQty != null && product.stockQty <= 30 && (
                  <span className="badge-stock__qty">
                    осталось {Math.floor(product.stockQty)} шт.
                  </span>
                )}
              </span>
            ) : (
              <span className="badge-stock badge-stock--out">
                <span className="badge-stock__label">
                  <span className="pdp-stock-dot pdp-stock-dot--out" />
                  {OUT_OF_STOCK_LABEL}
                </span>
              </span>
            )}
          </div>

          {/* ── 3. ЦЕНТРАЛЬНАЯ КОЛОНКА: заголовок + связка карточек (как на Ozon) + характеристики ── */}
          <div className="product-col">
            <div className="product-head">
              <h1 className="product-title">{product.name}</h1>

              <div className="rating-row">
                {totalReviews > 0 ? (
                  <>
                    <Stars value={averageRating} size={15} />
                    <span className="rating-value">
                      {averageRating.toFixed(1)}
                    </span>
                    <span className="rating-dot">•</span>
                    <a href="#reviews" className="rating-link">
                      {totalReviews}{" "}
                      {plural(totalReviews, "отзыв", "отзыва", "отзывов")}
                    </a>
                  </>
                ) : (
                  <a href="#reviews" className="rating-link rating-link--muted">
                    Отзывов пока нет — будьте первым
                  </a>
                )}
              </div>

              <div className="brand-row">
                <div className="brand-logo">С</div>
                <div>
                  <div className="brand-name">
                    СибГофроТорг{" "}
                    <BadgeCheck
                      size={14}
                      style={{ color: "#16a34a", display: "inline" }}
                    />
                  </div>
                  <div className="brand-sub">Производитель • ГОСТ</div>
                </div>
              </div>
            </div>

            {/* ── МГНОВЕННЫЙ ПЕРЕКЛЮЧАТЕЛЬ СВЯЗАННЫХ КАРТОЧЕК (КАК НА OZON) ── */}
            {hasLinkedCards && (
              <div className="ozon-links" aria-label={groupTitle}>
                <div className="ozon-links__header">
                  <span className="ozon-links__label">{groupTitle}:</span>
                  <span className="ozon-links__selected">{product.label}</span>
                </div>
                <div className="ozon-links__grid" role="tablist">
                  {cards.map((card) => {
                    const isSelected = card.id === product.id;
                    const isUnavailable = card.outOfStock || card.madeToOrder;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        onClick={() => handleSelectLinkedCard(card)}
                        className={
                          "ozon-links__item" +
                          (isSelected ? " ozon-links__item--active" : "") +
                          (isUnavailable ? " ozon-links__item--out" : "")
                        }
                      >
                        <span className="ozon-links__thumb">
                          {card.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={toSameOriginMediaUrl(card.imageUrl)}
                              alt=""
                              loading="eager"
                              decoding="async"
                            />
                          ) : (
                            <GlyphIcon value="box" size={18} />
                          )}
                        </span>
                        <span className="ozon-links__meta">
                          <span className="ozon-links__item-title">
                            {card.label}
                          </span>
                          <span className="ozon-links__item-price">
                            {card.madeToOrder
                              ? "Под заказ"
                              : card.outOfStock
                                ? card.displayPrice != null
                                  ? `${card.displayPrice.toLocaleString("ru-RU")} ₽ · под заказ`
                                  : "Под заказ"
                                : card.displayPrice != null
                                  ? `${card.displayPrice.toLocaleString("ru-RU")} ₽`
                                  : "По запросу"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 4. ХАРАКТЕРИСТИКИ ── */}
            <div className="product-info">
              <div className="specs-section">
                <div className="specs-header">
                  <span className="specs-title">Характеристики</span>
                </div>
                <div className="specs-table">
                  {product.specs.length > 0 ? (
                    product.specs.map((s, idx) => (
                      <div key={idx} className="spec-row">
                        <div className="spec-name">{s.label}</div>
                        <div className="spec-value">{s.value}</div>
                      </div>
                    ))
                  ) : (
                    <div className="spec-row">
                      <div className="spec-name">Характеристики</div>
                      <div className="spec-value">уточняйте у менеджера</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── ОПИСАНИЕ ── */}
          {product.description && (
            <div id="description" className="pdp-desc-block">
              <h2 className="pdp-desc-title">Описание</h2>
              <MarkdownText
                text={product.description}
                className="pdp-desc-text"
              />
            </div>
          )}

          {/* ── 4. БЛОК ПОКУПКИ ── */}
          <div className="purchase-block">
            <div className="purchase-card">
              {product.madeToOrder ? (
                <div
                  className="pdp-price-row"
                  style={{
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 6,
                  }}
                >
                  <span className="pdp-price-current pdp-price-current--mto">
                    Под заказ
                    {product.madeToOrderMinQty && product.madeToOrderMinQty > 1
                      ? ` от ${product.madeToOrderMinQty} шт.`
                      : ""}
                  </span>
                  {product.madeToOrderMinQty && product.madeToOrderMinQty > 1 && (
                    <span
                      style={{
                        fontSize: 13,
                        color: "var(--ink-soft, #666)",
                        fontWeight: 500,
                      }}
                    >
                      Минимальный заказ: {product.madeToOrderMinQty} шт.
                    </span>
                  )}
                </div>
              ) : product.displayPrice != null ? (
                <div className="pdp-price-row">
                  <span className="pdp-price-current">
                    {product.displayPrice.toLocaleString("ru-RU")}
                    {"\u00a0₽"}
                  </span>
                  {product.oldPrice != null && (
                    <span className="pdp-price-old">
                      {product.oldPrice.toLocaleString("ru-RU")} ₽
                    </span>
                  )}
                  {product.discountPercent > 0 && (
                    <span className="pdp-price-save">
                      −{product.discountPercent}%
                    </span>
                  )}
                  {product.outOfStock && (
                    <span className="pdp-price-out-note">
                      {OUT_OF_STOCK_LABEL}
                    </span>
                  )}
                </div>
              ) : product.outOfStock ? (
                <div className="pdp-price-row">
                  <span className="pdp-price-current pdp-price-current--out">
                    {OUT_OF_STOCK_LABEL}
                  </span>
                </div>
              ) : (
                <div className="pdp-price-row">
                  <span className="pdp-price-current pdp-price-current--mto">
                    Цена по запросу
                  </span>
                </div>
              )}

              {!product.madeToOrder && product.priceWholesale != null && (
                <div className="pdp-wholesale-row">
                  <span className="pdp-wholesale-label">Опт:</span>
                  <strong className="pdp-wholesale-price">
                    {product.priceWholesale.toLocaleString("ru-RU")} ₽
                  </strong>
                  {product.minWholesaleQty && (
                    <span className="pdp-wholesale-min">
                      от {product.minWholesaleQty} шт.
                    </span>
                  )}
                </div>
              )}

              <div className="pdp-cart-block">
                {product.madeToOrder ? (
                  <div className="pdp-made-to-order">
                    <div className="pdp-made-to-order__text">
                      <FileText size={15} />
                      Под заказ
                      {product.madeToOrderMinQty && product.madeToOrderMinQty > 1
                        ? ` от ${product.madeToOrderMinQty} шт.`
                        : ""}{" "}
                      — оставьте заявку, менеджер рассчитает стоимость и сроки
                    </div>
                    <PriceInquiryButton
                      productName={product.name}
                      productSku={product.sku}
                      productImageUrl={product.imageUrl}
                      className="pdp-made-to-order__btn"
                      label="Узнать цену"
                    />
                  </div>
                ) : product.outOfStock ? (
                  <div className="pdp-made-to-order">
                    <div className="pdp-out-of-stock">
                      <ShoppingCart size={15} />
                      Под заказ · 2–3 дня — товара сейчас нет на складе, оставьте
                      заявку на поставку
                    </div>
                    <PriceInquiryButton
                      productName={product.name}
                      productSku={product.sku}
                      productImageUrl={product.imageUrl}
                      className="pdp-made-to-order__btn"
                      label={RESTOCK_INQUIRY_LABEL}
                      kind="restock"
                    />
                  </div>
                ) : product.displayPrice == null ? (
                  <div className="pdp-made-to-order">
                    <div className="pdp-made-to-order__text">
                      <FileText size={15} />
                      Цена по запросу — оставьте заявку, менеджер сообщит
                      актуальную стоимость и сроки
                    </div>
                    <PriceInquiryButton
                      productName={product.name}
                      productSku={product.sku}
                      productImageUrl={product.imageUrl}
                      className="pdp-made-to-order__btn"
                      label="Узнать цену"
                    />
                  </div>
                ) : (
                  <ProductPurchaseBlock
                    product={{
                      id: product.id,
                      name: product.name,
                      sku: product.sku,
                      price: product.displayPrice,
                      imageUrl: product.imageUrl,
                      stockQty: product.stockQty,
                      packQty: product.packQty,
                    }}
                  />
                )}
              </div>

              <div className="delivery-section">
                <div className="delivery-row">
                  <MapPin size={16} className="delivery-ic" />
                  <div className="delivery-info">
                    <div className="delivery-address">
                      Самовывоз: {siteAddress}
                    </div>
                    <div className="delivery-from">
                      Доставка по Новосибирску и всей России
                    </div>
                  </div>
                </div>
                <Link href="/delivery" className="delivery-link">
                  Условия доставки и оплаты →
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ══ НИЖНИЕ БЛОКИ ══ */}
        {related.length > 0 && (
          <div className="pdp-related bottom-section">
            <div className="section-title">Похожие товары</div>
            <div className="product-grid-compact">
              {related.map((p) => (
                <ProductCardCompact key={p.id} product={p} />
              ))}
            </div>
          </div>
        )}

        {/* ══ ОТЗЫВЫ ══ */}
        <div className="bottom-section" id="reviews">
          <div className="section-title">
            Отзывы
            {totalReviews > 0 && (
              <span className="reviews-title-count"> · {totalReviews}</span>
            )}
          </div>

          {totalReviews > 0 ? (
            <div className="reviews-layout">
              <aside className="reviews-summary">
                <div className="reviews-score-row">
                  <div className="reviews-score">
                    {averageRating.toFixed(1)}
                  </div>
                  <div>
                    <Stars value={averageRating} size={17} />
                    <div className="reviews-total">
                      {totalReviews}{" "}
                      {plural(totalReviews, "отзыв", "отзыва", "отзывов")}
                    </div>
                  </div>
                </div>

                <div className="reviews-bars">
                  {[5, 4, 3, 2, 1].map((s) => {
                    const cnt = product.reviewStats.distribution[s] ?? 0;
                    const pct =
                      totalReviews > 0
                        ? Math.round((cnt / totalReviews) * 100)
                        : 0;
                    return (
                      <div key={s} className="reviews-bar-row">
                        <span className="reviews-bar-star">
                          {s} <GlyphIcon value="star" size={11} />
                        </span>
                        <span className="reviews-bar">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="reviews-bar-count">{cnt}</span>
                      </div>
                    );
                  })}
                </div>

                <ReviewForm key={product.id} productId={product.id} />
              </aside>

              <div className="reviews-list">
                {product.reviews.map((r) => (
                  <article key={r.id} className="review-card">
                    <div className="review-head">
                      {r.userAvatar ? (
                        <span className="review-avatar review-avatar--img">
                          <Image
                            src={toSameOriginMediaUrl(r.userAvatar)}
                            alt=""
                            width={42}
                            height={42}
                            style={{ objectFit: "cover" }}
                          />
                        </span>
                      ) : (
                        <span className="review-avatar">
                          {r.userName?.trim()?.[0]?.toUpperCase() || "П"}
                        </span>
                      )}
                      <div className="review-author">
                        <div className="review-name">
                          {r.userName || "Покупатель"}
                        </div>
                        <div className="review-meta">
                          <Stars value={r.rating} size={13} />
                          {r.date && (
                            <span className="review-date">{r.date}</span>
                          )}
                        </div>
                      </div>
                      {r.isVerifiedPurchase && (
                        <span className="review-verified">
                          Подтверждённая покупка
                        </span>
                      )}
                    </div>

                    {r.title && <div className="review-title">{r.title}</div>}
                    <p className="review-text">{r.text}</p>

                    {(r.pros || r.cons) && (
                      <div className="review-pros-cons">
                        {r.pros && (
                          <div className="review-pc">
                            <span className="review-pc__label review-pc__label--plus">
                              Достоинства
                            </span>
                            <p>{r.pros}</p>
                          </div>
                        )}
                        {r.cons && (
                          <div className="review-pc">
                            <span className="review-pc__label review-pc__label--minus">
                              Недостатки
                            </span>
                            <p>{r.cons}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {r.images && r.images.length > 0 && (
                      <div className="review-photos">
                        {r.images.map((im, i) => (
                          <span key={i} className="review-photo">
                            <Image
                              src={toSameOriginMediaUrl(im.url)}
                              alt={`Фото покупателя ${i + 1}`}
                              width={64}
                              height={64}
                              style={{ objectFit: "cover" }}
                            />
                          </span>
                        ))}
                      </div>
                    )}

                    <ReviewHelpfulButton
                      productId={product.id}
                      reviewId={r.id}
                      initialCount={r.helpfulCount || 0}
                    />
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="reviews-empty">
              <div className="reviews-empty__icon">
                <MessageSquare size={26} />
              </div>
              <div className="reviews-empty__title">Пока нет отзывов</div>
              <p className="reviews-empty__sub">
                Будьте первым, кто поделится впечатлением об этом товаре — это
                поможет другим покупателям
              </p>
              <div className="reviews-empty__form">
                <ReviewForm key={product.id} productId={product.id} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
