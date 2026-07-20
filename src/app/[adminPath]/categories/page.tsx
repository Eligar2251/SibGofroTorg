// =========================================================
// FILE: src/app/[adminPath]/categories/page.tsx
// =========================================================

import { getAllCategories, getProducts } from "@/lib/firestore-queries";
import { CategoryManager } from "@/components/admin/CategoryManager";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  // Один общий снимок товаров вместо повторного вызова подсчёта для каждой
  // категории. Данные кэшируются и инвалидируются CRUD-операциями товаров.
  const [cats, products] = await Promise.all([
    getAllCategories(),
    getProducts({}),
  ]);
  const productCounts = new Map<string, number>();
  for (const product of products) {
    if (!product.categoryId) continue;
    productCounts.set(
      product.categoryId,
      (productCounts.get(product.categoryId) || 0) + 1
    );
  }

  const catsWithCounts = cats.map((cat) => ({
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
    productCount: productCounts.get(cat.id) || 0,
  }));

  return (
    <div>
      <h1 className="admin-h1">Категории</h1>
      <CategoryManager categories={catsWithCounts} />
    </div>
  );
}
