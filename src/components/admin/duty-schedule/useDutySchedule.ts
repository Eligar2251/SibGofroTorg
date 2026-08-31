// =========================================================
// FILE: src/components/admin/duty-schedule/useDutySchedule.ts
// Хук табеля дежурств охраны: состояние, генерация, редактирование,
// расчёт зарплаты. Данные сохраняются в localStorage (для наглядной
// работы без бэкенда) — интерфейс не зависит от хранилища, поэтому
// хук можно заменить на версию с реальными API-запросами.
//
// СДВИГ: пользователь работает с ПЕРИОДОМ ЗАРПЛАТЫ (например,
// «сентябрь»), а календарь показывает фактические смены за
// (период − сдвиг) (август). Зарплата считается по сменам
// календаря, но записывается под месяц периода. Сдвиг настраивается
// (0/1/2 месяца), по умолчанию 1.
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
const OFFSET_KEY = "duty_schedule_offset_v1";

interface StoredState {
  employees: Employee[];
  schedules: Record<string, DayAssignment[]>;
  /** Ручные суммы за месяц: [период YYYY-MM] -> [employeeId] -> сумма.
   *  Перекрывают расчёт «часы × ставка» (для переноса и печати). */
  amountOverrides: Record<string, Record<string, number>>;
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
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredState>;
      return {
        employees: parsed.employees ?? defaultEmployees,
        schedules: parsed.schedules ?? {},
        amountOverrides: parsed.amountOverrides ?? {},
      };
    }
  } catch {
    /* ignore */
  }
  return { employees: defaultEmployees, schedules: {}, amountOverrides: {} };
}

function loadOffset(): number {
  try {
    const raw = localStorage.getItem(OFFSET_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (n === 0 || n === 1 || n === 2) return n;
    }
  } catch {
    /* ignore */
  }
  return 1;
}

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

export function useDutySchedule(initialYear?: number, initialMonth?: number) {
  // Навигация ведётся по ПЕРИОДУ ЗАРПЛАТЫ (как думает пользователь:
  // «делаю график за сентябрь»).
  const now = new Date();
  const [payYear, setPayYear] = useState(initialYear ?? now.getFullYear());
  const [payMonth, setPayMonth] = useState(
    initialMonth ?? now.getMonth() + 1
  );
  const [payOffset, setPayOffsetState] = useState<number>(loadOffset);
  const [state, setState] = useState<StoredState>(loadState);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* localStorage недоступен */
    }
  }, [state]);

  const setPayOffset = useCallback((n: number) => {
    setPayOffsetState(n);
    try {
      localStorage.setItem(OFFSET_KEY, String(n));
    } catch {
      /* ignore */
    }
  }, []);

  // Календарный месяц — реальные даты смен (период минус сдвиг).
  const cal = shiftMonth(payYear, payMonth, -payOffset);
  const calYear = cal.year;
  const calMonth = cal.month;

  const key = monthKey(calYear, calMonth);
  const schedule = useMemo(
    () => fillMissingDays(state.schedules[key] ?? [], calYear, calMonth),
    [state.schedules, key, calYear, calMonth]
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
        // Непрерывность очереди — от предыдущего КАЛЕНДАРНОГО месяца.
        const prev = shiftMonth(calYear, calMonth, -1);
        const prevKey = monthKey(prev.year, prev.month);
        const prevSchedule = state.schedules[prevKey];
        if (prevSchedule) {
          startId = getNextRotationStartId(prevSchedule, rotating);
        }
      }
      const generated = generateSchedule(calYear, calMonth, state.employees, {
        rotatingStartEmployeeId: startId,
      });
      persistSchedule(generated);
      setMessage("Расписание сгенерировано автоматически");
    },
    [calYear, calMonth, state.employees, state.schedules, persistSchedule]
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

  // ── Ручные суммы (перекрывают «часы × ставка») ──
  const payKey = monthKey(payYear, payMonth);
  const amountOverrides = useMemo(
    () => state.amountOverrides[payKey] ?? {},
    [state.amountOverrides, payKey]
  );

  const setAmountOverride = useCallback(
    (employeeId: string, value: number | null) => {
      setState((prev) => {
        const forPeriod = { ...(prev.amountOverrides[payKey] ?? {}) };
        if (value == null || Number.isNaN(value) || value <= 0) {
          delete forPeriod[employeeId];
        } else {
          forPeriod[employeeId] = Math.round(value);
        }
        return {
          ...prev,
          amountOverrides: { ...prev.amountOverrides, [payKey]: forPeriod },
        };
      });
    },
    [payKey]
  );

  // Зарплата: часы — из КАЛЕНДАРНОГО месяца, период — как написал
  // пользователь (с учётом сдвига). Ручная сумма перекрывает расчёт.
  const payroll: PayrollPayload = useMemo(() => {
    const items = state.employees
      .filter((e) => e.active)
      .map((emp) => {
        const totalHours = schedule
          .filter((d) => d.employeeId === emp.id && d.status !== "missed")
          .reduce((s, d) => s + (d.hours || 0), 0);
        const overridden = amountOverrides[emp.id];
        const amount =
          overridden != null
            ? overridden
            : Math.round(totalHours * emp.rate);
        return {
          employeeId: emp.id,
          employeeName: emp.name,
          totalHours,
          amount,
        };
      });
    const totalAmount = items.reduce((s, i) => s + i.amount, 0);
    return {
      year: payYear,
      month: payMonth,
      calYear,
      calMonth,
      items,
      totalAmount,
      generatedAt: new Date().toISOString(),
    };
  }, [
    schedule,
    state.employees,
    amountOverrides,
    payYear,
    payMonth,
    calYear,
    calMonth,
  ]);

  const goToPrevMonth = () => {
    const prev = shiftMonth(payYear, payMonth, -1);
    setPayYear(prev.year);
    setPayMonth(prev.month);
  };
  const goToNextMonth = () => {
    const next = shiftMonth(payYear, payMonth, 1);
    setPayYear(next.year);
    setPayMonth(next.month);
  };

  return {
    // Период зарплаты (заголовок, перенос, печать)
    year: payYear,
    month: payMonth,
    setYear: setPayYear,
    setMonth: setPayMonth,
    goToPrevMonth,
    goToNextMonth,
    // Календарный месяц фактических смен
    calYear,
    calMonth,
    // Сдвиг «календарь → зарплата», месяцев
    payOffset,
    setPayOffset,
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
    payroll,
    message,
    setMessage,
  };
}
