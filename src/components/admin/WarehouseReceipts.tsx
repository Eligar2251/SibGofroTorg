// =========================================================
// FILE: src/components/admin/WarehouseReceipts.tsx
// Приходный ордер: количество + ОБЩАЯ сумма партии (с НДС),
// цена за единицу вычисляется автоматически
// =========================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  Edit2,
  Plus,
  Trash2,
  X,
  Loader2,
} from "lucide-react";
import {
  ProductPicker,
  type PickerProduct,
} from "@/components/admin/ProductPicker";
import { includedVat, VAT_RATE } from "@/lib/vat";
import type { CounterpartyOption } from "@/components/admin/WarehouseCounterparties";

interface ReceiptItemDraft {
  productId: string;
  name: string;
  sku: string | null;
  quantity: number | "";
  /** Пустая строка нужна, чтобы ноль можно было стереть и ввести своё число. */
  lineTotal: number | "";
}

export interface EditableReceipt {
  id: string;
  date: string;
  supplier: string;
  phone?: string | null;
  email?: string | null;
  inn?: string | null;
  kpp?: string | null;
  address?: string | null;
  contactName?: string | null;
  comment?: string | null;
  items: ReceiptItemDraft[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function ReceiptForm({
  products,
  counterparties = [],
  initialReceipt,
}: {
  products: PickerProduct[];
  counterparties?: CounterpartyOption[];
  initialReceipt?: EditableReceipt;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(initialReceipt?.date || todayIso());
  const [supplier, setSupplier] = useState(initialReceipt?.supplier || "");
  const [phone, setPhone] = useState(initialReceipt?.phone || "");
  const [email, setEmail] = useState(initialReceipt?.email || "");
  const [inn, setInn] = useState(initialReceipt?.inn || "");
  const [kpp, setKpp] = useState(initialReceipt?.kpp || "");
  const [address, setAddress] = useState(initialReceipt?.address || "");
  const [contactName, setContactName] = useState(
    initialReceipt?.contactName || ""
  );
  const [comment, setComment] = useState(initialReceipt?.comment || "");
  const [items, setItems] = useState<ReceiptItemDraft[]>(
    initialReceipt?.items || []
  );

  const total = items.reduce((s, it) => s + (Number(it.lineTotal) || 0), 0);

  function resetForm() {
    setDate(initialReceipt?.date || todayIso());
    setSupplier(initialReceipt?.supplier || "");
    setPhone(initialReceipt?.phone || "");
    setEmail(initialReceipt?.email || "");
    setInn(initialReceipt?.inn || "");
    setKpp(initialReceipt?.kpp || "");
    setAddress(initialReceipt?.address || "");
    setContactName(initialReceipt?.contactName || "");
    setComment(initialReceipt?.comment || "");
    setItems(initialReceipt?.items || []);
    setError("");
  }

  function selectSupplier(value: string) {
    setSupplier(value);
    const found = counterparties.find(
      (item) =>
        item.roles.includes("supplier") &&
        item.name.toLocaleLowerCase("ru-RU") ===
          value.trim().toLocaleLowerCase("ru-RU")
    );
    if (!found) return;
    setPhone(found.phone || "");
    setEmail(found.email || "");
    setInn(found.inn || "");
    setKpp(found.kpp || "");
    setAddress(found.address || "");
    setContactName(found.contactName || "");
    if (found.supplierPrices) {
      setItems((current) =>
        current.map((item) => {
          const price = found.supplierPrices?.[item.productId];
          return price != null && price > 0
            ? {
                ...item,
                lineTotal: price * (Number(item.quantity) || 1),
              }
            : item;
        })
      );
    }
  }

  function addItem(p: PickerProduct) {
    setItems((prev) => {
      const existing = prev.find((it) => it.productId === p.id);
      if (existing) return prev;
      // Сначала берём последнюю закупочную цену именно этого поставщика.
      const selectedSupplier = counterparties.find(
        (item) =>
          item.name.toLocaleLowerCase("ru-RU") ===
          supplier.trim().toLocaleLowerCase("ru-RU")
      );
      const suggested =
        selectedSupplier?.supplierPrices?.[p.id] ??
        p.priceWholesale ??
        p.price ??
        0;
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          quantity: 1,
          lineTotal: suggested > 0 ? suggested : "",
        },
      ];
    });
  }

  function setItem(productId: string, patch: Partial<ReceiptItemDraft>) {
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
    if (!supplier.trim()) {
      setError("Укажите поставщика");
      return;
    }
    if (items.length === 0) {
      setError("Добавьте хотя бы одну позицию");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        initialReceipt
          ? `/api/admin/warehouse/receipts/${initialReceipt.id}`
          : "/api/admin/warehouse/receipts",
        {
        method: initialReceipt ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          supplier: supplier.trim(),
          phone: phone.trim() || null,
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
            lineTotal: Number(it.lineTotal) || 0,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Не удалось сохранить поступление");
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
          initialReceipt
            ? "admin-btn admin-btn--ghost admin-btn--sm"
            : "admin-btn admin-btn--primary"
        }
        onClick={() => setOpen(true)}
      >
        {initialReceipt ? <Edit2 size={14} /> : <Plus size={15} />}
        {initialReceipt ? "Изменить" : "Оформить поступление"}
      </button>

      {open && (
        <div className="admin-modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="admin-modal wh-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal__head">
              <h3 className="admin-modal__title">
                {initialReceipt ? "Редактирование поступления" : "Новое поступление"}
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
                  <label className="admin-label">Поставщик *</label>
                  <input
                    type="text"
                    className="admin-input"
                    list="receipt-supplier-options"
                    value={supplier}
                    onChange={(e) => selectSupplier(e.target.value)}
                    placeholder="Начните вводить название..."
                    required
                  />
                  <datalist id="receipt-supplier-options">
                    {counterparties
                      .filter((item) => item.roles.includes("supplier"))
                      .map((item) => (
                        <option key={item.id} value={item.name} />
                      ))}
                  </datalist>
                </div>
              </div>

              <details className="wh-counterparty-details">
                <summary>Реквизиты поставщика</summary>
                <div className="wh-form-grid">
                  <div className="admin-field"><label className="admin-label">Контактное лицо</label><input className="admin-input" value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
                  <div className="admin-field"><label className="admin-label">Телефон</label><input className="admin-input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                  <div className="admin-field"><label className="admin-label">Email</label><input type="email" className="admin-input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div className="admin-field"><label className="admin-label">ИНН</label><input className="admin-input" value={inn} onChange={(e) => setInn(e.target.value)} /></div>
                  <div className="admin-field"><label className="admin-label">КПП</label><input className="admin-input" value={kpp} onChange={(e) => setKpp(e.target.value)} /></div>
                  <div className="admin-field"><label className="admin-label">Адрес</label><input className="admin-input" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
                </div>
              </details>

              <div className="admin-field">
                <label className="admin-label">Товары</label>
                <ProductPicker products={products} onPick={addItem} />
              </div>

              {items.length > 0 && (
                <div className="wh-items wh-items--receipt">
                  <div className="wh-item-row wh-item-row--head">
                    <span>Товар</span>
                    <span>Кол-во</span>
                    <span>Сумма партии, ₽</span>
                    <span />
                  </div>
                  {items.map((it) => {
                    const qty = Number(it.quantity) || 0;
                    const sum = Number(it.lineTotal) || 0;
                    const unit = qty > 0 ? sum / qty : 0;
                    return (
                      <div key={it.productId} className="wh-item-row">
                        <span className="wh-item-row__name">
                          {it.name}
                          {it.sku && (
                            <span className="wh-item-row__sku">{it.sku}</span>
                          )}
                          {qty > 0 && sum > 0 && (
                            <span className="wh-item-row__hint">
                              = {unit.toLocaleString("ru-RU", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{" "}
                              ₽/шт
                            </span>
                          )}
                        </span>
                        <input
                          type="number"
                          className="admin-input"
                          min={1}
                          step={1}
                          value={it.quantity}
                          onChange={(e) => {
                            const nextQty =
                              e.target.value === ""
                                ? ""
                                : Number(e.target.value);
                            const oldQty = Number(it.quantity) || 0;
                            const oldTotal = Number(it.lineTotal) || 0;
                            const unitPrice = oldQty > 0 ? oldTotal / oldQty : 0;
                            setItem(it.productId, {
                              quantity: nextQty,
                              ...(nextQty !== "" && unitPrice > 0
                                ? { lineTotal: unitPrice * nextQty }
                                : {}),
                            });
                          }}
                        />
                        <input
                          type="number"
                          className="admin-input"
                          min={0}
                          step={0.01}
                          value={it.lineTotal}
                          onChange={(e) =>
                            setItem(it.productId, {
                              lineTotal:
                                e.target.value === ""
                                  ? ""
                                  : Number(e.target.value),
                            })
                          }
                        />
                        <button
                          type="button"
                          className="wh-item-row__del"
                          onClick={() => removeItem(it.productId)}
                          aria-label="Убрать позицию"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

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
                    {initialReceipt ? "Сохранить изменения" : "Сохранить поступление"}
                  </button>
                </div>
              </div>
              <p className="wh-form-hint">
                Вводите сумму за всю партию позиции, как в счёте поставщика
                (с НДС). Поступление сначала сохранится без изменения склада.
                Оплатите связанный счёт в банке, затем вручную проведите
                поступление в списке.
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function ReceiptPostButton({
  receiptId,
  paidEnough,
}: {
  receiptId: string;
  paidEnough: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function post() {
    setSaving(true);
    const response = await fetch(`/api/admin/warehouse/receipts/${receiptId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "post" }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) router.refresh();
    else alert(body.error || "Не удалось провести поступление");
    setSaving(false);
  }

  return (
    <button
      type="button"
      className="admin-status__btn admin-status__btn--primary"
      onClick={post}
      disabled={saving || !paidEnough}
      title={
        paidEnough
          ? "Добавить товары на склад"
          : "Сначала подтвердите оплату счёта в банке"
      }
    >
      {saving ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <CheckCircle size={14} />
      )}
      {paidEnough ? "Провести на склад" : "Сначала оплатите счёт"}
    </button>
  );
}

export function ReceiptDeleteButton({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (
      !confirm(
        "Удалить поступление? Если оно уже проведено, склад будет сторнирован. Связанный неоплаченный счёт тоже удалится."
      )
    )
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/warehouse/receipts/${receiptId}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } catch (err) {
      console.error(err);
    }
    setDeleting(false);
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="admin-btn admin-btn--icon admin-btn--danger-ghost"
      title="Удалить (сторно складу)"
    >
      {deleting ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <Trash2 size={15} />
      )}
    </button>
  );
}
