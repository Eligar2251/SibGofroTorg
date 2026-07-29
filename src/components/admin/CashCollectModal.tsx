// src/components/admin/CashCollectModal.tsx
// Закрытие смены: касса показывает ТОЛЬКО наличные платежи, а менеджер
// размечает, что инкассировано и что остаётся физической наличкой.
//
// Направления:
//   • «На карту» — инкассация на карту (по умолчанию Юлия Марковна,
//     имя настраивается в «Настройках»), эта часть уходит из кассы;
//   • «Наличка» — остаётся в кассе и переносится на следующий день.
//
// Основной безналичный счёт в банке к кассе не относится.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CreditCard,
  Loader2,
  X,
  AlertTriangle,
  Check,
  CalendarDays,
  Wallet,
  Scissors,
  Archive,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import {
  DEFAULT_CASH_CARD_HOLDER,
  type CashKind,
} from "@/lib/warehouse-shared";

interface PendingCashPayment {
  paymentId: string;
  number: number;
  date: string;
  counterparty: string;
  amount: number;
  comment: string | null;
}

/** Наличный расход из кассы: ЗП или исходящий платёж налом. */
interface CashExpense {
  kind: "salary" | "payment";
  id: string;
  date: string;
  title: string;
  amount: number;
  comment: string | null;
}

const fmt = (n: number) => n.toLocaleString("ru-RU");
const r2 = (n: number) => Math.round(n * 100) / 100;

const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function fmtDate(raw: string): string {
  if (!raw) return "—";
  const [y, m, d] = raw.split("-");
  return d && m && y ? `${d}.${m}.${y}` : raw;
}

export function CashCollectModal({
  cashBalance,
  onClose,
}: {
  cashBalance: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingCashPayment[]>([]);
  const [expenses, setExpenses] = useState<CashExpense[]>([]);
  /** Ручная разбивка платежа: paymentId -> сколько наличкой и сколько на расход. */
  const [splits, setSplits] = useState<
    Record<string, { cash: string; expense: string }>
  >({});
  /** Какие платежи раскрыты для ручного ввода сумм. */
  const [splitOpen, setSplitOpen] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<Record<string, CashKind>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [cardHolder, setCardHolder] = useState(DEFAULT_CASH_CARD_HOLDER);
  /** Выбранная дата (YYYY-MM-DD). Работаем с платежами одного дня. */
  const [activeDate, setActiveDate] = useState<string>("");

  // Загружаем наличные поступления, ещё не вошедшие в сдачу
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          "/api/admin/warehouse/cash-collections?pending=1"
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Не удалось загрузить платежи");
        if (cancelled) return;
        const list: PendingCashPayment[] = data.pending || [];
        setPending(list);
        setExpenses(data.expenses || []);
        if (data.cardHolder) setCardHolder(String(data.cardHolder));
        // Открываем на самой свежей дате: обычно сдают кассу за сегодня.
        const latest = list.reduce(
          (max, p) => (p.date > max ? p.date : max),
          list[0]?.date || ""
        );
        setActiveDate(latest);
        // Отмечены только платежи выбранного дня.
        setSelected(
          new Set(
            list.filter((p) => p.date === latest).map((p) => p.paymentId)
          )
        );
        const initial: Record<string, CashKind> = {};
        for (const p of list) initial[p.paymentId] = "card";
        setKinds(initial);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка загрузки");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Платежи, сгруппированные по дате: [{date, items, total}], свежие сверху. */
  const days = useMemo(() => {
    const map = new Map<string, PendingCashPayment[]>();
    for (const p of pending) {
      const arr = map.get(p.date);
      if (arr) arr.push(p);
      else map.set(p.date, [p]);
    }
    return [...map.entries()]
      .map(([date, items]) => ({
        date,
        items: items.sort((a, b) => a.number - b.number),
        total: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [pending]);

  /** Платежи выбранного дня — с ними и работает кассир. */
  const dayItems = useMemo(
    () => days.find((d) => d.date === activeDate)?.items || [],
    [days, activeDate]
  );

  /** Переключение дня: выделяем все платежи нового дня, прочие снимаем. */
  function pickDate(date: string) {
    setActiveDate(date);
    const ids = pending.filter((p) => p.date === date).map((p) => p.paymentId);
    setSelected(new Set(ids));
    setError("");
  }

  /** Наличные траты за выбранный день — эти деньги уже ушли из кассы. */
  const dayExpenses = useMemo(
    () => expenses.filter((e) => e.date === activeDate),
    [expenses, activeDate]
  );
  const expensesTotal = useMemo(
    () =>
      Math.round(dayExpenses.reduce((s, e) => s + e.amount, 0) * 100) / 100,
    [dayExpenses]
  );

  /** Разбивка одного платежа: наличка / карта / расход. */
  const splitOf = useCallback(
    (p: PendingCashPayment) => {
      const raw = splits[p.paymentId];
      if (!raw) {
        // Без ручной разбивки — весь платёж одним направлением.
        const kind = kinds[p.paymentId] || "card";
        return kind === "cash"
          ? { cash: p.amount, card: 0, expense: 0, manual: false }
          : { cash: 0, card: p.amount, expense: 0, manual: false };
      }
      const cash = Math.max(0, Number(raw.cash.replace(",", ".")) || 0);
      const expense = Math.max(0, Number(raw.expense.replace(",", ".")) || 0);
      const card = r2(p.amount - cash - expense);
      return { cash: r2(cash), card, expense: r2(expense), manual: true };
    },
    [splits, kinds]
  );

  const totals = useMemo(() => {
    let cash = 0;
    let card = 0;
    let covered = 0;
    for (const p of dayItems) {
      if (!selected.has(p.paymentId)) continue;
      const sp = splitOf(p);
      cash += sp.cash;
      card += sp.card;
      covered += sp.expense;
    }
    covered = r2(covered);
    // Траты, расписанные вручную по платежам, уже вычтены из cash/card —
    // второй раз их вычитать нельзя.
    const rest = Math.max(0, r2(expensesTotal - covered));
    let c = r2(cash - rest);
    let k = r2(card);
    if (c < 0) {
      k = r2(k + c);
      c = 0;
    }
    if (k < 0) k = 0;
    return {
      cash: c,
      card: k,
      /** Приход за день до вычета трат */
      income: r2(c + k + expensesTotal),
      /** Фактически к сдаче */
      total: r2(c + k),
      /** Сколько трат расписано вручную по платежам */
      covered,
    };
  }, [dayItems, selected, splitOf, expensesTotal]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setKind(id: string, kind: CashKind) {
    setKinds((prev) => ({ ...prev, [id]: kind }));
    // Отметка направления автоматически включает платёж в сдачу
    setSelected((prev) => new Set(prev).add(id));
  }

  function markAll(kind: CashKind) {
    const next: Record<string, CashKind> = { ...kinds };
    for (const p of dayItems) {
      if (selected.has(p.paymentId)) next[p.paymentId] = kind;
    }
    setKinds(next);
  }

  /** Закрыть все платежи выбранного дня без инкассации (старые долги). */
  async function closeDay() {
    const ids = dayItems.map((p) => p.paymentId);
    if (ids.length === 0) return;
    const sum = r2(dayItems.reduce((s2, p) => s2 + p.amount, 0));
    if (
      !confirm(
        `Закрыть ${ids.length} платеж(ей) за ${fmtDate(activeDate)} на ${fmt(
          sum
        )} ₽ без инкассации?\n\n` +
          "Они уйдут из списка сдачи и перестанут влиять на остаток кассы. " +
          "Сами платежи останутся в истории банка."
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/warehouse/cash-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", paymentIds: ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось закрыть платежи");
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      setSaving(false);
    }
  }

  async function submit() {
    // Проверяем ручную разбивку до отправки: сумма частей должна
    // совпадать с суммой платежа, иначе сервер вернёт ошибку.
    for (const p of dayItems) {
      if (!selected.has(p.paymentId)) continue;
      const sp = splitOf(p);
      if (!sp.manual) continue;
      if (sp.card < -0.009) {
        setError(
          `ПЛ-${p.number}: наличка + расход больше суммы платежа (${fmt(p.amount)} ₽)`
        );
        return;
      }
    }

    const items = dayItems
      .filter((p) => selected.has(p.paymentId))
      .map((p) => {
        const sp = splitOf(p);
        return {
          paymentId: p.paymentId,
          kind: sp.card > sp.cash ? "card" : "cash",
          cashAmount: sp.cash,
          cardAmount: sp.card,
          expenseAmount: sp.expense,
        };
      });

    if (items.length === 0) {
      setError("Выберите хотя бы один платёж");
      return;
    }
    if (
      !confirm(
        `Закрыть смену за ${fmtDate(activeDate)}.\n` +
          `Приход: ${fmt(totals.income)} ₽` +
          (expensesTotal > 0.009
            ? `\nТраты налом: −${fmt(expensesTotal)} ₽`
            : "") +
          `\nНа карту (${cardHolder}): ${fmt(totals.card)} ₽` +
          `\nОстанется наличными в кассе: ${fmt(totals.cash)} ₽`
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/warehouse/cash-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || null, items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось сдать кассу");
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      setSaving(false);
    }
  }

  // Прогноз остатка после закрытия: вычитается только инкассация на карту,
  // наличная часть выбранной смены остаётся в кассе.
  const balanceAfterClose = r2(cashBalance - totals.card);
  /** Сколько неразмеченных платежей есть за другие дни. */
  const otherDaysTotal = useMemo(
    () =>
      Math.round(
        days
          .filter((d) => d.date !== activeDate)
          .reduce((s, d) => s + d.total, 0) * 100
      ) / 100,
    [days, activeDate]
  );

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
        <div
          className="admin-modal wh-modal cashc-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">Сдача кассы</h3>
            <button
              type="button"
              onClick={onClose}
              className="admin-modal__close"
              aria-label="Закрыть"
            >
              <X size={14} />
            </button>
          </div>

          <p className="admin-modal__desc">
            Платежи наличкой сгруппированы по дням. На карту ({cardHolder})
            уходит только отмеченная часть. Всё, что отмечено «Наличка»,
            остаётся в кассе и переносится на следующий день. Безналичный
            расчётный счёт не затрагивается.
          </p>

          {loading ? (
            <div className="admin-empty" style={{ padding: 24 }}>
              <Loader2 size={20} className="animate-spin" />
              <p>Загружаем платежи…</p>
            </div>
          ) : (
            <>
              {/* ── Дни: выбираем, за какое число сдаём кассу ── */}
              {days.length > 0 && (
                <div className="cashc-days">
                  {days.map((d) => {
                    const on = d.date === activeDate;
                    const isToday = d.date === todayIso();
                    return (
                      <button
                        key={d.date}
                        type="button"
                        className={`cashc-day${on ? " cashc-day--active" : ""}`}
                        onClick={() => pickDate(d.date)}
                        title={`${d.items.length} платеж(ей) на ${fmt(d.total)} ₽`}
                      >
                        <span className="cashc-day__date">
                          <CalendarDays size={12} />
                          {fmtDate(d.date)}
                          {isToday && (
                            <span className="cashc-day__today">сегодня</span>
                          )}
                        </span>
                        <span className="cashc-day__sum">{fmt(d.total)} ₽</span>
                        <span className="cashc-day__count">
                          {d.items.length} плат.
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── Итоги ── */}
              <div className="cashc-totals">
                <div className="cashc-total cashc-total--transfer">
                  <span className="cashc-total__label">
                    <CreditCard size={13} /> На карту ({cardHolder})
                  </span>
                  <strong>{fmt(totals.card)} ₽</strong>
                </div>
                <div className="cashc-total cashc-total--cash">
                  <span className="cashc-total__label">
                    <Banknote size={13} /> Останется в кассе
                  </span>
                  <strong>{fmt(totals.cash)} ₽</strong>
                </div>
                {expensesTotal > 0.009 && (
                  <div className="cashc-total cashc-total--spent">
                    <span className="cashc-total__label">
                      <Wallet size={13} /> Потрачено налом
                    </span>
                    <strong>−{fmt(expensesTotal)} ₽</strong>
                  </div>
                )}
                <div className="cashc-total cashc-total--sum">
                  <span className="cashc-total__label">В кассе после закрытия</span>
                  <strong>{fmt(balanceAfterClose)} ₽</strong>
                </div>
              </div>

              {pending.length === 0 ? (
                <div className="admin-empty" style={{ padding: 20 }}>
                  <p>
                    Все наличные платежи уже закрыты по сменам.
                    {cashBalance > 0.009 && (
                      <>
                        {" "}
                        В кассе остаётся {fmt(cashBalance)} ₽ — это перенесённая
                        наличка прошлых смен и другие движения кассы.
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <>
                  <div className="cashc-bulk">
                    <span className="admin-muted" style={{ fontSize: 12 }}>
                      За {fmtDate(activeDate)}: выбрано{" "}
                      <b>
                        {dayItems.filter((p) => selected.has(p.paymentId)).length}
                      </b>{" "}
                      из {dayItems.length}
                    </span>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => markAll("card")}
                    >
                      Все — на карту
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => markAll("cash")}
                    >
                      Все — оставить в кассе
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm cashc-close-day"
                      onClick={closeDay}
                      disabled={saving}
                      title="Убрать платежи этого дня из кассы без инкассации. Нужно для старых платежей до начала инкассации."
                    >
                      <Archive size={12} /> Закрыть день без сдачи
                    </button>
                  </div>

                  <div className="cashc-list">
                    {dayItems.map((p) => {
                      const on = selected.has(p.paymentId);
                      const kind = kinds[p.paymentId] || "card";
                      const sp = splitOf(p);
                      const isSplit = splitOpen.has(p.paymentId);
                      return (
                        <div
                          key={p.paymentId}
                          className={`cashc-row${on ? "" : " cashc-row--off"}${
                            isSplit ? " cashc-row--split" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(p.paymentId)}
                            aria-label="Включить в сдачу"
                          />
                          <div className="cashc-row__main">
                            <span className="cashc-row__cp">
                              {p.counterparty || "Без контрагента"}
                            </span>
                            <span className="cashc-row__meta">
                              ПЛ-{p.number} · {fmtDate(p.date)}
                            </span>
                          </div>
                          <span className="cashc-row__amount">
                            {fmt(p.amount)} ₽
                          </span>
                          <div className="cashc-seg">
                            <button
                              type="button"
                              className={`cashc-seg__btn${
                                kind === "card"
                                  ? " cashc-seg__btn--transfer"
                                  : ""
                              }`}
                              onClick={() => setKind(p.paymentId, "card")}
                              title={`Инкассация на карту (${cardHolder})`}
                            >
                              <CreditCard size={12} /> На карту
                            </button>
                            <button
                              type="button"
                              className={`cashc-seg__btn${
                                kind === "cash" ? " cashc-seg__btn--cash" : ""
                              }`}
                              onClick={() => setKind(p.paymentId, "cash")}
                              title="Оставить наличными в кассе и перенести на следующий день"
                            >
                              <Banknote size={12} /> В кассе
                            </button>
                            <button
                              type="button"
                              className={`cashc-seg__btn${
                                isSplit ? " cashc-seg__btn--split" : ""
                              }`}
                              onClick={() =>
                                setSplitOpen((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(p.paymentId)) {
                                    next.delete(p.paymentId);
                                    setSplits((sp2) => {
                                      const n = { ...sp2 };
                                      delete n[p.paymentId];
                                      return n;
                                    });
                                  } else {
                                    next.add(p.paymentId);
                                    setSplits((sp2) => ({
                                      ...sp2,
                                      [p.paymentId]: { cash: "", expense: "" },
                                    }));
                                    setSelected((s2) =>
                                      new Set(s2).add(p.paymentId)
                                    );
                                  }
                                  return next;
                                })
                              }
                              title="Разбить платёж вручную: наличка / расход / карта"
                            >
                              <Scissors size={12} /> Разбить
                            </button>
                          </div>

                          {/* ── Ручная разбивка суммы платежа ── */}
                          {isSplit && (
                            <div className="cashc-split">
                              <label className="cashc-split__field">
                                <span>
                                  <Banknote size={11} /> Наличкой в кассу
                                </span>
                                <input
                                  className="admin-input"
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  placeholder="0"
                                  value={splits[p.paymentId]?.cash ?? ""}
                                  onChange={(e) =>
                                    setSplits((prev) => ({
                                      ...prev,
                                      [p.paymentId]: {
                                        cash: e.target.value,
                                        expense:
                                          prev[p.paymentId]?.expense ?? "",
                                      },
                                    }))
                                  }
                                />
                              </label>
                              <label className="cashc-split__field">
                                <span>
                                  <Wallet size={11} /> На расход (ЗП и пр.)
                                </span>
                                <input
                                  className="admin-input"
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  placeholder="0"
                                  value={splits[p.paymentId]?.expense ?? ""}
                                  onChange={(e) =>
                                    setSplits((prev) => ({
                                      ...prev,
                                      [p.paymentId]: {
                                        cash: prev[p.paymentId]?.cash ?? "",
                                        expense: e.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                              <div
                                className={`cashc-split__rest${
                                  sp.card < -0.009 ? " cashc-split__rest--bad" : ""
                                }`}
                              >
                                <CreditCard size={11} /> Остаток на карту:{" "}
                                <b>{fmt(sp.card)} ₽</b>
                                {sp.card < -0.009 && " — превышена сумма платежа"}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Траты налом за этот день ── */}
                  {dayExpenses.length > 0 && (
                    <div className="cashc-spent">
                      <div className="cashc-spent__head">
                        <Wallet size={13} />
                        Потрачено из кассы за {fmtDate(activeDate)}
                        <b className="cashc-spent__sum">
                          −{fmt(expensesTotal)} ₽
                        </b>
                      </div>
                      {dayExpenses.map((e) => (
                        <div key={`${e.kind}-${e.id}`} className="cashc-spent__row">
                          <span className="cashc-spent__title">
                            {e.title}
                            {e.comment && (
                              <span className="cashc-spent__note"> · {e.comment}</span>
                            )}
                          </span>
                          <span className="cashc-spent__amount">
                            −{fmt(e.amount)} ₽
                          </span>
                        </div>
                      ))}
                      <div className="cashc-spent__foot">
                        Приход {fmt(totals.income)} ₽ − траты{" "}
                        {fmt(expensesTotal)} ₽ = <b>{fmt(totals.total)} ₽</b>:{" "}
                        {fmt(totals.card)} ₽ на карту, {fmt(totals.cash)} ₽ остаётся в кассе
                      </div>
                    </div>
                  )}

                  {(otherDaysTotal > 0.009 || balanceAfterClose < -0.009) && (
                    <div className="cashc-hint">
                      <AlertTriangle size={13} />
                      {balanceAfterClose < -0.009 ? (
                        <>
                          Инкассация на карту превышает остаток кассы на{" "}
                          <b>{fmt(Math.abs(balanceAfterClose))} ₽</b>.
                        </>
                      ) : (
                        <>
                          За другие дни ещё не размечено{" "}
                          <b>{fmt(otherDaysTotal)} ₽</b>. Эти платежи и оставленная
                          наличка продолжат числиться в кассе.
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="admin-field" style={{ marginTop: 12 }}>
                <label className="admin-label">Комментарий</label>
                <input
                  className="admin-input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Необязательно"
                  disabled={saving}
                />
              </div>
            </>
          )}

          {error && (
            <div className="admin-error" style={{ marginTop: 10 }}>
              <AlertTriangle size={13} /> {error}
            </div>
          )}

          <div className="admin-modal__actions" style={{ flexWrap: "wrap" }}>
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
              onClick={submit}
              disabled={saving || loading || selected.size === 0}
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Закрыть {fmtDate(activeDate)} · на карту {fmt(totals.card)} ₽
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
