// =========================================================
// FILE: src/app/[adminPath]/products/page.tsx
// =========================================================

import { getProducts, getAllCategories } from "@/lib/firestore-queries";
import Link from "next/link";
import { Plus, Pencil, Package, FolderOpen } from "lucide-react";
import { notFound } from "next/navigation";
import { ProductListClient } from "@/components/admin/ProductListClient";
import { CategoryManager } from "@/components/admin/CategoryManager";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();
  const { tab } = await searchParams;
  const activeTab = tab === "categories" ? "categories" : "products";

  const [allProducts, cats] = await Promise.all([
    getProducts({ includeHidden: true }),
    getAllCategories(),
  ]);

  const serializedProducts = allProducts.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? null,
    categoryId: p.categoryId ?? null,
    price: p.price ?? null,
    priceWholesale: p.priceWholesale ?? null,
    stockQty: p.stockQty ?? 0,
    inStock: p.inStock,
    isPromo: p.isPromo,
    promoLabel: p.promoLabel ?? null,
    madeToOrder: p.madeToOrder ?? false,
    isVisible: p.isVisible,
    imageUrl: p.imageUrl ?? null,
    viewCount: p.viewCount ?? 0,
  }));

  const serializedCats = cats.map((c) => ({ id: c.id, name: c.name }));
  const productCounts = new Map<string, number>();
  for (const product of allProducts) {
    if (!product.categoryId) continue;
    productCounts.set(product.categoryId, (productCounts.get(product.categoryId) || 0) + 1);
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
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Товары и категории</h1>
          <p className="admin-sub">Товары: {allProducts.length} · Категории: {cats.length}</p>
        </div>
        {activeTab === "products" && (
          <div className="admin-page-head__actions">
            <Link href={`/${ADMIN_PATH}/products/bulk`} className="admin-btn admin-btn--ghost" prefetch={false}>
              <Pencil size={15} /> Массовое редактирование
            </Link>
            <Link href={`/${ADMIN_PATH}/products/new`} className="admin-btn admin-btn--primary" prefetch={false}>
              <Plus size={16} /> Добавить товар
            </Link>
          </div>
        )}
      </div>

      <div className="admin-filters">
        <Link href={`/${ADMIN_PATH}/products?tab=products`} className={`admin-filter${activeTab === "products" ? " admin-filter--active" : ""}`} prefetch={false}>
          <Package size={13} /> Товары
        </Link>
        <Link href={`/${ADMIN_PATH}/products?tab=categories`} className={`admin-filter${activeTab === "categories" ? " admin-filter--active" : ""}`} prefetch={false}>
          <FolderOpen size={13} /> Категории
        </Link>
      </div>

      {activeTab === "products" ? (
        <ProductListClient products={serializedProducts} categories={serializedCats} adminPath={ADMIN_PATH} />
      ) : (
        <CategoryManager categories={catsWithCounts} />
      )}
    </div>
  );
}
