// =========================================================
// FILE: src/components/admin/rent/RentTenantCard.tsx
// Карточка арендатора: условия договора, показатели (оплачено
// по, долг, просрочка, аванс) и полная история — начисления
// и платежи. Быстрые действия: начислить, принять оплату.
// =========================================================

"use client";

import { useMemo } from "react";
import {
  Archive,
  ArchiveRestore,
  Banknote,
  CreditCard,
  FilePlus2,
  Pencil,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import {
  computeTenantState,
  rentDueDay,
  rentFmt,
  rentFmtDate,
  rentHasPayeeNote,
  rentInvoiceState,
  rentPeriodLabel,
  rentTenantAdvance,
  rentTodayIso,
  RENT_INVOICE_STATE_LABELS,
  RENT_PAYMENT_KIND_LABELS,
  type RentInvoice,
  type RentInvoiceState,
  type RentOrg,
  type RentPayment,
  type RentTenant,
} from "@/lib/rent-shared";

const STATE_BADGE: Record<RentInvoiceState, string> = {
  paid: "admin-badge admin-badge--green",
  cancelled: "admin-badge admin-badge--muted",
  overdue: "admin-badge admin-badge--red",
  grace: "admin-badge admin-badge--amber",
  due_today: "admin-badge admin-badge--amber",
  upcoming: "admin-badge admin-badge--amber",
  awaiting: "admin-badge admin-badge--blue",
};

export function TenantCardModal({
  tenant,
  orgs,
  invoices,
  payments,
  readOnly,
  onClose,
  onEdit,
  onNewInvoice,
  onNewPayment,
  onArchive,
  onDelete,
}: {
  tenant: RentTenant;
  orgs: RentOrg[];
  invoices: RentInvoice[];
  payments: RentPayment[];
  readOnly: boolean;
  onClose: () => void;
  onEdit: () => void;
  onNewInvoice: () => void;
  onNewPayment: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const today = rentTodayIso();
  const st = useMemo(
    () => computeTenantState(tenant, invoices, today),
    [tenant, invoices, today]
  );
  const advance = useMemo(
    () => rentTenantAdvance(tenant.id, payments),
    [tenant.id, payments]
  );

  const ownInvoices = useMemo(
    () =>
      invoices
        .filter((i) => i.tenantId === tenant.id)
        .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
        .slice(0, 14),
    [invoices, tenant.id]
  );
  const ownPayments = useMemo(
    () =>
      payments
        .filter((p) => p.tenantId === tenant.id)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 14),
    [payments, tenant.id]
  );

  const org = orgs.find((o) => o.id === tenant.orgId);
  const dueDay = rentDueDay(tenant, orgs);

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
        <div
          className="admin-modal"
          style={{ maxWidth: 820 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">
              {tenant.name}
              {tenant.status === "archived" && (
                <span className="admin-badge admin-badge--muted" style={{ marginLeft: 8 }}>
                  архив
                </span>
              )}
            </h3>
            <button className="admin-modal__close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          {/* Условия */}
          <div className="rent-card-meta">
            <span>
              <b>{org?.shortName || tenant.orgId}</b> · организация
            </span>
            {rentHasPayeeNote(tenant, orgs) && (
              <span className="admin-badge admin-badge--amber">деньги на счёт БАУ</span>
            )}
            <span>{tenant.office ? `${tenant.office} · офис` : "офис не указан"}</span>
            <span>
              Договор {tenant.contractNumber ? `№ ${tenant.contractNumber}` : "—"}
              {tenant.contractDate ? ` от ${rentFmtDate(tenant.contractDate)}` : ""}
            </span>
            <span>
              {rentFmt(tenant.monthlyRent)} ₽/мес · {rentPeriodLabel(tenant.periodMonths).toLocaleLowerCase("ru-RU")}
            </span>
            <span>
              оплата до {dueDay}-го{tenant.dueDay ? " (исключение)" : ""}
              {tenant.deferralDays > 0 ? ` · отсрочка ${tenant.deferralDays} дн.` : ""}
            </span>
            <span>
              {tenant.payMethod === "cash"
                ? "только наличка"
                : tenant.payMethod === "bank"
                  ? "только безнал"
                  : "безнал / наличка"}
            </span>
            {tenant.contactName && <span>{tenant.contactName}</span>}
            {tenant.phone && <span>{tenant.phone}</span>}
            {tenant.inn && <span>ИНН {tenant.inn}</span>}
          </div>

          {/* Показатели */}
          <div className="rent-card-stats">
            <div className="rent-card-stat">
              <span className="rent-card-stat__label">Оплачено по</span>
              <strong>{st.paidUntil ? rentFmtDate(st.paidUntil) : "—"}</strong>
            </div>
            <div className="rent-card-stat">
              <span className="rent-card-stat__label">Долг по счетам</span>
              <strong style={{ color: st.debt > 0 ? "var(--adm-rust)" : "var(--adm-pine)" }}>
                {rentFmt(st.debt)} ₽
              </strong>
            </div>
            <div className="rent-card-stat">
              <span className="rent-card-stat__label">Просрочка</span>
              <strong style={{ color: st.overdue > 0 ? "var(--adm-rust)" : undefined }}>
                {st.overdue > 0 ? `${rentFmt(st.overdue)} ₽ · ${st.overdueDays} дн.` : "нет"}
              </strong>
            </div>
            <div className="rent-card-stat">
              <span className="rent-card-stat__label">Следующая оплата</span>
              <strong>
                {st.nextDueDate
                  ? `${rentFmtDate(st.nextDueDate)} · ${rentFmt(st.nextDueAmount)} ₽`
                  : "—"}
              </strong>
            </div>
            <div className="rent-card-stat">
              <span className="rent-card-stat__label">Аванс (без счёта)</span>
              <strong style={{ color: advance > 0 ? "var(--adm-pine)" : undefined }}>
                {advance !== 0 ? `${advance > 0 ? "+" : ""}${rentFmt(advance)} ₽` : "—"}
              </strong>
            </div>
          </div>

          {tenant.comment && (
            <div className="admin-muted" style={{ fontSize: 13, padding: "0 2px" }}>
              💬 {tenant.comment}
            </div>
          )}

          {/* Быстрые действия */}
          {!readOnly && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
              <button className="admin-btn admin-btn--primary admin-btn--sm" onClick={onNewInvoice}>
                <FilePlus2 size={13} /> Начислить аренду
              </button>
              <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={onNewPayment}>
                <Wallet size={13} /> Принять оплату
              </button>
              <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={onEdit}>
                <Pencil size={13} /> Редактировать
              </button>
              <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={onArchive}>
                {tenant.status === "active" ? <Archive size={13} /> : <ArchiveRestore size={13} />}
                {tenant.status === "active" ? "В архив" : "Вернуть"}
              </button>
              <button
                className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                onClick={onDelete}
                title="Удалить можно, только если нет начислений"
              >
                <Trash2 size={13} /> Удалить
              </button>
            </div>
          )}

          <div className="rent-two-col" style={{ marginTop: 14 }}>
            {/* История начислений */}
            <div>
              <div className="rent-card-h">Начисления</div>
              {ownInvoices.length === 0 ? (
                <div className="admin-muted" style={{ fontSize: 13 }}>Начислений ещё нет</div>
              ) : (
                <div className="rent-rows">
                  {ownInvoices.map((inv) => {
                    const state = rentInvoiceState(inv, tenant.deferralDays, today);
                    return (
                      <div key={inv.id} className="rent-row" style={{ padding: "7px 8px" }}>
                        <div className="rent-row__main">
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            АР-{inv.number} · {rentFmtDate(inv.periodStart)}–{rentFmtDate(inv.periodEnd)}
                          </div>
                          <div className="admin-muted" style={{ fontSize: 12 }}>
                            до {rentFmtDate(inv.dueDate)}
                            {inv.status === "paid" && inv.paidAt ? ` · оплачен ${rentFmtDate(inv.paidAt)}` : ""}
                          </div>
                        </div>
                        <div className="rent-row__side">
                          <strong style={{ fontSize: 13 }}>{rentFmt(inv.amount)} ₽</strong>
                          <span className={STATE_BADGE[state]}>
                            {RENT_INVOICE_STATE_LABELS[state]}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* История платежей */}
            <div>
              <div className="rent-card-h">Платежи</div>
              {ownPayments.length === 0 ? (
                <div className="admin-muted" style={{ fontSize: 13 }}>Платежей ещё нет</div>
              ) : (
                <div className="rent-rows">
                  {ownPayments.map((p) => (
                    <div key={p.id} className="rent-row" style={{ padding: "7px 8px" }}>
                      <div className="rent-row__main">
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          АП-{p.number} · {rentFmtDate(p.date)}
                          {p.method === "cash" ? (
                            <Banknote size={12} style={{ verticalAlign: "-1px", marginLeft: 5 }} />
                          ) : (
                            <CreditCard size={12} style={{ verticalAlign: "-1px", marginLeft: 5 }} />
                          )}
                        </div>
                        <div className="admin-muted" style={{ fontSize: 12 }}>
                          {RENT_PAYMENT_KIND_LABELS[p.kind] || p.kind}
                          {p.isPaid ? "" : " · ожидает"}
                          {p.invoiceId ? "" : " · без счёта"}
                        </div>
                      </div>
                      <div className="rent-row__side">
                        <strong
                          style={{
                            fontSize: 13,
                            color: p.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-rust)",
                          }}
                        >
                          {p.direction === "incoming" ? "+" : "−"}
                          {rentFmt(p.amount)} ₽
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
