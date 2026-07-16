import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlug, getRelatedProducts, getAllCategories } from "@/lib/firestore-queries";
import { ProductCardCompact } from "@/components/catalog/ProductCardCompact";
import { AddToCartButton } from "@/components/catalog/AddToCartButton";
import { FirestoreCategory, FirestoreProduct } from "@/lib/types";
import { BadgeCheck, ShieldAlert } from "lucide-react";
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

  const title = `${product.name} купить в Новосибирске`;
  const description =
    product.description?.slice(0, 160) ||
    `${product.name}${product.price != null ? ` — ${product.price.toLocaleString("ru-RU")} ₽` : ""}. Доставка и самовывоз в Новосибирске. ${SITE_NAME}.`;

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
    price: product.price,
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
          <span style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {product.name}
          </span>
        </div>
      </div>

      <div className="container-wide" style={{ marginTop: "24px" }}>

        {/* Основной блок товара */}
        <div className="pdp-layout">

          {/* 1. Фото */}
          <div className="pdp-gallery">
            <div className="pdp-img-wrap">
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  fill
                  style={{ objectFit: "contain", padding: "20px" }}
                  sizes="(max-width: 768px) 100vw, 420px"
                  priority
                />
              ) : (
                <span className="pdp-img-placeholder">📦</span>
              )}
              {product.promoLabel && (
                <span className="pdp-badge pdp-badge--promo">{product.promoLabel}</span>
              )}
              {!product.inStock && (
                <span className="pdp-badge pdp-badge--out">Нет в наличии</span>
              )}
            </div>
          </div>

          {/* 2. Основная информация + кнопка */}
          <div className="pdp-main">

            {/* Заголовок */}
            <div className="pdp-head">
              {product.sku && (
                <div className="pdp-sku">Арт: {product.sku}</div>
              )}
              <h1 className="pdp-title">{product.name}</h1>
              <div className="pdp-status">
                {product.inStock ? (
                  <span className="pdp-status--in">
                    <BadgeCheck size={14} /> В наличии на складе
                    {product.stockQty && product.stockQty <= 30 && (
                      <span className="pdp-status-qty">осталось {product.stockQty} шт.</span>
                    )}
                  </span>
                ) : (
                  <span className="pdp-status--out">
                    <ShieldAlert size={14} /> Под заказ
                  </span>
                )}
              </div>
            </div>

            {/* Цена */}
            {product.price != null && (
              <div className="pdp-price-block">
                <div className="pdp-price">{product.price.toLocaleString("ru-RU")} <span>₽</span></div>
                {product.priceWholesale != null && (
                  <div className="pdp-price-wholesale">
                    Оптовая цена: <strong>{product.priceWholesale.toLocaleString("ru-RU")} ₽</strong>
                    {product.minWholesaleQty && (
                      <span> от {product.minWholesaleQty} шт.</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Краткие характеристики */}
            {specs.length > 0 && (
              <div className="pdp-specs">
                {specs.map((s, i) => (
                  <div key={i} className="pdp-spec-row">
                    <span className="pdp-spec-label">{s.icon} {s.label}</span>
                    <span className="pdp-spec-val">{s.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Описание */}
            {product.description && (
              <p className="pdp-desc">{product.description}</p>
            )}

            {/* Кнопка добавления в корзину */}
            <AddToCartButton
              product={{
                id: product.id,
                name: product.name,
                sku: product.sku,
                price: product.price,
                imageUrl: product.imageUrl,
                stockQty: product.stockQty,
                packQty: product.packQty,
              }}
            />

            {/* Гарантии */}
            <div className="pdp-guarantees">
              <div className="pdp-guarantee">🚚 Бесплатная доставка от 15 000 ₽</div>
              <div className="pdp-guarantee">📦 Резерв 3 дня после подтверждения</div>
              <div className="pdp-guarantee">✅ Продукция по ГОСТу</div>
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