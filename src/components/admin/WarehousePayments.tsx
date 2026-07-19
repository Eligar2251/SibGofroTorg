// =========================================================
// FILE: src/components/admin/WarehousePayments.tsx
// Банк: форма платежа + отметка об оплате + удаление
// =========================================================

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  X,
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle,
  Undo2,
} from "lucide-react";

export interface DealLinkOption {
  id: string;
  number: number;
  date: string;
  customerName: string;
  total: number;
  status: string;
  /** Сколько уже оплачено по этому заказу (входящие оплаченные) */
  paidAmount: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function PaymentForm({ deals }: { deals: DealLinkOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<"incoming" | "outgoing">(
    "incoming"
  );
  const [date, setDate] = useState(todayIso());
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [isPaid, setIsPaid] = useState(true);
  const [comment, setComment] = useState("");
  const [selectedDeals, setSelectedDeals] = useState<string[]>([]);

  const activeDeals = useMemo(
    () => deals.filter((d) => d.status !== "cancelled"),
    [deals]
  );

  function autoAmount(ids: string[], dir: "incoming" | "outgoing"): number {
    return ids.reduce((sum, id) => {
      const d = deals.find((x) => x.id === id);
      if (!d) return sum;
      if (dir === "incoming") {
        // Остаток к оплате по заказу
        return sum + Math.max(0, d.total - d.paidAmount);
      }
      // Исходящий (поставщику): ориентир — полная сумма заказов
      return sum + d.total;
    }, 0);
  }

  function toggleDeal(id: string) {
    setSelectedDeals((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      if (!amountTouched) {
        const auto = autoAmount(next, direction);
        setAmount(auto > 0 ? String(auto) : "");
      }
      return next;
    });
  }

  function resetForm() {
    setDirection("incoming");
    setDate(todayIso());
    setCounterparty("");
    setAmount("");
    setAmountTouched(false);
    setIsPaid(true);
    setComment("");
    setSelectedDeals([]);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const amountNum = Number(amount);
    if (!counterparty.trim()) {
      setError("Укажите контрагента");
      return;
    }
    if (!amountNum || amountNum <= 0) {
      setError("Укажите сумму платежа");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/warehouse/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          direction,
          counterparty: counterparty.trim(),
          dealIds: selectedDeals,
          amount: amountNum,
          isPaid,
          comment: comment.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Не удалось сохранить платёж");
        setSaving(false);
        return;
      }
      setOpen(false);
      resetForm();
      router.refresh();
    } catch {
      setError("Ошибка сети");
    }
    setSaving(false);
  }

  return (
    <>
      <button
        type="button"
        className="admin-btn admin-btn--primary"
        onClick={() => setOpen(true)}
      >
        <Plus size={15} /> Новый платёж
      </button>

      {open && (
        <div className="admin-modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="admin-modal wh-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">Платёж</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="admin-modal__close"
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="wh-direction">
                <button
                  type="button"
                  className={`wh-direction__btn wh-direction__btn--in${
                    direction === "incoming" ? " wh-direction__btn--active" : ""
                  }`}
                  onClick={() => {
                    setDirection("incoming");
                    if (!amountTouched && selectedDeals.length > 0) {
                      const auto = autoAmount(selectedDeals, "incoming");
                      setAmount(auto > 0 ? String(auto) : "");
                    }
                  }}
                >
                  <ArrowDownLeft size={14} /> Поступление
                </button>
                <button
                  type="button"
                  className={`wh-direction__btn wh-direction__btn--out${
                    direction === "outgoing" ? " wh-direction__btn--active" : ""
                  }`}
                  onClick={() => {
                    setDirection("outgoing");
                    if (!amountTouched && selectedDeals.length > 0) {
                      const auto = autoAmount(selectedDeals, "outgoing");
                      setAmount(auto > 0 ? String(auto) : "");
                    }
                  }}
                >
                  <ArrowUpRight size={14} /> Расход (поставщику)
                </button>
              </div>

              <div className="wh-form-grid">
                <div className="admin-field">
                  <label className="admin-label">Дата</label>
                  <input
                    type="date"
                    className="admin-input"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">
                    {direction === "incoming" ? "Плательщик *" : "Получатель *"}
                  </label>
                  <input
                    type="text"
                    className="admin-input"
                    value={counterparty}
                    onChange={(e) => setCounterparty(e.target.value)}
                    placeholder={
                      direction === "incoming"
                        ? "От кого платёж"
                        : "Поставщик"
                    }
                    required
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Сумма, ₽ *</label>
                  <input
                    type="number"
                    className="admin-input"
                    min={0}
                    step={0.01}
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setAmountTouched(true);
                    }}
                    required
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Комментарий</label>
                  <input
                    type="text"
                    className="admin-input"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={
                      direction === "outgoing"
                        ? "Например: фура с завода"
                        : "Необязательно"
                    }
                  />
                </div>
              </div>

              <div className="admin-field">
                <label className="admin-label">
                  Связанные заказы{" "}
                  <span className="wh-label-hint">
                    (можно несколько — сумма подставится автоматически)
                  </span>
                </label>
                {activeDeals.length === 0 ? (
                  <div className="wh-deal-pick__empty">
                    Нет заказов для привязки
                  </div>
                ) : (
                  <div className="wh-deal-pick">
                    {activeDeals.slice(0, 30).map((d) => {
                      const selected = selectedDeals.includes(d.id);
                      const rest = Math.max(0, d.total - d.paidAmount);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          className={`wh-deal-chip${
                            selected ? " wh-deal-chip--active" : ""
                          }`}
                          onClick={() => toggleDeal(d.id)}
                        >
                          <span className="wh-deal-chip__title">
                            №{d.number} · {d.customerName}
                          </span>
                          <span className="wh-deal-chip__meta">
                            {d.status === "completed"
                              ? "проведён"
                              : "новый"}
                            {" · "}
                            {direction === "incoming"
                              ? `осталось ${fmt(rest)} ₽`
                              : `${fmt(d.total)} ₽`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <label className="wh-paid-toggle">
                <input
                  type="checkbox"
                  checked={isPaid}
                  onChange={(e) => setIsPaid(e.target.checked)}
                />
                <span>
                  {isPaid
                    ? "Оплачен — учтён в балансе банка"
                    : "Ожидается — в балансе не учитывается"}
                </span>
              </label>

              {error && <div className="wh-form-error">{error}</div>}

              <div className="wh-form-footer">
                <div className="wh-form-total">
                  Сумма: <strong>{fmt(Number(amount) || 0)} ₽</strong>
                </div>
                <div className="admin-form-actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    onClick={() => setOpen(false)}
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
                    Сохранить платёж
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Действия по платежу ─────────────────────────────────

export function PaymentControls({
  paymentId,
  isPaid,
}: {
  paymentId: string;
  isPaid: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function togglePaid() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/warehouse/payments/${paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: !isPaid }),
      });
      if (res.ok) router.refresh();
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirm("Удалить платёж из учёта?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/warehouse/payments/${paymentId}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  return (
    <div className="wh-pay-controls">
      <button
        type="button"
        onClick={togglePaid}
        disabled={saving}
        className={`admin-status__btn ${
          isPaid
            ? "admin-status__btn--outline-red"
            : "admin-status__btn--primary"
        }`}
        title={isPaid ? "Вернуть в ожидание" : "Отметить оплаченным"}
      >
        {saving ? (
          <Loader2 size={14} className="animate-spin" />
        ) : isPaid ? (
          <Undo2 size={14} />
        ) : (
          <CheckCircle size={14} />
        )}
        {isPaid ? "В ожидание" : "Оплачен"}
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={saving}
        className="admin-status__btn admin-status__btn--delete"
        title="Удалить платёж"
      >
        <Trash2 size={14} />
        Удалить
      </button>
    </div>
  );
}
