// =========================================================
// FILE: src/app/[adminPath]/diagnostics/page.tsx
// Страница «Диагностика»: открывается, когда админка не грузится,
// и показывает причину (база, ключи, переменные, сессия).
//
// Страница НАМЕРЕННО не читает данные из БД при рендере — иначе она падала
// бы вместе с остальной панелью. Всё, что она показывает, приходит из
// /api/admin/diagnostics, который сам обрабатывает ошибки.
// =========================================================

import { notFound, redirect } from "next/navigation";
import { ADMIN_PATH } from "@/lib/admin-path";
import { verifySession } from "@/lib/auth";
import { getAdminLandingPath, isFullAccessRole } from "@/lib/admin-rbac";
import { AdminDiagnostics } from "@/components/admin/AdminDiagnostics";

export const dynamic = "force-dynamic";

export default async function AdminDiagnosticsPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const session = await verifySession();
  if (!session) redirect(`/${ADMIN_PATH}/login?expired=1`);
  if (!isFullAccessRole(session.role)) {
    redirect(getAdminLandingPath(session.role, ADMIN_PATH));
  }

  return <AdminDiagnostics adminPath={ADMIN_PATH} />;
}
