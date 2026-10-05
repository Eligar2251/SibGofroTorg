// =========================================================
// FILE: src/components/admin/rent/RentBank.tsx
// Банк аренды — в стиле мобильного банковского приложения.
// Отдельный от складского: счета БАУ и ИП Пакин, балансы,
// ожидание и проведение платежей, история по месяцам.
// На десктопе показывается как телефон, на мобильном — на всю ширину.
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
  Smartphone,
  ArrowLeftRight,
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

  // Данные для верхней карусели карт
  const activeBalance = orgFilter === "all"
    ? { bankBalance: accountOrgs.reduce((s, o) => s + (balances[o.id]?.bankBalance || 0), 0), cashBalance: accountOrgs.reduce((s, o) => s + (balances[o.id]?.cashBalance || 0), 0), balance: totalBalance }
    : balances[orgFilter] || { bankBalance: 0, cashBalance: 0, balance: 0, expectedIn: 0, expectedOut: 0, monthIn: 0, monthOut: 0 };

  return (
    <div className="rent-bank-app">
      {/* Внешний контейнер — на десктопе как телефон, на мобильном на всю ширину */}
      <div className="rent-bank-phone">
        {/* Статус-бар телефона */}
        <div className="rent-bank-phone__status">
          <span className="rent-bank-phone__time">9:41</span>
          <Smartphone size={12} style={{ opacity: 0.5 }} />
          <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.6, display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ width: 14, height: 8, border: "1px solid currentColor", borderRadius: 2, display: "inline-block", position: "relative" }}>
              <span style={{ position: "absolute", inset: 1, background: "currentColor", opacity: 0.9, width: "70%" }} />
            </span>
            LTE
          </span>
        </div>

        {/* Шапка баланса — как в банковском приложении */}
        <div className="rent-bank-phone__header">
          <div className="rent-bank-phone__header-top">
            <div>
              <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700 }}>Банк аренды</div>
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{orgFilter === "all" ? "Все счета" : orgs.find((o) => o.id === orgFilter)?.name || orgFilter}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {accountOrgs.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setOrgFilter(o.id)}
                  className={`rent-bank-phone__org-chip ${orgFilter === o.id ? "rent-bank-phone__org-chip--active" : ""}`}
                  title={o.name}
                >
                  {o.shortName}
                </button>
              ))}
              <button onClick={() => setOrgFilter("all")} className={`rent-bank-phone__org-chip ${orgFilter === "all" ? "rent-bank-phone__org-chip--active" : ""}`}>Все</button>
            </div>
          </div>

          {/* Карта баланса */}
          <div className="rent-bank-phone__card">
            <div className="rent-bank-phone__card-bg" />
            <div className="rent-bank-phone__card-content">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 11, opacity: 0.85, letterSpacing: ".06em", textTransform: "uppercase" }}>Доступно</div>
                  <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.02em", marginTop: 4, fontFamily: "var(--adm-font-head)" }}>{rentFmt(activeBalance.balance)} ₽</div>
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4, display: "flex", gap: 10 }}>
                    <span>Безнал <b>{rentFmt(activeBalance.bankBalance)} ₽</b></span>
                    <span>Нал <b>{rentFmt(activeBalance.cashBalance)} ₽</b></span>
                  </div>
                </div>
                <CreditCard size={20} style={{ opacity: 0.9 }} />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <div style={{ flex: 1, background: "rgba(255,255,255,.14)", borderRadius: 10, padding: "8px 10px", backdropFilter: "blur(6px)" }}>
                  <div style={{ fontSize: 10, opacity: 0.8, textTransform: "uppercase", letterSpacing: ".06em" }}>Ожидаем</div>
                  <div style={{ fontWeight: 700, marginTop: 2, color: "#7dd181" }}>+{rentFmt(orgFilter === "all" ? accountOrgs.reduce((s, o) => s + (balances[o.id]?.expectedIn || 0), 0) : (balances[orgFilter]?.expectedIn || 0))} ₽</div>
                </div>
                <div style={{ flex: 1, background: "rgba(255,255,255,.14)", borderRadius: 10, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, opacity: 0.8, textTransform: "uppercase", letterSpacing: ".06em" }}>К оплате</div>
                  <div style={{ fontWeight: 700, marginTop: 2, color: "#ffb4a8" }}>-{rentFmt(orgFilter === "all" ? accountOrgs.reduce((s, o) => s + (balances[o.id]?.expectedOut || 0), 0) : (balances[orgFilter]?.expectedOut || 0))} ₽</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 12, opacity: 0.9 }}>
                <span style={{ width: 26, height: 4, borderRadius: 999, background: "rgba(255,255,255,.9)" }} />
                <span style={{ width: 26, height: 4, borderRadius: 999, background: "rgba(255,255,255,.35)" }} />
                <span style={{ width: 26, height: 4, borderRadius: 999, background: "rgba(255,255,255,.25)" }} />
              </div>
            </div>
          </div>

          {/* Быстрые действия как в приложении */}
          <div className="rent-bank-phone__actions">
            <button className="rent-bank-phone__action" onClick={() => !readOnly && setCreating(true)}>
              <span className="rent-bank-phone__action-icon" style={{ background: "var(--adm-pine)", color: "#fff" }}><Plus size={16} /></span>
              Пополнить
            </button>
            <button className="rent-bank-phone__action" onClick={() => !readOnly && setCreating(true)}>
              <span className="rent-bank-phone__action-icon" style={{ background: "var(--adm-steel)", color: "#fff" }}><ArrowLeftRight size={16} /></span>
              Перевод
            </button>
            <button className="rent-bank-phone__action" onClick={() => setSub(sub === "pending" ? "history" : "pending")}>
              <span className="rent-bank-phone__action-icon" style={{ background: "var(--adm-kraft)", color: "#fff" }}><Receipt size={16} /></span>
              {sub === "pending" ? "История" : "Ожидают"}
            </button>
            <button className="rent-bank-phone__action">
              <span className="rent-bank-phone__action-icon" style={{ background: "var(--adm-ink-deep)", color: "#fff" }}><MoreHorizontal size={16} /></span>
              Ещё
            </button>
          </div>
        </div>

        {/* Поиск и фильтры внутри телефона */}
        <div className="rent-bank-phone__toolbar">
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.45 }} />
            <input className="admin-input" style={{ paddingLeft: 32, height: 36, borderRadius: 12, background: "var(--adm-paper)", fontSize: 13 }} placeholder="Поиск по контрагенту, №, комменту" value={bankQuery} onChange={(e) => setBankQuery(e.target.value)} />
          </div>
          {!readOnly && (
            <button className="admin-btn admin-btn--primary" style={{ height: 36, borderRadius: 12 }} onClick={() => setCreating(true)}>
              <Plus size={14} /> Платёж
            </button>
          )}
        </div>

        {error && <div className="admin-error" style={{ margin: "0 12px" }}>{error}</div>}

        {/* Переключатель ожидают / история — как сегмент-контрол iOS */}
        <div className="rent-bank-phone__segment">
          <button className={sub === "pending" ? "rent-bank-phone__segment-btn rent-bank-phone__segment-btn--active" : "rent-bank-phone__segment-btn"} onClick={() => setSub("pending")}>
            <Wallet size={13} /> Ожидают <span className="rent-bank-phone__count">{pending.length}</span>
          </button>
          <button className={sub === "history" ? "rent-bank-phone__segment-btn rent-bank-phone__segment-btn--active" : "rent-bank-phone__segment-btn"} onClick={() => setSub("history")}>
            <History size={13} /> История
          </button>
        </div>

        {/* Лента операций */}
        <div className="rent-bank-phone__feed">
          {sub === "pending" ? (
            pending.length === 0 ? (
              <div className="rent-bank-phone__empty">
                <Wallet size={22} style={{ opacity: 0.4 }} />
                <div>Ожидающих платежей нет</div>
                <div className="admin-muted" style={{ fontSize: 11 }}>Создайте платёж — он появится здесь до проведения</div>
              </div>
            ) : (
              <div className="rent-bank-phone__list">
                {pending.map((p) => (
                  <div key={p.id} className="rent-bank-phone__item">
                    <div className="rent-bank-phone__item-icon" style={{ background: p.direction === "incoming" ? "var(--adm-pine-pale)" : "var(--adm-rust-pale)", color: p.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-rust)", borderColor: p.direction === "incoming" ? "var(--adm-pine-line)" : "var(--adm-rust-line)" }}>
                      {p.method === "cash" ? <Banknote size={16} /> : <CreditCard size={16} />}
                    </div>
                    <div className="rent-bank-phone__item-main">
                      <div className="rent-bank-phone__item-title">
                        {p.counterparty}
                        <span className="rent-bank-phone__badge">{orgName(p.accountOrgId)}</span>
                      </div>
                      <div className="rent-bank-phone__item-sub">
                        АП-{p.number} · {rentFmtDate(p.date)} · {p.method === "cash" ? "наличка" : "безнал"} {p.invoiceNumber ? `· ${p.invoiceNumber}` : ""} {p.comment ? `· ${p.comment}` : ""}
                      </div>
                      <div className="rent-bank-phone__item-kind">{RENT_PAYMENT_KIND_LABELS[p.kind] || p.kind}</div>
                    </div>
                    <div className="rent-bank-phone__item-side">
                      <strong style={{ color: p.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-rust)" }}>
                        {p.direction === "incoming" ? "+" : "-"}{rentFmt(p.amount)} ₽
                      </strong>
                      {!readOnly && (
                        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                          <button className="admin-btn admin-btn--primary admin-btn--sm" style={{ height: 28, borderRadius: 8, padding: "0 10px", fontSize: 11 }} disabled={busyId === p.id} onClick={() => postPayment(p)}>
                            {busyId === p.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Провести
                          </button>
                          <button className="admin-btn admin-btn--icon admin-btn--ghost" style={{ width: 28, height: 28 }} onClick={() => setEditing(p)}><Pencil size={12} /></button>
                          <button className="admin-btn admin-btn--icon admin-btn--ghost" style={{ width: 28, height: 28 }} onClick={() => removePayment(p)}><Trash2 size={12} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : historyGroups.length === 0 ? (
            <div className="rent-bank-phone__empty">
              <History size={22} style={{ opacity: 0.4 }} />
              <div>Проведённых платежей нет</div>
            </div>
          ) : (
            <div className="rent-bank-phone__history">
              {historyGroups.map(([month, items]) => {
                const monthIn = items.filter((p) => p.direction === "incoming").reduce((s, p) => s + p.amount, 0);
                const monthOut = items.filter((p) => p.direction === "outgoing").reduce((s, p) => s + p.amount, 0);
                return (
                  <div key={month} className="rent-bank-phone__month">
                    <div className="rent-bank-phone__month-head">
                      <span>{rentMonthLabel(month)}</span>
                      <span style={{ display: "flex", gap: 8, fontSize: 11 }}>
                        <span style={{ color: "var(--adm-pine)" }}>+{rentFmt(monthIn)} ₽</span>
                        <span style={{ color: "var(--adm-rust)" }}>-{rentFmt(monthOut)} ₽</span>
                      </span>
                    </div>
                    {items.map((p) => (
                      <div key={p.id} className="rent-bank-phone__item rent-bank-phone__item--history">
                        <div className="rent-bank-phone__item-main">
                          <div className="rent-bank-phone__item-title">
                            {p.counterparty}
                            <span className="rent-bank-phone__badge">{orgName(p.accountOrgId)}</span>
                            <span className="rent-bank-phone__badge" style={{ background: p.method === "cash" ? "var(--adm-kraft-pale)" : "var(--adm-steel-pale)", color: p.method === "cash" ? "var(--adm-kraft)" : "var(--adm-steel)" }}>{p.method === "cash" ? "наличка" : "безнал"}</span>
                          </div>
                          <div className="rent-bank-phone__item-sub">
                            {rentFmtDate(p.date)} · АП-{p.number} · {RENT_PAYMENT_KIND_LABELS[p.kind] || p.kind} {p.invoiceNumber ? `· ${p.invoiceNumber}` : ""} {p.comment ? `· ${p.comment}` : ""}
                          </div>
                        </div>
                        <div className="rent-bank-phone__item-side">
                          <strong style={{ color: p.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-rust)", fontSize: 14 }}>{p.direction === "incoming" ? "+" : "-"}{rentFmt(p.amount)} ₽</strong>
                          {!readOnly && (
                            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                              <button className="admin-btn admin-btn--icon admin-btn--ghost" style={{ width: 28, height: 28 }} title="Вернуть в ожидание" onClick={() => unpostPayment(p)}><History size={12} /></button>
                              <button className="admin-btn admin-btn--icon admin-btn--ghost" style={{ width: 28, height: 28 }} onClick={() => setEditing(p)}><Pencil size={12} /></button>
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

        {/* Нижний таб-бар как в приложении */}
        <div className="rent-bank-phone__tabbar">
          <button className="rent-bank-phone__tab rent-bank-phone__tab--active"><Wallet size={16} /><span>Операции</span></button>
          <button className="rent-bank-phone__tab"><CreditCard size={16} /><span>Счета</span></button>
          <button className="rent-bank-phone__tab"><Receipt size={16} /><span>Счета</span></button>
          <button className="rent-bank-phone__tab"><History size={16} /><span>Аналитика</span></button>
        </div>

        {/* Домашний индикатор iOS */}
        <div className="rent-bank-phone__home" />
      </div>

      {/* Десктопная сводка рядом с телефоном — остаётся видимой на широких экранах */}
      <div className="rent-bank-desktop">
        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">Сводка</h3>
            <span className="admin-muted" style={{ fontSize: 11 }}>Все счета аренды · <b style={{ color: "var(--adm-pine)" }}>{rentFmt(totalBalance)} ₽</b></span>
          </div>
          <div className="admin-card__pad" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {accountOrgs.map((org) => {
              const b = balances[org.id] || { bankBalance: 0, cashBalance: 0, balance: 0, expectedIn: 0, expectedOut: 0, monthIn: 0, monthOut: 0 };
              return (
                <div key={org.id} style={{ background: "var(--adm-paper)", border: "1px solid var(--adm-border)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--adm-steel)" }}>{org.name}</div>
                  <div style={{ fontFamily: "var(--adm-font-head)", fontSize: 18, fontWeight: 700, marginTop: 4 }}>{rentFmt(b.balance)} ₽</div>
                  <div className="admin-muted" style={{ fontSize: 11, marginTop: 4 }}>Безнал {rentFmt(b.bankBalance)} · Нал {rentFmt(b.cashBalance)}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, fontSize: 11 }}>
                    <span style={{ color: "var(--adm-pine)" }}>+{rentFmt(b.expectedIn)}</span>
                    <span style={{ color: "var(--adm-rust)" }}>-{rentFmt(b.expectedOut)}</span>
                  </div>
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
  // Закрытие только крестиком и Escape: клик по подложке не закрывает —
  // иначе выделение текста с отпусканием мыши за окном сбрасывало форму.
  useEscapeClose(onClose);

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
      <div className="admin-modal-overlay" data-admin="true">
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
