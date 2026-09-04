// src/app/[adminPath]/products/bulk/page.tsx
import { getProductsForBulkEditor, getAllCategories } from "@/lib/supabase-queries";
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
    getProductsForBulkEditor(),
    getAllCategories(),
  ]);

  const serialized = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? "",
    categoryId: p.categoryId ?? "",
    description: p.description ?? "",
    note: p.note ?? "",
    price: p.price ?? null,
    purchasePrice: p.purchasePrice ?? null,
    priceWholesale: p.priceWholesale ?? null,
    minWholesaleQty: p.minWholesaleQty ?? null,
    discountType: p.discountType || "",
    discountValue: p.discountValue ?? null,
    discountBadge: p.discountBadge ?? "",
    stockQty: p.stockQty ?? null,
    stockWarnQty: p.stockWarnQty ?? null,
    inStock: p.inStock,
    dimensionLength: p.dimensionLength ?? null,
    dimensionWidth: p.dimensionWidth ?? null,
    dimensionHeight: p.dimensionHeight ?? null,
    dimensionUnit: p.dimensionUnit ?? "мм",
    weight: p.weight ?? null,
    volume: p.volume ?? null,
    material: p.material ?? "",
    packQty: p.packQty ?? null,
    isVisible: p.isVisible,
    isPromo: p.isPromo,
    isFeatured: p.isFeatured,
    isSale: p.isSale ?? false,
    promoLabel: p.promoLabel ?? "",
    promoLabelColor: p.promoLabelColor ?? "",
    promoLabelTextColor: p.promoLabelTextColor ?? "",
    tags: p.tags ?? [],
    madeToOrder: p.madeToOrder ?? false,
    madeToOrderMinQty: p.madeToOrderMinQty ?? null,
    isCuttable: p.isCuttable ?? false,
    cutMetersPerRoll: p.cutMetersPerRoll ?? null,
    cutPricePerMeter: p.cutPricePerMeter ?? null,
    cutUnitName: p.cutUnitName ?? "",
    barcode: p.barcode ?? "",
  }));

  return (
    <div>
      <h1 className="admin-h1">Массовое редактирование товаров</h1>
      <BulkProductEditor
        products={serialized}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
