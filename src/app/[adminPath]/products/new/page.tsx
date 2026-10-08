// =========================================================
// FILE: src/app/[adminPath]/products/new/page.tsx
// =========================================================

import {
  getAllCategories,
  getFeaturedProductOrderIds,
  getProducts,
} from "@/lib/supabase-queries";
import { ProductFormClient } from "@/components/admin/ProductFormClient";
import { getDimensionProfiles } from "@/lib/dimension-profiles-db";
import { collectProductTags } from "@/lib/home-tiles";
import { notFound } from "next/navigation";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function NewProductPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [categories, featuredOrderIds, allProducts, dimensionProfiles] = await Promise.all([
    getAllCategories(),
    getFeaturedProductOrderIds(),
    getProducts({ includeHidden: true }),
    getDimensionProfiles(),
  ]);
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

  return (
    <div>
      <h1 className="admin-h1">Добавить товар</h1>
      <ProductFormClient
        categories={serializedCategories}
        dimensionProfiles={dimensionProfiles}
        featuredOrderIds={featuredOrderIds}
        knownTags={collectProductTags(allProducts)}
      />
    </div>
  );
}