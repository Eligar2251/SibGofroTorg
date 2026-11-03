// =========================================================
// FILE: src/components/layout/ConditionalChrome.tsx
// =========================================================

"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Header, type HeaderCategory } from "@/components/layout/Header";
import { BegetEmergencyBanner } from "@/components/layout/BegetEmergencyBanner";
import { Footer } from "@/components/layout/Footer";
import { MessengerFloatingBanner } from "@/components/layout/MessengerFloatingBanner";
import { FloatingCart } from "@/components/layout/FloatingCart";
import { CartPopup } from "@/components/layout/CartPopup";
import { PromotionPopups } from "@/components/promotions/PromotionPopups";
import type { PublicPopupCampaign } from "@/lib/popup-campaign";
import { CLIENT_ADMIN_PATH } from "@/lib/admin-path-client";


export function ConditionalChrome({
  children,
  adminPath,
  popupCampaigns = [],
  categories = [],
}: {
  children: ReactNode;
  /** Серверный путь админки из RootLayout (совпадает с рантайм ADMIN_PATH даже в Docker без build-arg) */
  adminPath?: string;
  /** Приходят из серверного layout — без клиентского fetch /api/popups */
  popupCampaigns?: PublicPopupCampaign[];
  /** Категории меню — тоже из серверного layout, без fetch /api/categories */
  categories?: HeaderCategory[];
}) {
  const pathname = usePathname() || "";
  const effectiveAdminPath = adminPath || CLIENT_ADMIN_PATH;
  const isAdmin =
    pathname === `/${effectiveAdminPath}` ||
    pathname.startsWith(`/${effectiveAdminPath}/`);

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      <BegetEmergencyBanner />
      <Header initialCategories={categories} />
      <main style={{ minHeight: "60vh" }}>{children}</main>
      <Footer />
      <FloatingCart />
      <CartPopup />
      <MessengerFloatingBanner />
      <PromotionPopups initialCampaigns={popupCampaigns} />
    </>
  );
}
