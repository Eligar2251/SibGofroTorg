// =========================================================
// FILE: src/app/[adminPath]/products/prices/page.tsx
// Массовое изменение цен товаров (своя цена или % от закупки).
// =========================================================

import { notFound } from "next/navigation";
import { getCategories, getProductsForBulkEditor } from "@/lib/supabase-queries";
import { ADMIN_PATH } from "@/lib/admin-path";
import {
  BulkPricesClient,
  type BulkPriceProduct,
} from "@/components/admin/BulkPricesClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Массовые цены — СибГофроТорг",
};

export default async function BulkPricesPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [rawProducts, categories] = await Promise.all([
    getProductsForBulkEditor().catch(() => []),
    getCategories().catch(() => []),
  ]);

  const products: BulkPriceProduct[] = rawProducts.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku ?? null,
    categoryId: product.categoryId || null,
    price: product.price ?? null,
    purchasePrice: product.purchasePrice ?? null,
    stockQty: Number(product.stockQty ?? 0),
    isVisible: product.isVisible !== false,
    discountType: product.discountType ?? null,
    discountValue: product.discountValue ?? null,
  }));

  const cats = categories.map((c) => ({ id: c.id, name: c.name }));

  return (
    <BulkPricesClient
      adminPath={ADMIN_PATH}
      products={products}
      categories={cats}
    />
  );
}
