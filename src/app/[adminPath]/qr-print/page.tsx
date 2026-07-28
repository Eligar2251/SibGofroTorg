// =========================================================
// FILE: src/app/[adminPath]/qr-print/page.tsx
// Массовая печать QR + штрихкодов: компактные этикетки ~4×5 см,
// на листе A4 помещается ~24 штуки. С фильтром по категории и
// поиском по названию.
//
// Печать работает через window.print() — отдельный CSS @media print
// оставляет только сетку этикеток, скрывая всё остальное.
// =========================================================

import Link from "next/link";
import { Printer, ArrowLeft, QrCode, Filter } from "lucide-react";
import { getAllCategories, getProducts } from "@/lib/supabase-queries";
import { formatBarcode, computeBarcode, computeQrSlug } from "@/lib/qr";
import { PrintLabelsClient } from "@/components/admin/PrintLabelsClient";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Печать QR-кодов — СибГофроТорг" };

export default async function QrPrintPage({
  searchParams,
}: {
  searchParams: Promise<{
    cat?: string;
    q?: string;
    only?: string;
  }>;
}) {
  const params = await searchParams;
  const [allProducts, categories] = await Promise.all([
    getProducts({ includeHidden: true }),
    getAllCategories(),
  ]);

  // Обогащаем товары кодами (если не из кеша)
  const products = allProducts.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? null,
    price: p.price,
    inStock: p.inStock,
    barcode: p.barcode || computeBarcode(p.id),
    qrSlug: p.qrSlug || computeQrSlug(p.id),
    categoryId: p.categoryId ?? null,
  }));

  // Сортировка по имени для удобства выбора
  products.sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return (
    <div className="qrprint-page">
      <div className="qrprint-page__head no-print">
        <Link href={`/${ADMIN_PATH}`} className="qrprint-page__back">
          <ArrowLeft size={16} /> В админку
        </Link>
        <h1 className="qrprint-page__title">
          <QrCode size={20} /> Печать QR + штрихкодов
        </h1>
      </div>

      <PrintLabelsClient
        products={products}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        selectedCategory={params.cat || ""}
        query={params.q || ""}
        adminPath={ADMIN_PATH}
      />
    </div>
  );
}
