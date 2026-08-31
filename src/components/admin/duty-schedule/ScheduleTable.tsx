// =========================================================
// FILE: src/components/admin/duty-schedule/ScheduleTable.tsx
// Таблица дежурств: строки — сотрудники, столбцы — дни месяца.
//
// Редактирование ПРЯМО В ЯЧЕЙКАХ (как в Excel), весь график
// редактируется в любой момент — в том числе перед печатью:
//   • клик по ячейке дня — мини-форма у ячейки: часы,
//     сотрудник (если день пустой или занят другим), статус;
//   • двойной клик по имени/телефону — правка на месте;
//   • двойной клик по сумме — ручная сумма за месяц
//     (перекрывает «часы × ставку», ↺ — вернуть расчёт).
// Enter — сохранить, Esc — отмена, клик мимо — закрыть.
// =========================================================

"use client";

import React, { useEffect, useRef, useState } from "react";
import { Employee, DayAssignment, CellStatus } from "./types";
import {
  WEEKDAYS_SHORT_RU,
  isWeekend,
  findConsecutiveConflicts,
} from "./scheduleGenerator";

interface Props {
  employees: Employee[];
  schedule: DayAssignment[];
  onCellSave: (date: string, patch: Partial<DayAssignment>) => void;
  onCellClear: (date: string) => void;
  onUpdateEmployee: (id: string, patch: Partial<Employee>) => void;
  /** Ручные суммы за период: employeeId -> сумма (перекрывает расчёт). */
  amountOverrides: Record<string, number>;
  onAmountOverride: (employeeId: string, value: number | null) => void;
}

type Editing =
  | { kind: "cell"; date: string }
  | { kind: "name"; empId: string }
  | { kind: "phone"; empId: string }
  | { kind: "amount"; empId: string };

const statusClass: Record<CellStatus, string> = {
  // Рабочая смена выделяется жёлтым, чтобы охранники сразу видели свои дни
  normal: "ds-cell--work",
  missed: "ds-cell--missed",
  temporary: "ds-cell--temporary",
};

function defaultHours(weekday: number): number {
  return weekday === 0 || weekday === 6 ? 24 : 15;
}

/** Мини-форма редактирования дня, привязанная к ячейке. */
function CellEditor({
  day,
  rowEmp,
  employees,
  up,
  onSave,
  onClear,
  onClose,
}: {
  day: DayAssignment;
  rowEmp: Employee;
  employees: Employee[];
  /** Отрисовать форму НАД ячейкой (нижние строки таблицы). */
  up?: boolean;
  onSave: (patch: Partial<DayAssignment>) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const needEmployeeSelect = day.employeeId !== rowEmp.id;
  const [employeeId, setEmployeeId] = useState<string>(
    day.employeeId ?? rowEmp.id
  );
  const [hours, setHours] = useState<number>(
    day.hours || defaultHours(day.weekday)
  );
  const [status, setStatus] = useState<CellStatus>(day.status ?? "normal");
  const boxRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  // Клик мимо формы — закрыть.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const active = employees.filter((e) => e.active);

  function save() {
    if (!employeeId) {
      onClear();
      return;
    }
    onSave({
      employeeId,
      hours: Math.max(0, Number(hours) || 0),
      status,
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
      onClose();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      className={`ds-cell-editor${up ? " ds-cell-editor--up" : ""}`}
      ref={boxRef}
      onKeyDown={onKeyDown}
    >
      {needEmployeeSelect && (
        <label className="ds-ce-field">
          <span>Сотрудник</span>
          <select
            ref={firstRef as React.RefObject<HTMLSelectElement>}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">— нет смены —</option>
            {active.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="ds-ce-field">
        <span>Часы</span>
        <input
          ref={
            needEmployeeSelect
              ? undefined
              : (firstRef as React.RefObject<HTMLInputElement>)
          }
          type="number"
          min={0}
          max={48}
          step={0.5}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        />
      </label>
      <label className="ds-ce-field">
        <span>Статус</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as CellStatus)}
          disabled={!employeeId}
        >
          <option value="normal">Обычная</option>
          <option value="missed">Пропустил</option>
          <option value="temporary">Временный</option>
        </select>
      </label>
      <div className="ds-ce-actions">
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--danger"
          onClick={() => {
            onClear();
            onClose();
          }}
          title="Убрать смену на эту дату"
        >
          Очистить
        </button>
        <button
          type="button"
          className="ds-btn ds-btn--sm"
          onClick={onClose}
          title="Esc"
        >
          Отмена
        </button>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--primary"
          onClick={() => {
            save();
            onClose();
          }}
          title="Enter"
        >
          OK
        </button>
      </div>
    </div>
  );
}

/** Поле «как в Excel»: инпут прямо в ячейке. */
function InlineField({
  initial,
  type = "text",
  placeholder,
  onSubmit,
  onClose,
}: {
  initial: string;
  type?: "text" | "number";
  placeholder?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  // Клик мимо — закрыть (без сохранения).
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  function commit() {
    onSubmit(value);
    onClose();
  }

  return (
    <input
      ref={ref}
      type={type}
      className="ds-inline-edit"
      value={value}
      placeholder={placeholder}
      min={type === "number" ? 0 : undefined}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      onBlur={(e) => {
        // Сохранили только если значение изменилось и не пусто.
        const v = e.target.value.trim();
        if (v && v !== initial) {
          onSubmit(v);
        }
        onClose();
      }}
    />
  );
}

export const ScheduleTable: React.FC<Props> = ({
  employees,
  schedule,
  onCellSave,
  onCellClear,
  onUpdateEmployee,
  amountOverrides,
  onAmountOverride,
}) => {
  const [editing, setEditing] = useState<Editing | null>(null);

  const conflicts = findConsecutiveConflicts(schedule);
  const activeEmployees = employees.filter((e) => e.active);

  const totalsByEmployee = activeEmployees.map((emp) => {
    const hours = schedule
      .filter((d) => d.employeeId === emp.id && d.status !== "missed")
      .reduce((s, d) => s + (d.hours || 0), 0);
    const computed = Math.round(hours * emp.rate);
    const overridden = amountOverrides[emp.id];
    return {
      emp,
      hours,
      computed,
      amount: overridden ?? computed,
      overridden: overridden != null,
    };
  });

  const grandTotal = totalsByEmployee.reduce((s, t) => s + t.amount, 0);
  const grandHours = totalsByEmployee.reduce((s, t) => s + t.hours, 0);

  const close = () => setEditing(null);

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
            <th className="ds-sticky-col-right" title="Сумма за месяц. Двойной клик — задать вручную.">
              Сумма, ₽
            </th>
          </tr>
        </thead>
        <tbody>
          {activeEmployees.map((emp, empIdx) => {
            const totals = totalsByEmployee.find(
              (t) => t.emp.id === emp.id
            )!;
            const editingName = editing?.kind === "name" && editing.empId === emp.id;
            const editingPhone = editing?.kind === "phone" && editing.empId === emp.id;
            const editingAmount = editing?.kind === "amount" && editing.empId === emp.id;
            return (
              <tr key={emp.id}>
                <td className="ds-sticky-col ds-employee-cell">
                  {editingName ? (
                    <InlineField
                      initial={emp.name}
                      placeholder="Имя и фамилия"
                      onSubmit={(v) =>
                        onUpdateEmployee(emp.id, { name: v.trim() || emp.name })
                      }
                      onClose={close}
                    />
                  ) : (
                    <div
                      className="ds-employee-name"
                      onDoubleClick={() =>
                        setEditing({ kind: "name", empId: emp.id })
                      }
                      title="Двойной клик — изменить имя"
                    >
                      {emp.name}
                    </div>
                  )}
                  {emp.phone && (
                    <div
                      className="ds-employee-phone"
                      onDoubleClick={() =>
                        setEditing({ kind: "phone", empId: emp.id })
                      }
                      title="Двойной клик — изменить телефон"
                    >
                      {editingPhone ? (
                        <InlineField
                          initial={emp.phone}
                          placeholder="Телефон"
                          onSubmit={(v) =>
                            onUpdateEmployee(emp.id, { phone: v.trim() || undefined })
                          }
                          onClose={close}
                        />
                      ) : (
                        emp.phone
                      )}
                    </div>
                  )}
                </td>
                {schedule.map((day) => {
                  const mine = day.employeeId === emp.id;
                  const isEditing =
                    editing?.kind === "cell" && editing.date === day.date;
                  const cls = [
                    "ds-cell",
                    isWeekend(day.weekday) ? "ds-cell--weekend" : "",
                    mine ? statusClass[day.status] : "",
                    conflicts.has(day.date) && mine ? "ds-cell--conflict" : "",
                    isEditing ? "ds-cell--editing" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td
                      key={day.date}
                      className={cls}
                      onClick={() => {
                        if (!isEditing) setEditing({ kind: "cell", date: day.date });
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      title={
                        isEditing
                          ? ""
                          : mine
                            ? `${day.date}: ${day.hours} ч. — клик, чтобы изменить`
                            : "Клик — назначить смену"
                      }
                    >
                      {isEditing ? (
                        <CellEditor
                          day={day}
                          rowEmp={emp}
                          employees={employees}
                          up={empIdx > 0}
                          onSave={(patch) => onCellSave(day.date, patch)}
                          onClear={() => onCellClear(day.date)}
                          onClose={close}
                        />
                      ) : mine ? (
                        day.hours
                      ) : (
                        ""
                      )}
                    </td>
                  );
                })}
                <td className="ds-sticky-col-right ds-total-cell">
                  {totals.hours}
                </td>
                <td
                  className={`ds-sticky-col-right ds-total-cell ds-amount-cell${
                    totals.overridden ? " ds-amount-cell--override" : ""
                  }`}
                  onDoubleClick={() =>
                    setEditing({ kind: "amount", empId: emp.id })
                  }
                  title="Двойной клик — задать сумму вручную"
                >
                  {editingAmount ? (
                    <InlineField
                      initial={String(totals.amount)}
                      type="number"
                      placeholder="Сумма, ₽"
                      onSubmit={(v) => {
                        const n = Math.round(Number(v));
                        if (Number.isNaN(n) || n <= 0) onAmountOverride(emp.id, null);
                        else onAmountOverride(emp.id, n);
                      }}
                      onClose={close}
                    />
                  ) : (
                    <span className="ds-amount-value">
                      {totals.amount.toLocaleString("ru-RU")}
                      {totals.overridden && (
                        <button
                          type="button"
                          className="ds-amount-reset"
                          title="Восстановить расчёт «часы × ставка»"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAmountOverride(emp.id, null);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          ↺
                        </button>
                      )}
                    </span>
                  )}
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
