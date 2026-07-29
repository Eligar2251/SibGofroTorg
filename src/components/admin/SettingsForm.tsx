// =========================================================
// FILE: src/components/admin/SettingsForm.tsx
// =========================================================

"use client";

import { useState } from "react";
import { Save, Loader2, CheckCircle, Send, MessageCircle } from "lucide-react";
import { ImageUploader } from "@/components/admin/ImageUploader";
import {
  CASH_CARD_HOLDER_SETTING_KEY,
  DEFAULT_CASH_CARD_HOLDER,
} from "@/lib/warehouse-shared";
import {
  WASTEPAPER_RATE_IDS,
  WASTEPAPER_RATE_DEFAULTS,
  wpRateSettingKey,
  type WastepaperRateId,
} from "@/lib/wastepaper";
import { invalidateSiteSettingsCache } from "@/hooks/use-site-settings";

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

const messengerFields = [
  { id: "telegram", label: "Telegram", placeholder: "https://t.me/username" },
  { id: "whatsapp", label: "WhatsApp", placeholder: "https://wa.me/79990000000" },
  { id: "max", label: "MAX", placeholder: "Ссылка на чат в MAX" },
] as const;

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
      messenger_banner_enabled: "true",
      messenger_banner_text: "Мы есть в мессенджерах",
      messenger_banner_color: "#1b2b4b",
      [CASH_CARD_HOLDER_SETTING_KEY]: DEFAULT_CASH_CARD_HOLDER,
    };
    for (const id of WASTEPAPER_RATE_IDS) {
      defaults[wpRateSettingKey(id)] = String(WASTEPAPER_RATE_DEFAULTS[id]);
    }
    return { ...defaults, ...settings };
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingTg, setTestingTg] = useState(false);
  const [tgResult, setTgResult] = useState<{ ok: boolean; error?: string } | null>(null);

  async function testTelegram() {
    setTestingTg(true);
    setTgResult(null);
    try {
      const res = await fetch("/api/admin/settings/test-telegram", {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) setTgResult({ ok: true });
      else
        setTgResult({
          ok: false,
          error: body.error || "Не удалось отправить тестовое сообщение",
        });
    } catch {
      setTgResult({ ok: false, error: "Сетевая ошибка" });
    } finally {
      setTestingTg(false);
    }
  }

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
        // Сбрасываем клиентский кеш публичных настроек (телефон/email/
        // адрес/часы), чтобы при следующем рендере Header, Footer,
        // страница контактов и success-страница сразу подхватили
        // новые значения без перезагрузки.
        invalidateSiteSettingsCache();
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error(err);
    }

    setSaving(false);
  }

  function messengerImages(id: (typeof messengerFields)[number]["id"]) {
    const url = values[`messenger_${id}_icon_url`] || "";
    return url
      ? [
          {
            url,
            publicId: values[`messenger_${id}_icon_public_id`] || "",
          },
        ]
      : [];
  }

  function setMessengerImages(
    id: (typeof messengerFields)[number]["id"],
    images: { url: string; publicId: string }[]
  ) {
    const image = images[images.length - 1];
    setValues((current) => ({
      ...current,
      [`messenger_${id}_icon_url`]: image?.url || "",
      [`messenger_${id}_icon_public_id`]: image?.publicId || "",
    }));
  }

  const cardStyle = { height: "100%", minWidth: 0 } as const;
  const cardPadStyle = {
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
    minWidth: 0,
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="admin-form admin-stack--lg"
      style={{ width: "100%", maxWidth: "none" }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 16,
          alignItems: "stretch",
        }}
        className="settings-main-grid"
      >
        <div className="admin-card" style={cardStyle}>
          <div className="admin-card__pad" style={cardPadStyle}>
            <h2 className="admin-h2" style={{ margin: 0 }}>Контактная информация</h2>
            <div className="admin-stack" style={{ minWidth: 0 }}>
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

        <div className="admin-card" style={cardStyle}>
          <div className="admin-card__pad" style={cardPadStyle}>
            <h2 className="admin-h2" style={{ margin: 0 }}>Цены на макулатуру (₽/кг)</h2>
            <div className="admin-grid-2" style={{ minWidth: 0 }}>
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
            <p className="admin-hint" style={{ marginTop: "auto" }}>
              Эти цены показываются на главной странице и на странице «Приём
              макулатуры» (в тарифах и калькуляторе).
            </p>
          </div>
        </div>

        <div className="admin-card" style={cardStyle}>
          <div className="admin-card__pad" style={cardPadStyle}>
            <h2 className="admin-h2" style={{ margin: 0 }}>Доставка</h2>
            <div className="admin-grid-2" style={{ minWidth: 0 }}>
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
            <p className="admin-hint" style={{ marginTop: "auto" }}>
              Эти значения показываются покупателю в корзине при оформлении
              заказа.
            </p>
          </div>
        </div>

        <div className="admin-card" style={cardStyle}>
          <div className="admin-card__pad" style={cardPadStyle}>
            <h2 className="admin-h2" style={{ margin: 0 }}>Сдача кассы</h2>
            <div className="admin-field">
              <label className="admin-label">Получатель инкассации на карту</label>
              <input
                type="text"
                value={values[CASH_CARD_HOLDER_SETTING_KEY] ?? ""}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [CASH_CARD_HOLDER_SETTING_KEY]: e.target.value,
                  })
                }
                className="admin-input"
                placeholder={DEFAULT_CASH_CARD_HOLDER}
              />
              <span className="admin-hint">
                Имя показывается при сдаче кассы у варианта «На карту».
              </span>
            </div>
            <p className="admin-hint" style={{ marginTop: "auto" }}>
              В сдачу кассы попадают только наличные платежи. Основной
              безналичный счёт в банке к кассе не относится и не затрагивается.
            </p>
          </div>
        </div>

        <div className="admin-card settings-messenger-card" style={cardStyle}>
          <div className="admin-card__pad" style={cardPadStyle}>
            <h2 className="admin-h2" style={{ margin: 0 }}>
              <MessageCircle size={16} /> Баннер мессенджеров
            </h2>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={values.messenger_banner_enabled !== "false"}
                onChange={(e) =>
                  setValues({
                    ...values,
                    messenger_banner_enabled: e.target.checked ? "true" : "false",
                  })
                }
              />
              <span>Показывать плавающий баннер на сайте</span>
            </label>
            <div className="admin-grid-2">
              <div className="admin-field">
                <label className="admin-label">Текст баннера</label>
                <input
                  className="admin-input"
                  value={values.messenger_banner_text || ""}
                  onChange={(e) =>
                    setValues({ ...values, messenger_banner_text: e.target.value })
                  }
                  placeholder="Мы есть в мессенджерах"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Цвет баннера</label>
                <div className="settings-color-control">
                  <input
                    type="color"
                    value={values.messenger_banner_color || "#1b2b4b"}
                    onChange={(e) =>
                      setValues({ ...values, messenger_banner_color: e.target.value })
                    }
                    aria-label="Выбрать цвет баннера"
                  />
                  <input
                    className="admin-input"
                    value={values.messenger_banner_color || ""}
                    onChange={(e) =>
                      setValues({ ...values, messenger_banner_color: e.target.value })
                    }
                    placeholder="#1b2b4b"
                    pattern="#[0-9A-Fa-f]{6}"
                  />
                </div>
              </div>
            </div>
            <div className="settings-messenger-grid">
              {messengerFields.map((messenger) => (
                <div key={messenger.id} className="settings-messenger-item">
                  <strong>{messenger.label}</strong>
                  <div className="admin-field">
                    <label className="admin-label">Ссылка на чат</label>
                    <input
                      type="url"
                      className="admin-input"
                      value={values[`messenger_${messenger.id}_url`] || ""}
                      onChange={(e) =>
                        setValues({
                          ...values,
                          [`messenger_${messenger.id}_url`]: e.target.value,
                        })
                      }
                      placeholder={messenger.placeholder}
                    />
                  </div>
                  <div className="admin-label">Иконка / фото</div>
                  <ImageUploader
                    images={messengerImages(messenger.id)}
                    onChange={(images) => setMessengerImages(messenger.id, images)}
                  />
                </div>
              ))}
            </div>
            <p className="admin-hint">
              На сайте появится небольшой фиксированный блок с тремя круглыми
              изображениями. Нажатие откроет соответствующий чат.
            </p>
          </div>
        </div>

        <div className="admin-card" style={cardStyle}>
          <div className="admin-card__pad" style={cardPadStyle}>
            <h2 className="admin-h2" style={{ margin: 0 }}>Проверка уведомлений</h2>
            <div style={{ color: "var(--adm-muted)", fontSize: 13, overflowWrap: "anywhere" }}>
              Бот берёт токен и chat_id из переменных окружения{" "}
              <code>TELEGRAM_BOT_TOKEN</code> и{" "}
              <code>TELEGRAM_ADMIN_CHAT_ID</code>. Если уведомления перестали
              приходить — нажмите кнопку, чтобы проверить подключение.
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: "auto" }}>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                disabled={testingTg}
                onClick={testTelegram}
              >
                {testingTg ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Проверить Telegram
              </button>
              {tgResult?.ok && (
                <span className="admin-success">
                  <CheckCircle size={16} /> Отправлено! Проверьте чат.
                </span>
              )}
              {tgResult && !tgResult.ok && (
                <span className="wh-form-error" style={{ marginTop: 0, maxWidth: "100%", overflowWrap: "anywhere" }}>
                  {tgResult.error}
                </span>
              )}
            </div>
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

      <style jsx>{`
        @media (max-width: 900px) {
          .settings-main-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </form>
  );
}
