// =========================================================
// FILE: src/components/admin/WarehouseSalaries.tsx
// Зарплаты: справочник сотрудников + начисления/выплаты.
// Выплата списывается с выбранного счёта — касса (наличные)
// или банк (безнал) — и уменьшает соответствующий баланс
// (см. getBankSummary в warehouse-shared).
// =========================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  X,
  Loader2,
  CheckCircle,
  Undo2,
  Pencil,
  UsersRound,
  Banknote,
  CreditCard,
} from "lucide-react";
import {
  SearchCombobox,
  type PickerOption,
} from "@/components/admin/SearchPicker";
import { ModalPortal } from "@/components/admin/ModalPortal";
import type { Employee, Salary, SalarySource } from "@/lib/warehouse-shared";

const fmt = (n: number) => n.toLocaleString("ru-RU");

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ─── Форма начисления зарплаты ─────────────────────

function SalaryFormModal({
  employees,
  initial,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  initial: Salary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeName, setEmployeeName] = useState(initial?.employeeName || "");
  const [employeeId, setEmployeeId] = useState<string | null>(
    initial?.employeeId || null
  );
  const [amount, setAmount] = useState(
    initial ? String(initial.amount) : ""
  );
  const [date, setDate] = useState(initial?.date || todayIso());
  const [source, setSource] = useState<SalarySource>(initial?.source || "cash");
  const [comment, setComment] = useState(initial?.comment || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const employeeOptions: PickerOption[] = useMemo(
    () =>
      employees.map((e) => ({
        id: e.id,
        title: e.name,
        meta: [e.position, e.phone].filter(Boolean).join(" · "),
      })),
    [employees]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!employeeName.trim()) {
      setError("Укажите сотрудника");
      return;
    }
    const amountNum = Number(amount);
    if (!amountNum || amountNum <= 0) {
      setError("Укажите сумму зарплаты");
      return;
    }
    setSaving(true);
    try {
      // Если ввели имя существующего сотрудника — переиспользуем его,
      // чтобы не плодить дубликаты; новое имя сохранится как сотрудник.
      const found = employees.find(
        (x) =>
          x.name.trim().toLocaleLowerCase("ru-RU") ===
          employeeName.trim().toLocaleLowerCase("ru-RU")
      );
      const empId = employeeId || (found ? found.id : null);

      const res = await fetch(
        initial
          ? `/api/admin/warehouse/salaries/${initial.id}`
          : "/api/admin/warehouse/salaries",
        {
          method: initial ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: empId,
            employeeName: employeeName.trim(),
            amount: amountNum,
            date,
            source,
            comment: comment.trim() || null,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Не удалось сохранить");
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setError("Ошибка сети");
    }
    setSaving(false);
  }

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" onClick={onClose}>
        <div
          className="admin-modal wh-modal"
          style={{ maxWidth: 460 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">
              {initial ? "Изменить зарплату" : "Начислить зарплату"}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="admin-modal__close"
              aria-label="Закрыть"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="admin-field" style={{ marginBottom: 12 }}>
              <label className="admin-label">Сотрудник *</label>
              <SearchCombobox
                options={employeeOptions}
                value={employeeName}
                onChange={(value, option) => {
                  setEmployeeName(value);
                  setEmployeeId(option ? option.id : null);
                }}
                placeholder="Выберите или впишите нового…"
                emptyText="Нет такого сотрудника — впишите, он сохранится"
              />
            </div>

            <div className="wh-form-grid">
              <div className="admin-field">
                <label className="admin-label">Сумма, ₽ *</label>
                <input
                  type="number"
                  className="admin-input"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Дата</label>
                <input
                  type="date"
                  className="admin-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="admin-field" style={{ marginTop: 12 }}>
              <label className="admin-label">Списать со счёта *</label>
              <div className="wh-direction">
                <button
                  type="button"
                  className={`wh-direction__btn wh-direction__btn--in${
                    source === "cash" ? " wh-direction__btn--active" : ""
                  }`}
                  onClick={() => setSource("cash")}
                >
                  <Banknote size={14} /> Касса (наличные)
                </button>
                <button
                  type="button"
                  className={`wh-direction__btn wh-direction__btn--out${
                    source === "bank" ? " wh-direction__btn--active" : ""
                  }`}
                  onClick={() => setSource("bank")}
                >
                  <CreditCard size={14} /> Банк (безнал)
                </button>
              </div>
            </div>

            <div className="admin-field" style={{ marginTop: 12 }}>
              <label className="admin-label">Комментарий</label>
              <input
                type="text"
                className="admin-input"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: зарплата за июль, аванс"
              />
            </div>

            {error && <div className="wh-form-error">{error}</div>}

            <div className="admin-form-actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={onClose}
                disabled={saving}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={saving}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {initial ? "Сохранить" : "Начислить"}
              </button>
            </div>
            <p className="wh-form-hint">
              Начисление создаётся «к выплате». Когда выдали деньги — нажмите
              «Выплатить», и сумма спишется с выбранного счёта (касса/банк).
            </p>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

// ─── Справочник сотрудников ────────────────────────

function EmployeesModal({
  employees,
  onClose,
  onChanged,
}: {
  employees: Employee[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [phone, setPhone] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function resetForm() {
    setName("");
    setPosition("");
    setPhone("");
    setEditingId(null);
    setError("");
  }

  function startEdit(e: Employee) {
    setEditingId(e.id);
    setName(e.name);
    setPosition(e.position || "");
    setPhone(e.phone || "");
    setError("");
  }

  async function handleSave(ev: React.FormEvent) {
    ev.preventDefault();
    if (!name.trim()) {
      setError("Укажите имя сотрудника");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        editingId
          ? `/api/admin/warehouse/employees/${editingId}`
          : "/api/admin/warehouse/employees",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            position: position.trim() || null,
            phone: phone.trim() || null,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Не удалось сохранить");
        setSaving(false);
        return;
      }
      resetForm();
      onChanged();
    } catch {
      setError("Ошибка сети");
    }
    setSaving(false);
  }

  async function handleDelete(e: Employee) {
    if (!confirm(`Удалить сотрудника «${e.name}»? История зарплат сохранится.`))
      return;
    await fetch(`/api/admin/warehouse/employees/${e.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" onClick={onClose}>
        <div
          className="admin-modal wh-modal"
          style={{ maxWidth: 520 }}
          onClick={(ev) => ev.stopPropagation()}
        >
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">Сотрудники</h3>
            <button
              type="button"
              onClick={onClose}
              className="admin-modal__close"
              aria-label="Закрыть"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSave} style={{ marginBottom: 16 }}>
            <div className="wh-form-grid">
              <div className="admin-field">
                <label className="admin-label">Имя *</label>
                <input
                  className="admin-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ФИО сотрудника"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Должность</label>
                <input
                  className="admin-input"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder="Например: менеджер"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Телефон</label>
                <input
                  className="admin-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7 …"
                />
              </div>
              <div className="admin-field" style={{ justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  className="admin-btn admin-btn--primary"
                  disabled={saving}
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {editingId ? "Сохранить" : <><Plus size={14} /> Добавить</>}
                </button>
              </div>
            </div>
            {editingId && (
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                style={{ marginTop: 8 }}
                onClick={resetForm}
              >
                Отменить редактирование
              </button>
            )}
            {error && <div className="wh-form-error">{error}</div>}
          </form>

          <div className="spicker__list spicker__list--inline" style={{ maxHeight: 320 }}>
            {employees.length === 0 ? (
              <div className="spicker__empty">Сотрудников пока нет</div>
            ) : (
              employees.map((e) => (
                <div
                  key={e.id}
                  className="spicker__opt"
                  style={{ cursor: "default" }}
                >
                  <span className="spicker__opt-text">
                    <span className="spicker__opt-title">{e.name}</span>
                    {(e.position || e.phone) && (
                      <span className="spicker__opt-meta">
                        {[e.position, e.phone].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="admin-btn admin-btn--icon"
                    title="Редактировать"
                    onClick={() => startEdit(e)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--icon admin-btn--danger-ghost"
                    title="Удалить"
                    onClick={() => handleDelete(e)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ─── Основной раздел «Зарплаты» ────────────────────

export function WarehouseSalaries({
  employees: initialEmployees,
  salaries: initialSalaries,
}: {
  employees: Employee[];
  salaries: Salary[];
}) {
  const router = useRouter();
  const [employees, setEmployees] = useState(initialEmployees);
  const [salaries, setSalaries] = useState(initialSalaries);
  const [filter, setFilter] = useState<"all" | "pending" | "paid">("pending");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Salary | null>(null);
  const [empOpen, setEmpOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Синхронизируем локальное состояние после router.refresh()
  useEffect(() => setEmployees(initialEmployees), [initialEmployees]);
  useEffect(() => setSalaries(initialSalaries), [initialSalaries]);

  const pending = salaries.filter((s) => !s.isPaid);
  const paid = salaries.filter((s) => s.isPaid);
  const pendingTotal = pending.reduce((s, x) => s + x.amount, 0);
  const paidCash = paid
    .filter((s) => s.source === "cash")
    .reduce((s, x) => s + x.amount, 0);
  const paidBank = paid
    .filter((s) => s.source === "bank")
    .reduce((s, x) => s + x.amount, 0);

  const filtered = salaries.filter((s) =>
    filter === "all" ? true : filter === "pending" ? !s.isPaid : s.isPaid
  );

  function reload() {
    router.refresh();
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(s: Salary) {
    setEditing(s);
    setFormOpen(true);
  }

  async function togglePaid(s: Salary) {
    setBusyId(s.id);
    try {
      const res = await fetch(`/api/admin/warehouse/salaries/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: !s.isPaid }),
      });
      if (res.ok) {
        setSalaries((prev) =>
          prev.map((x) => (x.id === s.id ? { ...x, isPaid: !s.isPaid } : x))
        );
        reload();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Не удалось изменить статус");
      }
    } catch {
      alert("Ошибка сети");
    }
    setBusyId(null);
  }

  async function handleDelete(s: Salary) {
    if (!confirm(`Удалить начисление для «${s.employeeName}»?`)) return;
    setBusyId(s.id);
    try {
      const res = await fetch(`/api/admin/warehouse/salaries/${s.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSalaries((prev) => prev.filter((x) => x.id !== s.id));
        reload();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Не удалось удалить");
      }
    } catch {
      alert("Ошибка сети");
    }
    setBusyId(null);
  }

  return (
    <div className="bank">
      {/* Сводка */}
      <div className="admin-stat-grid wh-stat-grid">
        <div className="admin-stat">
          <div className="admin-stat__value" style={{ color: "var(--adm-kraft)" }}>
            {fmt(pendingTotal)} ₽
          </div>
          <div className="admin-stat__label">К выплате ({pending.length})</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat__value" style={{ color: "var(--adm-pine)" }}>
            {fmt(paidCash)} ₽
          </div>
          <div className="admin-stat__label">Выплачено наличными</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat__value" style={{ color: "var(--adm-steel)" }}>
            {fmt(paidBank)} ₽
          </div>
          <div className="admin-stat__label">Выплачено безнал</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat__value">{employees.length}</div>
          <div className="admin-stat__label">Сотрудников</div>
        </div>
      </div>

      {/* Панель действий */}
      <div className="bank-toolbar">
        <div className="admin-filters" style={{ marginBottom: 0, flex: 1 }}>
          <button
            className={`admin-filter${filter === "pending" ? " admin-filter--active" : ""}`}
            onClick={() => setFilter("pending")}
          >
            К выплате
          </button>
          <button
            className={`admin-filter${filter === "paid" ? " admin-filter--active" : ""}`}
            onClick={() => setFilter("paid")}
          >
            Выплаченные
          </button>
          <button
            className={`admin-filter${filter === "all" ? " admin-filter--active" : ""}`}
            onClick={() => setFilter("all")}
          >
            Все
          </button>
        </div>
        <button className="admin-btn admin-btn--ghost" onClick={() => setEmpOpen(true)}>
          <UsersRound size={15} /> Сотрудники
        </button>
        <button className="admin-btn admin-btn--primary" onClick={openCreate}>
          <Plus size={15} /> Начислить зарплату
        </button>
      </div>

      {/* Список начислений */}
      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-empty">
            <div className="admin-empty__icon">
              <Banknote size={40} />
            </div>
            <p>Здесь пока пусто</p>
            <p className="admin-empty__hint">
              Начислите зарплату сотруднику — она появится в списке. Выплата
              спишется с кассы или банка.
            </p>
          </div>
        </div>
      ) : (
        <div className="bank-month__list">
          {filtered.map((s) => (
            <div
              key={s.id}
              className={`bank-pay${!s.isPaid ? " bank-pay--pending" : ""}`}
            >
              <div
                className={`bank-pay__icon ${
                  s.source === "cash"
                    ? "bank-pay__icon--in"
                    : "bank-pay__icon--out"
                }`}
              >
                {s.source === "cash" ? <Banknote size={17} /> : <CreditCard size={17} />}
              </div>
              <div className="bank-pay__main">
                <div className="bank-pay__row1">
                  <span className="bank-pay__counterparty">{s.employeeName}</span>
                  <span
                    className={`admin-badge ${
                      s.source === "cash"
                        ? "admin-badge--green"
                        : "admin-badge--blue"
                    }`}
                  >
                    {s.source === "cash" ? "Касса · наличные" : "Банк · безнал"}
                  </span>
                  {!s.isPaid && <span className="bank-pay__wait">к выплате</span>}
                  {s.isPaid && (
                    <span className="admin-badge admin-badge--green">
                      <CheckCircle size={10} /> выплачено
                    </span>
                  )}
                </div>
                <div className="bank-pay__row2">
                  <span className="bank-pay__date">{fmtDate(s.date)}</span>
                  {s.comment && (
                    <span className="bank-pay__comment">{s.comment}</span>
                  )}
                </div>
              </div>
              <div className="bank-pay__side">
                <span className="bank-pay__amount bank-pay__amount--out">
                  −{fmt(s.amount)} ₽
                </span>
                <div className="wh-pay-controls">
                  {!s.isPaid ? (
                    <button
                      type="button"
                      className="admin-status__btn admin-status__btn--primary"
                      disabled={busyId === s.id}
                      onClick={() => togglePaid(s)}
                      title="Выдать деньги и списать со счёта"
                    >
                      {busyId === s.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <CheckCircle size={14} />
                      )}
                      Выплатить
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="admin-status__btn admin-status__btn--outline-red"
                      disabled={busyId === s.id}
                      onClick={() => togglePaid(s)}
                      title="Вернуть в «к выплате»"
                    >
                      {busyId === s.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Undo2 size={14} />
                      )}
                      Вернуть
                    </button>
                  )}
                  <button
                    type="button"
                    className="admin-status__btn admin-status__btn--edit"
                    onClick={() => openEdit(s)}
                  >
                    <Pencil size={14} /> Изменить
                  </button>
                  <button
                    type="button"
                    className="admin-status__btn admin-status__btn--delete"
                    disabled={busyId === s.id}
                    onClick={() => handleDelete(s)}
                  >
                    <Trash2 size={14} /> Удалить
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <SalaryFormModal
          employees={employees}
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            reload();
          }}
        />
      )}

      {empOpen && (
        <EmployeesModal
          employees={employees}
          onClose={() => setEmpOpen(false)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
