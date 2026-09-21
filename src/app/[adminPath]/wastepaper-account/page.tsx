// =========================================================
// FILE: src/app/[adminPath]/wastepaper-account/page.tsx
// Отдельный учёт макулатуры: дни, платежи (нал/безнал), приём,
// сдачи на предприятие, перевозки, контрагенты.
// Деньги модуля ОТДЕЛЬНЫЕ — не связаны с сайтом и товарным учётом.
// Перевозки ОБЩИЕ: вкладка «Перевозки» показывает те же рейсы учёта
// (ПЕР-...), что и раздел «Доставки», — приёмы и сдачи с пометкой
// «в перевозку» едут в общем путевом листе как забор/сдача груза.
// Доступ: admin и роль «wastepaper» (макулатурщик).
// =========================================================

import { notFound, redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { getWpDashboardData, type WpDashboardData } from "@/lib/wastepaper-account";
import {
  WP_TYPE_LABELS,
  buildWpTransportQueue,
  wpTakenKeysFromTransports,
} from "@/lib/wastepaper-account-shared";
import { getWastepaperRates, getSettings } from "@/lib/supabase-queries";
import { getEmployees, getTransports, getWarehouseStock } from "@/lib/warehouse";
import { SITE_ADDRESS, SITE_PHONE } from "@/lib/site-config";
import type { PickerProduct } from "@/components/admin/ProductPicker";
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
      products: [],
      salaries: [],
    };
  }
  const rates = await getWastepaperRates().catch(() => null);

  // Единые перевозки учёта для вкладки «Перевозки» — те же рейсы,
  // что в разделе «Доставки». Заказы учёта (ЗК) макулатурщику не
  // показываем: он собирает рейсы из своих заборов и сдач.
  const [unifiedTransports, employees, stock, settings] = await Promise.all([
    getTransports({ limit: 200 }).catch((e) => {
      console.error("wastepaper-account: перевозки учёта недоступны:", e);
      return [];
    }),
    getEmployees().catch(() => []),
    getWarehouseStock().catch(() => []),
    getSettings().catch(() => ({} as Record<string, string>)),
  ]);
  const drivers = employees.map((e) => ({
    id: e.id,
    name: e.name,
    phone: e.phone ?? null,
  }));
  const stockProducts: PickerProduct[] = stock.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    priceWholesale: p.priceWholesale,
    stockQty: p.stockQty,
  }));
  const wpTypeLabels: Record<string, string> = {
    ...WP_TYPE_LABELS,
    ...Object.fromEntries(data.products.map((p) => [p.id, p.name])),
  };
  const pendingWpDocs = buildWpTransportQueue({
    intakes: data.intakes,
    shipments: data.shipments,
    takenKeys: wpTakenKeysFromTransports(unifiedTransports),
    typeLabels: wpTypeLabels,
  });

  return (
    <WastepaperAccountManager
      adminPath={ADMIN_PATH}
      initialTab={initialTab}
      counterparties={data.counterparties}
      intakes={data.intakes}
      shipments={data.shipments}
      manualPayments={data.manualPayments}
      salaries={data.salaries}
      canEditSalaries={session.role === "admin"}
      products={data.products}
      rates={rates}
      unifiedTransports={unifiedTransports}
      pendingWpDocs={pendingWpDocs}
      drivers={drivers}
      companyPhone={settings.phone || SITE_PHONE}
      companyAddress={settings.address || SITE_ADDRESS}
      stockProducts={stockProducts}
    />
  );
}
