// =========================================================
// FILE: src/app/[adminPath]/layout.tsx
// =========================================================

import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const metadata: Metadata = {
  title: "Админ-панель — СибГофроТорг",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;

  if (adminPath !== ADMIN_PATH) {
    notFound();
  }

  return <AdminShell adminPath={ADMIN_PATH}>{children}</AdminShell>;
}