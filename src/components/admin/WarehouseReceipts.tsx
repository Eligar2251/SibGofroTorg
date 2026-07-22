// =========================================================
// FILE: src/components/admin/WarehouseReceipts.tsx
// Приходный ордер: количество + ОБЩАЯ сумма партии (с НДС),
// цена за единицу вычисляется автоматически
// =========================================================

"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  SearchCombobox,
  SearchMultiSelect,
  type PickerOption,
} from "@/components/admin/SearchPicker";
import { includedVat, VAT_RATE, VAT_RATES } from "@/lib/vat";
import type { CounterpartyOption } from "@/components/admin/WarehouseCounterparties";
import type { BankPayment } from "@/lib/warehouse-shared";

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
  vatRate?: number;
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

/** Округление до копеек, чтобы не копился хвост из float-арифметики */
function roundKopeck(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Равномерно разбить сумму на count частей так, чтобы сумма частей
 * совпала с итогом до копейки: первые (count-1) частей одинаковые,
 * остаток добирается в последней части.
 */
function splitEvenly(totalSum: number, count: number): string[] {
  const sum = roundKopeck(totalSum);
  if (count <= 1) return [String(sum)];
  // Итог ещё не введён — показываем нужное количество нулевых полей
  if (sum <= 0) return Array.from({ length: count }, () => "0");
  const base = Math.floor((sum / count) * 100) / 100;
  const next: string[] = [];
  let allocated = 0;
  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      next.push(String(roundKopeck(sum - allocated)));
    } else {
      next.push(String(base));
      allocated = roundKopeck(allocated + base);
    }
  }
  return next;
}

export function ReceiptForm({
  products,
  counterparties = [],
  deals = [],
  payments = [],
  initialReceipt,
}: {
  products: PickerProduct[];
  counterparties?: CounterpartyOption[];
  deals?: any[];
  payments?: BankPayment[];
  initialReceipt?: EditableReceipt & { linkedDealIds?: string[] };
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
  const [vatRate, setVatRate] = useState<number>(
    initialReceipt?.vatRate ?? VAT_RATE
  );
  const [items, setItems] = useState<ReceiptItemDraft[]>(
    initialReceipt?.items || []
  );
  const [selectedDeals, setSelectedDeals] = useState<string[]>(
    initialReceipt?.linkedDealIds || []
  );
  const [selectedPayments, setSelectedPayments] = useState<string[]>([]);
  const [paymentCount, setPaymentCount] = useState(1);
  const [splitAmounts, setSplitAmounts] = useState<string[]>([""]);
  /** Пользователь вручную правил суммы частей — автопересчёт выключаем */
  const [splitTouched, setSplitTouched] = useState(false);

  const total = useMemo(
    () => items.reduce((s, it) => s + (Number(it.lineTotal) || 0), 0),
    [items]
  );

  // Пересчитываем части при изменении итога, если суммы ещё не правили
  // вручную. Без этого выбор «2 платежа» до ввода позиций (или изменение
  // позиций после) оставлял устаревшие/нулевые/отрицательные суммы, и в банк
  // уходил один общий платёж вместо нескольких.
  useEffect(() => {
    if (paymentCount > 1 && !splitTouched) {
      setSplitAmounts(splitEvenly(total, paymentCount));
    }
  }, [total, paymentCount, splitTouched]);

  function handleSplitCountChange(count: number) {
    setPaymentCount(count);
    setSplitTouched(false);
    setSplitAmounts(splitEvenly(total, count));
  }

  /** Итоговый массив сумм платежей, который уходит на сервер */
  function buildPaymentSplits(): number[] {
    if (paymentCount <= 1) return [roundKopeck(total)];
    const parts = splitAmounts
      .map((v) => roundKopeck(Number(v) || 0))
      .filter((v) => v > 0);
    // Если введённые части пустые/нулевые — делим итог сами
    return parts.length > 0 ? parts : splitEvenly(total, paymentCount).map(Number);
  }

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
    setVatRate(initialReceipt?.vatRate ?? VAT_RATE);
    setItems(initialReceipt?.items || []);
    setSelectedDeals(initialReceipt?.linkedDealIds || []);
    setSelectedPayments([]);
    setPaymentCount(1);
    setSplitAmounts([""]);
    setSplitTouched(false);
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

  function toggleDeal(id: string) {
    setSelectedDeals((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function togglePayment(id: string) {
    setSelectedPayments((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const availablePayments = payments.filter(
    (p) =>
      p.counterparty.toLocaleLowerCase("ru-RU") ===
        supplier.toLocaleLowerCase("ru-RU") &&
      p.isPaid &&
      (!p.receiptIds || p.receiptIds.length === 0)
  );

  // Варианты для переиспользуемых контролов выбора с поиском
  const supplierOptions: PickerOption[] = useMemo(
    () =>
      counterparties
        .filter((item) => item.roles.includes("supplier"))
        .map((item) => ({
          id: item.id,
          title: item.name,
          meta: [item.contactName, item.phone, item.inn]
            .filter(Boolean)
            .join(" · "),
        })),
    [counterparties]
  );

  const newDeals = useMemo(
    () => deals.filter((d) => d.status === "new"),
    [deals]
  );

  const dealOptions: PickerOption[] = useMemo(
    () =>
      newDeals.map((d) => {
        const names = (d.items?.map((it: any) => it.name) || []).join(", ");
        return {
          id: d.id,
          title: `ЗК-${d.number} · ${d.customerName}`,
          meta: `${fmtDate(d.date)} · ${fmt(d.total)} ₽`,
          hint: names || undefined,
          keywords: names,
          right: `${fmt(d.total)} ₽`,
        };
      }),
    [newDeals]
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
          vatRate,
          linkedDealIds: selectedDeals,
          linkedPaymentIds: selectedPayments,
          paymentSplits: buildPaymentSplits(),
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
                  <SearchCombobox
                    options={supplierOptions}
                    value={supplier}
                    onChange={(value) => selectSupplier(value)}
                    placeholder="Начните вводить название..."
                    emptyText="Такого поставщика нет — впишите нового"
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Ставка НДС</label>
                  <select
                    className="admin-select"
                    value={vatRate}
                    onChange={(e) => setVatRate(Number(e.target.value))}
                  >
                    {VAT_RATES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
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

              <div className="admin-field" style={{ marginTop: 12 }}>
                <label className="admin-label">Оплата (разбить на части?)</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  {[1, 2, 3].map(count => (
                    <button
                      key={count}
                      type="button"
                      className={`admin-btn ${paymentCount === count ? 'admin-btn--primary' : 'admin-btn--ghost'}`}
                      style={{ flex: 1 }}
                      onClick={() => handleSplitCountChange(count)}
                    >
                      {count} {count === 1 ? 'платеж' : 'платежа'}
                    </button>
                  ))}
                </div>
                
                {paymentCount > 1 && (
                  <>
                    <div className="wh-form-grid" style={{ marginTop: 8 }}>
                      {splitAmounts.map((val, idx) => (
                        <div key={idx} className="admin-field">
                          <label className="admin-label">Сумма части {idx + 1}, ₽</label>
                          <input
                            type="number"
                            className="admin-input"
                            min={0}
                            step={0.01}
                            value={val}
                            onChange={(e) => {
                              const next = [...splitAmounts];
                              next[idx] = e.target.value;
                              setSplitAmounts(next);
                              setSplitTouched(true);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="wh-form-hint" style={{ margin: "6px 0 0" }}>
                      Сумма частей:{" "}
                      <strong>
                        {fmt(
                          splitAmounts.reduce(
                            (s, v) => s + (Number(v) || 0),
                            0
                          )
                        )}{" "}
                        ₽
                      </strong>{" "}
                      из {fmt(total)} ₽
                      {Math.abs(
                        splitAmounts.reduce((s, v) => s + (Number(v) || 0), 0) -
                          total
                      ) > 0.009 && " — не сходится с итогом!"}
                    </div>
                  </>
                )}
              </div>

              <div className="admin-field" style={{ marginTop: 12 }}>
                <label className="admin-label">Заказать под клиента (привязка к заказу)</label>
                {newDeals.length === 0 ? (
                  <div className="wh-deal-pick__empty">Нет активных заказов</div>
                ) : (
                  <SearchMultiSelect
                    options={dealOptions}
                    selectedIds={selectedDeals}
                    onToggle={toggleDeal}
                    placeholder="Поиск заказа по номеру, клиенту или товару…"
                    emptyText="Заказы не найдены"
                  />
                )}
              </div>

              <div className="admin-field" style={{ marginTop: 12 }}>
                <label className="admin-label">Привязать существующую оплату</label>
                {availablePayments.length === 0 ? (
                  <div className="wh-deal-pick__empty">Нет свободных платежей для этого поставщика</div>
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
                    в т.ч. НДС {vatRate > 0 ? `${vatRate}%` : "0%"} — {fmt(includedVat(total, vatRate))} ₽
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
    if (
      !paidEnough &&
      !confirm(
        "Поступление еще не оплачено в банке. Провести на склад без подтверждения оплаты?"
      )
    )
      return;
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
      className={`admin-status__btn ${
        paidEnough ? "admin-status__btn--primary" : "admin-status__btn--outline"
      }`}
      onClick={post}
      disabled={saving}
      title={
        paidEnough
          ? "Добавить товары на склад"
          : "Товар будет зачислен, но останется долг перед поставщиком"
      }
    >
      {saving ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <CheckCircle size={14} />
      )}
      {paidEnough ? "Провести на склад" : "Провести без оплаты"}
    </button>
  );
}

export function ReceiptCancelButton({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function cancel() {
    if (
      !confirm(
        "Вернуть поступление в черновики? Остатки на складе будут уменьшены."
      )
    )
      return;
    setSaving(true);
    const response = await fetch(`/api/admin/warehouse/receipts/${receiptId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) router.refresh();
    else alert(body.error || "Не удалось отменить проведение");
    setSaving(false);
  }

  return (
    <button
      type="button"
      className="admin-status__btn admin-status__btn--outline-red"
      onClick={cancel}
      disabled={saving}
      title="Вернуть в черновик (списать со склада)"
    >
      {saving ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <X size={14} />
      )}
      Отменить приход
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
