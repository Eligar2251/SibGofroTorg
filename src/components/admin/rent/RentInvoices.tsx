// =========================================================
// FILE: src/components/admin/rent/RentInvoices.tsx
// Начисления (счета) за аренду: выставление по периодам,
// массовая генерация, быстрые действия (оплатить/отменить),
// статусы с учётом отсрочки арендатора.
// =========================================================

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CheckCircle2,
  FilePlus2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import {
  rentAddMonths,
  rentFmt,
  rentFmtDate,
  rentInvoiceState,
  rentTodayIso,
  rentToIso,
  RENT_INVOICE_STATE_LABELS,
  type RentInvoice,
  type RentInvoiceState,
  type RentOrg,
  type RentPayment,
  type RentTenant,
} from "@/lib/rent-shared";

type StatusFilter = "all" | "unpaid" | "overdue" | "paid" | "cancelled";

const STATE_BADGE: Record<RentInvoiceState, string> = {
  paid: "admin-badge admin-badge--green",
  cancelled: "admin-badge admin-badge--muted",
  overdue: "admin-badge admin-badge--red",
  grace: "admin-badge admin-badge--amber",
  due_today: "admin-badge admin-badge--amber",
  upcoming: "admin-badge admin-badge--amber",
  awaiting: "admin-badge admin-badge--blue",
};

export function RentInvoices({
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unpaid");
  const [orgFilter, setOrgFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<RentInvoice | null>(null);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<{ inv: RentInvoice; tenant?: RentTenant } | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const tenantById = useMemo(
    () => Object.fromEntries(tenants.map((t) => [t.id, t])),
    [tenants]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru-RU");
    return invoices
      .map((inv) => {
        const tenant = tenantById[inv.tenantId];
        const state = rentInvoiceState(inv, tenant?.deferralDays ?? 0, today);
        return { inv, tenant, state };
      })
      .filter(({ state }) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "unpaid") return state !== "paid" && state !== "cancelled";
        if (statusFilter === "overdue") return state === "overdue";
        if (statusFilter === "paid") return state === "paid";
        return state === "cancelled";
      })
      .filter(({ inv }) => orgFilter === "all" || inv.accountOrgId === orgFilter)
      .filter(
        ({ inv, tenant }) =>
          !q ||
          (tenant?.name || "").toLocaleLowerCase("ru-RU").includes(q) ||
          String(inv.number).includes(q) ||
          (tenant?.office || "").toLocaleLowerCase("ru-RU").includes(q)
      )
      .sort((a, b) => b.inv.dueDate.localeCompare(a.inv.dueDate));
  }, [invoices, tenantById, statusFilter, orgFilter, query, today]);

  async function generate() {
    setBusyId("generate");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/rent/invoices/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setNotice(`Выставлено счетов: ${data.created}. Пропущено (уже выставлено/оплачено наперёд): ${data.skipped}.`);
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setBusyId("");
    }
  }

  // Оплаты по счетам (для частичных оплат и ручного закрытия).
  const paidByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) {
      if (p.isPaid && p.direction === "incoming" && p.invoiceId) {
        m.set(p.invoiceId, (m.get(p.invoiceId) || 0) + p.amount);
      }
    }
    return m;
  }, [payments]);
  const invoiceHasPayments = useMemo(() => {
    const s = new Set<string>();
    for (const p of payments) if (p.invoiceId) s.add(p.invoiceId);
    return s;
  }, [payments]);

  const rowsTotal = useMemo(
    () => rows.reduce((s, r) => s + r.inv.amount, 0),
    [rows]
  );

  async function patchInvoice(inv: RentInvoice, patch: Record<string, unknown>) {
    setBusyId(inv.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/invoices/${inv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
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

  async function removeInvoice(inv: RentInvoice) {
    if (!confirm(`Удалить начисление АР-${inv.number}?`)) return;
    setBusyId(inv.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/invoices/${inv.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setBusyId("");
    }
  }

  const orgName = (id: string) => orgs.find((o) => o.id === id)?.shortName || id;

  return (
    <div className="admin-stack">
      <div className="admin-filters">
        {([
          ["unpaid", "Ждут оплаты"],
          ["overdue", "Просроченные"],
          ["paid", "Оплаченные"],
          ["cancelled", "Отменённые"],
          ["all", "Все"],
        ] as [StatusFilter, string][]).map(([key, label]) => (
          <button
            key={key}
            className={`admin-filter${statusFilter === key ? " admin-filter--active" : ""}`}
            onClick={() => setStatusFilter(key)}
          >
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <select className="admin-select" style={{ width: "auto" }} value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
          <option value="all">Все счета</option>
          {orgs.filter((o) => !o.paysToOrgId).map((o) => (
            <option key={o.id} value={o.id}>{o.shortName}</option>
          ))}
        </select>
        <div className="admin-field" style={{ position: "relative", minWidth: 220, marginBottom: 0 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
          <input
            className="admin-input"
            style={{ paddingLeft: 32 }}
            placeholder="Поиск: арендатор, офис, №"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {!readOnly && (
        <div className="admin-filters">
          <button className="admin-btn admin-btn--primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> Новое начисление
          </button>
          <button
            className="admin-btn admin-btn--outline"
            disabled={busyId === "generate"}
            onClick={generate}
            title="Выставит счета за следующий период всем активным арендаторам по их правилам (период, день оплаты)"
          >
            {busyId === "generate" ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Выставить счета за следующий период
          </button>
        </div>
      )}

      {error && <div className="admin-error">{error}</div>}
      {notice && <div className="admin-success">{notice}</div>}

      <div className="admin-card">
        <div className="admin-card__head">
          <h3 className="admin-card__title">Начисления</h3>
          <span className="admin-muted" style={{ fontSize: 13 }}>
            {rows.length} шт. · на сумму <b>{rentFmt(rowsTotal)} ₽</b>
          </span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Арендатор</th>
                <th>Период аренды</th>
                <th>Выставлен</th>
                <th>Оплата до</th>
                <th>Сумма</th>
                <th>Счёт</th>
                <th>Статус</th>
                {!readOnly && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="admin-table__empty">Начислений нет</td>
                </tr>
              )}
              {rows.map(({ inv, tenant, state }) => (
                <tr key={inv.id}>
                  <td className="admin-muted">АР-{inv.number}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{tenant?.name || "—"}</div>
                    <div className="admin-muted" style={{ fontSize: 12 }}>
                      {tenant?.office ? `${tenant.office} · ` : ""}{orgName(inv.orgId)}
                    </div>
                  </td>
                  <td>
                    {rentFmtDate(inv.periodStart)}–{rentFmtDate(inv.periodEnd)}
                  </td>
                  <td>{rentFmtDate(inv.issueDate)}</td>
                  <td>
                    {rentFmtDate(inv.dueDate)}
                    {tenant && tenant.deferralDays > 0 && inv.status === "awaiting" && (
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        + отсрочка {tenant.deferralDays} дн.
                      </div>
                    )}
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    {rentFmt(inv.amount)} ₽
                    {inv.status === "awaiting" &&
                      (paidByInvoice.get(inv.id) || 0) > 0 && (
                        <div className="admin-muted" style={{ fontSize: 12, fontWeight: 400 }}>
                          внесено {rentFmt(paidByInvoice.get(inv.id) || 0)} ₽ ·{" "}
                          осталось {rentFmt(inv.amount - (paidByInvoice.get(inv.id) || 0))} ₽
                        </div>
                      )}
                  </td>
                  <td>{orgName(inv.accountOrgId)}</td>
                  <td>
                    <span className={STATE_BADGE[state]}>
                      {RENT_INVOICE_STATE_LABELS[state]}
                    </span>
                    {state === "paid" && inv.paidAt && (
                      <div className="admin-muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {rentFmtDate(inv.paidAt)}{inv.payMethod ? (inv.payMethod === "cash" ? " · наличка" : " · безнал") : ""}
                      </div>
                    )}
                  </td>
                  {!readOnly && (
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {inv.status === "awaiting" && (
                          <button
                            className="admin-btn admin-btn--icon admin-btn--outline"
                            title="Принять оплату (можно частично)"
                            onClick={() => setPaying({ inv, tenant })}
                          >
                            <Banknote size={14} />
                          </button>
                        )}
                        {/* Ручное закрытие/возврат — управленческий учёт:
                            деньги могли прийти одной суммой за всё. Доступно,
                            только если по счёту нет платежей в банке. */}
                        {inv.status === "awaiting" && !invoiceHasPayments.has(inv.id) && (
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title="Отметить оплаченным без платежа (пришло одной суммой)"
                            onClick={() => patchInvoice(inv, { status: "paid" })}
                          >
                            <CheckCircle2 size={14} />
                          </button>
                        )}
                        {inv.status === "paid" && !invoiceHasPayments.has(inv.id) && (
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title="Вернуть в ожидание оплаты"
                            onClick={() => patchInvoice(inv, { status: "awaiting" })}
                          >
                            <Undo2 size={14} />
                          </button>
                        )}
                        {inv.status === "awaiting" ? (
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title="Отменить начисление"
                            onClick={() => patchInvoice(inv, { status: "cancelled" })}
                          >
                            <X size={14} />
                          </button>
                        ) : inv.status === "cancelled" ? (
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title="Вернуть в работу"
                            onClick={() => patchInvoice(inv, { status: "awaiting" })}
                          >
                            <Undo2 size={14} />
                          </button>
                        ) : null}
                        {inv.status !== "paid" && (
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title="Редактировать"
                            onClick={() => setEditing(inv)}
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {inv.status !== "paid" && (
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title="Удалить"
                            onClick={() => removeInvoice(inv)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(creating || editing) && (
        <InvoiceFormModal
          orgs={orgs}
          tenants={tenants}
          invoice={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {paying && (
        <QuickPayModal
          invoice={paying.inv}
          tenant={paying.tenant}
          paidBefore={paidByInvoice.get(paying.inv.id) || 0}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  );
}

// ── Быстрая оплата счёта (в т.ч. частичная) ─────────────

function QuickPayModal({
  invoice,
  tenant,
  paidBefore,
  onClose,
}: {
  invoice: RentInvoice;
  tenant: RentTenant | undefined;
  paidBefore: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const remaining = Math.max(0, invoice.amount - paidBefore);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState<string>(String(remaining || invoice.amount));
  const [date, setDate] = useState(rentTodayIso());
  const [method, setMethod] = useState<"bank" | "cash">(
    tenant?.payMethod === "cash" ? "cash" : "bank"
  );
  const [comment, setComment] = useState("");

  async function save() {
    const sum = Number(amount) || 0;
    if (sum <= 0) {
      setError("Укажите сумму оплаты");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/rent/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountOrgId: invoice.accountOrgId,
          direction: "incoming",
          kind: "rent",
          method,
          tenantId: invoice.tenantId,
          invoiceId: invoice.id,
          amount: sum,
          date,
          invoiceNumber: `АР-${invoice.number}`,
          isPaid: true,
          comment:
            comment ||
            `Оплата аренды за период ${rentFmtDate(invoice.periodStart)}–${rentFmtDate(invoice.periodEnd)}${
              sum + 0.009 < remaining ? " (частично)" : ""
            }`,
        }),
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

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
        <div className="admin-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">Оплата счёта АР-{invoice.number}</h3>
            <button className="admin-modal__close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="admin-modal__desc">
            {tenant?.name || "Арендатор"} · период {rentFmtDate(invoice.periodStart)}–
            {rentFmtDate(invoice.periodEnd)} · сумма {rentFmt(invoice.amount)} ₽.
            {paidBefore > 0 && (
              <>
                {" "}
                Уже внесено <b>{rentFmt(paidBefore)} ₽</b>, осталось{" "}
                <b>{rentFmt(remaining)} ₽</b>.
              </>
            )}{" "}
            Можно оплатить частью — счёт закроется, когда сумма оплат покроет его целиком.
          </div>
          <div className="admin-form admin-form--wide" style={{ padding: "0 20px" }}>
            <div className="admin-grid-2">
              <div className="admin-field">
                <label className="admin-label">Сумма оплаты, ₽ *</label>
                <input
                  type="number"
                  min={0}
                  className="admin-input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                {Number(amount) > 0 && Number(amount) + 0.009 < remaining && (
                  <div className="admin-muted" style={{ fontSize: 12 }}>
                    Останется должным {rentFmt(remaining - (Number(amount) || 0))} ₽
                  </div>
                )}
              </div>
              <div className="admin-field">
                <label className="admin-label">Дата оплаты</label>
                <input
                  type="date"
                  className="admin-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Способ</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className={`admin-filter${method === "bank" ? " admin-filter--active" : ""}`}
                    onClick={() => setMethod("bank")}
                  >
                    Безнал
                  </button>
                  <button
                    type="button"
                    className={`admin-filter${method === "cash" ? " admin-filter--active" : ""}`}
                    onClick={() => setMethod("cash")}
                  >
                    Наличка
                  </button>
                </div>
              </div>
              <div className="admin-field">
                <label className="admin-label">Комментарий</label>
                <input
                  className="admin-input"
                  value={comment}
                  placeholder="авто, если пусто"
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
            </div>
          </div>
          {error && <div className="admin-error" style={{ margin: "0 20px" }}>{error}</div>}
          <div className="admin-modal__actions">
            <button className="admin-btn admin-btn--ghost" onClick={onClose}>
              Отмена
            </button>
            <button className="admin-btn admin-btn--primary" disabled={saving} onClick={save}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />}
              Провести оплату
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ── Форма начисления ─────────────────────────────────────

export function InvoiceFormModal({
  orgs,
  tenants,
  invoice,
  presetTenantId,
  onClose,
}: {
  orgs: RentOrg[];
  tenants: RentTenant[];
  invoice: RentInvoice | null;
  /** Предвыбранный арендатор (например, из карточки арендатора). */
  presetTenantId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const activeTenants = tenants.filter(
    (t) => t.status === "active" || t.id === invoice?.tenantId || t.id === presetTenantId
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tenantId, setTenantId] = useState(
    invoice?.tenantId || presetTenantId || activeTenants[0]?.id || ""
  );
  const tenant = tenants.find((t) => t.id === tenantId);

  const [periodStart, setPeriodStart] = useState(
    invoice?.periodStart ||
      (() => {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() + 1);
        return rentToIso(d);
      })()
  );
  const [amount, setAmount] = useState<number | "">(
    invoice ? invoice.amount : tenant ? tenant.monthlyRent * tenant.periodMonths : ""
  );
  const [issueDate, setIssueDate] = useState(invoice?.issueDate || "");
  const [dueDate, setDueDate] = useState(invoice?.dueDate || "");
  const [comment, setComment] = useState(invoice?.comment || "");
  // Пустая строка = конец периода считается автоматически по шагу арендатора.
  const [periodEndOverride, setPeriodEndOverride] = useState("");

  const autoPeriodEnd = useMemo(() => {
    if (!tenant || !periodStart) return "";
    return rentToIso(
      new Date(rentAddMonths(periodStart, tenant.periodMonths).getTime() - 86_400_000)
    );
  }, [tenant, periodStart]);

  const periodEnd = periodEndOverride || (invoice ? invoice.periodEnd : autoPeriodEnd);

  // Смена арендатора → пересчёт суммы.
  function pickTenant(id: string) {
    setTenantId(id);
    const t = tenants.find((x) => x.id === id);
    if (t && !invoice) setAmount(t.monthlyRent * t.periodMonths);
  }

  async function save() {
    if (!tenantId) {
      setError("Выберите арендатора");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = {
        tenantId,
        periodStart,
        periodEnd,
        amount: Number(amount) || 0,
        issueDate: issueDate || null,
        dueDate: dueDate || null,
        comment: comment || null,
      };
      const url = invoice
        ? `/api/admin/rent/invoices/${invoice.id}`
        : "/api/admin/rent/invoices";
      const res = await fetch(url, {
        method: invoice ? "PATCH" : "POST",
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

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
      <div className="admin-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {invoice ? `Начисление АР-${invoice.number}` : "Новое начисление аренды"}
          </h3>
          <button className="admin-modal__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="admin-modal__desc">
          Даты счёта и оплаты считаются автоматически по правилам арендатора
          (день выставления и крайний день оплаты), при необходимости меняются вручную.
        </div>
        <div className="admin-form admin-form--wide" style={{ padding: "0 20px" }}>
          <div className="admin-grid-2">
            <div className="admin-field" style={{ gridColumn: "1 / -1" }}>
              <label className="admin-label">Арендатор *</label>
              <select
                className="admin-select"
                value={tenantId}
                disabled={!!invoice}
                title={invoice ? "Арендатор меняется созданием нового начисления" : undefined}
                onChange={(e) => pickTenant(e.target.value)}
              >
                {activeTenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.office ? ` · ${t.office}` : ""} · {orgs.find((o) => o.id === t.orgId)?.shortName}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-label">Начало периода *</label>
              <input type="date" className="admin-input" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="admin-field">
              <label className="admin-label">Конец периода</label>
              <input
                type="date"
                className="admin-input"
                value={periodEnd}
                onChange={(e) => setPeriodEndOverride(e.target.value)}
              />
              <div className="admin-muted" style={{ fontSize: 12 }}>
                {tenant ? `Авто по шагу (${tenant.periodMonths} мес.): ${rentFmtDate(autoPeriodEnd)}` : ""}
              </div>
            </div>
            <div className="admin-field">
              <label className="admin-label">Сумма, ₽ *</label>
              <input type="number" min={0} className="admin-input" value={amount}
                onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")} />
              {tenant && (
                <div className="admin-muted" style={{ fontSize: 12 }}>
                  {rentFmt(tenant.monthlyRent)} ₽/мес × {tenant.periodMonths} мес.
                </div>
              )}
            </div>
            <div className="admin-field">
              <label className="admin-label">Дата выставления счёта</label>
              <input type="date" className="admin-input" value={issueDate}
                placeholder="авто" onChange={(e) => setIssueDate(e.target.value)} />
              <div className="admin-muted" style={{ fontSize: 12 }}>пусто = автоматически</div>
            </div>
            <div className="admin-field">
              <label className="admin-label">Оплата до</label>
              <input type="date" className="admin-input" value={dueDate}
                onChange={(e) => setDueDate(e.target.value)} />
              <div className="admin-muted" style={{ fontSize: 12 }}>пусто = автоматически</div>
            </div>
            <div className="admin-field" style={{ gridColumn: "1 / -1" }}>
              <label className="admin-label">Комментарий</label>
              <textarea className="admin-textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
          </div>
        </div>
        {error && <div className="admin-error" style={{ margin: "0 20px" }}>{error}</div>}
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--ghost" onClick={onClose}>Отмена</button>
          <button className="admin-btn admin-btn--primary" disabled={saving} onClick={save}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <FilePlus2 size={14} />}
            {invoice ? "Сохранить" : "Выставить счёт"}
          </button>
        </div>
      </div>
      </div>
    </ModalPortal>
  );
}
