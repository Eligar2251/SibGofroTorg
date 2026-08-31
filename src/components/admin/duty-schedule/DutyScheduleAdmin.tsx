// =========================================================
// FILE: src/components/admin/duty-schedule/DutyScheduleAdmin.tsx
// Табель дежурств охраны: генерация на месяц, ручное редактирование,
// печать и блок «Зарплата».
//
// СДВИГ «календарь → зарплата» (рабочая логика): навигация — по
// периоду зарплаты, сетка смен — за (период − сдвиг), сдвиг
// выбирается 0/1/2 месяца. На печатной форме сдвиг не показывается.
//
// ЗАРПЛАТА — отдельная от табеля система: список людей и их
// выплаты (день + сумма) задаются ТОЛЬКО вручную, любое число
// выплат у любого человека (хоть каждый день). Человека можно
// убрать из зп — в табеле дежурств он останется.
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
  CalendarDays,
} from "lucide-react";
import { useDutySchedule } from "./useDutySchedule";
import { ScheduleTable } from "./ScheduleTable";
import { EmployeeManagerModal } from "./EmployeeManagerModal";
import { DutySchedulePrint } from "./DutySchedulePrint";
import { Employee, SalaryPayout } from "./types";
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

/** Человек, участвующий в зарплате за период (сгруппирован по выплатам). */
interface SalaryPerson {
  key: string;
  employeeId: string;
  name: string;
  /** Есть ли человек в справочнике табеля. */
  fromTimesheet: boolean;
  payouts: SalaryPayout[];
  total: number;
}

/** Группирует строки выплат по людям: знакомые из табеля — по id,
 *  введённые вручную — по имени. Возвращает новые объекты без
 *  мутации исходного списка. */
function groupSalaryPeople(
  payouts: SalaryPayout[],
  employees: Employee[]
): SalaryPerson[] {
  const groups = new Map<
    string,
    {
      employeeId: string;
      name: string;
      fromTimesheet: boolean;
      rows: SalaryPayout[];
    }
  >();

  for (const p of payouts) {
    const known =
      p.employeeId && p.employeeId !== "custom"
        ? employees.find((e) => e.id === p.employeeId)
        : undefined;
    const name = p.employeeName.trim() || known?.name || "Сотрудник";
    const key = known ? `id:${known.id}` : `name:${name.toLowerCase()}`;
    const prev = groups.get(key);
    if (prev) {
      groups.set(key, { ...prev, rows: [...prev.rows, p] });
    } else {
      groups.set(key, {
        employeeId: known ? known.id : p.employeeId || "custom",
        name,
        fromTimesheet: !!known,
        rows: [p],
      });
    }
  }

  return Array.from(groups.entries()).map(([key, g]) => ({
    key,
    employeeId: g.employeeId,
    name: g.name,
    fromTimesheet: g.fromTimesheet,
    payouts: g.rows,
    total: g.rows.reduce((s, p) => s + (p.amount || 0), 0),
  }));
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
    calYear,
    calMonth,
    payOffset,
    setPayOffset,
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
    removePayoutsForEmployee,
    splitPayout,
    resetPayoutsFromSchedule,
    message,
    setMessage,
  } = useDutySchedule(initialYear, initialMonth);

  const [showEmployees, setShowEmployees] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [rotatingStart, setRotatingStart] = useState<string>("");
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");

  // ── Сдвиг: навигация — период зарплаты, сетка смен —
  //    календарный месяц (период − сдвиг). ──
  const payPeriodKey = monthKey(year, month);
  const payPeriodLabel = `${MONTHS_RU[month - 1]} ${year}`;
  const calMonthLabel = `${MONTHS_RU[calMonth - 1]} ${calYear}`;
  const calMonthKey = monthKey(calYear, calMonth);
  const offsetNote =
    payOffset > 0
      ? `смены: ${MONTHS_RU[calMonth - 1].toLowerCase()} ${calYear} (сдвиг ${payOffset} ${
          payOffset === 1 ? "месяц" : "мес."
        })`
      : null;

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

  // Список выплат для выбранного зарплатного месяца — только то,
  // что задал пользователь (автоподстановки из табеля нет).
  const payouts = getPayoutsFor(payPeriodKey);
  const payTotal = payouts.reduce((s, r) => s + (r.amount || 0), 0);
  const validPayoutsCount = payouts.filter((p) => p.amount > 0).length;

  // ── Люди в зарплате за период ──
  const salaryPeople = groupSalaryPeople(payouts, employees);

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
      !confirm(
        `Заполнить список выплат по расчёту табеля за ${calMonthLabel}?\n\n` +
          `Это заменит текущие выплаты за ${payPeriodLabel} ` +
          `(по 1 строке на каждого активного охранника, сумма = часы × ставка).`
      )
    ) {
      return;
    }
    resetPayoutsFromSchedule(payPeriodKey, calMonthKey);
  };

  const handleRemovePersonFromSalary = (person: SalaryPerson) => {
    if (
      !confirm(
        `Убрать «${person.name}» из зарплаты за ${payPeriodLabel}?\n\n` +
          `Будут удалены все его выплаты за этот месяц (${person.payouts.length} шт. ` +
          `на ${person.total.toLocaleString("ru-RU")} ₽).\n` +
          `В табеле дежурств человек останется — зарплата и табель независимы.`
      )
    ) {
      return;
    }
    removePayoutsForEmployee(payPeriodKey, person.employeeId, person.name);
    setMessage(`«${person.name}» убран из зарплаты (в табеле остался)`);
  };

  const handleAddPerson = (value: string) => {
    if (!value) return;
    const defDate = lastDayOfMonth(year, month);
    if (value === "custom") {
      addPayout(payPeriodKey, {
        employeeId: "custom",
        employeeName: "",
        date: defDate,
      });
      setMessage("Строка добавлена — введите ФИО, день и сумму выплаты");
    } else {
      addPayoutForEmployee(payPeriodKey, value, undefined, 0, defDate);
      setMessage("Человек добавлен в зарплату — укажите день и сумму выплаты");
    }
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

  const payoutsWord =
    validPayoutsCount === 1
      ? "выплата"
      : validPayoutsCount >= 2 && validPayoutsCount <= 4
        ? "выплаты"
        : "выплат";

  return (
    <div className="ds-root">
      <div className="ds-header">
        <div className="ds-header-titles">
          <h2>Табель охраны — дежурства</h2>
          {offsetNote && (
            <div
              className="ds-header-sub"
              title="Расчёт со сдвигом: календарь и часы — за предыдущий месяц, зарплата пишется под выбранный период. На печатной форме сдвиг не отображается."
            >
              {offsetNote} · зарплата — за {MONTHS_RU[month - 1].toLowerCase()} {year}
            </div>
          )}
        </div>
        <div className="ds-month-nav">
          <button
            className="ds-btn"
            onClick={goToPrevMonth}
            title="Предыдущий месяц (период зарплаты)"
          >
            ←
          </button>
          <span
            className="ds-month-label"
            title="Период зарплаты (по нему переносятся выплаты)"
          >
            {payPeriodLabel}
          </span>
          <button
            className="ds-btn"
            onClick={goToNextMonth}
            title="Следующий месяц (период зарплаты)"
          >
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
            title="На сколько месяцев зарплата «опережает» календарь смен: «з/п сентябрь» считается по сменам августа. Влияет только на рабочую логику, печатная форма остаётся чистой."
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
            title="Печатная форма табеля (только смены и часы)"
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

      {/* Календарь смен: месяц сетки = период − сдвиг */}
      <div className="ds-table-caption">
        Календарь смен: <b>{calMonthLabel}</b>
        {payOffset > 0 && (
          <span className="ds-table-caption-note">
            {" "}
            (зарплата за эти смены — {payPeriodLabel.toLowerCase()})
          </span>
        )}
      </div>

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
          Ставка:{" "}
          {new Set(employees.filter((e) => e.active).map((e) => e.rate)).size === 1
            ? `${employees.find((e) => e.active)?.rate.toLocaleString("ru-RU")} ₽/час`
            : "у каждого своя (в «Сотрудниках»)"}
        </span>
        <span
          className="ds-legend-edit"
          title="Весь график редактируется прямо в ячейках — в том числе перед печатью"
        >
          Клик по ячейке — часы/сотрудник/статус · двойной клик по имени или
          сумме — правка на месте · Enter — сохранить, Esc — отмена
        </span>
      </div>

      {/* ══ ЗАРПЛАТА: отдельная система, дни и суммы задаются вручную ══ */}
      <div className="ds-payroll">
        <div className="ds-payroll-head">
          <div className="ds-payroll-title">
            <CalendarClock size={16} /> Зарплата — {payPeriodLabel}
          </div>

          <div className="ds-payroll-period">
            <span title="Зарплатный месяц. Смены берутся из календаря со сдвигом (см. селектор «Сдвиг з/п»)">
              период: {payPeriodLabel}
              {payOffset > 0 && ` · смены: ${calMonthLabel}`}
            </span>
          </div>

          {alreadyTransferred ? (
            <span
              className="ds-payroll-status ds-payroll-status--done"
              title="Зарплата за этот месяц уже переносилась в раздел «Зарплаты»"
            >
              <CheckCircle2 size={13} /> {payPeriodLabel}: перенесено{" "}
              {transfersForPeriod.length} выплат (
              {transferredTotal.toLocaleString("ru-RU")} ₽)
            </span>
          ) : (
            <span className="ds-payroll-status ds-payroll-status--pending">
              <CalendarDays size={13} /> Не перенесено в раздел зарплат
            </span>
          )}
        </div>

        {/* ── Люди в зарплате ── */}
        <div className="ds-payroll-section-title">
          <span>Кто получает зарплату за этот месяц</span>
        </div>

        <div className="ds-add-person-row">
          <UserPlus size={14} />
          <label>Добавить человека в зп:</label>
          <select value="" onChange={(e) => handleAddPerson(e.target.value)}>
            <option value="">— выбрать —</option>
            <optgroup label="Из табеля охраны">
              {employees
                .filter((e) => e.active)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Другой">
              <option value="custom">— ввести имя вручную —</option>
            </optgroup>
          </select>
          <span className="ds-muted">
            можно добавить любого человека, даже не из табеля
          </span>
        </div>

        {salaryPeople.length === 0 ? (
          <p className="ds-payroll-hint">
            В зарплате за {payPeriodLabel.toLowerCase()} пока никто не указан.
            Добавьте человека кнопкой выше и задайте дни и суммы выплат —
            любое количество выплат (хоть каждый день), у каждого человека
            свои. Табель и зарплата — независимые системы.
          </p>
        ) : (
          <div className="ds-payroll-summary-grid">
            {salaryPeople.map((person) => (
              <div key={person.key} className="ds-summary-card">
                <div className="ds-summary-card-head">
                  <span className="ds-summary-card-name">{person.name}</span>
                  <span
                    className={`ds-summary-badge ${
                      person.fromTimesheet
                        ? "ds-summary-badge--ok"
                        : "ds-summary-badge--custom"
                    }`}
                    title={
                      person.fromTimesheet
                        ? "Есть в справочнике табеля охраны"
                        : "В табеле охраны этого человека нет"
                    }
                  >
                    {person.fromTimesheet ? "из табеля" : "вне табеля"}
                  </span>
                </div>

                <div className="ds-summary-card-body">
                  <div className="ds-summary-card-payout">
                    Выплаты: <b>{person.total.toLocaleString("ru-RU")} ₽</b>
                    <span className="ds-summary-card-count">
                      ({person.payouts.length}{" "}
                      {person.payouts.length === 1
                        ? "день"
                        : person.payouts.length >= 2 && person.payouts.length <= 4
                          ? "дня"
                          : "дней"}
                      )
                    </span>
                  </div>
                </div>

                <div className="ds-summary-card-actions">
                  <button
                    type="button"
                    className="ds-btn ds-btn--xs"
                    onClick={() =>
                      addPayoutForEmployee(
                        payPeriodKey,
                        person.employeeId,
                        person.name,
                        0,
                        lastDayOfMonth(year, month)
                      )
                    }
                    title="Добавить ещё один день выплаты для этого человека"
                  >
                    <Plus size={11} /> Выплата
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn--xs ds-btn--danger"
                    onClick={() => handleRemovePersonFromSalary(person)}
                    title="Убрать человека из зарплаты за этот месяц. В табеле дежурств он останется."
                  >
                    <Trash2 size={11} /> Убрать из зп
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Панель действий таблицы выплат ── */}
        <div className="ds-payroll-toolbar">
          <div className="ds-payroll-toolbar-left">
            <button
              type="button"
              className="ds-btn ds-btn--primary"
              onClick={() =>
                addPayout(payPeriodKey, { date: lastDayOfMonth(year, month) })
              }
              title="Добавить новую строку выплаты"
            >
              <Plus size={14} /> Добавить выплату
            </button>
            <button
              type="button"
              className="ds-btn"
              onClick={handleResetPayouts}
              title="Заполнить по расчёту табеля: по 1 строке на каждого активного охранника (часы × ставка). Текущие выплаты будут заменены."
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
              title="Сгруппировать выплаты по фамилиям"
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
                <th style={{ minWidth: "200px" }}>Человек</th>
                <th
                  style={{ minWidth: "190px" }}
                  title="День, когда человек получает деньги"
                >
                  День выплаты
                </th>
                <th
                  style={{ minWidth: "140px" }}
                  title="Сумма конкретной выплаты в рублях"
                >
                  Сумма, ₽
                </th>
                <th
                  style={{ minWidth: "160px" }}
                  title="Например: Аванс, Выплата 1, Окончательный расчёт"
                >
                  Назначение / Примечание
                </th>
                <th style={{ width: "120px" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="ds-payouts-empty">
                    Выплат за {payPeriodLabel.toLowerCase()} нет. Нажмите{" "}
                    <button
                      type="button"
                      className="ds-link-btn"
                      onClick={handleResetPayouts}
                    >
                      «Заполнить по табелю»
                    </button>{" "}
                    или добавьте человека и укажите дни и суммы сами.
                  </td>
                </tr>
              ) : (
                payouts.map((row, idx) => {
                  const isKnownEmployee = employees.some(
                    (e) => e.id === row.employeeId
                  );
                  const isCustom = row.employeeId === "custom" || !isKnownEmployee;

                  return (
                    <tr key={row.id}>
                      <td className="ds-payout-num">{idx + 1}</td>

                      {/* Человек */}
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
                              const emp = employees.find(
                                (empItem) => empItem.id === val
                              );
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
                            placeholder="ФИО человека"
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
                              row.employeeName,
                              0,
                              row.date
                            )
                          }
                          title="Добавить ещё один день выплаты этому человеку"
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
                  Итого к выплате ({validPayoutsCount} {payoutsWord}):
                </td>
                <td className="ds-payouts-total-sum">
                  {payTotal.toLocaleString("ru-RU")} ₽
                </td>
                <td colSpan={2} className="ds-muted">
                  {payouts.length > 0 &&
                    `${salaryPeople.length} ${
                      salaryPeople.length === 1
                        ? "человек"
                        : salaryPeople.length >= 2 && salaryPeople.length <= 4
                          ? "человека"
                          : "человек"
                    } в зп`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="ds-payroll-hint">
          Зарплата не зависит от табеля: вы сами добавляете людей и указываете
          дни и суммы выплат — любое количество за месяц (хоть каждый день),
          у каждого человека своё. «Убрать из зп» удаляет человека только из
          зарплаты, в табеле дежурств он остаётся. При переносе каждый день
          из списка станет отдельной записью в разделе «Зарплаты» за{" "}
          {payPeriodLabel.toLowerCase()}.
        </p>

        <div className="ds-payroll-actions">
          <button
            className={`ds-btn ds-btn--lg ${alreadyTransferred ? "" : "ds-btn--success"}`}
            disabled={transferring || payTotal <= 0 || validPayoutsCount === 0}
            onClick={() => setShowTransfer(true)}
            title="Создать отдельные записи зарплаты по каждому дню выплаты в разделе «Зарплаты»"
          >
            <CalendarClock size={16} />{" "}
            {transferring
              ? "Перенос…"
              : `Перенести ${validPayoutsCount} ${payoutsWord} в зарплату за ${MONTHS_RU[
                  month - 1
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
          year={calYear}
          month={calMonth}
          employees={employees}
          schedule={schedule}
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
                    <th>Человек</th>
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
                    <td colSpan={3}>Итого к переносу ({validPayoutsCount} {payoutsWord})</td>
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
