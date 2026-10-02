"use client";

// =========================================================
// FILE: src/components/admin/DieCalcWorkbench.tsx
// Обёртка калькулятора штанцформ в админке: сам расчёт (src/components/
// admin/die-calc — копия из tools/die-calc, руками не правим) плюс вкладка
// «База и обучение», которая сохраняет расчёты в die_calc_jobs и подмешивает
// выученную модель.
//
// Ядро и UI калькулятора про Supabase не знают: база подключается slot-ом,
// поэтому tools/die-calc по-прежнему запускается отдельно и без БД.
// =========================================================

import { useMemo, useState, type ReactNode } from "react";
import { DieCalc, type DieCalcTab } from "@/components/admin/die-calc/DieCalc";
import { jobToPatch, type DieCalcJobRow } from "@/components/admin/die-calc/jobs";
import type { AppState, SettingsState } from "@/components/admin/die-calc/store";
import type { DieCalcModel } from "@/lib/die-calc";
import { DieCalcDbPanel } from "@/components/admin/DieCalcDbPanel";

export interface DieCalcWorkbenchProps {
  /** сохранённый расчёт из ?job= — им заливаем состояние калькулятора */
  job?: DieCalcJobRow | null;
  /** активная выученная модель (die_calc_models) */
  model?: DieCalcModel | null;
  /** общий прайс из die_calc_settings: ставки и справочники на всех */
  sharedSettings?: Partial<SettingsState> | null;
  adminPath: string;
  /** писать в базу могут только роли с доступом к разделу */
  canWrite?: boolean;
  title?: string;
  subtitle?: string;
  jobsHref?: string;
  /** последние записи — список в панели без лишних запросов */
  recent?: DieCalcJobRow[];
}

export function DieCalcWorkbench({
  job,
  model,
  sharedSettings,
  adminPath,
  canWrite = true,
  title,
  subtitle,
  jobsHref,
  recent,
}: DieCalcWorkbenchProps): ReactNode {
  // Сохранённый расчёт превращаем в состояние калькулятора ДО первого рендера
  // DieCalc: он читает initial/initialSettings только при инициализации стора.
  const patch = useMemo(() => (job ? jobToPatch(job) : null), [job]);
  const initial: Partial<AppState> | undefined = patch?.initial;
  const initialSettings: Partial<SettingsState> | undefined = useMemo(() => {
    const a = sharedSettings ?? {};
    const b = patch?.initialSettings ?? {};
    return Object.keys(a).length || Object.keys(b).length ? { ...a, ...b } : undefined;
  }, [sharedSettings, patch?.initialSettings]);

  // модель обновляется без перезагрузки после «обучить по базе»
  const [currentModel, setCurrentModel] = useState<DieCalcModel | null>(model ?? null);
  const [jobId, setJobId] = useState<string | null>(job?.id ?? null);
  const tab: DieCalcTab = job ? (job.settings?.customDrawing ? "custom" : "db") : "unfold";

  return (
    <DieCalc
      title={title}
      subtitle={subtitle}
      tab={tab}
      initial={initial}
      initialSettings={initialSettings}
      model={currentModel}
      slots={[
        {
          id: "db",
          name: "База и обучение",
          render: ({ calc, customResult, isCustomCalculation, setCustomCalculation }) => (
            <DieCalcDbPanel
              calc={calc}
              customResult={customResult}
              isCustom={isCustomCalculation}
              onCalculationMode={setCustomCalculation}
              job={job ?? null}
              jobId={jobId}
              onJobId={setJobId}
              model={currentModel}
              onModel={setCurrentModel}
              canWrite={canWrite}
              jobsHref={jobsHref ?? `/${adminPath}/die-calc/jobs`}
              recent={recent}
            />
          ),
        },
      ]}
    />
  );
}
