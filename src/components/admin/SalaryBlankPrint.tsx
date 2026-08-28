// =========================================================
// FILE: src/components/admin/SalaryBlankPrint.tsx
// Печатные формы:
//   1) SalaryBlankPrint — общий бланк выдачи зарплат (альбомный A4),
//      фамилии по вертикали, дни по горизонтали, крупные ячейки
//      с суммами и местом для подписи/фактической суммы от руки.
//   2) GuardRosterPrint — личный табель охраны на сотрудника:
//      все дни месяца в виде сетки, рабочие дни охранника (чужие
//      смены) отмечены крестиком, его личные дни — жёлтые и пустые
//      (туда он выходит), а внизу — крупная ячейка для ручной записи
//      выданной зарплаты.
// =========================================================

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SITE_NAME } from "@/lib/seo";

const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
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
  salary: number;
  payDays: number[];
}
interface PayeeEntry {
  personId: string;
  baseAmount: number;
  remainderAmount: number;
  total: number;
}
interface DistDay {
  weekIdx: number;
  date: Date;
  iso: string;
  weekday: number;
  payees: PayeeEntry[];
  isRemainderDay: boolean;
  dayTotal: number;
}
interface DistResult {
  days: DistDay[];
  perPerson: { personId: string; total: number; base: number; remainder: number; leftover: number }[];
  grandTotal: number;
}
interface DistSettings {
  dailyPool: number;
  weeks: number;
  remainderWeekdays: number[];
  periodLabel: string;
}

// ─────────── helpers ───────────
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function mondayOf(d: Date): Date {
  const r = new Date(d);
  const wd = r.getDay();
  const diff = wd === 0 ? -6 : 1 - wd;
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}
function fmtMoney(n: number): string {
  if (!isFinite(n)) return "";
  const v = Math.round(n);
  if (v === 0) return "";
  return v.toLocaleString("ru-RU");
}

// ─────────── Общий бланк ───────────
export function SalaryBlankPrint({
  people,
  result,
  settings,
  onDone,
}: {
  people: Person[];
  result: DistResult;
  settings: DistSettings;
  onDone: () => void;
}) {
  const [printing, setPrinting] = useState(false);
  const triggered = useRef(false);

  const days = useMemo(
    () => [...result.days].sort((a, b) => a.date.getTime() - b.date.getTime()),
    [result.days]
  );

  const perPersonMap = useMemo(() => {
    const m = new Map<string, { total: number; base: number; remainder: number; leftover: number }>();
    for (const it of result.perPerson) m.set(it.personId, it);
    return m;
  }, [result.perPerson]);

  useEffect(() => {
    const prev = document.title;
    document.title = `Бланк зарплат — ${settings.periodLabel}`;
    function onAfter() {
      document.title = prev;
    }
    window.addEventListener("afterprint", onAfter);
    return () => {
      document.title = prev;
      window.removeEventListener("afterprint", onAfter);
    };
  }, [settings.periodLabel]);

  function doPrint() {
    setPrinting(true);
    requestAnimationFrame(() => window.print());
  }

  return (
    <div className="saz-print-root">
      {!printing && (
        <div className="saz-print-toolbar">
          <button className="saz-btn saz-btn--primary" onClick={doPrint}>
            🖨 Печать
          </button>
          <button className="saz-btn" onClick={onDone}>
            ✕ Закрыть
          </button>
        </div>
      )}

      <div className="saz-print-sheet">
        <div className="saz-b-head">
          <div className="saz-b-head__title">Ведомость выдачи заработной платы</div>
          <div className="saz-b-head__period">{settings.periodLabel}</div>
          <div className="saz-b-head__company">{SITE_NAME}</div>
        </div>

        <table className="saz-b-grid">
          <thead>
            <tr>
              <th rowSpan={2} className="saz-b-name">
                ФИО
              </th>
              {days.map((d) => (
                <th
                  key={d.iso}
                  className={
                    d.weekday === 0 || d.weekday === 6 ? "saz-b-weekend" : ""
                  }
                  title={`${d.date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} · ${WEEKDAYS_LONG[d.weekday]}`}
                >
                  <span className="saz-b-daynum">{d.date.getDate()}</span>
                  <span className="saz-b-wd">{WEEKDAYS_SHORT[d.weekday]}</span>
                </th>
              ))}
              <th rowSpan={2} className="saz-b-total-col">
                Итого
              </th>
              <th rowSpan={2} className="saz-b-sign-col">
                Подпись
              </th>
            </tr>
            <tr>
              {days.map((d) => (
                <th
                  key={`w-${d.iso}`}
                  className={`saz-b-dow${d.weekday === 0 || d.weekday === 6 ? " saz-b-weekend" : ""}`}
                >
                  {WEEKDAYS_SHORT[d.weekday].toLowerCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const stats = perPersonMap.get(p.id);
              return (
                <tr key={p.id}>
                  <td className="saz-b-name saz-b-name--body">{p.name}</td>
                  {days.map((d) => {
                    const py = d.payees.find((x) => x.personId === p.id);
                    const isPay = !!py;
                    const isPayDay = p.payDays.includes(d.weekday);
                    return (
                      <td
                        key={d.iso}
                        className={`saz-b-cell${
                          isPay ? " saz-b-cell--pay" : ""
                        }${d.isRemainderDay && isPay && py && py.remainderAmount > 0 ? " saz-b-cell--rem" : ""}${
                          d.weekday === 0 || d.weekday === 6 ? " saz-b-cell--weekend" : ""
                        }`}
                      >
                        {isPay ? (
                          <>
                            <span className="saz-b-amount">{fmtMoney(py!.total)}</span>
                            <span className="saz-b-handwrite">руками:</span>
                          </>
                        ) : isPayDay ? null : null}
                      </td>
                    );
                  })}
                  <td className="saz-b-total-col saz-b-num">
                    {fmtMoney(stats?.total || 0)}
                  </td>
                  <td className="saz-b-sign-col" />
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="saz-b-name saz-b-grand">Итого за день:</td>
              {days.map((d) => (
                <td key={d.iso} className="saz-b-num saz-b-daytotal">
                  {fmtMoney(d.dayTotal)}
                </td>
              ))}
              <td className="saz-b-num saz-b-grandtotal">
                {fmtMoney(
                  people.reduce(
                    (s, p) => s + (perPersonMap.get(p.id)?.total || 0),
                    0
                  )
                )}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div className="saz-b-notes">
          <div>
            <b>Примечание:</b> жёлтым отмечены основные дни выплат, голубым —
            выдача остатков до полного оклада. В каждой ячейке указана сумма к
            выдаче, строкой ниже можно вписать фактически выданную сумму от руки.
          </div>
        </div>

        <div className="saz-b-sign">
          <span>Выдал: ______________________</span>
          <span>Дата: «____» ______________ 20____ г.</span>
        </div>
      </div>
    </div>
  );
}

// ─────────── Личный табель охраны ───────────
export function GuardRosterPrint({
  person,
  allPeople,
  settings,
  onDone,
}: {
  person: Person;
  allPeople: Person[];
  settings: DistSettings;
  onDone: () => void;
}) {
  const [printing, setPrinting] = useState(false);
  const triggered = useRef(false);

  // Строим 4-недельный период = месяц относительно текущей недели
  const weeks = settings.weeks;
  const curMon = mondayOf(new Date());
  const start = addDays(curMon, -(weeks - 1) * 7);
  const end = addDays(curMon, 6 + (weeks - 1) * 7);
  // Отдельные переменные для зависимостей: объект Date каждый рендер новый,
  // а по времени сравнение стабильное (правило react-hooks требует
  // простых выражений в списке зависимостей).
  const startTime = start.getTime();
  const endTime = end.getTime();

  // Все дни периода
  const periodDays = useMemo(() => {
    const arr: Date[] = [];
    for (let d = new Date(startTime); d.getTime() <= endTime; d = addDays(d, 1)) {
      arr.push(new Date(d));
    }
    return arr;
  }, [startTime, endTime]);

  // Распределение: кто получает в какой день (для пометки «кто дежурит»).
  // По правилам из опроса: в каждый день работают те, у кого этот weekday
  // указан как день выплаты + если нет ни у кого, то... в рамках упрощённой
  // логики — все люди, у кого этот день отмечен — дежурят. Остальные дни
  // помечаем крестиком как «выход» для выбранного сотрудника. То есть:
  // его личные дни = person.payDays, в них ячейка не содержит крестик
  // (место для подписи), в остальные дни — крест.
  // Чтобы табель был полезен и для нескольких сторожей сразу, ниже ячейки
  // пишем инициалы дежурящего.

  useEffect(() => {
    const prev = document.title;
    document.title = `Табель охраны — ${person.name}`;
    function onAfter() {
      document.title = prev;
    }
    window.addEventListener("afterprint", onAfter);
    return () => {
      document.title = prev;
      window.removeEventListener("afterprint", onAfter);
    };
  }, [person.name]);

  function doPrint() {
    setPrinting(true);
    requestAnimationFrame(() => window.print());
  }

  function initials(name: string): string {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("");
  }

  function guardsOn(weekday: number): Person[] {
    return allPeople.filter(
      (p: Person) => p.payDays.includes(weekday) && p.id !== person.id
    );
  }

  // Разбиваем на недели для удобной печати (7 дней в строке).
  const weeksArr: Date[][] = [];
  for (let i = 0; i < periodDays.length; i += 7) {
    weeksArr.push(periodDays.slice(i, i + 7));
  }

  return (
    <div className="saz-print-root">
      {!printing && (
        <div className="saz-print-toolbar">
          <button className="saz-btn saz-btn--primary" onClick={doPrint}>
            🖨 Печать
          </button>
          <button className="saz-btn" onClick={onDone}>
            ✕ Закрыть
          </button>
        </div>
      )}

      <div className="saz-print-sheet saz-roster">
        <div className="saz-b-head">
          <div className="saz-b-head__title">Личный табель дежурств охраны</div>
          <div className="saz-b-head__period">
            {person.name} · {settings.periodLabel}
          </div>
          <div className="saz-b-head__company">{SITE_NAME}</div>
        </div>

        <div className="saz-r-hint">
          ✕ — выходной (не моя смена), в пустые (жёлтые) ячейки выходит
          <b> {person.name.split(/\s+/)[0]}</b>. Ниже ячейки указаны инициалы
          дежурного. Телефон сотрудника: {person.name}
        </div>

        {weeksArr.map((week, wi) => (
          <table key={wi} className="saz-r-grid">
            <thead>
              <tr>
                {week.map((d) => (
                  <th
                    key={d.toISOString()}
                    className={d.getDay() === 0 || d.getDay() === 6 ? "saz-b-weekend" : ""}
                  >
                    <span className="saz-b-daynum">{d.getDate()}</span>
                    <span className="saz-b-wd">{WEEKDAYS_SHORT[d.getDay()]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {week.map((d) => {
                  const wd = d.getDay();
                  const isMine = person.payDays.includes(wd);
                  const others = guardsOn(wd);
                  return (
                    <td
                      key={d.toISOString()}
                      className={`saz-r-cell${isMine ? " saz-r-cell--mine" : ""}${
                        wd === 0 || wd === 6 ? " saz-b-weekend" : ""
                      }`}
                    >
                      <span className="saz-r-mark">{isMine ? "" : "✕"}</span>
                      {others.length > 0 && (
                        <span className="saz-r-others">
                          {others.map((o: Person) => initials(o.name)).join(" / ")}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        ))}

        <div className="saz-r-salary">
          <div className="saz-r-salary__label">
            Заработная плата за период (вписать от руки):
          </div>
          <div className="saz-r-salary__box">
            <div className="saz-r-salary__amount">___________________________ ₽</div>
            <div className="saz-r-salary__small">
              прописью: _________________________________________________
            </div>
          </div>
          <div className="saz-r-salary__row">
            <span>Выдал: ______________________</span>
            <span>Получил: ______________________</span>
          </div>
          <div className="saz-r-salary__row">
            <span>Дата: «____» ______________ 20____ г.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
