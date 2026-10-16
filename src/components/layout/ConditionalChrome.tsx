// =========================================================
// FILE: src/components/layout/ConditionalChrome.tsx
// =========================================================

"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Header, type HeaderCategory } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MessengerFloatingBanner } from "@/components/layout/MessengerFloatingBanner";
import { FloatingCart } from "@/components/layout/FloatingCart";
import { CartPopup } from "@/components/layout/CartPopup";
import { PromotionPopups } from "@/components/promotions/PromotionPopups";
import type { PublicPopupCampaign } from "@/lib/popup-campaign";
import { CLIENT_ADMIN_PATH } from "@/lib/admin-path-client";


export function ConditionalChrome({
  children,
  popupCampaigns = [],
  categories = [],
}: {
  children: ReactNode;
  /** Приходят из серверного layout — без клиентского fetch /api/popups */
  popupCampaigns?: PublicPopupCampaign[];
  /** Категории меню — тоже из серверного layout, без fetch /api/categories */
  categories?: HeaderCategory[];
}) {
  const pathname = usePathname() || "";
  const isAdmin = pathname === `/${CLIENT_ADMIN_PATH}` || pathname.startsWith(`/${CLIENT_ADMIN_PATH}/`);

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
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
