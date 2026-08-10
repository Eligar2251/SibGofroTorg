// =========================================================
// FILE: src/app/[adminPath]/layout.tsx
// =========================================================

import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { verifySession } from "@/lib/auth";
import Script from "next/script";
// Стили админки грузятся только здесь, а не на всём сайте (раньше
// admin.css импортировался в globals.css и попадал в бандл каждой страницы).
import "../admin.css";
import "../admin-users.css";
import "../rent.css";
import "../admin-themes.css";
import { AdminThemeProvider } from "@/components/admin/AdminTheme";

const ADMIN_THEME_INIT_SCRIPT = `try{
  var k="adm-theme",v=localStorage.getItem(k)||"standard";
  var ok=["standard","light","dark","superdark","forest","ocean"].indexOf(v)>=0?v:"standard";
  
  var kl="adm-layout",vl=localStorage.getItem(kl)||"sidebar-left";
  var okl=["sidebar-left","sidebar-right","sidebar-top"].indexOf(vl)>=0?vl:"sidebar-left";

  var ks="adm-style",vs=localStorage.getItem(ks)||"classic";
  var oks=["classic","neo","retro","cyberpunk"].indexOf(vs)>=0?vs:"classic";

  document.documentElement.setAttribute("data-admin-theme",ok);
  document.documentElement.setAttribute("data-admin-layout",okl);
  document.documentElement.setAttribute("data-admin-style",oks);
  
  var a=document.querySelector('[data-admin="true"]');
  if(a){
    a.setAttribute("data-admin-theme",ok);
    a.setAttribute("data-admin-layout",okl);
    a.setAttribute("data-admin-style",oks);
  }
}catch(e){}`;

// Этот путь читается и клиентской оболочкой (ConditionalChrome), поэтому
// единственный источник истины — публичная переменная. Legacy-переменная
// оставлена только как fallback для существующих окружений.
const ADMIN_PATH = process.env.NEXT_PUBLIC_ADMIN_PATH || process.env.ADMIN_SECRET_PATH || "admin";

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

  const session = await verifySession();

  return (
    <>
      <Script
        id="admin-theme-init"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: ADMIN_THEME_INIT_SCRIPT }}
      />
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