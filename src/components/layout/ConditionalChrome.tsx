// =========================================================
// FILE: src/components/layout/ConditionalChrome.tsx
// =========================================================

"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MessengerFloatingBanner } from "@/components/layout/MessengerFloatingBanner";
import { FloatingCart } from "@/components/layout/FloatingCart";
import { CartPopup } from "@/components/layout/CartPopup";
import { PromotionPopups } from "@/components/promotions/PromotionPopups";
import type { PublicPopupCampaign } from "@/lib/popup-campaign";

const ADMIN_PATH = process.env.NEXT_PUBLIC_ADMIN_PATH || "admin";

export function ConditionalChrome({
  children,
  popupCampaigns = [],
}: {
  children: ReactNode;
  /** Приходят из серверного layout — без клиентского fetch /api/popups */
  popupCampaigns?: PublicPopupCampaign[];
}) {
  const pathname = usePathname() || "";
  const isAdmin = pathname === `/${ADMIN_PATH}` || pathname.startsWith(`/${ADMIN_PATH}/`);

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      <Header />
      <main style={{ minHeight: "60vh" }}>{children}</main>
      <Footer />
      <FloatingCart />
      <CartPopup />
      <MessengerFloatingBanner />
      <PromotionPopups initialCampaigns={popupCampaigns} />
    </>
  );
}
