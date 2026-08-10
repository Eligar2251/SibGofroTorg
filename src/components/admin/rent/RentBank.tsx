// =========================================================
// FILE: src/components/admin/rent/RentBank.tsx
// Банк аренды — полноценный, но отдельный от складского.
// Счета БАУ и ИП Пакин: балансы (безнал + наличные), ожидание
// и проведение платежей, история по месяцам.
// =========================================================

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
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
    () =>
      list
        .filter((p) => !p.isPaid)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [list]
  );

  const historyGroups = useMemo(() => {
    const paid = list
      .filter((p) => p.isPaid)
      .sort((a, b) => b.date.localeCompare(a.date));
    const groups = new Map<string, RentPayment[]>();
    for (const p of paid) {
      const key = rentMonthKey(p.date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.entries());
  }, [list]);

  const orgName = (id: string) => orgs.find((o) => o.id === id)?.shortName || id;
  const tenantName = (id: string | null) =>
    id ? tenants.find((t) => t.id === id)?.name || "" : "";

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

  const totalBalance = accountOrgs.reduce(
    (s, o) => s + (balances[o.id]?.balance || 0),
    0
  );

  return (
    <div className="admin-stack">
      {/* Балансы */}
      <div className="rent-balances">
        {accountOrgs.map((org) => {
          const b = balances[org.id] || {
            bankBalance: 0, cashBalance: 0, balance: 0, expectedIn: 0, expectedOut: 0, monthIn: 0, monthOut: 0,
          };
          return (
            <div key={org.id} className="bank-hero">
              <div className="bank-hero__main">
                <div>
                  <div className="bank-hero__label">
                    <CreditCard size={14} /> {org.name} · р/с
                  </div>
                  <div className="bank-hero__value" style={{ color: "#fff" }}>
                    {rentFmt(b.bankBalance)} ₽
                  </div>
                </div>
                <div>
                  <div className="bank-hero__label">
                    <Banknote size={14} /> Наличные
                  </div>
                  <div className="bank-hero__value" style={{ color: "#fff" }}>
                    {rentFmt(b.cashBalance)} ₽
                  </div>
                  <div className="cash-carryover-hero">
                    <span>Итого: <b>{rentFmt(b.balance)} ₽</b></span>
                    <span>За месяц: <b>+{rentFmt(b.monthIn)} / −{rentFmt(b.monthOut)} ₽</b></span>
                  </div>
                </div>
              </div>
              <div className="bank-hero__stats">
                <div className="bank-hero__stat" style={{ color: "#7dd181" }}>
                  <ArrowDownLeft size={16} />
                  <div>
                    <span style={{ color: "rgba(125,209,129,0.7)", fontWeight: 700 }}>Ожидаем</span>
                    <strong style={{ fontSize: 20 }}>+{rentFmt(b.expectedIn)} ₽</strong>
                  </div>
                </div>
                <div className="bank-hero__stat" style={{ color: "#ef8f76" }}>
                  <ArrowUpRight size={16} />
                  <div>
                    <span style={{ color: "rgba(239,143,118,0.7)", fontWeight: 700 }}>К оплате</span>
                    <strong style={{ fontSize: 20 }}>−{rentFmt(b.expectedOut)} ₽</strong>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div className="bank-hero__note" style={{ alignSelf: "center", fontSize: 14 }}>
          Все счета аренды: <strong style={{ color: "#7dd181" }}>{rentFmt(totalBalance)} ₽</strong>
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-filters admin-filters--sub">
        <button
          className={`admin-filter${orgFilter === "all" ? " admin-filter--active" : ""}`}
          onClick={() => setOrgFilter("all")}
        >
          Все счета
        </button>
        {accountOrgs.map((o) => (
          <button
            key={o.id}
            className={`admin-filter${orgFilter === o.id ? " admin-filter--active" : ""}`}
            onClick={() => setOrgFilter(o.id)}
          >
            {o.shortName}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          className={`admin-filter${sub === "pending" ? " admin-filter--active" : ""}`}
          onClick={() => setSub("pending")}
        >
          <Wallet size={12} /> Ожидают ({pending.length})
        </button>
        <button
          className={`admin-filter${sub === "history" ? " admin-filter--active" : ""}`}
          onClick={() => setSub("history")}
        >
          <History size={12} /> История
        </button>
        <div className="admin-field" style={{ position: "relative", minWidth: 200, marginBottom: 0 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
          <input
            className="admin-input"
            style={{ paddingLeft: 32 }}
            placeholder="Поиск: контрагент, №, комментарий"
            value={bankQuery}
            onChange={(e) => setBankQuery(e.target.value)}
          />
        </div>
        {!readOnly && (
          <button className="admin-btn admin-btn--primary admin-btn--sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Платёж
          </button>
        )}
      </div>

      {/* Ожидают проведения */}
      {sub === "pending" && (
        <div className="admin-card">
          <div className="admin-card__pad">
            {pending.length === 0 ? (
              <div className="admin-empty">Ожидающих платежей нет</div>
            ) : (
              <div className="rent-rows">
                {pending.map((p) => (
                  <div key={p.id} className="rent-row">
                    <div className="bank-pay__icon" style={{
                      width: 32, height: 32, borderRadius: 8, display: "flex",
                      alignItems: "center", justifyContent: "center", flexShrink: 0,
                      background: p.direction === "incoming" ? "var(--adm-pine-pale)" : "var(--adm-rust-pale)",
                      color: p.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-rust)",
                    }}>
                      {p.method === "cash" ? <Banknote size={15} /> : <CreditCard size={15} />}
                    </div>
                    <div className="rent-row__main">
                      <div className="rent-row__title">
                        {p.counterparty}
                        <span className="admin-badge admin-badge--muted">{orgName(p.accountOrgId)}</span>
                        <span className="admin-badge admin-badge--muted">
                          {RENT_PAYMENT_KIND_LABELS[p.kind] || p.kind}
                        </span>
                        {p.invoiceNumber && <span className="admin-badge admin-badge--blue">{p.invoiceNumber}</span>}
                      </div>
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        АП-{p.number} · {rentFmtDate(p.date)} · {p.method === "cash" ? "наличка" : "безнал"}
                        {p.comment ? ` · ${p.comment}` : ""}
                      </div>
                    </div>
                    <div className="rent-row__side">
                      <strong style={{ color: p.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-rust)" }}>
                        {p.direction === "incoming" ? "+" : "−"}{rentFmt(p.amount)} ₽
                      </strong>
                      {!readOnly && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="admin-btn admin-btn--primary admin-btn--sm"
                            title="Провести платёж"
                            disabled={busyId === p.id}
                            onClick={() => postPayment(p)}
                          >
                            {busyId === p.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                            Провести
                          </button>
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title="Редактировать"
                            onClick={() => setEditing(p)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title="Удалить"
                            onClick={() => removePayment(p)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* История по месяцам */}
      {sub === "history" && (
        <div className="admin-stack">
          {historyGroups.length === 0 && (
            <div className="admin-card">
              <div className="admin-card__pad">
                <div className="admin-empty">Проведённых платежей нет</div>
              </div>
            </div>
          )}
          {historyGroups.map(([month, items]) => {
            const monthIn = items.filter((p) => p.direction === "incoming").reduce((s, p) => s + p.amount, 0);
            const monthOut = items.filter((p) => p.direction === "outgoing").reduce((s, p) => s + p.amount, 0);
            return (
              <div key={month} className="admin-card">
                <div className="admin-card__head">
                  <h3 className="admin-card__title">{rentMonthLabel(month)}</h3>
                  <div style={{ display: "flex", gap: 10, fontSize: 13 }}>
                    <span style={{ color: "var(--adm-pine)" }}>+{rentFmt(monthIn)} ₽</span>
                    <span style={{ color: "var(--adm-rust)" }}>−{rentFmt(monthOut)} ₽</span>
                    <strong>{rentFmt(monthIn - monthOut)} ₽</strong>
                  </div>
                </div>
                <div className="admin-card__pad">
                  <div className="rent-rows">
                    {items.map((p) => (
                      <div key={p.id} className="rent-row">
                        <div className="rent-row__main">
                          <div className="rent-row__title">
                            {p.counterparty}
                            <span className="admin-badge admin-badge--muted">{orgName(p.accountOrgId)}</span>
                            <span className="admin-badge admin-badge--muted">
                              {p.method === "cash" ? "наличка" : "безнал"}
                            </span>
                            {p.excludeFromBalance && (
                              <span className="admin-badge admin-badge--muted">вне баланса</span>
                            )}
                          </div>
                          <div className="admin-muted" style={{ fontSize: 12 }}>
                            {rentFmtDate(p.date)} · АП-{p.number} ·{" "}
                            {RENT_PAYMENT_KIND_LABELS[p.kind] || p.kind}
                            {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}
                            {p.comment ? ` · ${p.comment}` : ""}
                          </div>
                        </div>
                        <div className="rent-row__side">
                          <strong style={{ color: p.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-rust)" }}>
                            {p.direction === "incoming" ? "+" : "−"}{rentFmt(p.amount)} ₽
                          </strong>
                          {!readOnly && (
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                className="admin-btn admin-btn--icon admin-btn--ghost"
                                title="Вернуть в ожидание"
                                onClick={() => unpostPayment(p)}
                              >
                                <History size={14} />
                              </button>
                              <button
                                className="admin-btn admin-btn--icon admin-btn--ghost"
                                title="Редактировать"
                                onClick={() => setEditing(p)}
                              >
                                <Pencil size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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

// ── Форма платежа ────────────────────────────────────────

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
  /** Предвыбранный арендатор (например, из карточки арендатора). */
  presetTenantId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const accountOrgs = orgs.filter((o) => !o.paysToOrgId);
  // Предзаполнение из карточки арендатора: счёт организации (СИТ→БАУ),
  // имя контрагента и привычный способ оплаты.
  const presetTenant = presetTenantId
    ? tenants.find((t) => t.id === presetTenantId)
    : undefined;
  const presetOrg = presetTenant
    ? orgs.find((o) => o.id === presetTenant.orgId)
    : undefined;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<"incoming" | "outgoing">(
    payment?.direction || "incoming"
  );
  const [accountOrgId, setAccountOrgId] = useState(
    payment?.accountOrgId ||
      (presetOrg ? presetOrg.paysToOrgId || presetOrg.id : accountOrgs[0]?.id || "bau")
  );
  const [method, setMethod] = useState<"bank" | "cash">(
    payment?.method || (presetTenant?.payMethod === "cash" ? "cash" : "bank")
  );
  const [kind, setKind] = useState(payment?.kind || "rent");
  const [tenantId, setTenantId] = useState(payment?.tenantId || presetTenantId || "");
  const [counterparty, setCounterparty] = useState(
    payment?.counterparty || presetTenant?.name || ""
  );
  const [invoiceId, setInvoiceId] = useState(payment?.invoiceId || "");
  const [amount, setAmount] = useState<string>(payment ? String(payment.amount) : "");
  const [date, setDate] = useState(payment?.date || rentTodayIso());
  const [invoiceNumber, setInvoiceNumber] = useState(payment?.invoiceNumber || "");
  const [isPaid, setIsPaid] = useState(payment?.isPaid ?? false);
  const [excludeFromBalance, setExcludeFromBalance] = useState(
    payment?.excludeFromBalance ?? false
  );
  const [comment, setComment] = useState(payment?.comment || "");

  const activeTenants = tenants.filter(
    (t) =>
      t.status === "active" || t.id === payment?.tenantId || t.id === presetTenantId
  );
  const awaitingInvoices = useMemo(
    () =>
      invoices.filter(
        (i) =>
          // Текущий связанный счёт показываем, даже если он уже закрыт.
          (i.status === "awaiting" || i.id === payment?.invoiceId) &&
          (!tenantId || i.tenantId === tenantId)
      ),
    [invoices, tenantId, payment]
  );

  function pickTenant(id: string) {
    setTenantId(id);
    const t = tenants.find((x) => x.id === id);
    if (t) {
      setCounterparty(t.name);
      // Деньги арендатора СИТ приходят на счёт БАУ.
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
      const url = payment
        ? `/api/admin/rent/payments/${payment.id}`
        : "/api/admin/rent/payments";
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
  const outgoingKinds = [
    "expense_utility",
    "expense_salary",
    "expense_repair",
    "expense_tax",
    "expense_other",
  ];

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
      <div className="admin-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {payment ? `Платёж АП-${payment.number}` : "Новый платёж банка аренды"}
          </h3>
          <button className="admin-modal__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="admin-modal__desc">
          Банк аренды отдельный от складского. При привязке входящего платежа к
          счёту начисление закрывается автоматически.
        </div>
        <div className="admin-form admin-form--wide" style={{ padding: "0 20px" }}>
          <div className="admin-grid-2">
            <div className="admin-field">
              <label className="admin-label">
                Направление
                {payment && (
                  <span className="admin-muted"> (у существующего платежа не меняется)</span>
                )}
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  disabled={!!payment}
                  className={`admin-filter${direction === "incoming" ? " admin-filter--active" : ""}`}
                  onClick={() => setDirection("incoming")}
                >
                  <ArrowDownLeft size={12} /> Поступление
                </button>
                <button
                  type="button"
                  disabled={!!payment}
                  className={`admin-filter${direction === "outgoing" ? " admin-filter--active" : ""}`}
                  onClick={() => setDirection("outgoing")}
                >
                  <ArrowUpRight size={12} /> Расход
                </button>
              </div>
            </div>
            <div className="admin-field">
              <label className="admin-label">Счёт организации *</label>
              <select className="admin-select" value={accountOrgId} onChange={(e) => setAccountOrgId(e.target.value)}>
                {accountOrgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-label">Способ оплаты</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className={`admin-filter${method === "bank" ? " admin-filter--active" : ""}`}
                  onClick={() => setMethod("bank")}
                >
                  <CreditCard size={12} /> Безнал
                </button>
                <button
                  type="button"
                  className={`admin-filter${method === "cash" ? " admin-filter--active" : ""}`}
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
                  <option key={k} value={k}>{RENT_PAYMENT_KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-label">Арендатор</label>
              <select className="admin-select" value={tenantId} onChange={(e) => pickTenant(e.target.value)}>
                <option value="">— не арендатор —</option>
                {activeTenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.office ? ` · ${t.office}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-label">Контрагент</label>
              <input
                className="admin-input"
                value={counterparty}
                placeholder="Название или ФИО"
                onChange={(e) => setCounterparty(e.target.value)}
              />
            </div>
            {direction === "incoming" && (
              <div className="admin-field" style={{ gridColumn: "1 / -1" }}>
                <label className="admin-label">Привязать к счёту (начислению)</label>
                <select className="admin-select" value={invoiceId} onChange={(e) => pickInvoice(e.target.value)}>
                  <option value="">— без привязки —</option>
                  {awaitingInvoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      АР-{i.number} · {tenants.find((t) => t.id === i.tenantId)?.name || ""} ·{" "}
                      {rentFmtDate(i.periodStart)}–{rentFmtDate(i.periodEnd)} · {rentFmt(i.amount)} ₽
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
              <label className="admin-label">Дата операции *</label>
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
              <input
                type="checkbox"
                checked={excludeFromBalance}
                onChange={(e) => setExcludeFromBalance(e.target.checked)}
              />
              Исключить из баланса (архивная операция)
            </label>
          </div>
        </div>
        {error && <div className="admin-error" style={{ margin: "0 20px" }}>{error}</div>}
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--ghost" onClick={onClose}>Отмена</button>
          <button className="admin-btn admin-btn--primary" disabled={saving} onClick={save}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {payment ? "Сохранить" : "Создать платёж"}
          </button>
        </div>
      </div>
      </div>
    </ModalPortal>
  );
}
