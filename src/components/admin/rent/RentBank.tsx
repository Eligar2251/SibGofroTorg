// =========================================================
// FILE: src/components/admin/rent/RentBank.tsx
// Банк аренды — отдельный от складского.
//   • Десктоп: полноценная банковская панель: боковая колонка со
//     счетами, крупный баланс, обороты месяца, фильтры и лента
//     операций (ожидают / проведено).
//   • Телефон: тот же экран в компактном «мобильном банке»:
//     чипы счетов, карта баланса, быстрые действия, список операций.
// Разметка одна, раскладку переключает CSS (см. rent.css).
// =========================================================

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  CheckCircle,
  CreditCard,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { useEscapeClose } from "@/hooks/use-escape-close";
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

type BankTab = "pending" | "history";

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
  const [tab, setTab] = useState<BankTab>("pending");
  const [query, setQuery] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"all" | "incoming" | "outgoing">("all");
  const [creating, setCreating] = useState<null | "incoming" | "outgoing">(null);
  const [editing, setEditing] = useState<RentPayment | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const balances = useMemo(() => computeRentBalances(payments, today), [payments, today]);

  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru-RU");
    return payments
      .filter((p) => orgFilter === "all" || p.accountOrgId === orgFilter)
      .filter((p) => directionFilter === "all" || p.direction === directionFilter)
      .filter(
        (p) =>
          !q ||
          p.counterparty.toLocaleLowerCase("ru-RU").includes(q) ||
          (p.comment || "").toLocaleLowerCase("ru-RU").includes(q) ||
          (p.invoiceNumber || "").toLocaleLowerCase("ru-RU").includes(q) ||
          String(p.number).includes(q)
      );
  }, [payments, orgFilter, query, directionFilter]);

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

  const historyTotal = useMemo(() => {
    const paid = list.filter((p) => p.isPaid);
    return {
      inSum: paid.filter((p) => p.direction === "incoming").reduce((s, p) => s + p.amount, 0),
      outSum: paid.filter((p) => p.direction === "outgoing").reduce((s, p) => s + p.amount, 0),
      count: paid.length,
    };
  }, [list]);

  const orgName = (id: string) => orgs.find((o) => o.id === id)?.shortName || id;

  const activeBalance =
    orgFilter === "all"
      ? {
          bankBalance: accountOrgs.reduce((s, o) => s + (balances[o.id]?.bankBalance || 0), 0),
          cashBalance: accountOrgs.reduce((s, o) => s + (balances[o.id]?.cashBalance || 0), 0),
          balance: accountOrgs.reduce((s, o) => s + (balances[o.id]?.balance || 0), 0),
          expectedIn: accountOrgs.reduce((s, o) => s + (balances[o.id]?.expectedIn || 0), 0),
          expectedOut: accountOrgs.reduce((s, o) => s + (balances[o.id]?.expectedOut || 0), 0),
          monthIn: accountOrgs.reduce((s, o) => s + (balances[o.id]?.monthIn || 0), 0),
          monthOut: accountOrgs.reduce((s, o) => s + (balances[o.id]?.monthOut || 0), 0),
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

  const monthKey = today.slice(0, 7);

  async function patchPayment(p: RentPayment, body: Record<string, unknown>, errText: string) {
    setBusyId(p.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/payments/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || errText);
      router.refresh();
    } catch (e: any) {
      setError(e.message || errText);
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setBusyId("");
    }
  }

  function renderOp(p: RentPayment, history: boolean) {
    const incoming = p.direction === "incoming";
    return (
      <div key={p.id} className={`rb-op${history ? " rb-op--history" : ""}`}>
        <span className={`rb-op__icon ${incoming ? "rb-op__icon--in" : "rb-op__icon--out"}`}>
          {p.method === "cash" ? <Banknote size={16} /> : <CreditCard size={16} />}
        </span>
        <div className="rb-op__main">
          <div className="rb-op__title">
            <span className="rb-op__name">{p.counterparty}</span>
            <span className="rb-op__pill">{orgName(p.accountOrgId)}</span>
            <span className="rb-op__pill rb-op__pill--muted">
              {RENT_PAYMENT_KIND_LABELS[p.kind] || p.kind}
            </span>
            <span className="rb-op__pill rb-op__pill--soft">
              {p.method === "cash" ? "наличка" : "безнал"}
            </span>
          </div>
          <div className="rb-op__sub">
            {rentFmtDate(p.date)} · АП-{p.number}
            {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}
            {p.comment ? ` · ${p.comment}` : ""}
            {p.tenantId ? ` · ${tenants.find((t) => t.id === p.tenantId)?.name || ""}` : ""}
          </div>
        </div>
        <span className={`rb-op__sum ${incoming ? "rb-op__sum--in" : "rb-op__sum--out"}`}>
          {incoming ? "+" : "−"}
          {rentFmt(p.amount)} ₽
        </span>
        {!readOnly && (
          <div className="rb-op__actions">
            {!history ? (
              <button
                type="button"
                className="admin-btn admin-btn--primary admin-btn--sm"
                disabled={busyId === p.id}
                onClick={() => patchPayment(p, { isPaid: true, date: p.date || today }, "Ошибка")}
              >
                {busyId === p.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                Провести
              </button>
            ) : (
              <button
                type="button"
                className="admin-btn admin-btn--icon admin-btn--ghost"
                title="Вернуть в ожидание"
                disabled={busyId === p.id}
                onClick={() =>
                  confirm(`Вернуть платёж АП-${p.number} в ожидание?`) &&
                  patchPayment(p, { isPaid: false }, "Ошибка")
                }
              >
                <History size={12} />
              </button>
            )}
            <button
              type="button"
              className="admin-btn admin-btn--icon admin-btn--ghost"
              title="Изменить"
              onClick={() => setEditing(p)}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--icon admin-btn--ghost"
              title="Удалить"
              onClick={() => removePayment(p)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rb">
      {/* Левая колонка — счета и действия (десктоп) */}
      <aside className="rb__panel">
        <div className="rb__brand">
          <span className="rb__brand-mark">
            <Wallet size={16} />
          </span>
          <span className="rb__brand-text">
            <b>Банк аренды</b>
            <i>БАУ · ИП Пакин</i>
          </span>
        </div>

        <div className="rb__panel-accounts">
          <button
            type="button"
            className={`rb__acc${orgFilter === "all" ? " rb__acc--on" : ""}`}
            onClick={() => setOrgFilter("all")}
          >
            <span className="rb__acc-name">Все счета</span>
            <span className="rb__acc-sum">
              {rentFmt(
                accountOrgs.reduce((s, o) => s + (balances[o.id]?.balance || 0), 0)
              )}{" "}
              ₽
            </span>
          </button>
          {accountOrgs.map((org) => {
            const b = balances[org.id];
            return (
              <button
                key={org.id}
                type="button"
                className={`rb__acc${orgFilter === org.id ? " rb__acc--on" : ""}`}
                onClick={() => setOrgFilter(org.id)}
              >
                <span className="rb__acc-name">{org.name}</span>
                <span className="rb__acc-sum">{rentFmt(b?.balance || 0)} ₽</span>
                <span className="rb__acc-sub">
                  нал {rentFmt(b?.cashBalance || 0)} · безнал {rentFmt(b?.bankBalance || 0)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="rb__panel-turn">
          <div className="rb__panel-turn-row">
            <span>Оборот за месяц</span>
            <b>{rentFmt(activeBalance.monthIn + activeBalance.monthOut)} ₽</b>
          </div>
          <div className="rb__panel-turn-row rb__panel-turn-row--in">
            <span>
              <ArrowDownLeft size={12} /> поступления
            </span>
            <b>+{rentFmt(activeBalance.monthIn)} ₽</b>
          </div>
          <div className="rb__panel-turn-row rb__panel-turn-row--out">
            <span>
              <ArrowUpRight size={12} /> списания
            </span>
            <b>−{rentFmt(activeBalance.monthOut)} ₽</b>
          </div>
        </div>

        {!readOnly && (
          <button
            type="button"
            className="admin-btn admin-btn--primary rb__new"
            onClick={() => setCreating("incoming")}
          >
            <Plus size={14} /> Новый платёж
          </button>
        )}
        <div className="rb__panel-foot">Всего по проведённым: +{rentFmt(historyTotal.inSum)} ₽ / −{rentFmt(historyTotal.outSum)} ₽</div>
      </aside>

      {/* Основная область */}
      <div className="rb__main">
        <div className="rb__hero">
          <div className="rb__hero-top">
            <div className="rb__hero-title">
              <span className="rb__hero-eyebrow">Доступно на счетах</span>
              <span className="rb__hero-value">{rentFmt(activeBalance.balance)} ₽</span>
              <span className="rb__hero-sub">
                {orgFilter === "all"
                  ? "БАУ и ИП Пакин"
                  : orgs.find((o) => o.id === orgFilter)?.name || orgFilter}
                {" · "}безнал {rentFmt(activeBalance.bankBalance)} ₽ · нал {rentFmt(activeBalance.cashBalance)} ₽
              </span>
            </div>
            <div className="rb__hero-stats">
              <div className="rb__hero-stat">
                <span>Ожидаем</span>
                <b className="rb__in">+{rentFmt(activeBalance.expectedIn)} ₽</b>
              </div>
              <div className="rb__hero-stat">
                <span>К оплате</span>
                <b className="rb__out">−{rentFmt(activeBalance.expectedOut)} ₽</b>
              </div>
              <div className="rb__hero-stat">
                <span>В ожидании</span>
                <b>{pending.length}</b>
              </div>
            </div>
          </div>

          <div className="rb__chips">
            <button
              type="button"
              className={`rb__chip${orgFilter === "all" ? " rb__chip--on" : ""}`}
              onClick={() => setOrgFilter("all")}
            >
              Все
            </button>
            {accountOrgs.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`rb__chip${orgFilter === o.id ? " rb__chip--on" : ""}`}
                onClick={() => setOrgFilter(o.id)}
              >
                {o.shortName}
              </button>
            ))}
          </div>

          {!readOnly && (
            <div className="rb__quick">
              <button type="button" className="rb__quick-btn" onClick={() => setCreating("incoming")}>
                <span className="rb__quick-ic rb__quick-ic--in">
                  <ArrowDownLeft size={15} />
                </span>
                Поступление
              </button>
              <button type="button" className="rb__quick-btn" onClick={() => setCreating("outgoing")}>
                <span className="rb__quick-ic rb__quick-ic--out">
                  <ArrowUpRight size={15} />
                </span>
                Расход
              </button>
              <button
                type="button"
                className="rb__quick-btn"
                onClick={() => setTab(tab === "pending" ? "history" : "pending")}
              >
                <span className="rb__quick-ic rb__quick-ic--soft">
                  <ArrowLeftRight size={15} />
                </span>
                {tab === "pending" ? "История" : "Ожидают"}
              </button>
              <button type="button" className="rb__quick-btn" onClick={() => router.refresh()}>
                <span className="rb__quick-ic rb__quick-ic--soft">
                  <RefreshCw size={15} />
                </span>
                Обновить
              </button>
            </div>
          )}
        </div>

        <div className="rb__toolbar">
          <label className="rb__search">
            <Search size={14} aria-hidden />
            <input
              placeholder="Поиск: контрагент, № платежа, счёт, комментарий"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="rb__search-clear" onClick={() => setQuery("")} aria-label="Очистить">
                <X size={12} />
              </button>
            )}
          </label>
          <div className="rb__filters">
            {(
              [
                ["all", "Все"],
                ["incoming", "Поступления"],
                ["outgoing", "Списания"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`rb__filter${directionFilter === key ? " rb__filter--on" : ""}`}
                onClick={() => setDirectionFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="rb__toolbar-right">
            <span className="rb__month">
              {rentMonthLabel(monthKey)}: <b className="rb__in">+{rentFmt(activeBalance.monthIn)} ₽</b>{" "}
              <b className="rb__out">−{rentFmt(activeBalance.monthOut)} ₽</b>
            </span>
            {!readOnly && (
              <button
                type="button"
                className="admin-btn admin-btn--primary rb__create"
                onClick={() => setCreating("incoming")}
              >
                <Plus size={14} /> Платёж
              </button>
            )}
          </div>
        </div>

        {error && <div className="admin-error rb__error">{error}</div>}

        <div className="rb__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pending"}
            className={`rb__tab${tab === "pending" ? " rb__tab--on" : ""}`}
            onClick={() => setTab("pending")}
          >
            <Wallet size={14} aria-hidden /> Ожидают
            <span className="rb__tab-count">{pending.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            className={`rb__tab${tab === "history" ? " rb__tab--on" : ""}`}
            onClick={() => setTab("history")}
          >
            <History size={14} aria-hidden /> Проведено
            <span className="rb__tab-count">{historyTotal.count}</span>
          </button>
          <span className="rb__tabs-sum">
            {tab === "history"
              ? `поступления +${rentFmt(historyTotal.inSum)} ₽ · списания −${rentFmt(historyTotal.outSum)} ₽`
              : `к проведению ${rentFmt(pending.reduce((s, p) => s + p.amount, 0))} ₽`}
          </span>
        </div>

        <div className="rb__list">
          {tab === "pending" ? (
            pending.length === 0 ? (
              <div className="rb__empty">
                <Wallet size={24} aria-hidden />
                <strong>Ожидающих платежей нет</strong>
                <span>Создайте платёж — он появится здесь до проведения</span>
              </div>
            ) : (
              <div className="rb__ops">{pending.map((p) => renderOp(p, false))}</div>
            )
          ) : historyGroups.length === 0 ? (
            <div className="rb__empty">
              <History size={24} aria-hidden />
              <strong>Проведённых платежей нет</strong>
              <span>Проведённые операции появятся здесь с итогами по месяцам</span>
            </div>
          ) : (
            <div className="rb__history">
              {historyGroups.map(([month, items]) => {
                const monthIn = items.filter((p) => p.direction === "incoming").reduce((s, p) => s + p.amount, 0);
                const monthOut = items.filter((p) => p.direction === "outgoing").reduce((s, p) => s + p.amount, 0);
                return (
                  <div key={month} className="rb__month-group">
                    <div className="rb__month-head">
                      <span>{rentMonthLabel(month)}</span>
                      <span className="rb__month-sums">
                        <span className="rb__in">+{rentFmt(monthIn)} ₽</span>
                        <span className="rb__out">−{rentFmt(monthOut)} ₽</span>
                      </span>
                    </div>
                    {items.map((p) => renderOp(p, true))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {(creating || editing) && (
        <PaymentFormModal
          orgs={orgs}
          tenants={tenants}
          invoices={invoices}
          payment={editing}
          defaultDirection={creating || "incoming"}
          presetAccountOrgId={orgFilter === "all" ? null : orgFilter}
          onClose={() => {
            setCreating(null);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/* =========================================================
   Модалка платежа (используется и в карточке арендатора).
   ========================================================= */

export function PaymentFormModal({
  orgs,
  tenants,
  invoices,
  payment,
  presetTenantId,
  presetAccountOrgId,
  defaultDirection,
  onClose,
}: {
  orgs: RentOrg[];
  tenants: RentTenant[];
  invoices: RentInvoice[];
  payment: RentPayment | null;
  presetTenantId?: string | null;
  presetAccountOrgId?: string | null;
  defaultDirection?: "incoming" | "outgoing";
  onClose: () => void;
}) {
  const router = useRouter();
  const accountOrgs = orgs.filter((o) => !o.paysToOrgId);
  const presetTenant = presetTenantId ? tenants.find((t) => t.id === presetTenantId) : undefined;
  const presetOrg = presetTenant ? orgs.find((o) => o.id === presetTenant.orgId) : undefined;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<"incoming" | "outgoing">(
    payment?.direction || defaultDirection || "incoming"
  );
  const [accountOrgId, setAccountOrgId] = useState(
    payment?.accountOrgId ||
      presetAccountOrgId ||
      (presetOrg ? presetOrg.paysToOrgId || presetOrg.id : accountOrgs[0]?.id || "bau")
  );
  const [method, setMethod] = useState<"bank" | "cash">(
    payment?.method || (presetTenant?.payMethod === "cash" ? "cash" : "bank")
  );
  const [kind, setKind] = useState(payment?.kind || (defaultDirection === "outgoing" ? "expense_other" : "rent"));
  const [tenantId, setTenantId] = useState(payment?.tenantId || presetTenantId || "");
  const [counterparty, setCounterparty] = useState(payment?.counterparty || presetTenant?.name || "");
  const [invoiceId, setInvoiceId] = useState(payment?.invoiceId || "");
  const [amount, setAmount] = useState<string>(payment ? String(payment.amount) : "");
  const [date, setDate] = useState(payment?.date || rentTodayIso());
  const [invoiceNumber, setInvoiceNumber] = useState(payment?.invoiceNumber || "");
  const [isPaid, setIsPaid] = useState(payment?.isPaid ?? false);
  const [excludeFromBalance, setExcludeFromBalance] = useState(payment?.excludeFromBalance ?? false);
  const [comment, setComment] = useState(payment?.comment || "");

  const activeTenants = tenants.filter(
    (t) => t.status === "active" || t.id === payment?.tenantId || t.id === presetTenantId
  );
  const awaitingInvoices = useMemo(
    () =>
      invoices.filter(
        (i) =>
          (i.status === "awaiting" || i.id === payment?.invoiceId) && (!tenantId || i.tenantId === tenantId)
      ),
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
      const data = await res.json().catch(() => ({}));
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
      <div className="admin-modal-overlay" data-admin="true">
        <div className="admin-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">
              {payment ? `Платёж АП-${payment.number}` : direction === "incoming" ? "Новое поступление" : "Новый расход"}
            </h3>
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
                    onClick={() => {
                      setDirection("incoming");
                      setKind("rent");
                    }}
                  >
                    Поступление
                  </button>
                  <button
                    type="button"
                    disabled={!!payment}
                    className={direction === "outgoing" ? "admin-filter admin-filter--active" : "admin-filter"}
                    onClick={() => {
                      setDirection("outgoing");
                      setKind("expense_other");
                    }}
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
                <input
                  className="admin-input"
                  value={counterparty}
                  placeholder="Название или ФИО"
                  onChange={(e) => setCounterparty(e.target.value)}
                />
              </div>
              {direction === "incoming" && (
                <div className="admin-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="admin-label">Привязать к счёту</label>
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
                <input
                  type="number"
                  min={0}
                  className="admin-input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Дата *</label>
                <input type="date" className="admin-input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="admin-field">
                <label className="admin-label">№ счёта / платёжки</label>
                <input
                  className="admin-input"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                />
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
                Исключить из баланса
              </label>
            </div>
          </div>
          {error && (
            <div className="admin-error" style={{ margin: "0 20px" }}>
              {error}
            </div>
          )}
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
