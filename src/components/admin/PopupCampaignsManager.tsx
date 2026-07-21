"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BellRing,
  CircleAlert,
  Edit2,
  Eye,
  Gift,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
  ImageIcon,
  Layout,
} from "lucide-react";
import { ImageUploader } from "@/components/admin/ImageUploader";
import type {
  PopupCampaign,
  PopupCampaignFrequency,
  PopupCampaignStyle,
} from "@/lib/types";

type Campaign = Omit<PopupCampaign, "createdAt" | "updatedAt">;

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

const SITE_PAGES = [
  { value: "/", label: "Главная" },
  { value: "/catalog", label: "Каталог" },
  { value: "/order", label: "Корзина / оформление заказа" },
  { value: "/delivery", label: "Доставка и оплата" },
  { value: "/contacts", label: "Контакты" },
  { value: "/about", label: "О компании" },
  { value: "/wastepaper", label: "Приём макулатуры" },
  { value: "/cabinet", label: "Личный кабинет" },
];

const EMPTY = {
  title: "",
  kicker: "Важная информация",
  description: "",
  details: "",
  imageUrl: "",
  buttonText: "Подробнее",
  buttonUrl: "",
  style: "info" as PopupCampaignStyle,
  isActive: true,
  startAt: "",
  endAt: "",
  delaySeconds: 3,
  durationSeconds: 20,
  frequency: "session" as PopupCampaignFrequency,
  sortOrder: 0,
  // New fields
  isProductType: false,
  isStoryType: false,
  discountPercent: 0,
  stockLevel: 30,
  tags: "",
  oldPrice: 0,
  newPrice: 0,
  timerSeconds: 0,
};

export function PopupCampaignsManager({
  initialCampaigns,
}: {
  initialCampaigns: Campaign[];
}) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [activeView, setActiveView] = useState<"standard" | "story">("standard");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [form, setForm] = useState(EMPTY);

  function update<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function beginCreate() {
    setForm({ ...EMPTY, sortOrder: campaigns.length });
    setEditingId(null);
    setCreating(true);
    setError("");
  }

  function beginEdit(item: Campaign) {
    setForm({
      title: item.title,
      kicker: item.kicker || "",
      description: item.description || "",
      details: item.details || "",
      imageUrl: item.imageUrl || "",
      buttonText: item.buttonText || "",
      buttonUrl: item.buttonUrl || "",
      style: item.style,
      isActive: item.isActive,
      startAt: toDateTimeLocal(item.startAt),
      endAt: toDateTimeLocal(item.endAt),
      delaySeconds: item.delaySeconds,
      durationSeconds: item.durationSeconds,
      frequency: item.frequency,
      sortOrder: item.sortOrder,
      isProductType: !!item.isProductType,
      isStoryType: !!item.isStoryType,
      discountPercent: item.discountPercent || 0,
      stockLevel: item.stockLevel || 30,
      tags: item.tags || "",
      oldPrice: item.oldPrice || 0,
      newPrice: item.newPrice || 0,
      timerSeconds: item.timerSeconds || 0,
    });
    setEditingId(item.id);
    setCreating(false);
    setError("");
  }

  function closeForm() {
    setCreating(false);
    setEditingId(null);
    setPreview(false);
    setError("");
  }

  function payload() {
    return {
      ...form,
      title: form.title.trim(),
      kicker: form.kicker.trim() || null,
      description: form.description.trim() || null,
      details: form.details.trim() || null,
      imageUrl: form.imageUrl || null,
      buttonText: form.buttonText.trim() || null,
      buttonUrl: form.buttonUrl.trim() || null,
      startAt: toIso(form.startAt),
      endAt: toIso(form.endAt),
      delaySeconds: Math.max(0, Number(form.delaySeconds) || 0),
      durationSeconds: Math.min(
        600,
        Math.max(5, Number(form.durationSeconds) || 20)
      ),
      sortOrder: Number(form.sortOrder) || 0,
      isProductType: !!form.isProductType,
      isStoryType: !!form.isStoryType,
      discountPercent: Number(form.discountPercent) || 0,
      stockLevel: Number(form.stockLevel) || 0,
      oldPrice: Number(form.oldPrice) || 0,
      newPrice: Number(form.newPrice) || 0,
      timerSeconds: Number(form.timerSeconds) || 0,
    };
  }

  async function save() {
    if (!form.title.trim()) {
      setError("Укажите заголовок окна");
      return;
    }
    const data = payload();
    setSaving(true);
    setError("");
    try {
      const url = editingId ? `/api/admin/popups/${editingId}` : "/api/admin/popups";
      const response = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить окно");
      if (editingId) {
        setCampaigns((items) =>
          items.map((item) =>
            item.id === editingId ? ({ ...item, ...data } as Campaign) : item
          )
        );
      } else {
        setCampaigns((items) => [
          ...items,
          { id: body.id, ...data } as Campaign,
        ]);
      }
      closeForm();
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить информационное окно?")) return;
    const response = await fetch(`/api/admin/popups/${id}`, { method: "DELETE" });
    if (response.ok) {
      setCampaigns((items) => items.filter((item) => item.id !== id));
      router.refresh();
    }
  }

  const StyleIcon =
    form.style === "promo" ? Gift : form.style === "important" ? CircleAlert : BellRing;
  const points = form.details.split("\n").filter((item) => item.trim());
  const showEditor = creating || editingId !== null;

  const filteredCampaigns = campaigns.filter((item) =>
    activeView === "story" ? !!item.isStoryType : !item.isStoryType
  );

  return (
    <div className="admin-stack admin-stack--lg">
      <div className="popup-admin-intro">
        <div>
          <h2>Информационные окна сайта</h2>
          <p>
            Создавайте окна для объявлений, акций или важных уведомлений.
          </p>
        </div>
        {!showEditor && (
          <button
            className="admin-btn admin-btn--primary"
            onClick={() => {
              beginCreate();
              if (activeView === "story") update("isStoryType", true);
            }}
          >
            <Plus size={15} /> {activeView === "story" ? "Новая сторис" : "Новое окно"}
          </button>
        )}
      </div>

      <div className="admin-filters">
        <button
          className={`admin-filter${activeView === "standard" ? " admin-filter--active" : ""}`}
          onClick={() => setActiveView("standard")}
        >
          <Layout size={13} />
          Обычные окна
        </button>
        <button
          className={`admin-filter${activeView === "story" ? " admin-filter--active" : ""}`}
          onClick={() => setActiveView("story")}
        >
          <ImageIcon size={13} />
          Сторис (баннеры)
        </button>
      </div>

      {showEditor && (
        <div className="popup-admin-layout">
          <div className="admin-card popup-admin-form">
            <div className="admin-card__head">
              <h2 className="admin-card__title">
                {editingId ? "Редактирование окна" : "Новое информационное окно"}
              </h2>
              <button className="admin-modal__close" onClick={closeForm} aria-label="Закрыть">
                <X size={17} />
              </button>
            </div>
            <div className="admin-card__pad admin-stack">
              <div className="admin-grid-2">
                <div className="admin-field">
                  <label className="admin-label">Название в шапке окна</label>
                  <input className="admin-input" value={form.kicker} onChange={(e) => update("kicker", e.target.value)} placeholder="Важная информация" />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Тип оформления</label>
                  <select className="admin-select" value={form.style} onChange={(e) => update("style", e.target.value as PopupCampaignStyle)}>
                    <option value="info">Информация — зелёный</option>
                    <option value="promo">Предложение — янтарный</option>
                    <option value="important">Важно — красный</option>
                  </select>
                </div>
              </div>

              <div className="admin-field">
                <label className="admin-label">Главный заголовок *</label>
                <input className="admin-input" value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Изменение графика работы" />
              </div>
              <div className="admin-field">
                <label className="admin-label">Текст сообщения</label>
                <textarea className="admin-textarea" rows={4} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Полная информация для посетителя..." />
              </div>
              <div className="admin-field">
                <label className="admin-label">Пункты информации</label>
                <textarea className="admin-textarea" rows={3} value={form.details} onChange={(e) => update("details", e.target.value)} placeholder={"Каждый пункт с новой строки\nНапример: доставка работает без изменений"} />
              </div>

              <div className="admin-grid-2">
                <div className="admin-field">
                  <label className="admin-label">Текст кнопки</label>
                  <input className="admin-input" value={form.buttonText} onChange={(e) => update("buttonText", e.target.value)} placeholder="Подробнее" />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Выбрать страницу сайта</label>
                  <select
                    className="admin-select"
                    value={
                      SITE_PAGES.some((page) => page.value === form.buttonUrl)
                        ? form.buttonUrl
                        : ""
                    }
                    onChange={(e) => {
                      if (e.target.value) update("buttonUrl", e.target.value);
                    }}
                  >
                    <option value="">— Быстрый выбор страницы —</option>
                    {SITE_PAGES.map((page) => (
                      <option key={page.value} value={page.value}>
                        {page.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="admin-field">
                <label className="admin-label">
                  Ссылка вручную (можно указать внешний сайт)
                </label>
                <input
                  className="admin-input"
                  value={form.buttonUrl}
                  onChange={(e) => update("buttonUrl", e.target.value)}
                  placeholder="/catalog или https://другой-сайт.ru/..."
                />
                <span className="admin-hint">
                  Ручной ввод не ограничен страницами сайта и имеет приоритет.
                </span>
              </div>

              <div className="admin-field">
                <label className="admin-label">Изображение</label>
                <ImageUploader
                  images={form.imageUrl ? [{ url: form.imageUrl, publicId: "" }] : []}
                  onChange={(images) => update("imageUrl", images[0]?.url || "")}
                />
              </div>

              <div className="popup-admin-schedule" style={{ background: "var(--adm-paper-warm)", border: "1px solid var(--adm-border)" }}>
                <h3>Стиль окна</h3>
                <div className="admin-grid-2">
                  <label className="admin-check">
                    <input type="checkbox" checked={form.isProductType} onChange={(e) => {
                      update("isProductType", e.target.checked);
                      if (e.target.checked) update("isStoryType", false);
                    }} />
                    <span>Карточка товара</span>
                  </label>
                  <label className="admin-check">
                    <input type="checkbox" checked={form.isStoryType} onChange={(e) => {
                      update("isStoryType", e.target.checked);
                      if (e.target.checked) update("isProductType", false);
                    }} />
                    <span>Сторис (вертикальное фото)</span>
                  </label>
                </div>
                
                {form.isStoryType && (
                  <div className="admin-hint" style={{ marginBottom: 12 }}>
                    В этом режиме будет показано только фото. Весь попап будет кликабельным (ссылка задается ниже). Рекомендуемый размер: 1080x1920 (9:16).
                  </div>
                )}

                {form.isProductType && (
                  <div className="admin-stack">
                    <div className="admin-grid-3">
                      <div className="admin-field">
                        <label className="admin-label">Скидка, %</label>
                        <input type="number" className="admin-input" value={form.discountPercent} onChange={(e) => update("discountPercent", Number(e.target.value))} />
                      </div>
                      <div className="admin-field">
                        <label className="admin-label">Заполнение остатка, %</label>
                        <input type="number" min={0} max={100} className="admin-input" value={form.stockLevel} onChange={(e) => update("stockLevel", Number(e.target.value))} />
                      </div>
                      <div className="admin-field">
                        <label className="admin-label">Таймер, сек.</label>
                        <input type="number" className="admin-input" value={form.timerSeconds} onChange={(e) => update("timerSeconds", Number(e.target.value))} />
                      </div>
                    </div>
                    <div className="admin-field">
                      <label className="admin-label">Теги (через пробел)</label>
                      <input className="admin-input" value={form.tags} onChange={(e) => update("tags", e.target.value)} placeholder="новинка топ_продаж эко" />
                    </div>
                    <div className="admin-grid-2">
                      <div className="admin-field">
                        <label className="admin-label">Старая цена, ₽</label>
                        <input type="number" className="admin-input" value={form.oldPrice} onChange={(e) => update("oldPrice", Number(e.target.value))} />
                      </div>
                      <div className="admin-field">
                        <label className="admin-label">Новая цена, ₽</label>
                        <input type="number" className="admin-input" value={form.newPrice} onChange={(e) => update("newPrice", Number(e.target.value))} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="popup-admin-schedule">
                <h3>Расписание и частота</h3>
                <div className="admin-grid-2">
                  <div className="admin-field">
                    <label className="admin-label">Начало показа</label>
                    <input type="datetime-local" className="admin-input" value={form.startAt} onChange={(e) => update("startAt", e.target.value)} />
                  </div>
                  <div className="admin-field">
                    <label className="admin-label">Окончание показа</label>
                    <input type="datetime-local" className="admin-input" value={form.endAt} onChange={(e) => update("endAt", e.target.value)} />
                  </div>
                </div>
                <div className="admin-grid-3">
                  <div className="admin-field">
                    <label className="admin-label">Задержка, сек.</label>
                    <input type="number" min={0} max={3600} className="admin-input" value={form.delaySeconds} onChange={(e) => update("delaySeconds", Number(e.target.value))} />
                  </div>
                  <div className="admin-field">
                    <label className="admin-label">Длительность, сек.</label>
                    <input type="number" min={5} max={600} className="admin-input" value={form.durationSeconds} onChange={(e) => update("durationSeconds", Number(e.target.value))} />
                  </div>
                  <div className="admin-field">
                    <label className="admin-label">Повтор показа</label>
                    <select className="admin-select" value={form.frequency} onChange={(e) => update("frequency", e.target.value as PopupCampaignFrequency)}>
                      <option value="session">Один раз за сессию</option>
                      <option value="day">Один раз в день</option>
                      <option value="always">При каждом посещении</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="admin-grid-2">
                <label className="admin-check">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => update("isActive", e.target.checked)} />
                  <span>Окно активно</span>
                </label>
                <div className="admin-field">
                  <label className="admin-label">Порядок</label>
                  <input type="number" className="admin-input" value={form.sortOrder} onChange={(e) => update("sortOrder", Number(e.target.value))} />
                </div>
              </div>

              {error && <div className="admin-error">{error}</div>}
              <div className="popup-admin-actions">
                <button className="admin-btn admin-btn--ghost" onClick={() => setPreview((value) => !value)}>
                  <Eye size={15} /> {preview ? "Скрыть превью" : "Показать превью"}
                </button>
                <button className="admin-btn admin-btn--ghost" onClick={closeForm}>Отмена</button>
                <button className="admin-btn admin-btn--primary" disabled={saving} onClick={save}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Сохранить окно
                </button>
              </div>
            </div>
          </div>

          {preview && (
            form.isStoryType ? (
              <div className="story-popup" style={{ position: "sticky", top: 80, margin: "0 auto" }}>
                {form.imageUrl ? <img src={form.imageUrl} alt="" className="story-popup__img" /> : <div className="story-popup__img" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eee' }}>Нет фото</div>}
                <button type="button" className="story-popup__close"><X size={24} /></button>
              </div>
            ) : form.isProductType ? (
              <div className="product-popup" style={{ position: "sticky", top: 80, margin: "0 auto" }}>
                <div className="product-popup__media">
                  {form.imageUrl && <img src={form.imageUrl} alt="" className="product-popup__img" />}
                  <button type="button" className="product-popup__close"><X size={20} /></button>
                  <div className="product-popup__badges">
                    <span className="product-popup__badge product-popup__badge--stock">В наличии</span>
                    {form.discountPercent > 0 && <span className="product-popup__badge product-popup__badge--discount">−{form.discountPercent}%</span>}
                  </div>
                </div>
                <div className="product-popup__body">
                  <h2 className="product-popup__title">{form.title || "Название товара"}</h2>
                  {form.description && <p className="product-popup__subtitle">{form.description}</p>}
                  {form.tags && (
                    <div className="product-popup__tags">
                      {form.tags.split(" ").filter(Boolean).map((t, i) => <span key={i} className="product-popup__tag">{t}</span>)}
                    </div>
                  )}
                  <div className="product-popup__stock">
                    <div className="product-popup__stock-info"><span>Остаток</span><span className="product-popup__stock-warn">мало!</span></div>
                    <div className="product-popup__stock-bar"><div className="product-popup__stock-fill" style={{ width: `${form.stockLevel}%` }} /></div>
                  </div>
                  <div className="product-popup__price-row">
                    <div className="product-popup__prices">
                      {form.oldPrice > 0 && <span className="product-popup__price-old">{form.oldPrice.toLocaleString("ru-RU")} ₽</span>}
                      <span className="product-popup__price-new">{form.newPrice.toLocaleString("ru-RU")} ₽</span>
                    </div>
                    {form.timerSeconds > 0 && <div className="product-popup__timer">00:00:00</div>}
                  </div>
                  <div className="product-popup__actions">
                    <button className="product-popup__cta">{form.buttonText || "ПЕРЕЙТИ"} <ArrowRight size={18} /></button>
                    <button type="button" className="product-popup__dismiss">нет, спасибо</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`popup-admin-preview popup-admin-preview--${form.style}`}>
                <div className="popup-admin-preview__bar">
                  <StyleIcon size={15} /> {form.kicker || "Информация"}
                  <X size={15} />
                </div>
                {form.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.imageUrl} alt="" />
                )}
                <div className="popup-admin-preview__body" style={{ padding: '30px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, padding: '5px 12px', background: 'var(--paper)', color: 'var(--preview-accent)', borderRadius: '8px', textTransform: 'uppercase' }}>
                    <StyleIcon size={14} style={{ marginRight: 6, verticalAlign: -2 }} /> {form.kicker || "Объявление"}
                  </span>
                  <h3 style={{ fontSize: '28px', fontWeight: 850, marginTop: '20px', lineHeight: 1.1 }}>{form.title || "Заголовок информационного окна"}</h3>
                  <p style={{ fontSize: '15px', color: 'var(--adm-ink-muted)', lineHeight: 1.6, marginTop: '14px' }}>{form.description || "Здесь будет основной текст сообщения для посетителя."}</p>
                  {points.length > 0 && <ul style={{ marginTop: '20px', paddingLeft: '20px' }}>{points.map((point, index) => <li key={index} style={{ marginBottom: '6px' }}>{point}</li>)}</ul>}
                  {form.buttonUrl && <button style={{ marginTop: '26px', width: '100%', height: '50px', background: 'var(--preview-accent)', color: '#fff', border: 0, borderRadius: '12px', fontWeight: 750, fontSize: '15px' }}>{form.buttonText || "Подробнее"}</button>}
                </div>
              </div>
            )
          )}
        </div>
      )}

      <div className="popup-admin-list">
        {filteredCampaigns.length === 0 ? (
          <div className="admin-card admin-empty">
            <BellRing size={36} />
            <p>В этом разделе пока нет окон</p>
            <p className="admin-empty__hint">Создайте новое окно, используя кнопку выше.</p>
          </div>
        ) : (
          filteredCampaigns.map((item) => (
            <article key={item.id} className="popup-admin-item">
              <div className={`popup-admin-item__icon popup-admin-item__icon--${item.style}`}>
                {item.isStoryType ? <ImageIcon size={18} /> : (item.style === "promo" ? <Gift size={18} /> : item.style === "important" ? <CircleAlert size={18} /> : <BellRing size={18} />)}
              </div>
              <div className="popup-admin-item__main">
                <div className="popup-admin-item__title">{item.title}</div>
                <div className="popup-admin-item__meta">
                  {item.isStoryType ? "Тип: Сторис" : (item.kicker || "Информация")} · через {item.delaySeconds} сек. · на {item.durationSeconds} сек.
                  {item.startAt ? ` · с ${new Date(item.startAt).toLocaleString("ru-RU")}` : ""}
                </div>
              </div>
              <span className={`admin-badge ${item.isActive ? "admin-badge--green" : "admin-badge--muted"}`}>
                {item.isActive ? "Активно" : "Выключено"}
              </span>
              <div className="admin-actions">
                <button className="admin-btn admin-btn--icon" onClick={() => beginEdit(item)} title="Редактировать"><Edit2 size={14} /></button>
                <button className="admin-btn admin-btn--icon" onClick={() => remove(item.id)} title="Удалить"><Trash2 size={14} /></button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
