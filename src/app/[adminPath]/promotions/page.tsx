// src/app/[adminPath]/promotions/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { Megaphone, BellRing } from "lucide-react";
import { getAllPromotions, getProducts, getAllPopupCampaigns } from "@/lib/supabase-queries";
import { PromotionsManager } from "@/components/admin/PromotionsManager";
import { PopupCampaignsManager } from "@/components/admin/PopupCampaignsManager";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

export default async function AdminPromotionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();
  const { tab } = await searchParams;
  const activeTab = tab === "popups" ? "popups" : "promotions";

  const [promos, products, campaigns] = await Promise.all([
    getAllPromotions(),
    getProducts({}),
    getAllPopupCampaigns(),
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

  const serializedProducts = products.map((pr) => ({ id: pr.id, name: pr.name, slug: pr.slug }));

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Акции и инфо-окна</h1>
          <p className="admin-sub">
            Акции: <strong style={{ color: "var(--adm-navy)" }}>{promos.length}</strong> · Инфо-окна: <strong style={{ color: "var(--adm-navy)" }}>{campaigns.length}</strong>
          </p>
        </div>
      </div>

      <div className="admin-filters">
        <Link href={`/${ADMIN_PATH}/promotions?tab=promotions`} className={`admin-filter${activeTab === "promotions" ? " admin-filter--active" : ""}`} prefetch={false}>
          <Megaphone size={13} /> Акции
        </Link>
        <Link href={`/${ADMIN_PATH}/promotions?tab=popups`} className={`admin-filter${activeTab === "popups" ? " admin-filter--active" : ""}`} prefetch={false}>
          <BellRing size={13} /> Инфо-окна
        </Link>
      </div>

      {activeTab === "promotions" ? (
        <PromotionsManager promotions={serializedPromos} products={serializedProducts} />
      ) : (
        <PopupCampaignsManager
          initialCampaigns={campaigns.map((item) => ({
            id: item.id,
            type: item.type || "banner",
            title: item.title,
            kicker: item.kicker || null,
            description: item.description || null,
            details: item.details || null,
            imageUrl: item.imageUrl || null,
            buttonText: item.buttonText || null,
            buttonUrl: item.buttonUrl || null,
            style: item.style,
            isActive: item.isActive,
            startAt: item.startAt || null,
            endAt: item.endAt || null,
            delaySeconds: item.delaySeconds,
            durationSeconds: item.durationSeconds,
            frequency: item.frequency,
            sortOrder: item.sortOrder,
          }))}
        />
      )}
    </div>
  );
}
