"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
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
import type { CounterpartyRole, PriceTier } from "@/lib/warehouse-shared";
import { normalizePriceTier } from "@/lib/warehouse-shared";
import { ModalPortal } from "@/components/admin/ModalPortal";

export interface CounterpartyOption {
  id: string;
  name: string;
  roles: CounterpartyRole[];
  supplierPrices?: Record<string, number>;
  /** Вариант цены (обычная / спец / эксклюзив) — скидка при оформлении заказа. */
  priceTier?: PriceTier;
  phone?: string | null;
  email?: string | null;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  fullName?: string | null;
  shortName?: string | null;
  legalAddress?: string | null;
  taxSystem?: string | null;
  bankAccount?: string | null;
  bankName?: string | null;
  bik?: string | null;
  correspondentAccount?: string | null;
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
  ogrn: string;
  fullName: string;
  shortName: string;
  legalAddress: string;
  taxSystem: string;
  bankAccount: string;
  bankName: string;
  bik: string;
  correspondentAccount: string;
  address: string;
  contactName: string;
  comment: string;
  priceTier: PriceTier;
}

const EMPTY: FormState = {
  name: "",
  supplier: false,
  customer: true,
  phone: "",
  email: "",
  inn: "",
  kpp: "",
  ogrn: "",
  fullName: "",
  shortName: "",
  legalAddress: "",
  taxSystem: "",
  bankAccount: "",
  bankName: "",
  bik: "",
  correspondentAccount: "",
  address: "",
  contactName: "",
  comment: "",
  priceTier: "regular",
};

const fmt = (value: number) => value.toLocaleString("ru-RU");
const ADMIN_PATH = process.env.NEXT_PUBLIC_ADMIN_PATH || process.env.ADMIN_SECRET_PATH || "admin";

/** Убирает дубли по id — защита от «two children with the same key». */
function uniqueById(list: CounterpartyOption[]): CounterpartyOption[] {
  const seen = new Set<string>();
  const out: CounterpartyOption[] = [];
  for (const item of list) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function CounterpartiesManager({
  initialCounterparties,
  documents,
  tierDiscounts = { special: 5, exclusive: 10 },
}: {
  initialCounterparties: CounterpartyOption[];
  documents: Record<string, CounterpartyDocument[]>;
  /** Скидки ценовых уровней (из настроек) — для подписей в селекте. */
  tierDiscounts?: { special: number; exclusive: number };
}) {
  const router = useRouter();
  const [items, setItems] = useState(() => uniqueById(initialCounterparties));
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
      ogrn: item.ogrn || "",
      fullName: item.fullName || "",
      shortName: item.shortName || "",
      legalAddress: item.legalAddress || "",
      taxSystem: item.taxSystem || "",
      bankAccount: item.bankAccount || "",
      bankName: item.bankName || "",
      bik: item.bik || "",
      correspondentAccount: item.correspondentAccount || "",
      address: item.address || "",
      contactName: item.contactName || "",
      comment: item.comment || "",
      priceTier: normalizePriceTier(item.priceTier),
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
    const payload = { ...form, roles, name: form.name.trim(), priceTier: normalizePriceTier(form.priceTier) };
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
        priceTier: normalizePriceTier(form.priceTier),
        phone: form.phone || null,
        email: form.email || null,
        inn: form.inn || null,
        kpp: form.kpp || null,
        ogrn: form.ogrn || null,
        fullName: form.fullName || null,
        shortName: form.shortName || null,
        legalAddress: form.legalAddress || null,
        taxSystem: form.taxSystem || null,
        bankAccount: form.bankAccount || null,
        bankName: form.bankName || null,
        bik: form.bik || null,
        correspondentAccount: form.correspondentAccount || null,
        address: form.address || null,
        contactName: form.contactName || null,
        comment: form.comment || null,
      };
      setItems((current) => {
        // Если контрагент с таким id уже есть в списке (тот же name после
        // нормализации) — заменяем, а не добавляем второй раз: иначе в списке
        // появлялись дубли с одним id и React ругался на одинаковые key.
        const exists = current.some((item) => item.id === updated.id);
        const next = isNew
          ? exists
            ? current.map((item) => (item.id === updated.id ? updated : item))
            : [...current, updated]
          : current.map((item) => (item.id === editingId ? updated : item));
        return uniqueById(next).sort((a, b) => a.name.localeCompare(b.name, "ru"));
      });
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
                          {item.priceTier === "special" && (
                            <span className="admin-badge admin-badge--blue" title={`Спеццена: скидка ${tierDiscounts.special}% при заказе`}>спеццена −{tierDiscounts.special}%</span>
                          )}
                          {item.priceTier === "exclusive" && (
                            <span className="admin-badge admin-badge--indigo" title={`Эксклюзивная цена: скидка ${tierDiscounts.exclusive}% при заказе`}>эксклюзив −{tierDiscounts.exclusive}%</span>
                          )}
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
                                <div><dt>Полное наименование</dt><dd>{item.fullName || item.name || "—"}</dd></div>
                                <div><dt>Сокращенное</dt><dd>{item.shortName || "—"}</dd></div>
                                <div><dt>ИНН</dt><dd>{item.inn || "—"}</dd></div>
                                <div><dt>КПП</dt><dd>{item.kpp || "—"}</dd></div>
                                <div><dt>ОГРН</dt><dd>{item.ogrn || "—"}</dd></div>
                                <div><dt>Налогообложение</dt><dd>{item.taxSystem || "—"}</dd></div>
                                <div><dt>Юр. адрес</dt><dd>{item.legalAddress || "—"}</dd></div>
                                <div><dt>Адрес</dt><dd>{item.address || "—"}</dd></div>
                                <div><dt>Расчётный счёт</dt><dd>{item.bankAccount || "—"}</dd></div>
                                <div><dt>Банк</dt><dd>{item.bankName || "—"}</dd></div>
                                <div><dt>БИК</dt><dd>{item.bik || "—"}</dd></div>
                                <div><dt>Корр. счёт</dt><dd>{item.correspondentAccount || "—"}</dd></div>
                                <div><dt>Цен поставщика</dt><dd>{Object.keys(item.supplierPrices || {}).length}</dd></div>
                                <div><dt>Вариант цены</dt><dd>{item.priceTier === "special" ? `Спеццена −${tierDiscounts.special}%` : item.priceTier === "exclusive" ? `Эксклюзив −${tierDiscounts.exclusive}%` : "Обычная"}</dd></div>
                              </dl>
                              {item.comment && <p>{item.comment}</p>}
                            </div>
                            <div className="cp-table__documents">
                              <h4>Заказы и поступления</h4>
                              {docs.length === 0 ? (
                                <span>Связанных документов нет</span>
                              ) : docs.map((doc) => (
                                <Link
                                  key={`${doc.kind}-${doc.id}`}
                                  className="cp-doc"
                                  href={
                                    doc.kind === "deal"
                                      ? `/${ADMIN_PATH}/warehouse?tab=deals&deal=${doc.id}`
                                      : `/${ADMIN_PATH}/warehouse?tab=receipts&receipt=${doc.id}`
                                  }
                                  prefetch={false}
                                  style={{ textDecoration: "none" }}
                                >
                                  <span>{doc.kind === "deal" ? `ЗК-${doc.number}` : `ПО-${doc.number}`}</span>
                                  <small>{doc.date} · позиций: {doc.itemCount}{doc.status ? ` · ${doc.status}` : ""}</small>
                                  <strong>{fmt(doc.total)} ₽</strong>
                                </Link>
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
        <ModalPortal>
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
              <div className="admin-field">
                <label className="admin-label">Вариант цены (для покупателей)</label>
                <select className="admin-select" value={form.priceTier} onChange={(e) => patch("priceTier", e.target.value)}>
                  <option value="regular">Обычная — цена как в карточке товара</option>
                  <option value="special">Спеццена — скидка {tierDiscounts.special}% при заказе</option>
                  <option value="exclusive">Эксклюзивная — скидка {tierDiscounts.exclusive}% при заказе</option>
                </select>
              </div>
              <div className="admin-grid-2">
                <div className="admin-field"><label className="admin-label">Контактное лицо</label><input className="admin-input" value={form.contactName} onChange={(e) => patch("contactName", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">Телефон</label><input className="admin-input" value={form.phone} onChange={(e) => patch("phone", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">Email</label><input type="text" className="admin-input" value={form.email} onChange={(e) => patch("email", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">ИНН</label><input className="admin-input" value={form.inn} onChange={(e) => patch("inn", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">КПП</label><input className="admin-input" value={form.kpp} onChange={(e) => patch("kpp", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">ОГРН</label><input className="admin-input" value={form.ogrn} onChange={(e) => patch("ogrn", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">Сокращенное наименование</label><input className="admin-input" value={form.shortName} onChange={(e) => patch("shortName", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">Налогообложение</label><input className="admin-input" value={form.taxSystem} onChange={(e) => patch("taxSystem", e.target.value)} /></div>
              </div>
              <div className="admin-field"><label className="admin-label">Полное наименование</label><input className="admin-input" value={form.fullName} onChange={(e) => patch("fullName", e.target.value)} /></div>
              <div className="admin-field"><label className="admin-label">Юридический адрес</label><input className="admin-input" value={form.legalAddress} onChange={(e) => patch("legalAddress", e.target.value)} /></div>
              <div className="admin-grid-2">
                <div className="admin-field"><label className="admin-label">Расчётный счёт</label><input className="admin-input" value={form.bankAccount} onChange={(e) => patch("bankAccount", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">Банк</label><input className="admin-input" value={form.bankName} onChange={(e) => patch("bankName", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">БИК</label><input className="admin-input" value={form.bik} onChange={(e) => patch("bik", e.target.value)} /></div>
                <div className="admin-field"><label className="admin-label">Корр. счёт</label><input className="admin-input" value={form.correspondentAccount} onChange={(e) => patch("correspondentAccount", e.target.value)} /></div>
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
        </ModalPortal>
      )}
    </div>
  );
}
