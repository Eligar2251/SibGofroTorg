// =========================================================
// FILE: src/components/admin/ClientRequestsManager.tsx
// Ручные заявки клиентов (мини-CRM): менеджер фиксирует
// обращение по звонку/мессенджеру/визиту — кто, как связаться,
// что нужно (не обязательно товар) — и ведёт по статусам.
// Не связано с заказами сайта и учётом.
// =========================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Loader2,
  X,
  Pencil,
  Trash2,
  Send,
  CheckCircle,
  XCircle,
  RotateCcw,
  Clock,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { useAdminRealtime } from "@/lib/use-admin-realtime";
import type { ClientRequest } from "@/lib/supabase-queries";

/* ── Справочники ─────────────────────────────────────────── */

const statusLabels: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Обработана",
  rejected: "Отменена",
};

const statusBadge: Record<string, string> = {
  new: "admin-badge admin-badge--amber",
  in_progress: "admin-badge admin-badge--blue",
  completed: "admin-badge admin-badge--green",
  rejected: "admin-badge admin-badge--red",
};

const contactLabels: Record<string, { token: string; text: string }> = {
  call: { token: "phone", text: "Звонок" },
  whatsapp: { token: "chat", text: "WhatsApp" },
  // Telegram больше не предлагается для новых заявок (см. SELECTABLE_CONTACT_METHODS),
  // но ярлык оставлен: в базе есть старые записи с этим способом связи.
  telegram: { token: "send", text: "Telegram" },
  max: { token: "chats", text: "MAX" },
  email: { token: "mail", text: "Почта" },
  visit: { token: "user", text: "Личный визит" },
  other: { token: "note", text: "Другое" },
};

/** Способы связи, доступные для выбора в новых заявках. */
const SELECTABLE_CONTACT_METHODS = Object.keys(contactLabels).filter(
  (key) => key !== "telegram"
);

const filterOptions = [
  { value: "active", label: "Активные" },
  { value: "new", label: "Новые" },
  { value: "in_progress", label: "В работе" },
  { value: "completed", label: "Обработанные" },
  { value: "rejected", label: "Отменённые" },
  { value: "all", label: "Все" },
];

function formatDate(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Быстрый набор — то, что чаще всего спрашивают по телефону. */
const SUBJECT_SUGGESTIONS = [
  "Интересует товар / уточнить наличие",
  "Просит счёт / коммерческое предложение",
  "Вопрос по доставке",
  "Сдаёт макулатуру",
  "Рекламация",
  "Перезвонить позже",
];

/* ── Форма создания / редактирования ─────────────────────── */

interface FormState {
  customerName: string;
  customerPhone: string;
  contactMethod: string;
  subject: string;
  comment: string;
}

const emptyForm: FormState = {
  customerName: "",
  customerPhone: "",
  contactMethod: "call",
  subject: "",
  comment: "",
};

function RequestFormModal({
  initial,
  title,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  initial: FormState;
  title: string;
  saving: boolean;
  error: string;
  onSubmit: (form: FormState) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const set = (key: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const valid = form.customerName.trim() && form.subject.trim();

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "30rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">{title}</h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Например: позвонил клиент — зафиксируйте, что ему нужно, чтобы не
          потерять обращение.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSubmit(form);
          }}
        >
          <div className="admin-field">
            <label className="admin-label">Клиент *</label>
            <input
              className="admin-input"
              value={form.customerName}
              onChange={set("customerName")}
              placeholder="Имя или название компании"
              autoFocus
              required
            />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 150px" }}>
              <label className="admin-label">Способ связи</label>
              <select
                className="admin-select"
                value={form.contactMethod}
                onChange={set("contactMethod")}
              >
                {SELECTABLE_CONTACT_METHODS.map((value) => (
                  <option key={value} value={value}>
                    {contactLabels[value].text}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field" style={{ flex: "1 1 150px" }}>
              <label className="admin-label">Телефон</label>
              <input
                className="admin-input"
                value={form.customerPhone}
                onChange={set("customerPhone")}
                placeholder="+7 … (необязательно)"
              />
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-label">Что нужно клиенту *</label>
            <textarea
              className="admin-textarea"
              rows={2}
              value={form.subject}
              onChange={set("subject")}
              placeholder="Например: нужна упаковка для переезда, 20 коробов 600×400×400"
              required
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {SUBJECT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => setForm((f) => ({ ...f, subject: s }))}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-label">Заметки</label>
            <textarea
              className="admin-textarea"
              rows={2}
              value={form.comment}
              onChange={set("comment")}
              placeholder="Договорённости, детали, когда перезвонить…"
            />
          </div>

          {error && (
            <div style={{ color: "var(--adm-rust)", fontSize: 13, marginBottom: 10 }}>
              {error}
            </div>
          )}

          <div className="admin-modal__actions">
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={onClose}
              disabled={saving}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="admin-btn admin-btn--navy"
              disabled={saving || !valid}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Главный компонент ───────────────────────────────────── */

export function ClientRequestsManager({
  initialItems,
  initialQuery = "",
}: {
  initialItems: ClientRequest[];
  initialQuery?: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ClientRequest[]>(initialItems);
  // Если пришли по ссылке с поиском (например, из журнала действий) —
  // ищем сразу по всем статусам, иначе запись может быть скрыта фильтром.
  // По умолчанию — «Активные»: и новые, и в работе, чтобы заявка не
  // «исчезала» из списка сразу после кнопки «В работу».
  const [filter, setFilter] = useState(initialQuery ? "all" : "active");
  const [query, setQuery] = useState(initialQuery);

  // Модалки
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ClientRequest | null>(null);
  const [closing, setClosing] = useState<{
    item: ClientRequest;
    status: "completed" | "rejected";
  } | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [deleting, setDeleting] = useState<ClientRequest | null>(null);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");

  // Мгновенное обновление при изменениях (Realtime + polling fallback)
  useAdminRealtime({ tables: ["client_requests"], pollIntervalMs: 30_000 });

  // После router.refresh() сервер отдаёт свежие initialItems
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      if (filter === "active") {
        if (r.status !== "new" && r.status !== "in_progress") return false;
      } else if (filter !== "all" && r.status !== filter) {
        return false;
      }
      if (!q) return true;
      return (
        r.customerName.toLowerCase().includes(q) ||
        r.customerPhone.includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        r.comment.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.createdBy || "").toLowerCase().includes(q)
      );
    });
  }, [items, filter, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, active: 0 };
    for (const r of items) {
      c[r.status] = (c[r.status] || 0) + 1;
      if (r.status === "new" || r.status === "in_progress") c.active++;
    }
    return c;
  }, [items]);

  async function callApi(
    fn: () => Promise<Response>,
    fallbackError: string
  ): Promise<boolean> {
    setSaving(true);
    setFormError("");
    setActionError("");
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || fallbackError);
      router.refresh();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : fallbackError;
      setFormError(msg);
      setActionError(msg);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitCreate(form: FormState) {
    const ok = await callApi(
      () =>
        fetch("/api/admin/client-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }),
      "Не удалось создать заявку"
    );
    if (ok) {
      setShowCreate(false);
      setFilter("new");
    }
  }

  async function submitEdit(form: FormState) {
    if (!editing) return;
    const ok = await callApi(
      () =>
        fetch(`/api/admin/client-requests/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }),
      "Не удалось сохранить заявку"
    );
    if (ok) setEditing(null);
  }

  async function setStatus(
    item: ClientRequest,
    status: string,
    reason: string | null = null
  ) {
    const ok = await callApi(
      () =>
        fetch(`/api/admin/client-requests/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, closeReason: reason }),
        }),
      "Не удалось обновить статус"
    );
    if (ok) {
      setClosing(null);
      setCloseReason("");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const ok = await callApi(
      () =>
        fetch(`/api/admin/client-requests/${deleting.id}`, {
          method: "DELETE",
        }),
      "Не удалось удалить заявку"
    );
    if (ok) setDeleting(null);
  }

  return (
    <div>
      {/* Панель: поиск + кнопка создания */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1, minWidth: 240, position: "relative" }}>
          <Search
            size={15}
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--adm-muted)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            className="admin-input"
            style={{ paddingLeft: 32, width: "100%" }}
            placeholder="Поиск по клиенту, телефону, тексту заявки…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="admin-btn admin-btn--navy"
          onClick={() => {
            setFormError("");
            setShowCreate(true);
          }}
        >
          <Plus size={15} /> Новая заявка
        </button>
      </div>

      {/* Фильтры по статусу */}
      <div className="admin-filters">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFilter(opt.value)}
            className={`admin-filter${filter === opt.value ? " admin-filter--active" : ""}`}
          >
            {opt.label}
            {typeof counts[opt.value] === "number" ? ` (${counts[opt.value]})` : ""}
          </button>
        ))}
      </div>

      {actionError && !showCreate && !editing && !closing && !deleting && (
        <div style={{ color: "var(--adm-rust)", fontSize: 13, marginBottom: 10 }}>
          {actionError}
        </div>
      )}

      {/* Список заявок */}
      <div className="admin-card">
        {filtered.length > 0 ? (
          <div>
            {filtered.map((item) => {
              const contact =
                contactLabels[item.contactMethod] ?? contactLabels.other;
              return (
                <details key={item.id} className="admin-order" style={{ display: "block" }}>
                  <summary style={{ listStyle: "none", cursor: "pointer" }}>
                    <div className="admin-order__row">
                      <div className="admin-order__main">
                        <div className="admin-order__top">
                          <span className="admin-order__id">
                            #{item.id.slice(0, 8)}
                          </span>
                          <span className={statusBadge[item.status ?? "new"]}>
                            {statusLabels[item.status ?? "new"]}
                          </span>
                          <span
                            className="admin-badge admin-badge--muted"
                            title="Способ связи"
                          >
                            <GlyphIcon value={contact.token} size={11} />
                            {contact.text}
                          </span>
                          <span className="admin-order__date">
                            {formatDate(item.createdAt)}
                          </span>
                          <span
                            className="admin-muted"
                            style={{ marginLeft: "auto", fontSize: 12 }}
                          >
                            Нажмите, чтобы раскрыть
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            color: "var(--adm-navy)",
                            fontWeight: 700,
                          }}
                        >
                          {item.customerName}
                          {item.customerPhone ? ` · ${item.customerPhone}` : ""}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--adm-muted)",
                            marginTop: 4,
                          }}
                        >
                          {item.subject}
                        </div>
                      </div>
                    </div>
                  </summary>

                  <div
                    className="admin-order__row"
                    style={{
                      borderTop: "1px solid rgba(200,196,188,0.35)",
                      paddingTop: 14,
                      marginTop: 12,
                    }}
                  >
                    <div className="admin-order__main">
                      <div className="admin-order__grid">
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label">Клиент:</span>
                          <span className="admin-order__meta-val">
                            {item.customerName}
                          </span>
                        </div>
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label">Телефон:</span>
                          {item.customerPhone ? (
                            <a href={`tel:${item.customerPhone}`}>
                              {item.customerPhone}
                            </a>
                          ) : (
                            <span className="admin-muted">—</span>
                          )}
                        </div>
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label">Связь:</span>
                          <span
                            className="admin-order__meta-val"
                            style={{ fontWeight: 500, fontSize: 13 }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                whiteSpace: "nowrap",
                              }}
                            >
                              <GlyphIcon value={contact.token} size={13} />
                              {contact.text}
                            </span>
                          </span>
                        </div>
                        {item.createdBy && (
                          <div className="admin-order__meta">
                            <span className="admin-order__meta-label">Принял:</span>
                            <span className="admin-order__meta-val">
                              {item.createdBy}
                            </span>
                          </div>
                        )}
                      </div>

                      <div style={{ fontSize: 14, marginTop: 10 }}>
                        <span className="admin-muted">Что нужно: </span>
                        <strong style={{ color: "var(--adm-navy)" }}>
                          {item.subject}
                        </strong>
                      </div>

                      {item.comment && (
                        <div className="admin-order__comment">
                          <strong>Заметки:</strong>
                          <span
                            style={{
                              fontStyle: "italic",
                              color: "var(--adm-navy)",
                            }}
                          >
                            «{item.comment}»
                          </span>
                        </div>
                      )}

                      {item.closeReason && (
                        <div className="admin-order__close-reason">
                          <strong style={{ display: "block", marginBottom: 4 }}>
                            {item.status === "completed"
                              ? "Итог обработки:"
                              : "Причина отмены:"}
                          </strong>
                          {item.closeReason}
                        </div>
                      )}
                    </div>

                    <div className="admin-order__side">
                      <div className="admin-status">
                        <span className={statusBadge[item.status ?? "new"]}>
                          {item.status === "completed" ? (
                            <CheckCircle size={13} />
                          ) : item.status === "rejected" ? (
                            <XCircle size={13} />
                          ) : (
                            <Clock size={13} />
                          )}
                          {statusLabels[item.status ?? "new"]}
                        </span>

                        <div className="admin-status__btns">
                          {item.status === "new" && (
                            <button
                              type="button"
                              className="admin-status__btn admin-status__btn--primary"
                              disabled={saving}
                              onClick={() => setStatus(item, "in_progress")}
                              title="Взять заявку в работу"
                            >
                              <Send size={14} /> В работу
                            </button>
                          )}
                          {(item.status === "new" ||
                            item.status === "in_progress") && (
                            <>
                              <button
                                type="button"
                                className="admin-status__btn admin-status__btn--outline"
                                disabled={saving}
                                onClick={() => {
                                  setActionError("");
                                  setCloseReason("");
                                  setClosing({ item, status: "completed" });
                                }}
                              >
                                <CheckCircle size={14} /> Обработана
                              </button>
                              <button
                                type="button"
                                className="admin-status__btn admin-status__btn--outline-red"
                                disabled={saving}
                                onClick={() => {
                                  setActionError("");
                                  setCloseReason("");
                                  setClosing({ item, status: "rejected" });
                                }}
                              >
                                <XCircle size={14} /> Отменить
                              </button>
                            </>
                          )}
                          {(item.status === "completed" ||
                            item.status === "rejected") && (
                            <button
                              type="button"
                              className="admin-status__btn admin-status__btn--outline"
                              disabled={saving}
                              onClick={() => setStatus(item, "in_progress")}
                              title="Вернуть заявку в работу"
                            >
                              <RotateCcw size={14} /> Вернуть в работу
                            </button>
                          )}
                          <button
                            type="button"
                            className="admin-status__btn admin-status__btn--outline"
                            disabled={saving}
                            onClick={() => {
                              setFormError("");
                              setEditing(item);
                            }}
                          >
                            <Pencil size={14} /> Изменить
                          </button>
                          <button
                            type="button"
                            className="admin-status__btn admin-status__btn--delete"
                            disabled={saving}
                            onClick={() => {
                              setActionError("");
                              setDeleting(item);
                            }}
                          >
                            <Trash2 size={14} /> Удалить
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="admin-empty">
            <div className="admin-empty__icon">
              <GlyphIcon value="clipboard" size={40} />
            </div>
            <p>
              {query
                ? `По запросу «${query}» ничего не найдено`
                : filter === "all"
                  ? "Заявок пока нет — добавьте первую кнопкой «Новая заявка»"
                  : `Нет заявок со статусом «${statusLabels[filter]}»`}
            </p>
          </div>
        )}
      </div>

      {/* Модалка создания */}
      {showCreate && (
        <RequestFormModal
          title="Новая заявка клиента"
          initial={emptyForm}
          saving={saving}
          error={formError}
          onSubmit={submitCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Модалка редактирования */}
      {editing && (
        <RequestFormModal
          title={`Заявка #${editing.id.slice(0, 8)}`}
          initial={{
            customerName: editing.customerName,
            customerPhone: editing.customerPhone,
            contactMethod: editing.contactMethod,
            subject: editing.subject,
            comment: editing.comment,
          }}
          saving={saving}
          error={formError}
          onSubmit={submitEdit}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Модалка закрытия (Обработана / Отменена) */}
      {closing && (
        <div
          className="admin-modal-overlay"
          onClick={() => !saving && setClosing(null)}
        >
          <div
            className="admin-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">
                {closing.status === "completed"
                  ? "Заявка обработана"
                  : "Отменить заявку"}
              </h3>
              <button
                type="button"
                className="admin-modal__close"
                onClick={() => setClosing(null)}
                disabled={saving}
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>
            <p className="admin-modal__desc">
              {closing.item.customerName} — «{closing.item.subject}»
            </p>
            <div className="admin-field">
              <label className="admin-label">
                {closing.status === "completed"
                  ? "Итог (необязательно)"
                  : "Причина отмены"}
              </label>
              <textarea
                className="admin-textarea"
                rows={2}
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder={
                  closing.status === "completed"
                    ? "Например: выставлен счёт, клиент доволен"
                    : "Например: клиент передумал"
                }
                required={closing.status === "rejected"}
              />
            </div>
            {formError && (
              <div style={{ color: "var(--adm-rust)", fontSize: 13, marginBottom: 10 }}>
                {formError}
              </div>
            )}
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setClosing(null)}
                disabled={saving}
              >
                Назад
              </button>
              <button
                type="button"
                className={`admin-btn ${closing.status === "completed" ? "admin-btn--navy" : "admin-btn--danger"}`}
                disabled={
                  saving || (closing.status === "rejected" && !closeReason.trim())
                }
                onClick={() =>
                  setStatus(closing.item, closing.status, closeReason.trim() || null)
                }
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {closing.status === "completed" ? "Обработана" : "Отменить заявку"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка удаления */}
      {deleting && (
        <div
          className="admin-modal-overlay"
          onClick={() => !saving && setDeleting(null)}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">Удалить заявку?</h3>
              <button
                type="button"
                className="admin-modal__close"
                onClick={() => setDeleting(null)}
                disabled={saving}
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>
            <p className="admin-modal__desc">
              {deleting.customerName} — «{deleting.subject}». Действие
              необратимо.
            </p>
            {formError && (
              <div style={{ color: "var(--adm-rust)", fontSize: 13, marginBottom: 10 }}>
                {formError}
              </div>
            )}
            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setDeleting(null)}
                disabled={saving}
              >
                Назад
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                disabled={saving}
                onClick={confirmDelete}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClientRequestsManager;
