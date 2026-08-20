// =========================================================
// FILE: src/app/[adminPath]/products/new/page.tsx
// =========================================================

import {
  getAllCategories,
  getFeaturedProductOrderIds,
  getProducts,
} from "@/lib/supabase-queries";
import { ProductFormClient } from "@/components/admin/ProductFormClient";
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

  const [categories, featuredOrderIds, allProducts] = await Promise.all([
    getAllCategories(),
    getFeaturedProductOrderIds(),
    getProducts({ includeHidden: true }),
  ]);
  const serializedCategories = categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
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
        featuredOrderIds={featuredOrderIds}
        knownTags={collectProductTags(allProducts)}
      />
    </div>
  );
}