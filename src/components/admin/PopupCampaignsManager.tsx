"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
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
  Layout,
  ImageIcon,
  ArrowRight,
} from "lucide-react";
import { ImageUploader } from "@/components/admin/ImageUploader";
import type {
  PopupCampaign,
  PopupCampaignFrequency,
  PopupCampaignStyle,
  PopupCampaignType,
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

const EMPTY_BANNER: Campaign = {
  id: "",
  type: "banner",
  title: "",
  isActive: true,
  kicker: "Специальное предложение",
  description: "",
  details: "",
  buttonText: "Узнать больше",
  buttonUrl: "",
  style: "promo",
  startAt: "",
  endAt: "",
  delaySeconds: 3,
  durationSeconds: 20,
  frequency: "session",
  sortOrder: 0,
};

const EMPTY_STORY: Campaign = {
  id: "",
  type: "story",
  title: "",
  isActive: true,
  imageUrl: "",
  buttonUrl: "",
  startAt: "",
  endAt: "",
  delaySeconds: 3,
  durationSeconds: 20,
  frequency: "session",
  sortOrder: 0,
};

export function PopupCampaignsManager({
  initialCampaigns,
}: {
  initialCampaigns: Campaign[];
}) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [activeTab, setActiveTab] = useState<PopupCampaignType>("banner");
  const [editingItem, setEditingItem] = useState<Campaign | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);

  // Persistence for activeTab
  useEffect(() => {
    const saved = localStorage.getItem("sib-popup-active-tab");
    if (saved === "story" || saved === "banner") {
      setActiveTab(saved);
    }
  }, []);

  // Persistence for activeTab
  useEffect(() => {
    const saved = localStorage.getItem("sib-popup-active-tab");
    if (saved === "story" || saved === "banner") {
      setActiveTab(saved);
    }
  }, []);

  const handleTabChange = (tab: PopupCampaignType) => {
    setActiveTab(tab);
    localStorage.setItem("sib-popup-active-tab", tab);
  };

  const filteredList = campaigns.filter((c) => c.type === activeTab);

  function updateForm<K extends keyof Campaign>(key: K, value: Campaign[K]) {
    if (!editingItem) return;
    setEditingItem({ ...editingItem, [key]: value });
  }

  function startCreate() {
    setEditingItem(activeTab === "story" ? { ...EMPTY_STORY } : { ...EMPTY_BANNER });
    setError("");
  }

  async function save() {
    if (!editingItem) return;
    if (!editingItem.title.trim()) {
      setError("Укажите название (заголовок)");
      return;
    }
    if (editingItem.type === "story" && !editingItem.imageUrl) {
      setError("Загрузите изображение для сторис");
      return;
    }

    setSaving(true);
    setError("");
    
    const isNew = !editingItem.id;
    const url = isNew ? "/api/admin/popups" : `/api/admin/popups/${editingItem.id}`;
    const method = isNew ? "POST" : "PUT";
    
    const data = {
      ...editingItem,
      startAt: toIso(editingItem.startAt || ""),
      endAt: toIso(editingItem.endAt || ""),
    };

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Ошибка сохранения");
      
      setEditingItem(null);
      router.refresh();
      // Normally we'd fetch again or update local state, 
      // but router.refresh() handles Server Components data.
      window.location.reload(); 
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить это окно?")) return;
    try {
      const res = await fetch(`/api/admin/popups/${id}`, { method: "DELETE" });
      if (res.ok) window.location.reload();
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="admin-stack admin-stack--lg">
      <div className="popup-admin-intro">
        <div>
          <h2>Уведомления и Баннеры</h2>
          <p>Настройка всплывающих окон (попапов) для посетителей сайта.</p>
        </div>
        {!editingItem && (
          <button className="admin-btn admin-btn--primary" onClick={startCreate}>
            <Plus size={15} /> Создать {activeTab === "story" ? "Сторис" : "Баннер"}
          </button>
        )}
      </div>

      {!editingItem && (
        <div className="admin-filters">
          <button
            className={`admin-filter${activeTab === "banner" ? " admin-filter--active" : ""}`}
            onClick={() => handleTabChange("banner")}
          >
            <Layout size={13} /> Текстовые баннеры
          </button>
          <button
            className={`admin-filter${activeTab === "story" ? " admin-filter--active" : ""}`}
            onClick={() => handleTabChange("story")}
          >
            <ImageIcon size={13} /> Сторис (фото)
          </button>
        </div>
      )}

      {editingItem && (
        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">
              {editingItem.id ? "Редактирование" : "Создание"} {editingItem.type === "story" ? "сторис" : "баннера"}
            </h3>
            <button className="admin-modal__close" onClick={() => setEditingItem(null)}>
              <X size={18} />
            </button>
          </div>
          <div className="admin-card__pad admin-stack">
            <div className="admin-grid-2">
              <div className="admin-field">
                <label className="admin-label">Внутреннее название / Заголовок *</label>
                <input
                  className="admin-input"
                  value={editingItem.title}
                  onChange={(e) => updateForm("title", e.target.value)}
                  placeholder="Напр: Акция на гофрокартон"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Частота показа</label>
                <select
                  className="admin-select"
                  value={editingItem.frequency}
                  onChange={(e) => updateForm("frequency", e.target.value as any)}
                >
                  <option value="session">Раз в сессию (рекомендуется)</option>
                  <option value="day">Раз в день</option>
                  <option value="always">При каждом входе</option>
                </select>
              </div>
            </div>

            {editingItem.type === "banner" && (
              <>
                <div className="admin-grid-2">
                  <div className="admin-field">
                    <label className="admin-label">Метка (кикер)</label>
                    <input
                      className="admin-input"
                      value={editingItem.kicker || ""}
                      onChange={(e) => updateForm("kicker", e.target.value)}
                      placeholder="Напр: Только до 31 августа"
                    />
                  </div>
                  <div className="admin-field">
                    <label className="admin-label">Стиль (цвет)</label>
                    <select
                      className="admin-select"
                      value={editingItem.style}
                      onChange={(e) => updateForm("style", e.target.value as any)}
                    >
                      <option value="info">Информационный (зеленый)</option>
                      <option value="promo">Акционный (оранжевый)</option>
                      <option value="important">Важный (красный)</option>
                    </select>
                  </div>
                </div>
                <div className="admin-field">
                  <label className="admin-label">Описание</label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    value={editingItem.description || ""}
                    onChange={(e) => updateForm("description", e.target.value)}
                    placeholder="Основной текст предложения..."
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Пункты (список, каждый с новой строки)</label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    value={editingItem.details || ""}
                    onChange={(e) => updateForm("details", e.target.value)}
                    placeholder="Бесплатная доставка\nСкидка 10% от 100 шт..."
                  />
                </div>
                <div className="admin-grid-2">
                  <div className="admin-field">
                    <label className="admin-label">Текст кнопки</label>
                    <input
                      className="admin-input"
                      value={editingItem.buttonText || ""}
                      onChange={(e) => updateForm("buttonText", e.target.value)}
                    />
                  </div>
                  <div className="admin-field">
                    <label className="admin-label">Ссылка кнопки</label>
                    <input
                      className="admin-input"
                      value={editingItem.buttonUrl || ""}
                      onChange={(e) => updateForm("buttonUrl", e.target.value)}
                      placeholder="/catalog или https://..."
                    />
                  </div>
                </div>
              </>
            )}

            {editingItem.type === "story" && (
              <>
                <div className="admin-field">
                  <label className="admin-label">Вертикальное изображение (9:16)</label>
                  <ImageUploader
                    images={editingItem.imageUrl ? [{ url: editingItem.imageUrl, publicId: "" }] : []}
                    onChange={(imgs) => updateForm("imageUrl", imgs[imgs.length - 1]?.url || "")}
                    defaultReplace
                    hideReplaceToggle
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Ссылка при клике на фото</label>
                  <input
                    className="admin-input"
                    value={editingItem.buttonUrl || ""}
                    onChange={(e) => updateForm("buttonUrl", e.target.value)}
                    placeholder="/catalog или https://..."
                  />
                </div>
              </>
            )}

            <div className="popup-admin-schedule">
              <h3>Расписание и Тайминги</h3>
              <div className="admin-grid-2">
                <div className="admin-field">
                  <label className="admin-label">Начало показа</label>
                  <input
                    type="datetime-local"
                    className="admin-input"
                    value={toDateTimeLocal(editingItem.startAt)}
                    onChange={(e) => updateForm("startAt", e.target.value)}
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Окончание</label>
                  <input
                    type="datetime-local"
                    className="admin-input"
                    value={toDateTimeLocal(editingItem.endAt)}
                    onChange={(e) => updateForm("endAt", e.target.value)}
                  />
                </div>
              </div>
              <div className="admin-grid-2">
                <div className="admin-field">
                  <label className="admin-label">Задержка (сек)</label>
                  <input
                    type="number"
                    className="admin-input"
                    value={editingItem.delaySeconds}
                    onChange={(e) => updateForm("delaySeconds", Number(e.target.value))}
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Длительность (сек)</label>
                  <input
                    type="number"
                    className="admin-input"
                    value={editingItem.durationSeconds}
                    onChange={(e) => updateForm("durationSeconds", Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            <div className="admin-grid-2">
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={editingItem.isActive}
                  onChange={(e) => updateForm("isActive", e.target.checked)}
                />
                <span>Активно</span>
              </label>
              <div className="admin-field">
                <label className="admin-label">Сортировка</label>
                <input
                  type="number"
                  className="admin-input"
                  value={editingItem.sortOrder}
                  onChange={(e) => updateForm("sortOrder", Number(e.target.value))}
                />
              </div>
            </div>

            {error && <div className="admin-error">{error}</div>}

            <div className="admin-form-actions">
              <button className="admin-btn admin-btn--ghost" onClick={() => setEditingItem(null)}>
                Отмена
              </button>
              <button className="admin-btn admin-btn--primary" disabled={saving} onClick={save}>
                {saving && <Loader2 size={14} className="animate-spin" />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {!editingItem && (
        <div className="popup-admin-list">
          {filteredList.length === 0 ? (
            <div className="admin-card admin-empty">
              <BellRing size={36} />
              <p>Ничего не найдено</p>
            </div>
          ) : (
            filteredList.map((item) => (
              <article key={item.id} className="popup-admin-item">
                <div className={`popup-admin-item__icon popup-admin-item__icon--${item.style || 'info'}`}>
                  {item.type === "story" ? <ImageIcon size={18} /> : (item.style === "promo" ? <Gift size={18} /> : <BellRing size={18} />)}
                </div>
                <div className="popup-admin-item__main">
                  <div className="popup-admin-item__title">{item.title}</div>
                  <div className="popup-admin-item__meta">
                    {item.isActive ? "Активен" : "Выключен"} · {item.delaySeconds}с задержка · {item.durationSeconds}с показ
                  </div>
                </div>
                <div className="admin-actions">
                  <button className="admin-btn admin-btn--icon" onClick={() => setEditingItem({
                    ...item,
                    startAt: item.startAt || "",
                    endAt: item.endAt || "",
                  })}>
                    <Edit2 size={14} />
                  </button>
                  <button className="admin-btn admin-btn--icon" onClick={() => remove(item.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </div>
  );
}
