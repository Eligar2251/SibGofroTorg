// =========================================================
// FILE: src/app/[adminPath]/products/[id]/page.tsx
// =========================================================

import { notFound } from "next/navigation";
import {
  getProductByIdForAdmin,
  getAllCategories,
  getFeaturedProductOrderIds,
  getProducts,
} from "@/lib/supabase-queries";
import { ProductFormClient } from "@/components/admin/ProductFormClient";
import type { LinkableProductSummary } from "@/components/admin/LinkedProductsEditor";
import { getDimensionProfiles } from "@/lib/dimension-profiles-db";
import { collectProductTags } from "@/lib/home-tiles";
import { ADMIN_PATH } from "@/lib/admin-path";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ adminPath: string; id: string }>;
}) {
  const { adminPath, id } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const product = await getProductByIdForAdmin(id);
  if (!product) notFound();

  const [categories, featuredOrderIds, allProducts, dimensionProfiles] =
    await Promise.all([
      getAllCategories(),
      getFeaturedProductOrderIds(),
      getProducts({ includeHidden: true }),
      getDimensionProfiles(),
    ]);

  const serializedProduct = {
    ...product,
    featuredOrder: product.isFeatured
      ? (() => {
          const idx = featuredOrderIds.findIndex(
            (itemId) => itemId === product.id,
          );
          return idx >= 0 ? idx + 1 : null;
        })()
      : null,
    createdAt:
      typeof product.createdAt === "string"
        ? product.createdAt
        : product.createdAt?.toDate?.()
          ? product.createdAt.toDate().toISOString()
          : null,
    updatedAt:
      typeof product.updatedAt === "string"
        ? product.updatedAt
        : product.updatedAt?.toDate?.()
          ? product.updatedAt.toDate().toISOString()
          : null,
  };

  const serializedCategories = categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    dimensionProfileId: cat.dimensionProfileId ?? null,
    createdAt:
      typeof cat.createdAt === "string"
        ? cat.createdAt
        : cat.createdAt?.toDate?.()
          ? cat.createdAt.toDate().toISOString()
          : null,
  }));

  const linkableProducts: LinkableProductSummary[] = allProducts.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    price: p.price ?? null,
    stockQty: p.stockQty ?? null,
    imageUrl: p.imageUrl ?? null,
    categoryId: p.categoryId || null,
    isVisible: p.isVisible !== false,
    dimensionLength: p.dimensionLength ?? null,
    dimensionWidth: p.dimensionWidth ?? null,
    dimensionHeight: p.dimensionHeight ?? null,
    dimensionUnit: p.dimensionUnit ?? null,
    dimensionValues: p.dimensionValues ?? null,
    linkGroupId: p.linkGroupId ?? null,
    isGroupPrimary: p.isGroupPrimary ?? true,
    linkedProductIds: p.linkedProductIds ?? [],
    linkedGroupTitle: p.linkedGroupTitle ?? null,
    linkedVariantLabel: p.linkedVariantLabel ?? null,
  }));

  return (
    <div>
      <h1 className="admin-h1">Редактировать товар</h1>
      <ProductFormClient
        categories={serializedCategories}
        dimensionProfiles={dimensionProfiles}
        product={serializedProduct}
        featuredOrderIds={featuredOrderIds}
        knownTags={collectProductTags(allProducts)}
        linkableProducts={linkableProducts}
      />
    </div>
  );
}
