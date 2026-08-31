// =========================================================
// FILE: src/components/admin/duty-schedule/DutyScheduleAdmin.tsx
// Табель дежурств охраны: генерация на месяц, ручное редактирование,
// печать и блок «Зарплата»: разбивка зарплаты по дням (несколько
// выплат на сотрудника, ручное редактирование сотрудников, сумм
// и дат выплат) и перенос в раздел «Зарплаты» за выбранный месяц.
// =========================================================

"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Printer,
  UsersRound,
  CalendarClock,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  RotateCcw,
  Trash2,
  Split,
  UserPlus,
  ArrowUpDown,
  DollarSign,
  CalendarDays,
  Info,
} from "lucide-react";
import { useDutySchedule } from "./useDutySchedule";
import { ScheduleTable } from "./ScheduleTable";
import { EmployeeManagerModal } from "./EmployeeManagerModal";
import { DutySchedulePrint } from "./DutySchedulePrint";
import { SalaryPayout } from "./types";
import { MONTHS_RU, WEEKDAYS_SHORT_RU, daysInMonth } from "./scheduleGenerator";
import "./DutySchedule.css";

interface Props {
  initialYear?: number;
  initialMonth?: number;
  companyPhone?: string;
  companyAddress?: string;
  /** Зарплаты, уже перенесённые из табеля (для защиты от дублей). */
  existingTransfers?: {
    periodMonth: string;
    employeeName?: string;
    amount?: number;
    comment?: string | null;
  }[];
}

/** Ключ месяца YYYY-MM. */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Последний день месяца. */
function lastDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(
    daysInMonth(year, month)
  ).padStart(2, "0")}`;
}

/** Строка «ДД.ММ.ГГГГ» для отображения даты выплаты. */
function fmtDate(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Строка с днём недели «Пн, 15.09.2026». */
function fmtDateWithWeekday(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const wd = WEEKDAYS_SHORT_RU[d.getDay()] || "";
  return `${wd}, ${m[3]}.${m[2]}.${m[1]}`;
}

/** Стандартная реализация переноса: POST в API зарплат админки
 *  (по одной записи на каждую выплату из списка). */
async function defaultTransferToPayroll(
  payPeriodKey: string,
  items: SalaryPayout[]
): Promise<void> {
  for (const item of items) {
    if (item.amount <= 0) continue;
    const commentParts: string[] = ["Табель охраны"];
    if (item.comment && item.comment.trim()) {
      commentParts.push(item.comment.trim());
    } else {
      commentParts.push(`выплата от ${fmtDate(item.date)}`);
    }
    commentParts.push(`[Период:${payPeriodKey}]`);

    const res = await fetch("/api/admin/warehouse/salaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId:
          item.employeeId &&
          item.employeeId !== "custom" &&
          !item.employeeId.startsWith("custom_")
            ? item.employeeId
            : null,
        employeeName: item.employeeName.trim() || "Сотрудник охраны",
        amount: item.amount,
        date: item.date,
        source: "bank",
        isPaid: false,
        comment: commentParts.join(" — "),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(
        data.error ||
          `Не удалось перенести выплату для «${item.employeeName}» на дату ${fmtDate(
            item.date
          )}`
      );
    }
  }
}

export const DutyScheduleAdmin: React.FC<Props> = ({
  initialYear,
  initialMonth,
  companyPhone,
  companyAddress,
  existingTransfers = [],
}) => {
  const router = useRouter();
  const {
    year,
    month,
    goToPrevMonth,
    goToNextMonth,
    employees,
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
    payroll,
    message,
    setMessage,
  } = useDutySchedule(initialYear, initialMonth);

  const [showEmployees, setShowEmployees] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [rotatingStart, setRotatingStart] = useState<string>("");
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");

  // ── Зарплатный месяц: выбирается отдельно, может НЕ совпадать
  //    с месяцем табеля (например, табель за сентябрь — выплата
  //    за октябрь). ──
  const [payYear, setPayYear] = useState(initialYear ?? year);
  const [payMonth, setPayMonth] = useState(initialMonth ?? month);
  const payPeriodKey = monthKey(payYear, payMonth);
  const payPeriodLabel = `${MONTHS_RU[payMonth - 1]} ${payYear}`;
  const timesheetMonthKey = monthKey(year, month);
  const timesheetMonthLabel = `${MONTHS_RU[month - 1]} ${year}`;

  const rotatingEmployees = employees.filter(
    (e) => e.role === "rotating" && e.active
  );

  // Список уже перенесённых зарплат за этот период
  const transfersForPeriod = useMemo(
    () => existingTransfers.filter((t) => t.periodMonth === payPeriodKey),
    [existingTransfers, payPeriodKey]
  );
  const alreadyTransferred = transfersForPeriod.length > 0;
  const transferredTotal = transfersForPeriod.reduce(
    (s, t) => s + (t.amount || 0),
    0
  );

  // Список выплат для выбранного зарплатного месяца
  const payouts = getPayoutsFor(payPeriodKey);
  const payTotal = payouts.reduce((s, r) => s + (r.amount || 0), 0);
  const validPayoutsCount = payouts.filter((p) => p.amount > 0).length;

  // ── Сводка по сотрудникам (по табелю vs по выплатам) ──
  const employeeSummaries = useMemo(() => {
    // 1. Все активные сотрудники охраны
    const result = employees
      .filter((e) => e.active)
      .map((emp) => {
        // Часы и начисление по табелю дежурств
        const schedItem = payroll.items.find((i) => i.employeeId === emp.id);
        const schedHours = schedItem?.totalHours || 0;
        const schedAmount = schedItem?.amount || 0;

        // Выплаты, привязанные к этому сотруднику
        const empPayouts = payouts.filter(
          (p) => p.employeeId === emp.id || p.employeeName === emp.name
        );
        const payoutTotal = empPayouts.reduce((s, p) => s + (p.amount || 0), 0);
        const diff = payoutTotal - schedAmount;

        return {
          employeeId: emp.id,
          name: emp.name,
          rate: emp.rate,
          role: emp.role,
          schedHours,
          schedAmount,
          payoutTotal,
          payoutCount: empPayouts.length,
          diff,
          isCustom: false,
        };
      });

    // 2. Добавляем вручную добавленных сотрудников, которых нет в справочнике
    const knownIds = new Set(employees.map((e) => e.id));
    const knownNames = new Set(employees.map((e) => e.name.toLowerCase().trim()));
    const customPayouts = payouts.filter(
      (p) =>
        (!knownIds.has(p.employeeId) && !knownNames.has(p.employeeName.toLowerCase().trim())) ||
        p.employeeId === "custom"
    );

    const customGroups = new Map<string, SalaryPayout[]>();
    for (const cp of customPayouts) {
      const key = cp.employeeName.trim() || "Сотрудник";
      if (!customGroups.has(key)) customGroups.set(key, []);
      customGroups.get(key)!.push(cp);
    }

    for (const [cName, cList] of customGroups.entries()) {
      const payoutTotal = cList.reduce((s, p) => s + (p.amount || 0), 0);
      result.push({
        employeeId: cList[0].employeeId || "custom",
        name: cName,
        rate: 0,
        role: "rotating" as const,
        schedHours: 0,
        schedAmount: 0,
        payoutTotal,
        payoutCount: cList.length,
        diff: payoutTotal,
        isCustom: true,
      });
    }

    return result;
  }, [employees, payroll.items, payouts]);

  const handleGenerate = () => {
    const hasData = schedule.some((d) => d.employeeId);
    if (
      hasData &&
      !confirm("Текущее расписание за месяц будет перезаписано. Продолжить?")
    )
      return;
    generate(rotatingStart || undefined);
  };

  const handleResetPayouts = () => {
    if (
      payouts.length > 0 &&
      !confirm(
        `Заполнить список выплат заново по расчёту табеля за ${timesheetMonthLabel}?\n\nТекущие ручные выплаты за ${payPeriodLabel} будут заменены.`
      )
    ) {
      return;
    }
    resetPayoutsFromSchedule(payPeriodKey, timesheetMonthKey);
  };

  const handleSortByDate = () => {
    const sorted = [...payouts].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    setSalaryPayouts(payPeriodKey, sorted);
    setMessage("Выплаты отсортированы по дате");
  };

  const handleSortByEmployee = () => {
    const sorted = [...payouts].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName, "ru")
    );
    setSalaryPayouts(payPeriodKey, sorted);
    setMessage("Выплаты сгруппированы по сотрудникам");
  };

  const handleAddPayoutForEmp = (empId: string, remainingAmount: number) => {
    const defaultDate = lastDayOfMonth(payYear, payMonth);
    const amount = remainingAmount > 0 ? remainingAmount : 0;
    addPayoutForEmployee(payPeriodKey, empId, amount, defaultDate);
  };

  const handleTransferConfirm = async () => {
    const validItems = payouts.filter((r) => r.amount > 0 && r.employeeName.trim());
    if (validItems.length === 0) {
      setMessage("Нет сумм для переноса — укажите суммы выплат в таблице");
      setShowTransfer(false);
      return;
    }
    setTransferring(true);
    setTransferError("");
    try {
      await defaultTransferToPayroll(payPeriodKey, validItems);
      setMessage(
        `Зарплата за ${payPeriodLabel} перенесена: ${validItems.length} выплат на сумму ${payTotal.toLocaleString(
          "ru-RU"
        )} ₽`
      );
      setShowTransfer(false);
      router.refresh();
    } catch (e) {
      setTransferError(e instanceof Error ? e.message : "Ошибка сети при переносе");
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="ds-root">
      <div className="ds-header">
        <h2>Табель охраны — дежурства</h2>
        <div className="ds-month-nav">
          <button className="ds-btn" onClick={goToPrevMonth} title="Предыдущий месяц табеля">
            ←
          </button>
          <span className="ds-month-label" title="Месяц табеля (дни дежурств)">
            {MONTHS_RU[month - 1]} {year}
          </span>
          <button className="ds-btn" onClick={goToNextMonth} title="Следующий месяц табеля">
            →
          </button>
        </div>
      </div>

      <div className="ds-toolbar">
        <div className="ds-toolbar-group">
          <label>Начать чередование с:</label>
          <select
            value={rotatingStart}
            onChange={(e) => setRotatingStart(e.target.value)}
          >
            <option value="">авто (продолжение с прошлого месяца)</option>
            {rotatingEmployees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button className="ds-btn ds-btn--primary" onClick={handleGenerate}>
            Сгенерировать автоматически
          </button>
        </div>

        <div className="ds-toolbar-group">
          <button
            className="ds-btn"
            onClick={() => setShowEmployees(true)}
            title="Сотрудники, ставки и закреплённые дни"
          >
            <UsersRound size={14} style={{ verticalAlign: "-2px" }} /> Сотрудники
          </button>
          <button
            className="ds-btn"
            onClick={() => setShowPrint(true)}
            title="Печатная форма табеля"
          >
            <Printer size={14} style={{ verticalAlign: "-2px" }} /> Печать
          </button>
        </div>
      </div>

      {message && (
        <div className="ds-message" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}

      <ScheduleTable
        employees={employees}
        schedule={schedule}
        onCellSave={updateCell}
        onCellClear={clearCell}
        onUpdateEmployee={updateEmployee}
        amountOverrides={amountOverrides}
        onAmountOverride={setAmountOverride}
      />

      <div className="ds-legend">
        <span className="ds-legend-item">
          <i className="ds-swatch ds-swatch--work" /> Рабочая смена (жёлтая)
        </span>
        <span className="ds-legend-item">
          <i className="ds-swatch ds-swatch--missed" /> Пропустил смену
        </span>
        <span className="ds-legend-item">
          <i className="ds-swatch ds-swatch--temporary" /> Временный охранник
        </span>
        <span className="ds-legend-item">
          <i className="ds-swatch ds-swatch--conflict" /> Конфликт (два дня подряд)
        </span>
        <span className="ds-legend-rate">
          Ставка: {new Set(employees.filter((e) => e.active).map((e) => e.rate)).size === 1
            ? `${employees.find((e) => e.active)?.rate.toLocaleString("ru-RU")} ₽/час`
            : "у каждого своя (в «Сотрудниках»)"}
        </span>
        <span className="ds-legend-edit" title="Весь график редактируется прямо в ячейках — в том числе перед печатью">
          Клик по ячейке — часы/сотрудник/статус · двойной клик по имени или
          сумме — правка на месте · Enter — сохранить, Esc — отмена
        </span>
      </div>

      {/* ══ ЗАРПЛАТА: гибкая разбивка выплат по дням и сотрудникам ══ */}
      <div className="ds-payroll">
        <div className="ds-payroll-head">
          <div className="ds-payroll-title">
            <CalendarClock size={16} /> Выплаты и зарплата охраны
          </div>

          <div className="ds-payroll-period">
            <label>Зарплатный месяц:</label>
            <select
              value={payMonth}
              onChange={(e) => setPayMonth(Number(e.target.value))}
              title="За какой месяц зарплата переносится — может отличаться от месяца табеля"
            >
              {MONTHS_RU.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <input
              className="ds-payroll-year"
              type="number"
              min={2020}
              max={2100}
              value={payYear}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 2000 && n <= 2100) setPayYear(n);
              }}
            />
            {payPeriodKey !== timesheetMonthKey && (
              <button
                type="button"
                className="ds-payroll-link-btn"
                onClick={() => {
                  setPayYear(year);
                  setPayMonth(month);
                }}
                title="Установить зарплатный месяц равным месяцу табеля"
              >
                Совпадает с табелем ({MONTHS_RU[month - 1]})
              </button>
            )}
          </div>

          {alreadyTransferred ? (
            <span className="ds-payroll-status ds-payroll-status--done" title="Зарплата за этот месяц уже переносилась в раздел «Зарплаты»">
              <CheckCircle2 size={13} /> {payPeriodLabel}: перенесено {transfersForPeriod.length} выплат ({transferredTotal.toLocaleString("ru-RU")} ₽)
            </span>
          ) : (
            <span className="ds-payroll-status ds-payroll-status--pending">
              <CalendarDays size={13} /> Не перенесено в раздел зарплат
            </span>
          )}
        </div>

        {/* ── Сводка по сотрудникам: сравнение табеля и плана выплат ── */}
        <div className="ds-payroll-section-title">
          <span>Сводка по сотрудникам (начислено по сменам → распределено по выплатам)</span>
        </div>

        <div className="ds-payroll-summary-grid">
          {employeeSummaries.map((emp) => {
            const isMatch = !emp.isCustom && emp.schedAmount > 0 && emp.payoutTotal === emp.schedAmount;
            const isRemaining = !emp.isCustom && emp.schedAmount > 0 && emp.payoutTotal < emp.schedAmount;
            const isOver = !emp.isCustom && emp.schedAmount > 0 && emp.payoutTotal > emp.schedAmount;
            const remaining = emp.schedAmount - emp.payoutTotal;

            return (
              <div
                key={emp.employeeId}
                className={`ds-summary-card${
                  isMatch ? " ds-summary-card--ok" : isRemaining ? " ds-summary-card--warn" : ""
                }`}
              >
                <div className="ds-summary-card-head">
                  <span className="ds-summary-card-name">{emp.name}</span>
                  {!emp.isCustom && (
                    <span className="ds-summary-card-hours">
                      {emp.schedHours} ч ({emp.schedAmount.toLocaleString("ru-RU")} ₽)
                    </span>
                  )}
                </div>

                <div className="ds-summary-card-body">
                  <div className="ds-summary-card-payout">
                    Выплаты: <b>{emp.payoutTotal.toLocaleString("ru-RU")} ₽</b>
                    <span className="ds-summary-card-count">({emp.payoutCount} дн.)</span>
                  </div>

                  {isMatch && (
                    <span className="ds-summary-badge ds-summary-badge--ok">
                      <CheckCircle2 size={11} /> Распределено полностью
                    </span>
                  )}
                  {isRemaining && (
                    <span className="ds-summary-badge ds-summary-badge--warn">
                      Остаток: +{remaining.toLocaleString("ru-RU")} ₽
                    </span>
                  )}
                  {isOver && (
                    <span className="ds-summary-badge ds-summary-badge--info">
                      Превышение: +{emp.diff.toLocaleString("ru-RU")} ₽
                    </span>
                  )}
                  {emp.isCustom && (
                    <span className="ds-summary-badge ds-summary-badge--custom">
                      Ручная выплата
                    </span>
                  )}
                </div>

                <div className="ds-summary-card-actions">
                  <button
                    type="button"
                    className="ds-btn ds-btn--xs"
                    onClick={() => handleAddPayoutForEmp(emp.employeeId, remaining)}
                    title="Добавить ещё один день выплаты для этого сотрудника"
                  >
                    <Plus size={11} /> Выплата{remaining > 0 ? ` (+${remaining.toLocaleString("ru-RU")} ₽)` : ""}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Панель действий таблицы выплат ── */}
        <div className="ds-payroll-toolbar">
          <div className="ds-payroll-toolbar-left">
            <button
              type="button"
              className="ds-btn ds-btn--primary"
              onClick={() => addPayout(payPeriodKey, { date: lastDayOfMonth(payYear, payMonth) })}
              title="Добавить новую строку выплаты"
            >
              <Plus size={14} /> Добавить выплату
            </button>
            <button
              type="button"
              className="ds-btn"
              onClick={handleResetPayouts}
              title="Сбросить выплаты и заполнить заново по расчёту табеля дежурств (1 выплата на каждого сотрудника)"
            >
              <RotateCcw size={13} /> Заполнить по табелю
            </button>
          </div>

          <div className="ds-payroll-toolbar-right">
            <button
              type="button"
              className="ds-btn ds-btn--sm"
              onClick={handleSortByDate}
              title="Отсортировать выплаты по календарной дате"
            >
              <ArrowUpDown size={12} /> По дате
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--sm"
              onClick={handleSortByEmployee}
              title="Сгруппировать выплаты по фамилиям сотрудников"
            >
              <ArrowUpDown size={12} /> По сотрудникам
            </button>
          </div>
        </div>

        {/* ── Таблица выплат по дням ── */}
        <div className="ds-payouts-table-wrap">
          <table className="ds-payouts-table">
            <thead>
              <tr>
                <th style={{ width: "36px" }}>№</th>
                <th style={{ minWidth: "200px" }}>Сотрудник</th>
                <th style={{ minWidth: "190px" }} title="День, когда охранник получает деньги">
                  День выплаты
                </th>
                <th style={{ minWidth: "140px" }} title="Сумма конкретной выплаты в рублях">
                  Сумма, ₽
                </th>
                <th style={{ minWidth: "160px" }} title="Например: Аванс, Выплата 1, Окончательный расчёт">
                  Назначение / Примечание
                </th>
                <th style={{ width: "120px" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="ds-payouts-empty">
                    Нет выплат за этот период. Нажмите{" "}
                    <button
                      type="button"
                      className="ds-link-btn"
                      onClick={handleResetPayouts}
                    >
                      «Заполнить по табелю»
                    </button>{" "}
                    или{" "}
                    <button
                      type="button"
                      className="ds-link-btn"
                      onClick={() => addPayout(payPeriodKey)}
                    >
                      «+ Добавить выплату»
                    </button>
                    .
                  </td>
                </tr>
              ) : (
                payouts.map((row, idx) => {
                  const isKnownEmployee = employees.some((e) => e.id === row.employeeId);
                  const isCustom = row.employeeId === "custom" || !isKnownEmployee;

                  return (
                    <tr key={row.id}>
                      <td className="ds-payout-num">{idx + 1}</td>

                      {/* Сотрудник */}
                      <td className="ds-payout-emp-cell">
                        <select
                          className="ds-payout-select"
                          value={isCustom ? "custom" : row.employeeId}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "custom") {
                              updatePayout(payPeriodKey, row.id, {
                                employeeId: "custom",
                                employeeName: row.employeeName || "",
                              });
                            } else {
                              const emp = employees.find((empItem) => empItem.id === val);
                              updatePayout(payPeriodKey, row.id, {
                                employeeId: val,
                                employeeName: emp ? emp.name : row.employeeName,
                              });
                            }
                          }}
                        >
                          <optgroup label="Сотрудники охраны">
                            {employees
                              .filter((e) => e.active)
                              .map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name} ({e.rate} ₽/ч)
                                </option>
                              ))}
                          </optgroup>
                          {employees.some((e) => !e.active) && (
                            <optgroup label="Неактивные">
                              {employees
                                .filter((e) => !e.active)
                                .map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {e.name} (неактивен)
                                  </option>
                                ))}
                            </optgroup>
                          )}
                          <optgroup label="Другой">
                            <option value="custom">— Ввести имя вручную —</option>
                          </optgroup>
                        </select>

                        {isCustom && (
                          <input
                            type="text"
                            className="ds-payout-custom-input"
                            placeholder="ФИО сотрудника"
                            value={row.employeeName}
                            onChange={(e) =>
                              updatePayout(payPeriodKey, row.id, {
                                employeeName: e.target.value,
                              })
                            }
                          />
                        )}
                      </td>

                      {/* День выплаты */}
                      <td className="ds-payout-date-cell">
                        <div className="ds-payout-date-row">
                          <input
                            type="date"
                            className="ds-payroll-date"
                            value={row.date || ""}
                            onChange={(e) =>
                              updatePayout(payPeriodKey, row.id, {
                                date: e.target.value,
                              })
                            }
                          />
                          {row.date && (
                            <span className="ds-payout-weekday-chip">
                              {fmtDateWithWeekday(row.date)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Сумма выплаты */}
                      <td className="ds-payout-amount-cell">
                        <div className="ds-payout-amount-wrap">
                          <input
                            type="number"
                            className="ds-payroll-amount ds-payout-amount-input"
                            min={0}
                            step={100}
                            value={row.amount === 0 ? "" : row.amount}
                            placeholder="0"
                            onChange={(e) => {
                              const val = e.target.value;
                              const num = val === "" ? 0 : Number(val);
                              updatePayout(payPeriodKey, row.id, {
                                amount: Number.isNaN(num) ? 0 : num,
                              });
                            }}
                          />
                          <span className="ds-payout-currency">₽</span>
                        </div>
                      </td>

                      {/* Примечание */}
                      <td>
                        <input
                          type="text"
                          className="ds-payout-comment-input"
                          placeholder="Напр. Аванс, Выплата 1"
                          value={row.comment || ""}
                          onChange={(e) =>
                            updatePayout(payPeriodKey, row.id, {
                              comment: e.target.value,
                            })
                          }
                        />
                      </td>

                      {/* Действия */}
                      <td className="ds-payout-actions-cell">
                        <button
                          type="button"
                          className="ds-payout-btn"
                          onClick={() => splitPayout(payPeriodKey, row.id)}
                          title="Разбить эту выплату на 2 части (пополам на разные дни)"
                        >
                          <Split size={13} />
                        </button>
                        <button
                          type="button"
                          className="ds-payout-btn"
                          onClick={() =>
                            addPayoutForEmployee(
                              payPeriodKey,
                              row.employeeId,
                              0,
                              row.date
                            )
                          }
                          title="Добавить ещё один день выплаты для этого сотрудника"
                        >
                          <Plus size={13} />
                        </button>
                        <button
                          type="button"
                          className="ds-payout-btn ds-payout-btn--danger"
                          onClick={() => removePayout(payPeriodKey, row.id)}
                          title="Удалить эту выплату"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="ds-payouts-total-label">
                  Итого к выплате ({validPayoutsCount} {validPayoutsCount === 1 ? "выплата" : validPayoutsCount >= 2 && validPayoutsCount <= 4 ? "выплаты" : "выплат"}):
                </td>
                <td className="ds-payouts-total-sum">
                  {payTotal.toLocaleString("ru-RU")} ₽
                </td>
                <td colSpan={2} className="ds-payouts-total-compare">
                  По табелю: {payroll.totalAmount.toLocaleString("ru-RU")} ₽
                  {payroll.totalAmount !== payTotal && (
                    <span
                      className={`ds-payouts-diff ${
                        payTotal > payroll.totalAmount ? "ds-payouts-diff--over" : "ds-payouts-diff--warn"
                      }`}
                    >
                      ({payTotal > payroll.totalAmount ? "+" : ""}
                      {(payTotal - payroll.totalAmount).toLocaleString("ru-RU")} ₽)
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="ds-payroll-hint">
          Вы можете разбить зарплату каждого охранника на произвольное количество
          дней выплат, свободно менять суммы, даты и сотрудников. При переносе
          каждый день из списка будет создан как отдельная запись в разделе
          «Зарплаты» за {payPeriodLabel.toLowerCase()}.
        </p>

        <div className="ds-payroll-actions">
          <button
            className={`ds-btn ds-btn--lg ${
              alreadyTransferred ? "" : "ds-btn--success"
            }`}
            disabled={transferring || payTotal <= 0 || validPayoutsCount === 0}
            onClick={() => setShowTransfer(true)}
            title="Создать отдельные записи зарплаты по каждому дню выплаты в разделе «Зарплаты»"
          >
            <CalendarClock size={16} />{" "}
            {transferring
              ? "Перенос…"
              : `Перенести ${validPayoutsCount} выплат в зарплату за ${MONTHS_RU[
                  payMonth - 1
                ].toLowerCase()} (${payTotal.toLocaleString("ru-RU")} ₽)`}
          </button>
        </div>
      </div>

      {showEmployees && (
        <EmployeeManagerModal
          employees={employees}
          onAdd={addEmployee}
          onUpdate={updateEmployee}
          onRemove={removeEmployee}
          onClose={() => setShowEmployees(false)}
        />
      )}

      {showPrint && (
        <DutySchedulePrint
          year={year}
          month={month}
          employees={employees}
          schedule={schedule}
          amountOverrides={amountOverrides}
          companyPhone={companyPhone}
          companyAddress={companyAddress}
          onDone={() => setShowPrint(false)}
          onEdit={() => {
            setShowPrint(false);
            setMessage(
              "Вернитесь в таблицу и поправьте график прямо в ячейках — потом снова нажмите «Печать»."
            );
          }}
        />
      )}

      {showTransfer && (
        <div
          className="ds-modal-overlay"
          onClick={() => !transferring && setShowTransfer(false)}
        >
          <div
            className="ds-modal ds-modal--transfer"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Перенос в зарплату — {payPeriodLabel}</h3>

            {alreadyTransferred && (
              <div className="ds-transfer-warning">
                <AlertTriangle size={15} /> За {payPeriodLabel} уже было
                перенесено {transfersForPeriod.length} выплат на сумму{" "}
                {transferredTotal.toLocaleString("ru-RU")} ₽. Повторный перенос
                создаст дополнительные записи.
              </div>
            )}

            <p className="ds-transfer-hint">
              Каждый день из списка будет создан как отдельная выплата с пометкой
              «Табель охраны» в разделе «Учёт → Зарплаты»:
            </p>

            <div className="ds-transfer-scroll">
              <table className="ds-transfer-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Сотрудник</th>
                    <th>День выплаты</th>
                    <th>Сумма, ₽</th>
                    <th>Назначение</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts
                    .filter((r) => r.amount > 0 && r.employeeName.trim())
                    .map((row, idx) => (
                      <tr key={row.id}>
                        <td>{idx + 1}</td>
                        <td className="ds-transfer-emp-name">{row.employeeName}</td>
                        <td className="ds-print-num">{fmtDateWithWeekday(row.date)}</td>
                        <td className="ds-print-num ds-transfer-sum">
                          {row.amount.toLocaleString("ru-RU")} ₽
                        </td>
                        <td className="ds-muted">
                          {row.comment?.trim() || `Выплата от ${fmtDate(row.date)}`}
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Итого к переносу ({validPayoutsCount} выплат)</td>
                    <td className="ds-print-num ds-transfer-total">
                      {payTotal.toLocaleString("ru-RU")} ₽
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {transferError && (
              <div className="ds-transfer-error">{transferError}</div>
            )}

            <div className="ds-modal-actions">
              <button
                className="ds-btn"
                onClick={() => setShowTransfer(false)}
                disabled={transferring}
              >
                Отмена
              </button>
              <button
                className="ds-btn ds-btn--success"
                onClick={handleTransferConfirm}
                disabled={transferring}
              >
                {transferring && <Loader2 size={14} className="animate-spin" />}
                Подтвердить перенос {payTotal.toLocaleString("ru-RU")} ₽
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DutyScheduleAdmin;
