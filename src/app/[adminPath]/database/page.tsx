// =========================================================
// FILE: src/app/[adminPath]/database/page.tsx
// Раздел «База Данных»: все таблицы, просмотр и правка ячеек.
// Доступ — владелец и администратор (canAccessDatabase).
// =========================================================

import { notFound, redirect } from "next/navigation";
import { hasPermission, verifySession } from "@/lib/auth";
import { canAccessDatabase } from "@/lib/admin-rbac";
import { DatabaseBrowser } from "@/components/admin/DatabaseBrowser";

const ADMIN_PATH =
  process.env.NEXT_PUBLIC_ADMIN_PATH || process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function AdminDatabasePage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const session = await verifySession();
  if (!session) redirect(`/${ADMIN_PATH}/login`);
  if (!canAccessDatabase(session.role) || !hasPermission(session, "view_database")) {
    redirect(`/${ADMIN_PATH}`);
  }

  return (
    <div>
      <h1 className="admin-h1">База данных</h1>
      <p className="admin-muted" style={{ marginTop: -6, marginBottom: 16 }}>
        Все таблицы с данными собраны в одном месте. Без SQL и без выдачи прав:
        просмотр уже созданных записей, правка значений прямо в таблице и удаление
        строки кнопкой <span style={{ display: "inline-flex", verticalAlign: "-2px" }}>🗑</span> с подтверждением (удаляется и из Supabase параллельно).
        Строки не создаются — только правка и удаление существующих.
        {session.role === "owner" && (
          <> Правки денежных правок владельца видит только роль «Владелец».</>
        )}
      </p>
      <DatabaseBrowser />
    </div>
  );
}
