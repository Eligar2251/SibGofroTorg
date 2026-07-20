// =========================================================
// FILE: src/app/[adminPath]/products/page.tsx
// =========================================================

import { getProducts, getAllCategories } from "@/lib/firestore-queries";
import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { ProductListClient } from "@/components/admin/ProductListClient";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const allProducts = await getProducts({});
  const cats = await getAllCategories();

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

  const serializedCats = cats.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Товары</h1>
          <p className="admin-sub">Всего: {allProducts.length} товаров</p>
        </div>
        <div className="admin-page-head__actions">
          <Link
            href={`/${ADMIN_PATH}/products/bulk`}
            className="admin-btn admin-btn--ghost"
           prefetch={false}>
            <Pencil size={15} /> Массовое редактирование
          </Link>
          <Link
            href={`/${ADMIN_PATH}/products/new`}
            className="admin-btn admin-btn--primary"
           prefetch={false}>
            <Plus size={16} /> Добавить товар
          </Link>
        </div>
      </div>

      <ProductListClient
        products={serializedProducts}
        categories={serializedCats}
        adminPath={ADMIN_PATH}
      />
    </div>
  );
}
