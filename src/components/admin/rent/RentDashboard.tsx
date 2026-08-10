// =========================================================
// FILE: src/components/admin/rent/RentDashboard.tsx
// Дашборд аренды: балансы счетов, долги, просрочки (с учётом
// отсрочки), напоминания о ближайших оплатах. Полный обзор —
// в том числе для юриста (read-only).
// =========================================================

"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BellRing,
  CheckCircle2,
  CreditCard,
  History,
  Users,
} from "lucide-react";
import {
  computeRentBalances,
  computeTenantState,
  rentAccountOrgId,
  rentFmt,
  rentFmtDate,
  rentHasPayeeNote,
  rentInvoiceState,
  rentTodayIso,
  RENT_ACCOUNT_ORGS,
  type RentInvoice,
  type RentOrg,
  type RentPayment,
  type RentTenant,
} from "@/lib/rent-shared";

export function RentDashboard({
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
  void readOnly;
  const today = rentTodayIso();

  const balances = useMemo(() => computeRentBalances(payments, today), [payments, today]);
  const tenantById = useMemo(
    () => Object.fromEntries(tenants.map((t) => [t.id, t])),
    [tenants]
  );
  const states = useMemo(
    () =>
      tenants
        .filter((t) => t.status === "active")
        .map((t) => computeTenantState(t, invoices, today)),
    [tenants, invoices, today]
  );

  const totalDebt = states.reduce((s, x) => s + x.debt, 0);
  const overdueStates = states.filter((x) => x.overdue > 0);
  const overdueSum = overdueStates.reduce((s, x) => s + x.overdue, 0);

  // Напоминания: ближайшие оплаты в течение 7 дней + счета, у которых
  // срок прошёл, но действует отсрочка (grace).
  const upcoming = useMemo(() => {
    const rows: {
      invoice: RentInvoice;
      tenant: RentTenant;
      daysLeft: number;
      grace: boolean;
    }[] = [];
    for (const inv of invoices) {
      if (inv.status !== "awaiting") continue;
      const tenant = tenantById[inv.tenantId];
      if (!tenant) continue;
      const st = rentInvoiceState(inv, tenant.deferralDays, today);
      const days = Math.round(
        (new Date(inv.dueDate).getTime() - new Date(today).getTime()) / 86_400_000
      );
      if (st === "grace") {
        rows.push({ invoice: inv, tenant, daysLeft: days, grace: true });
      } else if ((st === "upcoming" || st === "due_today") && days >= 0 && days <= 7) {
        rows.push({ invoice: inv, tenant, daysLeft: days, grace: false });
      }
    }
    return rows.sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate));
  }, [invoices, tenantById, today]);

  // Просроченные начисления (после отсрочки).
  const overdueRows = useMemo(() => {
    const rows: {
      invoice: RentInvoice;
      tenant: RentTenant;
      daysOverdue: number;
      limitDate: string;
    }[] = [];
    for (const inv of invoices) {
      if (inv.status !== "awaiting") continue;
      const tenant = tenantById[inv.tenantId];
      if (!tenant) continue;
      if (rentInvoiceState(inv, tenant.deferralDays, today) !== "overdue") continue;
      const limit = new Date(
        new Date(inv.dueDate).getTime() + tenant.deferralDays * 86_400_000
      )
        .toISOString()
        .slice(0, 10);
      const days = Math.round(
        (new Date(today).getTime() - new Date(limit).getTime()) / 86_400_000
      );
      rows.push({ invoice: inv, tenant, daysOverdue: days, limitDate: limit });
    }
    return rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [invoices, tenantById, today]);

  const recentPayments = useMemo(
    () =>
      payments
        .filter((p) => p.isPaid)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10),
    [payments]
  );

  const orgName = (id: string) => orgs.find((o) => o.id === id)?.shortName || id;
  const accountOrgs = orgs.filter((o) => RENT_ACCOUNT_ORGS.includes(o.id as any) || !o.paysToOrgId);

  // План сбора текущего месяца: все ждущие оплаты счета со сроком до
  // конца месяца (включая просроченные) против фактических поступлений.
  const monthKey = today.slice(0, 7);
  const collection = useMemo(() => {
    const plan = invoices
      .filter((i) => i.status === "awaiting" && i.dueDate <= `${monthKey}-31`)
      .reduce((s, i) => s + i.amount, 0);
    const fact = payments
      .filter(
        (p) =>
          p.isPaid &&
          p.direction === "incoming" &&
          !p.excludeFromBalance &&
          p.date.startsWith(monthKey)
      )
      .reduce((s, p) => s + p.amount, 0);
    return { plan, fact, pct: plan > 0 ? Math.min(100, Math.round((fact / plan) * 100)) : 0 };
  }, [invoices, payments, monthKey]);

  // Арендаторы, которым ещё не выставлен ни один счёт.
  const notInvoiced = useMemo(() => {
    return tenants.filter(
      (t) =>
        t.status === "active" &&
        !invoices.some((i) => i.tenantId === t.id && i.status === "awaiting")
    );
  }, [tenants, invoices]);

  return (
    <div className="admin-stack">
      {/* Балансы счетов */}
      <div className="rent-balances">
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
            <div key={org.id} className="bank-hero">
              <div className="bank-hero__main">
                <div>
                  <div className="bank-hero__label">
                    <CreditCard size={14} /> {org.name} · расчётный счёт
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
                    <span>
                      Итого: <b>{rentFmt(b.balance)} ₽</b>
                    </span>
                    <span>
                      За месяц: <b>+{rentFmt(b.monthIn)} ₽ / −{rentFmt(b.monthOut)} ₽</b>
                    </span>
                  </div>
                </div>
              </div>
              <div className="bank-hero__stats">
                <div className="bank-hero__stat" style={{ color: "#7dd181" }}>
                  <ArrowDownLeft size={16} />
                  <div>
                    <span style={{ color: "rgba(125,209,129,0.7)", fontWeight: 700 }}>
                      Ожидается поступлений
                    </span>
                    <strong style={{ fontSize: 20 }}>+{rentFmt(b.expectedIn)} ₽</strong>
                  </div>
                </div>
                <div className="bank-hero__stat" style={{ color: "#ef8f76" }}>
                  <ArrowUpRight size={16} />
                  <div>
                    <span style={{ color: "rgba(239,143,118,0.7)", fontWeight: 700 }}>
                      К оплате (расходы)
                    </span>
                    <strong style={{ fontSize: 20 }}>−{rentFmt(b.expectedOut)} ₽</strong>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Сводные показатели */}
      <div className="admin-stat-grid">
        <div className="admin-stat">
          <div className="admin-stat__icon" style={{ background: "var(--adm-pine-pale)", color: "var(--adm-pine)" }}>
            <Users size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Активных арендаторов</div>
            <div className="admin-stat__value">{states.length}</div>
          </div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat__icon" style={{ background: "var(--adm-pine-pale)", color: "var(--adm-pine)" }}>
            <ArrowDownLeft size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Должны нам (по счетам)</div>
            <div className="admin-stat__value">{rentFmt(totalDebt)} ₽</div>
          </div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat__icon" style={{ background: "var(--adm-rust-pale)", color: "var(--adm-rust)" }}>
            <AlertTriangle size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Просрочено (после отсрочки)</div>
            <div className="admin-stat__value" style={{ color: overdueSum > 0 ? "var(--adm-rust)" : undefined }}>
              {rentFmt(overdueSum)} ₽ · {overdueStates.length}
            </div>
          </div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat__icon" style={{ background: "var(--adm-kraft-pale)", color: "var(--adm-kraft)" }}>
            <BellRing size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Напоминания: 7 дней + отсрочки</div>
            <div className="admin-stat__value">{upcoming.length}</div>
          </div>
        </div>
      </div>

      {/* Сбор месяца + не выставленные счета */}
      <div className="rent-two-col">
        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">Сбор за месяц</h3>
            <span className="admin-muted" style={{ fontSize: 13 }}>
              поступило <b style={{ color: "var(--adm-pine)" }}>{rentFmt(collection.fact)} ₽</b> из{" "}
              <b>{rentFmt(collection.plan)} ₽</b> к сбору
            </span>
          </div>
          <div className="admin-card__pad">
            <div className="rent-progress" title={`Собрано ${collection.pct}%`}>
              <div className="rent-progress__fill" style={{ width: `${collection.pct}%` }} />
            </div>
            <div className="admin-muted" style={{ fontSize: 12, marginTop: 6 }}>
              «К сбору» — все неоплаченные счета со сроком до конца месяца (включая
              просроченные). Поступления — проведённые платежи за текущий месяц.
            </div>
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">Не выставлены счета</h3>
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
                  {notInvoiced.slice(0, 12).map((t) => (
                    <span key={t.id} className="rent-chip">
                      {t.name}
                      {t.office ? <span className="admin-muted">· {t.office}</span> : null}
                    </span>
                  ))}
                  {notInvoiced.length > 12 && (
                    <span className="rent-chip">ещё {notInvoiced.length - 12}…</span>
                  )}
                </div>
                <div className="admin-muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Нажмите «Выставить счета за следующий период» во вкладке «Начисления»,
                  чтобы начислить аренду по правилам каждого арендатора.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rent-two-col">
        {/* Просрочки */}
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
                {overdueRows.map(({ invoice, tenant, daysOverdue, limitDate }) => (
                  <div key={invoice.id} className="rent-row rent-row--danger">
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
                        Счёт АР-{invoice.number} · период{" "}
                        {rentFmtDate(invoice.periodStart)}–{rentFmtDate(invoice.periodEnd)} ·
                        срок {rentFmtDate(invoice.dueDate)}
                        {tenant.deferralDays > 0 && ` + отсрочка ${tenant.deferralDays} дн.`}
                      </div>
                    </div>
                    <div className="rent-row__side">
                      <strong style={{ color: "var(--adm-rust)" }}>{rentFmt(invoice.amount)} ₽</strong>
                      <span className="admin-badge admin-badge--red">{daysOverdue} дн.</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Напоминания */}
        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">
              <BellRing size={15} style={{ color: "var(--adm-kraft)", verticalAlign: "-2px", marginRight: 6 }} />
              Ближайшие оплаты (7 дней)
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
                  <div key={invoice.id} className="rent-row">
                    <div className="rent-row__main">
                      <div className="rent-row__title">{tenant.name}</div>
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        Счёт АР-{invoice.number} · {orgName(invoice.accountOrgId)} · оплата до{" "}
                        {rentFmtDate(invoice.dueDate)}
                      </div>
                    </div>
                    <div className="rent-row__side">
                      <strong>{rentFmt(invoice.amount)} ₽</strong>
                      <span className="admin-badge admin-badge--amber">
                        {grace
                          ? `отсрочка ${tenant.deferralDays} дн.`
                          : daysLeft === 0
                            ? "сегодня"
                            : `через ${daysLeft} дн.`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Последние платежи */}
      <div className="admin-card">
        <div className="admin-card__head">
          <h3 className="admin-card__title">
            <History size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            Последние проведённые платежи
          </h3>
        </div>
        <div className="admin-card__pad">
          {recentPayments.length === 0 ? (
            <div className="admin-empty">Платежей пока нет</div>
          ) : (
            <div className="rent-rows">
              {recentPayments.map((p) => (
                <div key={p.id} className="rent-row">
                  <div className="rent-row__main">
                    <div className="rent-row__title">
                      {p.counterparty}
                      <span className="admin-badge admin-badge--muted">{orgName(p.accountOrgId)}</span>
                      <span className="admin-badge admin-badge--muted">
                        {p.method === "cash" ? "наличка" : "безнал"}
                      </span>
                    </div>
                    <div className="admin-muted" style={{ fontSize: 12 }}>
                      {rentFmtDate(p.date)} · АП-{p.number}
                      {p.comment ? ` · ${p.comment}` : ""}
                    </div>
                  </div>
                  <div className="rent-row__side">
                    <strong style={{ color: p.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-rust)" }}>
                      {p.direction === "incoming" ? "+" : "−"}{rentFmt(p.amount)} ₽
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
