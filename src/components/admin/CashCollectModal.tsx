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
  RotateCcw,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { PaymentDetailsModal } from "@/components/admin/PaymentDetailsModal";
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
  cashDestination?: CashKind | null;
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
  const [unlinkedCashBalance, setUnlinkedCashBalance] = useState(0);
  const [includeUnlinkedCash, setIncludeUnlinkedCash] = useState(false);
  const [unlinkedCashKind, setUnlinkedCashKind] = useState<CashKind>("cash");
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
  const [collectionDate, setCollectionDate] = useState<string>(todayIso());

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
        setClosed(data.closed || []);
        const oldBalance = Math.max(0, Number(data.unlinkedCashBalance) || 0);
        setUnlinkedCashBalance(oldBalance);
        setIncludeUnlinkedCash(oldBalance > 0.009);
        setExpenses(data.expenses || []);
        if (data.cardHolder) setCardHolder(String(data.cardHolder));
        // Открываем на самой свежей дате: обычно сдают кассу за сегодня.
        const latest = list.reduce(
          (max, p) => (p.date > max ? p.date : max),
          list[0]?.date || ""
        );
        setActiveDate(latest);
        if (latest) setCollectionDate(latest);
        // Отмечены только платежи выбранного дня.
        setSelected(
          new Set(
            list.filter((p) => p.date === latest).map((p) => p.paymentId)
          )
        );
        const initial: Record<string, CashKind> = {};
        // Безопасный дефолт: наличный платёж остаётся в кассе. На карту ЮМ
        // он уйдёт только после явного выбора кассира — иначе повторное
        // закрытие смены могло случайно обнулить весь новый приход.
        for (const p of list) initial[p.paymentId] = p.cashDestination === "card" ? "card" : "cash";
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
    setCollectionDate(date);
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
        const kind = kinds[p.paymentId] || "cash";
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
    if (includeUnlinkedCash && unlinkedCashBalance > 0.009) {
      if (unlinkedCashKind === "card") card += unlinkedCashBalance;
      else cash += unlinkedCashBalance;
    }
    covered = r2(covered);
    // Выбранное кассиром направление должно отражать сумму платежа один к
    // одному. Раньше сюда неявно вычитались ВСЕ расходы дня, из-за чего
    // «На карту» могло показывать 0 ₽, хотя у выбранного ПЛ была сумма.
    // Расход влияет на общий остаток кассы, но не меняет разметку прихода.
    const c = r2(cash);
    const k = r2(card);
    return {
      cash: c,
      card: k,
      income: r2(c + k + covered),
      total: r2(c + k),
      covered,
    };
  }, [
    dayItems,
    selected,
    splitOf,
    includeUnlinkedCash,
    unlinkedCashBalance,
    unlinkedCashKind,
  ]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setKind(id: string, kind: CashKind) {
    // Кнопки «На карту» / «В кассе» означают полную сумму платежа.
    // Ранее открытая ручная разбивка продолжала иметь приоритет над кнопкой,
    // поэтому визуально выбор менялся, а итог оставался нулевым или старым.
    setSplits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSplitOpen((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setKinds((prev) => ({ ...prev, [id]: kind }));
    // Отметка направления автоматически включает платёж в сдачу.
    setSelected((prev) => new Set(prev).add(id));
  }

  function markAll(kind: CashKind) {
    const ids = new Set(dayItems.filter((p) => selected.has(p.paymentId)).map((p) => p.paymentId));
    const next: Record<string, CashKind> = { ...kinds };
    for (const id of ids) next[id] = kind;
    // Массовая кнопка также должна отменять старые ручные разбивки, иначе
    // выбранное направление не влияет на рассчитанную сумму.
    setSplits((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.has(id))));
    setSplitOpen((prev) => new Set([...prev].filter((id) => !ids.has(id))));
    setKinds(next);
  }

  /** Закрыть все платежи выбранного дня без инкассации (старые долги). */
  async function closeDay() {
    const ids = dayItems.map((p) => p.paymentId);
    if (ids.length === 0) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate)) {
      setError("Укажите дату закрытия смены");
      return;
    }
    const sum = r2(dayItems.reduce((s2, p) => s2 + p.amount, 0));
    if (
      !confirm(
        `Скрыть ${ids.length} старых платеж(ей) на ${fmt(sum)} ₽ ` +
          `документом от ${fmtDate(collectionDate)} без учёта и инкассации?\n\n` +
          "Они только скроются из списка сдачи. Баланс кассы, оплаты, " +
          "платежи и история банка вообще не изменятся."
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
        body: JSON.stringify({
          action: "close",
          date: collectionDate,
          paymentIds: ids,
        }),
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

  async function restoreClosed(paymentIds: string[]) {
    if (paymentIds.length === 0) return;
    const restoring = closed.filter((payment) => paymentIds.includes(payment.paymentId));
    const sum = r2(restoring.reduce((total, payment) => total + payment.amount, 0));
    if (
      !confirm(
        `Вернуть ${restoring.length} платеж(ей) на ${fmt(sum)} ₽?\n\n` +
          "Наличный приход снова войдёт в баланс кассы и появится в списке сдачи."
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
        body: JSON.stringify({ action: "restore", paymentIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось вернуть платежи");
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

    const manualAmount = includeUnlinkedCash ? unlinkedCashBalance : 0;
    // Пустая сдача допустима: это закрытие смены без наличных операций.
    // Перенесённый остаток кассы при этом не списывается и остаётся на месте.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate)) {
      setError("Укажите дату закрытия смены");
      return;
    }
    if (
      !confirm(
        `Закрыть смену за ${fmtDate(collectionDate)}.\n` +
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
        body: JSON.stringify({
          date: collectionDate,
          note: note.trim() || null,
          items,
          unlinkedCashAmount: manualAmount,
          unlinkedCashKind,
        }),
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
    <>
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

          <div className="cashc-close-date">
            <label className="admin-field">
              <span className="admin-label">Дата закрытия смены</span>
              <input
                type="date"
                className="admin-input"
                value={collectionDate}
                onChange={(event) => setCollectionDate(event.target.value)}
              />
            </label>
            <span className="admin-hint">
              Можно выбрать старую дату — документ не будет принудительно закрыт сегодняшним числом.
            </span>
          </div>

          {unlinkedCashBalance > 0.009 && (
            <div className="cashc-unlinked">
              <label className="cashc-unlinked__main">
                <input
                  type="checkbox"
                  checked={includeUnlinkedCash}
                  onChange={(event) => setIncludeUnlinkedCash(event.target.checked)}
                />
                <span>
                  <strong>Старый остаток кассы без привязки к ПЛ</strong>
                  <small>
                    {fmt(unlinkedCashBalance)} ₽ — например, отменённая старая касса без расшифровки платежей
                  </small>
                </span>
              </label>
              <div className="cashc-seg">
                <button
                  type="button"
                  className={`cashc-seg__btn${unlinkedCashKind === "card" ? " cashc-seg__btn--transfer" : ""}`}
                  onClick={() => {
                    setIncludeUnlinkedCash(true);
                    setUnlinkedCashKind("card");
                  }}
                >
                  <CreditCard size={12} /> На карту
                </button>
                <button
                  type="button"
                  className={`cashc-seg__btn${unlinkedCashKind === "cash" ? " cashc-seg__btn--cash" : ""}`}
                  onClick={() => {
                    setIncludeUnlinkedCash(true);
                    setUnlinkedCashKind("cash");
                  }}
                >
                  <Banknote size={12} /> Оставить в кассе
                </button>
              </div>
            </div>
          )}

          {closed.length > 0 && (
            <details className="cashc-closed-settings">
              <summary>
                <Archive size={13} />
                Ранее закрытые без инкассации — {closed.length} плат. на{" "}
                {fmt(r2(closed.reduce((sum, payment) => sum + payment.amount, 0)))} ₽
              </summary>
              <div className="cashc-closed-settings__note">
                Эти платежи закрыла старая версия функции через «вне баланса».
                Нажмите «Вернуть», чтобы восстановить списанную сумму кассы.
              </div>
              <div className="cashc-closed-settings__list">
                {closed.map((payment) => (
                  <div key={payment.paymentId} className="cashc-closed-settings__row">
                    <div>
                      <button
                        type="button"
                        className="cashc-payment-details-link"
                        onClick={() => setDetailPaymentId(payment.paymentId)}
                      >
                        ПЛ-{payment.number} · {payment.counterparty}
                      </button>
                      <span>{fmtDate(payment.date)}</span>
                    </div>
                    <b>{fmt(payment.amount)} ₽</b>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      disabled={saving}
                      onClick={() => restoreClosed([payment.paymentId])}
                    >
                      <RotateCcw size={12} /> Вернуть
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="admin-btn admin-btn--primary admin-btn--sm"
                disabled={saving}
                onClick={() => restoreClosed(closed.map((payment) => payment.paymentId))}
              >
                <RotateCcw size={12} /> Вернуть все в кассу
              </button>
            </details>
          )}


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
                    За выбранную дату нет новых наличных платежей. Можно закрыть
                    нулевую смену — она будет записана в журнал и не изменит остаток кассы.
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
                      title="Только скрыть старые платежи из списка. Баланс и оплаты не изменятся."
                    >
                      <Archive size={12} /> Скрыть старые без учёта
                    </button>
                  </div>

                  <div className="cashc-list">
                    {dayItems.map((p) => {
                      const on = selected.has(p.paymentId);
                      const kind = kinds[p.paymentId] || "cash";
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
                              <button
                                type="button"
                                className="cashc-payment-details-link"
                                onClick={() => setDetailPaymentId(p.paymentId)}
                              >
                                ПЛ-{p.number} · подробнее
                              </button>
                              <span> · {fmtDate(p.date)}</span>
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
              disabled={saving || loading}
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Закрыть {fmtDate(collectionDate)} · на карту {fmt(totals.card)} ₽
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
    <PaymentDetailsModal
      paymentId={detailPaymentId}
      adminPath={adminPath}
      onClose={() => setDetailPaymentId(null)}
    />
    </>
  );
}
