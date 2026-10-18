// =========================================================
// FILE: src/app/[adminPath]/price-list/page.tsx
// «Прайс-лист по объёмам»: выбор товаров, закупочные цены,
// обычная цена (+30%) и цены по объёмам, печать на А4.
//
// Данные — сырые строки products (как в «Массовых ценах»): закупка
// берётся из карточки товара, но её можно переписать в прайсе и (по
// желанию) записать обратно в карточки кнопкой в редакторе.
// =========================================================

import { notFound } from "next/navigation";
import { SITE_NAME } from "@/lib/seo";
import { formatProductSize } from "@/lib/product-size";
import {
  getAllCategories,
  getProductsForBulkEditor,
} from "@/lib/supabase-queries";
import { getPublicSettingsView } from "@/lib/public-settings";
import { ADMIN_PATH } from "@/lib/admin-path";
import { PriceListClient } from "@/components/admin/PriceListClient";

export const dynamic = "force-dynamic";

export default async function AdminPriceListPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [products, categories, publicSettings] = await Promise.all([
    getProductsForBulkEditor(),
    getAllCategories(),
    getPublicSettingsView().catch(() => null),
  ]);

  const categoryName = new Map(
    categories.map((category) => [category.id, category.name])
  );

  const serialized = products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku ?? null,
    categoryId: product.categoryId ?? null,
    categoryName: product.categoryId
      ? categoryName.get(product.categoryId) ?? null
      : null,
    price: product.price ?? null,
    purchasePrice: product.purchasePrice ?? null,
    size: formatProductSize(product, "any"),
    packQty: product.packQty ?? null,
    stockQty: product.stockQty ?? null,
    isVisible: product.isVisible !== false,
  }));

  const contacts = publicSettings
    ? [publicSettings.phone, publicSettings.email, publicSettings.address]
        .filter((value) => Boolean(value && value.trim()))
        .join(" · ")
    : "";

  return (
    <PriceListClient
      products={serialized}
      categories={categories.map((category) => ({
        id: category.id,
        name: category.name,
      }))}
      company={{ name: SITE_NAME, contacts }}
    />
  );
}
