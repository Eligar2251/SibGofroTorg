// =========================================================
// FILE: src/components/admin/duty-schedule/scheduleGenerator.ts
// Генерация расписания дежурств охраны на месяц.
// =========================================================

import { Employee, DayAssignment, GenerationOptions } from "./types";

export const MONTHS_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

export const WEEKDAYS_SHORT_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getWeekday(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay();
}

export function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

export function defaultHoursForWeekday(weekday: number): number {
  return isWeekend(weekday) ? 24 : 15;
}

/**
 * Основной алгоритм генерации расписания на месяц.
 *
 * Логика:
 * 1) У «фиксированных» сотрудников (role === 'fixed') есть список
 *    закреплённых дней недели (fixedRules) — они получают этот день
 *    всегда, вне очереди.
 * 2) Оставшиеся дни распределяются по кругу между «чередующимися»
 *    сотрудниками (role === 'rotating') строго по порядку календарных дат.
 *    Благодаря тому, что «занятые» фиксированными сотрудниками дни просто
 *    пропускаются (а не сбивают счётчик), у чередующихся сотрудников
 *    никогда не бывает двух смен подряд.
 * 3) Количество часов по умолчанию: суббота/воскресенье — 24ч,
 *    остальные — 15ч. Если у фиксированного правила задано своё число
 *    часов — используется оно.
 */
export function generateSchedule(
  year: number,
  month: number,
  employees: Employee[],
  options: GenerationOptions = {}
): DayAssignment[] {
  const fixed = employees.filter((e) => e.active && e.role === "fixed");
  const rotating = employees.filter((e) => e.active && e.role === "rotating");
  const total = daysInMonth(year, month);
  const result: DayAssignment[] = [];

  let rotationIdx = 0;
  if (options.rotatingStartEmployeeId) {
    const found = rotating.findIndex(
      (e) => e.id === options.rotatingStartEmployeeId
    );
    if (found >= 0) rotationIdx = found;
  }

  for (let day = 1; day <= total; day++) {
    const weekday = getWeekday(year, month, day);
    const date = formatDate(year, month, day);
    const baseHours = defaultHoursForWeekday(weekday);

    const fixedOwner = fixed.find((e) =>
      e.fixedRules?.some((r) => r.weekday === weekday)
    );
    if (fixedOwner) {
      const rule = fixedOwner.fixedRules!.find((r) => r.weekday === weekday)!;
      result.push({
        date,
        weekday,
        employeeId: fixedOwner.id,
        hours: rule.hours ?? baseHours,
        status: "normal",
      });
      continue;
    }

    if (rotating.length === 0) {
      result.push({
        date,
        weekday,
        employeeId: null,
        hours: baseHours,
        status: "normal",
      });
      continue;
    }

    const emp = rotating[rotationIdx % rotating.length];
    result.push({
      date,
      weekday,
      employeeId: emp.id,
      hours: baseHours,
      status: "normal",
    });
    rotationIdx++;
  }

  return result;
}

/** Дополняет сохранённое расписание пустыми днями, если месяц ещё не сгенерирован полностью. */
export function fillMissingDays(
  schedule: DayAssignment[],
  year: number,
  month: number
): DayAssignment[] {
  const total = daysInMonth(year, month);
  const map = new Map(schedule.map((d) => [d.date, d]));
  const result: DayAssignment[] = [];
  for (let day = 1; day <= total; day++) {
    const weekday = getWeekday(year, month, day);
    const date = formatDate(year, month, day);
    result.push(
      map.get(date) ?? {
        date,
        weekday,
        employeeId: null,
        hours: defaultHoursForWeekday(weekday),
        status: "normal",
      }
    );
  }
  return result;
}

/**
 * Определяет, кто из чередующихся сотрудников должен начинать следующий
 * месяц (для непрерывности очереди).
 */
export function getNextRotationStartId(
  schedule: DayAssignment[],
  rotatingEmployees: Employee[]
): string | undefined {
  if (rotatingEmployees.length === 0) return undefined;
  const ids = new Set(rotatingEmployees.map((e) => e.id));
  const sorted = [...schedule].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const empId = sorted[i].employeeId;
    if (empId && ids.has(empId)) {
      const idx = rotatingEmployees.findIndex((e) => e.id === empId);
      return rotatingEmployees[(idx + 1) % rotatingEmployees.length].id;
    }
  }
  return rotatingEmployees[0].id;
}

/** Находит даты, где один и тот же сотрудник стоит два дня подряд (для подсветки при ручном редактировании). */
export function findConsecutiveConflicts(
  schedule: DayAssignment[]
): Set<string> {
  const sorted = [...schedule].sort((a, b) => a.date.localeCompare(b.date));
  const conflicts = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.employeeId && prev.employeeId && cur.employeeId === prev.employeeId) {
      conflicts.add(prev.date);
      conflicts.add(cur.date);
    }
  }
  return conflicts;
}
