// =========================================================
// FILE: src/app/login/page.tsx
// =========================================================

import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginClient } from "@/components/auth/LoginClient";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Вход в кабинет",
  description:
    "Вход в личный кабинет СибГофроТорг: история заказов, статусы и повторный заказ.",
  alternates: { canonical: `${SITE_URL}/login` },
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "50vh", display: "grid", placeItems: "center" }}>
          Загрузка...
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  );
}