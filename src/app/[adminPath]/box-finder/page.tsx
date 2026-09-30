// src/app/[adminPath]/box-finder/page.tsx — подбор ближайшей коробки

import { getProducts } from "@/lib/supabase-queries";
import { BoxFinderClient } from "@/components/admin/BoxFinderClient";
import { toMm, type BoxProduct } from "@/lib/box-search";

export const dynamic = "force-dynamic";

export default async function AdminBoxFinderPage() {
  const products = await getProducts({ includeHidden: true }).catch(() => []);

  const boxProducts: BoxProduct[] = products
    .filter(
      (p) =>
        p.dimensionLength != null ||
        p.dimensionWidth != null ||
        p.dimensionHeight != null
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku ?? null,
      imageUrl: p.imageUrl ?? null,
      lengthMm: toMm(p.dimensionLength, p.dimensionUnit),
      widthMm: toMm(p.dimensionWidth, p.dimensionUnit),
      heightMm: toMm(p.dimensionHeight, p.dimensionUnit),
      unit: p.dimensionUnit || "мм",
      price: p.price ?? null,
      priceWholesale: p.priceWholesale ?? null,
      minWholesaleQty: p.minWholesaleQty ?? null,
      inStock: p.inStock,
      stockQty: p.stockQty ?? null,
      madeToOrder: p.madeToOrder ?? false,
      material: p.material ?? null,
      packQty: p.packQty ?? null,
    }));

  return <BoxFinderClient products={boxProducts} />;
}
