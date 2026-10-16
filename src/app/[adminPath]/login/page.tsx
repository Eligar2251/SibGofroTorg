// =========================================================
// FILE: src/app/[adminPath]/login/page.tsx
// =========================================================

import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { getAdminLandingPath } from "@/lib/admin-rbac";
import { ADMIN_PATH } from "@/lib/admin-path";
import { LoginForm } from "@/components/admin/LoginForm";

export default async function AdminLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{ expired?: string }>;
}) {
  const { adminPath } = await params;
  const { expired } = await searchParams;

  if (adminPath !== ADMIN_PATH) {
    redirect("/");
  }

  // verifySession никогда не бросает: при отсутствии/смене секрета сессии
  // просто «нет», и форма входа остаётся доступной (раньше здесь падал
  // рендер всей страницы).
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
          <LoginForm adminPath={ADMIN_PATH} expired={expired === "1"} />
        </div>
      </div>
    </div>
  );
}
