import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlug, getRelatedProducts, getAllCategories } from "@/lib/firestore-queries";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { AddToCartButton } from "@/components/catalog/AddToCartButton";
import { QuickOrderForm } from "@/components/forms/QuickOrderForm";
import { FirestoreCategory, FirestoreProduct, getProductEffectivePrice } from "@/lib/types";
import { BadgeCheck, ShieldAlert, Star, MessageSquare, Truck, ShieldCheck, HelpCircle, MessageCircle, ChevronRight, Heart, RotateCcw, Share2, GitCompare, Search } from "lucide-react";
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
    `${product.name}${effectivePrice != null ? ` — ${effectivePrice.toLocaleString("ru-RU")} ₽` : ""}. Доставка и самовывоз в Новосибирске. ${SITE_NAME}.`;

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

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const allCats = await getAllCategories();
  const category = allCats.find((c: FirestoreCategory) => c.id === product.categoryId);
  const related = product.categoryId ? await getRelatedProducts(product.categoryId, product.id, 4) : [];

  const effectivePrice = getProductEffectivePrice(product);
  const hasDiscount = product.price != null && effectivePrice != null && effectivePrice < product.price;
  const oldPrice = hasDiscount && product.price != null ? product.price : null;

  // Цвет бейджа скидки
  let badgeColorBg = "rgba(22, 163, 74, 0.12)";
  let badgeColorText = "#16a34a";
  if (product.discountValue && product.discountValue >= 10 && product.discountValue <= 20) {
    badgeColorBg = "rgba(200, 134, 10, 0.12)";
    badgeColorText = "#c8860a";
  } else if (product.discountValue && product.discountValue > 20) {
    badgeColorBg = "rgba(184, 58, 30, 0.12)";
    badgeColorText = "#b83a1e";
  }

  const dims = product.dimensionLength && product.dimensionWidth
    ? `${product.dimensionLength}×${product.dimensionWidth}${product.dimensionHeight ? `×${product.dimensionHeight}` : ""} ${product.dimensionUnit || "мм"}`
    : null;

  const specs = [
    dims && { icon: "📏", label: "Размеры (ДхШхВ)", value: dims },
    product.material && { icon: "🪵", label: "Материал", value: product.material },
    product.packQty && { icon: "📦", label: "В упаковке", value: `${product.packQty} шт.` },
    product.weight && { icon: "⚖️", label: "Вес единицы", value: `${product.weight} кг` },
    product.volume && { icon: "🧊", label: "Объём", value: `${product.volume} л` },
    product.note && { icon: "📝", label: "Примечание", value: product.note },
  ].filter(Boolean) as { icon: string; label: string; value: string }[];

  const breadcrumb = buildBreadcrumbJsonLd(
    [
      { name: "Главная", url: SITE_URL },
      { name: "Каталог", url: `${SITE_URL}/catalog` },
      category
        ? {
            name: category.name,
            url: `${SITE_URL}/catalog/${category.slug}`,
          }
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

  // Build breadcrumb trail for display
  const breadcrumbTrail = [
    { name: "Каталог", url: "/catalog" },
    ...(category ? [{ name: category.name, url: `/catalog/${category.slug}` }] : []),
    { name: product.name, url: null },
  ];

  return (
    <div style={{ backgroundColor: "var(--bg-main)", paddingBottom: "64px" }}>
      <JsonLd data={[breadcrumb, productLd]} />

      {/* Хлебные крошки в стиле Ozon */}
      <div className="pdp-breadcrumbs-bar">
        <div className="container-wide pdp-breadcrumbs">
          <div className="pdp-breadcrumbs-left">
            {breadcrumbTrail.map((item, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span className="pdp-breadcrumb-sep">•</span>}
                {item.url ? (
                  <Link href={item.url} className="pdp-breadcrumb-link">
                    {item.name}
                  </Link>
                ) : (
                  <span className="pdp-breadcrumb-current">{item.name}</span>
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="pdp-breadcrumbs-right">
            {product.sku && <span className="pdp-article">Артикул: {product.sku}</span>}
            <button className="pdp-breadcrumb-btn" title="В сравнение">
              <GitCompare size={16} /> В сравнение
            </button>
            <button className="pdp-breadcrumb-btn" title="Поделиться">
              <Share2 size={16} /> Поделиться
            </button>
          </div>
        </div>
      </div>

      <div className="container-wide" style={{ marginTop: "20px" }}>
        {/* Основной блок - 3 колонки */}
        <div className="pdp-marketplace-layout">

          {/* ЛЕВАЯ КОЛОНКА: Галерея с миниатюрами */}
          <div className="pdp-col-gallery">
            <div className="pdp-gallery-wrapper">
              {/* Миниатюры слева */}
              <div className="pdp-thumbs">
                {product.images && product.images.length > 0 ? (
                  product.images.map((img, idx) => (
                    <button
                      key={idx}
                      className={`pdp-thumb ${idx === 0 ? "active" : ""}`}
                      aria-label={`Фото ${idx + 1}`}
                    >
                      <Image
                        src={img.url}
                        alt={`${product.name} фото ${idx + 1}`}
                        width={72}
                        height={72}
                        style={{ objectFit: "cover" }}
                      />
                    </button>
                  ))
                ) : product.imageUrl ? (
                  <button className="pdp-thumb active" aria-label="Фото 1">
                    <Image
                      src={product.imageUrl}
                      alt={product.name}
                      width={72}
                      height={72}
                      style={{ objectFit: "cover" }}
                    />
                  </button>
                ) : (
                  <button className="pdp-thumb active" aria-label="Фото 1">
                    <span className="pdp-thumb-placeholder">📦</span>
                  </button>
                )}
                {/* Видео заглушка */}
                <button className="pdp-thumb pdp-thumb-video" aria-label="Видео">
                  <span className="pdp-thumb-video-content">
                    <span className="pdp-play-icon">▶</span>
                    +1 видео
                  </span>
                </button>
              </div>

              {/* Главное фото */}
              <div className="pdp-main-image-wrapper">
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
                <div className="pdp-badge-returns">✓ 0% возвратов ›</div>
                <div className="pdp-badge-zoom">🔍</div>
              </div>
            </div>
          </div>

          {/* ЦЕНТРАЛЬНАЯ КОЛОНКА: Информация о товаре */}
          <div className="pdp-col-center">
            <div className="pdp-product-info">
              {/* Заголовок */}
              <h1 className="pdp-title">{product.name}</h1>

              {/* Рейтинг */}
              <div className="pdp-rating-row">
                <div className="pdp-rating-stars">
                  <span className="pdp-star">★</span>
                  4.9
                </div>
                <span className="pdp-rating-dot">•</span>
                <a href="#reviews" className="pdp-rating-link">21 отзыв</a>
                <span className="pdp-rating-dot">•</span>
                <a href="#questions" className="pdp-questions-link">
                  <MessageCircle size={13} /> 7 вопросов
                </a>
              </div>

              {/* Бренд */}
              <div className="pdp-brand-row">
                <div className="pdp-brand-logo">С</div>
                <div>
                  <div className="pdp-brand-name">
                    СибГофроТорг <BadgeCheck size={14} style={{ color: "#16a34a", display: "inline" }} />
                  </div>
                  <div className="pdp-brand-sub">Производитель • ГОСТ</div>
                </div>
              </div>

              {/* Варианты - заглушка (если нет данных о вариантах, не показываем) */}
              {false && (
                <>
                  <div className="pdp-variants-section">
                    <div className="pdp-variants-label">Название цвета:</div>
                    <div className="pdp-variants-list">
                      <button className="pdp-variant-btn active">Black</button>
                      <button className="pdp-variant-btn">Pink</button>
                      <button className="pdp-variant-btn">Teal</button>
                      <button className="pdp-variant-btn">Ultramarine</button>
                      <button className="pdp-variant-btn">White</button>
                    </div>
                  </div>
                  <div className="pdp-variants-section">
                    <div className="pdp-variants-label">Встроенная память:</div>
                    <div className="pdp-variants-list">
                      <button className="pdp-variant-btn">256 ГБ</button>
                      <button className="pdp-variant-btn active">128 ГБ</button>
                    </div>
                  </div>
                </>
              )}

              {/* Характеристики "О товаре" */}
              <div className="pdp-specs-section">
                <div className="pdp-specs-header">
                  <span className="pdp-specs-title">О товаре</span>
                  <a href="#description" className="pdp-specs-link">
                    Перейти к описанию <ChevronRight size={14} />
                  </a>
                </div>
                <div className="pdp-specs-table">
                  {specs.map((s, idx) => (
                    <div key={idx} className="pdp-spec-row">
                      <div className="pdp-spec-name">
                        {s.icon} {s.label}
                        <span className="pdp-spec-help">ⓘ</span>
                      </div>
                      <div className="pdp-spec-value">{s.value}</div>
                    </div>
                  ))}
                  {specs.length === 0 && (
                    <div className="pdp-spec-row">
                      <div className="pdp-spec-name">Характеристики уточняйте у менеджера</div>
                      <div className="pdp-spec-value">—</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Описание */}
              {product.description && (
                <div className="pdp-description-section" id="description">
                  <h2 className="pdp-section-title">Описание</h2>
                  <p className="pdp-desc">{product.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* ПРАВАЯ КОЛОНКА: Блок покупки */}
          <div className="pdp-col-buybox">
            <div className="pdp-purchase-block">
              <div className="pdp-purchase-card">
                {/* Распродажа - показываем только если есть скидка */}
                {hasDiscount && (
                  <div className="pdp-sale-badge-row">
                    <div className="pdp-sale-badge-left">
                      <div className="pdp-sale-icon">%</div>
                      <div>
                        <div className="pdp-sale-text">Распродажа</div>
                        <div className="pdp-sale-stock">
                          {product.stockQty != null && product.stockQty <= 30
                            ? `${product.stockQty} единиц осталось`
                            : "Ограниченное количество"}
                        </div>
                      </div>
                    </div>
                    <div className="pdp-sale-days">
                      {product.discountBadge ? `${product.discountBadge} до конца` : "7 дней до конца"}
                    </div>
                  </div>
                )}

                {/* Цена */}
                {effectivePrice != null && (
                  <>
                    <div className="pdp-price-main">
                      <div className="pdp-price-badge">{effectivePrice.toLocaleString("ru-RU")} ₽</div>
                      <div className="pdp-price-card-label">с картой магазина</div>
                      <div className="pdp-price-arrow">›</div>
                    </div>
                    <div className="pdp-price-secondary">
                      <span className="pdp-price-regular">
                        {hasDiscount && oldPrice != null
                          ? oldPrice.toLocaleString("ru-RU")
                          : effectivePrice.toLocaleString("ru-RU")}
                        ₽
                      </span>
                      {hasDiscount && oldPrice != null && (
                        <span className="pdp-price-old">{oldPrice.toLocaleString("ru-RU")} ₽</span>
                      )}
                      <span className="pdp-price-no-card">без карты</span>
                    </div>
                    <div className="pdp-cheaper-row">
                      ♻ Стало дешевле ›
                    </div>
                  </>
                )}

                {/* Оптовая цена */}
                {product.priceWholesale != null && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #f0f0f0" }}>
                    <div style={{ fontSize: 13, color: "#8b8b8b" }}>Опт: <strong style={{ color: "var(--ok)", fontSize: 15 }}>{product.priceWholesale.toLocaleString("ru-RU")} ₽</strong>{product.minWholesaleQty && ` (от ${product.minWholesaleQty} шт.)`}</div>
                  </div>
                )}

                {/* Оплатить позже */}
                <div className="pdp-pay-later-row">
                  <button className="pdp-btn-pay-later">Оплатить позже</button>
                  <span className="pdp-pay-later-text">без % до 12 января</span>
                </div>

                {/* Хочу скидку */}
                <div className="pdp-want-discount">
                  <Heart size={14} style={{ color: "#8b8b8b" }} /> Хочу скидку
                </div>

                {/* Добавить в корзину */}
                <div className="pdp-cart-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                  <button className="pdp-btn-wishlist" title="В избранное" aria-label="В избранное">
                    <Heart size={20} />
                  </button>
                </div>

                <div className="pdp-delivery-text">Доставим с завтрашнего дня</div>

                {/* Есть дешевле */}
                <div className="pdp-cheaper-card">
                  <div className="pdp-cheaper-img">📦</div>
                  <div className="pdp-cheaper-info">
                    <div className="pdp-cheaper-title">Есть дешевле</div>
                    <div className="pdp-cheaper-price">от {(effectivePrice ?? product.price ?? 0) * 0.85} ₽</div>
                  </div>
                  <div className="pdp-cheaper-count">5 ›</div>
                </div>

                {/* Купить в один клик */}
                <div style={{ marginBottom: 16 }}>
                  <QuickOrderForm productName={product.name} />
                </div>

                {/* FAQ */}
                <div className="pdp-faq-section">
                  <div className="pdp-faq-title">Часто задаваемые вопросы</div>
                  <div className="pdp-faq-links">
                    <a href="/delivery" className="pdp-faq-link">Условия доставки</a>
                    <a href="/delivery" className="pdp-faq-link">Возврат товаров</a>
                    <a href="#" className="pdp-faq-link">Способы оплаты</a>
                    <a href="#" className="pdp-faq-link">Возврат денег</a>
                  </div>
                </div>

                {/* Доставка и возврат */}
                <div className="pdp-delivery-section">
                  <div className="pdp-delivery-title">Доставка и возврат</div>
                  <div className="pdp-delivery-row">
                    <div className="pdp-delivery-icon">📍</div>
                    <div className="pdp-delivery-info">
                      <div className="pdp-delivery-address">Новосибирск, ул. Примерная, 1</div>
                      <div className="pdp-delivery-from">Со склада продавца, Новосибирск</div>
                    </div>
                    <div className="pdp-delivery-arrow">›</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ПОХОЖИЕ ТОВАРЫ */}
        {related.length > 0 && (
          <div className="pdp-related" style={{ marginTop: 32 }}>
            <h2 className="pdp-related__title">Похожие товары</h2>
            <div className="product-grid-compact">
              {related.map((p: FirestoreProduct) => (
                <ProductCardCompact key={p.id} product={p} />
              ))}
            </div>
          </div>
        )}

        {/* НИЖНИЙ БЛОК: Фото покупателей */}
        <div className="pdp-bottom-section">
          <div className="pdp-bottom-section-title">Фото и видео покупателей</div>
          <div className="pdp-buyer-photos">
            {product.images && product.images.length > 0
              ? product.images.slice(0, 4).map((img, idx) => (
                  <div key={idx} className="pdp-buyer-photo">
                    <Image src={img.url} alt="" width={80} height={80} style={{ objectFit: "cover" }} />
                  </div>
                ))
              : product.imageUrl
              ? [...Array(4)].map((_, idx) => (
                  <div key={idx} className="pdp-buyer-photo">
                    <Image src={product.imageUrl!} alt="" width={80} height={80} style={{ objectFit: "cover" }} />
                  </div>
                ))
              : [...Array(4)].map((_, idx) => (
                  <div key={idx} className="pdp-buyer-photo" style={{ background: "#e0e0e0" }}>📦</div>
                ))}
            <div className="pdp-buyer-photo">
              <div className="pdp-buyer-photo-more">+{Math.max(0, (product.images?.length || 1) - 4) + 2}</div>
            </div>
          </div>
        </div>

        {/* НИЖНИЙ БЛОК: Полные характеристики */}
        {specs.length > 0 && (
          <div className="pdp-bottom-section">
            <div className="pdp-bottom-section-title">Характеристики</div>
            <div className="pdp-full-specs-table">
              <div className="pdp-full-specs-group">
                <div className="pdp-full-specs-group-title">Основные</div>
                {specs.map((s, idx) => (
                  <div key={idx} className="pdp-full-spec-row">
                    <div className="pdp-full-spec-name">{s.icon} {s.label}</div>
                    <div className="pdp-full-spec-value">{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* НИЖНИЙ БЛОК: Отзывы */}
        <div className="pdp-bottom-section" id="reviews">
          <div className="pdp-bottom-section-title">Отзывы • 0</div>
          <div className="pdp-reviews-placeholder">
            <div className="pdp-reviews-placeholder-icon">💬</div>
            <p style={{ fontSize: 15, marginBottom: 8 }}>Пока нет отзывов</p>
            <p style={{ fontSize: 13 }}>Будьте первым, кто оставит отзыв об этом товаре</p>
          </div>
        </div>

        {/* НИЖНИЙ БЛОК: Вопросы */}
        <div className="pdp-bottom-section" id="questions">
          <div className="pdp-bottom-section-title">Вопросы и ответы • 0</div>
          <div className="pdp-reviews-placeholder">
            <div className="pdp-reviews-placeholder-icon">❓</div>
            <p style={{ fontSize: 15, marginBottom: 8 }}>Пока нет вопросов</p>
            <p style={{ fontSize: 13 }}>Задайте вопрос продавцу или покупателям</p>
          </div>
        </div>

      </div>
    </div>
  );
}