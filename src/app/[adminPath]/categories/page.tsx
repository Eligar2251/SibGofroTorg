// =========================================================
// FILE: src/app/[adminPath]/categories/page.tsx
// =========================================================

import { getAllCategories, getProductCount } from "@/lib/firestore-queries";
import { CategoryManager } from "@/components/admin/CategoryManager";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const cats = await getAllCategories();

  const catsWithCounts = await Promise.all(
    cats.map(async (cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      icon: cat.icon ?? null,
      description: cat.description ?? null,
      sortOrder: cat.sortOrder ?? 0,
      isVisible: cat.isVisible ?? true,
      imageUrl: cat.imageUrl ?? null,
      createdAt: cat.createdAt
        ? typeof cat.createdAt === "string"
          ? cat.createdAt
          : (cat.createdAt as any)?.toDate?.()
            ? (cat.createdAt as any).toDate().toISOString()
            : null
        : null,
      productCount: await getProductCount(cat.id),
    }))
  );

  return (
    <div>
      <h1 className="admin-h1">Категории</h1>
      <CategoryManager categories={catsWithCounts} />
    </div>
  );
}