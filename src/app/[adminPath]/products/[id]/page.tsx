// =========================================================
// FILE: src/app/[adminPath]/products/[id]/page.tsx
// =========================================================

import { notFound } from "next/navigation";
import {
  getProductByIdForAdmin,
  getAllCategories,
  getFeaturedProductOrderIds,
} from "@/lib/supabase-queries";
import { ProductFormClient } from "@/components/admin/ProductFormClient";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

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

  const [categories, featuredOrderIds] = await Promise.all([
    getAllCategories(),
    getFeaturedProductOrderIds(),
  ]);

  const serializedProduct = {
    ...product,
    featuredOrder:
      product.isFeatured
        ? (() => {
            const idx = featuredOrderIds.findIndex((itemId) => itemId === product.id);
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
    createdAt:
      typeof cat.createdAt === "string"
        ? cat.createdAt
        : cat.createdAt?.toDate?.()
          ? cat.createdAt.toDate().toISOString()
          : null,
  }));

  return (
    <div>
      <h1 className="admin-h1">Редактировать товар</h1>
      <ProductFormClient
        categories={serializedCategories}
        product={serializedProduct}
        featuredOrderIds={featuredOrderIds}
      />
    </div>
  );
}