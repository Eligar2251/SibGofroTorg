// src/app/[adminPath]/promotions/page.tsx
import { notFound } from "next/navigation";
import { getAllPromotions, getProducts } from "@/lib/firestore-queries";
import { PromotionsManager } from "@/components/admin/PromotionsManager";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

export default async function AdminPromotionsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [promos, products] = await Promise.all([
    getAllPromotions(),
    getProducts({}),
  ]);

  const serializedPromos = promos.map((p) => ({
    id: p.id,
    title: p.title,
    subtitle: p.subtitle ?? null,
    badge: p.badge ?? null,
    imageUrl: p.imageUrl ?? null,
    linkType: p.linkType,
    productId: p.productId ?? null,
    linkUrl: p.linkUrl ?? null,
    sortOrder: p.sortOrder ?? 0,
    isVisible: p.isVisible ?? true,
    icon: p.icon ?? null,
    color: p.color ?? null,
    light: p.light ?? null,
    deadline: p.deadline ?? null,
  }));

  const serializedProducts = products.map((pr) => ({
    id: pr.id,
    name: pr.name,
    slug: pr.slug,
  }));

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Акции и Спецпредложения</h1>
          <p className="admin-sub">
            Всего: <strong style={{ color: "var(--adm-navy)" }}>{promos.length}</strong> баннеров / предложений
          </p>
        </div>
      </div>

      <PromotionsManager
        promotions={serializedPromos}
        products={serializedProducts}
      />
    </div>
  );
}
