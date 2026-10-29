import React from "react";
import { notFound } from "next/navigation";
import {
  getProductBySlug,
  getProductBySlugForPage,
  getRelatedProducts,
  getAllCategories,
  getProductReviews,
  getProductReviewStats,
} from "@/lib/supabase-queries";
import {
  ProductDetailClient,
  type PdpCardEntry,
  type PdpReviewItem,
} from "@/components/catalog/ProductDetailClient";
import { isOutOfStock } from "@/lib/stock-availability";
import { stripMarkdown } from "@/lib/markdown";
import "@/app/pdp.css";
import {
  FirestoreCategory,
  FirestoreProduct,
  getProductEffectivePrice,
} from "@/lib/types";
import { SITE_ADDRESS } from "@/lib/site-config";
import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { formatProductSize } from "@/lib/product-size";
import { dimensionOrderLabel } from "@/lib/dimension-profiles";
import { localizeMediaDeep, toAbsoluteMediaUrl } from "@/lib/media";
import {
  SITE_URL,
  SITE_NAME,
  buildBreadcrumbJsonLd,
  buildProductJsonLd,
} from "@/lib/seo";
import { toCardProduct } from "@/lib/product-card";
import {
  resolveLinkedCardLabels,
  resolveLinkedGroupTitle,
} from "@/lib/product-links";

export const revalidate = 120;

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

  const basePrice = product.basePrice ?? product.price;
  const effectivePrice = getProductEffectivePrice({
    ...product,
    price: basePrice,
  });
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
      images: (() => {
        const ogImage = toAbsoluteMediaUrl(product.imageUrl, SITE_URL);
        return ogImage ? [{ url: ogImage }] : undefined;
      })(),
      type: "website",
    },
  };
}

function buildPdpCardEntry(
  p: FirestoreProduct,
  allCats: FirestoreCategory[],
  label: string,
  isPrimary: boolean,
  reviewsRaw: any[],
  reviewStatsRaw: any,
): PdpCardEntry {
  const category = allCats.find((c) => c.id === p.categoryId) || null;
  const outOfStock = isOutOfStock(p);
  const basePrice = p.basePrice ?? p.price;
  const effectivePrice = getProductEffectivePrice({ ...p, price: basePrice });
  const hasDiscount =
    basePrice != null && effectivePrice != null && effectivePrice < basePrice;
  const oldPrice = hasDiscount && basePrice != null ? basePrice : null;
  const discountPercent =
    hasDiscount && oldPrice != null && effectivePrice != null
      ? Math.round((1 - effectivePrice / oldPrice) * 100)
      : 0;
  const displayPrice = effectivePrice ?? basePrice ?? null;

  const dims = formatProductSize(p);
  const specs = [
    dims && {
      label: p.dimensionValues?.length
        ? `Размеры (${dimensionOrderLabel(
            p.dimensionValues.filter((v) => v.value != null),
          )})`
        : "Размеры (ДхШхВ)",
      value: dims,
    },
    p.material && { label: "Материал", value: p.material },
    p.packQty && { label: "В упаковке", value: `${p.packQty} шт.` },
    p.weight && { label: "Вес единицы", value: `${p.weight} кг` },
    p.volume && { label: "Объём", value: `${p.volume} л` },
    p.note && { label: "Примечание", value: p.note },
  ].filter(Boolean) as { label: string; value: string }[];

  const galleryImages: { url: string; alt: string }[] = [];
  if (p.images && p.images.length > 0) {
    p.images.forEach((img, i) =>
      galleryImages.push({ url: img.url, alt: `${p.name} фото ${i + 1}` }),
    );
  } else if (p.imageUrl) {
    galleryImages.push({ url: p.imageUrl, alt: p.name });
  }

  const reviews: PdpReviewItem[] = (reviewsRaw || []).map((r: any) => ({
    id: String(r.id),
    userName: r.userName || "Покупатель",
    userAvatar: r.userAvatar || null,
    rating: Number(r.rating) || 5,
    date: formatReviewDate(r.createdAt),
    isVerifiedPurchase: Boolean(r.isVerifiedPurchase),
    title: r.title || null,
    text: r.text || "",
    pros: r.pros || null,
    cons: r.cons || null,
    images: Array.isArray(r.images)
      ? r.images.map((im: any) => ({ url: String(im.url || "") })).filter((im: any) => im.url)
      : [],
    helpfulCount: Number(r.helpfulCount) || 0,
  }));

  const stats = reviewStatsRaw || EMPTY_REVIEW_STATS;

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? null,
    label,
    isPrimary,
    categoryName: category?.name ?? null,
    categorySlug: category?.slug ?? null,
    description: p.description ?? null,
    imageUrl: p.imageUrl ?? null,
    galleryImages,
    promoLabel: p.promoLabel ?? null,
    promoLabelColor: p.promoLabelColor ?? null,
    promoLabelTextColor: p.promoLabelTextColor ?? null,
    madeToOrder: Boolean(p.madeToOrder),
    madeToOrderMinQty: p.madeToOrderMinQty ?? null,
    outOfStock,
    stockQty: p.stockQty ?? null,
    packQty: p.packQty ?? null,
    displayPrice,
    oldPrice,
    discountPercent,
    priceWholesale: p.priceWholesale ?? null,
    minWholesaleQty: p.minWholesaleQty ?? null,
    specs,
    reviews,
    reviewStats: {
      averageRating: Number(stats.averageRating) || 0,
      totalReviews: Number(stats.totalReviews) || 0,
      distribution: {
        5: Number(stats.distribution?.[5] ?? 0),
        4: Number(stats.distribution?.[4] ?? 0),
        3: Number(stats.distribution?.[3] ?? 0),
        2: Number(stats.distribution?.[2] ?? 0),
        1: Number(stats.distribution?.[1] ?? 0),
      },
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { product, linkedProducts, linkGroup } = localizeMediaDeep(
    await getProductBySlugForPage(slug),
  );
  if (!product) notFound();

  const groupMembers =
    linkedProducts.length > 0 && linkedProducts.some((p) => p.id === product.id)
      ? linkedProducts
      : [product, ...linkedProducts];

  // Загружаем категории, похожие товары и отзывы всех связанных карточек параллельно,
  // чтобы переключение между вариантами на клиенте происходило за 0 мс без единого запроса.
  const [allCats, related, perCardReviews] = localizeMediaDeep(
    await Promise.all([
      getAllCategories(),
      product.categoryId
        ? getRelatedProducts(product.categoryId, product.id, 4).catch(() => [])
        : Promise.resolve([]),
      Promise.all(
        groupMembers.map(async (member) => {
          const [revs, stats] = await Promise.all([
            getProductReviews(member.id, {
              limitCount: 8,
              onlyApproved: true,
              sortBy: "newest",
            }).catch(() => []),
            getProductReviewStats(member.id).catch(() => EMPTY_REVIEW_STATS),
          ]);
          return { id: member.id, reviews: revs, reviewStats: stats };
        }),
      ),
    ]),
  );

  const labelsMap = resolveLinkedCardLabels(
    groupMembers,
    linkGroup?.labels ?? null,
  );
  const groupTitle = resolveLinkedGroupTitle(
    groupMembers,
    linkGroup?.groupTitle ?? null,
  );
  const primaryId = linkGroup?.primaryProductId || groupMembers[0].id;

  const reviewsMap = new Map(
    perCardReviews.map((entry) => [entry.id, entry] as const),
  );

  const cards: PdpCardEntry[] = groupMembers.map((member) => {
    const revEntry = reviewsMap.get(member.id);
    return buildPdpCardEntry(
      member,
      allCats,
      labelsMap[member.id] || member.name,
      member.id === primaryId,
      revEntry?.reviews || [],
      revEntry?.reviewStats || EMPTY_REVIEW_STATS,
    );
  });

  const activeEntry = cards.find((c) => c.id === product.id) || cards[0];
  const category = allCats.find(
    (c: FirestoreCategory) => c.id === product.categoryId,
  );

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
    ].filter(Boolean) as { name: string; url: string }[],
  );

  const productLd = buildProductJsonLd({
    name: product.name,
    slug: product.slug,
    description: product.description
      ? stripMarkdown(product.description)
      : product.description,
    sku: product.sku,
    price: activeEntry.displayPrice,
    imageUrl: product.imageUrl,
    inStock: !activeEntry.outOfStock && !activeEntry.madeToOrder,
  });

  const relatedCards = related.map((p: FirestoreProduct) => toCardProduct(p));

  return (
    <div className="pdp-page">
      <JsonLd data={[breadcrumb, productLd]} />
      <ProductDetailClient
        initialProductId={product.id}
        cards={cards}
        groupTitle={groupTitle}
        related={relatedCards}
        siteAddress={SITE_ADDRESS}
        siteName={SITE_NAME}
      />
    </div>
  );
}
