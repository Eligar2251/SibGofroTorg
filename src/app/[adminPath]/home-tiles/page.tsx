// =========================================================
// FILE: src/app/[adminPath]/home-tiles/page.tsx
// Плитки на главной: настройка набора, порядка, фото и правил.
// =========================================================

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  getAllCategories,
  getAllHomeTiles,
  getProducts,
  homeTilesTableExists,
} from "@/lib/supabase-queries";
import { HomeTilesManager } from "@/components/admin/HomeTilesManager";
import { collectProductTags, productMatchesTile } from "@/lib/home-tiles";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Плитки на главной — СибГофроТорг",
};

export default async function HomeTilesPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [tiles, categories, products, tableExists] = await Promise.all([
    getAllHomeTiles().catch(() => []),
    getAllCategories(),
    getProducts({}),
    homeTilesTableExists(),
  ]);

  const tilesWithCounts = tiles.map((tile) => ({
    ...tile,
    productCount: products.filter((p) => productMatchesTile(p, tile)).length,
  }));

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Плитки на главной</h1>
          <p className="admin-sub">
            Плиток: {tiles.length} · Категорий: {categories.length}
          </p>
        </div>
        <div className="admin-page-head__actions">
          <Link
            href={`/${ADMIN_PATH}/products?tab=categories`}
            className="admin-btn admin-btn--ghost"
            prefetch={false}
          >
            <ArrowLeft size={15} /> К категориям
          </Link>
        </div>
      </div>

      <HomeTilesManager
        tiles={tilesWithCounts}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        knownTags={collectProductTags(products)}
        migrationMissing={!tableExists}
      />
    </div>
  );
}
