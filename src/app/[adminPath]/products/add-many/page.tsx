// =========================================================
// FILE: src/app/[adminPath]/products/add-many/page.tsx
// Массовое добавление НОВЫХ товаров: название, артикул, цена,
// размеры, количество. Остальные поля доредактируются в
// «Массовом редактировании».
// =========================================================

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BulkProductAdder } from "@/components/admin/BulkProductAdder";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Массовое добавление товаров — СибГофроТорг" };

export default async function AddManyProductsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  return (
    <div className="admin-stack">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Массовое добавление товаров</h1>
          <p className="admin-block__desc">
            Только основные поля: название, артикул, цена, размеры (Д×Ш×В в мм)
            и количество на складе. Штрихкод создаётся автоматически. Фото,
            описание, оптовые цены и остальное — потом в «Массовом
            редактировании».
          </p>
        </div>
        <div className="admin-page-head__actions">
          <Link
            href={`/${ADMIN_PATH}/products`}
            className="admin-btn admin-btn--ghost"
            prefetch={false}
          >
            <ArrowLeft size={15} /> К товарам
          </Link>
        </div>
      </div>

      <BulkProductAdder adminPath={ADMIN_PATH} />
    </div>
  );
}
