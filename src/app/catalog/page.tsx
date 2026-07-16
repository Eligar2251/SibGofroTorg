import type { Metadata } from "next";
import { getCategories, getProducts } from "@/lib/firestore-queries";
import { CatalogShopClient } from "@/components/catalog/CatalogShopClient";
import { SITE_URL, SITE_NAME } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildBreadcrumbJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Каталог гофротары и упаковки в Новосибирске",
  description:
    "Каталог картонных коробок, плёнки, скотча в Новосибирске. Опт и розница, цены от производителя. Самовывоз и доставка.",
  alternates: { canonical: `${SITE_URL}/catalog` },
  openGraph: {
    title: `Каталог упаковки — ${SITE_NAME}`,
    description:
      "Гофрокоробки, скотч, стрейч-плёнка — купить в Новосибирске оптом и в розницу.",
    url: `${SITE_URL}/catalog`,
  },
};

export const revalidate = 120;

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const cats = await getCategories();
  const products = await getProducts({ limitCount: 48 });

  const serializedCategories = cats.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    icon: c.icon ?? "📦",
  }));

  const serializedProducts = products.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? null,
    price: p.price,
    priceWholesale: p.priceWholesale ?? null,
    minWholesaleQty: p.minWholesaleQty ?? null,
    packQty: p.packQty ?? null,
    imageUrl: p.imageUrl ?? null,
    inStock: p.inStock,
    promoLabel: p.promoLabel ?? null,
    stockQty: p.stockQty ?? null,
    dimensionLength: p.dimensionLength ?? null,
    dimensionWidth: p.dimensionWidth ?? null,
    dimensionHeight: p.dimensionHeight ?? null,
    dimensionUnit: p.dimensionUnit ?? null,
    material: p.material ?? null,
  }));

  return (
    <>
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Главная", url: SITE_URL },
          { name: "Каталог", url: `${SITE_URL}/catalog` },
        ])}
      />
      <CatalogShopClient
        categories={serializedCategories}
        initialProducts={serializedProducts}
        mode="all"
      />
    </>
  );
}