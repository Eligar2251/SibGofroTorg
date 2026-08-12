// src/app/[adminPath]/products/made-to-order/page.tsx
// Отдельная вкладка с товарами под заказ — массовое редактирование минимального количества

import { getProducts } from "@/lib/supabase-queries";
import { notFound } from "next/navigation";
import { MadeToOrderManagerClient } from "@/components/admin/MadeToOrderManagerClient";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

export default async function MadeToOrderPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const allProducts = await getProducts({ includeHidden: true });
  const madeToOrderProducts = allProducts.filter((p) => p.madeToOrder);

  const serialized = madeToOrderProducts.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    price: p.price ?? null,
    madeToOrder: true,
    madeToOrderMinQty: (p as any).madeToOrderMinQty ?? null,
    isVisible: p.isVisible,
    stockQty: p.stockQty ?? 0,
    imageUrl: p.imageUrl ?? null,
    slug: p.slug,
  }));

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Товары под заказ</h1>
          <p className="admin-sub">
            Товары с пометкой «Под заказ». Здесь можно массово указать от какого количества изготавливаем.
            На сайте показывается как «Под заказ от N шт.»
          </p>
        </div>
      </div>
      <MadeToOrderManagerClient products={serialized} adminPath={ADMIN_PATH} />
    </div>
  );
}
