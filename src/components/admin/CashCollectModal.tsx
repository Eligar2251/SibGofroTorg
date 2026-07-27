// src/components/admin/CashCollectModal.tsx
// Сдача кассы: касса показывает ТОЛЬКО наличные платежи, а менеджер
// размечает, куда каждый из них ушёл.
//
// Направления сдачи:
//   • «На карту» — инкассация на карту (по умолчанию Юлия Марковна,
//     имя настраивается в «Настройках»);
//   • «Наличные» — виртуальная карта «наличка», куда уходит сданная касса.
//
// Основной безналичный счёт в банке к кассе не относится и здесь
// не участвует: его платежи в список не попадают и остаток не меняется.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CreditCard,
  Loader2,
  X,
  AlertTriangle,
  Check,
  CalendarDays,
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

const fmt = (n: number) => n.toLocaleString("ru-RU");

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

  const totals = useMemo(() => {
    let cash = 0;
    let card = 0;
    for (const p of dayItems) {
      if (!selected.has(p.paymentId)) continue;
      if (kinds[p.paymentId] === "cash") cash += p.amount;
      else card += p.amount;
    }
    return {
      cash: Math.round(cash * 100) / 100,
      card: Math.round(card * 100) / 100,
      total: Math.round((cash + card) * 100) / 100,
    };
  }, [dayItems, selected, kinds]);

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

  async function submit() {
    const items = dayItems
      .filter((p) => selected.has(p.paymentId))
      .map((p) => ({
        paymentId: p.paymentId,
        kind: kinds[p.paymentId] === "cash" ? "cash" : "card",
      }));

    if (items.length === 0) {
      setError("Выберите хотя бы один платёж");
      return;
    }
    if (
      !confirm(
        `Сдать кассу за ${fmtDate(activeDate)}: на карту (${cardHolder}) ${fmt(
          totals.card
        )} ₽, наличными ${fmt(totals.cash)} ₽. Итого ${fmt(totals.total)} ₽?`
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

  // Часть остатка кассы, не покрытая размеченными платежами: старые наличные
  // поступления без разметки или снятые галочки.
  const uncovered = Math.round((cashBalance - totals.total) * 100) / 100;
  /** Сколько наличных ждёт сдачи за другие дни — останется в кассе. */
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
            Платежи за наличку сгруппированы по дням. Выберите день и
            отметьте, куда уходят деньги: инкассацией на карту ({cardHolder})
            или наличными. Безналичный счёт в банке не затрагивается.
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
                    <Banknote size={13} /> Наличными
                  </span>
                  <strong>{fmt(totals.cash)} ₽</strong>
                </div>
                <div className="cashc-total cashc-total--sum">
                  <span className="cashc-total__label">Итого к сдаче</span>
                  <strong>{fmt(totals.total)} ₽</strong>
                </div>
              </div>

              {pending.length === 0 ? (
                <div className="admin-empty" style={{ padding: 20 }}>
                  <p>
                    Нет наличных поступлений к сдаче — все платежи за наличку
                    уже сданы.
                    {cashBalance > 0.009 && (
                      <>
                        {" "}
                        Остаток кассы {fmt(cashBalance)} ₽ — это движения без
                        привязки к платежам (например, ручные корректировки).
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
                      Все — наличные
                    </button>
                  </div>

                  <div className="cashc-list">
                    {dayItems.map((p) => {
                      const on = selected.has(p.paymentId);
                      const kind = kinds[p.paymentId] || "card";
                      return (
                        <div
                          key={p.paymentId}
                          className={`cashc-row${on ? "" : " cashc-row--off"}`}
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
                              title="Наличные (виртуальная карта «наличка»)"
                            >
                              <Banknote size={12} /> Наличка
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(otherDaysTotal > 0.009 || uncovered < -0.009) && (
                    <div className="cashc-hint">
                      <AlertTriangle size={13} />
                      {uncovered < -0.009 ? (
                        <>
                          Сумма сдачи превышает остаток кассы на{" "}
                          <b>{fmt(Math.abs(uncovered))} ₽</b>.
                        </>
                      ) : (
                        <>
                          За другие дни ждёт сдачи ещё{" "}
                          <b>{fmt(otherDaysTotal)} ₽</b> — они останутся
                          в кассе, сдать их можно отдельно.
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
              Сдать за {fmtDate(activeDate)} — {fmt(totals.total)} ₽
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
