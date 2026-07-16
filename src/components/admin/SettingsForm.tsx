// =========================================================
// FILE: src/components/admin/SettingsForm.tsx
// =========================================================

"use client";

import { useState } from "react";
import { Save, Loader2, CheckCircle } from "lucide-react";

interface SettingsFormProps {
  settings: Record<string, string>;
}

const contactFields = [
  { key: "phone", label: "Телефон", type: "text" },
  { key: "address", label: "Адрес", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "working_hours", label: "Режим работы", type: "text" },
  {
    key: "free_delivery_threshold",
    label: "Порог бесплатной доставки (₽)",
    type: "number",
  },
];

const botFields = [
  { key: "telegram_bot_token", label: "Telegram Bot Token", type: "password" },
  {
    key: "telegram_admin_chat_id",
    label: "Telegram Chat ID администратора",
    type: "text",
  },
  { key: "max_bot_token", label: "Макс Bot Token", type: "password" },
  {
    key: "max_admin_chat_id",
    label: "Макс Chat ID администратора",
    type: "text",
  },
];

export function SettingsForm({ settings }: SettingsFormProps) {
  const [values, setValues] = useState(settings);
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
          <h2 className="admin-h2">Интеграции (Боты)</h2>
          <div className="admin-stack">
            {botFields.map((field) => (
              <div key={field.key} className="admin-field">
                <label className="admin-label">{field.label}</label>
                <input
                  type={field.type}
                  value={values[field.key] || ""}
                  onChange={(e) =>
                    setValues({ ...values, [field.key]: e.target.value })
                  }
                  className="admin-input admin-mono"
                  style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                />
              </div>
            ))}
            <p className="admin-hint">
              Токены ботов и Chat ID нужны для уведомлений о новых заявках.
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