// =========================================================
// FILE: src/app/[adminPath]/client-requests/page.tsx
// Ручные заявки клиентов: обращения по телефону/мессенджерам,
// не связанные с заказами сайта (мини-CRM).
// =========================================================

import { notFound } from "next/navigation";
import { getClientRequests } from "@/lib/supabase-queries";
import { ClientRequestsManager } from "@/components/admin/ClientRequestsManager";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function AdminClientRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const { q } = await searchParams;
  const initialQuery = firstParam(q);

  // Таблица появляется после применения migration_client_requests.sql —
  // до этого показываем пустой список вместо падения страницы.
  const items = await getClientRequests({ status: "all", limit: 500 }).catch(
    () => []
  );

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Заявки клиентов</h1>
          <p className="admin-sub">
            Ручные заявки: клиент позвонил или написал — фиксируем, что нужно,
            и ведём до результата. С заказами сайта не связаны.
          </p>
        </div>
      </div>

      <ClientRequestsManager initialItems={items} initialQuery={initialQuery} />
    </div>
  );
}
