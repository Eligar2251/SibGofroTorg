// =========================================================
// FILE: src/app/[adminPath]/layout.tsx
// =========================================================

import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { verifySession } from "@/lib/auth";
// Стили админки грузятся только здесь, а не на всём сайте (раньше
// admin.css импортировался в globals.css и попадал в бандл каждой страницы).
import "../admin.css";
import "../admin-users.css";
import "../rent.css";
import "../admin-themes.css";
// Единый финальный слой для телефонов/вертикальных планшетов. Он должен
// идти последним, чтобы старые локальные media-правила не ломали сетку.
import "../admin-mobile.css";
import { AdminThemeProvider } from "@/components/admin/AdminTheme";

// Этот путь читается и клиентской оболочкой (ConditionalChrome), поэтому
// единственный источник истины — публичная переменная. Legacy-переменная
// оставлена только как fallback для существующих окружений.
const ADMIN_PATH = process.env.NEXT_PUBLIC_ADMIN_PATH || process.env.ADMIN_SECRET_PATH || "admin";

// generateMetadata вместо статического metadata: любой неизвестный URL
// первого уровня (/something) попадает в этот маршрут и получает notFound().
// Статические metadata «Админ-панель» при этом протекали на саму 404-страницу
// (в выдаче мог появиться заголовок «Админ-панель» у страницы «не найдено»).
// Условная генерация отдаёт для чужих путей нейтральный заголовок + noindex.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}): Promise<Metadata> {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) {
    return {
      title: "Страница не найдена",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: "Админ-панель — СибГофроТорг",
    applicationName: "СибГофроТорг Админ",
    manifest: "/admin-manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "СибГофроТорг Админ",
      statusBarStyle: "black-translucent",
    },
    robots: { index: false, follow: false },
  };
}

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

  const session = await verifySession();

  return (
    <>
      <AdminThemeProvider>
        <AdminShell
          adminPath={ADMIN_PATH}
          role={session?.role ?? null}
          displayName={session?.displayName ?? null}
        >
          {children}
        </AdminShell>
      </AdminThemeProvider>
    </>
  );
}