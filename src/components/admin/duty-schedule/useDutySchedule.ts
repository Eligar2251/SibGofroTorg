// =========================================================
// FILE: src/components/admin/duty-schedule/useDutySchedule.ts
// Хук табеля дежурств охраны: состояние, генерация, редактирование,
// расчёт зарплаты. Данные сохраняются в localStorage (для наглядной
// работы без бэкенда) — интерфейс не зависит от хранилища, поэтому
// хук можно заменить на версию с реальными API-запросами.
// =========================================================

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Employee,
  DayAssignment,
  PayrollPayload,
  CellStatus,
} from "./types";
import {
  generateSchedule,
  fillMissingDays,
  getNextRotationStartId,
} from "./scheduleGenerator";

const STORAGE_KEY = "duty_schedule_v1";

interface StoredState {
  employees: Employee[];
  schedules: Record<string, DayAssignment[]>;
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

function loadState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredState;
  } catch {
    /* ignore */
  }
  return { employees: defaultEmployees, schedules: {} };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function useDutySchedule(initialYear?: number, initialMonth?: number) {
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
        const prevKey =
          month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
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

  const payroll: PayrollPayload = useMemo(() => {
    const items = state.employees
      .filter((e) => e.active)
      .map((emp) => {
        const totalHours = schedule
          .filter((d) => d.employeeId === emp.id && d.status !== "missed")
          .reduce((s, d) => s + (d.hours || 0), 0);
        return {
          employeeId: emp.id,
          employeeName: emp.name,
          totalHours,
          amount: Math.round(totalHours * emp.rate),
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
  }, [schedule, state.employees, year, month]);

  const goToPrevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  };
  const goToNextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
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
    payroll,
    message,
    setMessage,
  };
}
