// src/app/[adminPath]/die-calc/jobs/page.tsx — таблица сохранённых штанцформ
//
// Зачем: расчёт калькулятора живёт в браузере, а работа технолога — в журнале.
// Здесь видно все сохранённые расчёты, правится что угодно (размеры, замок,
// тираж, статус, цена) и подтверждается факт — габарит с готовой матрицы и
// реальная цена. Из этих же строк растёт модель обучения: кнопка «Обучить по
// базе» пересчитывает поправку по габариту и множителю цены тем же ядром,
// которым считает калькулятор (src/lib/die-calc/learn.ts).
//
// Чтение — сервером (getAdminDb); если миграция supabase/migration_die_calc.sql
// ещё не применена, показываем подсказку вместо ошибки.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Scissors, Sparkles } from "lucide-react";
import { verifySession } from "@/lib/auth";
import { canAccessAdminPage } from "@/lib/admin-rbac";
import { describeModel } from "@/lib/die-calc";
import {
  dieCalcTablesExist,
  getActiveDieCalcModel,
  getDieCalcStats,
  listDieCalcJobs,
} from "@/lib/die-calc-db";
import { DieCalcJobsClient } from "@/components/admin/DieCalcJobsClient";

const ADMIN_PATH = process.env.NEXT_PUBLIC_ADMIN_PATH || process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Расчёты штанцформ — СибГофроТорг",
};

export default async function DieCalcJobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{ status?: string; q?: string; construction?: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const session = await verifySession();
  if (!session) notFound();
  if (!canAccessAdminPage(session.role, `/${adminPath}/die-calc/jobs`, adminPath)) notFound();

  const sp = await searchParams;

  const exists = await dieCalcTablesExist();
  if (!exists) {
    return (
      <div className="admin-stack">
        <div className="admin-card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <Scissors size={18} style={{ color: "var(--adm-ink-muted)" }} />
            <h1 style={{ margin: 0, fontSize: 18 }}>Расчёты штанцформ</h1>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--adm-ink-soft)", maxWidth: 720 }}>
            Таблиц <code>die_calc_jobs</code>, <code>die_calc_models</code> и <code>die_calc_settings</code> в базе ещё нет, поэтому
            сохранять расчёты некуда. Сам калькулятор работает — применяются только его локальные ставки и коэффициенты.
          </p>
          <p style={{ fontSize: 13, marginTop: 10 }}>
            Выполните в Supabase → SQL Editor один файл: <code>supabase/migration_die_calc.sql</code> (идемпотентен, можно
            повторно). После этого здесь появится журнал, а в калькуляторе — вкладка «База и обучение».
          </p>
          <Link href={`/${adminPath}/die-calc`} className="admin-btn admin-btn--primary" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <Sparkles size={14} /> Открыть калькулятор
          </Link>
        </div>
      </div>
    );
  }

  const [{ jobs, total }, model, stats] = await Promise.all([
    listDieCalcJobs({ limit: 200, status: sp.status, q: sp.q, construction: sp.construction }).catch(() => ({ jobs: [], total: 0 })),
    getActiveDieCalcModel(),
    getDieCalcStats(),
  ]);

  // снимки расчёта (settings/result) в таблицу не нужны — не гоним их в браузер
  const rows = jobs.map((j) => {
    const { settings: _settings, result: _result, ...rest } = j;
    void _settings;
    void _result;
    return rest;
  });

  return (
    <DieCalcJobsClient
      adminPath={adminPath}
      jobs={rows}
      total={total}
      model={model}
      modelNotes={describeModel(model)}
      stats={stats}
      canWrite={session.role === "owner" || session.role === "admin" || session.role === "manager"}
    />
  );
}
