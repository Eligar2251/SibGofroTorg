import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlug, getRelatedProducts, getAllCategories } from "@/lib/firestore-queries";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { AddToCartButton } from "@/components/catalog/AddToCartButton";
import { QuickOrderForm } from "@/components/forms/QuickOrderForm";
import { FirestoreCategory, FirestoreProduct, getProductEffectivePrice } from "@/lib/types";
import { BadgeCheck, ShieldAlert, Star, MessageSquare, Truck, ShieldCheck, HelpCircle } from "lucide-react";
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

  return (
    <div style={{ backgroundColor: "var(--bg-main)", paddingBottom: "64px" }}>
      <JsonLd data={[breadcrumb, productLd]} />

      {/* Хлебные крошки */}
      <div className="breadcrumb-bar">
        <div className="container-wide breadcrumbs">
          <Link href="/">Главная</Link>
          <span>/</span>
          <Link href="/catalog">Каталог</Link>
          {category && (
            <>
              <span>/</span>
              <Link href={`/catalog/${category.slug}`}>{category.name}</Link>
            </>
          )}
          <span>/</span>
          <span style={{ maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {product.name}
          </span>
        </div>
      </div>

      <div className="container-wide" style={{ marginTop: "20px" }}>
        {/* Marketplace PDP Layout */}
        <div className="pdp-marketplace-layout">

          {/* Левая колонка: Галерея фото */}
          <div className="pdp-col-gallery">
            <div className="pdp-img-container">
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  fill
                  style={{ objectFit: "contain", padding: "16px" }}
                  sizes="(max-width: 768px) 100vw, 440px"
                  priority
                />
              ) : (
                <span className="pdp-img-placeholder">📦</span>
              )}
              {product.promoLabel && (
                <span className="pdp-badge pdp-badge--promo">{product.promoLabel}</span>
              )}
              {hasDiscount && product.discountBadge && (
                <span
                  className="pdp-badge"
                  style={{
                    background: badgeColorBg,
                    color: badgeColorText,
                    border: `1px solid ${badgeColorText}`,
                    top: product.promoLabel ? "44px" : "12px",
                  }}
                >
                  {product.discountBadge}
                </span>
              )}
              {!product.inStock && (
                <span className="pdp-badge pdp-badge--out">Нет в наличии</span>
              )}
            </div>
          </div>

          {/* Центральная колонка: Информация, бренд, О товаре */}
          <div className="pdp-col-center">
            <div className="pdp-head">
              {product.sku && <div className="pdp-sku">Артикул: {product.sku}</div>}
              <h1 className="pdp-title">{product.name}</h1>

              <div className="pdp-rating-row">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 700, color: "#d97706" }}>
                  <Star size={15} fill="#d97706" /> 4.9
                </span>
                <span className="text-muted">· 24 отзыва</span>
                <span className="text-muted" style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 8 }}>
                  <MessageSquare size={13} /> 6 вопросов
                </span>
              </div>

              <div className="pdp-brand-box">
                <span className="pdp-brand-logo">С</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>СибГофроТорг <BadgeCheck size={14} style={{ color: "#16a34a", display: "inline" }} /></div>
                  <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>Производитель • ГОСТ</div>
                </div>
              </div>

              <div className="pdp-status">
                {product.inStock ? (
                  <span className="pdp-status--in">
                    <BadgeCheck size={14} /> В наличии на складе
                    {product.stockQty != null && product.stockQty <= 30 && (
                      <span className="pdp-status-qty"> · осталось {product.stockQty} шт.</span>
                    )}
                  </span>
                ) : (
                  <span className="pdp-status--out">
                    <ShieldAlert size={14} /> Под заказ (изготовление от 2 дней)
                  </span>
                )}
              </div>
            </div>

            {/* О товаре (Характеристики) */}
            <div className="pdp-about-section">
              <h3 className="pdp-section-h3">О товаре</h3>
              {specs.length > 0 ? (
                <div className="pdp-specs-grid">
                  {specs.map((s, idx) => (
                    <div key={idx} className="pdp-spec-row">
                      <span className="pdp-spec-label">{s.icon} {s.label}</span>
                      <span className="pdp-spec-val">{s.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>Характеристики уточняйте у менеджера</p>
              )}
            </div>

            {/* Описание */}
            {product.description && (
              <div className="pdp-about-section">
                <h3 className="pdp-section-h3">Описание</h3>
                <p className="pdp-desc">{product.description}</p>
              </div>
            )}
          </div>

          {/* Правая колонка: Buy-Box (Купить, цена, доставка) */}
          <div className="pdp-col-buybox">
            <div className="pdp-buybox-card">
              {/* Цена */}
              {effectivePrice != null && (
                <div className="pdp-buybox-price">
                  <div className="pdp-buybox-current">
                    {effectivePrice.toLocaleString("ru-RU")} <span>₽</span>
                  </div>
                  {hasDiscount && product.price != null && (
                    <div className="pdp-buybox-old">
                      {product.price.toLocaleString("ru-RU")} ₽
                    </div>
                  )}
                  {hasDiscount && product.discountBadge && (
                    <span className="pdp-buybox-badge" style={{ background: badgeColorBg, color: badgeColorText }}>
                      {product.discountBadge}
                    </span>
                  )}
                </div>
              )}

              {product.priceWholesale != null && (
                <div className="pdp-buybox-wholesale">
                  Опт: <strong>{product.priceWholesale.toLocaleString("ru-RU")} ₽</strong>
                  {product.minWholesaleQty && <span> (от {product.minWholesaleQty} шт.)</span>}
                </div>
              )}

              <div className="pdp-buybox-divider" />

              {/* Кнопка Добавить в корзину */}
              <div style={{ marginBottom: 12 }}>
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

              {/* Купить в один клик */}
              <div style={{ marginBottom: 16 }}>
                <QuickOrderForm productName={product.name} />
              </div>

              <div className="pdp-buybox-divider" />

              {/* Доставка и возврат */}
              <div className="pdp-delivery-info">
                <div className="pdp-delivery-row">
                  <Truck size={16} style={{ color: "var(--kraft)" }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Доставка по Новосибирску</div>
                    <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>Курьером или самовывоз со склада</div>
                  </div>
                </div>
                <div className="pdp-delivery-row" style={{ marginTop: 10 }}>
                  <ShieldCheck size={16} style={{ color: "#16a34a" }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Гарантия качества ГОСТ</div>
                    <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>Резерв заказа на 3 дня</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Похожие товары */}
        {related.length > 0 && (
          <div className="pdp-related">
            <h2 className="pdp-related__title">Похожие товары</h2>
            <div className="product-grid-compact">
              {related.map((p: FirestoreProduct) => (
                <ProductCardCompact key={p.id} product={p} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
