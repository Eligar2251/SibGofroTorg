"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Banknote,
  CheckCircle,
  CreditCard,
  History,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wallet,
  X,
  Receipt,
  MoreHorizontal,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import {
  computeRentBalances,
  rentFmt,
  rentFmtDate,
  rentMonthKey,
  rentMonthLabel,
  rentTodayIso,
  RENT_PAYMENT_KIND_LABELS,
  type RentInvoice,
  type RentOrg,
  type RentPayment,
  type RentTenant,
} from "@/lib/rent-shared";
import { useEscapeClose } from "@/hooks/use-escape-close";

export function RentBank({
  adminPath,
  readOnly,
  orgs,
  tenants,
  invoices,
  payments,
}: {
  adminPath: string;
  readOnly: boolean;
  orgs: RentOrg[];
  tenants: RentTenant[];
  invoices: RentInvoice[];
  payments: RentPayment[];
}) {
  void adminPath;
  const router = useRouter();
  const today = rentTodayIso();
  const accountOrgs = orgs.filter((o) => !o.paysToOrgId);
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const [sub, setSub] = useState<"pending" | "history">("pending");
  const [bankQuery, setBankQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RentPayment | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const balances = useMemo(() => computeRentBalances(payments, today), [payments, today]);

  const list = useMemo(() => {
    const q = bankQuery.trim().toLocaleLowerCase("ru-RU");
    return payments
      .filter((p) => orgFilter === "all" || p.accountOrgId === orgFilter)
      .filter(
        (p) =>
          !q ||
          p.counterparty.toLocaleLowerCase("ru-RU").includes(q) ||
          (p.comment || "").toLocaleLowerCase("ru-RU").includes(q) ||
          (p.invoiceNumber || "").toLocaleLowerCase("ru-RU").includes(q) ||
          String(p.number).includes(q)
      );
  }, [payments, orgFilter, bankQuery]);

  const pending = useMemo(
    () => list.filter((p) => !p.isPaid).sort((a, b) => b.date.localeCompare(a.date)),
    [list]
  );

  const historyGroups = useMemo(() => {
    const paid = list.filter((p) => p.isPaid).sort((a, b) => b.date.localeCompare(a.date));
    const groups = new Map<string, RentPayment[]>();
    for (const p of paid) {
      const key = rentMonthKey(p.date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.entries());
  }, [list]);

  const orgName = (id: string) => orgs.find((o) => o.id === id)?.shortName || id;

  async function postPayment(p: RentPayment) {
    setBusyId(p.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/payments/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: true, date: p.date || today }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setBusyId("");
    }
  }

  async function unpostPayment(p: RentPayment) {
    if (!confirm(`Вернуть платёж АП-${p.number} в ожидание?`)) return;
    setBusyId(p.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/payments/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setBusyId("");
    }
  }

  async function removePayment(p: RentPayment) {
    if (!confirm(`Удалить платёж АП-${p.number}?`)) return;
    setBusyId(p.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/payments/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setBusyId("");
    }
  }

  const totalBalance = accountOrgs.reduce((s, o) => s + (balances[o.id]?.balance || 0), 0);

  const activeBalance =
    orgFilter === "all"
      ? {
          bankBalance: accountOrgs.reduce((s, o) => s + (balances[o.id]?.bankBalance || 0), 0),
          cashBalance: accountOrgs.reduce((s, o) => s + (balances[o.id]?.cashBalance || 0), 0),
          balance: totalBalance,
        }
      : balances[orgFilter] || {
          bankBalance: 0,
          cashBalance: 0,
          balance: 0,
          expectedIn: 0,
          expectedOut: 0,
          monthIn: 0,
          monthOut: 0,
        };

  const expectedIn =
    orgFilter === "all"
      ? accountOrgs.reduce((s, o) => s + (balances[o.id]?.expectedIn || 0), 0)
      : balances[orgFilter]?.expectedIn || 0;
  const expectedOut =
    orgFilter === "all"
      ? accountOrgs.reduce((s, o) => s + (balances[o.id]?.expectedOut || 0), 0)
      : balances[orgFilter]?.expectedOut || 0;

  return (
    <div className="rent-bank">
      <div className="rent-bank__phone">
        <div className="rent-bank__status">
          <span className="rent-bank__time">9:41</span>
          <span className="rent-bank__status-right">LTE</span>
        </div>

        <div className="rent-bank__hero">
          <div className="rent-bank__hero-top">
            <div className="rent-bank__hero-title">
              <span className="rent-bank__hero-eyebrow">Банк аренды</span>
              <span className="rent-bank__hero-sub">
                {orgFilter === "all" ? "Все счета" : orgs.find((o) => o.id === orgFilter)?.name || orgFilter}
              </span>
            </div>
            <div className="rent-bank__chips">
              {accountOrgs.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setOrgFilter(o.id)}
                  className={orgFilter === o.id ? "rent-bank__chip rent-bank__chip--on" : "rent-bank__chip"}
                  type="button"
                >
                  {o.shortName}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOrgFilter("all")}
                className={orgFilter === "all" ? "rent-bank__chip rent-bank__chip--on" : "rent-bank__chip"}
              >
                Все
              </button>
            </div>
          </div>

          <div className="rent-bank__card">
            <div className="rent-bank__card-top">
              <div className="rent-bank__card-main">
                <span className="rent-bank__card-label">Доступно</span>
                <span className="rent-bank__card-value">{rentFmt(activeBalance.balance)} ₽</span>
                <span className="rent-bank__card-parts">
                  <span>Безнал {rentFmt(activeBalance.bankBalance)} ₽</span>
                  <span>Нал {rentFmt(activeBalance.cashBalance)} ₽</span>
                </span>
              </div>
              <span className="rent-bank__card-icon" aria-hidden>
                <CreditCard size={18} />
              </span>
            </div>

            <div className="rent-bank__card-stats">
              <div className="rent-bank__card-stat">
                <span>Ожидаем</span>
                <strong>+{rentFmt(expectedIn)} ₽</strong>
              </div>
              <div className="rent-bank__card-stat rent-bank__card-stat--out">
                <span>К оплате</span>
                <strong>-{rentFmt(expectedOut)} ₽</strong>
              </div>
            </div>

            <div className="rent-bank__card-dots" aria-hidden>
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className="rent-bank__actions">
            <button type="button" className="rent-bank__action" onClick={() => !readOnly && setCreating(true)}>
              <span className="rent-bank__action-ic rent-bank__action-ic--pine">
                <Plus size={16} />
              </span>
              <span>Пополнить</span>
            </button>
            <button type="button" className="rent-bank__action" onClick={() => !readOnly && setCreating(true)}>
              <span className="rent-bank__action-ic rent-bank__action-ic--steel">
                <ArrowLeftRight size={16} />
              </span>
              <span>Перевод</span>
            </button>
            <button type="button" className="rent-bank__action" onClick={() => setSub(sub === "pending" ? "history" : "pending")}>
              <span className="rent-bank__action-ic rent-bank__action-ic--kraft">
                <Receipt size={16} />
              </span>
              <span>{sub === "pending" ? "История" : "Ожидают"}</span>
            </button>
            <button type="button" className="rent-bank__action">
              <span className="rent-bank__action-ic rent-bank__action-ic--ink">
                <MoreHorizontal size={16} />
              </span>
              <span>Ещё</span>
            </button>
          </div>
        </div>

        <div className="rent-bank__toolbar">
          <label className="rent-bank__search">
            <Search size={14} aria-hidden />
            <input placeholder="Поиск по контрагенту, №, комментарию" value={bankQuery} onChange={(e) => setBankQuery(e.target.value)} />
          </label>
          {!readOnly && (
            <button type="button" className="admin-btn admin-btn--primary rent-bank__create" onClick={() => setCreating(true)}>
              <Plus size={14} /> Платёж
            </button>
          )}
        </div>

        {error && <div className="rent-bank__error admin-error">{error}</div>}

        <div className="rent-bank__segment" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={sub === "pending"}
            className={sub === "pending" ? "rent-bank__seg rent-bank__seg--on" : "rent-bank__seg"}
            onClick={() => setSub("pending")}
          >
            <Wallet size={14} aria-hidden />
            Ожидают <span className="rent-bank__seg-count">{pending.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sub === "history"}
            className={sub === "history" ? "rent-bank__seg rent-bank__seg--on" : "rent-bank__seg"}
            onClick={() => setSub("history")}
          >
            <History size={14} aria-hidden />
            История
          </button>
        </div>

        <div className="rent-bank__feed">
          {sub === "pending" ? (
            pending.length === 0 ? (
              <div className="rent-bank__empty">
                <Wallet size={22} aria-hidden />
                <strong>Ожидающих платежей нет</strong>
                <span>Создайте платёж — он появится здесь до проведения</span>
              </div>
            ) : (
              <div className="rent-bank__list">
                {pending.map((p) => (
                  <div key={p.id} className="rent-bank__item">
                    <span
                      className={
                        p.direction === "incoming" ? "rent-bank__item-ic rent-bank__item-ic--in" : "rent-bank__item-ic rent-bank__item-ic--out"
                      }
                    >
                      {p.method === "cash" ? <Banknote size={16} /> : <CreditCard size={16} />}
                    </span>
                    <div className="rent-bank__item-main">
                      <div className="rent-bank__item-title">
                        <span className="rent-bank__item-name">{p.counterparty}</span>
                        <span className="rent-bank__pill">{orgName(p.accountOrgId)}</span>
                      </div>
                      <div className="rent-bank__item-sub">
                        АП-{p.number} · {rentFmtDate(p.date)} · {p.method === "cash" ? "наличка" : "безнал"}
                        {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""} {p.comment ? ` · ${p.comment}` : ""}
                      </div>
                      <div className="rent-bank__item-kind">{RENT_PAYMENT_KIND_LABELS[p.kind] || p.kind}</div>
                    </div>
                    <div className="rent-bank__item-side">
                      <span className={p.direction === "incoming" ? "rent-bank__amount rent-bank__amount--in" : "rent-bank__amount rent-bank__amount--out"}>
                        {p.direction === "incoming" ? "+" : "-"}
                        {rentFmt(p.amount)} ₽
                      </span>
                      {!readOnly && (
                        <div className="rent-bank__item-actions">
                          <button type="button" className="admin-btn admin-btn--primary admin-btn--sm" disabled={busyId === p.id} onClick={() => postPayment(p)}>
                            {busyId === p.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Провести
                          </button>
                          <button type="button" className="admin-btn admin-btn--icon admin-btn--ghost" onClick={() => setEditing(p)} aria-label="Изменить">
                            <Pencil size={12} />
                          </button>
                          <button type="button" className="admin-btn admin-btn--icon admin-btn--ghost" onClick={() => removePayment(p)} aria-label="Удалить">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : historyGroups.length === 0 ? (
            <div className="rent-bank__empty">
              <History size={22} aria-hidden />
              <strong>Проведённых платежей нет</strong>
            </div>
          ) : (
            <div className="rent-bank__history">
              {historyGroups.map(([month, items]) => {
                const monthIn = items.filter((p) => p.direction === "incoming").reduce((s, p) => s + p.amount, 0);
                const monthOut = items.filter((p) => p.direction === "outgoing").reduce((s, p) => s + p.amount, 0);
                return (
                  <div key={month} className="rent-bank__month">
                    <div className="rent-bank__month-head">
                      <span>{rentMonthLabel(month)}</span>
                      <span className="rent-bank__month-sums">
                        <span className="rent-bank__month-in">+{rentFmt(monthIn)} ₽</span>
                        <span className="rent-bank__month-out">-{rentFmt(monthOut)} ₽</span>
                      </span>
                    </div>
                    {items.map((p) => (
                      <div key={p.id} className="rent-bank__item rent-bank__item--history">
                        <div className="rent-bank__item-main">
                          <div className="rent-bank__item-title">
                            <span className="rent-bank__item-name">{p.counterparty}</span>
                            <span className="rent-bank__pill">{orgName(p.accountOrgId)}</span>
                            <span className={p.method === "cash" ? "rent-bank__pill rent-bank__pill--cash" : "rent-bank__pill rent-bank__pill--bank"}>
                              {p.method === "cash" ? "наличка" : "безнал"}
                            </span>
                          </div>
                          <div className="rent-bank__item-sub">
                            {rentFmtDate(p.date)} · АП-{p.number} · {RENT_PAYMENT_KIND_LABELS[p.kind] || p.kind}
                            {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""} {p.comment ? ` · ${p.comment}` : ""}
                          </div>
                        </div>
                        <div className="rent-bank__item-side">
                          <span className={p.direction === "incoming" ? "rent-bank__amount rent-bank__amount--in" : "rent-bank__amount rent-bank__amount--out"}>
                            {p.direction === "incoming" ? "+" : "-"}
                            {rentFmt(p.amount)} ₽
                          </span>
                          {!readOnly && (
                            <div className="rent-bank__item-actions">
                              <button type="button" className="admin-btn admin-btn--icon admin-btn--ghost" title="Вернуть в ожидание" onClick={() => unpostPayment(p)}>
                                <History size={12} />
                              </button>
                              <button type="button" className="admin-btn admin-btn--icon admin-btn--ghost" onClick={() => setEditing(p)}>
                                <Pencil size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rent-bank__tabbar" aria-hidden>
          <span className="rent-bank__tab rent-bank__tab--on">
            <Wallet size={16} />
            Операции
          </span>
          <span className="rent-bank__tab">
            <CreditCard size={16} />
            Счета
          </span>
          <span className="rent-bank__tab">
            <Receipt size={16} />
            Документы
          </span>
          <span className="rent-bank__tab">
            <History size={16} />
            Аналитика
          </span>
        </div>
        <div className="rent-bank__home" aria-hidden />
      </div>

      <div className="rent-bank__aside">
        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">Сводка по счетам</h3>
            <span className="rent-bank__aside-total">{rentFmt(totalBalance)} ₽</span>
          </div>
          <div className="rent-bank__aside-grid">
            {accountOrgs.map((org) => {
              const b = balances[org.id] || {
                bankBalance: 0,
                cashBalance: 0,
                balance: 0,
                expectedIn: 0,
                expectedOut: 0,
                monthIn: 0,
                monthOut: 0,
              };
              return (
                <div key={org.id} className="rent-bank__aside-card">
                  <span className="rent-bank__aside-label">{org.name}</span>
                  <strong className="rent-bank__aside-value">{rentFmt(b.balance)} ₽</strong>
                  <span className="rent-bank__aside-parts">
                    Безнал {rentFmt(b.bankBalance)} · Нал {rentFmt(b.cashBalance)}
                  </span>
                  <span className="rent-bank__aside-turn">
                    <span className="rent-bank__aside-in">+{rentFmt(b.expectedIn)}</span>
                    <span className="rent-bank__aside-out">-{rentFmt(b.expectedOut)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {(creating || editing) && (
        <PaymentFormModal
          orgs={orgs}
          tenants={tenants}
          invoices={invoices}
          payment={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

export function PaymentFormModal({
  orgs,
  tenants,
  invoices,
  payment,
  presetTenantId,
  onClose,
}: {
  orgs: RentOrg[];
  tenants: RentTenant[];
  invoices: RentInvoice[];
  payment: RentPayment | null;
  presetTenantId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const accountOrgs = orgs.filter((o) => !o.paysToOrgId);
  const presetTenant = presetTenantId ? tenants.find((t) => t.id === presetTenantId) : undefined;
  const presetOrg = presetTenant ? orgs.find((o) => o.id === presetTenant.orgId) : undefined;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<"incoming" | "outgoing">(payment?.direction || "incoming");
  const [accountOrgId, setAccountOrgId] = useState(
    payment?.accountOrgId || (presetOrg ? presetOrg.paysToOrgId || presetOrg.id : accountOrgs[0]?.id || "bau")
  );
  const [method, setMethod] = useState<"bank" | "cash">(payment?.method || (presetTenant?.payMethod === "cash" ? "cash" : "bank"));
  const [kind, setKind] = useState(payment?.kind || "rent");
  const [tenantId, setTenantId] = useState(payment?.tenantId || presetTenantId || "");
  const [counterparty, setCounterparty] = useState(payment?.counterparty || presetTenant?.name || "");
  const [invoiceId, setInvoiceId] = useState(payment?.invoiceId || "");
  const [amount, setAmount] = useState<string>(payment ? String(payment.amount) : "");
  const [date, setDate] = useState(payment?.date || rentTodayIso());
  const [invoiceNumber, setInvoiceNumber] = useState(payment?.invoiceNumber || "");
  const [isPaid, setIsPaid] = useState(payment?.isPaid ?? false);
  const [excludeFromBalance, setExcludeFromBalance] = useState(payment?.excludeFromBalance ?? false);
  const [comment, setComment] = useState(payment?.comment || "");

  const activeTenants = tenants.filter((t) => t.status === "active" || t.id === payment?.tenantId || t.id === presetTenantId);
  const awaitingInvoices = useMemo(
    () =>
      invoices.filter((i) => (i.status === "awaiting" || i.id === payment?.invoiceId) && (!tenantId || i.tenantId === tenantId)),
    [invoices, tenantId, payment]
  );

  useEscapeClose(onClose);

  function pickTenant(id: string) {
    setTenantId(id);
    const t = tenants.find((x) => x.id === id);
    if (t) {
      setCounterparty(t.name);
      const org = orgs.find((o) => o.id === t.orgId);
      if (org) setAccountOrgId(org.paysToOrgId || org.id);
      if (t.payMethod === "cash") setMethod("cash");
      if (t.payMethod === "bank") setMethod("bank");
    }
    setInvoiceId("");
  }

  function pickInvoice(id: string) {
    setInvoiceId(id);
    const inv = invoices.find((i) => i.id === id);
    if (inv) {
      setAmount(String(inv.amount));
      setInvoiceNumber(`АР-${inv.number}`);
      setDirection("incoming");
    }
  }

  async function save() {
    if (Number(amount) <= 0) {
      setError("Укажите сумму платежа");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = {
        accountOrgId,
        direction,
        kind,
        method,
        tenantId: tenantId || null,
        invoiceId: direction === "incoming" ? invoiceId || null : null,
        counterparty,
        amount: Number(amount),
        date,
        invoiceNumber,
        isPaid,
        excludeFromBalance,
        comment,
      };
      const url = payment ? `/api/admin/rent/payments/${payment.id}` : "/api/admin/rent/payments";
      const res = await fetch(url, {
        method: payment ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      router.refresh();
      onClose();
    } catch (e: any) {
      setError(e.message || "Ошибка");
      setSaving(false);
    }
  }

  const incomingKinds = ["rent", "deposit", "utility", "other"];
  const outgoingKinds = ["expense_utility", "expense_salary", "expense_repair", "expense_tax", "expense_other"];

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true">
        <div className="admin-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">{payment ? `Платёж АП-${payment.number}` : "Новый платёж"}</h3>
            <button type="button" className="admin-modal__close" onClick={onClose} aria-label="Закрыть">
              <X size={16} />
            </button>
          </div>
          <div className="admin-form admin-form--wide" style={{ padding: "0 20px" }}>
            <div className="admin-grid-2">
              <div className="admin-field">
                <label className="admin-label">Направление</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    disabled={!!payment}
                    className={direction === "incoming" ? "admin-filter admin-filter--active" : "admin-filter"}
                    onClick={() => setDirection("incoming")}
                  >
                    Поступление
                  </button>
                  <button
                    type="button"
                    disabled={!!payment}
                    className={direction === "outgoing" ? "admin-filter admin-filter--active" : "admin-filter"}
                    onClick={() => setDirection("outgoing")}
                  >
                    Расход
                  </button>
                </div>
              </div>
              <div className="admin-field">
                <label className="admin-label">Счёт организации *</label>
                <select className="admin-select" value={accountOrgId} onChange={(e) => setAccountOrgId(e.target.value)}>
                  {accountOrgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-field">
                <label className="admin-label">Способ оплаты</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className={method === "bank" ? "admin-filter admin-filter--active" : "admin-filter"}
                    onClick={() => setMethod("bank")}
                  >
                    <CreditCard size={12} /> Безнал
                  </button>
                  <button
                    type="button"
                    className={method === "cash" ? "admin-filter admin-filter--active" : "admin-filter"}
                    onClick={() => setMethod("cash")}
                  >
                    <Banknote size={12} /> Наличка
                  </button>
                </div>
              </div>
              <div className="admin-field">
                <label className="admin-label">Назначение</label>
                <select className="admin-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {(direction === "incoming" ? incomingKinds : outgoingKinds).map((k) => (
                    <option key={k} value={k}>
                      {RENT_PAYMENT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-field">
                <label className="admin-label">Арендатор</label>
                <select className="admin-select" value={tenantId} onChange={(e) => pickTenant(e.target.value)}>
                  <option value="">— не арендатор —</option>
                  {activeTenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.office ? ` · ${t.office}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-field">
                <label className="admin-label">Контрагент</label>
                <input className="admin-input" value={counterparty} placeholder="Название или ФИО" onChange={(e) => setCounterparty(e.target.value)} />
              </div>
              {direction === "incoming" && (
                <div className="admin-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="admin-label">Привязать к счёту</label>
                  <select className="admin-select" value={invoiceId} onChange={(e) => pickInvoice(e.target.value)}>
                    <option value="">— без привязки —</option>
                    {awaitingInvoices.map((i) => (
                      <option key={i.id} value={i.id}>
                        АР-{i.number} · {tenants.find((t) => t.id === i.tenantId)?.name || ""} · {rentFmtDate(i.periodStart)}–{rentFmtDate(i.periodEnd)} ·{" "}
                        {rentFmt(i.amount)} ₽
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="admin-field">
                <label className="admin-label">Сумма, ₽ *</label>
                <input type="number" min={0} className="admin-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="admin-field">
                <label className="admin-label">Дата *</label>
                <input type="date" className="admin-input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="admin-field">
                <label className="admin-label">№ счёта / платёжки</label>
                <input className="admin-input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
              </div>
              <div className="admin-field">
                <label className="admin-label">Комментарий</label>
                <input className="admin-input" value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
              <label className="admin-check" style={{ gridColumn: "1 / -1" }}>
                <input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} />
                Провести сразу
              </label>
              <label className="admin-check" style={{ gridColumn: "1 / -1" }}>
                <input type="checkbox" checked={excludeFromBalance} onChange={(e) => setExcludeFromBalance(e.target.checked)} />
                Исключить из баланса
              </label>
            </div>
          </div>
          {error && <div className="admin-error" style={{ margin: "0 20px" }}>{error}</div>}
          <div className="admin-modal__actions">
            <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={saving} onClick={save}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {payment ? "Сохранить" : "Создать"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
