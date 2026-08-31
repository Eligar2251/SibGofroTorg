// =========================================================
// FILE: src/components/admin/duty-schedule/useDutySchedule.ts
// Хук табеля дежурств охраны: состояние, генерация, редактирование,
// расчёт зарплаты и гибкий план выплат по дням (несколько выплат/дней
// на сотрудника, ручное редактирование сотрудников, сумм и дат).
// Данные сохраняются в localStorage.
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

interface StoredState {
  employees: Employee[];
  schedules: Record<string, DayAssignment[]>;
  /** Ручные суммы за месяц: [YYYY-MM] -> [employeeId] -> сумма.
   *  Перекрывают расчёт «часы × ставка» (для переноса и печати). */
  amountOverrides: Record<string, Record<string, number>>;
  /** Старое поле: [зарплатный месяц YYYY-MM] -> [employeeId] -> план. */
  payPlans?: PayPlans;
  /** Новое поле: [зарплатный месяц YYYY-MM] -> список выплат по дням. */
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
    const payouts: SalaryPayoutsByPeriod = v2.salaryPayouts ? { ...v2.salaryPayouts } : {};

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

  let offset = 0;
  try {
    const rawOffset = localStorage.getItem(LEGACY_OFFSET_KEY);
    offset = rawOffset != null ? Number(rawOffset) : 1;
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
    salaryPayouts: {},
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

/** Создаёт начальный список выплат по умолчанию для активных сотрудников на основе табеля */
function makeDefaultPayouts(
  employees: Employee[],
  schedules: Record<string, DayAssignment[]>,
  amountOverrides: Record<string, Record<string, number>>,
  payPeriodKey: string,
  scheduleMonthKey: string
): SalaryPayout[] {
  const [y, m] = payPeriodKey.split("-").map(Number);
  const defDate = y && m ? lastDayOfMonth(y, m) : `${payPeriodKey}-25`;
  const schedKey = schedules[payPeriodKey] ? payPeriodKey : scheduleMonthKey;
  const sched = schedules[schedKey] || [];
  const overrides = amountOverrides[schedKey] || {};

  return employees
    .filter((e) => e.active)
    .map((emp) => {
      const hours = sched
        .filter((d) => d.employeeId === emp.id && d.status !== "missed")
        .reduce((s, d) => s + (d.hours || 0), 0);
      const override = overrides[emp.id];
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

  // ── Выплаты зарплаты по дням (несколько дней на сотрудника) ──

  /** Получить список выплат для указанного зарплатного месяца. */
  const getPayoutsFor = useCallback(
    (payPeriodKey: string): SalaryPayout[] => {
      if (state.salaryPayouts?.[payPeriodKey] != null) {
        return state.salaryPayouts[payPeriodKey];
      }
      // Если ещё нет сохранённых записей — генерируем дефолтные по текущему табелю
      return makeDefaultPayouts(
        state.employees,
        state.schedules,
        state.amountOverrides,
        payPeriodKey,
        key
      );
    },
    [state.salaryPayouts, state.employees, state.schedules, state.amountOverrides, key]
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
        const currentList =
          prev.salaryPayouts?.[payPeriodKey] ??
          makeDefaultPayouts(
            prev.employees,
            prev.schedules,
            prev.amountOverrides,
            payPeriodKey,
            key
          );
        const [y, m] = payPeriodKey.split("-").map(Number);
        const defDate = y && m ? lastDayOfMonth(y, m) : `${payPeriodKey}-25`;
        const defaultEmp = prev.employees.find((e) => e.active) || prev.employees[0];
        const empId = partial?.employeeId || defaultEmp?.id || "custom";
        const empName =
          partial?.employeeName ||
          prev.employees.find((e) => e.id === empId)?.name ||
          "Сотрудник";

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
    [key]
  );

  /** Добавить выплату конкретному сотруднику */
  const addPayoutForEmployee = useCallback(
    (
      payPeriodKey: string,
      employeeId: string,
      initialAmount?: number,
      initialDate?: string
    ) => {
      setState((prev) => {
        const currentList =
          prev.salaryPayouts?.[payPeriodKey] ??
          makeDefaultPayouts(
            prev.employees,
            prev.schedules,
            prev.amountOverrides,
            payPeriodKey,
            key
          );
        const emp = prev.employees.find((e) => e.id === employeeId);
        const empName = emp ? emp.name : "Сотрудник";
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
    [key]
  );

  /** Изменить строку выплаты (сотрудник, дата, сумма, комментарий) */
  const updatePayout = useCallback(
    (payPeriodKey: string, id: string, patch: Partial<SalaryPayout>) => {
      setState((prev) => {
        const currentList =
          prev.salaryPayouts?.[payPeriodKey] ??
          makeDefaultPayouts(
            prev.employees,
            prev.schedules,
            prev.amountOverrides,
            payPeriodKey,
            key
          );

        const updated = currentList.map((item) => {
          if (item.id !== id) return item;
          const next = { ...item, ...patch };
          // При смене employeeId обновляем имя, если это известный сотрудник и имя не передано явно
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
    [key]
  );

  /** Удалить строку выплаты */
  const removePayout = useCallback(
    (payPeriodKey: string, id: string) => {
      setState((prev) => {
        const currentList =
          prev.salaryPayouts?.[payPeriodKey] ??
          makeDefaultPayouts(
            prev.employees,
            prev.schedules,
            prev.amountOverrides,
            payPeriodKey,
            key
          );
        return {
          ...prev,
          salaryPayouts: {
            ...prev.salaryPayouts,
            [payPeriodKey]: currentList.filter((item) => item.id !== id),
          },
        };
      });
    },
    [key]
  );

  /** Разбить выплату на две части (например, аванс и остаток) */
  const splitPayout = useCallback(
    (payPeriodKey: string, id: string) => {
      setState((prev) => {
        const currentList =
          prev.salaryPayouts?.[payPeriodKey] ??
          makeDefaultPayouts(
            prev.employees,
            prev.schedules,
            prev.amountOverrides,
            payPeriodKey,
            key
          );
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
    [key]
  );

  /** Сбросить выплаты и заполнить заново по табелю (по 1 строке на активного охранника) */
  const resetPayoutsFromSchedule = useCallback(
    (payPeriodKey: string, scheduleKey?: string) => {
      setState((prev) => {
        const fresh = makeDefaultPayouts(
          prev.employees,
          prev.schedules,
          prev.amountOverrides,
          payPeriodKey,
          scheduleKey || key
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
    [key]
  );

  // ── Совместимость со старым setPayPlan (для обратной совместимости) ──
  const setPayPlan = useCallback(
    (
      payPeriodKey: string,
      employeeId: string,
      patch: Partial<{ date: string | null; amount: number | null }>
    ) => {
      setState((prev) => {
        const currentList =
          prev.salaryPayouts?.[payPeriodKey] ??
          makeDefaultPayouts(
            prev.employees,
            prev.schedules,
            prev.amountOverrides,
            payPeriodKey,
            key
          );
        const existingIdx = currentList.findIndex((item) => item.employeeId === employeeId);
        let updated: SalaryPayout[];

        if (existingIdx >= 0) {
          updated = currentList.map((item, idx) => {
            if (idx !== existingIdx) return item;
            return {
              ...item,
              ...(patch.date !== undefined ? { date: patch.date || "" } : {}),
              ...(patch.amount !== undefined
                ? { amount: patch.amount != null ? Math.max(0, Math.round(patch.amount)) : 0 }
                : {}),
            };
          });
        } else {
          const emp = prev.employees.find((e) => e.id === employeeId);
          const [y, m] = payPeriodKey.split("-").map(Number);
          const defDate = y && m ? lastDayOfMonth(y, m) : "";
          updated = [
            ...currentList,
            {
              id: `pay_${Date.now()}_${employeeId}`,
              employeeId,
              employeeName: emp?.name || "Сотрудник",
              date: patch.date || defDate,
              amount: patch.amount != null ? Math.max(0, Math.round(patch.amount)) : 0,
            },
          ];
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
    [key]
  );

  const payPlansFor = useCallback(
    (payPeriodKey: string) => {
      const payouts = getPayoutsFor(payPeriodKey);
      const res: Record<string, { date?: string; amount?: number }> = {};
      for (const p of payouts) {
        if (!res[p.employeeId]) {
          res[p.employeeId] = { date: p.date, amount: p.amount };
        } else {
          res[p.employeeId].amount = (res[p.employeeId].amount || 0) + p.amount;
        }
      }
      return res;
    },
    [getPayoutsFor]
  );

  // Расчёт по табелю: часы × ставка (или ручная сумма за месяц табеля).
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
    getPayoutsFor,
    setSalaryPayouts,
    addPayout,
    addPayoutForEmployee,
    updatePayout,
    removePayout,
    splitPayout,
    resetPayoutsFromSchedule,
    setPayPlan,
    payPlansFor,
    payroll,
    message,
    setMessage,
  };
}
