// =========================================================
// FILE: src/app/[adminPath]/products/photo-generator/page.tsx
// Конструктор шаблонных фото для товаров: выбираем товары,
// собираем карточку (фон, элементы, плейсхолдеры вроде {{size}})
// и генерируем по одному фото на каждый выбранный товар —
// размеры и данные подставляются из карточки, результат в Cloudinary.
// =========================================================

import { notFound } from "next/navigation";
import { getProducts, getAllCategories } from "@/lib/supabase-queries";
import { PhotoTemplateGenerator } from "@/components/admin/PhotoTemplateGenerator";
import "@/app/photo-generator.css";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function PhotoGeneratorPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [allProducts, cats] = await Promise.all([
    getProducts({ includeHidden: true }),
    getAllCategories(),
  ]);

  const serializedProducts = allProducts.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    price: p.price ?? null,
    categoryId: p.categoryId ?? null,
    dimensionLength: p.dimensionLength ?? null,
    dimensionWidth: p.dimensionWidth ?? null,
    dimensionHeight: p.dimensionHeight ?? null,
    dimensionUnit: p.dimensionUnit ?? "мм",
    material: p.material ?? null,
    volume: p.volume ?? null,
    barcode: p.barcode ?? null,
    imageUrl: p.imageUrl ?? null,
  }));

  const categories = cats.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Авто-генерация фото товаров</h1>
          <p className="admin-sub">
            Шаблонная карточка → свои фото для выбранных товаров (Cloudinary)
          </p>
        </div>
      </div>

      <PhotoTemplateGenerator
        products={serializedProducts}
        categories={categories}
        adminPath={ADMIN_PATH}
      />
    </div>
  );
}
