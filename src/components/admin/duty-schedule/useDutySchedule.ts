// =========================================================
// FILE: src/components/admin/duty-schedule/useDutySchedule.ts
// Хук табеля дежурств охраны: состояние, генерация, редактирование
// и расчёт «часы × ставка» по календарю смен.
//
// СДВИГ «календарь → зарплата» (как раньше): навигация ведётся по
// ПЕРИОДУ ЗАРПЛАТЫ (например, «сентябрь»), а календарь смен
// показывается за (период − сдвиг) (август). Сдвиг настраивается
// селектом в панели (0/1/2 месяца) и сохраняется. Сдвиг — только
// РАБОЧАЯ логика, в печатную форму он не выводится.
//
// ЗАРПЛАТА — ОТДЕЛЬНАЯ СИСТЕМА: список выплат (день + сумма)
// заполняется ТОЛЬКО вручную и не зависит от табеля. У любого
// человека может быть любое число выплат за месяц (хоть каждый
// день). Человек может быть в табеле и не участвовать в зп —
// и наоборот (в зп можно добавить вообще любого человека).
// Данные сохраняются в localStorage.
// =========================================================

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Employee,
  DayAssignment,
  PayrollPayload,
  CellStatus,
  PayPlans,
  SalaryPayout,
  SalaryPayoutsByPeriod,
} from "./types";
import {
  generateSchedule,
  fillMissingDays,
  getNextRotationStartId,
  daysInMonth,
} from "./scheduleGenerator";

const STORAGE_KEY = "duty_schedule_v2";
const LEGACY_STORAGE_KEY = "duty_schedule_v1";
const LEGACY_OFFSET_KEY = "duty_schedule_offset_v1";
const OFFSET_KEY = "duty_schedule_offset_v2";

interface StoredState {
  employees: Employee[];
  schedules: Record<string, DayAssignment[]>;
  /** Ручные суммы за период: [YYYY-MM] -> [employeeId] -> сумма.
   *  Перекрывают расчёт «часы × ставка» (колонка «Сумма» в табеле). */
  amountOverrides: Record<string, Record<string, number>>;
  /** Старое поле: [зарплатный месяц YYYY-MM] -> [employeeId] -> план. */
  payPlans?: PayPlans;
  /** [зарплатный месяц YYYY-MM] -> список выплат по дням. */
  salaryPayouts?: SalaryPayoutsByPeriod;
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

function lastDayOfMonth(year: number, month: number): string {
  const d = daysInMonth(year, month);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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

/** Сдвиг «календарь → зарплата»: 0/1/2 месяца. По умолчанию 0
 *  (календарь совпадает с периодом), значение сохраняется. */
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
  return 0;
}

function loadState(): StoredState {
  const fallback: StoredState = {
    employees: defaultEmployees,
    schedules: {},
    amountOverrides: {},
    salaryPayouts: {},
    payPlans: {},
  };

  const v2 = readStored(STORAGE_KEY);
  if (v2) {
    const emps = v2.employees ?? defaultEmployees;
    const payouts: SalaryPayoutsByPeriod = v2.salaryPayouts
      ? { ...v2.salaryPayouts }
      : {};

    // Миграция старых payPlans в salaryPayouts, если ещё нет записей
    if (v2.payPlans && Object.keys(v2.payPlans).length > 0) {
      for (const [periodKey, empMap] of Object.entries(v2.payPlans)) {
        if (!payouts[periodKey] && empMap && Object.keys(empMap).length > 0) {
          const list: SalaryPayout[] = [];
          const [y, m] = periodKey.split("-").map(Number);
          const defDate = y && m ? lastDayOfMonth(y, m) : `${periodKey}-25`;
          for (const [empId, entry] of Object.entries(empMap)) {
            if (!entry) continue;
            const empName = emps.find((e) => e.id === empId)?.name || empId;
            list.push({
              id: `pay_${periodKey}_${empId}_${Math.random().toString(36).slice(2, 7)}`,
              employeeId: empId,
              employeeName: empName,
              date: entry.date || defDate,
              amount: entry.amount ?? 0,
              comment: "",
            });
          }
          if (list.length > 0) {
            payouts[periodKey] = list;
          }
        }
      }
    }

    return {
      employees: emps,
      schedules: v2.schedules ?? {},
      amountOverrides: v2.amountOverrides ?? {},
      salaryPayouts: payouts,
      payPlans: v2.payPlans ?? {},
    };
  }

  // Миграция со старого хранилища v1
  const legacy = readStored(LEGACY_STORAGE_KEY);
  if (!legacy) return fallback;

  const schedules = legacy.schedules ?? {};

  const state: StoredState = {
    employees: legacy.employees ?? defaultEmployees,
    schedules,
    amountOverrides: legacy.amountOverrides ?? {},
    salaryPayouts: {},
    payPlans: legacy.payPlans ?? {},
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_OFFSET_KEY);
  } catch {
    /* localStorage недоступен */
  }
  return state;
}

/** Выплаты «по табелю» — ТОЛЬКО по явной команде пользователя
 *  (кнопка «Заполнить по табелю»): 1 строка на активного охранника,
 *  сумма = ручная сумма периода или часы календаря × ставка. */
function makePayoutsFromSchedule(
  employees: Employee[],
  schedule: DayAssignment[],
  amountOverrides: Record<string, number>,
  payPeriodKey: string
): SalaryPayout[] {
  const [y, m] = payPeriodKey.split("-").map(Number);
  const defDate = y && m ? lastDayOfMonth(y, m) : `${payPeriodKey}-25`;

  return employees
    .filter((e) => e.active)
    .map((emp) => {
      const hours = schedule
        .filter((d) => d.employeeId === emp.id && d.status !== "missed")
        .reduce((s, d) => s + (d.hours || 0), 0);
      const override = amountOverrides[emp.id];
      const amount = override != null ? override : Math.round(hours * emp.rate);
      return {
        id: `pay_${payPeriodKey}_${emp.id}`,
        employeeId: emp.id,
        employeeName: emp.name,
        date: defDate,
        amount,
        comment: "",
      };
    });
}

export function useDutySchedule(initialYear?: number, initialMonth?: number) {
  // Навигация ведётся по ПЕРИОДУ ЗАРПЛАТЫ (как думает пользователь:
  // «делаю зарплату за сентябрь»). Календарь смен = период − сдвиг.
  const now = new Date();
  const [year, setYear] = useState(initialYear ?? now.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? now.getMonth() + 1);
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
      /* localStorage недоступен */
    }
  }, []);

  // Календарный месяц — реальные даты смен (период минус сдвиг).
  const cal = shiftMonth(year, month, -payOffset);
  const calYear = cal.year;
  const calMonth = cal.month;
  const payKey = monthKey(year, month);
  const calKey = monthKey(calYear, calMonth);

  const schedule = useMemo(
    () => fillMissingDays(state.schedules[calKey] ?? [], calYear, calMonth),
    [state.schedules, calKey, calYear, calMonth]
  );

  const persistSchedule = useCallback(
    (newSchedule: DayAssignment[]) => {
      setState((prev) => ({
        ...prev,
        schedules: { ...prev.schedules, [calKey]: newSchedule },
      }));
    },
    [calKey]
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

  // ── Ручные суммы за период (перекрывают «часы × ставка» в табеле) ──
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

  // ── Выплаты зарплаты по дням (отдельная система, только вручную) ──

  /** Список выплат за зарплатный месяц. Пустой, если ещё ничего
   *  не задано, — ничего не подставляется автоматически: дни и
   *  суммы выплат указывает пользователь. */
  const getPayoutsFor = useCallback(
    (payPeriodKey: string): SalaryPayout[] => {
      return state.salaryPayouts?.[payPeriodKey] ?? [];
    },
    [state.salaryPayouts]
  );

  /** Сохранить список выплат за зарплатный месяц */
  const setSalaryPayouts = useCallback(
    (payPeriodKey: string, payouts: SalaryPayout[]) => {
      setState((prev) => ({
        ...prev,
        salaryPayouts: {
          ...prev.salaryPayouts,
          [payPeriodKey]: payouts,
        },
      }));
    },
    []
  );

  /** Добавить новую строку выплаты */
  const addPayout = useCallback(
    (payPeriodKey: string, partial?: Partial<SalaryPayout>) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];
        const [y, m] = payPeriodKey.split("-").map(Number);
        const defDate = y && m ? lastDayOfMonth(y, m) : `${payPeriodKey}-25`;
        const defaultEmp = prev.employees.find((e) => e.active) || prev.employees[0];
        const empId = partial?.employeeId || defaultEmp?.id || "custom";
        const empName =
          partial?.employeeName ||
          prev.employees.find((e) => e.id === empId)?.name ||
          "";

        const newEntry: SalaryPayout = {
          id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          employeeId: empId,
          employeeName: empName,
          date: partial?.date || defDate,
          amount: partial?.amount != null ? Math.max(0, Math.round(partial.amount)) : 0,
          comment: partial?.comment || "",
        };

        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: [...currentList, newEntry],
          },
        };
      });
    },
    []
  );

  /** Добавить выплату конкретному человеку (день и сумму задаёт пользователь) */
  const addPayoutForEmployee = useCallback(
    (
      payPeriodKey: string,
      employeeId: string,
      employeeName?: string,
      initialAmount?: number,
      initialDate?: string
    ) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];
        const emp = prev.employees.find((e) => e.id === employeeId);
        const empName =
          employeeName?.trim() || (emp ? emp.name : "") || "Сотрудник";
        const [y, m] = payPeriodKey.split("-").map(Number);
        const defDate = initialDate || (y && m ? lastDayOfMonth(y, m) : `${payPeriodKey}-25`);

        const newEntry: SalaryPayout = {
          id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          employeeId,
          employeeName: empName,
          date: defDate,
          amount: initialAmount != null ? Math.max(0, Math.round(initialAmount)) : 0,
          comment: "",
        };

        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: [...currentList, newEntry],
          },
        };
      });
    },
    []
  );

  /** Изменить строку выплаты (сотрудник, дата, сумма, комментарий) */
  const updatePayout = useCallback(
    (payPeriodKey: string, id: string, patch: Partial<SalaryPayout>) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];

        const updated = currentList.map((item) => {
          if (item.id !== id) return item;
          const next = { ...item, ...patch };
          // При смене employeeId обновляем имя, если это известный сотрудник
          if (patch.employeeId && patch.employeeId !== "custom" && !patch.employeeName) {
            const foundEmp = prev.employees.find((e) => e.id === patch.employeeId);
            if (foundEmp) next.employeeName = foundEmp.name;
          }
          if (patch.amount != null) {
            next.amount = Math.max(0, Math.round(Number(patch.amount) || 0));
          }
          return next;
        });

        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: updated,
          },
        };
      });
    },
    []
  );

  /** Удалить строку выплаты */
  const removePayout = useCallback(
    (payPeriodKey: string, id: string) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];
        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: currentList.filter((item) => item.id !== id),
          },
        };
      });
    },
    []
  );

  /** Убрать человека из зп за месяц: удаляются ВСЕ его выплаты за
   *  этот период. В табеле дежурств человек остаётся — это разные
   *  системы. Сопоставление по employeeId либо по имени (для
   *  вручную введённых людей). */
  const removePayoutsForEmployee = useCallback(
    (payPeriodKey: string, employeeId: string, employeeName: string) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];
        const nameLower = employeeName.trim().toLowerCase();
        const kept = currentList.filter((item) => {
          const byId =
            employeeId &&
            employeeId !== "custom" &&
            item.employeeId === employeeId;
          const byName =
            nameLower.length > 0 &&
            item.employeeName.trim().toLowerCase() === nameLower;
          return !(byId || byName);
        });
        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: kept,
          },
        };
      });
    },
    []
  );

  /** Разбить выплату на две части (например, пополам на разные дни) */
  const splitPayout = useCallback(
    (payPeriodKey: string, id: string) => {
      setState((prev) => {
        const currentList = prev.salaryPayouts?.[payPeriodKey] ?? [];
        const target = currentList.find((item) => item.id === id);
        if (!target) return prev;

        const half1 = Math.floor(target.amount / 2);
        const half2 = target.amount - half1;

        const [y, m] = payPeriodKey.split("-").map(Number);
        const defDate = y && m ? lastDayOfMonth(y, m) : target.date;

        const updated: SalaryPayout[] = [];
        for (const item of currentList) {
          if (item.id === id) {
            updated.push({
              ...item,
              amount: half1,
              comment: item.comment || "Выплата 1",
            });
            updated.push({
              id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              employeeId: target.employeeId,
              employeeName: target.employeeName,
              date: defDate,
              amount: half2,
              comment: "Выплата 2",
            });
          } else {
            updated.push(item);
          }
        }

        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: updated,
          },
        };
      });
    },
    []
  );

  /** Заполнить список выплат по табелю — ТОЛЬКО по явной команде
   *  (кнопка «Заполнить по табелю»): по 1 строке на активного
   *  охранника, сумма = ручная сумма периода или часы × ставка. */
  const resetPayoutsFromSchedule = useCallback(
    (payPeriodKey: string, scheduleMonthKey?: string) => {
      setState((prev) => {
        const schedKey = scheduleMonthKey || payPeriodKey;
        const [sy, sm] = schedKey.split("-").map(Number);
        const sched = fillMissingDays(
          prev.schedules[schedKey] ?? [],
          sy || new Date().getFullYear(),
          sm || 1
        );
        const fresh = makePayoutsFromSchedule(
          prev.employees,
          sched,
          prev.amountOverrides[payPeriodKey] ?? {},
          payPeriodKey
        );
        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: fresh,
          },
        };
      });
      setMessage("Список выплат заполнен по расчёту табеля");
    },
    []
  );

  // Расчёт по табелю (для справки): часы календаря × ставка,
  // ручная сумма периода перекрывает расчёт.
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
      calYear,
      calMonth,
      items,
      totalAmount,
      generatedAt: new Date().toISOString(),
    };
  }, [schedule, state.employees, amountOverrides, year, month, calYear, calMonth]);

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
    // Период зарплаты (навигация, переносы)
    year,
    month,
    setYear,
    setMonth,
    goToPrevMonth,
    goToNextMonth,
    // Календарный месяц фактических смен (период − сдвиг)
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
    getPayoutsFor,
    setSalaryPayouts,
    addPayout,
    addPayoutForEmployee,
    updatePayout,
    removePayout,
    removePayoutsForEmployee,
    splitPayout,
    resetPayoutsFromSchedule,
    payroll,
    message,
    setMessage,
  };
}
