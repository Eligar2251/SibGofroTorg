// =========================================================
// FILE: src/components/admin/SalaryAutoDistribute.tsx
// Автоматический расчёт зарплат по дням:
//   * Вводится оклад каждого сотрудника на период (неделя / 4 недели).
//   * Для каждого сотрудника выбираются дни недели, в которые он
//     получает «основную» выплату (в эти дни пул в 10 000 ₽ делится
//     поровну между всеми получателями дня).
//   * Оставшаяся до полного оклада сумма распределяется по выбранным
//     «дням остатков» (тоже не более 10 000 ₽ в день на человека, пока
//     не будет выбран весь лимит дня).
//   * Кнопка «Печать бланка» открывает отдельную печатную форму:
//     альбомный A4, фамилии по вертикали, дни по горизонтали, в
//     пересечении — крупная ячейка с суммой (как в табеле охраны).
//     Бланк независим от обычных зарплатных ведомостей.
//   * Для сторожей можно сразу перейти в их личный табель охраны
//     (рабочие дни отмечены крестиком, кроме личных смен) и вписать
//     сумму от руки в нижнем поле.
// =========================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer, X, Plus, Trash2, RefreshCcw, Save } from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { SITE_NAME } from "@/lib/seo";
import { SalaryBlankPrint, GuardRosterPrint } from "./SalaryBlankPrint";
import "./SalaryAutoDistribute.css";

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WEEKDAYS_LONG = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

interface Person {
  id: string;
  name: string;
  salary: number; // полный оклад за период
  payDays: number[]; // 0..6 — дни недели основной выплаты
}

interface DistSettings {
  dailyPool: number; // пул на день (по умолчанию 10000)
  weeks: number; // количество недель в периоде (4 = месяц)
  remainderWeekdays: number[]; // дни недели, куда раскидывать остатки
  periodLabel: string; // подпись на бланке (напр. месяц и год)
}

interface DistDay {
  weekIdx: number; // 0..weeks-1
  date: Date; // дата (для отображения)
  iso: string; // YYYY-MM-DD
  weekday: number; // 0..6
  payees: { personId: string; baseAmount: number; remainderAmount: number; total: number }[];
  isRemainderDay: boolean;
  dayTotal: number;
}

interface DistResult {
  days: DistDay[];
  perPerson: {
    personId: string;
    total: number;
    base: number;
    remainder: number;
    leftover: number; // что не влезло (если лимит 10000 не дал раскидать)
  }[];
  grandTotal: number;
}

const STORAGE_KEY = "salary_auto_distribute_v1";

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Ищет понедельник текущей недели (РФ: неделя начинается с понедельника). */
function mondayOf(d: Date): Date {
  const r = new Date(d);
  const wd = r.getDay();
  const diff = wd === 0 ? -6 : 1 - wd;
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtMoney(n: number): string {
  if (!isFinite(n)) return "0";
  return Math.round(n).toLocaleString("ru-RU");
}

function weekStartDate(weekIdx: number, weeks: number): Date {
  // Берём понедельник текущей недели и отсчитываем назад от начала периода.
  const curMon = mondayOf(today());
  // Период = последние N недель: текущая + N-1 предыдущих
  const startOffset = -(weeks - 1 - weekIdx) * 7;
  return addDays(curMon, startOffset);
}

function defaultPeriodLabel(weeks: number): string {
  const start = weekStartDate(0, weeks);
  const end = addDays(weekStartDate(weeks - 1, weeks), 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  if (weeks === 1) {
    const mon = weekStartDate(0, 1);
    return mon.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  }
  return `${fmt(start)} — ${fmt(end)}`;
}

function uid(): string {
  return "p_" + Math.random().toString(36).slice(2, 9);
}

function toggleBit(arr: number[], v: number): number[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v].sort((a, b) => a - b);
}

/**
 * Основной расчёт.
 * 1) Для каждой недели в периоде проходим по дням Пн..Вс.
 * 2) В обычные «payDays» между получателями дня делится dailyPool поровну
 *    (baseAmount). Если в этот день никто не получает — 0.
 * 3) Остаток для человека = salary − weeks * (base в его payDays в неделю).
 * 4) Остаток раскидывается по «remainderWeekdays» (по дням в порядке недель),
 *    добавляя до тех пор пока (а) у человека не закроется остаток
 *    и (б) общая сумма на человека за день не превысит dailyPool.
 *    День получает не более dailyPool на одного (т.е. остаток до 10000
 *    поверх базы).
 */
function distribute(people: Person[], settings: DistSettings): DistResult {
  const { dailyPool, weeks, remainderWeekdays } = settings;
  const active = people.filter((p) => p.payDays.length > 0 && p.salary > 0);

  // 1) База по дням
  const days: DistDay[] = [];
  for (let w = 0; w < weeks; w++) {
    const wStart = weekStartDate(w, weeks);
    // Идём по порядку Пн..Вс (weekday 1..6, 0)
    const order = [1, 2, 3, 4, 5, 6, 0];
    for (const wd of order) {
      const d = addDays(wStart, (wd + 6) % 7); // (wd+6)%7 даёт offset от понедельника
      const payees = active.filter((p) => p.payDays.includes(wd));
      const isRemainder = remainderWeekdays.includes(wd);
      const basePer = payees.length > 0 ? dailyPool / payees.length : 0;
      const day: DistDay = {
        weekIdx: w,
        date: d,
        iso: d.toISOString().slice(0, 10),
        weekday: wd,
        payees: payees.map((p) => ({
          personId: p.id,
          baseAmount: Math.round(basePer * 100) / 100,
          remainderAmount: 0,
          total: Math.round(basePer * 100) / 100,
        })),
        isRemainderDay: isRemainder,
        dayTotal: Math.round(basePer * payees.length * 100) / 100,
      };
      days.push(day);
    }
  }

  // 2) Считаем сколько базы получил каждый
  const baseByPerson = new Map<string, number>();
  for (const p of active) baseByPerson.set(p.id, 0);
  for (const d of days) {
    for (const py of d.payees) {
      baseByPerson.set(py.personId, (baseByPerson.get(py.personId) || 0) + py.baseAmount);
    }
  }

  // 3) Остатки для каждого: salary - уже распределённая база
  const remainders = new Map<string, number>();
  for (const p of active) {
    const base = baseByPerson.get(p.id) || 0;
    const r = Math.max(0, Math.round((p.salary - base) * 100) / 100);
    remainders.set(p.id, r);
  }

  // 4) Раскидываем остатки по дням remainderWeekdays в пределах лимита.
  //    Лимит = dailyPool на человека за день всего (вместе с базой).
  //    Чтобы остатки равномерно размазывались по всем выбранным дням
  //    (например по четырём четвергам), сначала для каждого сотрудника
  //    делим его остаток поровну между теми днями-остатками, в которые
  //    ему можно добавить, и только потом разносим по дню.
  const personById = new Map(people.map((p) => [p.id, p]));
  // Список дней-остатков по порядку
  const remDays = days.filter((d) => d.isRemainderDay);
  // Для каждого сотрудника распределяем остаток по его дням-остаткам
  // (если у человека есть базовая выплата в этот день — он в списке payees,
  // если нет — сможем добавить его в этот день как дополнительную выдачу).
  // Чтобы разбросать по всем четвергам, делим остаток на количество
  // дней-остатков и добавляем по равной части в каждый.
  const planned = new Map<string, Map<string, number>>(); // dayIso -> personId -> amount
  for (const p of active) {
    const rem = remainders.get(p.id) || 0;
    if (rem <= 0) continue;
    // Дни-остатки, в которые у сотрудника ещё не исчерпан лимит (базой).
    // Упрощённо: все дни remainderWeekdays поровну, но если в день у человека
    // уже есть база, вычитаем её из дневного лимита.
    const eligibleDays: { day: DistDay; capacity: number }[] = [];
    for (const d of remDays) {
      const existing = d.payees.find((py) => py.personId === p.id);
      const used = existing ? existing.total : 0;
      const cap = Math.max(0, dailyPool - used);
      if (cap > 0) eligibleDays.push({ day: d, capacity: cap });
    }
    if (eligibleDays.length === 0) continue;
    let remaining = rem;
    // Поровну по eligibleDays, с учётом их capacity
    // Несколько проходов: распределяем min(rem/n, cap), пока не распределим
    const basePer = remaining / eligibleDays.length;
    for (const e of eligibleDays) {
      const add = Math.min(e.capacity, Math.round(basePer * 100) / 100, remaining);
      if (add <= 0) continue;
      const key = e.day.iso;
      if (!planned.has(key)) planned.set(key, new Map());
      const m = planned.get(key)!;
      m.set(p.id, (m.get(p.id) || 0) + add);
      remaining = Math.round((remaining - add) * 100) / 100;
    }
    // Если что-то осталось (из-за capacity), докладываем в первый доступный
    for (const e of eligibleDays) {
      if (remaining <= 0.009) break;
      const used = (planned.get(e.day.iso)?.get(p.id) || 0) +
        (e.day.payees.find((py) => py.personId === p.id)?.total || 0);
      const cap = Math.max(0, dailyPool - used);
      const add = Math.min(cap, remaining);
      if (add <= 0) continue;
      if (!planned.has(e.day.iso)) planned.set(e.day.iso, new Map());
      const m = planned.get(e.day.iso)!;
      m.set(p.id, (m.get(p.id) || 0) + add);
      remaining = Math.round((remaining - add) * 100) / 100;
    }
    remainders.set(p.id, Math.max(0, remaining));
  }
  // Применяем запланированные остатки к дням
  for (const d of days) {
    const m = planned.get(d.iso);
    if (!m) continue;
    for (const [pid, add] of m) {
      const addR = Math.round(add * 100) / 100;
      if (addR <= 0) continue;
      const existing = d.payees.find((py) => py.personId === pid);
      if (existing) {
        existing.remainderAmount = Math.round((existing.remainderAmount + addR) * 100) / 100;
        existing.total = Math.round((existing.total + addR) * 100) / 100;
      } else {
        d.payees.push({
          personId: pid,
          baseAmount: 0,
          remainderAmount: addR,
          total: addR,
        });
      }
      d.dayTotal = Math.round((d.dayTotal + addR) * 100) / 100;
    }
  }

  const perPerson = people.map((p) => {
    const base = baseByPerson.get(p.id) || 0;
    const rem = remainders.get(p.id) || 0;
    let remainder = 0;
    for (const d of days) {
      const e = d.payees.find((py) => py.personId === p.id);
      if (e) remainder += e.remainderAmount;
    }
    remainder = Math.round(remainder * 100) / 100;
    return {
      personId: p.id,
      base: Math.round(base * 100) / 100,
      remainder,
      total: Math.round((base + remainder) * 100) / 100,
      leftover: rem, // что не влезло
    };
  });

  const grandTotal = perPerson.reduce((s, x) => s + x.total, 0);
  return { days, perPerson, grandTotal: Math.round(grandTotal * 100) / 100 };
}

// ─────────────────────────────────────────────────────────
// Основной компонент
// ─────────────────────────────────────────────────────────
export function SalaryAutoDistribute() {
  const [people, setPeople] = useState<Person[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.people) && parsed.people.length) return parsed.people;
      }
    } catch {}
    return [
      { id: uid(), name: "Сторож 1", salary: 22080, payDays: [2] },
      { id: uid(), name: "Сторож 2", salary: 21045, payDays: [2] },
      { id: uid(), name: "Менеджер", salary: 40000, payDays: [3] },
    ];
  });

  const [settings, setSettings] = useState<DistSettings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.settings) return { ...defaultSettings(), ...parsed.settings };
      }
    } catch {}
    return defaultSettings();
  });

  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showBlank, setShowBlank] = useState(false);
  const [selectedForBlank, setSelectedForBlank] = useState<Set<string>>(new Set());
  const [blankPersonId, setBlankPersonId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ people, settings }));
    } catch {}
  }, [people, settings]);

  function defaultSettings(): DistSettings {
    return {
      dailyPool: 10000,
      weeks: 4,
      remainderWeekdays: [4], // четверг по умолчанию
      periodLabel: defaultPeriodLabel(4),
    };
  }

  const result = useMemo(() => distribute(people, settings), [people, settings]);

  function updatePerson(id: string, patch: Partial<Person>) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function addPerson() {
    setPeople((prev) => [
      ...prev,
      { id: uid(), name: "Новый сотрудник", salary: 20000, payDays: [] },
    ]);
  }
  function removePerson(id: string) {
    setPeople((prev) => prev.filter((p) => p.id !== id));
    setSelectedForBlank((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }
  function togglePayDay(id: string, wd: number) {
    const p = people.find((x) => x.id === id);
    if (!p) return;
    updatePerson(id, { payDays: toggleBit(p.payDays, wd) });
  }
  function toggleRemainderDay(wd: number) {
    setSettings((s) => ({ ...s, remainderWeekdays: toggleBit(s.remainderWeekdays, wd) }));
  }
  function toggleSelected(id: string) {
    setSelectedForBlank((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selectAll() {
    setSelectedForBlank(new Set(people.map((p) => p.id)));
  }
  function clearSelection() {
    setSelectedForBlank(new Set());
  }
  function resetAll() {
    if (!confirm("Сбросить всех сотрудников и настройки к значениям по умолчанию?")) return;
    setPeople([
      { id: uid(), name: "Сторож 1", salary: 22080, payDays: [2] },
      { id: uid(), name: "Сторож 2", salary: 21045, payDays: [2] },
      { id: uid(), name: "Менеджер", salary: 40000, payDays: [3] },
    ]);
    setSettings(defaultSettings());
  }
  function markSaved() {
    setSavedAt(new Date().toLocaleTimeString("ru-RU"));
    setTimeout(() => setSavedAt(null), 2000);
  }

  const totalPool = settings.dailyPool * settings.weeks * 7;
  const distributed = result.grandTotal;
  const totalLeftover = result.perPerson.reduce((s, x) => s + x.leftover, 0);
  const personMap = new Map(people.map((p) => [p.id, p]));

  return (
    <div className="saz-root">
      <div className="saz-header">
        <h2>Автоматический расчёт зарплат по дням</h2>
        <div className="saz-header__sub">
          Введите оклад и отметьте дни недели выплаты — суммы распределятся
          автоматически. Остатки разбрасываются по выбранным дням, не превышая
          лимит <b>{fmtMoney(settings.dailyPool)} ₽</b> в день на человека.
        </div>
      </div>

      {/* ── Общие настройки ── */}
      <div className="saz-card">
        <div className="saz-card__head">
          <h3>Параметры периода</h3>
        </div>
        <div className="saz-settings">
          <label className="saz-field">
            <span>Пул на день, ₽</span>
            <input
              type="number"
              min={1}
              step="1"
              value={settings.dailyPool}
              onChange={(e) =>
                setSettings((s) => ({ ...s, dailyPool: Math.max(1, Number(e.target.value) || 0) }))
              }
            />
          </label>
          <label className="saz-field">
            <span>Недель в периоде</span>
            <select
              value={settings.weeks}
              onChange={(e) => {
                const w = Number(e.target.value);
                setSettings((s) => ({
                  ...s,
                  weeks: w,
                  periodLabel: defaultPeriodLabel(w),
                }));
              }}
            >
              <option value={1}>1 неделя</option>
              <option value={2}>2 недели</option>
              <option value={3}>3 недели</option>
              <option value={4}>4 недели (месяц)</option>
            </select>
          </label>
          <label className="saz-field saz-field--wide">
            <span>Подпись периода (выводится на бланке)</span>
            <input
              type="text"
              value={settings.periodLabel}
              onChange={(e) => setSettings((s) => ({ ...s, periodLabel: e.target.value }))}
            />
          </label>
          <div className="saz-field saz-field--wide">
            <span>Дни для разброса остатков (по ним остатки будут выдаваться дополнительно, до {fmtMoney(settings.dailyPool)} ₽ на человека в день)</span>
            <div className="saz-weekdays">
              {WEEKDAYS.map((w, i) => (
                <button
                  type="button"
                  key={i}
                  className={`saz-chip${settings.remainderWeekdays.includes(i) ? " saz-chip--on" : ""}`}
                  onClick={() => toggleRemainderDay(i)}
                  title={WEEKDAYS_LONG[i]}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Сотрудники ── */}
      <div className="saz-card">
        <div className="saz-card__head">
          <h3>Сотрудники и их дни выплат</h3>
          <div className="saz-card__actions">
            <button className="saz-btn saz-btn--ghost" onClick={resetAll}>
              <RefreshCcw size={14} /> Сбросить
            </button>
            <button className="saz-btn saz-btn--primary" onClick={addPerson}>
              <Plus size={14} /> Добавить
            </button>
          </div>
        </div>

        <div className="saz-table-wrap">
          <table className="saz-emp-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>№</th>
                <th>ФИО</th>
                <th style={{ width: 140 }}>Оклад за период, ₽</th>
                <th>Дни основной выплаты</th>
                <th style={{ width: 90 }}>База</th>
                <th style={{ width: 90 }}>Остаток</th>
                <th style={{ width: 100 }}>Итого</th>
                <th style={{ width: 100 }}>Не влезло</th>
                <th>Печать</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {people.map((p, idx) => {
                const stat = result.perPerson.find((x) => x.personId === p.id);
                return (
                  <tr key={p.id}>
                    <td className="saz-num">{idx + 1}</td>
                    <td>
                      <input
                        className="saz-input saz-input--name"
                        value={p.name}
                        onChange={(e) => updatePerson(p.id, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="saz-input saz-input--num"
                        min={0}
                        step="1"
                        value={p.salary}
                        onChange={(e) => updatePerson(p.id, { salary: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </td>
                    <td>
                      <div className="saz-weekdays">
                        {WEEKDAYS.map((w, i) => (
                          <button
                            type="button"
                            key={i}
                            className={`saz-chip${p.payDays.includes(i) ? " saz-chip--on saz-chip--pay" : ""}`}
                            onClick={() => togglePayDay(p.id, i)}
                            title={WEEKDAYS_LONG[i]}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="saz-num">{fmtMoney(stat?.base || 0)} ₽</td>
                    <td className="saz-num">{fmtMoney(stat?.remainder || 0)} ₽</td>
                    <td className="saz-num saz-cell-total">{fmtMoney(stat?.total || 0)} ₽</td>
                    <td className={`saz-num${(stat?.leftover || 0) > 0.01 ? " saz-warn" : ""}`}>
                      {fmtMoney(stat?.leftover || 0)} ₽
                    </td>
                    <td>
                      <label className="saz-check" title="Включить в общий бланк">
                        <input
                          type="checkbox"
                          checked={selectedForBlank.has(p.id)}
                          onChange={() => toggleSelected(p.id)}
                        />
                        в бланк
                      </label>
                      <button
                        type="button"
                        className="saz-mini"
                        onClick={() => setBlankPersonId(p.id)}
                        title="Открыть личный табель охраны этого сотрудника (рабочие дни отмечены крестиком)"
                      >
                        табель
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="saz-icon-btn"
                        onClick={() => removePerson(p.id)}
                        title="Удалить"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="saz-total-bar">
          <span>
            Всего к выдаче: <b>{fmtMoney(distributed)} ₽</b>
          </span>
          <span className="saz-muted">
            Пул за период: {fmtMoney(totalPool)} ₽ (все дни недели × {settings.weeks} нед.)
          </span>
          {totalLeftover > 0.01 && (
            <span className="saz-warn">
              Не удалось раскидать: {fmtMoney(totalLeftover)} ₽ — добавьте дни остатков или увеличьте их.
            </span>
          )}
          <span className="saz-saved">{savedAt ? `Сохранено в ${savedAt}` : "сохраняется автоматически"}</span>
        </div>
      </div>

      {/* ── Календарь выдачи по дням ── */}
      <div className="saz-card">
        <div className="saz-card__head">
          <h3>Расписание выдачи по дням</h3>
        </div>
        <div className="saz-schedule">
          {Array.from({ length: settings.weeks }).map((_, wIdx) => {
            const days = result.days.filter((d) => d.weekIdx === wIdx);
            const wStart = weekStartDate(wIdx, settings.weeks);
            const wEnd = addDays(wStart, 6);
            const weekTotal = days.reduce((s, d) => s + d.dayTotal, 0);
            return (
              <div key={wIdx} className="saz-week">
                <div className="saz-week__head">
                  Неделя {wIdx + 1} · {wStart.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}—
                  {wEnd.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
                  <span className="saz-week__total">
                    {fmtMoney(Math.round(weekTotal * 100) / 100)} ₽
                  </span>
                </div>
                <div className="saz-days">
                  {days.map((d) => {
                    const dayNum = d.date.getDate();
                    const monthName = d.date.toLocaleDateString("ru-RU", { month: "short" });
                    return (
                      <div
                        key={d.iso}
                        className={`saz-day${d.isRemainderDay ? " saz-day--remainder" : ""}${d.payees.length === 0 ? " saz-day--empty" : ""}`}
                      >
                        <div className="saz-day__head">
                          <span className="saz-day__wd">{WEEKDAYS[d.weekday]}</span>
                          <span className="saz-day__num">{dayNum}</span>
                          <span className="saz-day__mon">{monthName}</span>
                        </div>
                        <div className="saz-day__body">
                          {d.payees.length === 0 ? (
                            <div className="saz-day__empty">—</div>
                          ) : (
                            d.payees.map((py) => {
                              const person = personMap.get(py.personId);
                              if (!person) return null;
                              return (
                                <div key={py.personId} className="saz-day__line">
                                  <span className="saz-day__name" title={person.name}>
                                    {person.name.split(/\s+/).slice(0, 2).join(" ")}
                                  </span>
                                  <span className="saz-day__amount">{fmtMoney(py.total)}</span>
                                  {py.remainderAmount > 0 && (
                                    <span className="saz-day__hint">
                                      база {fmtMoney(py.baseAmount)} + ост. {fmtMoney(py.remainderAmount)}
                                    </span>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                        <div className="saz-day__foot">
                          {d.dayTotal > 0 ? `${fmtMoney(Math.round(d.dayTotal))} ₽` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Печать ── */}
      <div className="saz-card saz-card--print">
        <div className="saz-card__head">
          <h3>Печать бланка зарплат</h3>
          <div className="saz-card__actions">
            <button className="saz-btn saz-btn--ghost" onClick={selectAll}>Всех</button>
            <button className="saz-btn saz-btn--ghost" onClick={clearSelection}>Снять выделение</button>
            <button
              className="saz-btn saz-btn--primary"
              onClick={() => {
                if (selectedForBlank.size === 0) {
                  alert("Отметьте галочкой кого печатать (в колонке «Печать» → «в бланк»).");
                  return;
                }
                setShowBlank(true);
              }}
            >
              <Printer size={14} /> Печать бланка ({selectedForBlank.size})
            </button>
          </div>
        </div>
        <div className="saz-hint">
          Бланк печатается на альбомном A4 отдельно от основного раздела «Зарплаты»:
          фамилии слева, дни месяца — по горизонтали, в пересечении — крупная
          ячейка с суммой. Ниже на бланке можно от руки вписать фактически
          выданную сумму. Кнопка «табель» в колонке «Печать» открывает личный
          табель охраны сотрудника (рабочие дни отмечены крестиком, кроме его
          личных смен) с местом для ручной записи зарплаты.
        </div>
      </div>

      {showBlank && (
        <SalaryBlankPrint
          people={people.filter((p) => selectedForBlank.has(p.id))}
          result={result}
          settings={settings}
          onDone={() => setShowBlank(false)}
        />
      )}

      {blankPersonId && (
        <GuardRosterPrint
          person={people.find((p) => p.id === blankPersonId)!}
          allPeople={people}
          settings={settings}
          onDone={() => setBlankPersonId(null)}
        />
      )}
    </div>
  );
}

export default SalaryAutoDistribute;
