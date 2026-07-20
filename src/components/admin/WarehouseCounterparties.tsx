"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Edit2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react";
import type { CounterpartyRole } from "@/lib/warehouse";

export interface CounterpartyOption {
  id: string;
  name: string;
  roles: CounterpartyRole[];
  phone?: string | null;
  email?: string | null;
  inn?: string | null;
  kpp?: string | null;
  address?: string | null;
  contactName?: string | null;
  comment?: string | null;
}

export interface CounterpartyDocument {
  id: string;
  kind: "deal" | "receipt";
  number: number;
  date: string;
  total: number;
  status?: string | null;
  itemCount: number;
}

interface FormState {
  name: string;
  supplier: boolean;
  customer: boolean;
  phone: string;
  email: string;
  inn: string;
  kpp: string;
  address: string;
  contactName: string;
  comment: string;
}

const EMPTY: FormState = {
  name: "",
  supplier: false,
  customer: true,
  phone: "",
  email: "",
  inn: "",
  kpp: "",
  address: "",
  contactName: "",
  comment: "",
};

const fmt = (value: number) => value.toLocaleString("ru-RU");

export function CounterpartiesManager({
  initialCounterparties,
  documents,
}: {
  initialCounterparties: CounterpartyOption[];
  documents: Record<string, CounterpartyDocument[]>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialCounterparties);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"all" | CounterpartyRole>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    return items.filter((item) => {
      if (role !== "all" && !item.roles.includes(role)) return false;
      if (!query) return true;
      return [item.name, item.inn, item.phone, item.email, item.contactName]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("ru-RU").includes(query));
    });
  }, [items, role, search]);

  function beginCreate() {
    setEditingId("new");
    setForm(EMPTY);
    setError("");
  }

  function beginEdit(item: CounterpartyOption) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      supplier: item.roles.includes("supplier"),
      customer: item.roles.includes("customer"),
      phone: item.phone || "",
      email: item.email || "",
      inn: item.inn || "",
      kpp: item.kpp || "",
      address: item.address || "",
      contactName: item.contactName || "",
      comment: item.comment || "",
    });
    setError("");
  }

  function patch(key: keyof FormState, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    const roles: CounterpartyRole[] = [];
    if (form.supplier) roles.push("supplier");
    if (form.customer) roles.push("customer");
    if (!form.name.trim() || roles.length === 0) {
      setError("Укажите название и хотя бы один тип контрагента");
      return;
    }
    setSaving(true);
    setError("");
    const isNew = editingId === "new";
    const payload = { ...form, roles, name: form.name.trim() };
    try {
      const response = await fetch(
        isNew
          ? "/api/admin/warehouse/counterparties"
          : `/api/admin/warehouse/counterparties/${editingId}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить");
      const updated: CounterpartyOption = {
        id: isNew ? body.id : editingId!,
        name: payload.name,
        roles,
        phone: form.phone || null,
        email: form.email || null,
        inn: form.inn || null,
        kpp: form.kpp || null,
        address: form.address || null,
        contactName: form.contactName || null,
        comment: form.comment || null,
      };
      setItems((current) =>
        isNew
          ? [...current, updated].sort((a, b) => a.name.localeCompare(b.name, "ru"))
          : current.map((item) => (item.id === editingId ? updated : item))
      );
      setEditingId(null);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="cp-page">
      <div className="cp-toolbar">
        <div className="cp-search">
          <Search size={15} />
          <input
            className="admin-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Название, ИНН, телефон, контакт..."
          />
        </div>
        <select
          className="admin-select"
          value={role}
          onChange={(event) => setRole(event.target.value as typeof role)}
        >
          <option value="all">Все контрагенты</option>
          <option value="supplier">Поставщики</option>
          <option value="customer">Покупатели</option>
        </select>
        <button className="admin-btn admin-btn--primary" onClick={beginCreate}>
          <Plus size={15} /> Добавить
        </button>
      </div>

      <div className="cp-grid">
        {filtered.map((item) => {
          const docs = documents[item.id] || [];
          const total = docs.reduce((sum, doc) => sum + doc.total, 0);
          return (
            <article key={item.id} className="cp-card">
              <header className="cp-card__head">
                <div className="cp-card__icon"><Building2 size={20} /></div>
                <div className="cp-card__heading">
                  <h3>{item.name}</h3>
                  <div className="cp-card__roles">
                    {item.roles.includes("supplier") && <span>Поставщик</span>}
                    {item.roles.includes("customer") && <span>Покупатель</span>}
                  </div>
                </div>
                <div className="admin-actions">
                  <button className="admin-btn admin-btn--icon" onClick={() => beginEdit(item)} title="Редактировать"><Edit2 size={14} /></button>
                </div>
              </header>

              <div className="cp-card__info">
                {item.contactName && <div><UserRound size={13} /><span><small>Контакт</small>{item.contactName}</span></div>}
                {item.phone && <div><Phone size={13} /><span><small>Телефон</small><a href={`tel:${item.phone}`}>{item.phone}</a></span></div>}
                {item.email && <div><Mail size={13} /><span><small>Email</small><a href={`mailto:${item.email}`}>{item.email}</a></span></div>}
                {item.address && <div><MapPin size={13} /><span><small>Адрес</small>{item.address}</span></div>}
                {(item.inn || item.kpp) && <div><Building2 size={13} /><span><small>Реквизиты</small>ИНН {item.inn || "—"}{item.kpp ? ` · КПП ${item.kpp}` : ""}</span></div>}
                {!item.phone && !item.email && !item.inn && !item.address && (
                  <p className="cp-card__missing">Реквизиты пока не заполнены</p>
                )}
              </div>

              <details className="cp-docs">
                <summary>
                  Документы: {docs.length}
                  <strong>{fmt(total)} ₽</strong>
                </summary>
                <div className="cp-docs__list">
                  {docs.length === 0 ? (
                    <span className="cp-docs__empty">Связанных документов нет</span>
                  ) : (
                    docs.map((doc) => (
                      <div key={`${doc.kind}-${doc.id}`} className="cp-doc">
                        <span>{doc.kind === "deal" ? `ЗК-${doc.number}` : `ПО-${doc.number}`}</span>
                        <small>{doc.date} · позиций: {doc.itemCount}{doc.status ? ` · ${doc.status}` : ""}</small>
                        <strong>{fmt(doc.total)} ₽</strong>
                      </div>
                    ))
                  )}
                </div>
              </details>
              {item.comment && <div className="cp-card__comment">{item.comment}</div>}
            </article>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="admin-card admin-empty"><p>Контрагенты не найдены</p></div>
      )}

      {editingId && (
        <div className="admin-modal-overlay" onClick={() => setEditingId(null)}>
          <div className="admin-modal cp-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">{editingId === "new" ? "Новый контрагент" : "Карточка контрагента"}</h3>
              <button className="admin-modal__close" onClick={() => setEditingId(null)}><X size={16} /></button>
            </div>
            <div className="admin-stack">
              <div className="admin-field">
                <label className="admin-label">Организация / ФИО *</label>
                <input className="admin-input" value={form.name} onChange={(e) => patch("name", e.target.value)} />
              </div>
              <div className="cp-role-checks">
                <label className="admin-check"><input type="checkbox" checked={form.supplier} onChange={(e) => patch("supplier", e.target.checked)} /> Поставщик</label>
                <label className="admin-check"><input type="checkbox" checked={form.customer} onChange={(e) => patch("customer", e.target.checked)} /> Покупатель</label>
              </div>
              <div className="admin-grid-2">
                <div className="admin-field"><label className="admin-label">Контактное лицо</label><input className="admin-input" value={form.contactName} onChange={(e) => patch("contactName", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">Телефон</label><input className="admin-input" value={form.phone} onChange={(e) => patch("phone", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">Email</label><input type="email" className="admin-input" value={form.email} onChange={(e) => patch("email", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">ИНН</label><input className="admin-input" value={form.inn} onChange={(e) => patch("inn", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">КПП</label><input className="admin-input" value={form.kpp} onChange={(e) => patch("kpp", e.target.value)} /></div>
              </div>
              <div className="admin-field"><label className="admin-label">Адрес</label><input className="admin-input" value={form.address} onChange={(e) => patch("address", e.target.value)} /></div>
              <div className="admin-field"><label className="admin-label">Комментарий</label><textarea className="admin-textarea" value={form.comment} onChange={(e) => patch("comment", e.target.value)} /></div>
              {error && <div className="admin-error">{error}</div>}
              <div className="admin-modal__actions">
                <button className="admin-btn admin-btn--ghost" onClick={() => setEditingId(null)}>Отмена</button>
                <button className="admin-btn admin-btn--primary" disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Сохранить</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
