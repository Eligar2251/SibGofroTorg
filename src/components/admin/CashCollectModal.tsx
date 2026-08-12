// src/components/admin/CashCollectModal.tsx
// Автоматическая сдача кассы / Сводка смены (Карта ЮМ + Касса наличными)
//
// Все поступления и расходы автоматически разделены по направлениям:
//   • «Карта ЮМ» — переводы и инкассация на карту (по умолчанию Юлия Марковна),
//     расходы и ЗП с карты ЮМ списаны из поступлений ЮМ, итог сразу на балансе;
//   • «Касса (наличные)» — наличные приходы в кассу и наличные расходы,
//     остаток кассы переносится на следующий день.
//
// При закрытии смены создаётся отчёт в журнале смен, а реальные деньги
// остаются на соответствующих счетах (без принудительного обнуления).
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CreditCard,
  Loader2,
  X,
  Check,
  CalendarDays,
  Archive,
  RotateCcw,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
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

interface CashExpense {
  kind: "salary" | "payment";
  id: string;
  date: string;
  title: string;
  amount: number;
  comment: string | null;
  sourceKind?: "cash" | "card";
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
  const [cardHolder, setCardHolder] = useState(DEFAULT_CASH_CARD_HOLDER);
  const [activeDate, setActiveDate] = useState<string>("");
  const [collectionDate, setCollectionDate] = useState<string>(todayIso());
  const [note, setNote] = useState("");

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
        const latest = list.reduce(
          (max, p) => (p.date > max ? p.date : max),
          list[0]?.date || todayIso()
        );
        setActiveDate(latest);
        if (latest) setCollectionDate(latest);
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

  /** Список дат, за которые есть поступления или расходы. */
  const days = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const p of pending) {
      const cur = map.get(p.date) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total = r2(cur.total + p.amount);
      map.set(p.date, cur);
    }
    for (const e of expenses) {
      if (!map.has(e.date)) map.set(e.date, { count: 0, total: 0 });
    }
    if (map.size === 0) map.set(todayIso(), { count: 0, total: 0 });
    return [...map.entries()]
      .map(([date, info]) => ({
        date,
        count: info.count,
        total: info.total,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [pending, expenses]);

  const dayItems = useMemo(
    () => pending.filter((p) => p.date === activeDate),
    [pending, activeDate]
  );

  const dayExpenses = useMemo(
    () => expenses.filter((e) => e.date === activeDate),
    [expenses, activeDate]
  );

  // ── Автоматическая разбивка по направлениям (Карта ЮМ vs Касса) ──
  const ymCardItems = useMemo(
    () => dayItems.filter((p) => p.cashDestination === "card"),
    [dayItems]
  );
  const cashItems = useMemo(
    () => dayItems.filter((p) => p.cashDestination !== "card"),
    [dayItems]
  );

  const ymCardExpenses = useMemo(
    () => dayExpenses.filter((e) => e.sourceKind === "card"),
    [dayExpenses]
  );
  const cashExpenses = useMemo(
    () => dayExpenses.filter((e) => e.sourceKind !== "card"),
    [dayExpenses]
  );

  const ymCardIncome = useMemo(
    () => r2(ymCardItems.reduce((sum, p) => sum + p.amount, 0)),
    [ymCardItems]
  );
  const cashIncome = useMemo(
    () => r2(cashItems.reduce((sum, p) => sum + p.amount, 0)),
    [cashItems]
  );

  const ymCardExpenseTotal = useMemo(
    () => r2(ymCardExpenses.reduce((sum, e) => sum + e.amount, 0)),
    [ymCardExpenses]
  );
  const cashExpenseTotal = useMemo(
    () => r2(cashExpenses.reduce((sum, e) => sum + e.amount, 0)),
    [cashExpenses]
  );

  const ymCardNet = useMemo(
    () => r2(ymCardIncome - ymCardExpenseTotal),
    [ymCardIncome, ymCardExpenseTotal]
  );
  const cashNet = useMemo(
    () => r2(cashIncome - cashExpenseTotal),
    [cashIncome, cashExpenseTotal]
  );

  const shiftIncomeTotal = useMemo(
    () => r2(ymCardIncome + cashIncome),
    [ymCardIncome, cashIncome]
  );
  const shiftExpenseTotal = useMemo(
    () => r2(ymCardExpenseTotal + cashExpenseTotal),
    [ymCardExpenseTotal, cashExpenseTotal]
  );
  const shiftNetTotal = useMemo(
    () => r2(shiftIncomeTotal - shiftExpenseTotal),
    [shiftIncomeTotal, shiftExpenseTotal]
  );

  function pickDate(date: string) {
    setActiveDate(date);
    setCollectionDate(date);
    setError("");
  }

  async function restoreClosed(paymentIds: string[]) {
    if (paymentIds.length === 0) return;
    const restoring = closed.filter((payment) => paymentIds.includes(payment.paymentId));
    const sum = r2(restoring.reduce((total, payment) => total + payment.amount, 0));
    if (
      !confirm(
        `Вернуть ${restoring.length} платеж(ей) на ${fmt(sum)} ₽?\n\n` +
          "Платежи снова войдут в баланс кассы и появятся в списке сдачи."
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate)) {
      setError("Укажите дату закрытия смены");
      return;
    }
    const msg =
      `Закрыть смену за ${fmtDate(collectionDate)}.\n\n` +
      `Карта ЮМ: приход +${fmt(ymCardIncome)} ₽, расход −${fmt(ymCardExpenseTotal)} ₽ (Итог: ${ymCardNet >= 0 ? '+' : ''}${fmt(ymCardNet)} ₽)\n` +
      `Касса наличные: приход +${fmt(cashIncome)} ₽, расход −${fmt(cashExpenseTotal)} ₽ (Итог: ${cashNet >= 0 ? '+' : ''}${fmt(cashNet)} ₽)\n\n` +
      `Общий результат смены: ${shiftNetTotal >= 0 ? '+' : ''}${fmt(shiftNetTotal)} ₽\n` +
      `(Деньги остаются на счетах без принудительного обнуления).`;
    if (!confirm(msg)) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      const items = dayItems.map((p) => ({
        paymentId: p.paymentId,
        kind: p.cashDestination === "card" ? "card" : "cash",
        cashAmount: p.cashDestination === "card" ? 0 : p.amount,
        cardAmount: p.cashDestination === "card" ? p.amount : 0,
      }));

      const res = await fetch("/api/admin/warehouse/cash-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: collectionDate,
          note: note.trim() || `Смена за ${fmtDate(activeDate)}: Карта ЮМ ${ymCardNet >= 0 ? '+' : ''}${fmt(ymCardNet)} ₽, Касса ${cashNet >= 0 ? '+' : ''}${fmt(cashNet)} ₽`,
          items,
          unlinkedCashAmount: includeUnlinkedCash ? unlinkedCashBalance : 0,
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

  return (
    <>
      <ModalPortal>
        <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
          <div
            className="admin-modal wh-modal cashc-modal"
            style={{ maxWidth: 880, width: "95%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal__head">
              <h3 className="admin-modal__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <CheckCircle2 size={18} style={{ color: "var(--adm-primary)" }} />
                Сдача кассы / Сводка смены
              </h3>
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
              Все платежи и расходы автоматически распределены по направлениям: переводы на{" "}
              <strong>Карту ЮМ ({cardHolder})</strong> отображаются на балансе карты сразу, а{" "}
              <strong>наличка</strong> остаётся в кассе. Расходы и выплаты ЗП автоматически
              списаны с поступлений своего направления. При закрытии смены деньги остаются на счетах.
            </p>

            {error && <div className="wh-form-error" style={{ marginBottom: 12 }}>{error}</div>}

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
              <label className="admin-field" style={{ margin: 0 }}>
                <span className="admin-label">Дата закрытия смены</span>
                <input
                  type="date"
                  className="admin-input"
                  value={collectionDate}
                  onChange={(event) => setCollectionDate(event.target.value)}
                />
              </label>
              <label className="admin-field" style={{ flex: 1, margin: 0 }}>
                <span className="admin-label">Примечание к отчёту смены</span>
                <input
                  type="text"
                  className="admin-input"
                  placeholder={`Смена за ${fmtDate(activeDate)}`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
            </div>

            {loading ? (
              <div className="admin-empty" style={{ padding: 24 }}>
                <Loader2 size={20} className="animate-spin" />
                <p>Загружаем операции смены…</p>
              </div>
            ) : (
              <>
                {/* ── Выбор дня ── */}
                {days.length > 0 && (
                  <div className="cashc-days" style={{ marginBottom: 16 }}>
                    {days.map((d) => {
                      const on = d.date === activeDate;
                      const isToday = d.date === todayIso();
                      return (
                        <button
                          key={d.date}
                          type="button"
                          className={`cashc-day${on ? " cashc-day--active" : ""}`}
                          onClick={() => pickDate(d.date)}
                          title={`Поступлений: ${d.count} плат. на ${fmt(d.total)} ₽`}
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
                            {d.count} плат.
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ── 2 Колонки: Карта ЮМ vs Касса Наличные ── */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
                    gap: 16,
                    marginBottom: 16,
                  }}
                >
                  {/* КОЛОНКА 1: КАРТА ЮМ */}
                  <div
                    style={{
                      background: "var(--adm-card)",
                      border: "1px solid rgba(217, 119, 6, 0.4)",
                      borderRadius: 12,
                      padding: 16,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontWeight: 700,
                        fontSize: 15,
                        color: "var(--adm-amber)",
                        marginBottom: 12,
                        paddingBottom: 8,
                        borderBottom: "1px solid var(--adm-border)",
                      }}
                    >
                      <CreditCard size={18} />
                      Карта ЮМ ({cardHolder})
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: "var(--adm-ink-muted)",
                          marginBottom: 6,
                        }}
                      >
                        <span>ПОСТУПЛЕНИЯ ПЕРЕВОДОМ:</span>
                        <span style={{ color: "var(--adm-pine)" }}>
                          +{fmt(ymCardIncome)} ₽
                        </span>
                      </div>
                      {ymCardItems.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--adm-muted)", fontStyle: "italic", padding: "4px 0" }}>
                          Нет поступлений на карту за этот день
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                          {ymCardItems.map((p) => (
                            <div
                              key={p.paymentId}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontSize: 13,
                                padding: "6px 8px",
                                background: "rgba(16, 185, 129, 0.05)",
                                borderRadius: 6,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                                <ArrowDownLeft size={14} style={{ color: "var(--adm-pine)", flexShrink: 0 }} />
                                <button
                                  type="button"
                                  className="cashc-payment-details-link"
                                  style={{ fontWeight: 600 }}
                                  onClick={() => setDetailPaymentId(p.paymentId)}
                                >
                                  ПЛ-{p.number}
                                </button>
                                <span style={{ color: "var(--adm-ink)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                                  · {p.counterparty}
                                </span>
                              </div>
                              <span style={{ fontWeight: 700, color: "var(--adm-pine)" }}>
                                +{fmt(p.amount)} ₽
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: "var(--adm-ink-muted)",
                          marginBottom: 6,
                        }}
                      >
                        <span>РАСХОДЫ И ЗП С КАРТЫ ЮМ:</span>
                        <span style={{ color: "var(--adm-rust)" }}>
                          −{fmt(ymCardExpenseTotal)} ₽
                        </span>
                      </div>
                      {ymCardExpenses.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--adm-muted)", fontStyle: "italic", padding: "4px 0" }}>
                          Нет расходов с карты за этот день
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                          {ymCardExpenses.map((e) => (
                            <div
                              key={e.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontSize: 13,
                                padding: "6px 8px",
                                background: "rgba(239, 68, 68, 0.05)",
                                borderRadius: 6,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                                <ArrowUpRight size={14} style={{ color: "var(--adm-rust)", flexShrink: 0 }} />
                                <span style={{ fontWeight: 600, color: "var(--adm-ink)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                                  {e.title}
                                </span>
                              </div>
                              <span style={{ fontWeight: 700, color: "var(--adm-rust)" }}>
                                −{fmt(e.amount)} ₽
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        borderTop: "1px solid var(--adm-border)",
                        paddingTop: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      <span>ИТОГ ПО КАРТЕ ЮМ:</span>
                      <span
                        style={{
                          fontSize: 16,
                          color: ymCardNet >= 0 ? "var(--adm-pine)" : "var(--adm-rust)",
                        }}
                      >
                        {ymCardNet >= 0 ? `+${fmt(ymCardNet)}` : fmt(ymCardNet)} ₽
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--adm-muted)", marginTop: 4 }}>
                      * Отображается сразу на балансе карты ЮМ
                    </div>
                  </div>

                  {/* КОЛОНКА 2: КАССА (НАЛИЧНЫЕ) */}
                  <div
                    style={{
                      background: "var(--adm-card)",
                      border: "1px solid rgba(16, 185, 129, 0.4)",
                      borderRadius: 12,
                      padding: 16,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontWeight: 700,
                        fontSize: 15,
                        color: "var(--adm-pine)",
                        marginBottom: 12,
                        paddingBottom: 8,
                        borderBottom: "1px solid var(--adm-border)",
                      }}
                    >
                      <Banknote size={18} />
                      Касса (Наличные деньги)
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: "var(--adm-ink-muted)",
                          marginBottom: 6,
                        }}
                      >
                        <span>ПОСТУПЛЕНИЯ НАЛИЧНЫМИ:</span>
                        <span style={{ color: "var(--adm-pine)" }}>
                          +{fmt(cashIncome)} ₽
                        </span>
                      </div>
                      {cashItems.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--adm-muted)", fontStyle: "italic", padding: "4px 0" }}>
                          Нет наличных поступлений за этот день
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                          {cashItems.map((p) => (
                            <div
                              key={p.paymentId}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontSize: 13,
                                padding: "6px 8px",
                                background: "rgba(16, 185, 129, 0.05)",
                                borderRadius: 6,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                                <ArrowDownLeft size={14} style={{ color: "var(--adm-pine)", flexShrink: 0 }} />
                                <button
                                  type="button"
                                  className="cashc-payment-details-link"
                                  style={{ fontWeight: 600 }}
                                  onClick={() => setDetailPaymentId(p.paymentId)}
                                >
                                  ПЛ-{p.number}
                                </button>
                                <span style={{ color: "var(--adm-ink)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                                  · {p.counterparty}
                                </span>
                              </div>
                              <span style={{ fontWeight: 700, color: "var(--adm-pine)" }}>
                                +{fmt(p.amount)} ₽
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: "var(--adm-ink-muted)",
                          marginBottom: 6,
                        }}
                      >
                        <span>РАСХОДЫ И ЗП НАЛИЧНЫМИ:</span>
                        <span style={{ color: "var(--adm-rust)" }}>
                          −{fmt(cashExpenseTotal)} ₽
                        </span>
                      </div>
                      {cashExpenses.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--adm-muted)", fontStyle: "italic", padding: "4px 0" }}>
                          Нет наличных расходов за этот день
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                          {cashExpenses.map((e) => (
                            <div
                              key={e.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontSize: 13,
                                padding: "6px 8px",
                                background: "rgba(239, 68, 68, 0.05)",
                                borderRadius: 6,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                                <ArrowUpRight size={14} style={{ color: "var(--adm-rust)", flexShrink: 0 }} />
                                <span style={{ fontWeight: 600, color: "var(--adm-ink)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                                  {e.title}
                                </span>
                              </div>
                              <span style={{ fontWeight: 700, color: "var(--adm-rust)" }}>
                                −{fmt(e.amount)} ₽
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        borderTop: "1px solid var(--adm-border)",
                        paddingTop: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      <span>ИТОГ ПО КАССЕ:</span>
                      <span
                        style={{
                          fontSize: 16,
                          color: cashNet >= 0 ? "var(--adm-pine)" : "var(--adm-rust)",
                        }}
                      >
                        {cashNet >= 0 ? `+${fmt(cashNet)}` : fmt(cashNet)} ₽
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--adm-muted)", marginTop: 4 }}>
                      * Остаётся в кассе с переносом на следующий день
                    </div>
                  </div>
                </div>

                {/* ── Общая сводка смены ── */}
                <div
                  style={{
                    background: "var(--adm-steel-pale)",
                    border: "1px solid var(--adm-steel-line)",
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--adm-ink)" }}>
                        Итоговый результат смены за {fmtDate(activeDate)}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--adm-muted)", marginTop: 4 }}>
                        Приходы всего: <strong>+{fmt(shiftIncomeTotal)} ₽</strong>{" "}
                        (ЮМ {fmt(ymCardIncome)} + Касса {fmt(cashIncome)}) · Расходы всего:{" "}
                        <strong>−{fmt(shiftExpenseTotal)} ₽</strong> (ЮМ {fmt(ymCardExpenseTotal)} +
                        Касса {fmt(cashExpenseTotal)})
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        color: shiftNetTotal >= 0 ? "var(--adm-pine)" : "var(--adm-rust)",
                        padding: "4px 12px",
                        background: "var(--adm-card)",
                        borderRadius: 8,
                        border: "1px solid var(--adm-border)",
                      }}
                    >
                      {shiftNetTotal >= 0 ? `+${fmt(shiftNetTotal)}` : fmt(shiftNetTotal)} ₽
                    </div>
                  </div>
                </div>

                {closed.length > 0 && (
                  <details className="cashc-closed-settings" style={{ marginBottom: 16 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                      <Archive size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
                      Ранее скрытые платежи без учёта — {closed.length} плат.
                    </summary>
                    <div className="cashc-closed-settings__list" style={{ marginTop: 8 }}>
                      {closed.map((payment) => (
                        <div key={payment.paymentId} className="cashc-closed-settings__row" style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--adm-border)" }}>
                          <div>
                            <button
                              type="button"
                              className="cashc-payment-details-link"
                              onClick={() => setDetailPaymentId(payment.paymentId)}
                            >
                              ПЛ-{payment.number} · {payment.counterparty}
                            </button>
                            <span style={{ fontSize: 12, color: "var(--adm-muted)" }}> · {fmtDate(payment.date)}</span>
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
                  </details>
                )}

                {/* ── Кнопка закрытия смены ── */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
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
                    disabled={saving}
                    style={{ padding: "10px 20px", fontSize: 14, fontWeight: 700 }}
                  >
                    {saving ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Check size={16} />
                    )}
                    Закрыть смену и сохранить отчёт
                  </button>
                </div>
              </>
            )}
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
