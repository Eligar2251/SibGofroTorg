import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlug, getRelatedProducts, getAllCategories } from "@/lib/firestore-queries";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { AddToCartButton } from "@/components/catalog/AddToCartButton";
import { QuickOrderForm } from "@/components/forms/QuickOrderForm";
import { FirestoreCategory, FirestoreProduct, getProductEffectivePrice } from "@/lib/types";
import { BadgeCheck, ShieldAlert, Star, MessageSquare, MessageCircle, ChevronRight, Heart, Share2, GitCompare } from "lucide-react";
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

  const breadcrumbTrail = [
    { name: "Каталог", url: "/catalog" },
    ...(category ? [{ name: category.name, url: `/catalog/${category.slug}` }] : []),
    { name: product.name, url: null },
  ];

  return (
    <div style={{ backgroundColor: "#f5f5f5", paddingBottom: "64px" }}>
      <JsonLd data={[breadcrumb, productLd]} />

      {/* ХЛЕБНЫЕ КРОШКИ */}
      <div className="breadcrumbs">
        <div className="container-wide breadcrumbs">
          <div className="breadcrumbs-left">
            {breadcrumbTrail.map((item, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span style={{ color: "#ccc" }}>•</span>}
                {item.url ? (
                  <Link href={item.url} className="breadcrumbs-left" style={{ color: "#8b8b8b", textDecoration: "none" }}>
                    {item.name}
                  </Link>
                ) : (
                  <span style={{ color: "#1a1a1a", fontWeight: 500, maxWidth: "280px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.name}
                  </span>
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="breadcrumbs-right" style={{ display: "flex", alignItems: "center", gap: "16px", color: "#8b8b8b", fontSize: "13px" }}>
            {product.sku && <span>🔖 Артикул: {product.sku}</span>}
            <button className="breadcrumbs-right" style={{ display: "flex", alignItems: "center", gap: "4px", color: "#8b8b8b", textDecoration: "none", background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: "4px" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3 8 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M20 7H4"/><path d="m20 11 4 4-4 4"/></svg> В сравнение
            </button>
            <button className="breadcrumbs-right" style={{ display: "flex", alignItems: "center", gap: "4px", color: "#8b8b8b", textDecoration: "none", background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: "4px" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.57" y1="6.51" y2="10.49"/></svg> Поделиться
            </button>
          </div>
        </div>
      </div>

      <div className="container-wide" style={{ marginTop: "20px" }}>
        {/* ОСНОВНОЙ БЛОК - 4 КОЛОНКИ */}
        <div className="product-page">

          {/* МИНИАТЮРЫ */}
          <div className="gallery-thumbs">
            {product.images && product.images.length > 0 ? (
              product.images.map((img, idx) => (
                <button
                  key={idx}
                  className={`thumb ${idx === 0 ? "active" : ""}`}
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
              <button className="thumb active" aria-label="Фото 1">
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  width={72}
                  height={72}
                  style={{ objectFit: "cover" }}
                />
              </button>
            ) : (
              <button className="thumb active" aria-label="Фото 1">
                <span style={{ fontSize: "24px", opacity: 0.5 }}>📦</span>
              </button>
            )}
            {/* Видео заглушка */}
            <button className="thumb thumb-video" aria-label="Видео">
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "11px", textAlign: "center", lineHeight: "1.3", width: "100%", height: "100%" }}>
                <span style={{ fontSize: "18px", display: "block", marginBottom: "4px" }}>▶</span>
                +1 видео
              </span>
            </button>
          </div>

          {/* ГЛАВНОЕ ФОТО */}
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
              <span style={{ fontSize: "96px", opacity: 0.3 }}>📦</span>
            )}
            <div className="badge-returns" style={{ position: "absolute", top: "12px", right: "12px", background: "#00b800", color: "#fff", fontSize: "12px", fontWeight: 600, padding: "4px 10px", borderRadius: "20px", display: "flex", alignItems: "center", gap: "4px", zIndex: 2 }}>
              ✓ 0% возвратов ›
            </div>
            <div className="badge-zoom" style={{ position: "absolute", top: "12px", left: "12px", background: "rgba(255,255,255,0.9)", borderRadius: "50%", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", zIndex: 2 }}>
              🔍
            </div>
          </div>

          {/* ИНФОРМАЦИЯ О ТОВАРЕ */}
          <div className="product-info" style={{ padding: "0 8px" }}>
            {/* Заголовок */}
            <h1 className="product-title" style={{ fontSize: "20px", fontWeight: 700, lineHeight: "1.4", marginBottom: "12px", color: "#1a1a1a" }}>
              {product.name}
              <span className="show-more" style={{ color: "#005bff", cursor: "pointer", fontSize: "14px", fontWeight: 400 }}>ещё</span>
            </h1>

            {/* Рейтинг */}
            <div className="rating-row" style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
              <div className="rating-stars" style={{ display: "flex", alignItems: "center", gap: "4px", fontWeight: 700, color: "#1a1a1a" }}>
                <span className="star" style={{ color: "#f5a623", fontSize: "16px" }}>★</span>
                4.9
              </div>
              <span style={{ color: "#ccc" }}>•</span>
              <a href="#reviews" className="rating-link" style={{ color: "#005bff", textDecoration: "none", fontSize: "13px" }}>21 отзыв</a>
              <span style={{ color: "#ccc" }}>•</span>
              <a href="#questions" className="questions-link" style={{ display: "flex", alignItems: "center", gap: "4px", color: "#005bff", textDecoration: "none", fontSize: "13px" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle" }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> 7 вопросов
              </a>
            </div>

            {/* Бренд */}
            <div className="brand-row" style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px", padding: "12px", border: "1px solid #e8e8e8", borderRadius: "8px" }}>
              <div className="brand-logo" style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", color: "#fff", flexShrink: 0 }}>С</div>
              <div>
                <div className="brand-name" style={{ fontWeight: 700, fontSize: "15px", display: "flex", alignItems: "center", gap: "4px" }}>
                  СибГофроТорг <BadgeCheck size={14} style={{ color: "#16a34a", display: "inline" }} />
                </div>
                <div style={{ color: "#8b8b8b", fontSize: "12px", marginTop: "2px" }}>Производитель • ГОСТ</div>
              </div>
            </div>

            {/* Характеристики "О товаре" */}
            <div className="specs-section" style={{ marginTop: "24px" }}>
              <div className="specs-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <span className="specs-title" style={{ fontSize: "16px", fontWeight: 700 }}>О товаре</span>
                <a href="#description" className="specs-link" style={{ color: "#005bff", textDecoration: "none", fontSize: "13px", display: "flex", alignItems: "center", gap: "2px" }}>
                  Перейти к описанию <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </a>
              </div>
              <div className="specs-table" style={{ width: "100%" }}>
                {specs.map((s, idx) => (
                  <div key={idx} className="spec-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
                    <div className="spec-name" style={{ color: "#8b8b8b", fontSize: "13px", display: "flex", alignItems: "flex-start", gap: "4px" }}>
                      {s.icon} {s.label}
                      <span style={{ color: "#ccc", cursor: "help", fontSize: "12px" }}>ⓘ</span>
                    </div>
                    <div className="spec-value" style={{ color: "#1a1a1a", fontSize: "13px", fontWeight: 500 }}>{s.value}</div>
                  </div>
                ))}
                {specs.length === 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
                    <div style={{ color: "#8b8b8b", fontSize: "13px" }}>Характеристики уточняйте у менеджера</div>
                    <div style={{ color: "#1a1a1a", fontSize: "13px", fontWeight: 500 }}>—</div>
                  </div>
                )}
              </div>
            </div>

            {/* Описание */}
            {product.description && (
              <div id="description" style={{ marginTop: "24px" }}>
                <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "12px" }}>Описание</h2>
                <p style={{ fontSize: "14px", color: "#8b8b8b", lineHeight: "1.7" }}>{product.description}</p>
              </div>
            )}
          </div>

          {/* ПРАВАЯ КОЛОНКА: Блок покупки */}
          <div className="purchase-block" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div className="purchase-card" style={{ border: "1px solid #e0e0e0", borderRadius: "12px", padding: "16px", marginBottom: "12px" }}>
              {/* Распродажа - показываем только если есть скидка */}
              {hasDiscount && (
                <div className="sale-badge-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div className="sale-badge-left" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div className="sale-icon" style={{ width: "28px", height: "28px", background: "#ff4f00", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "12px", fontWeight: 700 }}>%</div>
                    <div>
                      <div className="sale-text" style={{ color: "#ff4f00", fontWeight: 700, fontSize: "14px" }}>Распродажа</div>
                      <div className="sale-stock" style={{ color: "#8b8b8b", fontSize: "12px" }}>
                        {product.stockQty != null && product.stockQty <= 30
                          ? `${product.stockQty} единиц осталось`
                          : "Ограниченное количество"}
                      </div>
                    </div>
                  </div>
                  <div style={{ color: "#8b8b8b", fontSize: "12px" }}>
                    {product.discountBadge ? `${product.discountBadge} до конца` : "7 дней до конца"}
                  </div>
                </div>
              )}

              {/* Цена */}
              {effectivePrice != null && (
                <>
                  <div className="price-main" style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <div className="price-badge" style={{ background: "#00b800", color: "#fff", fontSize: "22px", fontWeight: 700, padding: "4px 12px", borderRadius: "6px" }}>{effectivePrice.toLocaleString("ru-RU")} ₽</div>
                    <div className="price-card-label" style={{ color: "#8b8b8b", fontSize: "13px", flex: 1 }}>с картой магазина</div>
                    <div style={{ color: "#8b8b8b", fontSize: "18px" }}>›</div>
                  </div>
                  <div className="price-secondary" style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <span className="price-regular" style={{ fontSize: "15px", color: "#1a1a1a", fontWeight: 500 }}>
                      {hasDiscount && oldPrice != null
                        ? oldPrice.toLocaleString("ru-RU")
                        : effectivePrice.toLocaleString("ru-RU")}
                      ₽
                    </span>
                    {hasDiscount && oldPrice != null && (
                      <span style={{ fontSize: "13px", color: "#8b8b8b", textDecoration: "line-through" }}>{oldPrice.toLocaleString("ru-RU")} ₽</span>
                    )}
                    <span style={{ fontSize: "12px", color: "#8b8b8b" }}>без карты</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#00b800", fontSize: "13px", padding: "8px 0", borderTop: "1px solid #f0f0f0", cursor: "pointer" }}>
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
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                <button style={{ background: "#7b61ff", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "14px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Оплатить позже</button>
                <span style={{ fontSize: "13px", color: "#1a1a1a" }}>без % до 12 января</span>
              </div>

              {/* Хочу скидку */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#8b8b8b", fontSize: "13px", cursor: "pointer", marginBottom: "12px" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#8b8b8b" }}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06a5.5 5.5 0 0 0 7.78 7.78l1.06-1.06a5.5 5.5 0 0 0 7.78-7.78l-1.06-1.06a5.5 5.5 0 0 0-7.78-7.78z"/><path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg> Хочу скидку
              </div>

              {/* Добавить в корзину */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
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
                <button style={{ width: "48px", height: "48px", border: "1.5px solid #e0e0e0", borderRadius: "10px", background: "#fff", cursor: "pointer", fontSize: "20px", display: "flex", alignItems: "center", justifyContent: "center", color: "#8b8b8b" }} title="В избранное" aria-label="В избранное">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06a5.5 5.5 0 0 0 7.78 7.78l1.06-1.06a5.5 5.5 0 0 0 7.78-7.78l-1.06-1.06a5.5 5.5 0 0 0-7.78-7.78z"/><path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>
                </button>
              </div>

              <div style={{ textAlign: "center", color: "#8b8b8b", fontSize: "12px", marginBottom: "12px" }}>Доставим с завтрашнего дня</div>

              {/* Есть дешевле */}
              <div style={{ border: "1px solid #e0e0e0", borderRadius: "10px", padding: "12px", display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", cursor: "pointer" }}>
                <div style={{ width: "40px", height: "40px", background: "#f0f0f0", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>📦</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", color: "#1a1a1a", fontWeight: 600 }}>Есть дешевле</div>
                  <div style={{ fontSize: "13px", color: "#8b8b8b" }}>от {(effectivePrice ?? product.price ?? 0) * 0.85} ₽</div>
                </div>
                <div style={{ fontSize: "13px", color: "#8b8b8b", display: "flex", alignItems: "center", gap: "2px" }}>5 ›</div>
              </div>

              {/* Купить в один клик */}
              <div style={{ marginBottom: "16" }}>
                <QuickOrderForm productName={product.name} />
              </div>

              {/* FAQ */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>Часто задаваемые вопросы</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  <a href="/delivery" style={{ color: "#005bff", textDecoration: "none", fontSize: "13px" }}>Условия доставки</a>
                  <a href="/delivery" style={{ color: "#005bff", textDecoration: "none", fontSize: "13px" }}>Возврат товаров</a>
                  <a href="#" style={{ color: "#005bff", textDecoration: "none", fontSize: "13px" }}>Способы оплаты</a>
                  <a href="#" style={{ color: "#005bff", textDecoration: "none", fontSize: "13px" }}>Возврат денег</a>
                </div>
              </div>

              {/* Доставка и возврат */}
              <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: "12px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>Доставка и возврат</div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "8px", borderRadius: "8px" }}>
                  <div style={{ color: "#8b8b8b", fontSize: "18px", flexShrink: 0 }}>📍</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", color: "#1a1a1a", fontWeight: 500 }}>Новосибирск, ул. Примерная, 1</div>
                    <div style={{ fontSize: "12px", color: "#8b8b8b" }}>Со склада продавца, Новосибирск</div>
                  </div>
                  <div style={{ color: "#8b8b8b" }}>›</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ПОХОЖИЕ ТОВАРЫ */}
        {related.length > 0 && (
          <div className="pdp-related" style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#1a1a1a", marginBottom: "16px" }}>Похожие товары</h2>
            <div className="product-grid-compact">
              {related.map((p: FirestoreProduct) => (
                <ProductCardCompact key={p.id} product={p} />
              ))}
            </div>
          </div>
        )}

        {/* НИЖНИЙ БЛОК: Фото покупателей */}
        <div style={{ background: "#fff", borderRadius: "12px", padding: "24px", marginTop: "16px" }}>
          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>Фото и видео покупателей</div>
          <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "8px" }}>
            {product.images && product.images.length > 0
              ? product.images.slice(0, 4).map((img, idx) => (
                  <div key={idx} style={{ width: "80px", height: "80px", borderRadius: "8px", background: "#f0f0f0", flexShrink: 0, overflow: "hidden", position: "relative", cursor: "pointer" }}>
                    <Image src={img.url} alt="" width={80} height={80} style={{ objectFit: "cover" }} />
                  </div>
                ))
              : product.imageUrl
              ? [...Array(4)].map((_, idx) => (
                  <div key={idx} style={{ width: "80px", height: "80px", borderRadius: "8px", background: "#f0f0f0", flexShrink: 0, overflow: "hidden", position: "relative", cursor: "pointer" }}>
                    <Image src={product.imageUrl!} alt="" width={80} height={80} style={{ objectFit: "cover" }} />
                  </div>
                ))
              : [...Array(4)].map((_, idx) => (
                  <div key={idx} style={{ width: "80px", height: "80px", borderRadius: "8px", background: "#e0e0e0", flexShrink: 0, overflow: "hidden", position: "relative", cursor: "pointer" }}>📦</div>
                ))}
            <div style={{ width: "80px", height: "80px", borderRadius: "8px", background: "#f0f0f0", flexShrink: 0, overflow: "hidden", position: "relative", cursor: "pointer" }}>
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "16px", fontWeight: 700 }}>+{Math.max(0, (product.images?.length || 1) - 4) + 2}</div>
            </div>
          </div>
        </div>

        {/* НИЖНИЙ БЛОК: Полные характеристики */}
        {specs.length > 0 && (
          <div style={{ background: "#fff", borderRadius: "12px", padding: "24px", marginTop: "16px" }}>
            <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>Характеристики</div>
            <div style={{ width: "100%" }}>
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#8b8b8b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px", paddingBottom: "4px", borderBottom: "1px solid #f0f0f0" }}>Основные</div>
                {specs.map((s, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
                    <div style={{ color: "#8b8b8b", fontSize: "13px" }}>{s.icon} {s.label}</div>
                    <div style={{ color: "#1a1a1a", fontSize: "13px", fontWeight: 500 }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* НИЖНИЙ БЛОК: Отзывы */}
        <div style={{ background: "#fff", borderRadius: "12px", padding: "24px", marginTop: "16px" }}>
          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>Отзывы • 0</div>
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#8b8b8b" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.5 }}>💬</div>
            <p style={{ fontSize: 15, marginBottom: 8 }}>Пока нет отзывов</p>
            <p style={{ fontSize: 13 }}>Будьте первым, кто оставит отзыв об этом товаре</p>
          </div>
        </div>

        {/* НИЖНИЙ БЛОК: Вопросы */}
        <div style={{ background: "#fff", borderRadius: "12px", padding: "24px", marginTop: "16px" }}>
          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>Вопросы и ответы • 0</div>
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#8b8b8b" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.5 }}>❓</div>
            <p style={{ fontSize: 15, marginBottom: 8 }}>Пока нет вопросов</p>
            <p style={{ fontSize: 13 }}>Задайте вопрос продавцу или покупателям</p>
          </div>
        </div>

      </div>
    </div>
  );
}