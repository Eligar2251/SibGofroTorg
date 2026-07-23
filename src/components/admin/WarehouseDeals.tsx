// =========================================================
// FILE: src/components/admin/WarehouseDeals.tsx
// Заказ покупателя: форма + действия (провести/отменить/удалить)
// =========================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Edit2,
  Plus,
  Trash2,
  X,
  Loader2,
  CheckCircle,
  XCircle,
  Gift,
  Banknote,
  Truck,
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
import { ModalPortal } from "@/components/admin/ModalPortal";
import { includedVat, VAT_RATE, VAT_RATES } from "@/lib/vat";
import type { CounterpartyOption } from "@/components/admin/WarehouseCounterparties";
import type { BankPayment } from "@/lib/warehouse-shared";

/** Округление до копеек */
function roundKopeck(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Равномерно разбить сумму на count частей: первые (count-1) одинаковые,
 * остаток добирается в последней. Сумма частей = total до копейки.
 */
function splitEvenly(totalSum: number, count: number): string[] {
  const sum = roundKopeck(totalSum);
  if (count <= 1) return [String(sum)];
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
  vatRate?: number;
  hasDelivery?: boolean;
  deliveryType?: "free" | "paid" | null;
  deliveryCost?: number | null;
  deliveryAddress?: string | null;
  deliveryPlannedDate?: string | null;
  deliveryNote?: string | null;
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
  deliveryPrice = 800,
  freeDeliveryThreshold = 30000,
}: {
  products: PickerProduct[];
  counterparties?: CounterpartyOption[];
  payments?: BankPayment[];
  initialDeal?: EditableDeal & { linkedPaymentIds?: string[] };
  /** Тариф курьера из настроек (₽) */
  deliveryPrice?: number;
  /** Порог бесплатной доставки из настроек (₽) */
  freeDeliveryThreshold?: number;
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
  const [vatRate, setVatRate] = useState<number>(
    initialDeal?.vatRate ?? VAT_RATE
  );
  const [hasDelivery, setHasDelivery] = useState(
    Boolean(initialDeal?.hasDelivery)
  );
  // null = считать по тарифу автоматически; иначе ручная сумма
  const [deliveryCostOverride, setDeliveryCostOverride] = useState<string | null>(
    initialDeal?.hasDelivery &&
      initialDeal?.deliveryType === "paid" &&
      initialDeal?.deliveryCost != null
      ? String(initialDeal.deliveryCost)
      : null
  );
  const [deliveryAddress, setDeliveryAddress] = useState(
    initialDeal?.deliveryAddress || initialDeal?.address || ""
  );
  const [deliveryPlannedDate, setDeliveryPlannedDate] = useState(
    initialDeal?.deliveryPlannedDate || ""
  );
  const [deliveryNote, setDeliveryNote] = useState(
    initialDeal?.deliveryNote || ""
  );

  // ── Разбиение платежа на части ──
  const existingUnpaid = useMemo(() => {
    if (!initialDeal) return [] as BankPayment[];
    return payments.filter(
      (p) =>
        p.direction === "incoming" &&
        !p.isPaid &&
        (p.dealIds || []).length === 1 &&
        (p.receiptIds || []).length === 0
    );
  }, [payments, initialDeal]);

  const [paymentCount, setPaymentCount] = useState(
    initialDeal && existingUnpaid.length > 1 ? existingUnpaid.length : 1
  );
  const [splitAmounts, setSplitAmounts] = useState<string[]>([""]);
  const [splitTouched, setSplitTouched] = useState(false);

  const itemsTotal = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.price) || 0),
    0
  );
  const tariffCost =
    freeDeliveryThreshold > 0 && itemsTotal >= freeDeliveryThreshold
      ? 0
      : Math.max(0, Number(deliveryPrice) || 0);
  const deliveryType: "free" | "paid" =
    hasDelivery &&
    (deliveryCostOverride != null
      ? Number(deliveryCostOverride) > 0
      : tariffCost > 0)
      ? "paid"
      : "free";
  const deliveryAmount = !hasDelivery
    ? 0
    : deliveryCostOverride != null
    ? Math.max(0, Number(deliveryCostOverride) || 0)
    : tariffCost;
  const total = itemsTotal + deliveryAmount;
  const isFreeByTariff =
    hasDelivery &&
    deliveryCostOverride == null &&
    freeDeliveryThreshold > 0 &&
    itemsTotal >= freeDeliveryThreshold;

  // Пересчёт частей при изменении итога
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

  function buildPaymentSplits(): number[] {
    if (paymentCount <= 1) return [roundKopeck(total)];
    const parts = splitAmounts
      .map((v) => roundKopeck(Number(v) || 0))
      .filter((v) => v > 0);
    return parts.length > 0 ? parts : splitEvenly(total, paymentCount).map(Number);
  }

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
    setVatRate(initialDeal?.vatRate ?? VAT_RATE);
    setHasDelivery(Boolean(initialDeal?.hasDelivery));
    setDeliveryCostOverride(
      initialDeal?.hasDelivery &&
        initialDeal?.deliveryType === "paid" &&
        initialDeal?.deliveryCost != null
        ? String(initialDeal.deliveryCost)
        : null
    );
    setDeliveryAddress(
      initialDeal?.deliveryAddress || initialDeal?.address || ""
    );
    setDeliveryPlannedDate(initialDeal?.deliveryPlannedDate || "");
    setDeliveryNote(initialDeal?.deliveryNote || "");
    setError("");
    setPaymentCount(1);
    setSplitAmounts([""]);
    setSplitTouched(false);
  }

  function pickCustomerAddress(found: CounterpartyOption): string {
    return (
      found.address ||
      found.legalAddress ||
      ""
    ).trim();
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
    const addr = pickCustomerAddress(found);
    setAddress(found.address || found.legalAddress || "");
    setContactName(found.contactName || "");
    // Авто-подстановка адреса доставки из карточки клиента
    if (addr) {
      setDeliveryAddress(addr);
    }
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
    if (hasDelivery && !deliveryAddress.trim()) {
      setError("Укажите адрес доставки");
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
          address: address.trim() || deliveryAddress.trim() || null,
          contactName: contactName.trim() || null,
          comment: comment.trim() || null,
          vatRate,
          hasDelivery,
          deliveryType: hasDelivery ? deliveryType : null,
          deliveryCost: hasDelivery ? deliveryAmount : 0,
          deliveryAddress: hasDelivery ? deliveryAddress.trim() : null,
          deliveryPlannedDate:
            hasDelivery && deliveryPlannedDate ? deliveryPlannedDate : null,
          deliveryNote:
            hasDelivery && deliveryNote.trim() ? deliveryNote.trim() : null,
          items: items.map((it) => ({
            productId: it.productId,
            name: it.name,
            sku: it.sku,
            quantity: Number(it.quantity) || 0,
            price: Number(it.price) || 0,
          })),
          linkedPaymentIds: selectedPayments,
          paymentSplits: buildPaymentSplits(),
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
        <ModalPortal>
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
                  <div className="admin-field" style={{ gridColumn: "1 / -1" }}>
                    <label className="admin-label">Адрес клиента</label>
                    <input
                      className="admin-input"
                      value={address}
                      onChange={(e) => {
                        setAddress(e.target.value);
                        // если доставка включена и адрес доставки совпадал — синхронизируем
                        if (hasDelivery && (!deliveryAddress || deliveryAddress === address)) {
                          setDeliveryAddress(e.target.value);
                        }
                      }}
                      placeholder="Подставится в доставку автоматически"
                    />
                  </div>
                </div>
              </details>

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

              {/* Доставка — в том же окне оформления заказа */}
              <div className="deal-delivery-block">
                <div className="deal-delivery-block__head">
                  <Truck size={14} />
                  <span>Доставка</span>
                  <label className="deal-delivery-block__toggle">
                    <input
                      type="checkbox"
                      checked={hasDelivery}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setHasDelivery(on);
                        if (on) {
                          // авто-адрес: поле адреса → контрагент → уже введённый
                          const fromCp = counterparties.find(
                            (c) =>
                              c.roles.includes("customer") &&
                              c.name.toLocaleLowerCase("ru-RU") ===
                                customerName.trim().toLocaleLowerCase("ru-RU")
                          );
                          const auto =
                            deliveryAddress ||
                            address ||
                            (fromCp ? pickCustomerAddress(fromCp) : "") ||
                            "";
                          if (auto) setDeliveryAddress(auto);
                          setDeliveryCostOverride(null); // тариф по умолчанию
                        }
                      }}
                    />
                    Нужна доставка
                  </label>
                </div>

                {hasDelivery ? (
                  <div className="deal-delivery-block__body">
                    <div className="deal-delivery-tariff">
                      {deliveryType === "free" || isFreeByTariff ? (
                        <span className="admin-badge admin-badge--green">
                          <Gift size={11} /> Бесплатная
                          {isFreeByTariff
                            ? ` · заказ от ${fmt(freeDeliveryThreshold)} ₽`
                            : ""}
                        </span>
                      ) : (
                        <span className="admin-badge admin-badge--amber">
                          <Banknote size={11} /> По тарифу {fmt(tariffCost)} ₽
                        </span>
                      )}
                      <span className="deal-delivery-tariff__hint">
                        Тариф: {fmt(deliveryPrice)} ₽ · бесплатно от{" "}
                        {fmt(freeDeliveryThreshold)} ₽
                      </span>
                    </div>

                    <div className="wh-form-grid">
                      <div
                        className="admin-field"
                        style={{ gridColumn: "1 / -1" }}
                      >
                        <label className="admin-label">
                          Адрес доставки{" "}
                          <span style={{ color: "#ef4444" }}>*</span>
                        </label>
                        <input
                          className="admin-input"
                          value={deliveryAddress}
                          onChange={(e) => setDeliveryAddress(e.target.value)}
                          placeholder="Подставится из карточки клиента, можно изменить"
                        />
                      </div>
                      <div className="admin-field">
                        <label className="admin-label">
                          Стоимость, ₽
                          {deliveryCostOverride == null ? " (тариф)" : " (вручную)"}
                        </label>
                        <input
                          className="admin-input"
                          type="number"
                          min={0}
                          step={1}
                          value={
                            deliveryCostOverride != null
                              ? deliveryCostOverride
                              : String(deliveryAmount)
                          }
                          onChange={(e) =>
                            setDeliveryCostOverride(e.target.value)
                          }
                          placeholder={String(tariffCost)}
                        />
                        {deliveryCostOverride != null && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--ghost admin-btn--sm"
                            style={{ marginTop: 6 }}
                            onClick={() => setDeliveryCostOverride(null)}
                          >
                            Вернуть тариф
                          </button>
                        )}
                      </div>
                      <div className="admin-field">
                        <label className="admin-label">План. дата</label>
                        <input
                          className="admin-input"
                          type="date"
                          value={deliveryPlannedDate}
                          onChange={(e) =>
                            setDeliveryPlannedDate(e.target.value)
                          }
                        />
                      </div>
                      <div
                        className="admin-field"
                        style={{ gridColumn: "1 / -1" }}
                      >
                        <label className="admin-label">Заметка курьеру</label>
                        <input
                          className="admin-input"
                          value={deliveryNote}
                          onChange={(e) => setDeliveryNote(e.target.value)}
                          placeholder="Код домофона, этаж..."
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="deal-delivery-block__empty">
                    Включите, если нужна доставка. Адрес подтянется из клиента,
                    стоимость — по тарифу из настроек.
                  </p>
                )}
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
                        {fmt(splitAmounts.reduce((s, v) => s + (Number(v) || 0), 0))} ₽
                      </strong>{" "}
                      из {fmt(total)} ₽
                      {Math.abs(splitAmounts.reduce((s, v) => s + (Number(v) || 0), 0) - total) > 0.009 && " — не сходится с итогом!"}
                    </div>
                  </>
                )}
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

              {error && <div className="wh-form-error">{error}</div>}

              <div className="wh-form-footer">
                <div className="wh-form-total">
                  Итого (с НДС): <strong>{fmt(total)} ₽</strong>
                  {deliveryAmount > 0 && (
                    <span className="wh-form-vat" style={{ display: "block" }}>
                      товары {fmt(itemsTotal)} ₽ + доставка {fmt(deliveryAmount)} ₽
                    </span>
                  )}
                  <span className="wh-form-vat">
                    в т.ч. НДС{" "}
                    {vatRate > 0 ? `${vatRate}%` : vatRate === -1 ? "без НДС" : "0%"}{" "}
                    — {fmt(includedVat(total, vatRate))} ₽
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
        </ModalPortal>
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
        <ModalPortal>
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
        </ModalPortal>
      )}
    </div>
  );
}
