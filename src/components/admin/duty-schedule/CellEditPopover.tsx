// =========================================================
// FILE: src/components/admin/duty-schedule/CellEditPopover.tsx
// Модалка редактирования одной ячейки табеля: сотрудник, часы, статус.
// =========================================================

"use client";

import React, { useState, useEffect } from "react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { Employee, DayAssignment, CellStatus } from "./types";

interface Props {
  date: string;
  weekday: number;
  employees: Employee[];
  current?: DayAssignment;
  /** Если на дату ещё никто не назначен — предзаполнить этим сотрудником */
  preselectId?: string | null;
  onSave: (patch: Partial<DayAssignment>) => void;
  onClear: () => void;
  onClose: () => void;
}

const WEEKDAYS_FULL_RU = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
];

export const CellEditPopover: React.FC<Props> = ({
  date,
  weekday,
  employees,
  current,
  preselectId,
  onSave,
  onClear,
  onClose,
}) => {
  const defaultHours = weekday === 0 || weekday === 6 ? 24 : 15;
  const [employeeId, setEmployeeId] = useState<string>(
    current?.employeeId ?? preselectId ?? ""
  );
  const [hours, setHours] = useState<number>(current?.hours ?? defaultHours);
  const [status, setStatus] = useState<CellStatus>(
    current?.status ?? "normal"
  );

  useEffect(() => {
    setEmployeeId(current?.employeeId ?? preselectId ?? "");
    setHours(current?.hours ?? (weekday === 0 || weekday === 6 ? 24 : 15));
    setStatus(current?.status ?? "normal");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const [y, m, d] = date.split("-");

  return (
    <ModalPortal>
      <div className="ds-modal-overlay" onClick={onClose}>
        <div className="ds-modal" onClick={(e) => e.stopPropagation()}>
          <h3>
            Смена на {d}.{m}.{y} ({WEEKDAYS_FULL_RU[weekday]})
          </h3>

          <label className="ds-field">
            Сотрудник
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">— не назначен —</option>
              {employees
                .filter((e) => e.active)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>

          <label className="ds-field">
            Часов смены
            <input
              type="number"
              min={0}
              max={24}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </label>

          <label className="ds-field">
            Статус
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as CellStatus)}
            >
              <option value="normal">Обычная смена</option>
              <option value="missed">Пропустил смену</option>
              <option value="temporary">Временный охранник</option>
            </select>
          </label>

          <div className="ds-modal-actions">
            <button
              className="ds-btn ds-btn--danger"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              Очистить
            </button>
            <button className="ds-btn" onClick={onClose}>
              Отмена
            </button>
            <button
              className="ds-btn ds-btn--primary"
              onClick={() => {
                onSave({ employeeId: employeeId || null, hours, status });
                onClose();
              }}
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
