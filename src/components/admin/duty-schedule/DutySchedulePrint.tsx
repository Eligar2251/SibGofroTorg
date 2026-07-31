// =========================================================
// FILE: src/components/admin/duty-schedule/DutySchedulePrint.tsx
// Печатная версия табеля дежурств охраны: A4 альбомная.
// Главная и самая крупная таблица на листе — сам табель:
// дни 1..31 идут по горизонтали на всю ширину листа,
// фамилии и рабочие часы крупные, без переносов, рабочие
// смены выделены жёлтым. Сводка и прочая информация —
// ниже и заметно мельче.
// =========================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { Employee, DayAssignment } from "./types";
import { MONTHS_RU, WEEKDAYS_SHORT_RU, isWeekend } from "./scheduleGenerator";
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

  const activeEmployees = employees.filter((e) => e.active);

  // Дни месяца по порядку (1..31), с учётом фактической длины месяца.
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const days = schedule
    .filter((d) => d.date.startsWith(monthPrefix))
    .sort((a, b) => a.date.localeCompare(b.date));

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

        {/* ГЛАВНАЯ ТАБЛИЦА — сам табель: строки — охранники,
            столбцы — дни 1..31 по горизонтали на всю ширину
            листа (альбомная ориентация). Рабочие смены жёлтые. */}
        <table className="ds-print-grid">
          <thead>
            <tr>
              <th className="ds-grid-name">Сотрудник</th>
              {days.map((d) => (
                <th
                  key={d.date}
                  className={isWeekend(d.weekday) ? "ds-print-weekend" : ""}
                >
                  <span className="ds-grid-day-num">
                    {Number(d.date.slice(-2))}
                  </span>
                  <span className="ds-grid-wd">
                    {WEEKDAYS_SHORT_RU[d.weekday]}
                  </span>
                </th>
              ))}
              <th className="ds-grid-col-hours">Часов</th>
              <th className="ds-grid-col-sum">Сумма, ₽</th>
            </tr>
          </thead>
          <tbody>
            {activeEmployees.map((emp) => {
              const totalsRow = totals.find((t) => t.emp.id === emp.id)!;
              return (
                <tr key={emp.id}>
                  <td className="ds-grid-name">{emp.name}</td>
                  {days.map((day) => {
                    const mine = day.employeeId === emp.id;
                    const cls = [
                      isWeekend(day.weekday) ? "ds-print-weekend" : "",
                      mine && day.status === "normal" ? "ds-print-work" : "",
                      mine && day.status === "missed" ? "ds-print-missed" : "",
                      mine && day.status === "temporary"
                        ? "ds-print-temporary"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <td key={day.date} className={cls}>
                        {mine
                          ? day.status === "missed"
                            ? `✕${day.hours}`
                            : day.status === "temporary"
                              ? `${day.hours}†`
                              : day.hours
                          : ""}
                      </td>
                    );
                  })}
                  <td className="ds-print-num ds-grid-total-cell">
                    {totalsRow.hours}
                  </td>
                  <td className="ds-print-num ds-grid-total-cell">
                    {totalsRow.amount.toLocaleString("ru-RU")}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="ds-grid-name ds-grid-grand-label">
                Общее число зарплаты за месяц
              </td>
              <td colSpan={days.length} />
              <td className="ds-print-num">{grandHours}</td>
              <td className="ds-print-num ds-print-total">
                {grandTotal.toLocaleString("ru-RU")} ₽
              </td>
            </tr>
          </tfoot>
        </table>

        <div className="ds-print-legend">
          <span className="ds-print-legend-item">
            <i className="ds-print-swatch ds-print-swatch--work" /> рабочая
            смена (жёлтая)
          </span>
          <span>✕ — пропустил смену</span>
          <span>† — временный охранник</span>
          <span className="ds-print-legend-note">
            Суббота/воскресенье — смена 24ч, будни — 15ч (можно изменить
            вручную).
          </span>
        </div>

        {/* Сводка по сотрудникам — ниже табеля и мельче */}
        <div className="ds-print-subhead">Сводка по сотрудникам</div>
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
                <td className="ds-print-num">
                  {amount.toLocaleString("ru-RU")}
                </td>
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

        <div className="ds-print-sign">
          <span>Ответственный: ______________________</span>
          <span>Дата: ____________</span>
        </div>
      </div>
    </div>
  );
}
