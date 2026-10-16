// =========================================================
// FILE: src/app/[adminPath]/products/prices/page.tsx
// «Массовые цены»: страница массового изменения цен.
//
// Данные берём из getProductsForBulkEditor() — это сырые строки products
// (без агрегации вариантов), поэтому сохранение цены не затирает
// витринную цену «от X ₽» у товаров с вариантами. Наличие вариантов
// показываем отдельным бейджем: цена на сайте у таких товаров берётся
// из вариантов, и в интерфейсе это видно.
// =========================================================

import { notFound } from "next/navigation";
import { getAllCategories, getProductsForBulkEditor } from "@/lib/supabase-queries";
import { getCachedVariantsMap } from "@/lib/variants";
import type { ProductVariant } from "@/lib/types";
import { BulkPricesClient } from "@/components/admin/BulkPricesClient";
import { ADMIN_PATH } from "@/lib/admin-path";

export const dynamic = "force-dynamic";

export default async function BulkPricesPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [products, categories] = await Promise.all([
    getProductsForBulkEditor(),
    getAllCategories(),
  ]);

  // Сводка по вариантам — тем же кешем, что каталог: +1 запрос в 60 секунд
  // и никакой «лишней» работы на каждый заход.
  const variantsMap: Map<string, ProductVariant[]> = await getCachedVariantsMap(
    products.map((product) => product.id)
  ).catch((error: unknown) => {
    console.warn("[bulk-prices] не удалось получить варианты", error);
    return new Map<string, ProductVariant[]>();
  });

  const serialized = products.map((product) => {
    const variants = variantsMap.get(product.id) || [];
    return {
      id: product.id,
      name: product.name,
      sku: product.sku ?? null,
      categoryId: product.categoryId ?? null,
      price: product.price ?? null,
      purchasePrice: product.purchasePrice ?? null,
      hasVariants: variants.length > 0,
      variantCount: variants.length,
      stockQty: Number(product.stockQty ?? 0),
      isVisible: product.isVisible !== false,
      discountType:
        product.discountType === "percent" || product.discountType === "fixed"
          ? product.discountType
          : null,
      discountValue:
        product.discountValue === null || product.discountValue === undefined
          ? null
          : Number(product.discountValue),
    };
  });

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Массовые цены</h1>
          <p className="admin-sub">
            Выберите товары и поставьте им одну цену или наценку к закупке. Накрутка, маржа и
            прибыль считаются сразу — как в колонке «Разница» на складе.
          </p>
        </div>
      </div>
      <BulkPricesClient
        products={serialized}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        adminPath={ADMIN_PATH}
      />
    </div>
  );
}
