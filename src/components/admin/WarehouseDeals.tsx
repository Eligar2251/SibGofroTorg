// =========================================================
// FILE: src/components/admin/WarehouseDeals.tsx
// Заказ покупателя: форма + действия (провести/отменить/удалить)
// =========================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
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

interface DealItemDraft {
  productId: string;
  name: string;
  sku: string | null;
  quantity: number;
  price: number;
  stockQty: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function DealForm({ products }: { products: PickerProduct[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(todayIso());
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [comment, setComment] = useState("");
  const [items, setItems] = useState<DealItemDraft[]>([]);

  const total = items.reduce((s, it) => s + it.quantity * it.price, 0);

  function resetForm() {
    setDate(todayIso());
    setCustomerName("");
    setCustomerPhone("");
    setComment("");
    setItems([]);
    setError("");
  }

  function addItem(p: PickerProduct) {
    setItems((prev) => {
      const existing = prev.find((it) => it.productId === p.id);
      if (existing) {
        return prev.map((it) =>
          it.productId === p.id ? { ...it, quantity: it.quantity + 1 } : it
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
          price: p.price ?? 0,
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
      const res = await fetch("/api/admin/warehouse/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || null,
          comment: comment.trim() || null,
          items: items.map((it) => ({
            productId: it.productId,
            name: it.name,
            sku: it.sku,
            quantity: Number(it.quantity) || 0,
            price: Number(it.price) || 0,
          })),
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
        className="admin-btn admin-btn--primary"
        onClick={() => setOpen(true)}
      >
        <Plus size={15} /> Новый заказ
      </button>

      {open && (
        <div className="admin-modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="admin-modal wh-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">Заказ покупателя</h3>
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
                  <input
                    type="text"
                    className="admin-input"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Компания или ФИО"
                    required
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

              <div className="admin-field">
                <label className="admin-label">Товары</label>
                <ProductPicker products={products} onPick={addItem} />
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
                            quantity: Number(e.target.value),
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
                          setItem(it.productId, { price: Number(e.target.value) })
                        }
                      />
                      <span className="wh-item-row__sum">
                        {fmt(it.quantity * it.price)} ₽
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
                  Итого: <strong>{fmt(total)} ₽</strong>
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
                    Сохранить заказ
                  </button>
                </div>
              </div>
              <p className="wh-form-hint">
                Заказ создаётся без списания. Кнопка «Провести» в списке
                зарезервирует товар — спишет его с остатков склада.
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
}: {
  dealId: string;
  status: "new" | "completed" | "cancelled";
  hasShortage?: boolean;
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
        "Удалить заказ? Если он был проведён, товар вернётся на склад (сторно)."
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
                  "Товара на складе не хватает — остаток уйдёт в минус. Провести всё равно?"
                )
              ) {
                return;
              }
              callApi({ action: "post" });
            }}
            disabled={saving}
            className="admin-status__btn admin-status__btn--primary"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle size={14} />
            )}
            Провести
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
                ? "Заказ был проведён: товар вернётся на остатки склада (сторно)."
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
