// Фактическая сводка смены кассы и карты ЮМ.
// Документ ничего не переводит и не списывает: он только помечает
// операции и отдельно фиксирует две кассы — наличные и карту ЮМ.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  Check,
  CheckCircle2,
  CreditCard,
  History,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { PaymentDetailsModal } from "@/components/admin/PaymentDetailsModal";

interface PendingCashPayment {
  paymentId: string;
  number: number;
  date: string;
  counterparty: string;
  amount: number;
  kind?: "cash" | "card";
  comment: string | null;
}

interface CashExpense {
  kind: "salary" | "payment";
  id: string;
  date: string;
  title: string;
  amount: number;
  sourceKind?: "cash" | "card";
  comment: string | null;
}

interface DailyCashSummary {
  openingBalance: number;
  /** Наличные, ещё не вошедшие в сохранённую сводку. */
  todayIncoming: number;
  /** Переводы на ЮМ, ещё не вошедшие в сохранённую сводку. */
  todayCardIncoming: number;
  /** Общие расходы двух касс. */
  todayOutgoing: number;
  todayCashOutgoing: number;
  todayCardOutgoing: number;
  closingBalance: number;
  closingCardBalance: number;
}

const fmt = (value: number) => value.toLocaleString("ru-RU", {
  maximumFractionDigits: 2,
});
const round2 = (value: number) => Math.round(value * 100) / 100;

function todayIso(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fmtDate(raw: string): string {
  if (!raw) return "—";
  const [year, month, day] = raw.split("-");
  return day && month && year ? `${day}.${month}.${year}` : raw;
}

export function CashCollectModal({
  cashBalance,
  adminPath,
  onClose,
}: {
  cashBalance: number;
  adminPath: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [detailPaymentId, setDetailPaymentId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCashPayment[]>([]);
  const [closed, setClosed] = useState<PendingCashPayment[]>([]);
  const [expenses, setExpenses] = useState<CashExpense[]>([]);
  const [dailySummaries, setDailySummaries] = useState<Record<string, DailyCashSummary>>({});
  const [activeDate, setActiveDate] = useState(todayIso());
  const [collectionDate, setCollectionDate] = useState(todayIso());
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          "/api/admin/warehouse/cash-collections?pending=1",
          { cache: "no-store" }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить сводку кассы");
        if (cancelled) return;

        const nextPending = Array.isArray(body.pending) ? body.pending : [];
        const nextExpenses = Array.isArray(body.expenses) ? body.expenses : [];
        const nextSummaries = body.dailySummaries && typeof body.dailySummaries === "object"
          ? body.dailySummaries
          : {};
        setPending(nextPending);
        setClosed(Array.isArray(body.closed) ? body.closed : []);
        setExpenses(nextExpenses);
        setDailySummaries(nextSummaries);

        // Открываем последнюю НЕЗАКРЫТУЮ смену. Поэтому 13 августа остаётся
        // выбранным и 14-го, если за 13-е сводку ещё не сохранили.
        const operationDates = [
          ...nextPending.map((payment: PendingCashPayment) => payment.date),
          ...nextExpenses.map((expense: CashExpense) => expense.date),
        ].filter(Boolean).sort((a, b) => b.localeCompare(a));
        const latest = operationDates[0] || todayIso();
        setActiveDate(latest);
        setCollectionDate(latest);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Ошибка загрузки кассы");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => {
    const dates = new Set<string>([
      todayIso(),
      ...pending.map((payment) => payment.date),
      ...expenses.map((expense) => expense.date),
    ]);
    return [...dates]
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort((a, b) => b.localeCompare(a))
      .map((date) => {
        const items = pending.filter((payment) => payment.date === date);
        const expenseItems = expenses.filter((expense) => expense.date === date);
        return {
          date,
          count: items.length + expenseItems.length,
          income: round2(items.reduce((sum, payment) => sum + payment.amount, 0)),
          outgoing: round2(
            expenseItems.reduce((sum, expense) => sum + expense.amount, 0)
          ),
        };
      });
  }, [expenses, pending]);

  const dayItems = useMemo(
    () => pending.filter((payment) => payment.date === activeDate),
    [activeDate, pending]
  );
  const dayExpenses = useMemo(
    () => expenses.filter((expense) => expense.date === activeDate),
    [activeDate, expenses]
  );
  const listedCashIncome = useMemo(
    () =>
      round2(
        dayItems
          .filter((payment) => payment.kind !== "card")
          .reduce((sum, payment) => sum + payment.amount, 0)
      ),
    [dayItems]
  );
  const listedCardIncome = useMemo(
    () =>
      round2(
        dayItems
          .filter((payment) => payment.kind === "card")
          .reduce((sum, payment) => sum + payment.amount, 0)
      ),
    [dayItems]
  );
  const listedCashExpenses = useMemo(
    () =>
      round2(
        dayExpenses
          .filter((expense) => expense.sourceKind !== "card")
          .reduce((sum, expense) => sum + expense.amount, 0)
      ),
    [dayExpenses]
  );
  const listedCardExpenses = useMemo(
    () =>
      round2(
        dayExpenses
          .filter((expense) => expense.sourceKind === "card")
          .reduce((sum, expense) => sum + expense.amount, 0)
      ),
    [dayExpenses]
  );
  const listedExpenses = round2(listedCashExpenses + listedCardExpenses);

  const rawDaySummary = dailySummaries[activeDate];
  const daySummary: DailyCashSummary = rawDaySummary
    ? {
        openingBalance: Number(rawDaySummary.openingBalance) || 0,
        // Для новой сдачи считаем только pending. Поступления из уже
        // сохранённых сводок намеренно не возвращаются в итог.
        todayIncoming: listedCashIncome,
        todayCardIncoming: listedCardIncome,
        todayOutgoing: listedExpenses,
        todayCashOutgoing: listedCashExpenses,
        todayCardOutgoing: listedCardExpenses,
        closingBalance: Number(rawDaySummary.closingBalance) || 0,
        closingCardBalance: Number(rawDaySummary.closingCardBalance) || 0,
      }
    : {
        openingBalance: round2(cashBalance),
        todayIncoming: listedCashIncome,
        todayCardIncoming: listedCardIncome,
        todayOutgoing: listedExpenses,
        todayCashOutgoing: listedCashExpenses,
        todayCardOutgoing: listedCardExpenses,
        closingBalance: round2(cashBalance),
        closingCardBalance: 0,
      };
  const totalDayIncome = round2(listedCashIncome + listedCardIncome);

  function pickDate(date: string) {
    setActiveDate(date);
    setCollectionDate(date);
    setError("");
  }

  async function restoreClosed(paymentIds: string[]) {
    if (paymentIds.length === 0) return;
    if (!confirm("Вернуть выбранные старые платежи в кассовый учёт?")) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/cash-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", paymentIds }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось вернуть платежи");
      router.refresh();
      onClose();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Ошибка сети");
      setSaving(false);
    }
  }

  async function submit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate)) {
      setError("Укажите дату закрытия смены");
      return;
    }
    if (collectionDate !== activeDate) {
      setError("Дата отчёта должна совпадать с выбранным днём");
      return;
    }
    if (dayItems.length === 0 && dayExpenses.length === 0) {
      setError("За выбранный день нет новых платежей или расходов к сдаче");
      return;
    }

    const message =
      `Сохранить фактическую сводку за ${fmtDate(activeDate)}?\n\n` +
      `Новых платежей к сдаче: +${fmt(totalDayIncome)} ₽\n` +
      `Наличными: +${fmt(daySummary.todayIncoming)} ₽\n` +
      `На карту ЮМ: +${fmt(daySummary.todayCardIncoming)} ₽\n` +
      `Перенос наличных: ${fmt(daySummary.openingBalance)} ₽\n` +
      `Расходы всего: −${fmt(daySummary.todayOutgoing)} ₽\n` +
      `Из наличной кассы: −${fmt(daySummary.todayCashOutgoing)} ₽\n` +
      `С карты ЮМ: −${fmt(daySummary.todayCardOutgoing)} ₽\n` +
      `Остаток наличных: ${fmt(daySummary.closingBalance)} ₽\n` +
      `Остаток на ЮМ: ${fmt(daySummary.closingCardBalance)} ₽\n\n` +
      "Сводка только пометит операции: она ничего не переводит и не списывает.";
    if (!confirm(message)) return;

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/cash-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: collectionDate,
          note: note.trim() || `Сводка кассы за ${fmtDate(activeDate)}`,
          items: dayItems.map((payment) => ({
            paymentId: payment.paymentId,
            kind: payment.kind || "cash",
          })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить сводку");
      router.refresh();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Ошибка сети");
      setSaving(false);
    }
  }

  return (
    <>
      <ModalPortal>
        <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
          <div
            className="admin-modal wh-modal cashc-modal"
            style={{ maxWidth: 900, width: "95%" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-modal__head">
              <h3 className="admin-modal__title cashc-title">
                <CheckCircle2 size={18} /> Сводка смены: касса и ЮМ
              </h3>
              <button type="button" onClick={onClose} className="admin-modal__close" aria-label="Закрыть">
                <X size={14} />
              </button>
            </div>

            <div className="cashc-info">
              <Banknote size={17} />
              <span>
                Наличная касса и карта ЮМ учитываются как <b>две отдельные кассы</b>.
                Здесь показаны их новые поступления и расходы; сохранение ничего не списывает.
              </span>
            </div>

            {error && <div className="wh-form-error" style={{ marginBottom: 12 }}>{error}</div>}

            <div className="cashc-form-head">
              <label className="admin-field">
                <span className="admin-label">Дата отчёта</span>
                <input type="date" className="admin-input" value={collectionDate} onChange={(event) => setCollectionDate(event.target.value)} />
              </label>
              <label className="admin-field cashc-form-head__note">
                <span className="admin-label">Примечание</span>
                <input className="admin-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder={`Сводка за ${fmtDate(activeDate)}`} />
              </label>
            </div>

            {loading ? (
              <div className="admin-empty" style={{ padding: 28 }}>
                <Loader2 size={20} className="animate-spin" />
                <p>Собираем фактические операции…</p>
              </div>
            ) : (
              <>
                <div className="cashc-days">
                  {days.map((day) => (
                    <button
                      key={day.date}
                      type="button"
                      className={`cashc-day${day.date === activeDate ? " cashc-day--active" : ""}`}
                      onClick={() => pickDate(day.date)}
                    >
                      <span className="cashc-day__date">
                        <CalendarDays size={12} /> {fmtDate(day.date)}
                        {day.date === todayIso() && <span className="cashc-day__today">сегодня</span>}
                      </span>
                      <span className="cashc-day__sum">+{fmt(day.income)} ₽</span>
                      {day.outgoing > 0 && (
                        <span className="cashc-day__expense">−{fmt(day.outgoing)} ₽ расходов</span>
                      )}
                      <span className="cashc-day__count">{day.count} операций</span>
                    </button>
                  ))}
                </div>

                <div className="cashc-facts">
                  <div className="cashc-fact cashc-fact--carry">
                    <span><History size={15} /> Перенос наличных</span>
                    <strong>+{fmt(daySummary.openingBalance)} ₽</strong>
                    <small>Справочно, не прибыль</small>
                  </div>
                  <div className="cashc-fact cashc-fact--income">
                    <span><ArrowDownLeft size={15} /> Всего к сдаче</span>
                    <strong>+{fmt(totalDayIncome)} ₽</strong>
                    <small>Только ещё не отмеченные ПЛ</small>
                  </div>
                  <div className="cashc-fact cashc-fact--cash">
                    <span><Banknote size={15} /> Наличными к сдаче</span>
                    <strong>+{fmt(daySummary.todayIncoming)} ₽</strong>
                    <small>Без уже сохранённых платежей</small>
                  </div>
                  <div className="cashc-fact cashc-fact--card">
                    <span><CreditCard size={15} /> ЮМ к сдаче</span>
                    <strong>+{fmt(daySummary.todayCardIncoming)} ₽</strong>
                    <small>Без уже сохранённых платежей</small>
                  </div>
                  <div className="cashc-fact cashc-fact--expense">
                    <span><ArrowUpRight size={15} /> Расходы всего</span>
                    <strong>−{fmt(daySummary.todayOutgoing)} ₽</strong>
                    <small>Наличная касса + карта ЮМ</small>
                  </div>
                  <div className="cashc-fact cashc-fact--expense">
                    <span><Banknote size={15} /> Расходы наличными</span>
                    <strong>−{fmt(daySummary.todayCashOutgoing)} ₽</strong>
                    <small>Платежи и зарплаты из кассы</small>
                  </div>
                  <div className="cashc-fact cashc-fact--card">
                    <span><CreditCard size={15} /> Расходы с ЮМ</span>
                    <strong>−{fmt(daySummary.todayCardOutgoing)} ₽</strong>
                    <small>Платежи и зарплаты с карты</small>
                  </div>
                  <div className="cashc-fact cashc-fact--balance">
                    <span><Banknote size={15} /> Остаток наличных</span>
                    <strong>{fmt(daySummary.closingBalance)} ₽</strong>
                    <small>Факт в наличной кассе</small>
                  </div>
                  <div className="cashc-fact cashc-fact--card">
                    <span><CreditCard size={15} /> Остаток на ЮМ</span>
                    <strong>{fmt(daySummary.closingCardBalance)} ₽</strong>
                    <small>Факт во второй кассе</small>
                  </div>
                </div>

                <div className="cashc-ledgers">
                  <section className="cashc-ledger">
                    <header>
                      <div><ArrowDownLeft size={15} /><strong>Новые платежи к сдаче</strong></div>
                      <b>+{fmt(totalDayIncome)} ₽</b>
                    </header>
                    <div className="cashc-ledger__rows">
                      {dayItems.length === 0 ? (
                        <div className="cashc-ledger__empty">
                          Новых поступлений для отметки нет
                        </div>
                      ) : dayItems.map((payment) => {
                        const isCard = payment.kind === "card";
                        return (
                          <button
                            key={payment.paymentId}
                            type="button"
                            className="cashc-ledger__row"
                            onClick={() => setDetailPaymentId(payment.paymentId)}
                          >
                            <span className="cashc-ledger__payment">
                              <span><b>ПЛ-{payment.number}</b> · {payment.counterparty}</span>
                              <em className={`cashc-kind cashc-kind--${isCard ? "card" : "cash"}`}>
                                {isCard ? <CreditCard size={10} /> : <Banknote size={10} />}
                                {isCard ? "Карта ЮМ" : "Наличные"}
                              </em>
                            </span>
                            <strong className={isCard ? "cashc-ledger__card" : undefined}>
                              +{fmt(payment.amount)} ₽
                            </strong>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="cashc-ledger">
                    <header>
                      <div><ArrowUpRight size={15} /><strong>Расходы за день</strong></div>
                      <b className="cashc-ledger__expense">−{fmt(daySummary.todayOutgoing)} ₽</b>
                    </header>
                    <div className="cashc-ledger__rows">
                      {dayExpenses.length === 0 ? (
                        <div className="cashc-ledger__empty">Расходов из двух касс не было</div>
                      ) : dayExpenses.map((expense) => {
                        const isCard = expense.sourceKind === "card";
                        return (
                          <div key={`${expense.kind}-${expense.id}`} className="cashc-ledger__row">
                            <span className="cashc-ledger__payment">
                              <span><b>{expense.title}</b>{expense.comment ? ` · ${expense.comment}` : ""}</span>
                              <em className={`cashc-kind cashc-kind--${isCard ? "card" : "cash"}`}>
                                {isCard ? <CreditCard size={10} /> : <Banknote size={10} />}
                                {isCard ? "Карта ЮМ" : "Наличные"}
                              </em>
                            </span>
                            <strong className={isCard ? "cashc-ledger__card-expense" : "cashc-ledger__expense"}>
                              −{fmt(expense.amount)} ₽
                            </strong>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>

                <div className="cashc-equation">
                  <strong>{fmt(totalDayIncome)} ₽ к сдаче:</strong>
                  <span>{fmt(daySummary.todayIncoming)} ₽ наличными</span>
                  <b>+</b>
                  <span>{fmt(daySummary.todayCardIncoming)} ₽ на ЮМ</span>
                  <span className="cashc-equation__sep" aria-hidden="true" />
                  <strong>−{fmt(daySummary.todayOutgoing)} ₽ расходов:</strong>
                  <span>{fmt(daySummary.todayCashOutgoing)} ₽ наличными</span>
                  <b>+</b>
                  <span>{fmt(daySummary.todayCardOutgoing)} ₽ с ЮМ</span>
                  <span className="cashc-equation__sep" aria-hidden="true" />
                  <span>Остатки:</span>
                  <strong>{fmt(daySummary.closingBalance)} ₽ наличными</strong>
                  <strong>{fmt(daySummary.closingCardBalance)} ₽ на ЮМ</strong>
                  <span>сводка их не изменит</span>
                </div>

                {closed.length > 0 && (
                  <details className="cashc-closed-settings">
                    <summary><Archive size={14} /> Старые скрытые платежи — {closed.length}</summary>
                    <div className="cashc-closed-settings__list">
                      {closed.map((payment) => (
                        <div key={payment.paymentId} className="cashc-closed-settings__row">
                          <button type="button" className="cashc-payment-details-link" onClick={() => setDetailPaymentId(payment.paymentId)}>
                            ПЛ-{payment.number} · {payment.counterparty}
                          </button>
                          <b>{fmt(payment.amount)} ₽</b>
                          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" disabled={saving} onClick={() => restoreClosed([payment.paymentId])}>
                            <RotateCcw size={12} /> Вернуть
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div className="admin-modal__actions cashc-actions">
                  <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose} disabled={saving}>Отмена</button>
                  <button type="button" className="admin-btn admin-btn--primary" onClick={submit} disabled={saving || (dayItems.length === 0 && dayExpenses.length === 0)}>
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    Сохранить сводку смены
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </ModalPortal>

      <PaymentDetailsModal paymentId={detailPaymentId} adminPath={adminPath} onClose={() => setDetailPaymentId(null)} />
    </>
  );
}
