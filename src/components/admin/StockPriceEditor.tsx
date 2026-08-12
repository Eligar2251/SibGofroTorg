"use client";

import { useState } from "react";
import { Check, Loader2, Save } from "lucide-react";

/**
 * Инлайн-редактор цены товара в таблице «Учёт → Склад».
 * Сохраняет в продукт сразу (PATCH /api/admin/products/[id]/prices).
 * variant="purchase" — приглушённый вид, чтобы закупочная цена
 * не бросалась в глаза.
 */
export function StockPriceEditor({
  productId,
  field,
  initialValue,
  variant = "sell",
  onSaved,
}: {
  productId: string;
  field: "price" | "purchasePrice";
  initialValue: number | null;
  variant?: "sell" | "purchase";
  onSaved?: (value: number | null) => void;
}) {
  const [value, setValue] = useState(initialValue != null ? String(initialValue) : "");
  const [savedValue, setSavedValue] = useState<number | null>(initialValue);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = value !== (savedValue != null ? String(savedValue) : "");

  async function save() {
    const parsed = value.trim() === "" ? null : Number(String(value).replace(",", "."));
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) return;
    if (parsed === savedValue) return;
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch(`/api/admin/products/${productId}/prices`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: parsed }),
      });
      if (response.ok) {
        setSavedValue(parsed);
        setValue(parsed != null ? String(parsed) : "");
        setSaved(true);
        onSaved?.(parsed);
        window.setTimeout(() => setSaved(false), 1400);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`stock-inline-editor${variant === "purchase" ? " stock-inline-editor--purchase" : ""}`}>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        placeholder="—"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
        }}
        aria-label={field === "price" ? "Цена продажи" : "Закупочная цена"}
      />
      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        title={field === "price" ? "Сохранить цену продажи" : "Сохранить закупочную цену"}
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
