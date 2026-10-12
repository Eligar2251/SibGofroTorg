// =========================================================
// FILE: src/app/cabinet/layout.tsx
// Метаданные кабинета: страница клиентская, поэтому title/robots — здесь.
// =========================================================

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Личный кабинет",
  description:
    "Личный кабинет СибГофроТорг: история заказов, статусы и повторный заказ.",
  alternates: { canonical: `${SITE_URL}/cabinet` },
  robots: { index: false, follow: false },
};

export default function CabinetLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
