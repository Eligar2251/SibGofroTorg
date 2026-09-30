"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2, X } from "lucide-react";
import {
  BANK_ACCOUNT_LABELS,
  type BankAccountId,
} from "@/lib/warehouse-shared";

const ACCOUNTS: BankAccountId[] = ["cash", "bank", "ym_card", "vm_card"];

function localDateIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function WarehouseAccountTransfer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(localDateIso);
  const [fromAccount, setFromAccount] = useState<BankAccountId>("bank");
  const [toAccount, setToAccount] = useState<BankAccountId>("cash");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function close() {
    if (saving) return;
    setOpen(false);
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const numericAmount = Number(amount.replace(",", "."));
    if (fromAccount === toAccount) {
      setError("Выберите разные счета");
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Укажите сумму больше нуля");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/warehouse/account-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          fromAccount,
          toAccount,
          amount: numericAmount,
          comment: comment.trim() || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось провести перевод");
      setAmount("");
      setComment("");
      setOpen(false);
      setError("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось провести перевод");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="admin-btn admin-btn--primary"
        onClick={() => {
          setDate(localDateIso());
          setOpen(true);
        }}
        title="Быстро перевести деньги между своими счетами"
      >
        <ArrowLeftRight size={14} /> Перевод между счетами
      </button>

      {open && (
        <div className="admin-modal-overlay" onMouseDown={close}>
          <div className="admin-modal" style={{ maxWidth: 520 }} onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">
                <ArrowLeftRight size={15} style={{ marginRight: 7, verticalAlign: "-2px" }} />
                Быстрый перевод между счетами
              </h3>
              <button type="button" className="admin-modal__close" onClick={close} disabled={saving} aria-label="Закрыть">
                <X size={15} />
              </button>
            </div>
            <p className="admin-modal__desc">
              Внутреннее движение денег: источник уменьшится, счёт-получатель увеличится. Доход и расход компании не создаются.
            </p>
            <form onSubmit={submit}>
              <div className="admin-field">
                <label className="admin-label">Дата перевода *</label>
                <input className="admin-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="admin-field">
                  <label className="admin-label">Счёт-источник *</label>
                  <select className="admin-select" value={fromAccount} onChange={(event) => setFromAccount(event.target.value as BankAccountId)}>
                    {ACCOUNTS.map((account) => <option key={account} value={account}>{BANK_ACCOUNT_LABELS[account]}</option>)}
                  </select>
                </div>
                <div className="admin-field">
                  <label className="admin-label">Счёт-получатель *</label>
                  <select className="admin-select" value={toAccount} onChange={(event) => setToAccount(event.target.value as BankAccountId)}>
                    {ACCOUNTS.map((account) => <option key={account} value={account}>{BANK_ACCOUNT_LABELS[account]}</option>)}
                  </select>
                </div>
              </div>
              <div className="admin-field">
                <label className="admin-label">Сумма, ₽ *</label>
                <input className="admin-input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" required autoFocus />
              </div>
              <div className="admin-field">
                <label className="admin-label">Комментарий</label>
                <input className="admin-input" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например: пополнение карты ЮМ" maxLength={500} />
              </div>
              {error && <p className="admin-error" style={{ marginTop: 0 }}>{error}</p>}
              <div className="wp-modal__actions">
                <button type="button" className="admin-btn admin-btn--ghost" onClick={close} disabled={saving}>Отмена</button>
                <button type="submit" className="admin-btn admin-btn--primary" disabled={saving}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
                  Провести перевод
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
