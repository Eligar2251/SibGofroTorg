// =========================================================
// FILE: src/components/admin/rent/RentOrgSettings.tsx
// Реквизиты и правила организаций аренды: общий крайний день
// оплаты, день выставления счёта, банковские реквизиты.
// =========================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, X } from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import type { RentOrg } from "@/lib/rent-shared";

export function RentOrgSettings({
  orgs,
  onClose,
}: {
  orgs: RentOrg[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
        <div
          className="admin-modal"
          style={{ maxWidth: 760 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">Организации и реквизиты</h3>
            <button className="admin-modal__close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="admin-modal__desc">
            «Крайний день оплаты» и «День выставления счёта» действуют для всех
            арендаторов организации, если у арендатора не задано исключение.
          </div>
          <div className="admin-stack" style={{ padding: "0 20px", gap: 14 }}>
            {orgs.map((org) => (
              <OrgSettingsForm
                key={org.id}
                org={org}
                saving={saving === org.id}
                onStateChange={(id, state) => {
                  setSaving(state ? id : null);
                }}
                onNotice={setNotice}
                onError={setError}
                onSaved={() => router.refresh()}
              />
            ))}
          </div>
          {error && <div className="admin-error" style={{ margin: "0 20px" }}>{error}</div>}
          {notice && <div className="admin-success" style={{ margin: "0 20px" }}>{notice}</div>}
          <div className="admin-modal__actions">
            <button className="admin-btn admin-btn--ghost" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function OrgSettingsForm({
  org,
  saving,
  onStateChange,
  onNotice,
  onError,
  onSaved,
}: {
  org: RentOrg;
  saving: boolean;
  onStateChange: (id: string, saving: boolean) => void;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    payDay: org.payDay,
    invoiceDay: org.invoiceDay,
    bankAccount: org.bankAccount || "",
    bankName: org.bankName || "",
    bik: org.bik || "",
    correspondentAccount: org.correspondentAccount || "",
    inn: org.inn || "",
    comment: org.comment || "",
  });
  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    onStateChange(org.id, true);
    onError("");
    onNotice("");
    try {
      const res = await fetch(`/api/admin/rent/orgs/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payDay: Number(form.payDay) || 3,
          invoiceDay: Number(form.invoiceDay) || 25,
          bankAccount: form.bankAccount || null,
          bankName: form.bankName || null,
          bik: form.bik || null,
          correspondentAccount: form.correspondentAccount || null,
          inn: form.inn || null,
          comment: form.comment || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      onNotice(`${org.name}: сохранено`);
      onSaved();
    } catch (e: any) {
      onError(e.message || "Ошибка");
    } finally {
      onStateChange(org.id, false);
    }
  }

  return (
    <div className="admin-card" style={{ marginBottom: 0 }}>
      <div className="admin-card__head">
        <h3 className="admin-card__title">{org.name}</h3>
        {org.paysToOrgId ? (
          <span className="admin-badge admin-badge--amber">
            деньги приходят на счёт БАУ
          </span>
        ) : (
          <span className="admin-badge admin-badge--muted">свой расчётный счёт</span>
        )}
      </div>
      <div className="admin-card__pad">
        <div className="admin-grid-3">
          <div className="admin-field">
            <label className="admin-label">Крайний день оплаты (для всех)</label>
            <input
              type="number"
              min={1}
              max={31}
              className="admin-input"
              value={form.payDay}
              onChange={(e) => set("payDay", e.target.value)}
            />
          </div>
          <div className="admin-field">
            <label className="admin-label">День выставления счёта</label>
            <input
              type="number"
              min={1}
              max={31}
              className="admin-input"
              value={form.invoiceDay}
              onChange={(e) => set("invoiceDay", e.target.value)}
            />
          </div>
          <div className="admin-field">
            <label className="admin-label">ИНН</label>
            <input className="admin-input" value={form.inn} onChange={(e) => set("inn", e.target.value)} />
          </div>
          <div className="admin-field">
            <label className="admin-label">Расчётный счёт</label>
            <input className="admin-input" value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} />
          </div>
          <div className="admin-field">
            <label className="admin-label">Банк</label>
            <input className="admin-input" value={form.bankName} onChange={(e) => set("bankName", e.target.value)} />
          </div>
          <div className="admin-field">
            <label className="admin-label">БИК</label>
            <input className="admin-input" value={form.bik} onChange={(e) => set("bik", e.target.value)} />
          </div>
          <div className="admin-field">
            <label className="admin-label">Корр. счёт</label>
            <input
              className="admin-input"
              value={form.correspondentAccount}
              onChange={(e) => set("correspondentAccount", e.target.value)}
            />
          </div>
          <div className="admin-field" style={{ gridColumn: "span 2" }}>
            <label className="admin-label">Комментарий</label>
            <input className="admin-input" value={form.comment} onChange={(e) => set("comment", e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button className="admin-btn admin-btn--primary admin-btn--sm" disabled={saving} onClick={save}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
