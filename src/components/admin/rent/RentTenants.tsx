// =========================================================
// FILE: src/components/admin/rent/RentTenants.tsx
// Арендаторы (контрагенты с договором): организация, офис,
// договор, период оплаты, крайний день (исключения), отсрочка,
// способ оплаты. Плюс сводка долга по каждому.
// =========================================================

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import {
  computeTenantState,
  rentDueDay,
  rentFmt,
  rentFmtDate,
  rentHasPayeeNote,
  rentPeriodLabel,
  rentTodayIso,
  RENT_PAY_METHOD_LABELS,
  type RentInvoice,
  type RentOrg,
  type RentPayment,
  type RentTenant,
} from "@/lib/rent-shared";
import { TenantCardModal } from "./RentTenantCard";
import { InvoiceFormModal } from "./RentInvoices";
import { PaymentFormModal } from "./RentBank";

const PERIOD_CHOICES = [1, 3, 6, 12];

export function RentTenants({
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
  const [orgFilter, setOrgFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<RentTenant | null>(null);
  const [creating, setCreating] = useState(false);
  const [cardTenant, setCardTenant] = useState<RentTenant | null>(null);
  const [invoicePreset, setInvoicePreset] = useState<RentTenant | null>(null);
  const [paymentPreset, setPaymentPreset] = useState<RentTenant | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const states = useMemo(
    () => new Map(
      tenants.map((t) => [t.id, computeTenantState(t, invoices, today)] as const)
    ),
    [tenants, invoices, today]
  );

  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru-RU");
    return tenants
      .filter((t) => (statusFilter === "archived" ? t.status === "archived" : t.status === "active"))
      .filter((t) => orgFilter === "all" || t.orgId === orgFilter)
      .filter(
        (t) =>
          !q ||
          t.name.toLocaleLowerCase("ru-RU").includes(q) ||
          (t.office || "").toLocaleLowerCase("ru-RU").includes(q) ||
          (t.contractNumber || "").toLocaleLowerCase("ru-RU").includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ru-RU"));
  }, [tenants, orgFilter, statusFilter, query]);

  async function archiveTenant(t: RentTenant) {
    const next = t.status === "active" ? "archived" : "active";
    const verb = next === "archived" ? "архив" : "активные";
    if (!confirm(`Перевести «${t.name}» в ${verb}?`)) return;
    setBusyId(t.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/tenants/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: t.orgId,
          name: t.name,
          office: t.office,
          contractNumber: t.contractNumber,
          contractDate: t.contractDate,
          monthlyRent: t.monthlyRent,
          periodMonths: t.periodMonths,
          dueDay: t.dueDay,
          invoiceDay: t.invoiceDay,
          deferralDays: t.deferralDays,
          payMethod: t.payMethod,
          contactName: t.contactName,
          phone: t.phone,
          email: t.email,
          inn: t.inn,
          comment: t.comment,
          status: next,
        }),
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

  async function deleteTenant(t: RentTenant) {
    if (!confirm(`Удалить арендатора «${t.name}»? Действие необратимо.`)) return;
    setBusyId(t.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/tenants/${t.id}`, { method: "DELETE" });
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
      <div className="admin-filters admin-filters--sub">
        <button
          className={`admin-filter${orgFilter === "all" ? " admin-filter--active" : ""}`}
          onClick={() => setOrgFilter("all")}
        >
          Все организации
        </button>
        {orgs.map((o) => (
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
          className={`admin-filter${statusFilter === "active" ? " admin-filter--active" : ""}`}
          onClick={() => setStatusFilter("active")}
        >
          Активные
        </button>
        <button
          className={`admin-filter${statusFilter === "archived" ? " admin-filter--active" : ""}`}
          onClick={() => setStatusFilter("archived")}
        >
          Архив
        </button>
      </div>

      <div className="admin-filters">
        <div className="admin-field" style={{ position: "relative", minWidth: 260, marginBottom: 0 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
          <input
            className="admin-input"
            style={{ paddingLeft: 32 }}
            placeholder="Поиск: название, офис, договор"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!readOnly && (
          <button className="admin-btn admin-btn--primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> Новый арендатор
          </button>
        )}
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Арендатор</th>
                <th>Организация</th>
                <th>Офис</th>
                <th>Договор</th>
                <th>Период и условия</th>
                <th>Аренда</th>
                <th>Оплачено по</th>
                <th>Долг</th>
                {!readOnly && <th />}
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={9} className="admin-table__empty">
                    Арендаторы не найдены
                  </td>
                </tr>
              )}
              {list.map((t) => {
                const st = states.get(t.id);
                const dueDay = rentDueDay(t, orgs);
                return (
                  <tr
                    key={t.id}
                    className="rent-tr-click"
                    style={t.status === "archived" ? { opacity: 0.55 } : undefined}
                    onClick={() => setCardTenant(t)}
                    title="Открыть карточку арендатора"
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {t.name}
                        {rentHasPayeeNote(t, orgs) && (
                          <span
                            className="admin-badge admin-badge--amber"
                            style={{ marginLeft: 6 }}
                            title="Договор с СибИнвестТоргом: деньги приходят на счёт БАУ"
                          >
                            деньги на БАУ
                          </span>
                        )}
                      </div>
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        {t.contactName || t.phone || t.email || "\u00A0"}
                      </div>
                    </td>
                    <td>{orgName(t.orgId)}</td>
                    <td>{t.office || "—"}</td>
                    <td>
                      {t.contractNumber ? `№ ${t.contractNumber}` : "—"}
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        {t.contractDate ? rentFmtDate(t.contractDate) : ""}
                      </div>
                    </td>
                    <td>
                      {rentPeriodLabel(t.periodMonths)} · оплата до {dueDay}-го
                      {t.dueDay ? (
                        <span className="admin-badge admin-badge--indigo" style={{ marginLeft: 6 }}>
                          исключение
                        </span>
                      ) : null}
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        {RENT_PAY_METHOD_LABELS[t.payMethod]}
                        {t.deferralDays > 0 ? ` · отсрочка ${t.deferralDays} дн.` : ""}
                      </div>
                    </td>
                    <td>
                      {rentFmt(t.monthlyRent)} ₽/мес
                    </td>
                    <td>{st?.paidUntil ? rentFmtDate(st.paidUntil) : "—"}</td>
                    <td>
                      {st && st.overdue > 0 ? (
                        <span className="admin-badge admin-badge--red">
                          {rentFmt(st.overdue)} ₽ · просрочка {st.overdueDays} дн.
                        </span>
                      ) : st && st.debt > 0 ? (
                        <span className="admin-badge admin-badge--amber">{rentFmt(st.debt)} ₽</span>
                      ) : (
                        <span className="admin-badge admin-badge--green">нет долга</span>
                      )}
                    </td>
                    {!readOnly && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title="Редактировать"
                            onClick={() => setEditing(t)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title={t.status === "active" ? "В архив" : "Вернуть из архива"}
                            disabled={busyId === t.id}
                            onClick={() => archiveTenant(t)}
                          >
                            {busyId === t.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : t.status === "active" ? (
                              <Archive size={14} />
                            ) : (
                              <ArchiveRestore size={14} />
                            )}
                          </button>
                          <button
                            className="admin-btn admin-btn--icon admin-btn--ghost"
                            title="Удалить (если нет начислений)"
                            onClick={() => deleteTenant(t)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {(creating || editing) && (
        <TenantFormModal
          orgs={orgs}
          tenant={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {cardTenant && (
        <TenantCardModal
          tenant={cardTenant}
          orgs={orgs}
          invoices={invoices}
          payments={payments}
          readOnly={readOnly}
          onClose={() => setCardTenant(null)}
          onEdit={() => {
            setEditing(cardTenant);
            setCardTenant(null);
          }}
          onNewInvoice={() => {
            setInvoicePreset(cardTenant);
            setCardTenant(null);
          }}
          onNewPayment={() => {
            setPaymentPreset(cardTenant);
            setCardTenant(null);
          }}
          onArchive={() => {
            archiveTenant(cardTenant);
            setCardTenant(null);
          }}
          onDelete={() => {
            deleteTenant(cardTenant);
            setCardTenant(null);
          }}
        />
      )}

      {invoicePreset && (
        <InvoiceFormModal
          orgs={orgs}
          tenants={tenants}
          invoice={null}
          presetTenantId={invoicePreset.id}
          onClose={() => setInvoicePreset(null)}
        />
      )}

      {paymentPreset && (
        <PaymentFormModal
          orgs={orgs}
          tenants={tenants}
          invoices={invoices}
          payment={null}
          presetTenantId={paymentPreset.id}
          onClose={() => setPaymentPreset(null)}
        />
      )}
    </div>
  );
}

// ── Форма арендатора ─────────────────────────────────────

export function TenantFormModal({
  orgs,
  tenant,
  onClose,
}: {
  orgs: RentOrg[];
  tenant: RentTenant | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    orgId: tenant?.orgId || orgs[0]?.id || "bau",
    name: tenant?.name || "",
    office: tenant?.office || "",
    contractNumber: tenant?.contractNumber || "",
    contractDate: tenant?.contractDate || "",
    monthlyRent: tenant?.monthlyRent || 0,
    periodMonths: tenant?.periodMonths || 1,
    dueDay: tenant?.dueDay ?? null,
    invoiceDay: tenant?.invoiceDay ?? null,
    deferralDays: tenant?.deferralDays || 0,
    payMethod: tenant?.payMethod || "any",
    contactName: tenant?.contactName || "",
    phone: tenant?.phone || "",
    email: tenant?.email || "",
    inn: tenant?.inn || "",
    comment: tenant?.comment || "",
  }));

  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));

  const selectedOrg = orgs.find((o) => o.id === form.orgId);

  async function save() {
    if (!form.name.trim()) {
      setError("Укажите название арендатора");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = {
        ...form,
        monthlyRent: Number(form.monthlyRent) || 0,
        periodMonths: Number(form.periodMonths) || 1,
        dueDay: form.dueDay ? Number(form.dueDay) : null,
        invoiceDay: form.invoiceDay ? Number(form.invoiceDay) : null,
        deferralDays: Number(form.deferralDays) || 0,
        status: tenant?.status || "active",
      };
      const url = tenant
        ? `/api/admin/rent/tenants/${tenant.id}`
        : "/api/admin/rent/tenants";
      const res = await fetch(url, {
        method: tenant ? "PATCH" : "POST",
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
      <div className="admin-modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {tenant ? `Арендатор: ${tenant.name}` : "Новый арендатор"}
          </h3>
          <button className="admin-modal__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="admin-modal__desc">
          Договор, офис, период и день оплаты. День оплаты по умолчанию берётся
          из настроек организации{selectedOrg ? ` (сейчас: до ${selectedOrg.payDay}-го числа)` : ""},
          исключения задаются отдельно.
        </div>

        <div className="admin-form admin-form--wide" style={{ padding: "0 20px" }}>
          <div className="admin-grid-2">
            <div className="admin-field">
              <label className="admin-label">Название / ФИО *</label>
              <input className="admin-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="ООО «Ромашка» или Иванов И.И." />
            </div>
            <div className="admin-field">
              <label className="admin-label">К кому относится *</label>
              <select className="admin-select" value={form.orgId} onChange={(e) => set("orgId", e.target.value)}>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}{o.paysToOrgId ? " (деньги на счёт БАУ)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-label">Офис / помещение</label>
              <input className="admin-input" value={form.office} onChange={(e) => set("office", e.target.value)} placeholder="Офис 214, склад 3…" />
            </div>
            <div className="admin-field">
              <label className="admin-label">ИНН</label>
              <input className="admin-input" value={form.inn} onChange={(e) => set("inn", e.target.value)} />
            </div>
            <div className="admin-field">
              <label className="admin-label">Договор №</label>
              <input className="admin-input" value={form.contractNumber} onChange={(e) => set("contractNumber", e.target.value)} />
            </div>
            <div className="admin-field">
              <label className="admin-label">Дата договора</label>
              <input type="date" className="admin-input" value={form.contractDate} onChange={(e) => set("contractDate", e.target.value)} />
            </div>
            <div className="admin-field">
              <label className="admin-label">Ставка, ₽/мес</label>
              <input type="number" min={0} className="admin-input" value={form.monthlyRent} onChange={(e) => set("monthlyRent", e.target.value)} />
            </div>
            <div className="admin-field">
              <label className="admin-label">Период оплаты</label>
              <div style={{ display: "flex", gap: 6 }}>
                <select
                  className="admin-select"
                  value={PERIOD_CHOICES.includes(form.periodMonths as number) ? String(form.periodMonths) : "custom"}
                  onChange={(e) => {
                    if (e.target.value !== "custom") set("periodMonths", Number(e.target.value));
                  }}
                >
                  <option value="1">Ежемесячно</option>
                  <option value="3">Квартал</option>
                  <option value="6">Полгода</option>
                  <option value="12">Год</option>
                  <option value="custom">Свой период…</option>
                </select>
                {!PERIOD_CHOICES.includes(form.periodMonths as number) && (
                  <input
                    type="number"
                    min={1}
                    className="admin-input"
                    style={{ width: 110 }}
                    value={form.periodMonths}
                    onChange={(e) => set("periodMonths", e.target.value)}
                    title="Период в месяцах"
                  />
                )}
              </div>
            </div>
            <div className="admin-field">
              <label className="admin-label">
                Крайний день оплаты{" "}
                <span className="admin-muted">(пусто = до {selectedOrg?.payDay ?? 3}-го для всех)</span>
              </label>
              <input
                type="number"
                min={1}
                max={31}
                className="admin-input"
                placeholder={`До ${selectedOrg?.payDay ?? 3}-го`}
                value={form.dueDay ?? ""}
                onChange={(e) => set("dueDay", e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">
                День выставления счёта{" "}
                <span className="admin-muted">(пусто = {selectedOrg?.invoiceDay ?? 25}-го)</span>
              </label>
              <input
                type="number"
                min={1}
                max={31}
                className="admin-input"
                placeholder={`${selectedOrg?.invoiceDay ?? 25}-го числа`}
                value={form.invoiceDay ?? ""}
                onChange={(e) => set("invoiceDay", e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Отсрочка, дней</label>
              <input type="number" min={0} className="admin-input" value={form.deferralDays} onChange={(e) => set("deferralDays", e.target.value)} />
            </div>
            <div className="admin-field">
              <label className="admin-label">Способ оплаты</label>
              <select className="admin-select" value={form.payMethod} onChange={(e) => set("payMethod", e.target.value)}>
                <option value="any">Безнал / наличка</option>
                <option value="bank">Только безнал</option>
                <option value="cash">Только наличка</option>
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-label">Контактное лицо</label>
              <input className="admin-input" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
            </div>
            <div className="admin-field">
              <label className="admin-label">Телефон</label>
              <input className="admin-input" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="admin-field">
              <label className="admin-label">E-mail</label>
              <input className="admin-input" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="admin-field" style={{ gridColumn: "1 / -1" }}>
              <label className="admin-label">Комментарий</label>
              <textarea className="admin-textarea" rows={2} value={form.comment} onChange={(e) => set("comment", e.target.value)} />
            </div>
          </div>
        </div>

        {error && <div className="admin-error" style={{ margin: "0 20px" }}>{error}</div>}

        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="admin-btn admin-btn--primary" disabled={saving} onClick={save}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {tenant ? "Сохранить" : "Создать арендатора"}
          </button>
        </div>
      </div>
      </div>
    </ModalPortal>
  );
}
