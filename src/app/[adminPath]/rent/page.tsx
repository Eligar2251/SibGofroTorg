// =========================================================
// FILE: src/app/[adminPath]/rent/page.tsx
// Управленческий учёт аренды: арендаторы с договорами,
// начисления, банк аренды (отдельный от складского).
//
// Доступ:
//   admin   — полный доступ (редактирование);
//   manager — просмотр без редактирования;
//   lawyer  — только дашборд (финансы, просрочки, отчётность).
// =========================================================

import { notFound, redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";
import {
  getRentOrgs,
  getRentTenants,
  getRentInvoices,
  getRentPayments,
} from "@/lib/rent";
import type {
  RentInvoice,
  RentOrg,
  RentPayment,
  RentTenant,
} from "@/lib/rent-shared";
import { RentManager, type RentMode } from "@/components/admin/rent/RentManager";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function RentPage({
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
  if (session.role === "wastepaper") redirect(`/${ADMIN_PATH}/wastepaper-account`);

  const mode: RentMode =
    session.role === "admin"
      ? "full"
      : session.role === "manager"
        ? "readonly"
        : "dashboard";

  const sp = await searchParams;

  // При сбое (например, миграция ещё не применена) показываем пустой
  // модуль вместо 500 — как в учёте макулатуры.
  let orgs: RentOrg[] = [];
  let tenants: RentTenant[] = [];
  let invoices: RentInvoice[] = [];
  let payments: RentPayment[] = [];
  try {
    [orgs, tenants, invoices, payments] = await Promise.all([
      getRentOrgs(),
      getRentTenants(),
      getRentInvoices(),
      getRentPayments(),
    ]);
  } catch (error) {
    console.error(
      "rent: не удалось загрузить данные (применена ли миграция migration_rent_accounting.sql?):",
      error
    );
  }

  return (
    <RentManager
      adminPath={ADMIN_PATH}
      mode={mode}
      initialTab={sp.tab || ""}
      orgs={orgs}
      tenants={tenants}
      invoices={invoices}
      payments={payments}
    />
  );
}
