// src/components/admin/OrderDeliveryControls.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Truck,
  Gift,
  Banknote,
  Loader2,
  MapPin,
  X,
  Check,
} from "lucide-react";

export function OrderDeliveryControls({
  orderId,
  hasDelivery = false,
  deliveryType = null,
  deliveryCost = null,
  deliveryAddress = null,
  deliveryReleasedAt = null,
  deliveryNote = null,
  /** site = заявка с сайта; deal = заказ учёта (ЗК) */
  source = "site",
}: {
  orderId: string;
  hasDelivery?: boolean;
  deliveryType?: "free" | "paid" | null;
  deliveryCost?: number | null;
  deliveryAddress?: string | null;
  deliveryReleasedAt?: string | null;
  deliveryNote?: string | null;
  source?: "site" | "deal";
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "free" | "paid" | "edit">(
    "idle"
  );
  const [address, setAddress] = useState(deliveryAddress || "");
  // Показываем сохранённую сумму как есть, включая 0 — так видно, что
  // для этого клиента доставка сделана бесплатной вручную.
  const [cost, setCost] = useState(
    hasDelivery && deliveryCost != null ? String(deliveryCost) : ""
  );
  const [note, setNote] = useState(deliveryNote || "");
  const endpoint =
    source === "deal"
      ? `/api/admin/warehouse/deals/${orderId}/delivery`
      : `/api/admin/orders/${orderId}/delivery`;

  async function callApi(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Ошибка сохранения");
        setSaving(false);
        return false;
      }
      setMode("idle");
      router.refresh();
      setSaving(false);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      setSaving(false);
      return false;
    }
  }

  async function setFree() {
    if (!address.trim()) {
      setError("Укажите адрес доставки");
      return;
    }
    await callApi({
      action: "set_free",
      deliveryAddress: address.trim(),
      deliveryNote: note.trim() || null,
    });
  }

  async function setPaid() {
    if (cost.trim() === "") {
      setError("Укажите сумму доставки (0 — бесплатно для клиента)");
      return;
    }
    const num = Math.max(0, Number(cost) || 0);
    if (!address.trim()) {
      setError("Укажите адрес доставки");
      return;
    }
    await callApi({
      action: "set_paid",
      deliveryCost: num,
      deliveryAddress: address.trim(),
      deliveryNote: note.trim() || null,
    });
  }

  async function removeDelivery() {
    if (!confirm("Снять пометку доставки с этого заказа?")) return;
    await callApi({ action: "remove" });
  }

  async function saveEdit() {
    if (!address.trim()) {
      setError("Адрес обязателен");
      return;
    }
    // ★ Сумму можно менять всегда, а не только у «платной» доставки:
    //   0 ₽ делает доставку бесплатной, > 0 ₽ — платной. Раньше поле
    //   стоимости у бесплатной доставки вообще не показывалось, а нулевой
    //   тариф отбрасывался — новый тариф не сохранялся.
    const num = cost.trim() === "" ? 0 : Math.max(0, Number(cost) || 0);
    await callApi({
      hasDelivery: true,
      deliveryType: num > 0 ? "paid" : "free",
      deliveryCost: num,
      deliveryAddress: address.trim(),
      deliveryNote: note.trim() || null,
    });
  }

  function openForm(next: "free" | "paid" | "edit") {
    setError(null);
    setAddress(deliveryAddress || "");
    // При редактировании подставляем текущий тариф (в т.ч. 0),
    // при добавлении новой доставки поле пустое.
    setCost(
      next === "edit" && deliveryCost != null ? String(deliveryCost) : ""
    );
    setNote(deliveryNote || "");
    setMode(next);
  }

  const isReleased = Boolean(deliveryReleasedAt);

  return (
    <div className="order-delivery">
      <div className="order-delivery__head">
        <Truck size={14} />
        <span>Доставка</span>
      </div>

      {hasDelivery ? (
        <div className="order-delivery__active">
          <div className="order-delivery__badges">
            {deliveryType === "paid" ? (
              <span className="admin-badge admin-badge--amber">
                <Banknote size={11} />
                Платная
                {deliveryCost != null && deliveryCost > 0
                  ? ` · ${Number(deliveryCost).toLocaleString("ru-RU")} ₽`
                  : ""}
              </span>
            ) : (
              <span className="admin-badge admin-badge--green">
                <Gift size={11} />
                Бесплатная
              </span>
            )}
            {isReleased ? (
              <span className="admin-badge admin-badge--muted">Отпущена</span>
            ) : (
              <span className="admin-badge admin-badge--blue">Не отпущена</span>
            )}
          </div>

          {deliveryAddress && (
            <div className="order-delivery__addr">
              <MapPin size={12} />
              <span>{deliveryAddress}</span>
            </div>
          )}
          {deliveryNote && (
            <div className="order-delivery__note">{deliveryNote}</div>
          )}

          {mode === "edit" ? (
            <DeliveryForm
              address={address}
              setAddress={setAddress}
              cost={cost}
              setCost={setCost}
              note={note}
              setNote={setNote}
              /* Сумму показываем всегда: её можно как назначить,
                 так и обнулить (бесплатно для этого клиента). */
              showCost
              costOptional
              saving={saving}
              error={error}
              onCancel={() => setMode("idle")}
              onSubmit={saveEdit}
              submitLabel="Сохранить"
            />
          ) : (
            <div className="order-delivery__actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => openForm("edit")}
                disabled={saving}
              >
                Изменить
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={removeDelivery}
                disabled={saving}
                title="Снять доставку"
              >
                <X size={12} /> Снять
              </button>
            </div>
          )}
        </div>
      ) : mode === "idle" ? (
        <div className="order-delivery__actions">
          <button
            type="button"
            className="admin-btn admin-btn--outline admin-btn--sm"
            onClick={() => openForm("free")}
            disabled={saving}
            title="Бесплатная доставка"
          >
            <Gift size={13} />
            Бесплатная
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--navy admin-btn--sm"
            onClick={() => openForm("paid")}
            disabled={saving}
            title="Платная доставка — указать сумму"
          >
            <Banknote size={13} />
            Платная
          </button>
        </div>
      ) : (
        <DeliveryForm
          address={address}
          setAddress={setAddress}
          cost={cost}
          setCost={setCost}
          note={note}
          setNote={setNote}
          showCost={mode === "paid"}
          saving={saving}
          error={error}
          onCancel={() => setMode("idle")}
          onSubmit={mode === "paid" ? setPaid : setFree}
          submitLabel={
            mode === "paid" ? "Добавить платную" : "Добавить бесплатную"
          }
        />
      )}

      {error && mode === "idle" && (
        <div className="order-delivery__error">{error}</div>
      )}
    </div>
  );
}

function DeliveryForm({
  address,
  setAddress,
  cost,
  setCost,
  note,
  setNote,
  showCost,
  costOptional = false,
  saving,
  error,
  onCancel,
  onSubmit,
  submitLabel,
}: {
  address: string;
  setAddress: (v: string) => void;
  cost: string;
  setCost: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  showCost: boolean;
  /** true — допускается 0 (бесплатно для клиента) */
  costOptional?: boolean;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <div className="order-delivery__form">
      <div className="admin-field">
        <label className="admin-label">
          Адрес доставки <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          className="admin-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Город, улица, дом, офис/кв."
          disabled={saving}
        />
      </div>
      {showCost && (
        <div className="admin-field">
          <label className="admin-label">
            Сумма доставки, ₽{" "}
            {costOptional ? (
              <span style={{ fontWeight: 400, color: "var(--adm-sand)" }}>
                — 0 = бесплатно для клиента
              </span>
            ) : (
              <span style={{ color: "#ef4444" }}>*</span>
            )}
          </label>
          <input
            className="admin-input"
            type="number"
            min={0}
            step={1}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder={costOptional ? "0 — бесплатно" : "Например, 800"}
            disabled={saving}
          />
        </div>
      )}
      <div className="admin-field">
        <label className="admin-label">Заметка курьеру</label>
        <input
          className="admin-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Код домофона, этаж..."
          disabled={saving}
        />
      </div>
      {error && <div className="order-delivery__error">{error}</div>}
      <div className="order-delivery__actions">
        <button
          type="button"
          className="admin-btn admin-btn--navy admin-btn--sm"
          onClick={onSubmit}
          disabled={saving}
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Check size={13} />
          )}
          {submitLabel}
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm"
          onClick={onCancel}
          disabled={saving}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

function formatRuDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}.${m}.${y}`;
}
