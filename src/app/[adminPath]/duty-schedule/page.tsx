// =========================================================
// FILE: src/app/[adminPath]/duty-schedule/page.tsx
// Табель дежурств охраны: генерация расписания, печать,
// перенос начисленной зарплаты в раздел «Зарплаты».
// =========================================================

import { notFound } from "next/navigation";
import { getSalaries } from "@/lib/warehouse";
import { getSettings } from "@/lib/supabase-queries";
import { SITE_ADDRESS, SITE_PHONE } from "@/lib/site-config";
import { DutyScheduleAdmin } from "@/components/admin/duty-schedule";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function AdminDutySchedulePage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [salaries, settings] = await Promise.all([
    getSalaries().catch(() => []),
    getSettings().catch(() => ({} as Record<string, string>)),
  ]);

  // Уже перенесённые из табеля начисления — для защиты от случайных дублей.
  const existingTransfers = salaries
    .filter((s) => /Табель охраны/i.test(s.comment || ""))
    .map((s) => ({
      periodMonth: s.periodMonth || String(s.date || "").slice(0, 7),
      employeeName: s.employeeName,
      amount: s.amount,
      comment: s.comment ?? null,
    }));

  return (
    <div>
      <DutyScheduleAdmin
        existingTransfers={existingTransfers}
        companyPhone={settings.phone || SITE_PHONE}
        companyAddress={settings.address || SITE_ADDRESS}
      />
    </div>
  );
}
