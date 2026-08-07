// =========================================================
// FILE: src/app/[adminPath]/qr-print/page.tsx
// Массовая печать этикеток товара: штрихкод EAN-13 (основной
// формат — тот самый постоянный код из БД) и/или QR-код.
// Лист A4 с сеткой этикеток 4×4/5×5/6×6 см или термопринтер
// (Xprinter, этикетки 60×40 мм = 6×4 см) — режим выбирается
// на странице. С фильтром по категории и поиском по названию.
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
export const metadata = { title: "Печать этикеток — СибГофроТорг" };

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

  // Обогащаем товары кодами (если не из кеша) + размерами для этикеток
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
    dimensionLength: p.dimensionLength ?? null,
    dimensionWidth: p.dimensionWidth ?? null,
    dimensionHeight: p.dimensionHeight ?? null,
    dimensionUnit: p.dimensionUnit ?? null,
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
          <QrCode size={20} /> Печать этикеток: штрихкоды и QR
        </h1>
        <Link href={`/${ADMIN_PATH}/box-labels`} className="qrprint-page__back" prefetch={false}>
          Этикетки ящиков (A4, крупный №) →
        </Link>
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
