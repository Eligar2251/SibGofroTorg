// =========================================================
// FILE: src/components/admin/WarehouseSalaries.tsx
// Зарплаты: справочник сотрудников + начисления/выплаты.
// Выплата списывается с выбранного счёта — касса (наличные)
// или банк (безнал) — и уменьшает соответствующий баланс
// (см. getBankSummary в warehouse-shared).
//
// Сверху — Excel-подобная таблица взаиморасчётов за месяц:
// строки = сотрудники, колонки = все дни месяца, плюс
// «За месяц» (план), «Получено» (факт) и «Остаток».
//  · План на месяц хранится в настройках (ключ salary_plan_*),
//    редактируется кликом по ячейке «За месяц».
//  · Выплаты добавляются кликом по ячейке дня (создают обычную
//    запись salary через существующий API). Неоплаченная запись — это
//    план на конкретную дату и сумму.
//  · Расчётный месяц хранится служебной пометкой [Период:YYYY-MM]:
//    выплата остаётся в таблице июля, но рядом текстом показано «за июнь».
//    Реальная дата выплаты используется для банка/кассы.
//  · Выходные/праздники месяца настраиваются отдельно (ключ
//    salary_calendar_*) и подсвечиваются жёлтым столбцом.
//  · Оплата «с аренды на карту» = запись с source=bank и тегом
//    [Аренда] в комментарии (подсвечивается синим).
// Вся прежняя логика (начисления, «Выплатить/Вернуть», список
// операций, справочник сотрудников) сохранена без изменений.
// =========================================================

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  CalendarDays,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  CalendarCog,
  KeyRound,
  Wallet,
  Hourglass,
  Copy,
  RotateCcw,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import {
  SearchCombobox,
  type PickerOption,
} from "@/components/admin/SearchPicker";
import { ModalPortal } from "@/components/admin/ModalPortal";
import {
  type Employee,
  type Salary,
  type SalarySource,
  composeSalaryComment,
  isDebtSalaryComment,
  isRentSalaryComment,
  isYmCardSalaryComment,
  isSalaryExcludedFromBalance,
  getSalaryPeriodMonth,
  stripSalaryMetaTags,
} from "@/lib/warehouse-shared";

const fmt = (n: number) => n.toLocaleString("ru-RU");

/** Оплата «с аренды на карту» или с source="bank" (если это не Карта ЮМ): обычная запись bank + тег в комментарии. ЗП с р/с банка не платится, только аренда. */
function isRentSalary(s: Salary): boolean {
  if (isYmCardSalaryComment(s.comment)) return false;
  return isRentSalaryComment(s.comment, s.source) || s.source === "bank";
}

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

function monthKey(raw: string | null | undefined): string {
  return (raw || todayIso()).slice(0, 7);
}

/** Месяц, за который начислена зарплата; не обязательно месяц выплаты. */
function salaryPeriodKey(salary: Salary): string {
  return (
    salary.periodMonth ||
    getSalaryPeriodMonth(salary.comment, salary.date) ||
    monthKey(salary.date)
  );
}

/** Для факта берём дату выплаты, для ожидания — плановую дату. */
function salaryOperationDate(salary: Salary): string {
  return salary.isPaid ? salary.paidAt || salary.date : salary.date;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  const text = date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dayOfMonth(raw: string): number {
  const n = Number(raw.slice(8, 10));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// ─── Новые хелперы Excel-таблицы ──────────────────

const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function daysInMonth(key: string): number {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

function weekdayOf(key: string, day: number): number {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

function weekdayShort(key: string, day: number): string {
  return WEEKDAYS_SHORT[weekdayOf(key, day)] || "";
}

function dayFullTitle(key: string, day: number): string {
  const [year, month] = key.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const text = d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${text}, ${weekdayShort(key, day)}`;
}

/** Сдвиг месяца: "2026-05" + 1 → "2026-06", −1 → "2026-04". */
function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Выходные по умолчанию: субботы и воскресенья месяца. */
function defaultWeekendDays(key: string): number[] {
  const total = daysInMonth(key);
  const days: number[] = [];
  for (let d = 1; d <= total; d++) {
    const wd = weekdayOf(key, d);
    if (wd === 0 || wd === 6) days.push(d);
  }
  return days;
}

function parseDayList(raw: string | undefined, maxDay: number): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= maxDay))]
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

const planSettingKey = (month: string, employeeId: string) =>
  `salary_plan_${month}_${employeeId}`;
/** Ручной долг/доплата: плюс — компания должна сотруднику (остаток с
 *  прошлого месяца и т.п.), минус — сотрудник должен компании (аванс). */
const debtSettingKey = (month: string, employeeId: string) =>
  `salary_debt_${month}_${employeeId}`;
const calendarSettingKey = (month: string) => `salary_calendar_${month}`;
const scheduleSettingKey = (month: string, employeeId: string) =>
  `salary_schedule_${month}_${employeeId}`;

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

type QuickSource = "cash" | "bank" | "rent" | "ym_card";

function sourceLabel(s: Salary): string {
  if (isRentSalary(s)) return "Аренда → карта";
  if (s.source === "ym_card" || isYmCardSalaryComment(s.comment)) return "Карта ЮМ";
  return s.source === "cash" ? "Касса · наличные" : "Аренда → карта";
}

function sourceBadgeClass(s: Salary): string {
  if (isRentSalary(s)) return "admin-badge--indigo";
  if (s.source === "ym_card" || isYmCardSalaryComment(s.comment)) return "admin-badge--amber";
  return s.source === "cash" ? "admin-badge--green" : "admin-badge--indigo";
}

function isDebtPaymentSalary(s: Salary): boolean {
  return isDebtSalaryComment(s.comment);
}

// ─── Форма начисления зарплаты ─────────────────────

function SalaryFormModal({
  employees,
  initial,
  defaultPeriodMonth,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  initial: Salary | null;
  defaultPeriodMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeName, setEmployeeName] = useState(initial?.employeeName || "");
  const [employeeId, setEmployeeId] = useState<string | null>(
    initial?.employeeId || null
  );
  const initialRent = Boolean(initial && isRentSalary(initial));
  const [amount, setAmount] = useState(
    initial ? String(initial.amount) : ""
  );
  const [date, setDate] = useState(initial?.date || todayIso());
  const [periodMonth, setPeriodMonth] = useState(
    initial
      ? salaryPeriodKey(initial)
      : defaultPeriodMonth || shiftMonth(monthKey(todayIso()), -1)
  );
  const [source, setSource] = useState<SalarySource>(initial?.source || "cash");
  const [comment, setComment] = useState(stripSalaryMetaTags(initial?.comment));
  const [excludeFromBalance, setExcludeFromBalance] = useState(
    Boolean(initial && isSalaryExcludedFromBalance(initial.comment))
  );
  const [debtPayment, setDebtPayment] = useState(
    Boolean(initial && isDebtPaymentSalary(initial))
  );
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

      // Для р/с банк — это всегда аренда (отдельный счёт). ЗП с р/с не платится.
      const isRentForSubmit = source === "bank" || (source as string) === "rent" ? true : initialRent;
      const isYmCardForSubmit = source === "ym_card" || (initial ? isYmCardSalaryComment(initial.comment) || initial.source === "ym_card" : false);
      const finalSource: SalarySource = source === "cash" ? "cash" : "bank";
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
            source: finalSource,
            periodMonth,
            comment: composeSalaryComment({
              comment,
              rent: isRentForSubmit && !isYmCardForSubmit,
              ymCard: isYmCardForSubmit,
              excludeFromBalance,
              debtPayment,
              periodMonth,
            }),
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
              {initial ? "Изменить зарплату" : "Запланировать зарплату"}
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
                <label className="admin-label">Дата выплаты / план *</label>
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
              <label className="admin-label">Зарплата за месяц *</label>
              <input
                type="month"
                className="admin-input"
                value={periodMonth}
                onChange={(e) => setPeriodMonth(e.target.value)}
                required
              />
              <span className="admin-hint">
                Например: выплата 15 июля останется в июле, а рядом будет текстовая пометка «зарплата за июнь».
              </span>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                style={{ marginTop: 6, justifySelf: "flex-start" }}
                onClick={() => setPeriodMonth(shiftMonth(monthKey(date), -1))}
              >
                <ChevronLeft size={13} /> За предыдущий месяц —{" "}
                {monthLabel(shiftMonth(monthKey(date), -1))}
              </button>
            </div>

            <div className="admin-field" style={{ marginTop: 12 }}>
              <label className="admin-label">Счёт будущей выплаты *</label>
              <div className="wh-direction" style={{ flexWrap: 'wrap' }}>
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
                    source === "ym_card" ? " wh-direction__btn--active" : ""
                  }`}
                  onClick={() => setSource("ym_card")}
                >
                  <CreditCard size={14} /> Карта ЮМ (перевод)
                </button>
                <button
                  type="button"
                  className={`wh-direction__btn wh-direction__btn--out${
                    source === "bank" ? " wh-direction__btn--active" : ""
                  }`}
                  onClick={() => setSource("bank")}
                  title="Аренда — отдельный счёт, не списывает р/с банка. ЗП с р/с не платится, только аренда"
                >
                  <KeyRound size={14} /> Аренда (отд. счёт)
                </button>
              </div>
              <span className="admin-hint" style={{ marginTop: 4, display: 'block' }}>
                ЗП: касса и карта ЮМ. Р/С (банк) — только аренда, не списывает основной р/с, уходит в отдельный счёт аренды. Для внебаланса — отметьте ниже.
              </span>
            </div>

            <div className="admin-field" style={{ marginTop: 12 }}>
              <label className="admin-label">Комментарий</label>
              <input
                type="text"
                className="admin-input"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: аванс, премия, комментарий"
              />
            </div>

            <label className="admin-check" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={excludeFromBalance}
                onChange={(e) => setExcludeFromBalance(e.target.checked)}
              />
              <span>В обход баланса: показать в истории ЗП, но не списывать из банка/кассы</span>
            </label>
            <label className="admin-check" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={debtPayment}
                onChange={(e) => setDebtPayment(e.target.checked)}
              />
              <span>В счёт долга, не считать как зарплату месяца</span>
            </label>

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
                {initial ? "Сохранить" : "Запланировать"}
              </button>
            </div>
            <p className="wh-form-hint">
              План создаётся «к выплате» на указанную дату. Когда выдали деньги — нажмите
              «Выплатить», и сумма спишется с выбранного счёта (касса/банк).
              Если включён режим «в обход баланса», запись останется в истории,
              но не повлияет на текущие остатки банка/кассы.
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

// ─── Быстрая форма выплаты (в popover ячейки дня) ──

function QuickPayForm({
  autoFocus,
  saving,
  onSubmit,
}: {
  autoFocus?: boolean;
  saving: boolean;
  onSubmit: (data: {
    amount: number;
    source: QuickSource;
    paid: boolean;
    excludeFromBalance: boolean;
    debtPayment: boolean;
    comment: string;
  }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<QuickSource>("cash");
  const [paid, setPaid] = useState(true);
  const [excludeFromBalance, setExcludeFromBalance] = useState(false);
  const [debtPayment, setDebtPayment] = useState(false);
  const [comment, setComment] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = Number(amount.replace(",", "."));
    if (!amountNum || amountNum <= 0) return;
    onSubmit({
      amount: amountNum,
      source,
      paid,
      excludeFromBalance,
      debtPayment,
      comment: comment.trim(),
    });
    setAmount("");
    setExcludeFromBalance(false);
    setDebtPayment(false);
    setComment("");
  }

  return (
    <form onSubmit={submit} className="whsal-qform">
      <div className="whsal-qform__row">
        <input
          type="number"
          className="admin-input whsal-qform__amount"
          placeholder="Сумма, ₽"
          min={0}
          step="0.01"
          value={amount}
          autoFocus={autoFocus}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button
          type="submit"
          className="admin-btn admin-btn--primary whsal-qform__submit"
          disabled={saving}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Добавить
        </button>
      </div>
      <div className="whsal-seg" role="group" aria-label="Источник выплаты">
        <button
          type="button"
          className={`whsal-seg__btn${source === "cash" ? " whsal-seg__btn--cash" : ""}`}
          onClick={() => setSource("cash")}
          title="Наличкой из кассы"
        >
          <Banknote size={12} /> Касса
        </button>
        <button
          type="button"
          className={`whsal-seg__btn${source === "ym_card" ? " whsal-seg__btn--bank" : ""}`}
          onClick={() => setSource("ym_card")}
          title="С карты ЮМ (перевод)"
        >
          <CreditCard size={12} /> Карта ЮМ
        </button>
        <button
          type="button"
          className={`whsal-seg__btn${source === "rent" ? " whsal-seg__btn--rent" : ""}`}
          onClick={() => setSource("rent")}
          title="Аренда — отдельный счёт, не списывает р/с"
        >
          <KeyRound size={12} /> Аренда (отд. счёт)
        </button>
      </div>
      <label className="whsal-check">
        <input
          type="checkbox"
          checked={paid}
          onChange={(e) => setPaid(e.target.checked)}
        />
        Выплачено (списать со счёта сразу)
      </label>
      <label className="whsal-check">
        <input
          type="checkbox"
          checked={excludeFromBalance}
          onChange={(e) => setExcludeFromBalance(e.target.checked)}
        />
        В обход баланса (историческая выплата)
      </label>
      <label className="whsal-check">
        <input
          type="checkbox"
          checked={debtPayment}
          onChange={(e) => setDebtPayment(e.target.checked)}
        />
        В счёт долга (не зарплата месяца)
      </label>
      <input
        type="text"
        className="admin-input"
        placeholder="Комментарий (необязательно)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
    </form>
  );
}

// ─── Модалка настройки выходных/праздников месяца ─

function MonthDaysModal({
  month,
  initialDays,
  onClose,
  onSave,
}: {
  month: string;
  initialDays: number[];
  onClose: () => void;
  onSave: (days: number[]) => Promise<void> | void;
}) {
  const total = daysInMonth(month);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initialDays)
  );
  const [saving, setSaving] = useState(false);

  function toggle(day: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave([...selected].sort((a, b) => a - b));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // Пустые клетки-отступы, чтобы сетка начиналась с правильного дня недели
  const firstWeekday = weekdayOf(month, 1); // 0 = Вс
  const offset = (firstWeekday + 6) % 7; // сдвиг для сетки с понедельника

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" onClick={onClose}>
        <div
          className="admin-modal wh-modal"
          style={{ maxWidth: 420 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">
              Выходные и праздники — {monthLabel(month)}
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

          <p className="wh-form-hint" style={{ marginTop: 0 }}>
            Отметьте нерабочие дни — их столбцы зальются жёлтым во всей
            таблице. Субботы и воскресенья отмечены по умолчанию.
          </p>

          <div className="whsal-cal-week">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="whsal-cal-grid">
            {Array.from({ length: offset }).map((_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {Array.from({ length: total }).map((_, i) => {
              const day = i + 1;
              const off = selected.has(day);
              return (
                <button
                  key={day}
                  type="button"
                  className={`whsal-cal-day${off ? " whsal-cal-day--off" : ""}`}
                  onClick={() => toggle(day)}
                  title={dayFullTitle(month, day)}
                >
                  {day}
                  <small>{weekdayShort(month, day)}</small>
                </button>
              );
            })}
          </div>

          <div className="admin-form-actions" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => setSelected(new Set(defaultWeekendDays(month)))}
            >
              <RotateCcw size={14} /> Сброс (сб/вс)
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => setSelected(new Set())}
            >
              Очистить всё
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ─── Модалка установки зарплат (и долгов) на месяц ─

function SalariesSetupModal({
  employees,
  month,
  prevMonth,
  planFor,
  debtFor,
  prevPlanFor,
  onClose,
  onSave,
}: {
  employees: Employee[];
  month: string;
  prevMonth: string;
  planFor: (employeeId: string) => number;
  debtFor: (employeeId: string) => number;
  prevPlanFor: (employeeId: string) => number;
  onClose: () => void;
  onSave: (entries: { employeeId: string; plan: number | null; debt: number | null }[]) => Promise<boolean>;
}) {
  const [plans, setPlans] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const e of employees) {
      const p = planFor(e.id);
      init[e.id] = p ? String(p) : "";
    }
    return init;
  });
  const [debts, setDebts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const e of employees) {
      const d = debtFor(e.id);
      init[e.id] = d ? String(d) : "";
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const prevShort = monthLabel(prevMonth).split(" ")[0].toLowerCase();

  function parseNum(raw: string | undefined): number | null {
    const v = (raw ?? "").trim().replace(",", ".");
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function copyAllFromPrev() {
    setPlans((prev) => {
      const next = { ...prev };
      for (const e of employees) {
        const p = prevPlanFor(e.id);
        if (p > 0) next[e.id] = String(p);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const entries = employees.map((e) => ({
        employeeId: e.id,
        plan: parseNum(plans[e.id]),
        debt: parseNum(debts[e.id]),
      }));
      const ok = await onSave(entries);
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" onClick={onClose}>
        <div
          className="admin-modal wh-modal"
          style={{ maxWidth: 640 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">
              Установка зарплат — {monthLabel(month)}
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

          <p className="wh-form-hint" style={{ marginTop: 0 }}>
            Задайте зарплату (план на месяц) и, при необходимости, долг. Долг:
            <strong> плюс</strong> — компания должна сотруднику (остаток с
            прошлого месяца, доплата), <strong>минус</strong> — сотрудник должен
            компании (аванс, удержание). Пустое поле — значение не меняется.
          </p>

          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={copyAllFromPrev}
            >
              <Copy size={13} /> Скопировать зарплаты из {prevShort} всем
            </button>
          </div>

          <div className="whsal-setup">
            <div className="whsal-setup__row whsal-setup__row--head">
              <span className="whsal-setup__name">Сотрудник</span>
              <span className="whsal-setup__inputs">
                <span className="whsal-setup__col">Зарплата, ₽</span>
                <span className="whsal-setup__col">Долг ±, ₽</span>
                <span className="whsal-setup__col whsal-setup__col--btn" />
              </span>
            </div>
            {employees.map((e) => {
              const prevPlan = prevPlanFor(e.id);
              return (
                <div key={e.id} className="whsal-setup__row">
                  <span className="whsal-setup__name">
                    <span className="whsal-avatar">{initialsOf(e.name)}</span>
                    <span className="whsal-name-text">
                      <strong>{e.name}</strong>
                      {e.position && <small>{e.position}</small>}
                    </span>
                  </span>
                  <span className="whsal-setup__inputs">
                    <span className="whsal-setup__col">
                      <input
                        type="number"
                        className="admin-input"
                        placeholder={prevPlan ? `из ${prevShort}: ${fmt(prevPlan)}` : "Например: 50 000"}
                        min={0}
                        step="0.01"
                        value={plans[e.id] ?? ""}
                        onChange={(ev) =>
                          setPlans((prev) => ({ ...prev, [e.id]: ev.target.value }))
                        }
                      />
                    </span>
                    <span className="whsal-setup__col">
                      <input
                        type="number"
                        className="admin-input"
                        placeholder="0"
                        step="0.01"
                        value={debts[e.id] ?? ""}
                        onChange={(ev) =>
                          setDebts((prev) => ({ ...prev, [e.id]: ev.target.value }))
                        }
                        title="Плюс — должны сотруднику, минус — сотрудник должен"
                      />
                    </span>
                    <span className="whsal-setup__col whsal-setup__col--btn">
                      {prevPlan > 0 && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--icon"
                          title={`Поставить зарплату из ${prevShort}: ${fmt(prevPlan)} ₽`}
                          onClick={() =>
                            setPlans((prev) => ({ ...prev, [e.id]: String(prevPlan) }))
                          }
                        >
                          <Copy size={13} />
                        </button>
                      )}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="admin-form-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={onClose}
              disabled={saving}
            >
              Отмена
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Сохранить зарплаты
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ─── Основной раздел «Зарплаты» ────────────────────

type PopoverState =
  | {
      kind: "day";
      employeeId: string;
      day: number;
      rect: { top: number; left: number; bottom: number };
    }
  | {
      kind: "accrued";
      employeeId: string;
      rect: { top: number; left: number; bottom: number };
    }
  | {
      kind: "debt";
      employeeId: string;
      rect: { top: number; left: number; bottom: number };
    }
  | null;

interface GridRow {
  employee: Employee;
  rows: Salary[];
  paidRows: Salary[];
  received: number;
  accruedRecords: number;
  plan: number;
  effectivePlan: number;
  /** Исходный ручной долг/доплата из настроек. */
  manualDebt: number;
  /** Уже выплачено отдельными строками «в счёт долга». */
  debtPaid: number;
  /** Остаток отдельного долга после таких выплат. */
  debtRemaining: number;
  /** Всего к выплате = план месяца + остаток отдельного долга. */
  totalDue: number;
  /** остаток к выплате = всего к выплате − получено */
  rest: number;
  cells: Record<number, Salary[]>;
  scheduledDays: number[];
  scheduledSet: Set<number>;
  scheduledPlanByDay: Record<number, number>;
}

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
  // Таблица всегда относится к месяцу фактического плана/выплаты. Например,
  // в июле показываем июль, а отдельная текстовая пометка сообщает «за июнь».
  const [activeMonth, setActiveMonth] = useState(todayIso().slice(0, 7));
  const [activeEmployee, setActiveEmployee] = useState("all");

  // Новые состояния Excel-инструмента
  const [settingsRaw, setSettingsRaw] = useState<Record<string, string>>({});
  const [popover, setPopover] = useState<PopoverState>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  const [daysModalOpen, setDaysModalOpen] = useState(false);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [accruedValue, setAccruedValue] = useState("");
  const [debtValue, setDebtValue] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const [scheduleStartValue, setScheduleStartValue] = useState("1");
  const [scheduleBusy, setScheduleBusy] = useState(false);
  // Перетаскивание выплаты между ячейками дней (drag & drop).
  const [dragSalary, setDragSalary] = useState<{
    id: string;
    employeeId: string;
    fromDay: number;
  } | null>(null);
  const [dragOverDay, setDragOverDay] = useState<{
    employeeId: string;
    day: number;
  } | null>(null);
  const dragSuppressClickRef = useRef(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  const salaryTableExportRef = useRef<HTMLDivElement | null>(null);

  const monthOptions = useMemo(() => {
    const currentMonth = todayIso().slice(0, 7);
    const keys = new Set<string>(
      salaries.map((salary) => monthKey(salaryOperationDate(salary)))
    );
    keys.add(currentMonth);

    for (const key of Object.keys(settingsRaw)) {
      const match = key.match(/salary_(?:plan|debt|calendar|schedule)_(\d{4}-\d{2})/);
      if (match?.[1]) keys.add(match[1]);
    }

    for (let i = 1; i <= 18; i++) {
      keys.add(shiftMonth(currentMonth, -i));
    }

    return [...keys].sort((a, b) => b.localeCompare(a));
  }, [salaries, settingsRaw]);

  // Синхронизируем локальное состояние после router.refresh()
  useEffect(() => setEmployees(initialEmployees), [initialEmployees]);
  useEffect(() => setSalaries(initialSalaries), [initialSalaries]);

  // Загрузка настроек (планы на месяц + календарь выходных)
  const refreshSettings = () => {
    fetch("/api/admin/settings")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) =>
        setSettingsRaw(
          d && typeof d === "object" && !Array.isArray(d)
            ? (d as Record<string, string>)
            : {}
        )
      )
      .catch(() => {});
  };
  useEffect(refreshSettings, []);

  // Закрытие popover по Escape
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

  // Позиционирование popover рядом с ячейкой (в пределах экрана)
  useEffect(() => {
    if (!popover || !popRef.current) return;
    const el = popRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(el.offsetWidth || 320, vw - 16);
    const h = el.offsetHeight || 360;
    let left = Math.max(8, Math.min(popover.rect.left, vw - w - 8));
    let top = popover.rect.bottom + 6;
    if (top + h > vh - 8) {
      top = Math.max(8, popover.rect.top - h - 6);
    }
    setPopPos({ top, left });
  }, [popover]);

  const monthSalaries = useMemo(
    () =>
      salaries.filter(
        (salary) => monthKey(salaryOperationDate(salary)) === activeMonth
      ),
    [salaries, activeMonth]
  );
  const activeEmployeeName = employees.find((e) => e.id === activeEmployee)?.name || activeEmployee;
  const scopedSalaries = monthSalaries.filter((s) =>
    activeEmployee === "all"
      ? true
      : s.employeeId === activeEmployee || s.employeeName === activeEmployeeName
  );
  const pending = scopedSalaries.filter((s) => !s.isPaid);
  const paid = scopedSalaries.filter((s) => s.isPaid);
  const paidSalary = paid.filter((s) => !isDebtPaymentSalary(s));
  const paidDebt = paid.filter(isDebtPaymentSalary);
  const pendingTotal = pending.reduce((s, x) => s + x.amount, 0);
  const accruedTotal = scopedSalaries
    .filter((s) => !isDebtPaymentSalary(s))
    .reduce((s, x) => s + x.amount, 0);
  // Выплата долга — реальный расход банка/кассы, но не факт зарплаты месяца.
  const paidTotal = paidSalary.reduce((s, x) => s + x.amount, 0);
  const paidDebtTotal = paidDebt.reduce((s, x) => s + x.amount, 0);
  const paidCash = paidSalary
    .filter((s) => s.source === "cash" && !isRentSalary(s) && !isYmCardSalaryComment(s.comment))
    .reduce((s, x) => s + x.amount, 0);
  const paidBank = paidSalary
    .filter((s) => s.source === "bank" && !isRentSalary(s) && !isYmCardSalaryComment(s.comment))
    .reduce((s, x) => s + x.amount, 0);
  const paidRent = paidSalary
    .filter((s) => isRentSalary(s))
    .reduce((s, x) => s + x.amount, 0);
  const paidYm = paidSalary
    .filter((s) => s.source === "ym_card" || isYmCardSalaryComment(s.comment))
    .reduce((s, x) => s + x.amount, 0);

  // ── Excel-таблица: выходные дни месяца ──
  const weekendDays = useMemo(() => {
    const raw = settingsRaw[calendarSettingKey(activeMonth)];
    const parsed = parseDayList(raw, daysInMonth(activeMonth));
    return parsed.length > 0 ? parsed : defaultWeekendDays(activeMonth);
  }, [settingsRaw, activeMonth]);
  const weekendSet = useMemo(() => new Set(weekendDays), [weekendDays]);

  // ── Excel-таблица: строки по сотрудникам ──
  const gridRows: GridRow[] = useMemo(() => {
    return employees
      .map((employee) => {
        const rows = monthSalaries.filter(
          (s) => s.employeeId === employee.id || (!s.employeeId && s.employeeName === employee.name)
        );
        const paidRows = rows.filter((r) => r.isPaid);
        const paidSalaryRows = paidRows.filter((r) => !isDebtPaymentSalary(r));
        const paidDebtRows = paidRows.filter(isDebtPaymentSalary);
        // В «Получено за месяц» входят только обычные выплаты зарплаты.
        const received = paidSalaryRows.reduce((sum, r) => sum + r.amount, 0);
        const debtPaid = paidDebtRows.reduce((sum, r) => sum + r.amount, 0);
        const salaryRows = rows.filter((r) => !isDebtPaymentSalary(r));
        const accruedRecords = salaryRows.reduce((sum, r) => sum + r.amount, 0);
        const planRaw = settingsRaw[planSettingKey(activeMonth, employee.id)];
        const plan = planRaw !== undefined ? Number(planRaw) || 0 : 0;
        const effectivePlan = plan > 0 ? plan : accruedRecords;
        const debtRaw = settingsRaw[debtSettingKey(activeMonth, employee.id)];
        const manualDebt = debtRaw !== undefined ? Number(debtRaw) || 0 : 0;
        // Положительный долг компании сотруднику погашается отдельными
        // выплатами с тегом [Долг]. В зарплату/факт месяца они не попадают.
        const debtRemaining =
          manualDebt > 0 ? Math.max(0, manualDebt - debtPaid) : manualDebt;
        const totalDue = effectivePlan + debtRemaining;
        const scheduledDays = parseDayList(
          settingsRaw[scheduleSettingKey(activeMonth, employee.id)],
          daysInMonth(activeMonth)
        );
        const cells: Record<number, Salary[]> = {};
        // В календаре показываем не только факт, но и запланированные
        // (неоплаченные) выплаты с конкретной суммой и датой.
        for (const r of rows) {
          const d = dayOfMonth(salaryOperationDate(r));
          (cells[d] = cells[d] || []).push(r);
        }
        const rest = totalDue - received;
        const futureScheduledDays = scheduledDays.filter((day) => !(cells[day] && cells[day].length));
        const scheduledPlanByDay: Record<number, number> = {};
        if (futureScheduledDays.length > 0 && rest > 0) {
          const base = Math.floor((rest / futureScheduledDays.length) * 100) / 100;
          let allocated = 0;
          futureScheduledDays.forEach((day, idx) => {
            const amount =
              idx === futureScheduledDays.length - 1
                ? Math.round((rest - allocated) * 100) / 100
                : base;
            scheduledPlanByDay[day] = amount;
            allocated = Math.round((allocated + amount) * 100) / 100;
          });
        }
        return {
          employee,
          rows,
          paidRows,
          received,
          accruedRecords,
          plan,
          effectivePlan,
          manualDebt,
          debtPaid,
          debtRemaining,
          totalDue,
          rest,
          cells,
          scheduledDays,
          scheduledSet: new Set(scheduledDays),
          scheduledPlanByDay,
        };
      })
      .filter(
        (row) =>
          row.rows.length > 0 ||
          row.plan > 0 ||
          row.manualDebt !== 0 ||
          row.scheduledDays.length > 0 ||
          activeEmployee === row.employee.id
      )
      .filter((row) => activeEmployee === "all" || row.employee.id === activeEmployee);
  }, [employees, monthSalaries, settingsRaw, activeMonth, activeEmployee]);

  const totalPlan = gridRows.reduce((s, r) => s + r.effectivePlan, 0);
  const totalManualDebt = gridRows.reduce((s, r) => s + r.debtRemaining, 0);
  const totalDebtPaid = gridRows.reduce((s, r) => s + r.debtPaid, 0);
  const totalReceived = gridRows.reduce((s, r) => s + r.received, 0);
  const totalRest = totalPlan + totalManualDebt - totalReceived;
  const restCount = gridRows.filter((r) => r.rest > 0).length;
  const periodDayCount = daysInMonth(activeMonth);
  // Если зарплату за короткий месяц запланировали/выплатили, например,
  // 31-го числа следующего месяца, не теряем её из таблицы.
  const paymentMaxDay = monthSalaries.reduce(
    (max, salary) => Math.max(max, dayOfMonth(salaryOperationDate(salary))),
    0
  );
  const dayCount = Math.max(periodDayCount, paymentMaxDay);
  const dayTotals = useMemo(() => {
    const totals: Record<number, number> = {};
    for (const row of gridRows) {
      for (const [d, items] of Object.entries(row.cells)) {
        totals[Number(d)] =
          (totals[Number(d)] || 0) +
          items
            .filter((item) => item.isPaid && !isDebtPaymentSalary(item))
            .reduce((s, x) => s + x.amount, 0);
      }
    }
    return totals;
  }, [gridRows]);

  const progressPct =
    totalPlan > 0 ? Math.min(100, Math.round((totalReceived / totalPlan) * 100)) : 0;

  const filtered = scopedSalaries.filter((s) =>
    filter === "all" ? true : filter === "pending" ? !s.isPaid : s.isPaid
  );

  function reload() {
    router.refresh();
  }

  async function createScheduledSalaryPayments() {
    const plans = gridRows.flatMap((row) =>
      Object.entries(row.scheduledPlanByDay)
        .filter(([day]) => !(row.cells[Number(day)] || []).length)
        .map(([day, amount]) => ({ row, day: Number(day), amount }))
    ).filter((item) => item.amount > 0.009);

    if (!plans.length) {
      alert("Нет новых плановых выплат: задайте месячный план и дни выплат для сотрудников.");
      return;
    }
    const total = plans.reduce((sum, item) => sum + item.amount, 0);
    if (!confirm(`Создать ${plans.length} плановых выплат на ${fmt(total)} ₽? Выплаты будут сохранены как непроведённые и останутся в разделе «Зарплаты».`)) return;
    setScheduleBusy(true);
    try {
      for (const item of plans) {
        const date = `${activeMonth}-${String(item.day).padStart(2, "0")}`;
        const res = await fetch("/api/admin/warehouse/salaries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: item.row.employee.id,
            employeeName: item.row.employee.name,
            amount: item.amount,
            date,
            source: "cash",
            isPaid: false,
            comment: composeSalaryComment({ periodMonth: activeMonth }),
          }),
        });
        if (!res.ok) throw new Error(`Не удалось создать выплату для ${item.row.employee.name}`);
      }
      reload();
      alert(`Создано плановых выплат: ${plans.length}.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось создать плановые выплаты");
    } finally {
      setScheduleBusy(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(s: Salary) {
    setEditing(s);
    setFormOpen(true);
    setPopover(null);
  }

  function flashCell(key: string) {
    setFlashKey(key);
    window.setTimeout(
      () => setFlashKey((cur) => (cur === key ? null : cur)),
      900
    );
  }

  async function togglePaid(s: Salary) {
    setBusyId(s.id);
    const nextPaid = !s.isPaid;
    const nextPaidAt = nextPaid ? todayIso() : null;
    try {
      const res = await fetch(`/api/admin/warehouse/salaries/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: nextPaid, paidAt: nextPaidAt }),
      });
      if (res.ok) {
        setSalaries((prev) =>
          prev.map((x) =>
            x.id === s.id
              ? { ...x, isPaid: nextPaid, paidAt: nextPaidAt }
              : x
          )
        );
        flashCell(
          `${s.employeeId || s.employeeName}:${dayOfMonth(nextPaidAt || s.date)}`
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

  async function markSalaryAsPreviousMonth(s: Salary) {
    const previousMonth = shiftMonth(monthKey(salaryOperationDate(s)), -1);
    const nextComment = composeSalaryComment({
      comment: stripSalaryMetaTags(s.comment),
      rent: isRentSalary(s),
      excludeFromBalance: isSalaryExcludedFromBalance(s.comment),
      debtPayment: isDebtPaymentSalary(s),
      periodMonth: previousMonth,
    });
    setBusyId(s.id);
    try {
      const res = await fetch(`/api/admin/warehouse/salaries/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: nextComment }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Не удалось сохранить расчётный месяц зарплаты");
        return;
      }
      setSalaries((prev) =>
        prev.map((item) =>
          item.id === s.id
            ? { ...item, comment: nextComment, periodMonth: previousMonth }
            : item
        )
      );
      // Запись остаётся в месяце выплаты; меняется только текстовая пометка
      // «зарплата за …».
      reload();
    } catch {
      alert("Ошибка сети");
    } finally {
      setBusyId(null);
    }
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

  // Быстрое создание выплаты/начисления из ячейки таблицы
  async function quickCreate(
    employee: Employee,
    day: number,
    data: {
      amount: number;
      source: QuickSource;
      paid: boolean;
      excludeFromBalance: boolean;
      debtPayment: boolean;
      comment: string;
    }
  ) {
    setQuickBusy(true);
    try {
      const date = `${activeMonth}-${String(day).padStart(2, "0")}`;
      const finalComment = composeSalaryComment({
        comment: data.comment,
        rent: data.source === "rent",
        ymCard: data.source === "ym_card",
        excludeFromBalance: data.excludeFromBalance,
        debtPayment: data.debtPayment,
        periodMonth: activeMonth,
      });
      const res = await fetch("/api/admin/warehouse/salaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: employee.id,
          employeeName: employee.name,
          amount: data.amount,
          date,
          source: data.source === "cash" ? "cash" : "bank",
          isPaid: data.paid,
          comment: finalComment,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Не удалось сохранить");
        return;
      }
      const created = await res.json().catch(() => null);
      const newSalary: Salary = {
        id: created?.id || `tmp-${Date.now()}`,
        employeeId: employee.id,
        employeeName: employee.name,
        amount: data.amount,
        date,
        periodMonth: activeMonth,
        source: data.source === "ym_card" ? "ym_card" : data.source === "rent" ? "bank" : data.source,
        isPaid: data.paid,
        paidAt: data.paid ? date : null,
        comment: finalComment,
      };
      setSalaries((prev) => [newSalary, ...prev]);
      flashCell(`${employee.id}:${day}`);
      reload();
    } catch {
      alert("Ошибка сети");
    }
    setQuickBusy(false);
  }

  // ── Перетаскивание выплаты на другой день месяца ──
  // Для запланированной (невыплаченной) выплаты меняется `date`,
  // для уже выплаченной — `paidAt` (дата фактической выплаты).
  // Месяц сохраняется: перетаскивание идёт в пределах текущей таблицы.
  async function moveSalaryToDay(salaryId: string, toDay: number) {
    const salary = salaries.find((s) => s.id === salaryId);
    if (!salary) return;
    const newDate = `${activeMonth}-${String(toDay).padStart(2, "0")}`;
    const isPaid = salary.isPaid;
    // Проведённая выплата живёт по paid_at, плановая — по date.
    const patchBody = isPaid ? { paidAt: newDate } : { date: newDate };
    // Оптимистично двигаем ячейку сразу: перетаскивание должно ощущаться
    // мгновенно, а не «через секунду и обратно».
    const prevSalaries = salaries;
    setSalaries((prev) =>
      prev.map((x) =>
        x.id === salaryId
          ? isPaid
            ? { ...x, paidAt: newDate }
            : { ...x, date: newDate }
          : x
      )
    );
    flashCell(`${salary.employeeId || salary.employeeName}:${toDay}`);
    setBusyId(salaryId);
    try {
      const res = await fetch(`/api/admin/warehouse/salaries/${salaryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSalaries(prevSalaries); // откат
        alert(d.error || "Не удалось перенести выплату");
        return;
      }
      // router.refresh() здесь намеренно НЕ вызываем: страница «Учёт»
      // тяжёлая, и полная перерисовка после каждого перетаскивания давала
      // видимый лаг. Локальное состояние уже верное, а другие вкладки
      // получат изменение через realtime-подписку на таблицу salaries.
    } catch {
      setSalaries(prevSalaries);
      alert("Ошибка сети");
    } finally {
      setBusyId(null);
    }
  }

  // ── Планы на месяц (настройки) ──
  async function savePlan(employeeId: string, value: number) {
    const key = planSettingKey(activeMonth, employeeId);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: String(value) }),
    });
    if (!res.ok) {
      alert("Не удалось сохранить план");
      return false;
    }
    setSettingsRaw((prev) => ({ ...prev, [key]: String(value) }));
    return true;
  }

  function copyPlanFromPrevMonth(employeeId: string, currentPlan: number) {
    const prevKey = planSettingKey(shiftMonth(activeMonth, -1), employeeId);
    const raw = settingsRaw[prevKey];
    const val = raw !== undefined ? Number(raw) || 0 : 0;
    if (!val) {
      alert(`За ${monthLabel(shiftMonth(activeMonth, -1))} план не задан`);
      return;
    }
    if (val === currentPlan) return;
    savePlan(employeeId, val);
  }

  // ── Чтение плана/долга/остатка за произвольный месяц ──
  function planNumFor(month: string, employeeId: string): number {
    const raw = settingsRaw[planSettingKey(month, employeeId)];
    return raw !== undefined ? Number(raw) || 0 : 0;
  }

  function debtNumFor(month: string, employeeId: string): number {
    const raw = settingsRaw[debtSettingKey(month, employeeId)];
    return raw !== undefined ? Number(raw) || 0 : 0;
  }

  /** Остаток к выплате сотруднику за произвольный месяц
   *  (используется для переноса долга с прошлого месяца). */
  function restForMonth(employee: Employee, mkey: string): number {
    const rows = salaries.filter(
      (s) =>
        monthKey(salaryOperationDate(s)) === mkey &&
        (s.employeeId === employee.id ||
          (!s.employeeId && s.employeeName === employee.name))
    );
    const received = rows
      .filter((r) => r.isPaid && !isDebtPaymentSalary(r))
      .reduce((s, r) => s + r.amount, 0);
    const debtPaid = rows
      .filter((r) => r.isPaid && isDebtPaymentSalary(r))
      .reduce((s, r) => s + r.amount, 0);
    const accrued = rows
      .filter((r) => !isDebtPaymentSalary(r))
      .reduce((s, r) => s + r.amount, 0);
    const plan = planNumFor(mkey, employee.id);
    const debt = debtNumFor(mkey, employee.id);
    const debtRemaining = debt > 0 ? Math.max(0, debt - debtPaid) : debt;
    return (plan > 0 ? plan : accrued) + debtRemaining - received;
  }

  async function saveDebt(employeeId: string, value: number): Promise<boolean> {
    const key = debtSettingKey(activeMonth, employeeId);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: String(value) }),
    });
    if (!res.ok) {
      alert("Не удалось сохранить долг");
      return false;
    }
    setSettingsRaw((prev) => ({ ...prev, [key]: String(value) }));
    return true;
  }

  /** Сохранение планов и долгов из модалки «Установка зарплат» (одним запросом). */
  async function saveSetupEntries(
    entries: { employeeId: string; plan: number | null; debt: number | null }[]
  ): Promise<boolean> {
    const payload: Record<string, string> = {};
    for (const en of entries) {
      if (en.plan !== null && en.plan >= 0) {
        payload[planSettingKey(activeMonth, en.employeeId)] = String(en.plan);
      }
      if (en.debt !== null) {
        payload[debtSettingKey(activeMonth, en.employeeId)] = String(en.debt);
      }
    }
    if (!Object.keys(payload).length) return true;
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      alert("Не удалось сохранить зарплаты");
      return false;
    }
    setSettingsRaw((prev) => ({ ...prev, ...payload }));
    return true;
  }

  function scheduledDaysFor(employeeId: string): number[] {
    return parseDayList(
      settingsRaw[scheduleSettingKey(activeMonth, employeeId)],
      daysInMonth(activeMonth)
    );
  }

  async function saveScheduleDays(employeeId: string, days: number[]): Promise<boolean> {
    const key = scheduleSettingKey(activeMonth, employeeId);
    const value = JSON.stringify(days.sort((a, b) => a - b));
    setScheduleBusy(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        alert("Не удалось сохранить план выплат");
        return false;
      }
      setSettingsRaw((prev) => ({ ...prev, [key]: value }));
      return true;
    } finally {
      setScheduleBusy(false);
    }
  }

  async function toggleScheduledDay(employeeId: string, day: number): Promise<void> {
    const current = new Set(scheduledDaysFor(employeeId));
    if (current.has(day)) current.delete(day);
    else current.add(day);
    await saveScheduleDays(employeeId, [...current]);
  }

  async function distributeWeeklySchedule(employeeId: string, startDay: number): Promise<void> {
    const lastDay = daysInMonth(activeMonth);
    const days: number[] = [];
    for (let day = startDay; day <= lastDay; day += 7) {
      days.push(day);
    }
    const ok = await saveScheduleDays(employeeId, days);
    if (ok) {
      flashCell(`${employeeId}:schedule`);
    }
  }

  async function saveWeekends(days: number[]) {
    const key = calendarSettingKey(activeMonth);
    const value = JSON.stringify(days);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (!res.ok) {
      alert("Не удалось сохранить календарь");
      return;
    }
    setSettingsRaw((prev) => ({ ...prev, [key]: value }));
  }

  // ── Открытие popover ──
  function openDayPopover(employee: Employee, day: number, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setAccruedValue("");
    setPopPos(null);
    setPopover({
      kind: "day",
      employeeId: employee.id,
      day,
      rect: { top: r.top, left: r.left, bottom: r.bottom },
    });
  }

  function openAccruedPopover(row: GridRow, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setAccruedValue(row.effectivePlan ? String(row.effectivePlan) : "");
    setScheduleStartValue(String(row.scheduledDays[0] || 1));
    setPopPos(null);
    setPopover({
      kind: "accrued",
      employeeId: row.employee.id,
      rect: { top: r.top, left: r.left, bottom: r.bottom },
    });
  }

  function openDebtPopover(row: GridRow, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setDebtValue(row.manualDebt ? String(row.manualDebt) : "");
    setPopPos(null);
    setPopover({
      kind: "debt",
      employeeId: row.employee.id,
      rect: { top: r.top, left: r.left, bottom: r.bottom },
    });
  }

  // ── Экспорт в Excel (HTML-таблица с заливками, открывается в Excel) ──
  function exportToExcel() {
    const esc = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const ml = monthLabel(activeMonth);
    const th = (t: string, extra = "") =>
      `<th style="background:#ECE9E1;border:1px solid #B7B3A9;padding:5px 7px;font-size:11px;${extra}">${t}</th>`;

    let head = `<tr>${th("ФИО")}${th(`За ${ml}`)}${th("Долг ±")}${th("Получено")}`;
    for (let d = 1; d <= dayCount; d++) head += th(String(d), weekendSet.has(d) ? "background:#FFF3C4;" : "");
    head += `${th("Остаток<br/>к выплате")}</tr>`;
    head += `<tr>${th("")}${th("")}${th("")}${th("")}`;
    for (let d = 1; d <= dayCount; d++)
      head += th(
        d <= periodDayCount ? weekdayShort(activeMonth, d) : "выпл.",
        `font-size:9px;color:#8C8070;${weekendSet.has(d) ? "background:#FFF3C4;" : ""}`
      );
    head += `${th("")}</tr>`;

    const num = (v: number, extra = "") =>
      `<td align="right" style="border:1px solid #D5D2C9;padding:4px 6px;font-size:11px;mso-number-format:'\\#\\ \\#\\#\\#';${extra}">${v}</td>`;

    let body = "";
    for (const row of gridRows) {
      body += `<tr>`;
      body += `<td style="border:1px solid #D5D2C9;padding:4px 8px;font-size:11px;font-weight:bold;background:#FFFFFF;white-space:nowrap;">${esc(row.employee.name)}</td>`;
      body += num(row.effectivePlan, "background:#F7F5F0;font-weight:bold;");
      const debtColor =
        row.debtRemaining > 0 ? "#C8860A" : row.debtRemaining < 0 ? "#1E3A5A" : "#B7B3A9";
      body += `<td align="right" style="border:1px solid #D5D2C9;padding:4px 6px;font-size:11px;font-weight:bold;color:${debtColor};background:#F7F5F0;">${
        row.debtRemaining || ""
      }${row.debtPaid ? ` (погашено ${row.debtPaid})` : ""}</td>`;
      body += num(row.received, "background:#F7F5F0;");
      for (let d = 1; d <= dayCount; d++) {
        const items = row.cells[d] || [];
        const sum = items.reduce((s, x) => s + x.amount, 0);
        const hasPending = items.some((item) => !item.isPaid);
        const rent = items.some((item) => item.isPaid && isRentSalary(item));
        const scheduled = row.scheduledSet.has(d);
        let style = "border:1px solid #D5D2C9;padding:4px 3px;font-size:10px;text-align:center;";
        if (hasPending) style += "background:#FFF5D9;color:#9A6500;font-weight:bold;";
        else if (rent) style += "background:#DCE6F5;color:#1E3A5A;font-weight:bold;";
        else if (items.length) style += "background:#FBE3DC;color:#B83A1E;font-weight:bold;";
        else if (scheduled) style += "background:#E8EEF6;color:#1E3A5A;font-weight:bold;";
        else if (weekendSet.has(d)) style += "background:#FFF3C4;";
        else style += "background:#FFFFFF;";
        body += `<td style="${style}">${sum ? `${fmt(sum)}${hasPending ? " (план)" : ""}` : scheduled ? "П" : ""}</td>`;
      }
      const restColor = row.rest === 0 ? "#1E4A2D" : row.rest < 0 ? "#B83A1E" : "#C8860A";
      body += `<td align="right" style="border:1px solid #D5D2C9;padding:4px 6px;font-size:11px;font-weight:bold;color:${restColor};background:#F7F5F0;">${row.rest}</td>`;
      body += `</tr>`;
    }

    // Разделитель + ИТОГО
    body += `<tr><td colspan="${dayCount + 5}" style="border:none;height:8px;"></td></tr>`;
    body += `<tr>`;
    body += `<td style="border:1px solid #B7B3A9;padding:5px 8px;font-size:11px;font-weight:bold;background:#ECE9E1;">ИТОГО</td>`;
    body += num(totalPlan, "background:#ECE9E1;font-weight:bold;");
    body += `<td align="right" style="border:1px solid #B7B3A9;padding:5px 6px;font-size:11px;font-weight:bold;background:#ECE9E1;">${
      totalManualDebt || ""
    }</td>`;
    body += num(totalReceived, "background:#ECE9E1;font-weight:bold;");
    for (let d = 1; d <= dayCount; d++) {
      const v = dayTotals[d] || 0;
      body += `<td align="right" style="border:1px solid #D5D2C9;padding:4px 3px;font-size:9px;color:#6B6B60;background:#ECE9E1;">${v ? fmt(v) : ""}</td>`;
    }
    body += `<td align="right" style="border:1px solid #B7B3A9;padding:5px 6px;font-size:11px;font-weight:bold;background:#ECE9E1;">${totalRest}</td>`;
    body += `</tr>`;

    const html =
      `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
      `<head><meta charset="utf-8" />` +
      `<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>` +
      `<x:Name>Взаиморасчёты</x:Name>` +
      `<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>` +
      `</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->` +
      `<style>table{border-collapse:collapse;} td,th{mso-style-parent:style0;}</style>` +
      `</head><body>` +
      `<div style="font-family:Arial;font-size:14px;font-weight:bold;margin-bottom:8px;">Таблица взаиморасчётов за ${esc(ml)}</div>` +
      `<table>${head}${body}</table>` +
      `<div style="font-family:Arial;font-size:10px;color:#6B6B60;margin-top:10px;">` +
      `Красный — выплата получена · Жёлтый — выходной/праздник · Синий — аренда / план выплаты · Остаток = За месяц + Долг − Получено</div>` +
      `</body></html>`;

    const blob = new Blob(["\ufeff", html], {
      type: "application/vnd.ms-excel;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Взаиморасчеты_${ml.replace(/\s+/g, "_")}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportTableAsImage() {
    if (!salaryTableExportRef.current || exportingImage) return;
    setExportingImage(true);
    const node = salaryTableExportRef.current;
    try {
      node.classList.add("whsal-export-mode");
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(node, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
        width: node.scrollWidth,
        height: node.scrollHeight,
        windowWidth: node.scrollWidth,
        windowHeight: node.scrollHeight,
      });
      const dataUrl = canvas.toDataURL("image/png");

      const month = monthLabel(activeMonth).replace(/\s+/g, "_");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `Зарплаты_${month}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        try {
          const blob = await (await fetch(dataUrl)).blob();
          await navigator.clipboard.write([
            new ClipboardItem({ [blob.type]: blob }),
          ]);
        } catch {
          // Буфер обмена не критичен: файл уже скачан.
        }
      }
    } catch {
      alert("Не удалось сохранить таблицу как PNG");
    } finally {
      node.classList.remove("whsal-export-mode");
      setExportingImage(false);
    }
  }

  // ── Данные popover ──
  const popRow = popover
    ? gridRows.find((r) => r.employee.id === popover.employeeId) || null
    : null;
  const popItems =
    popover?.kind === "day" && popRow ? popRow.cells[popover.day] || [] : [];

  return (
    <div className="bank">
      {/* ── Верхняя панель ── */}
      <div className="whsal-toolbar">
        <div className="whsal-toolbar__title">
          Зарплаты за {monthLabel(activeMonth)}
        </div>

        <div className="whsal-monthnav">
          <button
            type="button"
            className="whsal-monthnav__btn"
            title="Предыдущий месяц"
            onClick={() => setActiveMonth((m) => shiftMonth(m, -1))}
          >
            <ChevronLeft size={15} />
          </button>
          <select
            className="admin-select"
            value={activeMonth}
            onChange={(e) => setActiveMonth(e.target.value)}
            style={{ minWidth: 150, textAlign: "center" }}
          >
            {[...new Set([...monthOptions, activeMonth])]
              .sort((a, b) => b.localeCompare(a))
              .map((key) => (
                <option key={key} value={key}>
                  {monthLabel(key)}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="whsal-monthnav__btn"
            title="Следующий месяц"
            onClick={() => setActiveMonth((m) => shiftMonth(m, 1))}
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <div className="whsal-monthnav" style={{ marginLeft: 2 }}>
          <span className="admin-badge admin-badge--muted">
            <UserCheck size={12} /> Сотрудник
          </span>
          <select
            className="admin-select"
            value={activeEmployee}
            onChange={(e) => setActiveEmployee(e.target.value)}
            style={{ minWidth: 170 }}
          >
            <option value="all">Все сотрудники</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </div>

        <div className="whsal-toolbar__actions">
          <button
            className="admin-btn admin-btn--ghost"
            onClick={createScheduledSalaryPayments}
            disabled={scheduleBusy}
            title="Создать сохранённые плановые выплаты по месячному плану и отмеченным датам"
          >
            {scheduleBusy ? <Loader2 size={15} className="animate-spin" /> : <CalendarDays size={15} />}
            Создать выплаты по графику
          </button>
          <button
            className="admin-btn admin-btn--ghost"
            onClick={() => setSetupOpen(true)}
            title="Установить зарплаты и долги всем сотрудникам на месяц"
          >
            <SlidersHorizontal size={15} /> Установить зарплаты
          </button>
          <button className="admin-btn admin-btn--ghost" onClick={exportToExcel} title="Скачать таблицу в формате Excel">
            <Download size={15} /> Excel
          </button>
          <button
            className="admin-btn admin-btn--ghost"
            onClick={exportTableAsImage}
            disabled={exportingImage}
            title="Сохранить таблицу как PNG и попробовать скопировать в буфер обмена"
          >
            {exportingImage ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
            PNG
          </button>
          <button
            className="admin-btn admin-btn--ghost"
            onClick={() => setDaysModalOpen(true)}
            title="Выходные и праздничные дни месяца"
          >
            <CalendarCog size={15} /> Настроить дни
          </button>
          <button className="admin-btn admin-btn--ghost" onClick={() => setEmpOpen(true)}>
            <UsersRound size={15} /> Сотрудники
          </button>
          <button className="admin-btn admin-btn--primary" onClick={openCreate}>
            <Plus size={15} /> Запланировать зарплату
          </button>
        </div>
      </div>

      <div className="admin-filters admin-filters--sub" style={{ marginTop: -2, marginBottom: 14 }}>
        {monthOptions.map((key) => (
          <button
            key={key}
            type="button"
            className={`admin-filter${activeMonth === key ? " admin-filter--active" : ""}`}
            onClick={() => setActiveMonth(key)}
            title={`Открыть таблицу за ${monthLabel(key)}`}
          >
            {monthLabel(key)}
          </button>
        ))}
      </div>

      {/* ── Сводные карточки ── */}
      <div className="whsal-cards">
        <div className="whsal-card">
          <div className="whsal-card__top">
            <span className="whsal-card__icon whsal-card__icon--plan">
              <Wallet size={16} />
            </span>
            <span className="whsal-card__label">Начислено за {monthLabel(activeMonth)}</span>
          </div>
          <div className="whsal-card__value" style={{ color: "var(--adm-navy)" }}>
            {fmt(totalPlan)} ₽
          </div>
          <div className="whsal-card__sub">
            по записям: {fmt(accruedTotal)} ₽ · {scopedSalaries.length} шт.
          </div>
        </div>

        <div className="whsal-card">
          <div className="whsal-card__top">
            <span className="whsal-card__icon whsal-card__icon--paid">
              <CheckCircle size={16} />
            </span>
            <span className="whsal-card__label">Выплачено</span>
          </div>
          <div className="whsal-card__value" style={{ color: "var(--adm-pine)" }}>
            {fmt(paidTotal)} ₽
          </div>
          <div className="whsal-progress" title={`${progressPct}% от начисленного`}>
            <div className="whsal-progress__bar" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="whsal-card__sub">
            {progressPct}% от начисленного · касса {fmt(paidCash)}
            {paidYm > 0 ? ` · карта ЮМ ${fmt(paidYm)}` : ""}
            {paidRent > 0 ? ` · аренда (отд. счёт) ${fmt(paidRent)}` : ""}
            {paidDebtTotal > 0 ? ` · в счёт долга ${fmt(paidDebtTotal)} ₽ (не входит в факт месяца)` : ""}
          </div>
        </div>

        <div className="whsal-card whsal-card--accent">
          <div className="whsal-card__top">
            <span className="whsal-card__icon whsal-card__icon--rest">
              <Hourglass size={16} />
            </span>
            <span className="whsal-card__label">Остаток к выплате</span>
          </div>
          <div className="whsal-card__value" style={{ color: "var(--adm-kraft)" }}>
            {fmt(totalRest)} ₽
          </div>
          <div className="whsal-card__sub">
            {totalManualDebt !== 0 && (
              <>остаток отдельного долга {totalManualDebt > 0 ? "+" : ""}{fmt(totalManualDebt)} ₽ · </>
            )}
            {totalDebtPaid > 0 && <>погашено долга {fmt(totalDebtPaid)} ₽ · </>}
            к выплате сейчас: {pending.length} · {fmt(pendingTotal)} ₽
          </div>
        </div>

        <div className="whsal-card">
          <div className="whsal-card__top">
            <span className="whsal-card__icon whsal-card__icon--users">
              <UsersRound size={16} />
            </span>
            <span className="whsal-card__label">Сотрудников в таблице</span>
          </div>
          <div className="whsal-card__value">{gridRows.length}</div>
          <div className="whsal-card__sub">
            в т.ч. {restCount} с остатком к выплате
          </div>
        </div>
      </div>

      {/* ── Excel-таблица взаиморасчётов ── */}
      <div className="admin-card" style={{ marginBottom: 14 }}>
        <div className="admin-card__head">
          <h3 className="admin-card__title">
            Таблица выплат и планов — {monthLabel(activeMonth)}
          </h3>
          <span className="whsal-hint">
            месяц остаётся месяцем выплаты · подпись «за июн» показывает расчётный месяц зарплаты
          </span>
        </div>

        <div style={{ background: "var(--adm-card)" }}>
        <div className="whsal-grid-scroll">
          <div ref={salaryTableExportRef} style={{ width: "max-content", minWidth: "100%", background: "var(--adm-card)" }}>
          <table className="whsal-table">
            <thead>
              <tr>
                <th rowSpan={2} className="whsal-th whsal-th--name">
                  ФИО
                </th>
                <th rowSpan={2} className="whsal-th whsal-th--accrued">
                  За {monthLabel(activeMonth).split(" ")[0]}
                  <span className="whsal-th-sub">план</span>
                </th>
                <th
                  rowSpan={2}
                  className="whsal-th whsal-th--debt"
                  title="Долг/доплата: плюс — компания должна сотруднику, минус — сотрудник должен компании. Клик по ячейке — изменить."
                >
                  Долг
                  <span className="whsal-th-sub">± к плану</span>
                </th>
                <th rowSpan={2} className="whsal-th whsal-th--received">
                  Получено
                  <span className="whsal-th-sub">факт</span>
                </th>
                {Array.from({ length: dayCount }).map((_, i) => {
                  const d = i + 1;
                  return (
                    <th
                      key={d}
                      className={`whsal-th whsal-th--day${
                        weekendSet.has(d) ? " whsal-th--weekend" : ""
                      }`}
                      title={
                        d <= periodDayCount
                          ? dayFullTitle(activeMonth, d)
                          : `${d}-е число выплаты в другом месяце`
                      }
                    >
                      {d}
                    </th>
                  );
                })}
                <th
                  rowSpan={2}
                  className="whsal-th whsal-th--rest"
                  title="Сколько осталось выплатить: «За месяц» + «Долг» − «Получено»"
                >
                  Остаток
                  <span className="whsal-th-sub">к выплате</span>
                </th>
              </tr>
              <tr>
                {Array.from({ length: dayCount }).map((_, i) => {
                  const d = i + 1;
                  return (
                    <th
                      key={d}
                      className={`whsal-th whsal-th--dow${
                        weekendSet.has(d) ? " whsal-th--weekend" : ""
                      }`}
                    >
                      {d <= periodDayCount
                        ? weekdayShort(activeMonth, d).toLowerCase()
                        : "выпл."}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 && (
                <tr>
                  <td colSpan={dayCount + 5} className="whsal-empty">
                    За {monthLabel(activeMonth)} записей нет. Нажмите «Запланировать
                    зарплату» или выберите другой месяц.
                  </td>
                </tr>
              )}
              {gridRows.map((row) => (
                <tr key={row.employee.id} className="whsal-row">
                  <td
                    className="whsal-td whsal-td--name"
                    title={
                      activeEmployee === row.employee.id
                        ? "Показать всех сотрудников"
                        : "Показать только этого сотрудника"
                    }
                    onClick={() =>
                      setActiveEmployee((cur) =>
                        cur === row.employee.id ? "all" : row.employee.id
                      )
                    }
                  >
                    <span className="whsal-avatar">{initialsOf(row.employee.name)}</span>
                    <span className="whsal-name-text">
                      <strong>{row.employee.name}</strong>
                      {row.employee.position && <small>{row.employee.position}</small>}
                    </span>
                  </td>
                  <td
                    className={`whsal-td whsal-td--accrued whsal-clickable${
                      flashKey === `${row.employee.id}:plan` ? " whsal-day--flash" : ""
                    }`}
                    title="Клик — план на месяц и записи сотрудника"
                    onClick={(e) => openAccruedPopover(row, e.currentTarget)}
                  >
                    {fmt(row.effectivePlan)}
                    {row.plan === 0 && row.accruedRecords > 0 && (
                      <span className="whsal-from-records" title="Сумма по записям (план не задан)">
                        из записей
                      </span>
                    )}
                  </td>
                  <td
                    className={`whsal-td whsal-td--debt whsal-clickable${
                      flashKey === `${row.employee.id}:debt` ? " whsal-day--flash" : ""
                    }${
                      row.debtRemaining > 0
                        ? " whsal-debt--pos"
                        : row.debtRemaining < 0
                        ? " whsal-debt--neg"
                        : " whsal-debt--zero"
                    }`}
                    title={
                      row.manualDebt
                        ? `Долг задан: ${fmt(row.manualDebt)} ₽ · погашено отдельными выплатами: ${fmt(row.debtPaid)} ₽ · осталось: ${fmt(row.debtRemaining)} ₽. Клик — изменить`
                        : "Долг/доплата сверх плана. Клик — указать"
                    }
                    onClick={(e) => openDebtPopover(row, e.currentTarget)}
                  >
                    {row.debtRemaining
                      ? `${row.debtRemaining > 0 ? "+" : ""}${fmt(row.debtRemaining)}`
                      : "—"}
                    {row.debtPaid > 0 && (
                      <span className="whsal-from-records">
                        погашено {fmt(row.debtPaid)}
                      </span>
                    )}
                  </td>
                  <td className="whsal-td whsal-td--received">{fmt(row.received)}</td>
                  {Array.from({ length: dayCount }).map((_, i) => {
                    const d = i + 1;
                    const items = row.cells[d] || [];
                    const paidItems = items.filter((item) => item.isPaid);
                    const pendingItems = items.filter((item) => !item.isPaid);
                    const rent = paidItems.some(isRentSalary);
                    const hasPlannedPayment = pendingItems.length > 0;
                    const scheduled = row.scheduledSet.has(d);
                    const cls = [
                      "whsal-td",
                      "whsal-day",
                      weekendSet.has(d) ? "whsal-day--weekend" : "",
                      items.length
                        ? hasPlannedPayment
                          ? "whsal-day--planned"
                          : rent
                            ? "whsal-day--rent"
                            : "whsal-day--paid"
                        : scheduled
                          ? "whsal-day--scheduled"
                          : "",
                      flashKey === `${row.employee.id}:${d}` ? "whsal-day--flash" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    const calendarTitle =
                      d <= periodDayCount
                        ? dayFullTitle(activeMonth, d)
                        : `${d}-е число выплаты (другой месяц)`;
                    const itemDates = items
                      .map(
                        (item) =>
                          `${fmtDate(salaryOperationDate(item))} — ${item.isPaid ? "выплачено" : "запланировано"} ${fmt(item.amount)} ₽`
                      )
                      .join("\n");
                    const title =
                      `${row.employee.name} — ${calendarTitle}` +
                      (items.length
                        ? `\n${itemDates}`
                        : scheduled
                          ? "\nЗапланирована выплата с аренды"
                          : "\nКлик — добавить выплату");
                    const plannedAmount = row.scheduledPlanByDay?.[d] || 0;
                    const visibleItems = items.slice(0, 2);
                    const extraCount = items.length - visibleItems.length;
                    return (
                      <td
                        key={d}
                        className={`${cls}${
                          dragOverDay &&
                          dragOverDay.employeeId === row.employee.id &&
                          dragOverDay.day === d
                            ? " whsal-day--dragover"
                            : ""
                        }`}
                        title={title}
                        onClick={(e) => {
                          if (dragSuppressClickRef.current) {
                            dragSuppressClickRef.current = false;
                            return;
                          }
                          openDayPopover(row.employee, d, e.currentTarget);
                        }}
                        onDragOver={(e) => {
                          if (!dragSalary || dragSalary.employeeId !== row.employee.id)
                            return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverDay({ employeeId: row.employee.id, day: d });
                        }}
                        onDragLeave={(e) => {
                          // Сбрасываем подсветку только если курсор реально ушёл из ячейки
                          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                          setDragOverDay((cur) =>
                            cur && cur.employeeId === row.employee.id && cur.day === d
                              ? null
                              : cur
                          );
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverDay(null);
                          if (!dragSalary || dragSalary.employeeId !== row.employee.id)
                            return;
                          if (dragSalary.fromDay === d) {
                            setDragSalary(null);
                            return;
                          }
                          const id = dragSalary.id;
                          setDragSalary(null);
                          dragSuppressClickRef.current = true;
                          moveSalaryToDay(id, d);
                        }}
                      >
                        <span className="whsal-day-stack">
                          {visibleItems.map((entry) => (
                            <span
                              key={entry.id}
                              draggable
                              className={`whsal-day-line whsal-day-line--draggable${
                                !entry.isPaid
                                  ? " whsal-day-line--planned"
                                  : isRentSalary(entry)
                                    ? " whsal-day-line--rent"
                                    : isDebtPaymentSalary(entry)
                                      ? " whsal-day-line--debt"
                                      : ""
                              }`}
                              title={`${entry.isPaid ? "Выплачено" : "Запланировано"} ${fmtDate(salaryOperationDate(entry))} за ${monthLabel(salaryPeriodKey(entry))}. Перетащите на другой день, чтобы перенести.`}
                              onDragStart={(e) => {
                                e.stopPropagation();
                                e.dataTransfer.setData("text/plain", entry.id);
                                e.dataTransfer.effectAllowed = "move";
                                setDragSalary({
                                  id: entry.id,
                                  employeeId: row.employee.id,
                                  fromDay: d,
                                });
                              }}
                              onDragEnd={() => {
                                setDragSalary(null);
                                setDragOverDay(null);
                              }}
                            >
                              {Math.round(entry.amount) === entry.amount
                                ? String(entry.amount)
                                : String(entry.amount).replace(".", ",")}
                              {(salaryPeriodKey(entry) !==
                                monthKey(salaryOperationDate(entry)) ||
                                !entry.isPaid) && (
                                <small>
                                  {[
                                    salaryPeriodKey(entry) !==
                                    monthKey(salaryOperationDate(entry))
                                      ? `за ${monthLabel(salaryPeriodKey(entry))
                                          .split(" ")[0]
                                          .slice(0, 3)
                                          .toLowerCase()}`
                                      : "",
                                    !entry.isPaid ? "план" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              )}
                            </span>
                          ))}
                          {!items.length && plannedAmount > 0 && (
                            <span className="whsal-day-line whsal-day-line--scheduled">
                              {Math.round(plannedAmount) === plannedAmount
                                ? String(plannedAmount)
                                : String(plannedAmount).replace(".", ",")}
                            </span>
                          )}
                        </span>
                        {hasPlannedPayment ? (
                          <span className="whsal-day-mark">П</span>
                        ) : rent ? (
                          <span className="whsal-day-mark">А</span>
                        ) : !items.length && scheduled ? (
                          <span className="whsal-day-mark">П</span>
                        ) : null}
                        {extraCount > 0 && (
                          <span className="whsal-day-count">+{extraCount}</span>
                        )}
                      </td>
                    );
                  })}
                  <td
                    className={`whsal-td whsal-td--rest ${
                      row.rest === 0
                        ? "whsal-rest--zero"
                        : row.rest < 0
                        ? "whsal-rest--over"
                        : "whsal-rest--debt"
                    }`}
                    title={
                      row.rest < 0
                        ? `Переплата ${fmt(-row.rest)} ₽: выплачено больше, чем начислено`
                        : row.rest === 0
                        ? "Выплачено полностью"
                        : `Осталось выплатить: ${fmt(row.rest)} ₽`
                    }
                  >
                    {fmt(row.rest)}
                    <span className="whsal-rest-sub">
                      {row.rest > 0 ? "к выплате" : row.rest < 0 ? "переплата" : "выплачено"}
                    </span>
                  </td>
                </tr>
              ))}

              {gridRows.length > 0 && (
                <>
                  <tr className="whsal-spacer" aria-hidden="true">
                    <td colSpan={dayCount + 5} />
                  </tr>
                  <tr className="whsal-total-row">
                    <td
                      className="whsal-td whsal-td--name"
                      title="Показать всех сотрудников"
                      onClick={() => setActiveEmployee("all")}
                    >
                      <strong>ИТОГО</strong>
                    </td>
                    <td className="whsal-td whsal-td--accrued">
                      <strong>{fmt(totalPlan)}</strong>
                    </td>
                    <td
                      className={`whsal-td whsal-td--debt${
                        totalManualDebt > 0
                          ? " whsal-debt--pos"
                          : totalManualDebt < 0
                          ? " whsal-debt--neg"
                          : " whsal-debt--zero"
                      }`}
                      style={{ cursor: "default" }}
                    >
                      <strong>
                        {totalManualDebt
                          ? `${totalManualDebt > 0 ? "+" : ""}${fmt(totalManualDebt)}`
                          : "—"}
                      </strong>
                    </td>
                    <td className="whsal-td whsal-td--received">
                      <strong>{fmt(totalReceived)}</strong>
                    </td>
                    {Array.from({ length: dayCount }).map((_, i) => {
                      const d = i + 1;
                      const v = dayTotals[d] || 0;
                      return (
                        <td
                          key={d}
                          className={`whsal-td whsal-day whsal-day--total${
                            weekendSet.has(d) ? " whsal-day--weekend" : ""
                          }`}
                          title={v ? `Выплачено за ${d} число: ${fmt(v)} ₽` : ""}
                        >
                          {v ? <span className="whsal-day-total">{fmt(v)}</span> : ""}
                        </td>
                      );
                    })}
                    <td
                      className={`whsal-td whsal-td--rest ${
                        totalRest === 0
                          ? "whsal-rest--zero"
                          : totalRest < 0
                          ? "whsal-rest--over"
                          : "whsal-rest--debt"
                      }`}
                      title={`Всего осталось выплатить всем: ${fmt(totalRest)} ₽`}
                    >
                      <strong>{fmt(totalRest)}</strong>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Легенда */}
        <div className="whsal-legend">
          <span className="whsal-legend__item">
            <span className="whsal-legend__swatch whsal-legend__swatch--paid" />
            Выплата получена
          </span>
          <span className="whsal-legend__item">
            <span className="whsal-legend__swatch whsal-legend__swatch--planned" />
            Запланировано на дату (деньги ещё не списаны)
          </span>
          <span className="whsal-legend__item">
            <span className="whsal-legend__swatch whsal-legend__swatch--weekend" />
            Выходной / праздник
          </span>
          <span className="whsal-legend__item">
            <span className="whsal-legend__swatch whsal-legend__swatch--rent" />
            Оплачено с аренды на карту
          </span>
          <span className="whsal-legend__item">
            <span className="admin-badge admin-badge--muted">вне баланса</span>
            Историческая выплата — не влияет на банк/кассу
          </span>
          <span className="whsal-legend__item whsal-hint">
            «Остаток» (к выплате) = «За месяц» + «Долг» − «Получено» · зелёный —
            выплачено полностью
          </span>
          <span className="whsal-legend__item whsal-hint">
            «Долг»: + должны сотруднику (остаток с прошлого месяца), − сотрудник
            должен (аванс)
          </span>
          <span className="whsal-legend__item whsal-hint">
            Перетащите сумму выплаты на другой день — день изменится в базе
          </span>
        </div>
        </div>
      </div>

      {/* ── Операции: начисления и выплаты (прежняя логика) ── */}
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
        <span className="whsal-hint" style={{ marginRight: "auto" }}>
          Выплачено за период: <strong>{fmt(paidTotal)} ₽</strong>
        </span>
        <span className="admin-badge admin-badge--muted">
          <CalendarDays size={12} /> {monthLabel(activeMonth)}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-empty">
            <div className="admin-empty__icon">
              <Banknote size={40} />
            </div>
            <p>Здесь пока пусто</p>
            <p className="admin-empty__hint">
              Запланируйте зарплату сотруднику на дату и укажите расчётный месяц.
              При выплате сумма спишется с кассы или банка.
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
                  <span className={`admin-badge ${sourceBadgeClass(s)}`}>
                    {sourceLabel(s)}
                  </span>
                  <span
                    className="admin-badge admin-badge--blue"
                    title={`Расчётный месяц: ${monthLabel(salaryPeriodKey(s))}`}
                  >
                    за {monthLabel(salaryPeriodKey(s)).toLowerCase()}
                  </span>
                  {isDebtPaymentSalary(s) && (
                    <span className="admin-badge admin-badge--amber">долг</span>
                  )}
                  {!s.isPaid && <span className="bank-pay__wait">запланировано</span>}
                  {s.isPaid && (
                    <span className="admin-badge admin-badge--green">
                      <CheckCircle size={10} /> выплачено
                    </span>
                  )}
                  {isSalaryExcludedFromBalance(s.comment) && (
                    <span className="admin-badge admin-badge--muted">
                      вне баланса
                    </span>
                  )}
                </div>
                <div className="bank-pay__row2">
                  <span className="bank-pay__date">
                    {s.isPaid
                      ? `Выплачено ${fmtDate(s.paidAt || s.date)}`
                      : `План на ${fmtDate(s.date)}`}
                  </span>
                  {s.isPaid && s.paidAt && s.paidAt !== s.date && (
                    <span className="bank-pay__comment">
                      плановая дата {fmtDate(s.date)}
                    </span>
                  )}
                  {stripSalaryMetaTags(s.comment) && (
                    <span className="bank-pay__comment">{stripSalaryMetaTags(s.comment)}</span>
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
                  {salaryPeriodKey(s) === monthKey(salaryOperationDate(s)) && (
                    <button
                      type="button"
                      className="admin-status__btn admin-status__btn--outline"
                      disabled={busyId === s.id}
                      onClick={() => markSalaryAsPreviousMonth(s)}
                      title={`Оставить выплату в ${monthLabel(monthKey(salaryOperationDate(s)))}, но пометить как зарплату за ${monthLabel(shiftMonth(monthKey(salaryOperationDate(s)), -1))}`}
                    >
                      <ChevronLeft size={14} /> Пометить: за предыдущий месяц
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

      {/* ── Popover ячейки таблицы ── */}
      {popover &&
        popRow &&
        createPortal(
          <>
            <div className="whsal-pop-overlay" onClick={() => setPopover(null)} />
            <div
              className="whsal-pop"
              ref={popRef}
              style={
                popPos
                  ? { top: popPos.top, left: popPos.left }
                  : { top: -9999, left: -9999 }
              }
            >
              <div className="whsal-pop__head">
                <div>
                  <div className="whsal-pop__title">
                    {popRow.employee.name}
                    {popover.kind === "day" && (
                      <>
                        {" "}
                        — {popover.day} {monthLabel(activeMonth).split(" ")[0].toLowerCase()}
                      </>
                    )}
                  </div>
                  <div className="whsal-pop__sub">
                    {popover.kind === "day"
                      ? dayFullTitle(activeMonth, popover.day) +
                        (weekendSet.has(popover.day) ? " · выходной/праздник" : "")
                      : `План и записи за ${monthLabel(activeMonth)}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--icon"
                  onClick={() => setPopover(null)}
                  aria-label="Закрыть"
                >
                  <X size={14} />
                </button>
              </div>

              {popover.kind === "day" && popItems.length > 0 && (
                <div className="whsal-pop__list">
                  {popItems.map((s) => (
                    <div key={s.id} className="whsal-pop__item">
                      <div className="whsal-pop__item-top">
                        <span className="whsal-pop__amount">{fmt(s.amount)} ₽</span>
                        <span className="admin-badge admin-badge--blue">
                          за {monthLabel(salaryPeriodKey(s)).toLowerCase()}
                        </span>
                        <span className={`admin-badge ${sourceBadgeClass(s)}`}>
                          {sourceLabel(s)}
                        </span>
                        <span className="whsal-pop__date">
                          {s.isPaid
                            ? `выплачено ${fmtDate(s.paidAt || s.date)}`
                            : `план ${fmtDate(s.date)}`}
                        </span>
                        {isDebtPaymentSalary(s) && (
                          <span className="admin-badge admin-badge--amber">долг</span>
                        )}
                        {s.isPaid ? (
                          <span className="admin-badge admin-badge--green">
                            <CheckCircle size={10} /> выплачено
                          </span>
                        ) : (
                          <span className="admin-badge admin-badge--amber">
                            <Hourglass size={10} /> к выплате
                          </span>
                        )}
                        {isSalaryExcludedFromBalance(s.comment) && (
                          <span className="admin-badge admin-badge--muted">вне баланса</span>
                        )}
                        <span className="whsal-pop__actions">
                          <button
                            type="button"
                            className="admin-btn admin-btn--icon"
                            title={s.isPaid ? "Вернуть в «к выплате»" : "Отметить выплаченным"}
                            disabled={busyId === s.id}
                            onClick={() => togglePaid(s)}
                          >
                            {busyId === s.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : s.isPaid ? (
                              <Undo2 size={13} />
                            ) : (
                              <CheckCircle size={13} />
                            )}
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--icon"
                            title="Изменить"
                            onClick={() => openEdit(s)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--icon admin-btn--danger-ghost"
                            title="Удалить"
                            disabled={busyId === s.id}
                            onClick={() => handleDelete(s)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      </div>
                      {stripSalaryMetaTags(s.comment) && (
                        <div className="whsal-pop__comment">{stripSalaryMetaTags(s.comment)}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {popover.kind === "day" && (
                <>
                  {popItems.length > 0 && <div className="whsal-pop__sep" />}
                  <div className="whsal-pop__subtitle">
                    {popItems.length ? "Добавить ещё выплату" : "Записать выплату"}
                  </div>
                  <QuickPayForm
                    autoFocus
                    saving={quickBusy}
                    onSubmit={async (data) => {
                      await quickCreate(popRow.employee, popover.day, data);
                      setPopover(null);
                    }}
                  />
                  <div className="whsal-pop__quick-actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      disabled={scheduleBusy}
                      onClick={async () => {
                        await toggleScheduledDay(popRow.employee.id, popover.day);
                        flashCell(`${popRow.employee.id}:schedule`);
                      }}
                    >
                      {popRow.scheduledSet.has(popover.day) ? "Убрать план аренды" : "Запланировать аренду на этот день"}
                    </button>
                  </div>
                </>
              )}

              {popover.kind === "accrued" && (
                <>
                  <div className="whsal-pop__subtitle">План на месяц, ₽</div>
                  <form
                    className="whsal-qform"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const v = Number(accruedValue.replace(",", "."));
                      if (!Number.isFinite(v) || v < 0) return;
                      const ok = await savePlan(popRow.employee.id, v);
                      if (ok) {
                        flashCell(`${popRow.employee.id}:plan`);
                        setPopover(null);
                      }
                    }}
                  >
                    <div className="whsal-qform__row">
                      <input
                        type="number"
                        className="admin-input whsal-qform__amount"
                        placeholder="Например: 50000"
                        min={0}
                        step="0.01"
                        value={accruedValue}
                        autoFocus
                        onChange={(e) => setAccruedValue(e.target.value)}
                      />
                      <button type="submit" className="admin-btn admin-btn--primary whsal-qform__submit">
                        Сохранить
                      </button>
                    </div>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() =>
                        copyPlanFromPrevMonth(popRow.employee.id, popRow.plan)
                      }
                      title={`Скопировать план из ${monthLabel(shiftMonth(activeMonth, -1))}`}
                    >
                      <Copy size={13} /> Взять из {monthLabel(shiftMonth(activeMonth, -1)).split(" ")[0].toLowerCase()}
                    </button>
                  </form>
                  <div className="whsal-pop__sep" />
                  <div className="whsal-pop__subtitle">Плановые даты выплат с аренды</div>
                  <div className="whsal-pop__comment" style={{ marginTop: 0 }}>
                    Синие пометки можно расставить заранее — например, каждую неделю для сотрудников, которым платите с аренды.
                  </div>
                  <div className="whsal-qform">
                    <div className="whsal-qform__row">
                      <input
                        type="number"
                        className="admin-input whsal-qform__amount"
                        min={1}
                        max={dayCount}
                        value={scheduleStartValue}
                        onChange={(e) => setScheduleStartValue(e.target.value)}
                        placeholder="День старта"
                      />
                      <button
                        type="button"
                        className="admin-btn admin-btn--primary whsal-qform__submit"
                        disabled={scheduleBusy}
                        onClick={async () => {
                          const start = Number(scheduleStartValue);
                          if (!Number.isFinite(start) || start < 1 || start > dayCount) return;
                          await distributeWeeklySchedule(popRow.employee.id, start);
                        }}
                      >
                        Каждые 7 дней
                      </button>
                    </div>
                    <div className="whsal-pop__quick-actions">
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        disabled={scheduleBusy}
                        onClick={async () => {
                          await saveScheduleDays(popRow.employee.id, []);
                          flashCell(`${popRow.employee.id}:schedule`);
                        }}
                      >
                        Очистить план
                      </button>
                    </div>
                    <div className="whsal-pop__comment">
                      Сейчас отмечены: {popRow.scheduledDays.length ? popRow.scheduledDays.join(", ") : "нет дат"}
                    </div>
                  </div>
                  <div className="whsal-pop__sep" />
                  <div className="whsal-pop__subtitle">
                    Записи за месяц · {popRow.rows.length} шт · {fmt(popRow.accruedRecords)} ₽
                  </div>
                  {popRow.rows.length === 0 ? (
                    <div className="whsal-pop__comment">
                      Записей нет — добавьте выплату кликом по ячейке дня или
                      кнопкой «Запланировать зарплату».
                    </div>
                  ) : (
                    <div className="whsal-pop__list">
                      {[...popRow.rows]
                        .sort((a, b) =>
                          salaryOperationDate(a).localeCompare(salaryOperationDate(b))
                        )
                        .map((s) => (
                          <div key={s.id} className="whsal-pop__item">
                            <div className="whsal-pop__item-top">
                              <span className="whsal-pop__amount">{fmt(s.amount)} ₽</span>
                              <span className="admin-badge admin-badge--blue">
                                за {monthLabel(salaryPeriodKey(s)).toLowerCase()}
                              </span>
                              <span className="whsal-pop__date">
                                {s.isPaid
                                  ? `выплачено ${fmtDate(s.paidAt || s.date)}`
                                  : `план ${fmtDate(s.date)}`}
                              </span>
                              {isDebtPaymentSalary(s) && (
                                <span className="admin-badge admin-badge--amber">долг</span>
                              )}
                              {s.isPaid ? (
                                <span className="admin-badge admin-badge--green">выплачено</span>
                              ) : (
                                <span className="admin-badge admin-badge--amber">к выплате</span>
                              )}
                              {isSalaryExcludedFromBalance(s.comment) && (
                                <span className="admin-badge admin-badge--muted">вне баланса</span>
                              )}
                              <span className="whsal-pop__actions">
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--icon"
                                  title={s.isPaid ? "Вернуть в «к выплате»" : "Выплатить"}
                                  disabled={busyId === s.id}
                                  onClick={() => togglePaid(s)}
                                >
                                  {busyId === s.id ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : s.isPaid ? (
                                    <Undo2 size={13} />
                                  ) : (
                                    <CheckCircle size={13} />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--icon"
                                  title="Изменить"
                                  onClick={() => openEdit(s)}
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--icon admin-btn--danger-ghost"
                                  title="Удалить"
                                  disabled={busyId === s.id}
                                  onClick={() => handleDelete(s)}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </span>
                            </div>
                            {stripSalaryMetaTags(s.comment) && (
                              <div className="whsal-pop__comment">{stripSalaryMetaTags(s.comment)}</div>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </>
              )}

              {popover.kind === "debt" && (
                <>
                  <div className="whsal-pop__subtitle">Долг за месяц, ₽ (±)</div>
                  {(popRow.manualDebt !== 0 || popRow.debtPaid > 0) && (
                    <div className="whsal-debt-summary">
                      <span>Задано: <b>{fmt(popRow.manualDebt)} ₽</b></span>
                      <span>Погашено: <b>{fmt(popRow.debtPaid)} ₽</b></span>
                      <span>Осталось: <b>{fmt(popRow.debtRemaining)} ₽</b></span>
                    </div>
                  )}
                  <form
                    className="whsal-qform"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const v = Number(debtValue.replace(",", "."));
                      if (!Number.isFinite(v)) return;
                      const ok = await saveDebt(popRow.employee.id, v);
                      if (ok) {
                        flashCell(`${popRow.employee.id}:debt`);
                        setPopover(null);
                      }
                    }}
                  >
                    <div className="whsal-qform__row">
                      <input
                        type="number"
                        className="admin-input whsal-qform__amount"
                        placeholder="Например: 5000 или -3000"
                        step="0.01"
                        value={debtValue}
                        autoFocus
                        onChange={(e) => setDebtValue(e.target.value)}
                      />
                      <button type="submit" className="admin-btn admin-btn--primary whsal-qform__submit">
                        Сохранить
                      </button>
                    </div>
                    <p className="whsal-pop__comment" style={{ marginTop: 0 }}>
                      <strong>Плюс</strong> — компания должна сотруднику
                      (недовыплаченный остаток, доплата). <strong>Минус</strong> —
                      сотрудник должен компании (аванс, удержание). Долг
                      прибавляется к «За месяц». Выплата с отметкой «В счёт долга»
                      уменьшает этот долг, списывается из банка/кассы, но не
                      попадает в «Получено» и факт зарплаты месяца.
                    </p>
                    <div className="whsal-pop__quick-actions">
                      {(() => {
                        const prevKey = shiftMonth(activeMonth, -1);
                        const prevShort = monthLabel(prevKey).split(" ")[0].toLowerCase();
                        const prevRest = restForMonth(popRow.employee, prevKey);
                        const prevDebt = debtNumFor(prevKey, popRow.employee.id);
                        return (
                          <>
                            {prevRest !== 0 && (
                              <button
                                type="button"
                                className="admin-btn admin-btn--ghost admin-btn--sm"
                                title={`Остаток к выплате за ${monthLabel(prevKey)}: ${fmt(prevRest)} ₽`}
                                onClick={() => setDebtValue(String(prevRest))}
                              >
                                <TrendingUp size={13} /> Перенести остаток {prevShort}а ({fmt(prevRest)} ₽)
                              </button>
                            )}
                            {prevDebt !== 0 && (
                              <button
                                type="button"
                                className="admin-btn admin-btn--ghost admin-btn--sm"
                                onClick={() => setDebtValue(String(prevDebt))}
                              >
                                <Copy size={13} /> Долг из {prevShort}а ({fmt(prevDebt)} ₽)
                              </button>
                            )}
                            {popRow.manualDebt !== 0 && (
                              <button
                                type="button"
                                className="admin-btn admin-btn--ghost admin-btn--sm"
                                onClick={async () => {
                                  const ok = await saveDebt(popRow.employee.id, 0);
                                  if (ok) {
                                    flashCell(`${popRow.employee.id}:debt`);
                                    setPopover(null);
                                  }
                                }}
                              >
                                <X size={13} /> Обнулить долг
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </form>
                </>
              )}
            </div>
          </>,
          document.body
        )}

      {daysModalOpen && (
        <MonthDaysModal
          month={activeMonth}
          initialDays={weekendDays}
          onClose={() => setDaysModalOpen(false)}
          onSave={saveWeekends}
        />
      )}

      {setupOpen && (
        <SalariesSetupModal
          employees={employees}
          month={activeMonth}
          prevMonth={shiftMonth(activeMonth, -1)}
          planFor={(id) => planNumFor(activeMonth, id)}
          debtFor={(id) => debtNumFor(activeMonth, id)}
          prevPlanFor={(id) => planNumFor(shiftMonth(activeMonth, -1), id)}
          onClose={() => setSetupOpen(false)}
          onSave={saveSetupEntries}
        />
      )}

      {formOpen && (
        <SalaryFormModal
          employees={employees}
          initial={editing}
          defaultPeriodMonth={shiftMonth(activeMonth, -1)}
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
