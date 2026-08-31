// =========================================================
// FILE: src/components/admin/duty-schedule/DutyScheduleAdmin.tsx
// Табель дежурств охраны: генерация на месяц, ручное редактирование,
// печать и блок «Зарплата»: день выплаты + сумма по каждому охраннику
// и перенос в раздел «Зарплаты» за выбранный зарплатный месяц.
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
import "./DutySchedule.css";

interface Props {
  initialYear?: number;
  initialMonth?: number;
  companyPhone?: string;
  companyAddress?: string;
  /** Зарплаты, уже перенесённые из табеля (для защиты от дублей). */
  existingTransfers?: { periodMonth: string }[];
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
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Одна запись переноса: фамилия + день выплаты + сумма. */
interface TransferItem {
  employeeId: string;
  employeeName: string;
  /** 'YYYY-MM-DD' — день выплаты (если пользователь не указал —
   *  последний день зарплатного месяца). */
  date: string;
  amount: number;
}

/** Стандартная реализация переноса: POST в API зарплат админки
 *  (по одной записи на охранника, без отметки оплаты). */
async function defaultTransferToPayroll(
  payPeriodKey: string,
  items: TransferItem[]
): Promise<void> {
  for (const item of items) {
    if (item.amount <= 0) continue;
    const res = await fetch("/api/admin/warehouse/salaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeName: item.employeeName,
        amount: item.amount,
        date: item.date,
        source: "bank",
        isPaid: false,
        comment: `Табель охраны — дежурства [Период:${payPeriodKey}]`,
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
    setPayPlan,
    payPlansFor,
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
  const payPlans = payPlansFor(payPeriodKey);
  const payPeriodLabel = `${MONTHS_RU[payMonth - 1]} ${payYear}`;

  const rotatingEmployees = employees.filter(
    (e) => e.role === "rotating" && e.active
  );

  const alreadyTransferred = existingTransfers.some(
    (t) => t.periodMonth === payPeriodKey
  );

  // Итоговые строки блока «Зарплата»: сумма — ручная (для выбранного
  // зарплатного месяца), если не задана, то расчёт по табелю
  // (часы × ставка с учётом ручной суммы за месяц табеля).
  const payRows = payroll.items.map((item) => {
    const plan = payPlans[item.employeeId] ?? {};
    const amount = plan.amount ?? item.amount;
    const date = plan.date || lastDayOfMonth(payYear, payMonth);
    return {
      ...item,
      finalAmount: amount,
      finalDate: date,
      manual: plan.amount != null,
      dateSet: plan.date != null,
    };
  });
  const payTotal = payRows.reduce((s, r) => s + r.finalAmount, 0);

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
    const items: TransferItem[] = payRows
      .filter((r) => r.finalAmount > 0)
      .map((r) => ({
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        date: r.finalDate,
        amount: r.finalAmount,
      }));
    if (items.length === 0) {
      setMessage("Нет сумм для переноса — укажите суммы в блоке «Зарплата»");
      setShowTransfer(false);
      return;
    }
    setTransferring(true);
    setTransferError("");
    try {
      await defaultTransferToPayroll(payPeriodKey, items);
      setMessage(
        `Зарплата за ${payPeriodLabel} перенесена: ${payTotal.toLocaleString(
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
          <button className="ds-btn" onClick={goToPrevMonth}>
            ←
          </button>
          <span className="ds-month-label" title="Месяц табеля (дни дежурств)">
            {MONTHS_RU[month - 1]} {year}
          </span>
          <button className="ds-btn" onClick={goToNextMonth}>
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

      {/* ══ ЗАРПЛАТА: день выплаты + сумма по каждому охраннику ══ */}
      <div className="ds-payroll">
        <div className="ds-payroll-head">
          <div className="ds-payroll-title">
            <CalendarClock size={15} style={{ verticalAlign: "-3px" }} /> Зарплата
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
          </div>
          {alreadyTransferred && (
            <span className="ds-payroll-status ds-payroll-status--done">
              <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} />{" "}
              {payPeriodLabel} уже перенесён в зарплату
            </span>
          )}
        </div>

        <table className="ds-payroll-table">
          <thead>
            <tr>
              <th>Фамилия</th>
              <th title="День, когда охранник получает деньги — укажите сами">
                День выплаты
              </th>
              <th title="Сумма, ₽. По умолчанию — часы табеля × ставка; можно исправить">
                Сумма, ₽
              </th>
            </tr>
          </thead>
          <tbody>
            {payRows.map((row) => (
              <tr key={row.employeeId}>
                <td className="ds-payroll-name">{row.employeeName}</td>
                <td>
                  <input
                    type="date"
                    className="ds-payroll-date"
                    value={row.dateSet ? row.finalDate : ""}
                    placeholder="ДД.ММ.ГГГГ"
                    onChange={(e) =>
                      setPayPlan(payPeriodKey, row.employeeId, {
                        date: e.target.value || null,
                      })
                    }
                  />
                  {!row.dateSet && (
                    <span className="ds-payroll-date-hint">
                      по умолчанию {fmtDate(row.finalDate)}
                    </span>
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    className={`ds-payroll-amount${row.manual ? " ds-payroll-amount--manual" : ""}`}
                    min={0}
                    step={1}
                    value={row.manual ? row.finalAmount : row.amount}
                    placeholder={row.amount.toLocaleString("ru-RU")}
                    title="Пусто — считается по табелю (часы × ставка)"
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") {
                        setPayPlan(payPeriodKey, row.employeeId, { amount: null });
                        return;
                      }
                      const n = Number(v);
                      if (!Number.isNaN(n) && n >= 0) {
                        setPayPlan(payPeriodKey, row.employeeId, { amount: n });
                      }
                    }}
                  />
                  {row.manual && (
                    <button
                      type="button"
                      className="ds-payroll-reset"
                      title="Вернуть расчёт по табелю"
                      onClick={() =>
                        setPayPlan(payPeriodKey, row.employeeId, { amount: null })
                      }
                    >
                      ↺
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Итого к выплате</td>
              <td className="ds-payroll-total">
                {payTotal.toLocaleString("ru-RU")} ₽
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="ds-payroll-hint">
          День выплаты и сумму укажите сами по каждому охраннику. Перенос идёт
          за выбранный зарплатный месяц ({payPeriodLabel.toLowerCase()}) — он
          может отличаться от месяца табеля.
        </p>

        <div className="ds-payroll-actions">
          <button
            className={`ds-btn ${alreadyTransferred ? "" : "ds-btn--success"}`}
            disabled={transferring || payTotal <= 0}
            onClick={() => setShowTransfer(true)}
            title="Создать записи зарплаты по фамилиям в разделе «Зарплаты»"
          >
            <CalendarClock size={14} style={{ verticalAlign: "-2px" }} />{" "}
            {transferring
              ? "Перенос…"
              : `Перенести в зарплату за ${MONTHS_RU[payMonth - 1].toLowerCase()}`}
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
        <div className="ds-modal-overlay" onClick={() => !transferring && setShowTransfer(false)}>
          <div className="ds-modal ds-modal--transfer" onClick={(e) => e.stopPropagation()}>
            <h3>Перенос в зарплату — {payPeriodLabel}</h3>

            {alreadyTransferred && (
              <div className="ds-transfer-warning">
                <AlertTriangle size={14} style={{ verticalAlign: "-2px" }} /> За
                этот зарплатный месяц зарплата уже переносилась. Повторный
                перенос создаст дубли записей в разделе «Зарплаты».
              </div>
            )}

            <table className="ds-transfer-table">
              <thead>
                <tr>
                  <th>Фамилия</th>
                  <th>День выплаты</th>
                  <th>Сумма, ₽</th>
                </tr>
              </thead>
              <tbody>
                {payRows
                  .filter((r) => r.finalAmount > 0)
                  .map((row) => (
                    <tr key={row.employeeId}>
                      <td>{row.employeeName}</td>
                      <td className="ds-print-num">{fmtDate(row.finalDate)}</td>
                      <td className="ds-print-num">
                        {row.finalAmount.toLocaleString("ru-RU")}
                        {row.manual && (
                          <span className="ds-muted"> · ручная</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Итого</td>
                  <td className="ds-print-num ds-transfer-total">
                    {payTotal.toLocaleString("ru-RU")} ₽
                  </td>
                </tr>
              </tfoot>
            </table>

            <p className="ds-transfer-hint">
              Будут созданы записи зарплаты (без оплаты) с пометкой «Табель
              охраны» за {payPeriodLabel.toLowerCase()} в разделе «Учёт →
              Зарплаты». Отметить оплату можно там же.
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
                {transferring && <Loader2 size={14} className="animate-spin" />}
                Перенести {payTotal.toLocaleString("ru-RU")} ₽
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DutyScheduleAdmin;
