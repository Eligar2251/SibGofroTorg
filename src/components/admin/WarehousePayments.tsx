// =========================================================
// FILE: src/components/admin/WarehousePayments.tsx
// Банк: форма платежа (поступление/расход, привязка к заказам
// или поступлениям, автозаполнение контрагента и суммы),
// проведение, редактирование, удаление.
// Платёж всегда создаётся «в ожидании» и потом проводится кнопкой.
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
  Pencil,
} from "lucide-react";
import { includedVat, VAT_RATE } from "@/lib/vat";
import type { CounterpartyOption } from "@/components/admin/WarehouseCounterparties";

export interface DealLinkOption {
  id: string;
  number: number;
  date: string;
  customerName: string;
  total: number;
  status: string;
  /** Сколько уже оплачено по этому заказу (входящие проведённые) */
  paidAmount: number;
}

export interface ReceiptLinkOption {
  id: string;
  number: number;
  date: string;
  supplier: string;
  total: number;
  /** Сколько уже оплачено поставщику по этому поступлению */
  paidAmount: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

type LinkMode = "deals" | "receipts" | "none";

export function PaymentForm({
  deals,
  receipts,
  counterparties = [],
}: {
  deals: DealLinkOption[];
  receipts: ReceiptLinkOption[];
  counterparties?: CounterpartyOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<"incoming" | "outgoing">(
    "incoming"
  );
  const [linkMode, setLinkMode] = useState<LinkMode>("deals");
  const [date, setDate] = useState(todayIso());
  const [counterparty, setCounterparty] = useState("");
  const [cpTouched, setCpTouched] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [comment, setComment] = useState("");
  const [selectedDeals, setSelectedDeals] = useState<string[]>([]);
  const [selectedReceipts, setSelectedReceipts] = useState<string[]>([]);

  const activeDeals = useMemo(
    () => deals.filter((d) => d.status !== "cancelled"),
    [deals]
  );

  function autoAmount(
    dl: string[],
    rc: string[],
    dir: "incoming" | "outgoing"
  ): number {
    let sum = 0;
    for (const id of dl) {
      const d = deals.find((x) => x.id === id);
      if (!d) continue;
      // По заказу: поступление — остаток долга, расход — полная сумма
      sum += dir === "incoming" ? Math.max(0, d.total - d.paidAmount) : d.total;
    }
    for (const id of rc) {
      const r = receipts.find((x) => x.id === id);
      if (!r) continue;
      sum += Math.max(0, r.total - r.paidAmount);
    }
    return sum;
  }

  function autoCounterparty(
    dl: string[],
    rc: string[]
  ): string {
    // Контрагент подставляется из первого выбранного документа
    if (dl.length > 0) {
      const d = deals.find((x) => x.id === dl[0]);
      if (d) return d.customerName;
    }
    if (rc.length > 0) {
      const r = receipts.find((x) => x.id === rc[0]);
      if (r) return r.supplier;
    }
    return "";
  }

  function refreshAuto(
    dl: string[],
    rc: string[],
    dir: "incoming" | "outgoing",
    cpWasTouched: boolean,
    amountWasTouched: boolean
  ) {
    if (!amountWasTouched) {
      const auto = autoAmount(dl, rc, dir);
      setAmount(auto > 0 ? String(auto) : "");
    }
    if (!cpWasTouched) {
      setCounterparty(autoCounterparty(dl, rc));
    }
  }

  function toggleDeal(id: string) {
    const next = selectedDeals.includes(id)
      ? selectedDeals.filter((x) => x !== id)
      : [...selectedDeals, id];
    setSelectedDeals(next);
    refreshAuto(next, selectedReceipts, direction, cpTouched, amountTouched);
  }

  function toggleReceipt(id: string) {
    const next = selectedReceipts.includes(id)
      ? selectedReceipts.filter((x) => x !== id)
      : [...selectedReceipts, id];
    setSelectedReceipts(next);
    refreshAuto(selectedDeals, next, direction, cpTouched, amountTouched);
  }

  function switchDirection(dir: "incoming" | "outgoing") {
    setDirection(dir);
    // Для входящих — привязка к заказам, для расходов — к поступлениям
    const mode: LinkMode = dir === "incoming" ? "deals" : "receipts";
    setLinkMode(mode);
    setSelectedDeals([]);
    setSelectedReceipts([]);
    setCpTouched(false);
    setAmountTouched(false);
    setCounterparty("");
    setAmount("");
  }

  function switchLinkMode(mode: LinkMode) {
    setLinkMode(mode);
    if (mode === "none") {
      setSelectedDeals([]);
      setSelectedReceipts([]);
      if (!amountTouched) setAmount("");
      if (!cpTouched) setCounterparty("");
    }
  }

  function resetForm() {
    setDirection("incoming");
    setLinkMode("deals");
    setDate(todayIso());
    setCounterparty("");
    setCpTouched(false);
    setAmount("");
    setAmountTouched(false);
    setInvoiceNumber("");
    setComment("");
    setSelectedDeals([]);
    setSelectedReceipts([]);
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
          dealIds: linkMode === "deals" ? selectedDeals : [],
          receiptIds: linkMode === "receipts" ? selectedReceipts : [],
          amount: amountNum,
          invoiceNumber: invoiceNumber.trim() || null,
          // Всегда создаём «в ожидании» — проводим потом кнопкой
          isPaid: false,
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

  const linkModes: { value: LinkMode; label: string }[] =
    direction === "incoming"
      ? [
          { value: "deals", label: "К заказу" },
          { value: "none", label: "Без привязки" },
        ]
      : [
          { value: "receipts", label: "К поступлению" },
          { value: "deals", label: "К заказу" },
          { value: "none", label: "Без привязки" },
        ];

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
                  onClick={() => switchDirection("incoming")}
                >
                  <ArrowDownLeft size={14} /> Поступление
                </button>
                <button
                  type="button"
                  className={`wh-direction__btn wh-direction__btn--out${
                    direction === "outgoing" ? " wh-direction__btn--active" : ""
                  }`}
                  onClick={() => switchDirection("outgoing")}
                >
                  <ArrowUpRight size={14} /> Расход (поставщику)
                </button>
              </div>

              <div className="admin-field">
                <label className="admin-label">
                  Привязка{" "}
                  <span className="wh-label-hint">
                    (контрагент и сумма подставятся сами)
                  </span>
                </label>
                <div className="wh-linkmode">
                  {linkModes.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className={`wh-linkmode__btn${
                        linkMode === m.value ? " wh-linkmode__btn--active" : ""
                      }`}
                      onClick={() => switchLinkMode(m.value)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {linkMode === "deals" &&
                  (activeDeals.length === 0 ? (
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
                              ЗК-{d.number} · {d.customerName}
                            </span>
                            <span className="wh-deal-chip__meta">
                              {d.status === "completed" ? "отпущен" : "новый"}
                              {" · "}
                              {direction === "incoming"
                                ? `осталось ${fmt(rest)} ₽`
                                : `${fmt(d.total)} ₽`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}

                {linkMode === "receipts" &&
                  (receipts.length === 0 ? (
                    <div className="wh-deal-pick__empty">
                      Нет поступлений для привязки
                    </div>
                  ) : (
                    <div className="wh-deal-pick">
                      {receipts.slice(0, 30).map((r) => {
                        const selected = selectedReceipts.includes(r.id);
                        const rest = Math.max(0, r.total - r.paidAmount);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            className={`wh-deal-chip${
                              selected ? " wh-deal-chip--active" : ""
                            }`}
                            onClick={() => toggleReceipt(r.id)}
                          >
                            <span className="wh-deal-chip__title">
                              ПО-{r.number} · {r.supplier || "Поставщик"}
                            </span>
                            <span className="wh-deal-chip__meta">
                              осталось {fmt(rest)} ₽ из {fmt(r.total)} ₽
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
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
                    list="payment-counterparty-options"
                    value={counterparty}
                    onChange={(e) => {
                      setCounterparty(e.target.value);
                      setCpTouched(true);
                    }}
                    placeholder={
                      direction === "incoming"
                        ? "От кого платёж"
                        : "Поставщик"
                    }
                    required
                  />
                  <datalist id="payment-counterparty-options">
                    {counterparties
                      .filter((item) =>
                        item.roles.includes(
                          direction === "incoming" ? "customer" : "supplier"
                        )
                      )
                      .map((item) => (
                        <option key={item.id} value={item.name} />
                      ))}
                  </datalist>
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
                  <label className="admin-label">Номер счёта</label>
                  <input
                    type="text"
                    className="admin-input"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="Номер из вашей программы"
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
                        : "Например: оплата по счёту"
                    }
                  />
                </div>
              </div>

              {error && <div className="wh-form-error">{error}</div>}

              <div className="wh-form-footer">
                <div className="wh-form-total">
                  Сумма (с НДС): <strong>{fmt(Number(amount) || 0)} ₽</strong>
                  <span className="wh-form-vat">
                    в т.ч. НДС {VAT_RATE}% —{" "}
                    {fmt(includedVat(Number(amount) || 0))} ₽
                  </span>
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
              <p className="wh-form-hint">
                Платёж создаётся «в ожидании» и не меняет баланс. Когда деньги
                пройдут — проведите его кнопкой в списке.
              </p>
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
  edit,
}: {
  paymentId: string;
  isPaid: boolean;
  edit: {
    date: string;
    counterparty: string;
    amount: number;
    invoiceNumber: string | null;
    comment: string | null;
  };
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editDate, setEditDate] = useState(edit.date);
  const [editCounterparty, setEditCounterparty] = useState(edit.counterparty);
  const [editAmount, setEditAmount] = useState(
    edit.amount > 0 ? String(edit.amount) : ""
  );
  const [editInvoiceNumber, setEditInvoiceNumber] = useState(
    edit.invoiceNumber || ""
  );
  const [editComment, setEditComment] = useState(edit.comment || "");
  const [error, setError] = useState("");

  async function togglePaid() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/warehouse/payments/${paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: !isPaid }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Не удалось изменить статус платежа");
      }
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const amountNum = Number(editAmount);
    if (!editCounterparty.trim()) {
      setError("Укажите контрагента");
      return;
    }
    if (!amountNum || amountNum <= 0) {
      setError("Укажите сумму");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/warehouse/payments/${paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: editDate,
          counterparty: editCounterparty.trim(),
          amount: amountNum,
          invoiceNumber: editInvoiceNumber.trim() || null,
          comment: editComment.trim() || null,
        }),
      });
      if (res.ok) {
        setShowEdit(false);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Ошибка сохранения");
      }
    } catch {
      setError("Ошибка сети");
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
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Не удалось удалить платёж");
      }
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  return (
    <div className="wh-pay-controls">
      {!isPaid ? (
        <button
          type="button"
          onClick={togglePaid}
          disabled={saving}
          className="admin-status__btn admin-status__btn--primary"
          title="Провести платёж — деньги прошли, учесть в балансе"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCircle size={14} />
          )}
          Провести
        </button>
      ) : (
        <button
          type="button"
          onClick={togglePaid}
          disabled={saving}
          className="admin-status__btn admin-status__btn--outline-red"
          title="Вернуть в ожидание — исключить из баланса"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Undo2 size={14} />
          )}
          В ожидание
        </button>
      )}
      <button
        type="button"
        onClick={() => setShowEdit(true)}
        disabled={saving}
        className="admin-status__btn admin-status__btn--edit"
        title="Редактировать платёж"
      >
        <Pencil size={14} />
        Изменить
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

      {showEdit && (
        <div className="admin-modal-overlay" onClick={() => setShowEdit(false)}>
          <div
            className="admin-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 420 }}
          >
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">Изменить платёж</h3>
              <button
                type="button"
                onClick={() => setShowEdit(false)}
                className="admin-modal__close"
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="admin-field">
                <label className="admin-label">Дата</label>
                <input
                  type="date"
                  className="admin-input"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  required
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Контрагент *</label>
                <input
                  type="text"
                  className="admin-input"
                  value={editCounterparty}
                  onChange={(e) => setEditCounterparty(e.target.value)}
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
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  required
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Номер счёта</label>
                <input
                  type="text"
                  className="admin-input"
                  value={editInvoiceNumber}
                  onChange={(e) => setEditInvoiceNumber(e.target.value)}
                  placeholder="Номер из вашей программы"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Комментарий</label>
                <input
                  type="text"
                  className="admin-input"
                  value={editComment}
                  onChange={(e) => setEditComment(e.target.value)}
                  placeholder="Необязательно"
                />
              </div>
              {error && <div className="wh-form-error">{error}</div>}
              <div className="admin-modal__actions" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => setShowEdit(false)}
                  className="admin-btn admin-btn--ghost"
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
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
