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
import { isFullAccessRole } from "@/lib/admin-rbac";
import { getWpDashboardData, type WpDashboardData } from "@/lib/wastepaper-account";
import { pcLocalRoute, pcLocalStatus } from "@/lib/pc-local-runtime";
import {
  buildWpTypeLabels,
  buildWpTransportQueue,
  wpTakenKeysFromTransports,
} from "@/lib/wastepaper-account-shared";
import { getWastepaperRates, getSettings } from "@/lib/supabase-queries";
import { getEmployees, getTransports, getWarehouseStock } from "@/lib/warehouse";
import { SITE_ADDRESS, SITE_PHONE } from "@/lib/site-config";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import { WastepaperAccountManager } from "@/components/admin/WastepaperAccountManager";
import { ADMIN_PATH } from "@/lib/admin-path";


export const dynamic = "force-dynamic";

export default async function WastepaperAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{ tab?: string; action?: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const session = await verifySession();
  if (!session) redirect(`/${ADMIN_PATH}/login`);
  // Двойная защита поверх proxy: модуль доступен только admin и
  // макулатурщику, остальные роли уходят на свою стартовую страницу.
  if (!isFullAccessRole(session.role) && session.role !== "wastepaper") {
    redirect(`/${ADMIN_PATH}`);
  }

  const sp = await searchParams;
  const actionTab: Record<string, string> = {
    "quick-intake": "intakes",
    "quick-shipment": "shipments",
    "quick-payment": "payments",
    "quick-salary": "salaries",
  };
  const initialTab = sp.tab || actionTab[sp.action || ""] || "days";

  // Данные модуля маленькие (десятки-сотни записей), грузим всё сразу —
  // макулатурщику это его единственное рабочее место. При сбое
  // (например, миграция ещё не применена) показываем пустой модуль,
  // а не 500: текст ошибки пишем в консоль сервера.
  let data: WpDashboardData;
  let loadError: string | null = null;
  try {
    data = await getWpDashboardData();
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
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
      stockAdjustments: [],
      accountTransfers: [],
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
  const wpTypeLabels = buildWpTypeLabels(data.products);
  const pendingWpDocs = buildWpTransportQueue({
    intakes: data.intakes,
    shipments: data.shipments,
    takenKeys: wpTakenKeysFromTransports(unifiedTransports),
    typeLabels: wpTypeLabels,
  });

  // Локальный режим включён: объясняем макулатурщику, откуда данные и что
  // сейчас недоступно, вместо молчаливого пустого списка.
  const route = pcLocalRoute();
  const local = pcLocalStatus();
  return (
    <>
      {route.kind === "readonly" && (
        <div role="status" style={{ padding: "10px 12px", border: "1px solid #f0c36d", background: "#fff8e6", borderRadius: 10, marginBottom: 12, fontSize: 13 }}>
          <strong>Работа от локальной копии на этом ПК.</strong> Приёмы, сдачи, перевозки, платежи и справочники
          читаются из файла {local.configured ? `${local.root} \ pc-${local.computerId} \ sgt-working-db.json` : "локальной копии"} —
          раздел работает, даже когда база и интернет недоступны. Добавление и правка документов на время такого
          просмотра выключены, чтобы ничего не потерялось: проведите их после возврата к Supabase.
          Резервные копии этих же данных (JSON и полный SQL-дамп) — в разделе «База данных».
        </div>
      )}
      {route.kind === "error" && (
        <div role="alert" className="admin-error" style={{ marginBottom: 12 }}>
          Локальная копия настроена неверно и потому отключена: {route.message}. Данные не изменены.
        </div>
      )}
      {loadError && (
        <div role="alert" style={{ padding: "10px 12px", border: "1px solid #d29", background: "#fff0f3", borderRadius: 10, marginBottom: 12, fontSize: 13 }}>
          Данные макулатуры не загрузились, поэтому показан пустой раздел: {loadError}
        </div>
      )}
    <WastepaperAccountManager
      adminPath={ADMIN_PATH}
      initialTab={initialTab}
      initialAction={sp.action || null}
      counterparties={data.counterparties}
      intakes={data.intakes}
      shipments={data.shipments}
      manualPayments={data.manualPayments}
      salaries={data.salaries}
      employees={employees}
      products={data.products}
      rates={rates}
      unifiedTransports={unifiedTransports}
      pendingWpDocs={pendingWpDocs}
      drivers={drivers}
      companyPhone={settings.phone || SITE_PHONE}
      companyAddress={settings.address || SITE_ADDRESS}
      stockProducts={stockProducts}
      stockAdjustments={data.stockAdjustments}
      accountTransfers={data.accountTransfers}
    />
    </>
  );
}
