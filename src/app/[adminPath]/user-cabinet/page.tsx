// =========================================================
// FILE: src/app/[adminPath]/user-cabinet/page.tsx
// «Кабинет клиента» — экран для проверки синхронизации.
// =========================================================

import { notFound } from "next/navigation";
import { UserCabinetViewer } from "@/components/admin/UserCabinetViewer";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export default async function AdminUserCabinetPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Кабинет клиента</h1>
          <p className="admin-sub">
            Заявки клиента в том виде, в каком он видит их у себя в «Моих
            заказах». Данные берутся тем же запросом, что и на сайте, поэтому
            здесь видно реальный результат синхронизации: отметили выдачу —
            карточка сразу становится «Выдан». Ниже каждой карточки —
            управление: статус, выдача, правка состава и удаление заявки у
            этого клиента.
          </p>
        </div>
      </div>

      <UserCabinetViewer />
    </div>
  );
}
