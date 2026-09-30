"use client";

// =========================================================
// FILE: src/components/admin/OwnerMoneyPanel.tsx
// Панель владельца: прямая правка любого денежного счёта.
//
// Документы не создаются: владелец указывает новый остаток или сумму
// изменения — деньги просто появляются/исчезают. Журнал правок виден
// только владельцу, в общий журнал действий такие записи не попадают
// для остальных ролей.
// =========================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Undo2,
  Wallet,
} from "lucide-react";
import {
  BANK_ACCOUNT_LABELS,
  MONEY_ACCOUNT_IDS,
  type BankAccountId,
  type MoneyAdjustment,
} from "@/lib/warehouse-shared";
import {
  formatMoneyDelta,
  MONEY_ACCOUNT_SHORT_LABELS,
} from "@/lib/money-accounts-shared";

type AccountRow = {
  id: BankAccountId;
  label: string;
  balance: number;
  forecast: number;
  negative: boolean;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number): string {
  return round2(value).toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(round2(value)) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(raw: string | null | undefined): string {
  const value = String(raw || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "—";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export function OwnerMoneyPanel() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [adjustments, setAdjustments] = useState<MoneyAdjustment[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Поля правки по каждому счёту: новый остаток + комментарий.
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyAccount, setBusyAccount] = useState<BankAccountId | null>(null);
  const [busyAdjustment, setBusyAdjustment] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/money", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить счета");
      setAccounts(Array.isArray(body.accounts) ? body.accounts : []);
      setTotal(Number(body.total) || 0);
      setAdjustments(Array.isArray(body.adjustments) ? body.adjustments : []);
      setTargets({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить счета");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyTarget(account: BankAccountId) {
    const raw = String(targets[account] ?? "").replace(/\s+/g, "").replace(",", ".");
    if (!raw) {
      setError("Укажите новый остаток счёта");
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setError("Новый остаток должен быть числом");
      return;
    }
    setBusyAccount(account);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/money/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account,
          mode: "set",
          amount: value,
          note: notes[account] || "",
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось изменить счёт");
      setSuccess(
        `${BANK_ACCOUNT_LABELS[account]}: ${formatMoneyDelta(
          Number(body.adjustment?.delta) || 0
        )} · новый остаток ${money(Number(body.balanceAfter) || 0)} ₽`
      );
      setNotes((prev) => ({ ...prev, [account]: "" }));
      await load(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить счёт");
    } finally {
      setBusyAccount(null);
    }
  }

  async function cancelAdjustment(id: string) {
    setBusyAdjustment(id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/admin/money/adjustments/${id}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось отменить правку");
      setSuccess("Правка отменена — деньги вернулись к прежнему состоянию");
      await load(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отменить правку");
    } finally {
      setBusyAdjustment(null);
    }
  }

  const accountsByOrder = useMemo(() => {
    const order = new Map<string, number>();
    MONEY_ACCOUNT_IDS.forEach((id, index) => order.set(id, index));
    return [...accounts].sort(
      (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)
    );
  }, [accounts]);

  return (
    <div className="owner-money">
      <div className="owner-money__head">
        <div>
          <h2 className="admin-card__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={16} /> Денежные счета · режим владельца
          </h2>
          <p className="admin-muted" style={{ marginTop: 6, maxWidth: 720 }}>
            Прямая правка остатка без документов: если убрать 14 ₽ — они просто
            исчезнут. Такие движения попадают в журнал ниже и в «Логи», но
            обычный администратор их не видит — только итоговый баланс.
          </p>
        </div>
        <div className="owner-money__totals">
          <span>Всего на счетах</span>
          <strong>{money(total)} ₽</strong>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            title="Обновить остатки"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Обновить
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-error" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <AlertTriangle size={14} /> {error}
        </p>
      )}
      {success && <p className="owner-money__success">{success}</p>}

      {loading ? (
        <div className="owner-money__loading">
          <Loader2 size={18} className="animate-spin" /> Считаем остатки…
        </div>
      ) : (
        <div className="owner-money__grid">
          {accountsByOrder.map((account) => {
            const raw = String(targets[account.id] ?? "");
            const parsed = Number(raw.replace(/\s+/g, "").replace(",", "."));
            const preview =
              raw && Number.isFinite(parsed) ? round2(parsed - account.balance) : null;
            return (
              <div key={account.id} className="owner-money__card">
                <div className="owner-money__card-head">
                  <span className="owner-money__account">
                    <Wallet size={14} /> {account.label}
                  </span>
                  <span className={`owner-money__balance${account.negative ? " owner-money__balance--negative" : ""}`}>
                    {money(account.balance)} ₽
                  </span>
                </div>

                <div className="owner-money__quick">
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={() => {
                      setTargets((prev) => ({ ...prev, [account.id]: "" }));
                      const next = round2(account.balance + 100);
                      setTargets((prev) => ({ ...prev, [account.id]: String(next) }));
                    }}
                    disabled={busyAccount !== null}
                    title="Добавить 100 ₽ к остатку"
                  >
                    <ArrowUpRight size={12} /> +100 ₽
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={() => {
                      const next = round2(account.balance - 100);
                      setTargets((prev) => ({ ...prev, [account.id]: String(next) }));
                    }}
                    disabled={busyAccount !== null}
                    title="Убрать 100 ₽ из остатка"
                  >
                    <ArrowDownRight size={12} /> −100 ₽
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={() => setTargets((prev) => ({ ...prev, [account.id]: "0" }))}
                    disabled={busyAccount !== null}
                    title="Обнулить счёт"
                  >
                    0 ₽
                  </button>
                </div>

                <div className="owner-money__form">
                  <label className="admin-label">
                    Новый остаток, ₽
                    {preview !== null && Math.abs(preview) >= 0.01 && (
                      <em className={preview > 0 ? "owner-money__delta-up" : "owner-money__delta-down"}>
                        {formatMoneyDelta(preview)}
                      </em>
                    )}
                  </label>
                  <div className="owner-money__row">
                    <input
                      className="admin-input"
                      inputMode="decimal"
                      placeholder={money(account.balance)}
                      value={raw}
                      onChange={(event) =>
                        setTargets((prev) => ({ ...prev, [account.id]: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="admin-btn admin-btn--primary"
                      onClick={() => void applyTarget(account.id)}
                      disabled={busyAccount !== null || !raw}
                    >
                      {busyAccount === account.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <ShieldCheck size={14} />
                      )}
                      Применить
                    </button>
                  </div>
                  <input
                    className="admin-input owner-money__note"
                    placeholder="Комментарий (виден только владельцу)"
                    maxLength={300}
                    value={String(notes[account.id] ?? "")}
                    onChange={(event) =>
                      setNotes((prev) => ({ ...prev, [account.id]: event.target.value }))
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="owner-money__journal">
        <div className="admin-card__head">
          <h3 className="admin-card__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <History size={15} /> Журнал правок (виден только владельцу)
          </h3>
          <span className="admin-badge admin-badge--muted">{adjustments.length}</span>
        </div>
        {adjustments.length === 0 ? (
          <p className="admin-muted">
            Пока правок нет. Изменения счёта появятся здесь с суммой, комментарием и автором.
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table owner-money__table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Счёт</th>
                  <th>Изменение</th>
                  <th>Осталось</th>
                  <th>Комментарий</th>
                  <th>Автор</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {adjustments.map((item) => {
                  const positive = Number(item.delta) > 0;
                  return (
                    <tr key={item.id}>
                      <td>{fmtDate(item.date || item.createdAt)}</td>
                      <td>{MONEY_ACCOUNT_SHORT_LABELS[item.account] || BANK_ACCOUNT_LABELS[item.account]}</td>
                      <td className={positive ? "owner-money__delta-up" : "owner-money__delta-down"}>
                        {formatMoneyDelta(item.delta)}
                      </td>
                      <td>
                        {item.balanceAfter == null ? "—" : `${money(item.balanceAfter)} ₽`}
                      </td>
                      <td className="owner-money__note-cell">{item.note || "—"}</td>
                      <td>{item.createdBy || "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost admin-btn--sm"
                          onClick={() => void cancelAdjustment(item.id)}
                          disabled={busyAdjustment !== null}
                          title="Отменить правку и вернуть деньги"
                        >
                          {busyAdjustment === item.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Undo2 size={12} />
                          )}
                          Отменить
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="owner-money__hint">
        Нужна миграция <code>supabase/migration_owner_role_and_money.sql</code> —
        она добавляет роль «Владелец» и таблицу правок счетов.
      </p>
    </div>
  );
}
