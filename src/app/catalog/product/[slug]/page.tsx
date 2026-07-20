import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import Image from "next/image";
import {
  getProductBySlug,
  getRelatedProducts,
  getAllCategories,
  getProductReviews,
  getProductReviewStats,
} from "@/lib/firestore-queries";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { AddToCartButton } from "@/components/catalog/AddToCartButton";
import { PriceInquiryButton } from "@/components/catalog/PriceInquiryButton";
import { MarkdownText } from "@/components/catalog/MarkdownText";
import { stripMarkdown } from "@/lib/markdown";
import { ProductViewTracker } from "@/components/catalog/ProductViewTracker";
import { Stars } from "@/components/catalog/Stars";
import { ReviewForm } from "@/components/catalog/ReviewForm";
import { ReviewHelpfulButton } from "@/components/catalog/ReviewHelpfulButton";
import {
  FirestoreCategory,
  FirestoreProduct,
  getProductEffectivePrice,
} from "@/lib/types";
import { SITE_ADDRESS } from "@/lib/site-config";
import {
  BadgeCheck,
  Barcode,
  FileText,
  MapPin,
  MessageSquare,
  ShoppingCart,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  SITE_URL,
  SITE_NAME,
  buildBreadcrumbJsonLd,
  buildProductJsonLd,
} from "@/lib/seo";

export const revalidate = 120;

/* ── Склонение слов: plural(5, "отзыв", "отзыва", "отзывов") ── */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/* ── Формат даты отзыва (Firestore Timestamp | string | Date) ── */
function formatReviewDate(ts: unknown): string {
  try {
    const v = ts as { toDate?: () => Date } | string | number | Date | null;
    if (v == null) return "";
    const d =
      typeof v === "object" && !(v instanceof Date) && "toDate" in v
        ? (v as { toDate: () => Date }).toDate()
        : new Date(v as string | number | Date);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

const EMPTY_REVIEW_STATS = {
  averageRating: 0,
  totalReviews: 0,
  distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  withPhotos: 0,
  withProsCons: 0,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Товар не найден" };

  const effectivePrice = getProductEffectivePrice(product);
  const title = `${product.name} купить в Новосибирске`;
  const description = product.description
    ? stripMarkdown(product.description).slice(0, 160)
    : `${product.name}${
      effectivePrice != null
        ? ` — ${effectivePrice.toLocaleString("ru-RU")} ₽`
        : ""
    }. Доставка и самовывоз в Новосибирске. ${SITE_NAME}.`;

  return {
    title,
    description,
    alternates: {
      canonical: `${SITE_URL}/catalog/product/${product.slug}`,
    },
    openGraph: {
      title: `${title} — ${SITE_NAME}`,
      description,
      url: `${SITE_URL}/catalog/product/${product.slug}`,
      images: product.imageUrl ? [{ url: product.imageUrl }] : undefined,
      type: "website",
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  /* Все выборки параллельно — один раундтрип к кэшу данных */
  const [allCats, reviews, reviewStats, related] = await Promise.all([
    getAllCategories(),
    /* Отзывы и статистика — не критичны для рендера страницы,
       при ошибке (нет индекса и т.п.) показываем пустую секцию */
    getProductReviews(product.id, {
      limitCount: 8,
      onlyApproved: true,
      sortBy: "newest",
    }).catch(() => []),
    getProductReviewStats(product.id).catch(() => EMPTY_REVIEW_STATS),
    product.categoryId
      ? getRelatedProducts(product.categoryId, product.id, 4).catch(() => [])
      : Promise.resolve([]),
  ]);

  const category = allCats.find(
    (c: FirestoreCategory) => c.id === product.categoryId
  );

  const effectivePrice = getProductEffectivePrice(product);
  const hasDiscount =
    product.price != null &&
    effectivePrice != null &&
    effectivePrice < product.price;
  const oldPrice =
    hasDiscount && product.price != null ? product.price : null;
  const discountPercent =
    hasDiscount && oldPrice != null && effectivePrice != null
      ? Math.round((1 - effectivePrice / oldPrice) * 100)
      : 0;

  const dims =
    product.dimensionLength && product.dimensionWidth
      ? `${product.dimensionLength}×${product.dimensionWidth}${
          product.dimensionHeight ? `×${product.dimensionHeight}` : ""
        } ${product.dimensionUnit || "мм"}`
      : null;

  const specs = [
    dims && { label: "Размеры (ДхШхВ)", value: dims },
    product.material && { label: "Материал", value: product.material },
    product.packQty && {
      label: "В упаковке",
      value: `${product.packQty} шт.`,
    },
    product.weight && {
      label: "Вес единицы",
      value: `${product.weight} кг`,
    },
    product.volume && { label: "Объём", value: `${product.volume} л` },
    product.note && { label: "Примечание", value: product.note },
  ].filter(Boolean) as { label: string; value: string }[];

  /* ── Галерея: собираем список изображений ── */
  const galleryImages: { url: string; alt: string }[] = [];
  if (product.images && product.images.length > 0) {
    product.images.forEach((img, i) =>
      galleryImages.push({ url: img.url, alt: `${product.name} фото ${i + 1}` })
    );
  } else if (product.imageUrl) {
    galleryImages.push({ url: product.imageUrl, alt: product.name });
  }
  const hasThumbs = galleryImages.length > 1;

  /* ── JSON-LD ── */
  const breadcrumb = buildBreadcrumbJsonLd(
    [
      { name: "Главная", url: SITE_URL },
      { name: "Каталог", url: `${SITE_URL}/catalog` },
      category
        ? { name: category.name, url: `${SITE_URL}/catalog/${category.slug}` }
        : null,
      {
        name: product.name,
        url: `${SITE_URL}/catalog/product/${product.slug}`,
      },
    ].filter(Boolean) as { name: string; url: string }[]
  );

  const productLd = buildProductJsonLd({
    name: product.name,
    slug: product.slug,
    description: product.description
      ? stripMarkdown(product.description)
      : product.description,
    sku: product.sku,
    price: effectivePrice ?? product.price,
    imageUrl: product.imageUrl,
    inStock: product.inStock,
  });

  /* ── Хлебные крошки ── */
  const breadcrumbTrail = [
    { name: "Главная", url: "/" },
    { name: "Каталог", url: "/catalog" },
    ...(category
      ? [{ name: category.name, url: `/catalog/${category.slug}` }]
      : []),
    { name: product.name, url: null },
  ];

  const { averageRating, totalReviews } = reviewStats;

  return (
    <div className="pdp-page">
      <JsonLd data={[breadcrumb, productLd]} />
      <ProductViewTracker productId={product.id} />

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
                <span
                  key={idx}
                  className={`thumb${idx === 0 ? " active" : ""}`}
                >
                  <Image
                    src={img.url}
                    alt={img.alt}
                    width={72}
                    height={72}
                    style={{ objectFit: "cover", width: "100%", height: "100%" }}
                  />
                </span>
              ))}
            </div>
          )}

          {/* ── 2. ГЛАВНОЕ ФОТО ── */}
          <div className="gallery-main">
            {product.imageUrl ? (
              /* Фото в фактических пропорциях: контейнер повторяет
                 соотношение сторон изображения, ничего не обрезается */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                className="gallery-main__img"
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
            ) : (
              <span className="pdp-img-placeholder"><GlyphIcon value="box" size={64} /></span>
            )}
            {/* Бейджи акций/скидок — левый верхний угол фото */}
            {(product.promoLabel || discountPercent > 0) && (
              <div className="gallery-badges">
                {product.promoLabel && (
                  <span className="badge-promo">{product.promoLabel}</span>
                )}
                {discountPercent > 0 && (
                  <span className="badge-discount">−{discountPercent}%</span>
                )}
              </div>
            )}
            {/* Наличие — бейдж на фото (правый верхний угол) */}
            {product.inStock ? (
              <span className="badge-stock badge-stock--in">
                <span className="badge-stock__label">
                  <span className="pdp-stock-dot pdp-stock-dot--in" />
                  В наличии
                </span>
                {product.stockQty != null && product.stockQty <= 30 && (
                  <span className="badge-stock__qty">
                    осталось {product.stockQty} шт.
                  </span>
                )}
              </span>
            ) : (
              <span className="badge-stock badge-stock--out">
                <span className="badge-stock__label">
                  <span className="pdp-stock-dot pdp-stock-dot--out" />
                  Нет в наличии
                </span>
              </span>
            )}
          </div>

          {/* ── 3. ЦЕНТРАЛЬНАЯ КОЛОНКА: заголовок + характеристики ── */}
          <div className="product-col">
            <div className="product-head">
              {/* Заголовок */}
              <h1 className="product-title">{product.name}</h1>

            {/* Рейтинг */}
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

            {/* Бренд */}
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
            {/* /product-head */}

            {/* ── 4. ХАРАКТЕРИСТИКИ ── */}
            <div className="product-info">
              {/* Характеристики — сразу под заголовком */}
              <div className="specs-section">
                <div className="specs-header">
                  <span className="specs-title">Характеристики</span>
                </div>
                <div className="specs-table">
                  {specs.length > 0 ? (
                    specs.map((s, idx) => (
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
          {/* /product-col */}

          {/* ── ОПИСАНИЕ — под фото, полностью (markdown) ── */}
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
              {/* Цена */}
              {product.madeToOrder ? (
                <div className="pdp-price-row">
                  <span className="pdp-price-current pdp-price-current--mto">
                    Под заказ
                  </span>
                </div>
              ) : effectivePrice == null ? (
                <div className="pdp-price-row">
                  <span className="pdp-price-current pdp-price-current--mto">
                    Цена по запросу
                  </span>
                </div>
              ) : (
                effectivePrice != null && (
                  <div className="pdp-price-row">
                    <span className="pdp-price-current">
                      {effectivePrice.toLocaleString("ru-RU")}{"\u00a0₽"}
                    </span>
                    {oldPrice != null && (
                      <span className="pdp-price-old">
                        {oldPrice.toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                    {discountPercent > 0 && (
                      <span className="pdp-price-save">−{discountPercent}%</span>
                    )}
                  </div>
                )
              )}

              {/* Оптовая цена */}
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

              {/* Форма сайта: количество + добавление в корзину */}
              <div className="pdp-cart-block">
                {product.madeToOrder ? (
                  <div className="pdp-made-to-order">
                    <div className="pdp-made-to-order__text">
                      <FileText size={15} />
                      Изготавливается под заказ — оставьте заявку, менеджер
                      рассчитает стоимость и сроки
                    </div>
                    <PriceInquiryButton
                      productName={product.name}
                      productSku={product.sku}
                      className="pdp-made-to-order__btn"
                      label="Узнать цену"
                    />
                  </div>
                ) : effectivePrice == null ? (
                  <div className="pdp-made-to-order">
                    <div className="pdp-made-to-order__text">
                      <FileText size={15} />
                      Цена по запросу — оставьте заявку, менеджер сообщит
                      актуальную стоимость и сроки
                    </div>
                    <PriceInquiryButton
                      productName={product.name}
                      productSku={product.sku}
                      className="pdp-made-to-order__btn"
                      label="Узнать цену"
                    />
                  </div>
                ) : product.inStock ? (
                  <AddToCartButton
                    product={{
                      id: product.id,
                      name: product.name,
                      sku: product.sku,
                      price: effectivePrice ?? product.price,
                      imageUrl: product.imageUrl,
                      stockQty: product.stockQty,
                      packQty: product.packQty,
                    }}
                  />
                ) : (
                  <div className="pdp-made-to-order">
                    <div className="pdp-out-of-stock">
                      <ShoppingCart size={15} />
                      Товара нет в наличии — оставьте заявку, уточним сроки
                      поставки и цену
                    </div>
                    <PriceInquiryButton
                      productName={product.name}
                      productSku={product.sku}
                      className="pdp-made-to-order__btn"
                      label="Узнать цену"
                    />
                  </div>
                )}
              </div>

              {/* Доставка и самовывоз */}
              <div className="delivery-section">
                <div className="delivery-row">
                  <MapPin size={16} className="delivery-ic" />
                  <div className="delivery-info">
                    <div className="delivery-address">
                      Самовывоз: {SITE_ADDRESS}
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

        {/* Похожие товары */}
        {related.length > 0 && (
          <div className="pdp-related bottom-section">
            <div className="section-title">Похожие товары</div>
            <div className="product-grid-compact">
              {related.map((p: FirestoreProduct) => (
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
              {/* Сводка */}
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
                    const cnt =
                      reviewStats.distribution[
                        s as keyof typeof reviewStats.distribution
                      ] ?? 0;
                    const pct =
                      totalReviews > 0
                        ? Math.round((cnt / totalReviews) * 100)
                        : 0;
                    return (
                      <div key={s} className="reviews-bar-row">
                        <span className="reviews-bar-star">{s} <GlyphIcon value="star" size={11} /></span>
                        <span className="reviews-bar">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="reviews-bar-count">{cnt}</span>
                      </div>
                    );
                  })}
                </div>

                <ReviewForm productId={product.id} />
              </aside>

              {/* Список отзывов */}
              <div className="reviews-list">
                {reviews.map((r) => {
                  const date = formatReviewDate(r.createdAt);
                  return (
                    <article key={r.id} className="review-card">
                      <div className="review-head">
                        {r.userAvatar ? (
                          <span className="review-avatar review-avatar--img">
                            <Image
                              src={r.userAvatar}
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
                            {date && (
                              <span className="review-date">{date}</span>
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
                                src={im.url}
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
                  );
                })}
              </div>
            </div>
          ) : (
            /* Пустое состояние */
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
                <ReviewForm productId={product.id} />
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
