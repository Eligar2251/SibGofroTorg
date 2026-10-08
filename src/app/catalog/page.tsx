import { toCardProduct } from "@/lib/product-card";
import type { Metadata } from "next";
import { getCategories, getProducts } from "@/lib/supabase-queries";
import { CatalogShopClient } from "@/components/catalog/CatalogShopClient";
import { CatalogSeoSection } from "@/components/catalog/CatalogSeoSection";
import { SITE_URL, SITE_NAME } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildBreadcrumbJsonLd } from "@/lib/seo";
import "../seo-blocks.css";

export const metadata: Metadata = {
  title: "Купить гофротару и картонные коробки в Новосибирске — каталог",
  description:
    "Каталог гофротары в Новосибирске: картонные коробки Т-22, Т-23, Т-25, 3- и 5-слойные, стрейч-плёнка, скотч. От 1 шт., опт и розница, доставка и самовывоз.",
  alternates: { canonical: `${SITE_URL}/catalog` },
  openGraph: {
    title: `Каталог гофротары и упаковки — ${SITE_NAME}`,
    description:
      "Купить гофротару, картонные коробки, стрейч-плёнку и скотч в Новосибирске оптом и в розницу от 1 шт.",
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
    icon: c.icon ?? "box",
  }));

  const serializedProducts = products.map(toCardProduct);

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
      <CatalogSeoSection categories={serializedCategories} />
    </>
  );
}