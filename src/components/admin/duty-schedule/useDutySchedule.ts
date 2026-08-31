// =========================================================
// FILE: src/components/admin/duty-schedule/useDutySchedule.ts
// Хук табеля дежурств охраны: состояние, генерация, редактирование,
// расчёт зарплаты и план выплат (день + сумма по каждому охраннику).
// Данные сохраняются в localStorage (для наглядной работы без
// бэкенда) — интерфейс не зависит от хранилища, поэтому хук можно
// заменить на версию с реальными API-запросами.
//
// Месяц навигации = месяц табеля (дни дежурств). Зарплатный месяц
// выбирается отдельно в блоке «Зарплата» (может не совпадать с
// месяцем табеля) — перенос идёт по нему.
// =========================================================

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Employee,
  DayAssignment,
  PayrollPayload,
  CellStatus,
  PayPlans,
} from "./types";
import {
  generateSchedule,
  fillMissingDays,
  getNextRotationStartId,
} from "./scheduleGenerator";

const STORAGE_KEY = "duty_schedule_v2";
/** Старый ключ: данные хранились «под календарным месяцем»
 *  (месяц зарплатного периода минус сдвиг). При первом запуске
 *  нового кода ключи расписаний сдвигаются вперёд на сдвиг,
 *  чтобы табель остался под тем месяцем, за который его делали. */
const LEGACY_STORAGE_KEY = "duty_schedule_v1";
const LEGACY_OFFSET_KEY = "duty_schedule_offset_v1";

interface StoredState {
  employees: Employee[];
  schedules: Record<string, DayAssignment[]>;
  /** Ручные суммы за месяц: [YYYY-MM] -> [employeeId] -> сумма.
   *  Перекрывают расчёт «часы × ставка» (для переноса и печати). */
  amountOverrides: Record<string, Record<string, number>>;
  /** Планы выплат: [зарплатный месяц YYYY-MM] -> [employeeId] -> план. */
  payPlans: PayPlans;
}

// Данные по умолчанию — воспроизводят пример из табеля заказчика:
// Олейников закреплён за вторником (15ч) и субботой (24ч, смена пт→сб),
// остальные дни чередуются между Ждановым и Хухоревым.
const defaultEmployees: Employee[] = [
  {
    id: "zhdanov",
    name: "Жданов Сергей",
    phone: "953 781 80 82",
    rate: 115,
    role: "rotating",
    active: true,
  },
  {
    id: "oleynikov",
    name: "Олейников Дмитрий",
    phone: "953 807 65 59",
    rate: 115,
    role: "fixed",
    active: true,
    fixedRules: [
      { weekday: 2, hours: 15 }, // Вторник 15ч
      { weekday: 6, hours: 24 }, // Суббота 24ч
    ],
  },
  {
    id: "huhorev",
    name: "Хухорев Василий",
    phone: "913 471 49 62",
    rate: 115,
    role: "rotating",
    active: true,
  },
];

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Сдвиг месяца на delta (может быть отрицательным). */
function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function readStored(key: string): Partial<StoredState> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<StoredState>;
  } catch {
    return null;
  }
}

function loadState(): StoredState {
  const fallback: StoredState = {
    employees: defaultEmployees,
    schedules: {},
    amountOverrides: {},
    payPlans: {},
  };

  // Уже новые данные — читаем как есть.
  const v2 = readStored(STORAGE_KEY);
  if (v2) {
    return {
      employees: v2.employees ?? defaultEmployees,
      schedules: v2.schedules ?? {},
      amountOverrides: v2.amountOverrides ?? {},
      payPlans: v2.payPlans ?? {},
    };
  }

  // Миграция со старого хранилища: раньше навигация вела по месяцу
  // зарплатного периода, а расписание хранилось под (период − сдвиг).
  // Ключи расписаний сдвигаем вперёд на сдвиг и сохраняем в v2.
  const legacy = readStored(LEGACY_STORAGE_KEY);
  if (!legacy) return fallback;

  let offset = 0;
  try {
    const rawOffset = localStorage.getItem(LEGACY_OFFSET_KEY);
    offset = rawOffset != null ? Number(rawOffset) : 1; // по умолчанию было 1
    if (!Number.isFinite(offset)) offset = 0;
  } catch {
    offset = 0;
  }

  const schedules = legacy.schedules ?? {};
  let migrated = schedules;
  if (offset > 0 && Object.keys(schedules).length > 0) {
    const shifted: Record<string, DayAssignment[]> = {};
    for (const [k, days] of Object.entries(schedules)) {
      const [y, m] = k.split("-").map(Number);
      if (!y || !m) {
        shifted[k] = days;
        continue;
      }
      const moved = shiftMonth(y, m, offset);
      shifted[monthKey(moved.year, moved.month)] = days;
    }
    migrated = shifted;
  }

  const state: StoredState = {
    employees: legacy.employees ?? defaultEmployees,
    schedules: migrated,
    amountOverrides: legacy.amountOverrides ?? {},
    payPlans: legacy.payPlans ?? {},
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_OFFSET_KEY);
  } catch {
    /* localStorage недоступен */
  }
  return state;
}

export function useDutySchedule(initialYear?: number, initialMonth?: number) {
  // Навигация ведётся по месяцу табеля (месяц дежурств).
  const now = new Date();
  const [year, setYear] = useState(initialYear ?? now.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? now.getMonth() + 1);
  const [state, setState] = useState<StoredState>(loadState);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* localStorage недоступен */
    }
  }, [state]);

  const key = monthKey(year, month);
  const schedule = useMemo(
    () => fillMissingDays(state.schedules[key] ?? [], year, month),
    [state.schedules, key, year, month]
  );

  const persistSchedule = useCallback(
    (newSchedule: DayAssignment[]) => {
      setState((prev) => ({
        ...prev,
        schedules: { ...prev.schedules, [key]: newSchedule },
      }));
    },
    [key]
  );

  const generate = useCallback(
    (startEmployeeId?: string) => {
      const rotating = state.employees.filter(
        (e) => e.role === "rotating" && e.active
      );
      let startId = startEmployeeId;
      if (!startId) {
        // Непрерывность очереди — от предыдущего месяца.
        const prev = shiftMonth(year, month, -1);
        const prevKey = monthKey(prev.year, prev.month);
        const prevSchedule = state.schedules[prevKey];
        if (prevSchedule) {
          startId = getNextRotationStartId(prevSchedule, rotating);
        }
      }
      const generated = generateSchedule(year, month, state.employees, {
        rotatingStartEmployeeId: startId,
      });
      persistSchedule(generated);
      setMessage("Расписание сгенерировано автоматически");
    },
    [year, month, state.employees, state.schedules, persistSchedule]
  );

  const updateCell = useCallback(
    (date: string, patch: Partial<DayAssignment>) => {
      const exists = schedule.some((d) => d.date === date);
      const newSchedule = exists
        ? schedule.map((d) => (d.date === date ? { ...d, ...patch } : d))
        : [
            ...schedule,
            {
              date,
              weekday: new Date(date).getDay(),
              employeeId: null,
              hours: 0,
              status: "normal" as CellStatus,
              ...patch,
            },
          ];
      persistSchedule(newSchedule);
    },
    [schedule, persistSchedule]
  );

  const clearCell = useCallback(
    (date: string) => {
      updateCell(date, { employeeId: null, hours: 0, status: "normal" });
    },
    [updateCell]
  );

  const addEmployee = useCallback((emp: Omit<Employee, "id">) => {
    const id = "emp_" + Date.now().toString(36);
    setState((prev) => ({
      ...prev,
      employees: [...prev.employees, { ...emp, id }],
    }));
  }, []);

  const updateEmployee = useCallback((id: string, patch: Partial<Employee>) => {
    setState((prev) => ({
      ...prev,
      employees: prev.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }, []);

  const removeEmployee = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      employees: prev.employees.filter((e) => e.id !== id),
    }));
  }, []);

  // ── Ручные суммы за месяц табеля (перекрывают «часы × ставка») ──
  const amountOverrides = useMemo(
    () => state.amountOverrides[key] ?? {},
    [state.amountOverrides, key]
  );

  const setAmountOverride = useCallback(
    (employeeId: string, value: number | null) => {
      setState((prev) => {
        const forPeriod = { ...(prev.amountOverrides[key] ?? {}) };
        if (value == null || Number.isNaN(value) || value <= 0) {
          delete forPeriod[employeeId];
        } else {
          forPeriod[employeeId] = Math.round(value);
        }
        return {
          ...prev,
          amountOverrides: { ...prev.amountOverrides, [key]: forPeriod },
        };
      });
    },
    [key]
  );

  // ── Планы выплат: день и сумма по каждому охраннику ──
  // Ключ — ЗАРПЛАТНЫЙ месяц (выбирается в блоке «Зарплата»), он может
  // отличаться от месяца табеля.
  const setPayPlan = useCallback(
    (
      payPeriodKey: string,
      employeeId: string,
      patch: Partial<{ date: string | null; amount: number | null }>
    ) => {
      setState((prev) => {
        const forPeriod = { ...(prev.payPlans[payPeriodKey] ?? {}) };
        const entry = { ...(forPeriod[employeeId] ?? {}) };
        if ("date" in patch) {
          if (patch.date) entry.date = patch.date;
          else delete entry.date;
        }
        if ("amount" in patch) {
          if (
            patch.amount != null &&
            !Number.isNaN(patch.amount) &&
            patch.amount >= 0
          ) {
            entry.amount = Math.round(patch.amount);
          } else {
            delete entry.amount;
          }
        }
        if (entry.date == null && entry.amount == null) {
          delete forPeriod[employeeId];
        } else {
          forPeriod[employeeId] = entry;
        }
        return {
          ...prev,
          payPlans: { ...prev.payPlans, [payPeriodKey]: forPeriod },
        };
      });
    },
    []
  );

  /** Планы выплат для конкретного зарплатного месяца. */
  const payPlansFor = useCallback(
    (payPeriodKey: string) => state.payPlans[payPeriodKey] ?? {},
    [state.payPlans]
  );

  // Расчёт по табелю: часы × ставка (или ручная сумма за месяц табеля).
  // Это «сумма по умолчанию» для блока «Зарплата» — её можно
  // переопределить вручную по каждому охраннику.
  const payroll: PayrollPayload = useMemo(() => {
    const items = state.employees
      .filter((e) => e.active)
      .map((emp) => {
        const totalHours = schedule
          .filter((d) => d.employeeId === emp.id && d.status !== "missed")
          .reduce((s, d) => s + (d.hours || 0), 0);
        const overridden = amountOverrides[emp.id];
        const amount =
          overridden != null ? overridden : Math.round(totalHours * emp.rate);
        return {
          employeeId: emp.id,
          employeeName: emp.name,
          totalHours,
          amount,
        };
      });
    const totalAmount = items.reduce((s, i) => s + i.amount, 0);
    return {
      year,
      month,
      items,
      totalAmount,
      generatedAt: new Date().toISOString(),
    };
  }, [schedule, state.employees, amountOverrides, year, month]);

  const goToPrevMonth = () => {
    const prev = shiftMonth(year, month, -1);
    setYear(prev.year);
    setMonth(prev.month);
  };
  const goToNextMonth = () => {
    const next = shiftMonth(year, month, 1);
    setYear(next.year);
    setMonth(next.month);
  };

  return {
    year,
    month,
    setYear,
    setMonth,
    goToPrevMonth,
    goToNextMonth,
    employees: state.employees,
    addEmployee,
    updateEmployee,
    removeEmployee,
    schedule,
    generate,
    updateCell,
    clearCell,
    amountOverrides,
    setAmountOverride,
    setPayPlan,
    payPlansFor,
    payroll,
    message,
    setMessage,
  };
}
