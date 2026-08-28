// =========================================================
// FILE: src/components/admin/SettingsForm.tsx
// Настройки сайта — секции вынесены в табы. Логи — отдельной вкладкой.
// =========================================================

"use client";

import { useEffect, useState } from "react";
import {
  Save,
  Loader2,
  CheckCircle,
  Send,
  MessageCircle,
  AlertTriangle,
  Bot,
  RefreshCw,
  History,
  Phone,
  Recycle,
  UserPlus,
  Truck,
  Tags,
  Wallet,
  FileText,
  ListChecks,
  Contact,
} from "lucide-react";
import { ImageUploader } from "@/components/admin/ImageUploader";
import { ActivityLogs } from "@/components/admin/ActivityLogs";
import { BusinessCardPrint } from "@/components/admin/BusinessCardPrint";
import {
  CASH_CARD_HOLDER_SETTING_KEY,
  DEFAULT_CASH_CARD_HOLDER,
} from "@/lib/warehouse-shared";
import {
  WASTEPAPER_RATE_IDS,
  WASTEPAPER_RATE_DEFAULTS,
  WASTEPAPER_SELF_BONUS,
  WASTEPAPER_PICKUP_MIN_KG,
  WASTEPAPER_ACCEPT_DEFAULTS,
  WP_PICKUP_MIN_SETTING_KEY,
  WP_SELF_BONUS_SETTING_KEY,
  WP_PICKUP_PRICE_SETTING_KEY,
  WP_ACCEPT_LIST_SETTING_KEY,
  WP_PHONE_SETTING_KEY,
  WASTEPAPER_PHONE_DEFAULT,
  wpRateSettingKey,
  type WastepaperRateId,
} from "@/lib/wastepaper";
import {
  PRIVACY_POLICY_SETTING_KEY,
  DEFAULT_PRIVACY_POLICY_TEXT,
} from "@/lib/privacy";
import { invalidateSiteSettingsCache } from "@/hooks/use-site-settings";
import {
  SITE_PHONE,
  SITE_ADDRESS,
  SITE_EMAIL,
  SITE_HOURS_LABEL,
  COMPANY_LEGAL_NAME,
  COMPANY_INN,
} from "@/lib/site-config";
import { SITE_NAME, SITE_URL } from "@/lib/seo";

interface SettingsFormProps {
  settings: Record<string, string>;
  adminPath: string;
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

type TabId =
  | "contacts"
  | "wastepaper"
  | "card"
  | "registration"
  | "delivery"
  | "prices"
  | "cash"
  | "messenger"
  | "notifications"
  | "privacy"
  | "logs";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "contacts", label: "Контакты", icon: <Phone size={14} /> },
  { id: "wastepaper", label: "Макулатура", icon: <Recycle size={14} /> },
  { id: "card", label: "Визитка A4", icon: <Contact size={14} /> },
  { id: "registration", label: "Регистрация", icon: <UserPlus size={14} /> },
  { id: "delivery", label: "Доставка", icon: <Truck size={14} /> },
  { id: "prices", label: "Цены и касса", icon: <Tags size={14} /> },
  { id: "cash", label: "Сдача кассы", icon: <Wallet size={14} /> },
  { id: "messenger", label: "Мессенджеры", icon: <MessageCircle size={14} /> },
  { id: "notifications", label: "Уведомления", icon: <Bot size={14} /> },
  { id: "privacy", label: "Политика", icon: <FileText size={14} /> },
  { id: "logs", label: "Логи", icon: <ListChecks size={14} /> },
];

export function SettingsForm({ settings, adminPath }: SettingsFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {
      delivery_price: "800",
      free_delivery_threshold: "30000",
      registration_contact_field: "phone",
      messenger_banner_enabled: "true",
      messenger_banner_text: "Мы есть в мессенджерах",
      messenger_banner_color: "#1b2b4b",
      [CASH_CARD_HOLDER_SETTING_KEY]: DEFAULT_CASH_CARD_HOLDER,
    };
    for (const id of WASTEPAPER_RATE_IDS) {
      defaults[wpRateSettingKey(id)] = String(WASTEPAPER_RATE_DEFAULTS[id]);
    }
    defaults[WP_PICKUP_MIN_SETTING_KEY] = String(WASTEPAPER_PICKUP_MIN_KG);
    defaults[WP_SELF_BONUS_SETTING_KEY] = String(WASTEPAPER_SELF_BONUS);
    defaults[WP_PICKUP_PRICE_SETTING_KEY] = "0";
    defaults[WP_ACCEPT_LIST_SETTING_KEY] = WASTEPAPER_ACCEPT_DEFAULTS.join("\n");
    defaults[WP_PHONE_SETTING_KEY] = WASTEPAPER_PHONE_DEFAULT;
    return { ...defaults, ...settings };
  });
  const [activeTab, setActiveTab] = useState<TabId>("contacts");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingMax, setTestingMax] = useState(false);
  const [maxResult, setMaxResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [notifyLog, setNotifyLog] = useState<
    { at: string; channel: "max"; label: string; ok: boolean; error?: string }[] | null
  >(null);
  const [notifyLogLoading, setNotifyLogLoading] = useState(false);

  const [maxDiag, setMaxDiag] = useState<null | {
    configured: boolean;
    tokenSource: string;
    tokenMasked: string | null;
    chatIdMasked: string | null;
  }>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  async function loadMaxDiag() {
    setDiagLoading(true);
    try {
      const res = await fetch("/api/admin/settings/test-max", { cache: "no-store" });
      if (res.ok) {
        setMaxDiag(await res.json());
      }
    } catch {
      /* диагностика — вспомогательная, молча оставляем прошлое состояние */
    } finally {
      setDiagLoading(false);
    }
  }

  useEffect(() => {
    loadMaxDiag();
    loadNotifyLog();
  }, []);

  async function testMax() {
    setTestingMax(true);
    setMaxResult(null);
    try {
      const res = await fetch("/api/admin/settings/test-max", {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) setMaxResult({ ok: true });
      else
        setMaxResult({
          ok: false,
          error: body.error || "Не удалось отправить тестовое сообщение MAX",
        });
      loadMaxDiag();
      loadNotifyLog();
    } catch {
      setMaxResult({ ok: false, error: "Сетевая ошибка" });
    } finally {
      setTestingMax(false);
    }
  }

  async function loadNotifyLog() {
    setNotifyLogLoading(true);
    try {
      const res = await fetch("/api/admin/settings/notify-log", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setNotifyLog(Array.isArray(body.entries) ? body.entries : []);
      else setNotifyLog([]);
    } catch {
      setNotifyLog([]);
    } finally {
      setNotifyLogLoading(false);
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
      ? [{ url, publicId: values[`messenger_${id}_icon_public_id`] || "" }]
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

  const authFieldOptions = [
    { value: "phone", label: "Телефон (как сейчас)" },
    { value: "email", label: "Email (для 152-ФЗ, корпоративная почта)" },
  ] as const;

  const cardStyle = { height: "100%", minWidth: 0 } as const;
  const cardPadStyle = {
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
    minWidth: 0,
  };

  const isLogsTab = activeTab === "logs";
  const isCardTab = activeTab === "card";
  /** Вкладки без сетки 2-колонок и без кнопки «Сохранить» внизу */
  const isStandaloneTab = isLogsTab || isCardTab;

  const hoursRaw = (values.working_hours || "").trim();
  const hoursLabel = (() => {
    if (!hoursRaw) return SITE_HOURS_LABEL;
    if (/пн|сб|выходн/i.test(hoursRaw)) return hoursRaw;
    return `Пн–Пт ${hoursRaw} · Сб, Вс — выходные`;
  })();

  const businessCardData = {
    companyName: SITE_NAME,
    tagline: "Гофротара · Упаковка · Макулатура",
    siteUrl: SITE_URL,
    phoneSales: (values.phone || SITE_PHONE || "").trim() || SITE_PHONE,
    phoneWastepaper:
      (values[WP_PHONE_SETTING_KEY] || WASTEPAPER_PHONE_DEFAULT || "").trim() ||
      WASTEPAPER_PHONE_DEFAULT,
    email: (values.email || SITE_EMAIL || "").trim() || SITE_EMAIL,
    address: (values.address || SITE_ADDRESS || "").trim() || SITE_ADDRESS,
    hours: hoursLabel,
    legalName: COMPANY_LEGAL_NAME,
    inn: COMPANY_INN,
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="admin-form admin-stack--lg"
      style={{ width: "100%", maxWidth: "none" }}
    >
      {/* ── Табы секций ── */}
      <div className="settings-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`settings-tab${activeTab === tab.id ? " settings-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Содержимое секций ── */}
      {!isStandaloneTab && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 16,
            alignItems: "stretch",
          }}
          className="settings-main-grid"
        >
          {activeTab === "contacts" && (
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
          )}

          {activeTab === "wastepaper" && (
            <>
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
                  <h2 className="admin-h2" style={{ margin: 0 }}>Контакты отдела макулатуры</h2>
                  <div className="admin-field">
                    <label className="admin-label">Телефон макулатуры</label>
                    <input
                      type="text"
                      value={values[WP_PHONE_SETTING_KEY] || ""}
                      onChange={(e) =>
                        setValues({
                          ...values,
                          [WP_PHONE_SETTING_KEY]: e.target.value,
                        })
                      }
                      className="admin-input"
                      placeholder={WASTEPAPER_PHONE_DEFAULT}
                    />
                    <span className="admin-hint">
                      Этот номер показывается в блоке «Принимаем макулатуру» на
                      главной и на странице «Приём макулатуры». Номер гофротары
                      (шапка, левая часть героя, контакты) задаётся во вкладке
                      «Контакты».
                    </span>
                  </div>
                  <div className="admin-grid-2" style={{ minWidth: 0 }}>
                    <div className="admin-field">
                      <label className="admin-label">Мин. вес вывоза, кг</label>
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={values[WP_PICKUP_MIN_SETTING_KEY] ?? ""}
                        onChange={(e) =>
                          setValues({
                            ...values,
                            [WP_PICKUP_MIN_SETTING_KEY]: e.target.value,
                          })
                        }
                        className="admin-input"
                      />
                    </div>
                    <div className="admin-field">
                      <label className="admin-label">Цена вывоза, ₽</label>
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={values[WP_PICKUP_PRICE_SETTING_KEY] ?? ""}
                        onChange={(e) =>
                          setValues({
                            ...values,
                            [WP_PICKUP_PRICE_SETTING_KEY]: e.target.value,
                          })
                        }
                        className="admin-input"
                      />
                    </div>
                    <div className="admin-field">
                      <label className="admin-label">Надбавка самовывоз, ₽/кг</label>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={values[WP_SELF_BONUS_SETTING_KEY] ?? ""}
                        onChange={(e) =>
                          setValues({
                            ...values,
                            [WP_SELF_BONUS_SETTING_KEY]: e.target.value,
                          })
                        }
                        className="admin-input"
                      />
                    </div>
                  </div>
                  <div className="admin-field">
                    <label className="admin-label">Что принимаем (по строке)</label>
                    <textarea
                      className="admin-textarea"
                      rows={6}
                      value={values[WP_ACCEPT_LIST_SETTING_KEY] ?? ""}
                      onChange={(e) =>
                        setValues({
                          ...values,
                          [WP_ACCEPT_LIST_SETTING_KEY]: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === "registration" && (
            <div className="admin-card" style={cardStyle}>
              <div className="admin-card__pad" style={cardPadStyle}>
                <h2 className="admin-h2" style={{ margin: 0 }}>Регистрация на сайте (152-ФЗ)</h2>
                <div className="admin-field">
                  <label className="admin-label">Чем регистрироваться?</label>
                  <select
                    className="admin-select"
                    value={values.registration_contact_field || "phone"}
                    onChange={(e) => setValues({ ...values, registration_contact_field: e.target.value })}
                  >
                    {authFieldOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <span className="admin-hint">
                    Телефон — старый вариант. Email — для 152-ФЗ: корпоративная обезличенная почта (info@, zakaz@) не считается ПД. Можно вернуть телефон одной кнопкой, переключив обратно.
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={`admin-btn ${ (values.registration_contact_field || "phone") === "phone" ? "admin-btn--primary" : "admin-btn--ghost"}`}
                    onClick={() => setValues({ ...values, registration_contact_field: "phone" })}
                  >
                    📞 Телефон
                  </button>
                  <button
                    type="button"
                    className={`admin-btn ${ (values.registration_contact_field || "phone") === "email" ? "admin-btn--primary" : "admin-btn--ghost"}`}
                    onClick={() => setValues({ ...values, registration_contact_field: "email" })}
                  >
                    ✉️ Email
                  </button>
                </div>
                <p className="admin-hint" style={{ marginTop: "auto" }}>
                  При Email: формы входа/регистрации просят корпоративный email, а не телефон. Логика входа поддерживает оба варианта, старые пользователи по телефону продолжат входить. Чекбокс согласия и политика конфиденциальности обязательны.
                </p>
              </div>
            </div>
          )}

          {activeTab === "delivery" && (
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
                      {field.hint && <span className="admin-hint">{field.hint}</span>}
                    </div>
                  ))}
                </div>
                <p className="admin-hint" style={{ marginTop: "auto" }}>
                  Эти значения показываются покупателю в корзине при оформлении
                  заказа.
                </p>
              </div>
            </div>
          )}

          {activeTab === "prices" && (
            <div className="admin-card" style={cardStyle}>
              <div className="admin-card__pad" style={cardPadStyle}>
                <h2 className="admin-h2" style={{ margin: 0 }}>Варианты цен (скидки контрагентов)</h2>
                <div className="admin-grid-2" style={{ minWidth: 0 }}>
                  <div className="admin-field">
                    <label className="admin-label">Спеццена, скидка %</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={values["price_tier_special_discount"] ?? ""}
                      placeholder="5"
                      onChange={(e) =>
                        setValues({ ...values, price_tier_special_discount: e.target.value })
                      }
                      className="admin-input"
                    />
                  </div>
                  <div className="admin-field">
                    <label className="admin-label">Эксклюзивная цена, скидка %</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={values["price_tier_exclusive_discount"] ?? ""}
                      placeholder="10"
                      onChange={(e) =>
                        setValues({ ...values, price_tier_exclusive_discount: e.target.value })
                      }
                      className="admin-input"
                    />
                  </div>
                </div>
                <p className="admin-hint" style={{ marginTop: "auto" }}>
                  Три уровня цен контрагентов: «Обычная» (без скидки, у всех по
                  умолчанию), «Спеццена» и «Эксклюзивная». Уровень выбирается в
                  карточке контрагента (Учёт → Контрагенты). При оформлении заказа
                  цена товара подставляется автоматически со скидкой уровня.
                  Пустые поля = 5% и 10%.
                </p>
              </div>
            </div>
          )}

          {activeTab === "cash" && (
            <div className="admin-card" style={cardStyle}>
              <div className="admin-card__pad" style={cardPadStyle}>
                <h2 className="admin-h2" style={{ margin: 0 }}>Сдача кассы</h2>
                <div className="admin-field">
                  <label className="admin-label">Получатель перевода на карту</label>
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
                  В сводке смены наличная касса и карта ЮМ учитываются раздельно:
                  с поступлениями и расходами каждой. Сохранение ничего не списывает.
                </p>
              </div>
            </div>
          )}

          {activeTab === "messenger" && (
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
          )}

          {activeTab === "notifications" && (
            <div className="admin-card" style={cardStyle}>
              <div className="admin-card__pad" style={cardPadStyle}>
                <h2 className="admin-h2" style={{ margin: 0 }}>Уведомления о заявках (MAX)</h2>
                <div style={{ color: "var(--adm-muted)", fontSize: 13, overflowWrap: "anywhere" }}>
                  Сюда приходят новые заявки с сайта. Бот берёт токен и chat_id из
                  переменных окружения <code>MAX_BOT_TOKEN</code> и{" "}
                  <code>MAX_ADMIN_CHAT_ID</code>; если их нет — используются поля
                  ниже (хранятся в настройках сайта). Переменные окружения имеют приоритет.
                </div>
                <div style={{ color: "var(--adm-muted)", fontSize: 12.5, overflowWrap: "anywhere" }}>
                  Telegram отключён: с серверов в РФ <code>api.telegram.org</code> недоступен,
                  а отправка через зарубежный релей означала бы передачу имён и телефонов
                  клиентов за границу. MAX работает из РФ напрямую. Заявки в любом случае
                  видны в панели — колокольчик со звуком срабатывает мгновенно.
                </div>

                <div
                  style={{
                    marginTop: 10,
                    border: "1px solid rgba(200,196,188,0.5)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 13,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Bot size={15} /> Состояние подключения
                    </strong>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={loadMaxDiag}
                      disabled={diagLoading}
                      title="Обновить диагностику"
                    >
                      {diagLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    </button>
                  </div>
                  {!maxDiag && !diagLoading && (
                    <span style={{ color: "var(--adm-muted)" }}>Нет данных — нажмите «Обновить».</span>
                  )}
                  {diagLoading && !maxDiag && (
                    <span style={{ color: "var(--adm-muted)" }}>Проверяем…</span>
                  )}
                  {maxDiag && (
                    <>
                      <span>
                        Токен:{" "}
                        {maxDiag.tokenMasked ? (
                          <>
                            <b>{maxDiag.tokenMasked}</b>{" "}
                            <span style={{ color: "var(--adm-muted)" }}>(переменные окружения)</span>
                          </>
                        ) : (
                          <span style={{ color: "var(--adm-muted)" }}>
                            не задан в переменных окружения — берётся из настроек ниже
                          </span>
                        )}
                      </span>
                      <span>
                        Chat ID:{" "}
                        {maxDiag.chatIdMasked ? (
                          <b>{maxDiag.chatIdMasked}</b>
                        ) : (
                          <span style={{ color: "var(--adm-muted)" }}>
                            не задан в переменных окружения — берётся из настроек ниже
                          </span>
                        )}
                      </span>
                      <span style={{ color: "var(--adm-kraft)", display: "inline-flex", gap: 6 }}>
                        <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                        Точная проверка — кнопкой «Проверить MAX»: она реально отправляет сообщение.
                      </span>
                    </>
                  )}
                </div>

                <div className="settings-messenger-grid" style={{ marginTop: 10 }}>
                  <div className="settings-messenger-item">
                    <strong>MAX-бот</strong>
                    <div className="admin-field">
                      <label className="admin-label">Токен бота</label>
                      <input
                        type="text"
                        className="admin-input"
                        value={values["max_bot_token"] || ""}
                        onChange={(e) =>
                          setValues({ ...values, max_bot_token: e.target.value.trim() })
                        }
                        placeholder="токен MAX-бота"
                        autoComplete="off"
                      />
                    </div>
                    <div className="admin-field">
                      <label className="admin-label">Chat ID получателя</label>
                      <input
                        type="text"
                        className="admin-input"
                        value={values["max_admin_chat_id"] || ""}
                        onChange={(e) =>
                          setValues({ ...values, max_admin_chat_id: e.target.value.trim() })
                        }
                        placeholder="id чата в MAX"
                        autoComplete="off"
                      />
                    </div>
                    <p className="admin-hint" style={{ margin: 0 }}>
                      Как настроить: в MAX напишите боту <code>@MasterBot</code> → создайте
                      бота → скопируйте токен сюда; затем напишите своему боту любое
                      сообщение и возьмите chat_id (например, через журнал отправок).
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: "auto" }}>
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary"
                    disabled={testingMax}
                    onClick={testMax}
                    title="Отправить тестовое сообщение через MAX"
                  >
                    {testingMax ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    Проверить MAX
                  </button>
                  {maxResult?.ok && (
                    <span className="admin-success">
                      <CheckCircle size={16} /> MAX отправил! Проверьте чат.
                    </span>
                  )}
                  {maxResult && !maxResult.ok && (
                    <span className="wh-form-error" style={{ marginTop: 0, maxWidth: "100%", overflowWrap: "anywhere" }}>
                      {maxResult.error}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "privacy" && (
            <div className="admin-card" style={{ gridColumn: "1 / -1" }}>
              <div className="admin-card__pad" style={cardPadStyle}>
                <h2 className="admin-h2" style={{ margin: 0 }}>Политика конфиденциальности</h2>
                <p className="admin-hint" style={{ margin: 0 }}>
                  Текст публикуется на странице <code>/privacy</code>. Поддерживается
                  Markdown: <code>## заголовок</code>, списки <code>-</code>, ссылки{" "}
                  <code>[текст](https://…)</code>. Реквизиты оператора (ИНН, ОГРН,
                  адрес, руководитель) подставляются на страницу автоматически и
                  здесь не редактируются.
                </p>
                <div className="admin-field">
                  <textarea
                    className="admin-textarea"
                    rows={22}
                    style={{ fontFamily: "var(--f-mono, monospace)", fontSize: 13, lineHeight: 1.5 }}
                    value={values[PRIVACY_POLICY_SETTING_KEY] ?? ""}
                    placeholder={DEFAULT_PRIVACY_POLICY_TEXT}
                    onChange={(e) =>
                      setValues({ ...values, [PRIVACY_POLICY_SETTING_KEY]: e.target.value })
                    }
                  />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    onClick={() =>
                      setValues({ ...values, [PRIVACY_POLICY_SETTING_KEY]: DEFAULT_PRIVACY_POLICY_TEXT })
                    }
                  >
                    Восстановить текст по умолчанию
                  </button>
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="admin-btn admin-btn--outline"
                  >
                    Открыть страницу /privacy
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Визитка A4 (отдельная вкладка) ── */}
      {isCardTab && (
        <div className="admin-stack--lg">
          <div className="admin-card">
            <div className="admin-card__pad" style={{ display: "grid", gap: 10 }}>
              <h2 className="admin-h2" style={{ margin: 0 }}>
                Вертикальная визитка / плакат A4
              </h2>
              <p className="admin-hint" style={{ margin: 0 }}>
                Чёрно-белая печать на лист A4 (книжная). Телефоны, адрес, сайт и
                режим работы берутся из вкладок «Контакты» и «Макулатура».
                Сохраните настройки там, если меняли номера — затем печатайте.
              </p>
            </div>
          </div>
          <BusinessCardPrint data={businessCardData} />
        </div>
      )}

      {/* ── Логи (отдельная вкладка) ── */}
      {isLogsTab && (
        <div className="admin-stack--lg">
          {/* Журнал отправок уведомлений */}
          <div className="admin-card">
            <div className="admin-card__head">
              <h3 className="admin-card__title">Журнал последних отправок</h3>
              <button
                type="button"
                className="admin-btn admin-btn--outline admin-btn--sm"
                onClick={loadNotifyLog}
                disabled={notifyLogLoading}
              >
                {notifyLogLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <History size={14} />
                )}
                Обновить
              </button>
            </div>
            <div className="admin-card__pad">
              <p className="admin-hint" style={{ margin: "0 0 8px" }}>
                Показаны последние отправки с момента перезапуска сервера. Если
                заказа здесь нет — значит сервер не пытался отправить уведомление
                по этому заказу; если есть ошибка — причина указана в строке.
              </p>
              {notifyLog === null ? (
                <span style={{ color: "var(--adm-muted)", fontSize: 12 }}>Загрузка…</span>
              ) : notifyLog.length === 0 ? (
                <span style={{ color: "var(--adm-muted)", fontSize: 12 }}>
                  Пока пусто: отправок ещё не было (или сервер перезапускался).
                  Нажмите «Проверить MAX», чтобы добавить запись.
                </span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {notifyLog.map((e, i) => (
                    <div
                      key={`${e.at}-${i}`}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "baseline",
                        gap: 8,
                        fontSize: 12,
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--adm-border)",
                        background: e.ok ? "var(--adm-pine-pale)" : "var(--adm-rust-pale)",
                      }}
                    >
                      <span style={{ color: "var(--adm-ink-muted)", whiteSpace: "nowrap" }}>
                        {new Date(e.at).toLocaleString("ru-RU")}
                      </span>
                      <b style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: "0.06em" }}>
                        MAX
                      </b>
                      <span style={{ color: "var(--adm-ink-soft)" }}>{e.label}</span>
                      {e.ok ? (
                        <b style={{ color: "var(--adm-pine)" }}>✓ отправлено</b>
                      ) : (
                        <b style={{ color: "var(--adm-rust)" }}>✗ не ушло</b>
                      )}
                      {e.error && (
                        <span style={{ color: "var(--adm-ink-muted)", overflowWrap: "anywhere" }}>
                          — {e.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Журнал действий администраторов */}
          <ActivityLogs adminPath={adminPath} />
        </div>
      )}

      {!isStandaloneTab && (
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
      )}

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
