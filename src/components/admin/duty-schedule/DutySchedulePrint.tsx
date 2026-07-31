// =========================================================
// FILE: src/components/admin/duty-schedule/DutySchedulePrint.tsx
// Печатная версия табеля дежурств охраны: A4, недели по строкам,
// сводка по сотрудникам и общая сумма зарплаты за месяц.
// =========================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { Employee, DayAssignment } from "./types";
import {
  MONTHS_RU,
  WEEKDAYS_SHORT_RU,
  daysInMonth,
  formatDate,
  getWeekday,
  isWeekend,
} from "./scheduleGenerator";
import { SITE_NAME } from "@/lib/seo";

interface Props {
  year: number;
  month: number; // 1-12
  employees: Employee[];
  schedule: DayAssignment[];
  companyPhone?: string;
  companyAddress?: string;
  onDone: () => void;
}

interface WeekRow {
  key: string;
  label: string;
  /** Пн..Вс; null — день не принадлежит этому месяцу */
  days: (DayAssignment | null)[];
  weekHours: number;
}

function shortName(full: string): string {
  const parts = String(full || "")
    .trim()
    .split(/\s+/);
  return parts[0] || full;
}

function statusMark(day: DayAssignment | undefined): string {
  if (!day) return "";
  if (day.status === "missed") return " ✕";
  if (day.status === "temporary") return " †";
  return "";
}

export function DutySchedulePrint({
  year,
  month,
  employees,
  schedule,
  companyPhone,
  companyAddress,
  onDone,
}: Props) {
  const [printing, setPrinting] = useState(false);
  const triggered = useRef(false);

  const byDate = new Map(schedule.map((d) => [d.date, d]));
  const empById = new Map(employees.map((e) => [e.id, e]));
  const activeEmployees = employees.filter((e) => e.active);

  const total = daysInMonth(year, month);

  // Строки-недели (Пн..Вс) с пропусками по краям месяца.
  const weeks: WeekRow[] = [];
  {
    let week: (DayAssignment | null)[] = [];
    let weekStartDay = 1;
    for (let day = 1; day <= total; day++) {
      const weekday = getWeekday(year, month, day);
      if (day === 1) {
        const lead = weekday === 0 ? 6 : weekday - 1;
        for (let i = 0; i < lead; i++) week.push(null);
      }
      week.push(byDate.get(formatDate(year, month, day)) ?? null);
      if (weekday === 0) {
        weeks.push({
          key: `w${weeks.length + 1}`,
          label: `${weekStartDay}–${day}`,
          days: week,
          weekHours: week.reduce(
            (s, d) => s + (d && d.status !== "missed" ? d.hours || 0 : 0),
            0
          ),
        });
        week = [];
        weekStartDay = day + 1;
      }
    }
    if (week.length) {
      weeks.push({
        key: `w${weeks.length + 1}`,
        label: `${weekStartDay}–${total}`,
        days: week,
        weekHours: week.reduce(
          (s, d) => s + (d && d.status !== "missed" ? d.hours || 0 : 0),
          0
        ),
      });
    }
  }

  const totals = activeEmployees.map((emp) => {
    const hours = schedule
      .filter((d) => d.employeeId === emp.id && d.status !== "missed")
      .reduce((s, d) => s + (d.hours || 0), 0);
    return { emp, hours, amount: Math.round(hours * emp.rate) };
  });
  const grandHours = totals.reduce((s, t) => s + t.hours, 0);
  const grandTotal = totals.reduce((s, t) => s + t.amount, 0);

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;
    const prev = document.title;
    document.title = `Табель дежурств — ${MONTHS_RU[month - 1]} ${year}`;
    function onAfter() {
      document.title = prev;
      onDone?.();
    }
    window.addEventListener("afterprint", onAfter);
    return () => {
      document.title = prev;
      window.removeEventListener("afterprint", onAfter);
    };
  }, [month, year, onDone]);

  function doPrint() {
    setPrinting(true);
    requestAnimationFrame(() => {
      window.print();
    });
  }

  const monthLabel = `${MONTHS_RU[month - 1]} ${year}`;

  return (
    <div className="ds-print-root">
      {!printing && (
        <div className="ds-print-toolbar">
          <button className="ds-btn ds-btn--primary" onClick={doPrint}>
            🖨 Печать
          </button>
          <button className="ds-btn" onClick={() => onDone?.()}>
            ✕ Закрыть
          </button>
        </div>
      )}

      <div className="ds-print-sheet">
        <div className="ds-print-head">
          <div className="ds-print-title">Табель дежурств охраны</div>
          <div className="ds-print-month">{monthLabel}</div>
          <div className="ds-print-company">
            {SITE_NAME}
            {companyPhone ? ` · ${companyPhone}` : ""}
            {companyAddress ? ` · ${companyAddress}` : ""}
          </div>
        </div>

        {/* Сводка по сотрудникам */}
        <table className="ds-print-summary">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Телефон</th>
              <th>Часов</th>
              <th>Ставка, ₽/ч</th>
              <th>Сумма, ₽</th>
            </tr>
          </thead>
          <tbody>
            {totals.map(({ emp, hours, amount }) => (
              <tr key={emp.id}>
                <td>{emp.name}</td>
                <td>{emp.phone || "—"}</td>
                <td className="ds-print-num">{hours}</td>
                <td className="ds-print-num">{emp.rate}</td>
                <td className="ds-print-num">{amount.toLocaleString("ru-RU")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Общее число зарплаты за месяц</td>
              <td className="ds-print-num">{grandHours}</td>
              <td />
              <td className="ds-print-num ds-print-total">
                {grandTotal.toLocaleString("ru-RU")} ₽
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Календарь по неделям */}
        <table className="ds-print-calendar">
          <thead>
            <tr>
              <th className="ds-print-week-col">Неделя</th>
              {WEEKDAYS_SHORT_RU.map((w, idx) => (
                <th
                  key={w}
                  className={isWeekend(idx) ? "ds-print-weekend" : ""}
                >
                  {w}
                </th>
              ))}
              <th className="ds-print-week-col">Часов</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.key}>
                <td className="ds-print-week-col">{week.label}</td>
                {week.days.map((day, idx) => {
                  if (!day) {
                    return <td key={`e${idx}`} className="ds-print-empty" />;
                  }
                  const emp = day.employeeId ? empById.get(day.employeeId) : null;
                  const cellCls = [
                    isWeekend(day.weekday) ? "ds-print-weekend" : "",
                    day.status === "missed" ? "ds-print-missed" : "",
                    day.status === "temporary" ? "ds-print-temporary" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td key={day.date} className={cellCls}>
                      <div className="ds-print-daynum">{Number(day.date.slice(-2))}</div>
                      <div className="ds-print-who">
                        {emp ? shortName(emp.name) : "—"}
                        {day.employeeId && statusMark(day)}
                      </div>
                      <div className="ds-print-hours">
                        {day.employeeId ? `${day.hours}ч` : ""}
                      </div>
                    </td>
                  );
                })}
                <td className="ds-print-week-col ds-print-num">
                  {week.weekHours}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ds-print-legend">
          <span>✕ — пропустил смену</span>
          <span>† — временный охранник</span>
          <span className="ds-print-legend-note">
            Суббота/воскресенье — смена 24ч, будни — 15ч (можно изменить вручную).
          </span>
        </div>

        <div className="ds-print-sign">
          <span>Ответственный: ______________________</span>
          <span>Дата: ____________</span>
        </div>
      </div>
    </div>
  );
}
