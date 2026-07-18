import { notFound } from "next/navigation";
import {
  getCategoryBySlug,
  getProducts,
  getCategories,
} from "@/lib/firestore-queries";
import { CatalogShopClient } from "@/components/catalog/CatalogShopClient";
import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_URL, SITE_NAME, buildBreadcrumbJsonLd } from "@/lib/seo";

export const revalidate = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const cat = await getCategoryBySlug(category);
  if (!cat) return { title: "Категория не найдена" };
  const title = `${cat.name} купить в Новосибирске`;
  const description = `${cat.name} — цены, наличие, доставка по Новосибирску. ${SITE_NAME}: опт и розница, склад на ул. Ватутина.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/catalog/${cat.slug}` },
    openGraph: {
      title: `${title} — ${SITE_NAME}`,
      description,
      url: `${SITE_URL}/catalog/${cat.slug}`,
    },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ sort?: string; q?: string; stock?: string }>;
}) {
  const { category: slug } = await params;
  const { sort, q, stock } = await searchParams;

  const cat = await getCategoryBySlug(slug);
  if (!cat) notFound();

  const allCats = await getCategories();
  let products = await getProducts({
    categoryId: cat.id,
    sortBy: sort || "default",
    search: q || undefined,
  });
  if (stock === "yes") products = products.filter((p) => p.inStock);

  return (
    <>
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Главная", url: SITE_URL },
          { name: "Каталог", url: `${SITE_URL}/catalog` },
          { name: cat.name, url: `${SITE_URL}/catalog/${cat.slug}` },
        ])}
      />
      <CatalogShopClient
        mode="category"
        categories={allCats.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          icon: c.icon ?? "📦",
        }))}
        initialProducts={products.map((p) => ({
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
          madeToOrder: p.madeToOrder ?? false,
          stockQty: p.stockQty ?? null,
          dimensionLength: p.dimensionLength ?? null,
          dimensionWidth: p.dimensionWidth ?? null,
          dimensionHeight: p.dimensionHeight ?? null,
          dimensionUnit: p.dimensionUnit ?? null,
          material: p.material ?? null,
        }))}
        initialCategorySlug={cat.slug}
        initialCategoryName={cat.name}
        initialSort={sort || "default"}
        initialQ={q || ""}
        initialStock={stock || ""}
      />
    </>
  );
}
