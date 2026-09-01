// =========================================================
// FILE: src/components/admin/duty-schedule/DutyScheduleAdmin.tsx
// Табель дежурств охраны: генерация на месяц, ручное редактирование,
// печать и блок «Зарплата».
//
// МЕСЯЦ ТАБЕЛЯ = месяц навигации: сетка всегда показывает выбранный
// месяц (ставлю октябрь — числа и календарь октября). В печати
// зарплата считается именно по часам этого календарного месяца.
//
// ЗАРПЛАТА — отдельная система с вариантами расчёта (сдвиг):
//   • месяц в месяц — зп за M по табелю M;
//   • прошлый месяц — зп за M по табелю M−1;
//   • два месяца назад — зп за M по табелю M−2.
// Начисления (кто и сколько) видны сразу, итоговую сумму каждого
// человека можно менять руками. Дни выплат задаются вручную —
// любое количество, хоть каждый день. «Убрать из зп» удаляет
// человека из зарплаты, но не из табеля.
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
  Undo2,
} from "lucide-react";
import { useDutySchedule } from "./useDutySchedule";
import { ScheduleTable } from "./ScheduleTable";
import { EmployeeManagerModal } from "./EmployeeManagerModal";
import { DutySchedulePrint } from "./DutySchedulePrint";
import {
  DutyScheduleSnapshot,
  Employee,
  SalaryAccrual,
  SalaryPayout,
} from "./types";
import { MONTHS_RU, WEEKDAYS_SHORT_RU, daysInMonth } from "./scheduleGenerator";
import "./DutySchedule.css";

interface Props {
  initialYear?: number;
  initialMonth?: number;
  companyPhone?: string;
  companyAddress?: string;
  /** Сохранённый сервером снимок всех табелей. null — первая запись. */
  initialSnapshot?: DutyScheduleSnapshot | null;
  /** Ошибка первоначального чтения БД (клиент безопасно повторит GET). */
  initialDatabaseError?: string | null;
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

/** Месяцы в предложном падеже: «выплаты в сентябре». */
const MONTHS_RU_IN = [
  "январе",
  "феврале",
  "марте",
  "апреле",
  "мае",
  "июне",
  "июле",
  "августе",
  "сентябре",
  "октябре",
  "ноябре",
  "декабре",
];

/** Месяцы в родительном падеже: «за смены августа». */
const MONTHS_RU_FOR = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** Последний день месяца. */
function lastDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(
    daysInMonth(year, month)
  ).padStart(2, "0")}`;
}

/** Месяц со сдвигом (для подписей вариантов расчёта зп). */
function monthBack(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
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

/** Один и тот же человек? Из табеля — по id, вручную введённый — по имени. */
function isSamePerson(
  row: { employeeId: string; employeeName: string },
  employeeId: string,
  employeeName: string
): boolean {
  if (employeeId && employeeId !== "custom" && row.employeeId === employeeId) {
    return true;
  }
  const name = employeeName.trim().toLowerCase();
  return name.length > 0 && row.employeeName.trim().toLowerCase() === name;
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

/** Строка начисления с расчётом по табелю базового месяца. */
interface AccrualRow extends SalaryAccrual {
  /** Сотрудник табеля (null — человек вне табеля). */
  known: Employee | null;
  /** Часы по табелю базового месяца. */
  hours: number;
  /** Расчёт по табелю: часы × ставка (или ручная «Сумма» этого месяца). */
  bySchedule: number | null;
  /** Итоговая сумма зп: ручная, если задана, иначе расчёт. */
  effective: number;
  /** Задана ли ручная итоговая сумма. */
  manual: boolean;
  /** Сколько уже разложено по дням выплат. */
  payoutTotal: number;
  payoutCount: number;
}

export const DutyScheduleAdmin: React.FC<Props> = ({
  initialYear,
  initialMonth,
  companyPhone,
  companyAddress,
  initialSnapshot = null,
  initialDatabaseError = null,
  existingTransfers = [],
}) => {
  const router = useRouter();
  const {
    storageReady,
    databaseEnabled,
    saveStatus,
    saveError,
    lastSavedAt,
    retryDatabase,
    year,
    month,
    goToPrevMonth,
    goToNextMonth,
    basisYear,
    basisMonth,
    basisKey,
    basisSchedule,
    basisAmountOverrides,
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
    getAccrualsFor,
    setAccrualAmount,
    setAccrualName,
    addAccrualPerson,
    removeAccrual,
    resetAccrualsToTimesheet,
    getPayoutTitleFor,
    setPayoutTitle,
    getPayoutsFor,
    setSalaryPayouts,
    addPayout,
    addPayoutForEmployee,
    updatePayout,
    removePayout,
    splitPayout,
    fillPayoutsFromAccruals,
    message,
    setMessage,
  } = useDutySchedule(
    initialYear,
    initialMonth,
    initialSnapshot,
    initialDatabaseError
  );

  const [showEmployees, setShowEmployees] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [rotatingStart, setRotatingStart] = useState<string>("");
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");

  // Месяц табеля = период зарплаты (навигация).
  const payPeriodKey = monthKey(year, month);
  const payPeriodLabel = `${MONTHS_RU[month - 1]} ${year}`;

  // Базовый месяц расчёта зп: месяц − сдвиг (0/1/2).
  const basisLabel = `${MONTHS_RU[basisMonth - 1]} ${basisYear}`;
  const basisNote =
    payOffset > 0
      ? `выплаты в ${MONTHS_RU_IN[month - 1]} ${year} — за смены ${MONTHS_RU_FOR[basisMonth - 1]} ${basisYear}`
      : null;
  // Подписи вариантов расчёта с конкретными месяцами
  const prev1 = monthBack(year, month, -1);
  const prev2 = monthBack(year, month, -2);

  // Заголовок относится к месяцу, ЗА КОТОРЫЙ платят. По умолчанию
  // подставляем базовый месяц, но окончательный текст задаётся вручную.
  const defaultPayoutTitle = `Выплаты за ${MONTHS_RU[
    basisMonth - 1
  ].toLowerCase()}`;
  const payoutTitle = getPayoutTitleFor(payPeriodKey, defaultPayoutTitle);

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

  // ── Начисления: кто и сколько получает за период ──
  const accruals = getAccrualsFor(payPeriodKey);
  const payouts = getPayoutsFor(payPeriodKey);

  const accrualRows: AccrualRow[] = accruals.map((a) => {
    const known =
      a.employeeId && a.employeeId !== "custom"
        ? employees.find((e) => e.id === a.employeeId) ?? null
        : null;
    let hours = 0;
    let bySchedule: number | null = null;
    if (known) {
      hours = basisSchedule
        .filter((d) => d.employeeId === known.id && d.status !== "missed")
        .reduce((s, d) => s + (d.hours || 0), 0);
      bySchedule =
        basisAmountOverrides[known.id] ?? Math.round(hours * known.rate);
    }
    const effective = a.amount != null ? a.amount : (bySchedule ?? 0);
    const empPayouts = payouts.filter(
      (p) => isSamePerson(p, a.employeeId, a.employeeName)
    );
    return {
      ...a,
      known,
      hours,
      bySchedule,
      effective,
      manual: a.amount != null,
      payoutTotal: empPayouts.reduce((s, p) => s + (p.amount || 0), 0),
      payoutCount: empPayouts.length,
    };
  });
  const accrualTotal = accrualRows.reduce((s, r) => s + r.effective, 0);

  // ── Выплаты по дням ──
  const payTotal = payouts.reduce((s, r) => s + (r.amount || 0), 0);
  const validPayoutsCount = payouts.filter((p) => p.amount > 0).length;
  const payoutsWord =
    validPayoutsCount === 1
      ? "выплата"
      : validPayoutsCount >= 2 && validPayoutsCount <= 4
        ? "выплаты"
        : "выплат";

  const handleGenerate = () => {
    const hasData = schedule.some((d) => d.employeeId);
    if (
      hasData &&
      !confirm("Текущее расписание за месяц будет перезаписано. Продолжить?")
    )
      return;
    generate(rotatingStart || undefined);
  };

  const handleAddAccrualPerson = (value: string) => {
    if (!value) return;
    if (value === "custom") {
      addAccrualPerson(payPeriodKey, "custom", "");
      setMessage("Человек добавлен — введите ФИО и итоговую сумму");
    } else {
      const emp = employees.find((e) => e.id === value);
      addAccrualPerson(payPeriodKey, value, emp?.name || "");
      setMessage(
        "Человек добавлен в зарплату — сумма считается по табелю, можно поменять руками"
      );
    }
  };

  const handleRemoveFromSalary = (row: AccrualRow) => {
    if (
      !confirm(
        `Убрать «${row.employeeName || "человека без имени"}» из зарплаты за ${payPeriodLabel}?\n\n` +
          `Удалится начисление (${row.effective.toLocaleString("ru-RU")} ₽)` +
          (row.payoutCount > 0
            ? ` и все его выплаты за этот месяц (${row.payoutCount} шт. на ${row.payoutTotal.toLocaleString("ru-RU")} ₽)`
            : "") +
          `.\nВ табеле дежурств человек останется — зарплата и табель независимы.`
      )
    ) {
      return;
    }
    removeAccrual(payPeriodKey, row.id);
    setMessage(`«${row.employeeName}» убран из зарплаты (в табеле остался)`);
  };

  const handleResetAccruals = () => {
    if (
      !confirm(
        `Вернуть в зарплату за ${payPeriodLabel} всех активных охранников?\n\n` +
          `Ручные итоговые суммы и добавленные вручную люди за этот месяц сбросятся, ` +
          `суммы снова будут считаться по табелю за ${basisLabel.toLowerCase()}.`
      )
    ) {
      return;
    }
    resetAccrualsToTimesheet(payPeriodKey);
  };

  const handleFillPayouts = () => {
    if (
      payouts.length > 0 &&
      !confirm(
        `Заполнить выплаты по начислению за ${payPeriodLabel}?\n\n` +
          `Текущие выплаты (${payouts.length} шт.) будут заменены: по 1 строке ` +
          `на человека с его итоговой суммой, день — последний день месяца. ` +
          `Дальше дни и суммы можно менять как угодно.`
      )
    ) {
      return;
    }
    fillPayoutsFromAccruals(payPeriodKey, basisKey);
  };

  const handleAddPayoutForPerson = (row: AccrualRow) => {
    const remaining = row.effective - row.payoutTotal;
    addPayoutForEmployee(
      payPeriodKey,
      row.employeeId,
      row.employeeName,
      remaining > 0 ? remaining : 0,
      lastDayOfMonth(year, month)
    );
  };

  const handleSortByDate = () => {
    const sorted = [...payouts].sort((a, b) =>
      (a.date || "").localeCompare(b.date || "")
    );
    setSalaryPayouts(payPeriodKey, sorted);
    setMessage("Выплаты отсортированы по дате");
  };

  const handleSortByEmployee = () => {
    const sorted = [...payouts].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName, "ru")
    );
    setSalaryPayouts(payPeriodKey, sorted);
    setMessage("Выплаты сгруппированы по людям");
  };

  const handleTransferConfirm = async () => {
    const validItems = payouts.filter(
      (r) => r.amount > 0 && r.employeeName.trim()
    );
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
      setTransferError(
        e instanceof Error ? e.message : "Ошибка сети при переносе"
      );
    } finally {
      setTransferring(false);
    }
  };

  if (!storageReady) {
    return (
      <div className="ds-root ds-storage-loading" aria-live="polite">
        <Loader2 size={22} className="animate-spin" />
        <span>Загружаем сохранённые табели из базы…</span>
      </div>
    );
  }

  return (
    <div className="ds-root">
      <div className="ds-header">
        <h2>Табель охраны — дежурства</h2>
        <div
          className={`ds-db-status ds-db-status--${saveStatus}`}
          role={saveStatus === "error" ? "alert" : "status"}
          title={
            lastSavedAt
              ? `Последнее сохранение в БД: ${lastSavedAt.replace("T", " ").slice(0, 19)}`
              : undefined
          }
        >
          {saveStatus === "loading" || saveStatus === "saving" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : saveStatus === "saved" ? (
            <CheckCircle2 size={13} />
          ) : saveStatus === "error" ? (
            <AlertTriangle size={13} />
          ) : (
            <CalendarClock size={13} />
          )}
          <span>
            {saveStatus === "loading"
              ? "Подключение к БД…"
              : saveStatus === "saving"
                ? "Сохраняем в БД…"
                : saveStatus === "saved"
                  ? "Сохранено в БД"
                  : saveStatus === "error"
                    ? saveError || "Не сохранено в БД"
                    : databaseEnabled
                      ? "Автосохранение включено"
                      : "БД недоступна"}
          </span>
          {saveStatus === "error" && (
            <button type="button" onClick={() => void retryDatabase()}>
              Повторить
            </button>
          )}
        </div>
        <div className="ds-month-nav">
          <button
            className="ds-btn"
            onClick={goToPrevMonth}
            title="Предыдущий месяц"
          >
            ←
          </button>
          <span
            className="ds-month-label"
            title="Месяц табеля (числа и календарь в сетке) и период зарплаты"
          >
            {payPeriodLabel}
          </span>
          <button
            className="ds-btn"
            onClick={goToNextMonth}
            title="Следующий месяц"
          >
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
            title="Печатная форма: смены, часы и зарплата выбранного календарного месяца; выплаты — с выбранным сдвигом"
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
          Ставка:{" "}
          {new Set(employees.filter((e) => e.active).map((e) => e.rate))
            .size === 1
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

      {/* ══ ЗАРПЛАТА: варианты расчёта, начисления и выплаты по дням ══ */}
      <div className="ds-payroll">
        <div className="ds-payroll-head">
          <div className="ds-payroll-title">
            <CalendarClock size={16} /> Зарплата — {payPeriodLabel}
          </div>

          <div className="ds-payroll-period">
            <label title="По какому табелю считается зарплата. Сетка табеля при этом не сдвигается — только расчёт зп">
              Расчёт зп по табелю:
            </label>
            <select
              value={payOffset}
              onChange={(e) => setPayOffset(Number(e.target.value))}
              title="По какому табелю считаются суммы выплат. Сетка табеля при этом не сдвигается: выбрал сентябрь — числа и календарь сентября, а выплаты в сентябре — за табель прошлого месяца (или двухмесячной давности)."
            >
              <option value={0}>
                месяц в месяц ({MONTHS_RU[month - 1].toLowerCase()} {year})
              </option>
              <option value={1}>
                −1 месяц ({MONTHS_RU[prev1.month - 1].toLowerCase()} {prev1.year})
              </option>
              <option value={2}>
                −2 месяца ({MONTHS_RU[prev2.month - 1].toLowerCase()} {prev2.year})
              </option>
            </select>
            {basisNote && (
              <span className="ds-payroll-basis-note" title="Базовый месяц расчёта зарплаты">
                {basisNote}
              </span>
            )}
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

        {/* ── Начислено: кто и сколько ── */}
        <div className="ds-payroll-section-title">
          <span>
            {payOffset > 0
              ? `Начислено — выплаты в ${MONTHS_RU_IN[month - 1]} ${year} за смены ${MONTHS_RU_FOR[basisMonth - 1]} ${basisYear}`
              : `Начислено за ${payPeriodLabel.toLowerCase()} — кто и сколько`}
          </span>
        </div>

        <div className="ds-add-person-row">
          <UserPlus size={14} />
          <label>Добавить человека в зп:</label>
          <select value="" onChange={(e) => handleAddAccrualPerson(e.target.value)}>
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
            можно любого человека, даже не из табеля
          </span>
        </div>

        <div className="ds-payouts-table-wrap">
          <table className="ds-payouts-table">
            <thead>
              <tr>
                <th style={{ minWidth: "220px" }}>Человек</th>
                <th
                  style={{ width: "90px" }}
                  title={`Часы по табелю за ${basisLabel} (базовый месяц расчёта)`}
                >
                  Часы ({MONTHS_RU[basisMonth - 1].toLowerCase()})
                </th>
                <th
                  style={{ width: "120px" }}
                  title={`Расчёт по табелю за ${basisLabel}: часы × ставка (или ручная «Сумма» того месяца)`}
                >
                  По табелю, ₽
                </th>
                <th
                  style={{ width: "150px" }}
                  title="Итоговая сумма зарплаты. Можно поменять руками — поле сразу становится ручным, ↺ вернёт расчёт по табелю"
                >
                  Итоговая сумма, ₽
                </th>
                <th style={{ width: "220px" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {accrualRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="ds-payouts-empty">
                    В зарплате за {payPeriodLabel.toLowerCase()} никто не
                    указан. Добавьте человека выше или{" "}
                    <button
                      type="button"
                      className="ds-link-btn"
                      onClick={handleResetAccruals}
                    >
                      верните всех по табелю
                    </button>
                    .
                  </td>
                </tr>
              ) : (
                accrualRows.map((row) => (
                  <tr key={row.id}>
                    {/* Человек */}
                    <td className="ds-accrual-name-cell">
                      {row.known ? (
                        <>
                          <span className="ds-accrual-name">{row.employeeName}</span>
                          <span className="ds-muted"> · из табеля</span>
                        </>
                      ) : (
                        <input
                          type="text"
                          className="ds-payout-custom-input"
                          placeholder="ФИО человека"
                          value={row.employeeName}
                          onChange={(e) =>
                            setAccrualName(payPeriodKey, row.id, e.target.value)
                          }
                        />
                      )}
                    </td>

                    {/* Часы базового месяца */}
                    <td className="ds-print-num">
                      {row.known ? row.hours : "—"}
                    </td>

                    {/* Расчёт по табелю */}
                    <td className="ds-print-num">
                      {row.bySchedule != null
                        ? row.bySchedule.toLocaleString("ru-RU")
                        : "—"}
                    </td>

                    {/* Итоговая сумма (можно менять руками) */}
                    <td>
                      <div className="ds-payout-amount-wrap ds-accrual-amount-wrap">
                        <input
                          type="number"
                          className="ds-payout-amount-input"
                          min={0}
                          step={100}
                          value={row.effective === 0 ? "" : row.effective}
                          placeholder="0"
                          onChange={(e) => {
                            const val = e.target.value;
                            const num = val === "" ? 0 : Number(val);
                            setAccrualAmount(
                              payPeriodKey,
                              row.id,
                              Number.isNaN(num) ? 0 : num
                            );
                          }}
                        />
                        <span className="ds-payout-currency">₽</span>
                        {row.manual && (
                          <button
                            type="button"
                            className="ds-amount-reset ds-accrual-reset"
                            title="Вернуть расчёт по табелю"
                            onClick={() =>
                              setAccrualAmount(payPeriodKey, row.id, null)
                            }
                          >
                            <Undo2 size={11} />
                          </button>
                        )}
                      </div>
                      {row.known &&
                        row.payoutCount > 0 &&
                        row.payoutTotal !== row.effective && (
                          <span
                            className={`ds-accrual-diff ${
                              row.payoutTotal < row.effective
                                ? "ds-accrual-diff--rest"
                                : "ds-accrual-diff--over"
                            }`}
                            title="Разница между итоговой суммой и тем, что уже разложено по дням выплат"
                          >
                            {row.payoutTotal < row.effective
                              ? `по дням: ${row.payoutTotal.toLocaleString("ru-RU")} ₽`
                              : `по дням больше на ${(row.payoutTotal - row.effective).toLocaleString("ru-RU")} ₽`}
                          </span>
                        )}
                    </td>

                    {/* Действия */}
                    <td className="ds-payout-actions-cell">
                      <button
                        type="button"
                        className="ds-btn ds-btn--xs"
                        onClick={() => handleAddPayoutForPerson(row)}
                        title="Добавить этому человеку ещё один день выплаты (сумма — остаток итоговой)"
                      >
                        <Plus size={11} /> Выплата
                      </button>
                      <button
                        type="button"
                        className="ds-btn ds-btn--xs ds-btn--danger"
                        onClick={() => handleRemoveFromSalary(row)}
                        title="Убрать человека из зарплаты за этот месяц. В табеле дежурств он останется."
                      >
                        <Trash2 size={11} /> Убрать из зп
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {accrualRows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3} className="ds-payouts-total-label">
                    Итого начислено за {payPeriodLabel.toLowerCase()}:
                  </td>
                  <td className="ds-payouts-total-sum">
                    {accrualTotal.toLocaleString("ru-RU")} ₽
                  </td>
                  <td className="ds-muted">
                    {payOffset > 0
                      ? `расчёт по табелю за ${MONTHS_RU[basisMonth - 1].toLowerCase()}`
                      : "расчёт по табелю этого месяца"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="ds-accrual-actions">
          <button
            type="button"
            className="ds-btn ds-btn--sm"
            onClick={handleResetAccruals}
            title="Вернуть в список всех активных охранников, суммы — снова расчёт по табелю"
          >
            <RotateCcw size={12} /> Вернуть всех по табелю
          </button>
        </div>

        {/* ── Выплаты по дням ── */}
        <div className="ds-payroll-section-title ds-payout-title-editor">
          <label htmlFor="ds-payout-print-title">
            Заголовок таблицы выплат:
          </label>
          <input
            id="ds-payout-print-title"
            type="text"
            value={payoutTitle}
            placeholder="Например: Выплаты за июль"
            maxLength={120}
            onChange={(event) =>
              setPayoutTitle(payPeriodKey, event.target.value)
            }
            title="Эта надпись сохраняется для выбранного месяца и печатается над таблицей выплат"
          />
          <span className="ds-payout-title-help">
            месяц укажите вручную, например «Выплаты за июль»
          </span>
        </div>

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
              onClick={handleFillPayouts}
              title="По 1 строке на человека из начислений, сумма — итоговая, день — последний день месяца. Дальше меняйте как угодно."
            >
              <RotateCcw size={13} /> Заполнить по начислению
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
              <ArrowUpDown size={12} /> По людям
            </button>
          </div>
        </div>

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
                      onClick={handleFillPayouts}
                    >
                      «Заполнить по начислению»
                    </button>{" "}
                    или добавьте дни выплат сами — любое количество, хоть каждый
                    день.
                  </td>
                </tr>
              ) : (
                payouts.map((row, idx) => {
                  const isKnownEmployee = employees.some(
                    (e) => e.id === row.employeeId
                  );
                  const isCustom =
                    row.employeeId === "custom" || !isKnownEmployee;

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
                            className="ds-payout-amount-input"
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
                    `начислено: ${accrualTotal.toLocaleString("ru-RU")} ₽`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="ds-payroll-hint">
          Сотрудник получает зп за предыдущий месяц в текущий месяц: выбрал{" "}
          {payPeriodLabel.toLowerCase()} — табель и часы за{" "}
          {MONTHS_RU[month - 1].toLowerCase()}, а суммы выплат считаются по
          табелю{" "}
          {payOffset > 0
            ? `${MONTHS_RU_FOR[basisMonth - 1]} ${basisYear} (−${payOffset} мес.)`
            : "этого же месяца"}
          . Итоговую сумму каждого человека можно поменять руками (↺ вернёт
          расчёт по табелю), дни выплат задаются ниже — любое количество за
          месяц, хоть каждый день. «Убрать из зп» действует только на зарплату,
          в табеле человек остаётся.
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
          year={year}
          month={month}
          employees={employees}
          schedule={schedule}
          amountOverrides={amountOverrides}
          payouts={payouts}
          payoutTitle={payoutTitle}
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
                        <td className="ds-transfer-emp-name">
                          {row.employeeName}
                        </td>
                        <td className="ds-print-num">
                          {fmtDateWithWeekday(row.date)}
                        </td>
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
                    <td colSpan={3}>
                      Итого к переносу ({validPayoutsCount} {payoutsWord})
                    </td>
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
