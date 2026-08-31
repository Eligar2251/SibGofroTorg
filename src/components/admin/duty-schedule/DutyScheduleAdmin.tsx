// =========================================================
// FILE: src/components/admin/duty-schedule/DutyScheduleAdmin.tsx
// Табель дежурств охраны: генерация на месяц, ручное редактирование,
// печать и перенос начисленной зарплаты в раздел «Зарплаты».
// =========================================================

"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Printer,
  UsersRound,
  CalendarClock,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useDutySchedule } from "./useDutySchedule";
import { ScheduleTable } from "./ScheduleTable";
import { EmployeeManagerModal } from "./EmployeeManagerModal";
import { DutySchedulePrint } from "./DutySchedulePrint";
import { MONTHS_RU, daysInMonth } from "./scheduleGenerator";
import { PayrollPayload, ExistingSalaryTransfer } from "./types";
import "./DutySchedule.css";

interface Props {
  initialYear?: number;
  initialMonth?: number;
  companyPhone?: string;
  companyAddress?: string;
  /** Зарплаты, уже перенесённые из табеля (для защиты от дублей). */
  existingTransfers?: ExistingSalaryTransfer[];
  /**
   * Вызывается при подтверждении «Перенести в зарплату». По умолчанию
   * создаёт записи зарплаты через API админки (по одной на сотрудника).
   */
  onTransferToPayroll?: (payload: PayrollPayload) => Promise<void> | void;
}

/** Ключ месяца YYYY-MM (совпадает с тегом [Период:YYYY-MM] в ЗП). */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Последний день месяца — дата начислений. */
function lastDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(
    daysInMonth(year, month)
  ).padStart(2, "0")}`;
}

/** Стандартная реализация переноса: POST в API зарплат админки. */
async function defaultTransferToPayroll(
  payload: PayrollPayload
): Promise<void> {
  const period = monthKey(payload.year, payload.month);
  const date = lastDayOfMonth(payload.year, payload.month);
  // Сдвиг: часы взяты из календарного месяца, период — месяц зарплаты.
  const calPart =
    payload.calYear && payload.calMonth
      ? ` (календарь: ${MONTHS_RU[payload.calMonth - 1].toLowerCase()} ${payload.calYear})`
      : "";
  for (const item of payload.items) {
    if (item.totalHours <= 0 || item.amount <= 0) continue;
    const res = await fetch("/api/admin/warehouse/salaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeName: item.employeeName,
        amount: item.amount,
        date,
        source: "bank",
        isPaid: false,
        comment: `Табель охраны — дежурства [Период:${period}]${calPart}`,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Не удалось перенести зарплату");
    }
  }
}

export const DutyScheduleAdmin: React.FC<Props> = ({
  initialYear,
  initialMonth,
  companyPhone,
  companyAddress,
  existingTransfers = [],
  onTransferToPayroll,
}) => {
  const router = useRouter();
  const {
    year,
    month,
    calYear,
    calMonth,
    payOffset,
    setPayOffset,
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

  const rotatingEmployees = employees.filter(
    (e) => e.role === "rotating" && e.active
  );

  const period = monthKey(year, month);
  const alreadyTransferred = existingTransfers.some(
    (t) => t.periodMonth === period
  );

  // Подпись о сдвиге: «з/п сентябрь — смены августа».
  const offsetNote =
    payOffset > 0
      ? `смены: ${MONTHS_RU[calMonth - 1].toLowerCase()} ${calYear} (сдвиг ${payOffset} ${payOffset === 1 ? "месяц" : "мес."})`
      : null;

  const handleGenerate = () => {
    const hasData = schedule.some((d) => d.employeeId);
    if (
      hasData &&
      !confirm("Текущее расписание за месяц будет перезаписано. Продолжить?")
    )
      return;
    generate(rotatingStart || undefined);
  };

  const handleTransferConfirm = async () => {
    if (payroll.items.every((i) => i.totalHours <= 0 && i.amount <= 0)) {
      setMessage("Нет начислений за месяц — сначала сгенерируйте расписание");
      setShowTransfer(false);
      return;
    }
    setTransferring(true);
    setTransferError("");
    try {
      const transfer = onTransferToPayroll ?? defaultTransferToPayroll;
      await transfer(payroll);
      setMessage(
        `Зарплата за ${MONTHS_RU[month - 1]} перенесена: ${payroll.totalAmount.toLocaleString(
          "ru-RU"
        )} ₽`
      );
      setShowTransfer(false);
      router.refresh();
    } catch (e) {
      setTransferError(
        e instanceof Error ? e.message : "Ошибка сети при переносе"
      );
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="ds-root">
      <div className="ds-header">
        <div className="ds-header-titles">
          <h2>Табель охраны — дежурства</h2>
          {offsetNote && (
            <div className="ds-header-sub" title="Расчёт со сдвигом: календарь и часы — за предыдущий месяц, зарплата пишется под выбранный период">
              {offsetNote} · зарплата — за {MONTHS_RU[month - 1].toLowerCase()} {year}
            </div>
          )}
        </div>
        <div className="ds-month-nav">
          <button className="ds-btn" onClick={goToPrevMonth}>
            ←
          </button>
          <span className="ds-month-label" title="Период начисления зарплаты (по нему записываются начисления)">
            {MONTHS_RU[month - 1]} {year}
          </span>
          <button className="ds-btn" onClick={goToNextMonth}>
            →
          </button>
        </div>
      </div>

      <div className="ds-toolbar">
        <div className="ds-toolbar-group">
          <label>Сдвиг з/п (календарь → зарплата):</label>
          <select
            value={payOffset}
            onChange={(e) => setPayOffset(Number(e.target.value))}
            title="На сколько месяцев зарплата «опережает» календарь смен: «з/п сентябрь» считается по сменам августа"
          >
            <option value={0}>нет (календарь = зарплата)</option>
            <option value={1}>1 месяц</option>
            <option value={2}>2 месяца</option>
          </select>
        </div>
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
          <button
            className={`ds-btn ${alreadyTransferred ? "" : "ds-btn--success"}`}
            disabled={transferring}
            onClick={() => setShowTransfer(true)}
            title="Начислить зарплату за месяц в разделе «Зарплаты» (только по этой кнопке)"
          >
            <CalendarClock size={14} style={{ verticalAlign: "-2px" }} />{" "}
            {transferring ? "Перенос…" : "Перенести в зарплату"}
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
        {alreadyTransferred ? (
          <span className="ds-legend-transfer ds-legend-transfer--done">
            <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} />{" "}
            {MONTHS_RU[month - 1]} уже перенесён в зарплату
          </span>
        ) : (
          <span className="ds-legend-transfer">
            <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} />{" "}
            {MONTHS_RU[month - 1]} ещё не перенесён в зарплату
          </span>
        )}
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
          calYear={calYear}
          calMonth={calMonth}
          offset={payOffset}
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
        <div className="ds-modal-overlay" onClick={() => !transferring && setShowTransfer(false)}>
          <div className="ds-modal ds-modal--transfer" onClick={(e) => e.stopPropagation()}>
            <h3>
              Перенос в зарплату — {MONTHS_RU[month - 1]} {year}
            </h3>

            {alreadyTransferred && (
              <div className="ds-transfer-warning">
                <AlertTriangle size={14} style={{ verticalAlign: "-2px" }} /> За
                этот месяц зарплата уже переносилась. Повторный перенос создаст
                дубли записей в разделе «Зарплаты».
              </div>
            )}

            <table className="ds-transfer-table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Часов</th>
                  <th>Ставка, ₽/ч</th>
                  <th>Сумма, ₽</th>
                </tr>
              </thead>
              <tbody>
                {payroll.items
                  .filter((i) => i.totalHours > 0 || i.amount > 0)
                  .map((item) => {
                    const overridden = amountOverrides[item.employeeId] != null;
                    return (
                      <tr key={item.employeeId}>
                        <td>{item.employeeName}</td>
                        <td className="ds-print-num">{item.totalHours}</td>
                        <td className="ds-print-num">
                          {item.totalHours > 0
                            ? overridden
                              ? "ручная"
                              : Math.round(item.amount / item.totalHours)
                            : "—"}
                        </td>
                        <td className="ds-print-num">
                          {item.amount.toLocaleString("ru-RU")}
                          {overridden && (
                            <span className="ds-muted"> · ручная</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Общее число зарплаты за месяц</td>
                  <td className="ds-print-num ds-transfer-total">
                    {payroll.totalAmount.toLocaleString("ru-RU")} ₽
                  </td>
                </tr>
              </tfoot>
            </table>

            <p className="ds-transfer-hint">
              Будут созданы записи зарплаты (без оплаты) с пометкой «Табель
              охраны» за {MONTHS_RU[month - 1].toLowerCase()} {year} в разделе
              «Учёт → Зарплаты». Отметить оплату можно там же.
              {payOffset > 0 && (
                <>
                  {" "}Часы — по сменам{" "}
                  <b>
                    {MONTHS_RU[calMonth - 1].toLowerCase()} {calYear}
                  </b>{" "}
                  (расчёт со сдвигом на {payOffset}{" "}
                  {payOffset === 1 ? "месяц" : "мес."}).
                </>
              )}
            </p>

            {transferError && <div className="ds-transfer-error">{transferError}</div>}

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
                {transferring && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Перенести {payroll.totalAmount.toLocaleString("ru-RU")} ₽
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DutyScheduleAdmin;
