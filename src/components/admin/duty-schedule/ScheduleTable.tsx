// =========================================================
// FILE: src/components/admin/duty-schedule/ScheduleTable.tsx
// Таблица дежурств: строки — сотрудники, столбцы — дни месяца.
// =========================================================

"use client";

import React from "react";
import { Employee, DayAssignment, CellStatus } from "./types";
import {
  WEEKDAYS_SHORT_RU,
  isWeekend,
  findConsecutiveConflicts,
} from "./scheduleGenerator";

interface Props {
  employees: Employee[];
  schedule: DayAssignment[];
  onCellClick: (date: string, rowEmployeeId: string) => void;
}

const statusClass: Record<CellStatus, string> = {
  // Рабочая смена выделяется жёлтым, чтобы охранники сразу видели свои дни
  normal: "ds-cell--work",
  missed: "ds-cell--missed",
  temporary: "ds-cell--temporary",
};

export const ScheduleTable: React.FC<Props> = ({
  employees,
  schedule,
  onCellClick,
}) => {
  const conflicts = findConsecutiveConflicts(schedule);
  const activeEmployees = employees.filter((e) => e.active);

  const totalsByEmployee = activeEmployees.map((emp) => {
    const hours = schedule
      .filter((d) => d.employeeId === emp.id && d.status !== "missed")
      .reduce((s, d) => s + (d.hours || 0), 0);
    return { emp, hours, amount: Math.round(hours * emp.rate) };
  });

  const grandTotal = totalsByEmployee.reduce((s, t) => s + t.amount, 0);
  const grandHours = totalsByEmployee.reduce((s, t) => s + t.hours, 0);

  return (
    <div className="ds-table-wrapper">
      <table className="ds-table">
        <thead>
          <tr>
            <th className="ds-sticky-col">Сотрудник</th>
            {schedule.map((d) => (
              <th
                key={d.date}
                className={isWeekend(d.weekday) ? "ds-weekend-header" : ""}
              >
                {Number(d.date.slice(-2))}
                <div className="ds-weekday-label">{WEEKDAYS_SHORT_RU[d.weekday]}</div>
              </th>
            ))}
            <th className="ds-sticky-col-right">Часов</th>
            <th className="ds-sticky-col-right">Сумма, ₽</th>
          </tr>
        </thead>
        <tbody>
          {activeEmployees.map((emp) => {
            const totals = totalsByEmployee.find(
              (t) => t.emp.id === emp.id
            )!;
            return (
              <tr key={emp.id}>
                <td className="ds-sticky-col ds-employee-cell">
                  <div className="ds-employee-name">{emp.name}</div>
                  {emp.phone && (
                    <div className="ds-employee-phone">{emp.phone}</div>
                  )}
                </td>
                {schedule.map((day) => {
                  const mine = day.employeeId === emp.id;
                  const cls = [
                    "ds-cell",
                    isWeekend(day.weekday) ? "ds-cell--weekend" : "",
                    mine ? statusClass[day.status] : "",
                    conflicts.has(day.date) && mine ? "ds-cell--conflict" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td
                      key={day.date}
                      className={cls}
                      onClick={() => onCellClick(day.date, emp.id)}
                      title={mine ? `${day.date}: ${day.hours} ч.` : "Назначить смену"}
                    >
                      {mine ? day.hours : ""}
                    </td>
                  );
                })}
                <td className="ds-sticky-col-right ds-total-cell">
                  {totals.hours}
                </td>
                <td className="ds-sticky-col-right ds-total-cell">
                  {totals.amount.toLocaleString("ru-RU")}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="ds-sticky-col ds-grand-label">Итого за месяц</td>
            <td colSpan={schedule.length} />
            <td className="ds-sticky-col-right ds-total-cell">{grandHours}</td>
            <td className="ds-sticky-col-right ds-grand-total">
              {grandTotal.toLocaleString("ru-RU")} ₽
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
