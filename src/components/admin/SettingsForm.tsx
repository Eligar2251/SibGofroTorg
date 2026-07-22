// =========================================================
// FILE: src/components/admin/SettingsForm.tsx
// =========================================================

"use client";

import { useState } from "react";
import { Save, Loader2, CheckCircle } from "lucide-react";
import {
  WASTEPAPER_RATE_IDS,
  WASTEPAPER_RATE_DEFAULTS,
  wpRateSettingKey,
  type WastepaperRateId,
} from "@/lib/wastepaper";

interface SettingsFormProps {
  settings: Record<string, string>;
}

const contactFields = [
  { key: "phone", label: "Телефон", type: "text" },
  { key: "address", label: "Адрес", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "working_hours", label: "Режим работы", type: "text" },
];

/** Настройки доставки (отображаются в корзине при оформлении) */
const deliveryFields = [
  {
    key: "delivery_price",
    label: "Стоимость доставки (₽)",
    type: "number",
    hint: "Сколько стоит доставка курьером",
  },
  {
    key: "free_delivery_threshold",
    label: "Бесплатная доставка от (₽)",
    type: "number",
    hint: "При сумме заказа от этого значения доставка бесплатная",
  },
];

/** Виды макулатуры, цены на которые редактируются в этом блоке */
const wastepaperFields: { id: WastepaperRateId; label: string }[] = [
  { id: "cardboard", label: "Гофрокартон" },
  { id: "office_paper", label: "Белая бумага (архив)" },
  { id: "books", label: "Книги, журналы, газеты" },
  { id: "mix", label: "Смешанная макулатура" },
];

export function SettingsForm({ settings }: SettingsFormProps) {
  // Цены макулатуры: если в настройках ещё пусто — подставляем дефолты,
  // чтобы админ сразу видел действующие значения, а не пустые поля
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {
      delivery_price: "800",
      free_delivery_threshold: "30000",
    };
    for (const id of WASTEPAPER_RATE_IDS) {
      defaults[wpRateSettingKey(id)] = String(WASTEPAPER_RATE_DEFAULTS[id]);
    }
    return { ...defaults, ...settings };
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error(err);
    }

    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="admin-form admin-stack--lg">
      <div className="admin-card">
        <div className="admin-card__pad">
          <h2 className="admin-h2">Контактная информация</h2>
          <div className="admin-stack">
            {contactFields.map((field) => (
              <div key={field.key} className="admin-field">
                <label className="admin-label">{field.label}</label>
                <input
                  type={field.type}
                  value={values[field.key] || ""}
                  onChange={(e) =>
                    setValues({ ...values, [field.key]: e.target.value })
                  }
                  className="admin-input"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__pad">
          <h2 className="admin-h2">Доставка</h2>
          <div className="admin-stack">
            <div className="admin-grid-2">
              {deliveryFields.map((field) => (
                <div key={field.key} className="admin-field">
                  <label className="admin-label">{field.label}</label>
                  <input
                    type={field.type}
                    min={0}
                    value={values[field.key] || ""}
                    onChange={(e) =>
                      setValues({ ...values, [field.key]: e.target.value })
                    }
                    className="admin-input"
                  />
                  {field.hint && (
                    <span className="admin-hint">{field.hint}</span>
                  )}
                </div>
              ))}
            </div>
            <p className="admin-hint">
              Эти значения показываются покупателю в корзине при оформлении
              заказа.
            </p>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__pad">
          <h2 className="admin-h2">Цены на макулатуру (₽/кг)</h2>
          <div className="admin-stack">
            <div className="admin-grid-2">
              {wastepaperFields.map((field) => {
                const key = wpRateSettingKey(field.id);
                return (
                  <div key={field.id} className="admin-field">
                    <label className="admin-label">{field.label}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={values[key] ?? ""}
                      onChange={(e) =>
                        setValues({ ...values, [key]: e.target.value })
                      }
                      className="admin-input"
                    />
                  </div>
                );
              })}
            </div>
            <p className="admin-hint">
              Эти цены показываются на главной странице и на странице «Приём
              макулатуры» (в тарифах и калькуляторе). Изменения применяются
              сразу после сохранения.
            </p>
          </div>
        </div>
      </div>

      <div className="admin-row">
        <button
          type="submit"
          disabled={saving}
          className="admin-btn admin-btn--primary"
        >
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Сохранение...
            </>
          ) : (
            <>
              <Save size={16} /> Сохранить
            </>
          )}
        </button>
        {saved && (
          <span className="admin-success">
            <CheckCircle size={16} /> Сохранено!
          </span>
        )}
      </div>
    </form>
  );
}