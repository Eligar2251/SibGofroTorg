// =========================================================
// FILE: src/app/[adminPath]/login/page.tsx
// =========================================================

import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { getAdminLandingPath } from "@/lib/admin-rbac";
import { LoginForm } from "@/components/admin/LoginForm";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export default async function AdminLoginPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;

  if (adminPath !== ADMIN_PATH) {
    redirect("/");
  }

  const user = await verifySession();
  if (user) {
    // Стартовая страница зависит от роли (макулатурщик — сразу в свой модуль).
    redirect(getAdminLandingPath(user.role, ADMIN_PATH));
  }

  return (
    <div className="admin-login">
      <div className="admin-login__inner">
        <div className="admin-login__brand">
          <div className="admin-login__logo">С</div>
          <h1 className="admin-login__title">СибГофроТорг</h1>
          <p className="admin-login__sub">Вход в админ-панель</p>
        </div>
        <div className="admin-login__card">
          <LoginForm adminPath={ADMIN_PATH} />
        </div>
      </div>
    </div>
  );
}