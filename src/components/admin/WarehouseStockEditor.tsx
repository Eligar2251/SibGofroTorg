"use client";

import { useState } from "react";
import { Check, Loader2, Save } from "lucide-react";

export function StockQtyEditor({
  productId,
  initialQty,
  onSaved,
}: {
  productId: string;
  initialQty: number;
  onSaved?: (quantity: number) => void;
}) {
  const [value, setValue] = useState(String(initialQty));
  const [savedValue, setSavedValue] = useState(initialQty);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = value !== "" && Number(value) !== savedValue;

  async function save() {
    if (value === "") return;
    // Для резаных товаров (плёнка) разрешаем дробные рулоны: 5.9 = 5 рул + 90м
    const quantity = Math.max(0, Math.round((Number(value) || 0) * 1000) / 1000);
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch(`/api/admin/warehouse/stock/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockQty: quantity }),
      });
      if (response.ok) {
        setValue(String(quantity));
        setSavedValue(quantity);
        setSaved(true);
        onSaved?.(quantity);
        window.setTimeout(() => setSaved(false), 1400);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stock-inline-editor">
      <input
        type="number"
        min={0}
        step={0.001}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
        }}
        aria-label="Остаток на складе"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        title="Сохранить остаток"
      >
        {saving ? (
          <Loader2 size={13} className="animate-spin" />
        ) : saved ? (
          <Check size={13} />
        ) : (
          <Save size={13} />
        )}
      </button>
    </div>
  );
}
