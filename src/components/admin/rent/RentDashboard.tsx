// =========================================================
// FILE: src/components/admin/rent/RentDashboard.tsx
// Стартовая страница учёта аренды: счета организаций, сбор
// месяца, динамика поступлений, просрочки и напоминания.
// Стиль — современная банковская панель: крупные числа,
// карты счетов, график и таблицы-строки. Мобильная версия —
// те же блоки в одну колонку (см. rent.css / admin-mobile.css).
// =========================================================

"use client";

import { useMemo, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BellRing,
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  FileText,
  History,
  PiggyBank,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  computeRentBalances,
  computeTenantState,
  rentFmt,
  rentFmtDate,
  rentHasPayeeNote,
  rentInvoiceState,
  rentMonthKey,
  rentMonthLabel,
  rentTodayIso,
  RENT_PAYMENT_KIND_LABELS,
  type RentInvoice,
  type RentOrg,
  type RentPayment,
  type RentTenant,
} from "@/lib/rent-shared";
import type { RentTabKey } from "./RentManager";

export function RentDashboard({
  adminPath,
  readOnly,
  orgs,
  tenants,
  invoices,
  payments,
  onOpenTab,
}: {
  adminPath: string;
  readOnly: boolean;
  orgs: RentOrg[];
  tenants: RentTenant[];
  invoices: RentInvoice[];
  payments: RentPayment[];
  onOpenTab?: (tab: RentTabKey) => void;
}) {
  void adminPath;
  const today = rentTodayIso();

  const balances = useMemo(() => computeRentBalances(payments, today), [payments, today]);
  const tenantById = useMemo(() => Object.fromEntries(tenants.map((t) => [t.id, t])), [tenants]);
  const states = useMemo(
    () => tenants.filter((t) => t.status === "active").map((t) => computeTenantState(t, invoices, today)),
    [tenants, invoices, today]
  );

  const totalDebt = states.reduce((s, x) => s + x.debt, 0);
  const overdueStates = states.filter((x) => x.overdue > 0);
  const overdueSum = overdueStates.reduce((s, x) => s + x.overdue, 0);

  // Напоминания: ближайшие оплаты в течение 7 дней + счета на отсрочке.
  const upcoming = useMemo(() => {
    const rows: { invoice: RentInvoice; tenant: RentTenant; daysLeft: number; grace: boolean }[] = [];
    for (const inv of invoices) {
      if (inv.status !== "awaiting") continue;
      const tenant = tenantById[inv.tenantId];
      if (!tenant) continue;
      const st = rentInvoiceState(inv, tenant.deferralDays, today);
      const days = Math.round(
        (new Date(inv.dueDate).getTime() - new Date(today).getTime()) / 86_400_000
      );
      if (st === "grace") rows.push({ invoice: inv, tenant, daysLeft: days, grace: true });
      else if ((st === "upcoming" || st === "due_today") && days >= 0 && days <= 7)
        rows.push({ invoice: inv, tenant, daysLeft: days, grace: false });
    }
    return rows.sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate));
  }, [invoices, tenantById, today]);

  // Просрочено (после отсрочки арендатора).
  const overdueRows = useMemo(() => {
    const rows: { invoice: RentInvoice; tenant: RentTenant; daysOverdue: number }[] = [];
    for (const inv of invoices) {
      if (inv.status !== "awaiting") continue;
      const tenant = tenantById[inv.tenantId];
      if (!tenant) continue;
      if (rentInvoiceState(inv, tenant.deferralDays, today) !== "overdue") continue;
      const limit = new Date(new Date(inv.dueDate).getTime() + tenant.deferralDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
      rows.push({
        invoice: inv,
        tenant,
        daysOverdue: Math.round((new Date(today).getTime() - new Date(limit).getTime()) / 86_400_000),
      });
    }
    return rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [invoices, tenantById, today]);

  const recentPayments = useMemo(
    () =>
      payments
        .filter((p) => p.isPaid)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8),
    [payments]
  );

  const accountOrgs = orgs.filter((o) => !o.paysToOrgId);
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.shortName || id;

  const monthKey = today.slice(0, 7);

  const totals = useMemo(() => {
    const balance = accountOrgs.reduce((s, o) => s + (balances[o.id]?.balance || 0), 0);
    const bank = accountOrgs.reduce((s, o) => s + (balances[o.id]?.bankBalance || 0), 0);
    const cash = accountOrgs.reduce((s, o) => s + (balances[o.id]?.cashBalance || 0), 0);
    const expectedIn = accountOrgs.reduce((s, o) => s + (balances[o.id]?.expectedIn || 0), 0);
    const expectedOut = accountOrgs.reduce((s, o) => s + (balances[o.id]?.expectedOut || 0), 0);
    const monthIn = payments
      .filter((p) => p.isPaid && p.direction === "incoming" && !p.excludeFromBalance && p.date.startsWith(monthKey))
      .reduce((s, p) => s + p.amount, 0);
    const monthOut = payments
      .filter((p) => p.isPaid && p.direction === "outgoing" && p.date.startsWith(monthKey))
      .reduce((s, p) => s + p.amount, 0);
    return { balance, bank, cash, expectedIn, expectedOut, monthIn, monthOut };
  }, [accountOrgs, balances, payments, monthKey]);

  const collection = useMemo(() => {
    const plan = invoices
      .filter((i) => i.status === "awaiting" && i.dueDate <= `${monthKey}-31`)
      .reduce((s, i) => s + i.amount, 0);
    const fact = totals.monthIn;
    return { plan, fact, pct: plan > 0 ? Math.min(100, Math.round((fact / plan) * 100)) : fact > 0 ? 100 : 0 };
  }, [invoices, totals.monthIn, monthKey]);

  // Динамика за 9 месяцев.
  const chart = useMemo(() => {
    const base = new Date(`${monthKey}-01T00:00:00`);
    const rows: { key: string; label: string; inSum: number; outSum: number }[] = [];
    for (let i = 8; i >= 0; i -= 1) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const inSum = payments
        .filter((p) => p.isPaid && p.direction === "incoming" && !p.excludeFromBalance && p.date.startsWith(key))
        .reduce((s, p) => s + p.amount, 0);
      const outSum = payments
        .filter((p) => p.isPaid && p.direction === "outgoing" && p.date.startsWith(key))
        .reduce((s, p) => s + p.amount, 0);
      rows.push({ key, label: rentMonthLabel(key).split(" ")[0].slice(0, 3), inSum, outSum });
    }
    const max = Math.max(1, ...rows.map((r) => Math.max(r.inSum, r.outSum)));
    return { rows, max };
  }, [payments, monthKey]);

  const notInvoiced = useMemo(
    () => tenants.filter((t) => t.status === "active" && !invoices.some((i) => i.tenantId === t.id && i.status === "awaiting")),
    [tenants, invoices]
  );

  const quick: { key: RentTabKey; label: string; hint: string; icon: ReactNode; accent: string }[] = [
    { key: "tenants", label: "Арендаторы", hint: `${states.length} активных`, icon: <Users size={16} />, accent: "pine" },
    { key: "invoices", label: "Начисления", hint: `${invoices.filter((i) => i.status === "awaiting").length} к оплате`, icon: <FileText size={16} />, accent: "steel" },
    { key: "electricity", label: "Электроэнергия", hint: "счётчики и тарифы", icon: <TrendingUp size={16} />, accent: "kraft" },
    { key: "scheme", label: "Схема здания", hint: "планировки по клеткам", icon: <Building2 size={16} />, accent: "indigo" },
    { key: "bank", label: "Банк аренды", hint: `${payments.filter((p) => !p.isPaid).length} ожидают`, icon: <Wallet size={16} />, accent: "ink" },
  ];

  const todayLabel = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });

  return (
    <div className="rd">
      {/* Шапка */}
      <div className="rd-hero">
        <div className="rd-hero__text">
          <span className="rd-hero__eyebrow">Оперативный обзор · {todayLabel}</span>
          <h2 className="rd-hero__title">
            {rentFmt(totals.balance)} ₽ на счетах аренды
          </h2>
          <div className="rd-hero__pills">
            <span className="rd-pill rd-pill--in">
              <ArrowDownLeft size={12} /> за месяц +{rentFmt(totals.monthIn)} ₽
            </span>
            <span className="rd-pill rd-pill--out">
              <ArrowUpRight size={12} /> −{rentFmt(totals.monthOut)} ₽
            </span>
            {overdueSum > 0 && (
              <span className="rd-pill rd-pill--danger">
                <AlertTriangle size={12} /> просрочено {rentFmt(overdueSum)} ₽
              </span>
            )}
          </div>
        </div>
        <div className="rd-hero__actions">
          <button
            type="button"
            className="rd-quick"
            onClick={() => onOpenTab?.("tenants")}
            title="Арендаторы и договоры"
          >
            <span className="rd-quick__icon rd-quick__icon--pine">
              <Users size={15} />
            </span>
            <span className="rd-quick__body">
              <b>Арендаторы</b>
              <i>{states.length} активных</i>
            </span>
          </button>
          <button
            type="button"
            className="rd-quick"
            onClick={() => onOpenTab?.("bank")}
            title="Банк аренды: платежи и проведение"
          >
            <span className="rd-quick__icon rd-quick__icon--ink">
              <Wallet size={15} />
            </span>
            <span className="rd-quick__body">
              <b>Банк аренды</b>
              <i>{payments.filter((p) => !p.isPaid).length} ожидают</i>
            </span>
          </button>
          {!readOnly && (
            <button
              type="button"
              className="rd-quick"
              onClick={() => onOpenTab?.("invoices")}
              title="Начисления за периоды"
            >
              <span className="rd-quick__icon rd-quick__icon--kraft">
                <FileText size={15} />
              </span>
              <span className="rd-quick__body">
                <b>Начисления</b>
                <i>{invoices.filter((i) => i.status === "awaiting").length} к оплате</i>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Счета организаций */}
      <div className="rd-accounts">
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
          const total = Math.max(1, b.monthIn + b.monthOut);
          return (
            <div key={org.id} className="rd-account">
              <div className="rd-account__glow" />
              <div className="rd-account__head">
                <span className="rd-account__org">{org.name}</span>
                <CreditCard size={17} />
              </div>
              <div className="rd-account__value">{rentFmt(b.balance)} ₽</div>
              <div className="rd-account__parts">
                <span>
                  <Banknote size={12} /> нал {rentFmt(b.cashBalance)} ₽
                </span>
                <span>
                  <CreditCard size={12} /> безнал {rentFmt(b.bankBalance)} ₽
                </span>
              </div>
              <div className="rd-account__turn">
                <span className="rd-account__turn-in">+{rentFmt(b.monthIn)}</span>
                <span className="rd-account__turn-out">−{rentFmt(b.monthOut)}</span>
              </div>
              <div className="rd-account__bar" title={`Поступления ${rentFmt(b.monthIn)} ₽ за месяц`}>
                <span style={{ width: `${Math.round((b.monthIn / total) * 100)}%` }} />
              </div>
              <div className="rd-account__foot">
                <span className="rd-account__foot-in">
                  <ArrowDownLeft size={12} /> ожидаем {rentFmt(b.expectedIn)} ₽
                </span>
                <span className="rd-account__foot-out">
                  <ArrowUpRight size={12} /> к оплате {rentFmt(b.expectedOut)} ₽
                </span>
              </div>
              <button type="button" className="rd-account__link" onClick={() => onOpenTab?.("bank")}>
                Открыть операции
              </button>
            </div>
          );
        })}
      </div>

      {/* KPI */}
      <div className="rd-kpi">
        <div className="rd-kpi__card">
          <span className="rd-kpi__icon rd-kpi__icon--pine">
            <Users size={16} />
          </span>
          <div>
            <span className="rd-kpi__label">Активных арендаторов</span>
            <strong className="rd-kpi__value">{states.length}</strong>
          </div>
        </div>
        <div className="rd-kpi__card">
          <span className="rd-kpi__icon rd-kpi__icon--steel">
            <ArrowDownLeft size={16} />
          </span>
          <div>
            <span className="rd-kpi__label">Должны по счетам</span>
            <strong className="rd-kpi__value">{rentFmt(totalDebt)} ₽</strong>
          </div>
        </div>
        <div className={`rd-kpi__card${overdueSum > 0 ? " rd-kpi__card--danger" : ""}`}>
          <span className="rd-kpi__icon rd-kpi__icon--rust">
            <AlertTriangle size={16} />
          </span>
          <div>
            <span className="rd-kpi__label">Просрочено после отсрочки</span>
            <strong className="rd-kpi__value">
              {rentFmt(overdueSum)} ₽ · {overdueStates.length}
            </strong>
          </div>
        </div>
        <div className="rd-kpi__card">
          <span className="rd-kpi__icon rd-kpi__icon--kraft">
            <CalendarClock size={16} />
          </span>
          <div>
            <span className="rd-kpi__label">Напоминания на 7 дней</span>
            <strong className="rd-kpi__value">{upcoming.length}</strong>
          </div>
        </div>
      </div>

      {/* Сбор месяца + динамика */}
      <div className="rd-grid">
        <div className="admin-card rd-collect">
          <div className="admin-card__head">
            <h3 className="admin-card__title">
              <PiggyBank size={15} /> Сбор за {rentMonthLabel(monthKey).toLowerCase()}
            </h3>
            <span className="rd-collect__pct">{collection.pct}%</span>
          </div>
          <div className="admin-card__pad">
            <div className="rd-collect__bar">
              <span style={{ width: `${collection.pct}%` }} />
            </div>
            <div className="rd-collect__row">
              <span>
                Поступило <b className="rd-in">+{rentFmt(collection.fact)} ₽</b>
              </span>
              <span>
                К сбору <b>{rentFmt(collection.plan)} ₽</b>
              </span>
            </div>
            <div className="rd-collect__notes">
              <span>
                Ожидаем по счетам <b>{rentFmt(totals.expectedIn)} ₽</b>
              </span>
              <span>
                Расходы <b className="rd-out">−{rentFmt(totals.expectedOut)} ₽</b>
              </span>
              <span>
                Остаток <b>{rentFmt(totals.balance)} ₽</b>
              </span>
            </div>
          </div>
        </div>

        <div className="admin-card rd-chart">
          <div className="admin-card__head">
            <h3 className="admin-card__title">
              <TrendingUp size={15} /> Поступления и списания по месяцам
            </h3>
            <div className="rd-chart__legend">
              <span className="rd-chart__lg rd-chart__lg--in">поступления</span>
              <span className="rd-chart__lg rd-chart__lg--out">списания</span>
            </div>
          </div>
          <div className="admin-card__pad">
            <div className="rd-chart__bars">
              {chart.rows.map((row) => (
                <div key={row.key} className="rd-chart__col" title={`${rentMonthLabel(row.key)}: +${rentFmt(row.inSum)} / −${rentFmt(row.outSum)} ₽`}>
                  <div className="rd-chart__stack">
                    <span className="rd-chart__bar rd-chart__bar--in" style={{ height: `${(row.inSum / chart.max) * 100}%` }} />
                    <span className="rd-chart__bar rd-chart__bar--out" style={{ height: `${(row.outSum / chart.max) * 100}%` }} />
                  </div>
                  <span className="rd-chart__label">{row.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Просрочки + напоминания */}
      <div className="rent-two-col">
        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">
              <AlertTriangle size={15} style={{ color: "var(--adm-rust)", verticalAlign: "-2px", marginRight: 6 }} />
              Просроченные оплаты
            </h3>
            <span className="admin-badge admin-badge--red">{overdueRows.length}</span>
          </div>
          <div className="admin-card__pad">
            {overdueRows.length === 0 ? (
              <div className="admin-empty">
                <CheckCircle2 className="admin-empty__icon" />
                Просрочек нет — все оплаты в срок
              </div>
            ) : (
              <div className="rent-rows">
                {overdueRows.map(({ invoice, tenant, daysOverdue }) => (
                  <button
                    key={invoice.id}
                    type="button"
                    className="rent-row rent-row--danger rent-row--click"
                    onClick={() => onOpenTab?.("invoices")}
                  >
                    <div className="rent-row__main">
                      <div className="rent-row__title">
                        {tenant.name}
                        {rentHasPayeeNote(tenant, orgs) && (
                          <span className="admin-badge admin-badge--amber" title="Деньги приходят на счёт БАУ">
                            СИТ → БАУ
                          </span>
                        )}
                      </div>
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        Счёт АР-{invoice.number} · период {rentFmtDate(invoice.periodStart)}–{rentFmtDate(invoice.periodEnd)} ·
                        срок {rentFmtDate(invoice.dueDate)}
                        {tenant.deferralDays > 0 && ` + отсрочка ${tenant.deferralDays} дн.`}
                      </div>
                    </div>
                    <div className="rent-row__side">
                      <strong style={{ color: "var(--adm-rust)" }}>{rentFmt(invoice.amount)} ₽</strong>
                      <span className="admin-badge admin-badge--red">{daysOverdue} дн.</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">
              <BellRing size={15} style={{ color: "var(--adm-kraft)", verticalAlign: "-2px", marginRight: 6 }} />
              Ближайшие оплаты и отсрочки
            </h3>
            <span className="admin-badge admin-badge--amber">{upcoming.length}</span>
          </div>
          <div className="admin-card__pad">
            {upcoming.length === 0 ? (
              <div className="admin-empty">
                <CheckCircle2 className="admin-empty__icon" />
                На ближайшую неделю оплат не ожидается
              </div>
            ) : (
              <div className="rent-rows">
                {upcoming.map(({ invoice, tenant, daysLeft, grace }) => (
                  <button
                    key={invoice.id}
                    type="button"
                    className="rent-row rent-row--click"
                    onClick={() => onOpenTab?.("invoices")}
                  >
                    <div className="rent-row__main">
                      <div className="rent-row__title">{tenant.name}</div>
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        Счёт АР-{invoice.number} · {orgName(invoice.accountOrgId)} · оплата до {rentFmtDate(invoice.dueDate)}
                      </div>
                    </div>
                    <div className="rent-row__side">
                      <strong>{rentFmt(invoice.amount)} ₽</strong>
                      <span className="admin-badge admin-badge--amber">
                        {grace ? `отсрочка ${tenant.deferralDays} дн.` : daysLeft === 0 ? "сегодня" : `через ${daysLeft} дн.`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Последние операции + не выставленные счета */}
      <div className="rd-grid rd-grid--ops">
        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">
              <History size={15} /> Последние операции по аренде
            </h3>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => onOpenTab?.("bank")}
            >
              Все операции
            </button>
          </div>
          <div className="admin-card__pad">
            {recentPayments.length === 0 ? (
              <div className="admin-empty">Платежей пока нет</div>
            ) : (
              <div className="rd-ops">
                {recentPayments.map((p) => (
                  <div key={p.id} className="rd-op">
                    <span
                      className={`rd-op__icon ${
                        p.direction === "incoming" ? "rd-op__icon--in" : "rd-op__icon--out"
                      }`}
                    >
                      {p.method === "cash" ? <Banknote size={15} /> : <CreditCard size={15} />}
                    </span>
                    <div className="rd-op__main">
                      <div className="rd-op__title">
                        {p.counterparty}
                        <span className="rd-op__pill">{orgName(p.accountOrgId)}</span>
                        <span className="rd-op__pill rd-op__pill--muted">
                          {RENT_PAYMENT_KIND_LABELS[p.kind] || p.kind}
                        </span>
                      </div>
                      <div className="rd-op__sub">
                        {rentFmtDate(p.date)} · АП-{p.number} · {p.method === "cash" ? "наличка" : "безнал"}
                        {p.comment ? ` · ${p.comment}` : ""}
                      </div>
                    </div>
                    <span
                      className={`rd-op__sum ${p.direction === "incoming" ? "rd-op__sum--in" : "rd-op__sum--out"}`}
                    >
                      {p.direction === "incoming" ? "+" : "−"}
                      {rentFmt(p.amount)} ₽
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">Без начислений</h3>
            <span className="admin-badge admin-badge--amber">{notInvoiced.length}</span>
          </div>
          <div className="admin-card__pad">
            {notInvoiced.length === 0 ? (
              <div className="admin-empty">
                <CheckCircle2 className="admin-empty__icon" />
                Всем активным арендаторам счета выставлены
              </div>
            ) : (
              <>
                <div className="rent-chips">
                  {notInvoiced.slice(0, 10).map((t) => (
                    <span key={t.id} className="rent-chip">
                      {t.name}
                      {t.office ? <span className="admin-muted">· {t.office}</span> : null}
                    </span>
                  ))}
                  {notInvoiced.length > 10 && (
                    <span className="rent-chip">ещё {notInvoiced.length - 10}…</span>
                  )}
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    className="admin-btn admin-btn--outline admin-btn--sm"
                    style={{ marginTop: 10 }}
                    onClick={() => onOpenTab?.("invoices")}
                  >
                    <FileText size={13} /> Выставить счета за период
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Быстрые переходы по разделам */}
      <div className="rd-nav">
        {quick
          .filter((q) => !readOnly || q.key !== "invoices")
          .map((q) => (
            <button key={q.key} type="button" className={`rd-nav__tile rd-nav__tile--${q.accent}`} onClick={() => onOpenTab?.(q.key)}>
              <span className="rd-nav__icon">{q.icon}</span>
              <span className="rd-nav__body">
                <b>{q.label}</b>
                <i>{q.hint}</i>
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}
