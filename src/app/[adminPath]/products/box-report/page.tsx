// =========================================================
// FILE: src/app/[adminPath]/products/box-report/page.tsx
// Отчёт по коробкам с выбором полей и печатью
// =========================================================

import { getProducts, getAllCategories } from "@/lib/supabase-queries";
import { notFound } from "next/navigation";
import { BoxReportClient } from "@/components/admin/BoxReportClient";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

export default async function BoxReportPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [products, cats] = await Promise.all([
    getProducts({ includeHidden: true }),
    getAllCategories(),
  ]);

  const catMap = new Map(cats.map((c) => [c.id, c.name]));

  const serialized = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    dimensionLength: p.dimensionLength ?? null,
    dimensionWidth: p.dimensionWidth ?? null,
    dimensionHeight: p.dimensionHeight ?? null,
    dimensionUnit: p.dimensionUnit ?? "мм",
    material: p.material ?? null,
    packQty: p.packQty ?? null,
    volume: p.volume ?? null,
    price: p.price ?? null,
    priceWholesale: p.priceWholesale ?? null,
    stockQty: p.stockQty ?? null,
    note: p.note ?? null,
    categoryName: p.categoryId ? catMap.get(p.categoryId) || null : null,
  }));

  return (
    <div className="admin-stack">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Отчёт по коробкам — печать и прайс A4</h1>
          <p className="admin-sub">
            Крупная таблица цен (название · размер · цена) или компактный отчёт.
            Шрифт подстраивается под число позиций. Выбор полей запоминается.
          </p>
        </div>
        <div className="admin-page-head__actions">
          <Link href={`/${ADMIN_PATH}/products`} className="admin-btn admin-btn--ghost">
            <ArrowLeft size={15} /> К товарам
          </Link>
        </div>
      </div>

      <BoxReportClient products={serialized} />
    </div>
  );
}
