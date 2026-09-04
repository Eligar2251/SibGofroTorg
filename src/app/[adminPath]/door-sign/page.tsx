// src/app/[adminPath]/door-sign/page.tsx — табличка на дверь (A4 landscape)
// Крупный номер телефона + «если никого нет — позвоните, выдадим товар».
// Настройки хранятся в site_settings под ключами door_sign_* и редактируются
// прямо на этой странице администратором.

import Link from "next/link";
import { ArrowLeft, DoorOpen } from "lucide-react";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/supabase-queries";
import { verifySession } from "@/lib/auth";
import { doorSignFromSettings } from "@/lib/door-sign";
import { DoorSignPrint } from "@/components/admin/DoorSignPrint";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Табличка на дверь — СибГофроТорг",
};

export default async function AdminDoorSignPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const session = await verifySession();
  if (!session) notFound();

  const settings = await getSettings();
  const config = doorSignFromSettings(settings);
  const canSave = session.role === "admin";

  return (
    <div className="door-sign-page">
      <div className="door-sign-page__head no-print">
        <Link
          href={`/${ADMIN_PATH}`}
          className="door-sign-page__back"
          prefetch={false}
        >
          <ArrowLeft size={16} /> В админку
        </Link>
        <h1 className="door-sign-page__title">
          <DoorOpen size={20} /> Табличка на дверь
        </h1>
        <Link
          href={`/${ADMIN_PATH}/print-sheet`}
          className="door-sign-page__back"
          prefetch={false}
        >
          Другой формат A4: таблица →
        </Link>
      </div>

      <DoorSignPrint initial={config} adminPath={adminPath} canSave={canSave} />
    </div>
  );
}
