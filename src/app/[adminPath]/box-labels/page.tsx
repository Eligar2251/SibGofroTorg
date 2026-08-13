// =========================================================
// FILE: src/app/[adminPath]/box-labels/page.tsx
// Отдельная печать этикеток ЯЩИКОВ на листе A4 (вертикально):
// строгий макет на всю физическую ширину A4:
// [№ и указанное число] | [размеры] | [штрихкод].
// =========================================================

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAllCategories, getProducts } from "@/lib/supabase-queries";
import { computeBarcode } from "@/lib/qr";
import { BoxLabelsClient } from "@/components/admin/BoxLabelsClient";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Печать этикеток ящиков — СибГофроТорг" };

export default async function BoxLabelsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [allProducts, categories] = await Promise.all([
    getProducts({ includeHidden: true }),
    getAllCategories(),
  ]);

  const products = allProducts
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku ?? null,
      barcode: p.barcode || computeBarcode(p.id),
      categoryId: p.categoryId ?? null,
      dimensionLength: p.dimensionLength ?? null,
      dimensionWidth: p.dimensionWidth ?? null,
      dimensionHeight: p.dimensionHeight ?? null,
      dimensionUnit: p.dimensionUnit ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return (
    <div className="qrprint-page">
      <div className="qrprint-page__head no-print">
        <Link href={`/${ADMIN_PATH}/products`} className="qrprint-page__back" prefetch={false}>
          <ArrowLeft size={16} /> В товары
        </Link>
        <h1 className="qrprint-page__title">Этикетки ящиков · A4 вертикально</h1>
        <Link href={`/${ADMIN_PATH}/qr-print`} className="qrprint-page__back" prefetch={false}>
          Обычные этикетки (штрихкод/QR)
        </Link>
      </div>
      <BoxLabelsClient
        products={products}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
