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
        // По умолчанию всё выбрано и уходит на карту (инкассация)
        setSelected(new Set(list.map((p) => p.paymentId)));
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

  const totals = useMemo(() => {
    let cash = 0;
    let card = 0;
    for (const p of pending) {
      if (!selected.has(p.paymentId)) continue;
      if (kinds[p.paymentId] === "cash") cash += p.amount;
      else card += p.amount;
    }
    return {
      cash: Math.round(cash * 100) / 100,
      card: Math.round(card * 100) / 100,
      total: Math.round((cash + card) * 100) / 100,
    };
  }, [pending, selected, kinds]);

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
    for (const p of pending) {
      if (selected.has(p.paymentId)) next[p.paymentId] = kind;
    }
    setKinds(next);
  }

  async function submit() {
    const items = pending
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
        `Сдать кассу: на карту (${cardHolder}) ${fmt(
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
            В списке только наличные платежи кассы. Отметьте, куда уходят
            деньги: инкассацией на карту ({cardHolder}) или наличными.
            Основной безналичный счёт в банке не затрагивается.
          </p>

          {loading ? (
            <div className="admin-empty" style={{ padding: 24 }}>
              <Loader2 size={20} className="animate-spin" />
              <p>Загружаем платежи…</p>
            </div>
          ) : (
            <>
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
                    Нет наличных поступлений к сдаче — все наличные платежи
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
                      Выбрано: <b>{selected.size}</b> из {pending.length}
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
                    {pending.map((p) => {
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

                  {Math.abs(uncovered) > 0.009 && (
                    <div className="cashc-hint">
                      <AlertTriangle size={13} />
                      {uncovered > 0 ? (
                        <>
                          В кассе останется <b>{fmt(uncovered)} ₽</b> — это
                          невыбранные платежи или движения кассы без привязки
                          к платежам.
                        </>
                      ) : (
                        <>
                          Сумма сдачи превышает остаток кассы на{" "}
                          <b>{fmt(Math.abs(uncovered))} ₽</b>.
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
              Сдать {fmt(totals.total)} ₽
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
