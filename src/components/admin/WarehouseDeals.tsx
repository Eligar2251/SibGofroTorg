// =========================================================
// FILE: src/components/admin/WarehouseDeals.tsx
// Заказ покупателя: форма + действия (провести/отменить/удалить)
// =========================================================

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Edit2,
  Plus,
  Trash2,
  X,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import {
  ProductPicker,
  type PickerProduct,
} from "@/components/admin/ProductPicker";
import {
  SearchCombobox,
  SearchMultiSelect,
  type PickerOption,
} from "@/components/admin/SearchPicker";
import { includedVat, VAT_RATE } from "@/lib/vat";
import type { CounterpartyOption } from "@/components/admin/WarehouseCounterparties";
import type { BankPayment } from "@/lib/warehouse-shared";

interface DealItemDraft {
  productId: string;
  name: string;
  sku: string | null;
  quantity: number | "";
  price: number | "";
  stockQty: number;
}

export interface EditableDeal {
  id: string;
  date: string;
  customerName: string;
  customerPhone?: string | null;
  email?: string | null;
  inn?: string | null;
  kpp?: string | null;
  address?: string | null;
  contactName?: string | null;
  comment?: string | null;
  items: DealItemDraft[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function DealForm({
  products,
  counterparties = [],
  payments = [],
  initialDeal,
}: {
  products: PickerProduct[];
  counterparties?: CounterpartyOption[];
  payments?: BankPayment[];
  initialDeal?: EditableDeal & { linkedPaymentIds?: string[] };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(initialDeal?.date || todayIso());
  const [customerName, setCustomerName] = useState(
    initialDeal?.customerName || ""
  );
  const [customerPhone, setCustomerPhone] = useState(
    initialDeal?.customerPhone || ""
  );
  const [email, setEmail] = useState(initialDeal?.email || "");
  const [inn, setInn] = useState(initialDeal?.inn || "");
  const [kpp, setKpp] = useState(initialDeal?.kpp || "");
  const [address, setAddress] = useState(initialDeal?.address || "");
  const [contactName, setContactName] = useState(
    initialDeal?.contactName || ""
  );
  const [comment, setComment] = useState(initialDeal?.comment || "");
  const [items, setItems] = useState<DealItemDraft[]>(initialDeal?.items || []);
  const [selectedPayments, setSelectedPayments] = useState<string[]>(
    initialDeal?.linkedPaymentIds || []
  );

  const total = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.price) || 0),
    0
  );

  function resetForm() {
    setDate(initialDeal?.date || todayIso());
    setCustomerName(initialDeal?.customerName || "");
    setCustomerPhone(initialDeal?.customerPhone || "");
    setEmail(initialDeal?.email || "");
    setInn(initialDeal?.inn || "");
    setKpp(initialDeal?.kpp || "");
    setAddress(initialDeal?.address || "");
    setContactName(initialDeal?.contactName || "");
    setComment(initialDeal?.comment || "");
    setItems(initialDeal?.items || []);
    setSelectedPayments(initialDeal?.linkedPaymentIds || []);
    setError("");
  }

  function selectCustomer(value: string) {
    setCustomerName(value);
    const found = counterparties.find(
      (item) =>
        item.roles.includes("customer") &&
        item.name.toLocaleLowerCase("ru-RU") ===
          value.trim().toLocaleLowerCase("ru-RU")
    );
    if (!found) return;
    setCustomerPhone(found.phone || "");
    setEmail(found.email || "");
    setInn(found.inn || "");
    setKpp(found.kpp || "");
    setAddress(found.address || "");
    setContactName(found.contactName || "");
  }

  function addItem(p: PickerProduct) {
    setItems((prev) => {
      const existing = prev.find((it) => it.productId === p.id);
      if (existing) {
        return prev.map((it) =>
          it.productId === p.id
            ? { ...it, quantity: (Number(it.quantity) || 0) + 1 }
            : it
        );
      }
      // Цена продажи подставляется автоматически (со скидкой),
      // спец. цену можно вписать вручную
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          quantity: 1,
          price: p.price != null && p.price > 0 ? p.price : "",
          stockQty: p.stockQty,
        },
      ];
    });
  }

  function setItem(productId: string, patch: Partial<DealItemDraft>) {
    setItems((prev) =>
      prev.map((it) => (it.productId === productId ? { ...it, ...patch } : it))
    );
  }

  function removeItem(productId: string) {
    setItems((prev) => prev.filter((it) => it.productId !== productId));
  }

  function togglePayment(id: string) {
    setSelectedPayments((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const availablePayments = payments.filter(
    (p) =>
      p.counterparty.toLocaleLowerCase("ru-RU") ===
        customerName.toLocaleLowerCase("ru-RU") &&
      p.isPaid &&
      (!p.dealIds || p.dealIds.length === 0)
  );

  // Варианты для переиспользуемых контролов выбора с поиском
  const customerOptions: PickerOption[] = useMemo(
    () =>
      counterparties
        .filter((item) => item.roles.includes("customer"))
        .map((item) => ({
          id: item.id,
          title: item.name,
          meta: [item.contactName, item.phone, item.inn]
            .filter(Boolean)
            .join(" · "),
        })),
    [counterparties]
  );

  const paymentOptions: PickerOption[] = useMemo(
    () =>
      availablePayments.map((p) => ({
        id: p.id,
        title: `ПЛ-${p.number} · ${fmt(p.amount)} ₽`,
        meta: `${fmtDate(p.date)} · ${p.type === "cash" ? "Наличные" : "Безнал"}`,
        right: `${fmt(p.amount)} ₽`,
      })),
    [availablePayments]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!customerName.trim()) {
      setError("Укажите покупателя");
      return;
    }
    if (items.length === 0) {
      setError("Добавьте хотя бы одну позицию");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        initialDeal
          ? `/api/admin/warehouse/deals/${initialDeal.id}`
          : "/api/admin/warehouse/deals",
        {
        method: initialDeal ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || null,
          email: email.trim() || null,
          inn: inn.trim() || null,
          kpp: kpp.trim() || null,
          address: address.trim() || null,
          contactName: contactName.trim() || null,
          comment: comment.trim() || null,
          items: items.map((it) => ({
            productId: it.productId,
            name: it.name,
            sku: it.sku,
            quantity: Number(it.quantity) || 0,
            price: Number(it.price) || 0,
          })),
          linkedPaymentIds: selectedPayments,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Не удалось сохранить заказ");
        setSaving(false);
        return;
      }
      setOpen(false);
      resetForm();
      router.refresh();
    } catch {
      setError("Ошибка сети");
    }
    setSaving(false);
  }

  return (
    <>
      <button
        type="button"
        className={
          initialDeal
            ? "admin-btn admin-btn--ghost admin-btn--sm"
            : "admin-btn admin-btn--primary"
        }
        onClick={() => setOpen(true)}
      >
        {initialDeal ? <Edit2 size={14} /> : <Plus size={15} />}
        {initialDeal ? "Изменить" : "Новый заказ"}
      </button>

      {open && (
        <div className="admin-modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="admin-modal wh-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">
                {initialDeal ? "Редактирование заказа" : "Заказ покупателя"}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="admin-modal__close"
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="wh-form-grid">
                <div className="admin-field">
                  <label className="admin-label">Дата</label>
                  <input
                    type="date"
                    className="admin-input"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Покупатель *</label>
                  <SearchCombobox
                    options={customerOptions}
                    value={customerName}
                    onChange={(value) => selectCustomer(value)}
                    placeholder="Начните вводить название..."
                    emptyText="Такого покупателя нет — впишите нового"
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Телефон</label>
                  <input
                    type="tel"
                    className="admin-input"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+7 ..."
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Комментарий</label>
                  <input
                    type="text"
                    className="admin-input"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Необязательно"
                  />
                </div>
              </div>

              <details className="wh-counterparty-details">
                <summary>Полная информация о покупателе</summary>
                <div className="wh-form-grid">
                  <div className="admin-field"><label className="admin-label">Контактное лицо</label><input className="admin-input" value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
                  <div className="admin-field"><label className="admin-label">Email</label><input type="email" className="admin-input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div className="admin-field"><label className="admin-label">ИНН</label><input className="admin-input" value={inn} onChange={(e) => setInn(e.target.value)} /></div>
                  <div className="admin-field"><label className="admin-label">КПП</label><input className="admin-input" value={kpp} onChange={(e) => setKpp(e.target.value)} /></div>
                  <div className="admin-field" style={{ gridColumn: "1 / -1" }}><label className="admin-label">Адрес</label><input className="admin-input" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
                </div>
              </details>

              <div className="admin-field">
                <label className="admin-label">Товары</label>
                <ProductPicker products={products} onPick={addItem} />
              </div>

              <div className="admin-field" style={{ marginTop: 12 }}>
                <label className="admin-label">Привязать существующую оплату</label>
                {availablePayments.length === 0 ? (
                  <div className="wh-deal-pick__empty">Нет свободных платежей для этого клиента</div>
                ) : (
                  <SearchMultiSelect
                    options={paymentOptions}
                    selectedIds={selectedPayments}
                    onToggle={togglePayment}
                    placeholder="Поиск платежа по номеру или сумме…"
                    emptyText="Платежи не найдены"
                  />
                )}
              </div>

              {items.length > 0 && (
                <div className="wh-items wh-items--deal">
                  <div className="wh-item-row wh-item-row--head">
                    <span>Товар</span>
                    <span>Кол-во</span>
                    <span>Цена, ₽</span>
                    <span>Сумма</span>
                    <span />
                  </div>
                  {items.map((it) => (
                    <div key={it.productId} className="wh-item-row">
                      <span className="wh-item-row__name">
                        {it.name}
                        {it.sku && <span className="wh-item-row__sku">{it.sku}</span>}
                        {Number(it.quantity) > it.stockQty && (
                          <span className="wh-item-row__warn">
                            на складе: {it.stockQty}
                          </span>
                        )}
                      </span>
                      <input
                        type="number"
                        className="admin-input"
                        min={1}
                        step={1}
                        value={it.quantity}
                        onChange={(e) =>
                          setItem(it.productId, {
                            quantity:
                              e.target.value === ""
                                ? ""
                                : Number(e.target.value),
                          })
                        }
                      />
                      <input
                        type="number"
                        className="admin-input"
                        min={0}
                        step={0.01}
                        value={it.price}
                        onChange={(e) =>
                          setItem(it.productId, {
                            price:
                              e.target.value === ""
                                ? ""
                                : Number(e.target.value),
                          })
                        }
                      />
                      <span className="wh-item-row__sum">
                        {fmt((Number(it.quantity) || 0) * (Number(it.price) || 0))} ₽
                      </span>
                      <button
                        type="button"
                        className="wh-item-row__del"
                        onClick={() => removeItem(it.productId)}
                        aria-label="Убрать позицию"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {error && <div className="wh-form-error">{error}</div>}

              <div className="wh-form-footer">
                <div className="wh-form-total">
                  Итого (с НДС): <strong>{fmt(total)} ₽</strong>
                  <span className="wh-form-vat">
                    в т.ч. НДС {VAT_RATE}% — {fmt(includedVat(total))} ₽
                  </span>
                </div>
                <div className="admin-form-actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    onClick={() => setOpen(false)}
                    disabled={saving}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="admin-btn admin-btn--primary"
                    disabled={saving || items.length === 0}
                  >
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    {initialDeal ? "Сохранить изменения" : "Сохранить заказ"}
                  </button>
                </div>
              </div>
              <p className="wh-form-hint">
                {initialDeal
                  ? "При изменении отпущенного заказа остатки склада будут автоматически скорректированы."
                  : "Заказ создаётся без списания, а в банке автоматически появится входящий счёт. После оплаты кнопка «Отпустить товар» спишет позиции со склада."}
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Действия по заказу ──────────────────────────────────

const CANCEL_REASONS = [
  "Клиент отказался",
  "Нет товара на складе",
  "Ошибка в заказе",
  "Другая причина",
];

export function DealActions({
  dealId,
  status,
  hasShortage = false,
  paidEnough = false,
}: {
  dealId: string;
  status: "new" | "completed" | "cancelled";
  hasShortage?: boolean;
  paidEnough?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [customReason, setCustomReason] = useState("");

  async function callApi(payload: Record<string, unknown>, method = "PATCH") {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/warehouse/deals/${dealId}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PATCH" ? JSON.stringify(payload) : undefined,
      });
      if (res.ok) {
        setShowCancelModal(false);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Ошибка");
      }
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  function handleCancelSubmit() {
    const reason =
      cancelReason === "Другая причина" ? customReason : cancelReason;
    callApi({ action: "cancel", reason: reason || null });
  }

  function handleDelete() {
    if (
      !confirm(
        "Удалить заказ? Если товар уже отпущен, он вернётся на склад (сторно)."
      )
    )
      return;
    callApi({}, "DELETE");
  }

  return (
    <div className="admin-status">
      {status === "new" && (
        <div className="admin-status__btns">
          <button
            type="button"
            onClick={() => {
              if (
                hasShortage &&
                !confirm(
                  "Товара на складе не хватает — остаток уйдёт в минус. Отпустить всё равно?"
                )
              ) {
                return;
              }
              callApi({ action: "post" });
            }}
            disabled={saving}
            className={`admin-status__btn ${
              paidEnough
                ? "admin-status__btn--primary"
                : "admin-status__btn--outline"
            }`}
            title={
              paidEnough
                ? "Списать товар со склада и отметить заказ отпущенным"
                : "Отпустить товар до подтверждения оплаты в банке"
            }
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle size={14} />
            )}
            {paidEnough ? "Отпустить товар" : "Отпустить без оплаты"}
          </button>
          <button
            type="button"
            onClick={() => setShowCancelModal(true)}
            disabled={saving}
            className="admin-status__btn admin-status__btn--outline-red"
          >
            <XCircle size={14} />
            Отменить
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="admin-status__btn admin-status__btn--delete"
            title="Удалить заказ"
          >
            <Trash2 size={14} />
            Удалить
          </button>
        </div>
      )}

      {status === "completed" && (
        <div className="admin-status__btns">
          <button
            type="button"
            onClick={() => setShowCancelModal(true)}
            disabled={saving}
            className="admin-status__btn admin-status__btn--outline-red"
          >
            <XCircle size={14} />
            Отменить
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="admin-status__btn admin-status__btn--delete"
            title="Удалить заказ"
          >
            <Trash2 size={14} />
            Удалить
          </button>
        </div>
      )}

      {status === "cancelled" && (
        <div className="admin-status__btns">
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="admin-status__btn admin-status__btn--delete"
            title="Удалить заказ"
          >
            <Trash2 size={14} />
            Удалить
          </button>
        </div>
      )}

      {showCancelModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal">
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">Отменить заказ</h3>
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="admin-modal__close"
                aria-label="Закрыть"
              >
                <X size={14} />
              </button>
            </div>
            <p className="admin-modal__desc">
              {status === "completed"
                ? "Заказ был отпущен: товар вернётся на остатки склада (сторно)."
                : "Заказ не проводился, остатки не изменятся."}
            </p>
            <div className="admin-radio-list">
              {CANCEL_REASONS.map((reason) => (
                <label key={reason} className="admin-radio-item">
                  <input
                    type="radio"
                    name="deal-cancel-reason"
                    value={reason}
                    checked={cancelReason === reason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>
            {cancelReason === "Другая причина" && (
              <textarea
                className="admin-textarea"
                placeholder="Укажите причину..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                rows={3}
              />
            )}
            <div className="admin-modal__actions">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="admin-btn admin-btn--ghost"
                disabled={saving}
              >
                Назад
              </button>
              <button
                type="button"
                onClick={handleCancelSubmit}
                className="admin-btn admin-btn--danger"
                disabled={
                  saving ||
                  !cancelReason ||
                  (cancelReason === "Другая причина" && !customReason.trim())
                }
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Отменить заказ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
