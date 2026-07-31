// =========================================================
// FILE: src/components/admin/duty-schedule/EmployeeManagerModal.tsx
// Управление сотрудниками охраны: добавление/удаление/редактирование,
// роль (по очереди / фиксированный), закреплённые дни недели.
// =========================================================

"use client";

import React, { useState } from "react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { Employee, FixedRule } from "./types";

interface Props {
  employees: Employee[];
  onAdd: (e: Omit<Employee, "id">) => void;
  onUpdate: (id: string, patch: Partial<Employee>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export const EmployeeManagerModal: React.FC<Props> = ({
  employees,
  onAdd,
  onUpdate,
  onRemove,
  onClose,
}) => {
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRate, setNewRate] = useState(115);
  const [newRole, setNewRole] = useState<"fixed" | "rotating">("rotating");

  const handleAdd = () => {
    if (!newName.trim()) return;
    onAdd({
      name: newName.trim(),
      phone: newPhone,
      rate: newRate,
      role: newRole,
      active: true,
      fixedRules: newRole === "fixed" ? [] : undefined,
    });
    setNewName("");
    setNewPhone("");
    setNewRate(115);
    setNewRole("rotating");
  };

  const toggleFixedRule = (emp: Employee, weekday: number) => {
    const rules = emp.fixedRules ?? [];
    const exists = rules.find((r) => r.weekday === weekday);
    const newRules: FixedRule[] = exists
      ? rules.filter((r) => r.weekday !== weekday)
      : [
          ...rules,
          { weekday, hours: weekday === 0 || weekday === 6 ? 24 : 15 },
        ];
    onUpdate(emp.id, { fixedRules: newRules });
  };

  const changeRuleHours = (emp: Employee, weekday: number, hours: number) => {
    const newRules = (emp.fixedRules ?? []).map((r) =>
      r.weekday === weekday ? { ...r, hours } : r
    );
    onUpdate(emp.id, { fixedRules: newRules });
  };

  return (
    <ModalPortal>
      <div className="ds-modal-overlay" onClick={onClose}>
        <div
          className="ds-modal ds-modal--wide"
          onClick={(e) => e.stopPropagation()}
        >
          <h3>Сотрудники охраны</h3>

          <table className="ds-emp-table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Телефон</th>
                <th>Ставка ₽/ч</th>
                <th>Роль</th>
                <th>Фиксированные дни</th>
                <th>Активен</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <input
                      value={emp.name}
                      onChange={(e) =>
                        onUpdate(emp.id, { name: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={emp.phone ?? ""}
                      onChange={(e) =>
                        onUpdate(emp.id, { phone: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={emp.rate}
                      style={{ width: 70 }}
                      onChange={(e) =>
                        onUpdate(emp.id, { rate: Number(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={emp.role}
                      onChange={(e) =>
                        onUpdate(emp.id, {
                          role: e.target.value as "fixed" | "rotating",
                          fixedRules:
                            e.target.value === "fixed"
                              ? emp.fixedRules ?? []
                              : undefined,
                        })
                      }
                    >
                      <option value="rotating">По очереди</option>
                      <option value="fixed">Фиксированный</option>
                    </select>
                  </td>
                  <td>
                    {emp.role === "fixed" ? (
                      <div className="ds-weekday-picker">
                        {WEEKDAYS.map((w, idx) => {
                          const rule = emp.fixedRules?.find(
                            (r) => r.weekday === idx
                          );
                          return (
                            <div
                              key={idx}
                              className={`ds-weekday-chip${rule ? " active" : ""}`}
                            >
                              <span onClick={() => toggleFixedRule(emp, idx)}>
                                {w}
                              </span>
                              {rule && (
                                <input
                                  type="number"
                                  min={1}
                                  max={24}
                                  value={rule.hours}
                                  onChange={(e) =>
                                    changeRuleHours(
                                      emp,
                                      idx,
                                      Number(e.target.value)
                                    )
                                  }
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="ds-muted">чередуется автоматически</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={emp.active}
                      onChange={(e) =>
                        onUpdate(emp.id, { active: e.target.checked })
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="ds-btn ds-btn--danger"
                      onClick={() => {
                        if (confirm(`Удалить ${emp.name}?`)) onRemove(emp.id);
                      }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Добавить сотрудника</h4>
          <div className="ds-add-employee-row">
            <input
              placeholder="Имя"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              placeholder="Телефон"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
            />
            <input
              type="number"
              placeholder="Ставка"
              value={newRate}
              style={{ width: 80 }}
              onChange={(e) => setNewRate(Number(e.target.value))}
            />
            <select
              value={newRole}
              onChange={(e) =>
                setNewRole(e.target.value as "fixed" | "rotating")
              }
            >
              <option value="rotating">По очереди</option>
              <option value="fixed">Фиксированный</option>
            </select>
            <button className="ds-btn ds-btn--primary" onClick={handleAdd}>
              Добавить
            </button>
          </div>

          <div className="ds-modal-actions">
            <button className="ds-btn ds-btn--primary" onClick={onClose}>
              Готово
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
