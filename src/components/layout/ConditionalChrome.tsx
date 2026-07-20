// =========================================================
// FILE: src/components/layout/ConditionalChrome.tsx
// =========================================================

"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { PromotionPopups } from "@/components/promotions/PromotionPopups";

const ADMIN_PATH = process.env.NEXT_PUBLIC_ADMIN_PATH || "admin";

export function ConditionalChrome({ children }: { children: ReactNode }) {
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
      <PromotionPopups />
    </>
  );
}