// =========================================================
// FILE: src/app/[adminPath]/login/page.tsx
// =========================================================

import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { getAdminLandingPath } from "@/lib/admin-rbac";
import { ADMIN_PATH } from "@/lib/admin-path";
import { getDbRuntimeConfig, getDbFailoverState } from "@/lib/db-runtime-config";

const loginErrors: Record<string, string> = {
  missing: "Введите логин и пароль.",
  credentials: "Неверный логин или пароль в выбранной базе.",
  inactive: "Аккаунт деактивирован.",
  role: "У аккаунта указана неизвестная роль.",
  database: "База данных недоступна. Проверьте подключение и выбранную базу.",
  session: "Не удалось создать сессию. Проверьте ADMIN_SESSION_SECRET.",
  rate_limit: "Слишком много попыток. Подождите и попробуйте снова.",
  origin: "Запрос пришёл с другого адреса. Откройте страницу входа напрямую.",
  server: "Ошибка сервера. Проверьте журнал сервера.",
};
import { LoginForm } from "@/components/admin/LoginForm";

export default async function AdminLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{ expired?: string; login_error?: string }>;
}) {
  const { adminPath } = await params;
  const { expired, login_error } = await searchParams;

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

  const cfg = getDbRuntimeConfig();
  const mode = getDbFailoverState().activeFallbackBackend || cfg.activeBackend;
  const source = mode === "local" ? "локальная JSON-БД" : mode === "secondary" ? "Supabase на VPS" : "основной Supabase";
  const initialError = login_error && Object.hasOwn(loginErrors, login_error) ? loginErrors[login_error] : "";

  return (
    <div className="admin-login">
      <div className="admin-login__inner">
        <div className="admin-login__brand">
          <div className="admin-login__logo">С</div>
          <h1 className="admin-login__title">СибГофроТорг</h1>
          <p className="admin-login__sub">Вход в админ-панель</p>
        </div>
        <div className="admin-login__card">
          <p style={{ fontSize: 13, marginBottom: 12 }}>Источник для входа: {source}</p>
          <LoginForm adminPath={ADMIN_PATH} expired={expired === "1"} initialError={initialError} />
        </div>
      </div>
    </div>
  );
}
