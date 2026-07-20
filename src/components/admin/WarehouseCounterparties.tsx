"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Edit2,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { CounterpartyRole } from "@/lib/warehouse";

export interface CounterpartyOption {
  id: string;
  name: string;
  roles: CounterpartyRole[];
  supplierPrices?: Record<string, number>;
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
  const [sort, setSort] = useState<"name" | "documents" | "turnover">("name");
  const [descending, setDescending] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    const rows = items.filter((item) => {
      if (role !== "all" && !item.roles.includes(role)) return false;
      if (!query) return true;
      return [item.name, item.inn, item.phone, item.email, item.contactName]
        .filter(Boolean)
        .some((value) =>
          String(value).toLocaleLowerCase("ru-RU").includes(query)
        );
    });
    rows.sort((a, b) => {
      let result = a.name.localeCompare(b.name, "ru");
      if (sort === "documents") {
        result = (documents[a.id]?.length || 0) - (documents[b.id]?.length || 0);
      } else if (sort === "turnover") {
        const total = (item: CounterpartyOption) =>
          (documents[item.id] || []).reduce((sum, doc) => sum + doc.total, 0);
        result = total(a) - total(b);
      }
      return descending ? -result : result;
    });
    return rows;
  }, [descending, documents, items, role, search, sort]);

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
        supplierPrices:
          items.find((item) => item.id === editingId)?.supplierPrices || {},
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

      <div className="admin-card cp-table-wrap">
        <div className="admin-table-wrap">
          <table className="admin-table cp-table">
            <thead>
              <tr>
                <th>
                  <button type="button" onClick={() => {
                    if (sort === "name") setDescending((value) => !value);
                    else { setSort("name"); setDescending(false); }
                  }}>Контрагент {sort === "name" && (descending ? "↓" : "↑")}</button>
                </th>
                <th>Тип</th>
                <th>Контакты</th>
                <th>ИНН / КПП</th>
                <th>
                  <button type="button" onClick={() => {
                    if (sort === "documents") setDescending((value) => !value);
                    else { setSort("documents"); setDescending(true); }
                  }}>Документы {sort === "documents" && (descending ? "↓" : "↑")}</button>
                </th>
                <th>
                  <button type="button" onClick={() => {
                    if (sort === "turnover") setDescending((value) => !value);
                    else { setSort("turnover"); setDescending(true); }
                  }}>Оборот {sort === "turnover" && (descending ? "↓" : "↑")}</button>
                </th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const docs = documents[item.id] || [];
                const total = docs.reduce((sum, doc) => sum + doc.total, 0);
                const expanded = expandedId === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr className={expanded ? "cp-table__row--expanded" : ""}>
                      <td>
                        <button
                          type="button"
                          className="cp-table__name"
                          onClick={() => setExpandedId(expanded ? null : item.id)}
                        >
                          <span><Building2 size={16} /></span>
                          <strong>{item.name}</strong>
                          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                      <td>
                        <div className="cp-table__roles">
                          {item.roles.includes("supplier") && <span>Поставщик</span>}
                          {item.roles.includes("customer") && <span>Покупатель</span>}
                        </div>
                      </td>
                      <td>
                        <div className="cp-table__contacts">
                          {item.contactName && <span>{item.contactName}</span>}
                          {item.phone && <a href={`tel:${item.phone}`}>{item.phone}</a>}
                          {item.email && <a href={`mailto:${item.email}`}>{item.email}</a>}
                          {!item.contactName && !item.phone && !item.email && "—"}
                        </div>
                      </td>
                      <td className="admin-mono">
                        {item.inn || "—"}{item.kpp ? ` / ${item.kpp}` : ""}
                      </td>
                      <td><strong>{docs.length}</strong></td>
                      <td><strong className="cp-table__turnover">{fmt(total)} ₽</strong></td>
                      <td>
                        <div className="admin-actions">
                          <button className="admin-btn admin-btn--icon" onClick={() => beginEdit(item)} title="Редактировать"><Edit2 size={14} /></button>
                          <button className="admin-btn admin-btn--icon" onClick={() => setExpandedId(expanded ? null : item.id)} title="Подробности">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="cp-table__details-row">
                        <td colSpan={7}>
                          <div className="cp-table__details">
                            <div className="cp-table__profile">
                              <h4>Полная информация</h4>
                              <dl>
                                <div><dt>Контакт</dt><dd>{item.contactName || "—"}</dd></div>
                                <div><dt>Телефон</dt><dd>{item.phone || "—"}</dd></div>
                                <div><dt>Email</dt><dd>{item.email || "—"}</dd></div>
                                <div><dt>ИНН</dt><dd>{item.inn || "—"}</dd></div>
                                <div><dt>КПП</dt><dd>{item.kpp || "—"}</dd></div>
                                <div><dt>Адрес</dt><dd>{item.address || "—"}</dd></div>
                                <div><dt>Цен поставщика</dt><dd>{Object.keys(item.supplierPrices || {}).length}</dd></div>
                              </dl>
                              {item.comment && <p>{item.comment}</p>}
                            </div>
                            <div className="cp-table__documents">
                              <h4>Заказы и поступления</h4>
                              {docs.length === 0 ? (
                                <span>Связанных документов нет</span>
                              ) : docs.map((doc) => (
                                <div key={`${doc.kind}-${doc.id}`} className="cp-doc">
                                  <span>{doc.kind === "deal" ? `ЗК-${doc.number}` : `ПО-${doc.number}`}</span>
                                  <small>{doc.date} · позиций: {doc.itemCount}{doc.status ? ` · ${doc.status}` : ""}</small>
                                  <strong>{fmt(doc.total)} ₽</strong>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
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
