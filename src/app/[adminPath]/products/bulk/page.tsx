// src/app/[adminPath]/products/bulk/page.tsx
import { getProducts, getAllCategories } from "@/lib/firestore-queries";
import { BulkProductEditor } from "@/components/admin/BulkProductEditor";
import { notFound } from "next/navigation";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

export default async function BulkProductsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [products, categories] = await Promise.all([
    getProducts({}),
    getAllCategories(),
  ]);

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const serialized = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? "",
    categoryId: p.categoryId ?? "",
    price: p.price ?? 0,
    priceWholesale: p.priceWholesale ?? null,
    minWholesaleQty: p.minWholesaleQty ?? null,
    stockQty: p.stockQty ?? null,
    inStock: p.inStock,
    isVisible: p.isVisible,
    isPromo: p.isPromo,
    isFeatured: p.isFeatured,
    promoLabel: p.promoLabel ?? "",
    material: p.material ?? "",
  }));

  return (
    <div>
      <h1 className="admin-h1">Массовое редактирование товаров</h1>
      <BulkProductEditor
        products={serialized}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        catMap={catMap}
      />
    </div>
  );
}