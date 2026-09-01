// =========================================================
// FILE: src/components/admin/duty-schedule/DutySchedulePrint.tsx
// Печатная версия табеля дежурств охраны: A4 альбомная.
// Структура листа (сверху вниз):
//   1) ТАБЕЛЬ — дни 1..31 по горизонтали, строки — охранники,
//      в ячейках часы смен, справа итог часов;
//   2) СВОДКА по сотрудникам — телефон, часы и ставка
//      (если сумма месяца задана вручную — ставка считается как
//      сумма ÷ часы и печатается числом, иначе автоматическая
//      ставка из справочника, по умолчанию 115);
//   3) ВЫПЛАТЫ — каждый столбец это сотрудник, ниже даты и суммы
//      его выплат (столько дней, сколько задал пользователь —
//      хоть 10 и больше).
// Без легенды, комментариев и пометок — бланк чистый. Печатается
// месяц табеля (year/month). Кнопка «Редактировать» возвращает
// в таблицу — весь график правится прямо в ячейках.
// =========================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { Employee, DayAssignment, SalaryPayout } from "./types";
import { MONTHS_RU, WEEKDAYS_SHORT_RU, isWeekend } from "./scheduleGenerator";
import { SITE_NAME } from "@/lib/seo";

interface Props {
  /** Месяц табеля — то, что показано в сетке. */
  year: number;
  month: number; // 1-12
  employees: Employee[];
  schedule: DayAssignment[];
  /** Ручные суммы месяца: employeeId -> сумма. По ним ставка в
   *  сводке печатается числом (сумма ÷ часы). */
  amountOverrides: Record<string, number>;
  /** Выплаты за период: дни и суммы задаёт пользователь. */
  payouts: SalaryPayout[];
  companyPhone?: string;
  companyAddress?: string;
  onDone: () => void;
  onEdit?: () => void;
}

/** «ДД.ММ» для ячейки таблицы выплат. */
function fmtDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}` : iso || "";
}

/** Колонка таблицы выплат: человек и его выплаты по дням. */
interface PayoutColumn {
  key: string;
  name: string;
  rows: { date: string; amount: number }[];
  total: number;
}

export function DutySchedulePrint({
  year,
  month,
  employees,
  schedule,
  amountOverrides,
  payouts,
  companyPhone,
  companyAddress,
  onDone,
  onEdit,
}: Props) {
  const [printing, setPrinting] = useState(false);
  const triggered = useRef(false);

  const activeEmployees = employees.filter((e) => e.active);

  // Дни месяца по порядку (1..31), с учётом фактической длины месяца.
  const calPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const days = schedule
    .filter((d) => d.date.startsWith(calPrefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Сводка: часы и ставка (ручная — числом, иначе автоматическая).
  const totals = activeEmployees.map((emp) => {
    const hours = schedule
      .filter((d) => d.employeeId === emp.id && d.status !== "missed")
      .reduce((s, d) => s + (d.hours || 0), 0);
    const overridden = amountOverrides[emp.id];
    const rate =
      overridden != null && hours > 0
        ? Math.round(overridden / hours)
        : emp.rate;
    return { emp, hours, rate };
  });
  const grandHours = totals.reduce((s, t) => s + t.hours, 0);

  // Колонки выплат: сотрудники табеля (в порядке справочника),
  // затем люди, введённые вручную (группировка по имени).
  const payoutColumns: PayoutColumn[] = [];
  for (const emp of employees) {
    const rows = payouts
      .filter((p) => p.employeeId === emp.id)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    if (rows.length === 0) continue;
    payoutColumns.push({
      key: emp.id,
      name: emp.name,
      rows: rows.map((p) => ({ date: p.date, amount: p.amount })),
      total: rows.reduce((s, p) => s + (p.amount || 0), 0),
    });
  }
  const knownIds = new Set(employees.map((e) => e.id));
  const customByName = new Map<string, SalaryPayout[]>();
  for (const p of payouts) {
    if (knownIds.has(p.employeeId)) continue;
    const name = p.employeeName.trim() || "Сотрудник";
    const existing = customByName.get(name);
    if (existing) existing.push(p);
    else customByName.set(name, [p]);
  }
  for (const [name, list] of customByName.entries()) {
    const rows = [...list].sort((a, b) =>
      (a.date || "").localeCompare(b.date || "")
    );
    payoutColumns.push({
      key: `name:${name.toLowerCase()}`,
      name,
      rows: rows.map((p) => ({ date: p.date, amount: p.amount })),
      total: rows.reduce((s, p) => s + (p.amount || 0), 0),
    });
  }
  const maxPayoutRows = payoutColumns.reduce(
    (m, c) => Math.max(m, c.rows.length),
    0
  );

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
          {onEdit && (
            <button
              className="ds-btn"
              onClick={() => onEdit()}
              title="Вернуться к таблице: весь график редактируется прямо в ячейках"
            >
              ✎ Редактировать
            </button>
          )}
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

        {/* 1. ТАБЕЛЬ: строки — охранники, столбцы — дни 1..31,
            в ячейках часы. Без комментариев и легенды. */}
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
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="ds-grid-name ds-grid-grand-label">
                Итого часов за {MONTHS_RU[month - 1].toLowerCase()}
              </td>
              <td colSpan={days.length} />
              <td className="ds-print-num ds-print-total">{grandHours}</td>
            </tr>
          </tfoot>
        </table>

        {/* 2. Сводка по сотрудникам: телефон, часы, ставка. */}
        <div className="ds-print-subhead">Сводка по сотрудникам</div>
        <table className="ds-print-summary">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Телефон</th>
              <th>Часов</th>
              <th>Ставка, ₽/ч</th>
            </tr>
          </thead>
          <tbody>
            {totals.map(({ emp, hours, rate }) => (
              <tr key={emp.id}>
                <td>{emp.name}</td>
                <td>{emp.phone || "—"}</td>
                <td className="ds-print-num">{hours}</td>
                <td className="ds-print-num">{rate}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                Итого часов за {MONTHS_RU[month - 1].toLowerCase()}
              </td>
              <td className="ds-print-num ds-print-total">{grandHours}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        {/* 3. Выплаты: столбец — сотрудник, ниже даты и суммы
            его выплат (сколько дней задал пользователь). */}
        {payoutColumns.length > 0 && (
          <>
            <div className="ds-print-subhead">Выплаты</div>
            <table className="ds-print-payouts">
              <thead>
                <tr>
                  <th className="ds-print-payouts-num">№</th>
                  {payoutColumns.map((c) => (
                    <th key={c.key}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxPayoutRows }, (_, i) => (
                  <tr key={i}>
                    <td className="ds-print-payouts-num">{i + 1}</td>
                    {payoutColumns.map((c) => {
                      const p = c.rows[i];
                      return (
                        <td key={c.key}>
                          {p
                            ? `${fmtDay(p.date)} — ${p.amount.toLocaleString(
                                "ru-RU"
                              )} ₽`
                            : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="ds-print-payouts-num">Итого</td>
                  {payoutColumns.map((c) => (
                    <td key={c.key} className="ds-print-payouts-total">
                      {c.total.toLocaleString("ru-RU")} ₽
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </>
        )}

        <div className="ds-print-sign">
          <span>Ответственный: ______________________</span>
          <span>Дата: ____________</span>
        </div>
      </div>
    </div>
  );
}
