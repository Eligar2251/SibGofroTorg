// src/app/[adminPath]/die-calc/page.tsx — калькулятор штанцформы (развертка, 3D, лист, цена)
//
// Зачем в админке: это внутренний инструмент технолога/менеджера — по внутренним
// размерам коробки он строит развертку ВЫРЕЗАНОЙ заготовки, сборку в 3D, раскладку
// по листу, длины ножей и стоимость штампа с тиражом. Публичной страницы нет.
//
// Расчёт живёт в src/lib/die-calc (чистый TypeScript, без БД и без Supabase) и
// в src/components/admin/die-calc (React). Источники — tools/die-calc, синхронизация
// `node tools/die-calc/scripts/sync-site.mjs` (там же тесты и сверка с эталонными
// чертежами: npm test && npm run check).
//
// База (миграция supabase/migration_die_calc.sql):
//   · die_calc_jobs    — сохранённые расчёты, их правка и факты для обучения;
//   · die_calc_models  — выученная модель (припуски по габариту + множители цены);
//   · die_calc_settings — общий прайс, чтобы ставки были одинаковы у всех.
// Страница читает всё это на сервере и отдаёт в DieCalcWorkbench. Если миграция
// не применена, чтение молча возвращает пустоту: калькулятор остаётся рабочим
// на локальных ставках, а вкладка «База и обучение» подсказывает, что выполнить.
//
// ?job=<uuid> — открыть сохранённый расчёт: ввод, коэффициенты и ставки
// восстанавливаются из строки, дальше можно выбрать другой замок и пересчитать.

import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { canAccessAdminPage } from "@/lib/admin-rbac";
import { DieCalcWorkbench } from "@/components/admin/DieCalcWorkbench";
import type { DieCalcJobRow } from "@/components/admin/die-calc/jobs";
import type { SettingsState } from "@/components/admin/die-calc/store";
import {
  getActiveDieCalcModel,
  getDieCalcJob,
  getDieCalcSettings,
  listDieCalcJobs,
} from "@/lib/die-calc-db";

const ADMIN_PATH = process.env.NEXT_PUBLIC_ADMIN_PATH || process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Штанцформа — калькулятор — СибГофроТорг",
};

/** всё, что читается из новых таблиц, — с запасом: нет таблиц, работает localStorage */
async function soft<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export default async function AdminDieCalcPage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const session = await verifySession();
  if (!session) notFound();
  if (!canAccessAdminPage(session.role, `/${adminPath}/die-calc`, adminPath)) notFound();

  const { job: jobParam } = await searchParams;
  const wanted = String(jobParam ?? "").trim();

  const [model, shared, job, list] = await Promise.all([
    getActiveDieCalcModel(),
    getDieCalcSettings(),
    wanted ? soft(getDieCalcJob(wanted), null) : Promise.resolve(null),
    listDieCalcJobs({ limit: 12 }).catch(() => ({ jobs: [] as DieCalcJobRow[], total: 0 })),
  ]);

  return (
    <DieCalcWorkbench
      title="Калькулятор штанцформы"
      subtitle="Готовые конструкции или своя развертка по сетке и фото · лист, ножи, размеры, стоимость · сохранение в базу и экспорт DXF/SVG"
      adminPath={adminPath}
      job={job}
      model={model}
      sharedSettings={(shared as Partial<SettingsState> | null) ?? undefined}
      recent={list.jobs as DieCalcJobRow[]}
      canWrite={session.role === "owner" || session.role === "admin" || session.role === "manager"}
    />
  );
}
