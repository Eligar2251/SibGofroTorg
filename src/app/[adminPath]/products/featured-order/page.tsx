import { notFound } from "next/navigation";
import { getProducts } from "@/lib/supabase-queries";
import { FeaturedProductsOrderClient } from "@/components/admin/FeaturedProductsOrderClient";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Порядок популярных товаров — СибГофроТорг",
};

export default async function FeaturedOrderPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const featuredProducts = await getProducts({
    featuredOnly: true,
    includeHidden: true,
    limitCount: 500,
  });

  const serializedProducts = featuredProducts.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? null,
    price: p.price ?? null,
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
    hasVariants: p.hasVariants ?? false,
    variantCount: p.variantCount ?? 0,
    variantPriceMin: p.variantPriceMin ?? null,
    variantPriceMax: p.variantPriceMax ?? null,
    variantTotalStock: p.variantTotalStock ?? 0,
    isVisible: p.isVisible,
  }));

  return (
    <FeaturedProductsOrderClient
      adminPath={ADMIN_PATH}
      initialProducts={serializedProducts}
    />
  );
}
