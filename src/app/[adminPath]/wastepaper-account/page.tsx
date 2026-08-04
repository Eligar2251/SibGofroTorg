// =========================================================
// FILE: src/app/[adminPath]/wastepaper-account/page.tsx
// Отдельный учёт макулатуры: дни, платежи (нал/безнал), приём,
// сдачи на предприятие, перевозки, контрагенты.
// Модуль ОТДЕЛЬНЫЙ — не связан с сайтом и товарным учётом.
// Доступ: admin и роль «wastepaper» (макулатурщик).
// =========================================================

import { notFound, redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { getWpDashboardData, type WpDashboardData } from "@/lib/wastepaper-account";
import { getWastepaperRates } from "@/lib/supabase-queries";
import { WastepaperAccountManager } from "@/components/admin/WastepaperAccountManager";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function WastepaperAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const session = await verifySession();
  if (!session) redirect(`/${ADMIN_PATH}/login`);
  // Двойная защита поверх proxy: модуль доступен только admin и
  // макулатурщику, остальные роли уходят на свою стартовую страницу.
  if (session.role !== "admin" && session.role !== "wastepaper") {
    redirect(`/${ADMIN_PATH}`);
  }

  const sp = await searchParams;
  const initialTab = sp.tab || "days";

  // Данные модуля маленькие (десятки-сотни записей), грузим всё сразу —
  // макулатурщику это его единственное рабочее место. При сбое
  // (например, миграция ещё не применена) показываем пустой модуль,
  // а не 500: текст ошибки пишем в консоль сервера.
  let data: WpDashboardData;
  try {
    data = await getWpDashboardData();
  } catch (error) {
    console.error(
      "wastepaper-account: не удалось загрузить данные (применена ли миграция migration_wastepaper_account.sql?):",
      error
    );
    data = {
      counterparties: [],
      intakes: [],
      shipments: [],
      manualPayments: [],
      transports: [],
    };
  }
  const rates = await getWastepaperRates().catch(() => null);

  return (
    <WastepaperAccountManager
      adminPath={ADMIN_PATH}
      initialTab={initialTab}
      counterparties={data.counterparties}
      intakes={data.intakes}
      shipments={data.shipments}
      manualPayments={data.manualPayments}
      transports={data.transports}
      rates={rates}
    />
  );
}
