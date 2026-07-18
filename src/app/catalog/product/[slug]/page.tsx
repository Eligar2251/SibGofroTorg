import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProductBySlug,
  getRelatedProducts,
  getAllCategories,
} from "@/lib/firestore-queries";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { AddToCartButton } from "@/components/catalog/AddToCartButton";
import { QuickOrderForm } from "@/components/forms/QuickOrderForm";
import {
  FirestoreCategory,
  FirestoreProduct,
  getProductEffectivePrice,
} from "@/lib/types";
import { BadgeCheck } from "lucide-react";
import Image from "next/image";
import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  SITE_URL,
  SITE_NAME,
  buildBreadcrumbJsonLd,
  buildProductJsonLd,
} from "@/lib/seo";

export const revalidate = 120;

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
  const description =
    product.description?.slice(0, 160) ||
    `${product.name}${
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

  const allCats = await getAllCategories();
  const category = allCats.find(
    (c: FirestoreCategory) => c.id === product.categoryId
  );
  const related = product.categoryId
    ? await getRelatedProducts(product.categoryId, product.id, 4)
    : [];

  const effectivePrice = getProductEffectivePrice(product);
  const hasDiscount =
    product.price != null &&
    effectivePrice != null &&
    effectivePrice < product.price;
  const oldPrice =
    hasDiscount && product.price != null ? product.price : null;

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
    description: product.description,
    sku: product.sku,
    price: effectivePrice ?? product.price,
    imageUrl: product.imageUrl,
    inStock: product.inStock,
  });

  /* ── Хлебные крошки ── */
  const breadcrumbTrail = [
    { name: "Каталог", url: "/catalog" },
    ...(category
      ? [{ name: category.name, url: `/catalog/${category.slug}` }]
      : []),
    { name: product.name, url: null },
  ];

  return (
    <div className="pdp-page">
      <JsonLd data={[breadcrumb, productLd]} />

      {/* ══ ХЛЕБНЫЕ КРОШКИ ══ */}
      <div className="pdp-breadcrumb-bar">
        <div className="container-wide">
          <div className="breadcrumbs pdp-breadcrumbs">
            {/* Левая часть */}
            <div className="breadcrumbs-left">
              {breadcrumbTrail.map((item, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="bc-sep">•</span>}
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

            {/* Правая часть */}
            <div className="breadcrumbs-right">
              {product.sku && (
                <span className="bc-sku">🔖 Артикул: {product.sku}</span>
              )}
              <button className="bc-action-btn" type="button">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                  <polyline points="15 18 21 12 15 6" />
                </svg>
                В сравнение
              </button>
              <button className="bc-action-btn" type="button">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
                  <line x1="15.41" x2="8.57" y1="6.51" y2="10.49" />
                </svg>
                Поделиться
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ══ ОСНОВНОЙ БЛОК ══ */}
      <div className="container-wide pdp-main-wrap">
        <div className="product-page">

          {/* ── 1. МИНИАТЮРЫ ── */}
          <div className="gallery-thumbs">
            {galleryImages.length > 0 ? (
              galleryImages.map((img, idx) => (
                <button
                  key={idx}
                  className={`thumb${idx === 0 ? " active" : ""}`}
                  aria-label={`Фото ${idx + 1}`}
                  type="button"
                >
                  <Image
                    src={img.url}
                    alt={img.alt}
                    width={72}
                    height={72}
                    style={{ objectFit: "cover", width: "100%", height: "100%" }}
                  />
                </button>
              ))
            ) : (
              <button className="thumb active" aria-label="Фото 1" type="button">
                <span className="thumb-placeholder">📦</span>
              </button>
            )}
            {/* Видео-заглушка */}
            <button className="thumb thumb-video" aria-label="Видео" type="button">
              <span className="play-icon">▶</span>
              <span className="thumb-video-label">+1 видео</span>
            </button>
          </div>

          {/* ── 2. ГЛАВНОЕ ФОТО ── */}
          <div className="gallery-main">
            {product.imageUrl ? (
              <Image
                src={product.imageUrl}
                alt={product.name}
                fill
                style={{ objectFit: "contain", padding: "16px" }}
                sizes="(max-width: 768px) 100vw, 480px"
                priority
              />
            ) : (
              <span className="pdp-img-placeholder">📦</span>
            )}
            <div className="badge-returns">✓ 0% возвратов ›</div>
            <div className="badge-zoom">🔍</div>
          </div>

          {/* ── 3. ИНФОРМАЦИЯ О ТОВАРЕ ── */}
          <div className="product-info">

            {/* Заголовок */}
            <h1 className="product-title">
              {product.name}
              <span className="show-more">ещё</span>
            </h1>

            {/* Рейтинг */}
            <div className="rating-row">
              <div className="rating-stars">
                <span className="star">★</span>
                {product.averageRating && product.averageRating > 0
                  ? product.averageRating.toFixed(1)
                  : "4.9"}
              </div>
              <span className="rating-dot">•</span>
              <a href="#reviews" className="rating-link">
                {product.totalReviews && product.totalReviews > 0
                  ? `${product.totalReviews} отзывов`
                  : "0 отзывов"}
              </a>
              <span className="rating-dot">•</span>
              <a href="#questions" className="questions-link">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Вопросы
              </a>
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

            {/* Наличие */}
            <div className="pdp-stock-row">
              {product.inStock ? (
                <span className="pdp-status--in">
                  <span className="pdp-stock-dot pdp-stock-dot--in" />
                  В наличии
                  {product.stockQty != null && product.stockQty <= 30 && (
                    <span className="pdp-status-qty">
                      осталось {product.stockQty} шт.
                    </span>
                  )}
                </span>
              ) : (
                <span className="pdp-status--out">
                  <span className="pdp-stock-dot pdp-stock-dot--out" />
                  Нет в наличии
                </span>
              )}
            </div>

            {/* Характеристики */}
            <div className="specs-section">
              <div className="specs-header">
                <span className="specs-title">О товаре</span>
                <a href="#full-specs" className="specs-link">
                  Перейти к описанию
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </a>
              </div>
              <div className="specs-table">
                {specs.length > 0 ? (
                  specs.map((s, idx) => (
                    <div key={idx} className="spec-row">
                      <div className="spec-name">
                        {s.label}
                        <span className="spec-help">ⓘ</span>
                      </div>
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

            {/* Описание */}
            {product.description && (
              <div id="description" className="pdp-desc-block">
                <h2 className="pdp-desc-title">Описание</h2>
                <p className="pdp-desc-text">{product.description}</p>
              </div>
            )}
          </div>

          {/* ── 4. БЛОК ПОКУПКИ ── */}
          <div className="purchase-block">
            <div className="purchase-card">

              {/* Распродажа */}
              {hasDiscount && (
                <div className="sale-badge-row">
                  <div className="sale-badge-left">
                    <div className="sale-icon">%</div>
                    <div>
                      <div className="sale-text">Распродажа</div>
                      <div className="sale-stock">
                        {product.stockQty != null && product.stockQty <= 30
                          ? `${product.stockQty} единиц осталось`
                          : "Ограниченное количество"}
                      </div>
                    </div>
                  </div>
                  <div className="sale-days">
                    {product.discountBadge
                      ? `${product.discountBadge} до конца`
                      : "7 дней до конца"}
                  </div>
                </div>
              )}

              {/* Цена */}
              {effectivePrice != null && (
                <>
                  <div className="price-main">
                    <div className="price-badge">
                      {effectivePrice.toLocaleString("ru-RU")} ₽
                    </div>
                    <div className="price-card-label">с картой магазина</div>
                    <div className="price-arrow">›</div>
                  </div>

                  <div className="price-secondary">
                    <span className="price-regular">
                      {hasDiscount && oldPrice != null
                        ? oldPrice.toLocaleString("ru-RU")
                        : effectivePrice.toLocaleString("ru-RU")}{" "}
                      ₽
                    </span>
                    {hasDiscount && oldPrice != null && (
                      <span className="price-old">
                        {oldPrice.toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                    <span className="price-no-card">без карты</span>
                  </div>

                  <div className="cheaper-row">♻ Стало дешевле ›</div>
                </>
              )}

              {/* Оптовая цена */}
              {product.priceWholesale != null && (
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

              {/* Оплатить позже */}
              <div className="pay-later-row">
                <button className="btn-pay-later" type="button">
                  Оплатить позже
                </button>
                <span className="pay-later-text">без % до 12 января</span>
              </div>

              {/* Хочу скидку */}
              <button className="want-discount" type="button">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.77-8.77 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                Хочу скидку
              </button>

              {/* Добавить в корзину */}
              <div className="cart-row">
                <div className="cart-row__btn">
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
                </div>
                <button
                  className="btn-wishlist"
                  type="button"
                  title="В избранное"
                  aria-label="В избранное"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.77-8.77 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </button>
              </div>

              <div className="delivery-text">Доставим с завтрашнего дня</div>

              {/* Есть дешевле */}
              <div className="cheaper-card">
                <div className="cheaper-img">📦</div>
                <div className="cheaper-info">
                  <div className="cheaper-title">Есть дешевле</div>
                  <div className="cheaper-price">
                    от{" "}
                    {Math.round(
                      (effectivePrice ?? product.price ?? 0) * 0.85
                    ).toLocaleString("ru-RU")}{" "}
                    ₽
                  </div>
                </div>
                <div className="cheaper-count">5 ›</div>
              </div>

              {/* Купить в один клик */}
              <div className="pdp-quick-order">
                <QuickOrderForm productName={product.name} variant="light" />
              </div>

              {/* FAQ */}
              <div className="faq-section">
                <div className="faq-title">Часто задаваемые вопросы</div>
                <div className="faq-links">
                  <Link href="/delivery" className="faq-link">
                    Условия доставки
                  </Link>
                  <Link href="/delivery" className="faq-link">
                    Возврат товаров
                  </Link>
                  <a href="#" className="faq-link">
                    Способы оплаты
                  </a>
                  <a href="#" className="faq-link">
                    Возврат денег
                  </a>
                </div>
              </div>

              {/* Доставка и возврат */}
              <div className="delivery-section">
                <div className="delivery-title">Доставка и возврат</div>
                <div className="delivery-row">
                  <div className="delivery-icon">📍</div>
                  <div className="delivery-info">
                    <div className="delivery-address">
                      Новосибирск, ул. Примерная, 1
                    </div>
                    <div className="delivery-from">
                      Со склада продавца, Новосибирск
                    </div>
                  </div>
                  <div className="delivery-arrow">›</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ══ НИЖНИЕ БЛОКИ ══ */}

        {/* Фото покупателей */}
        <div className="bottom-section pdp-buyer-photos-section">
          <div className="section-title">Фото и видео покупателей</div>
          <div className="buyer-photos">
            {galleryImages.length > 0
              ? galleryImages.slice(0, 4).map((img, idx) => (
                  <div key={idx} className="buyer-photo">
                    <Image
                      src={img.url}
                      alt=""
                      width={80}
                      height={80}
                      style={{ objectFit: "cover", width: "100%", height: "100%" }}
                    />
                  </div>
                ))
              : [1, 2, 3, 4].map((n) => (
                  <div key={n} className="buyer-photo buyer-photo--empty">
                    📦
                  </div>
                ))}
            <div className="buyer-photo">
              <div className="buyer-photo-more">
                +{Math.max(2, (product.images?.length ?? 1) - 3)}
              </div>
            </div>
          </div>
        </div>

        {/* Полные характеристики */}
        {specs.length > 0 && (
          <div className="bottom-section" id="full-specs">
            <div className="section-title">Характеристики</div>
            <div className="pdp-full-specs">
              <div className="pdp-full-specs__group-title">Основные</div>
              {specs.map((s, idx) => (
                <div key={idx} className="spec-row">
                  <div className="spec-name">{s.label}</div>
                  <div className="spec-value">{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* Отзывы */}
        <div className="bottom-section" id="reviews">
          <div className="section-title">Отзывы • 0</div>
          <div className="pdp-empty-block">
            <div className="pdp-empty-block__icon">💬</div>
            <p className="pdp-empty-block__title">Пока нет отзывов</p>
            <p className="pdp-empty-block__sub">
              Будьте первым, кто оставит отзыв об этом товаре
            </p>
          </div>
        </div>

        {/* Вопросы */}
        <div className="bottom-section" id="questions">
          <div className="section-title">Вопросы и ответы • 0</div>
          <div className="pdp-empty-block">
            <div className="pdp-empty-block__icon">❓</div>
            <p className="pdp-empty-block__title">Пока нет вопросов</p>
            <p className="pdp-empty-block__sub">
              Задайте вопрос продавцу или покупателям
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}