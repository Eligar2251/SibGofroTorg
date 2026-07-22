// src/components/admin/PromotionsManager.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit2, Save, X, Loader2, Megaphone, Copy } from "lucide-react";
import { ImageUploader } from "./ImageUploader";
import { GlyphIcon, GLYPH_CHOICES } from "@/components/ui/Glyph";

interface Promotion {
  id: string;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  imageUrl?: string | null;
  linkType: "product" | "url" | "none";
  productId?: string | null;
  linkUrl?: string | null;
  sortOrder: number;
  isVisible: boolean;
  // New fields for deal card display on main page
  icon?: string | null;
  color?: string | null;
  light?: string | null;
  deadline?: string | null;
}

interface Product {
  id: string;
  name: string;
  slug: string;
}

export function PromotionsManager({
  promotions: initialPromotions,
  products,
}: {
  promotions: Promotion[];
  products: Product[];
}) {
  const router = useRouter();
  const [promotions, setPromotions] = useState<Promotion[]>(initialPromotions);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [badge, setBadge] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkType, setLinkType] = useState<"product" | "url" | "none">("none");
  const [productId, setProductId] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  // New fields for deal card display
  const [icon, setIcon] = useState("box");
  const [color, setColor] = useState("var(--kraft)");
  const [light, setLight] = useState("var(--kraft-light)");
  const [deadline, setDeadline] = useState("");

  function startCreate() {
    setTitle("");
    setSubtitle("");
    setBadge("");
    setImageUrl("");
    setLinkType("none");
    setProductId("");
    setLinkUrl("");
    setSortOrder(promotions.length);
    setIsVisible(true);
    setIcon("box");
    setColor("var(--kraft)");
    setLight("var(--kraft-light)");
    setDeadline("");
    setEditingId(null);
    setIsCreating(true);
  }

  function startEdit(p: Promotion) {
    setTitle(p.title);
    setSubtitle(p.subtitle || "");
    setBadge(p.badge || "");
    setImageUrl(p.imageUrl || "");
    setLinkType(p.linkType);
    setProductId(p.productId || "");
    setLinkUrl(p.linkUrl || "");
    setSortOrder(p.sortOrder);
    setIsVisible(p.isVisible);
    setIcon(p.icon || "box");
    setColor(p.color || "var(--kraft)");
    setLight(p.light || "var(--kraft-light)");
    setDeadline(p.deadline || "");
    setIsCreating(false);
    setEditingId(p.id);
  }

  async function startCopy(p: Promotion) {
    if (!confirm("Создать копию этой акции?")) return;
    setSaving(true);
    try {
      const payload = {
        title: p.title + " (копия)",
        subtitle: p.subtitle || null,
        badge: p.badge || null,
        imageUrl: p.imageUrl || null,
        linkType: p.linkType,
        productId: p.linkType === "product" ? p.productId || null : null,
        linkUrl: p.linkType === "url" ? p.linkUrl || null : null,
        sortOrder: promotions.length,
        isVisible: false, // Copy is hidden by default
        // New fields
        icon: p.icon || null,
        color: p.color || null,
        light: p.light || null,
        deadline: p.deadline || null,
      };

      const res = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setPromotions((prev) => [
          ...prev,
          { id: data.id, ...payload },
        ]);
        router.refresh();
      }
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  function cancelForm() {
    setIsCreating(false);
    setEditingId(null);
  }

  async function handleSave(id?: string) {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title,
        subtitle: subtitle || null,
        badge: badge || null,
        imageUrl: imageUrl || null,
        linkType,
        productId: linkType === "product" ? productId || null : null,
        linkUrl: linkType === "url" ? linkUrl || null : null,
        sortOrder: Number(sortOrder),
        isVisible,
        // New fields
        icon: icon || null,
        color: color || null,
        light: light || null,
        deadline: deadline || null,
      };

      if (id) {
        const res = await fetch(`/api/admin/promotions/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          setPromotions((prev) =>
            prev.map((p) => (p.id === id ? { ...p, ...payload } : p))
          );
          cancelForm();
        }
      } else {
        const res = await fetch("/api/admin/promotions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok && data.id) {
          setPromotions((prev) => [
            ...prev,
            { id: data.id, ...payload },
          ]);
          cancelForm();
        }
      }
      router.refresh();
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить акцию/баннер?")) return;
    try {
      const res = await fetch(`/api/admin/promotions/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setPromotions((prev) => prev.filter((p) => p.id !== id));
        router.refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleSeedDefaults() {
    if (!confirm("Добавить 4 демо-акции? Они будут добавлены в базу данных.")) return;
    setSaving(true);
    try {
      const defaultPromos = [
        {
          title: "−15% при заказе\nот 500 коробов",
          subtitle: "На все стандартные размеры Т-23",
          badge: "Оптовая скидка",
          imageUrl: null,
          linkType: "none",
          productId: null,
          linkUrl: null,
          sortOrder: promotions.length,
          isVisible: true,
          icon: "box",
          color: "var(--kraft)",
          light: "var(--kraft-light)",
          deadline: null,
        },
        {
          title: "Бесплатная доставка\nот 30 000 ₽",
          subtitle: "По Новосибирску и области",
          badge: "Доставка",
          imageUrl: null,
          linkType: "none",
          productId: null,
          linkUrl: null,
          sortOrder: promotions.length + 1,
          isVisible: true,
          icon: "truck",
          color: "var(--eco)",
          light: "var(--eco-light)",
          deadline: null,
        },
        {
          title: "Сдай картон —\nполучи −7% на тару",
          subtitle: "Принимаем от 50 кг, оплата сразу",
          badge: "Макулатура → Скидка",
          imageUrl: null,
          linkType: "url",
          productId: null,
          linkUrl: "/wastepaper",
          sortOrder: promotions.length + 2,
          isVisible: true,
          icon: "recycle",
          color: "#2D6A4F",
          light: "#D8EFE3",
          deadline: null,
        },
        {
          title: "Самосборные\nкоробки со скидкой",
          subtitle: "Быстрая сборка без скотча",
          badge: "Новинки",
          imageUrl: null,
          linkType: "none",
          productId: null,
          linkUrl: null,
          sortOrder: promotions.length + 3,
          isVisible: true,
          icon: "zap",
          color: "#7C3AED",
          light: "#EDE9FE",
          deadline: "31 июля",
        },
      ];

      for (const promo of defaultPromos) {
        const res = await fetch("/api/admin/promotions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(promo),
        });
        const data = await res.json();
        if (res.ok && data.id) {
          setPromotions((prev) => [...prev, { id: data.id, ...promo } as Promotion]);
        }
      }
      router.refresh();
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  return (
    <div className="admin-stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p className="admin-sub">
          Управление акциями, баннерами и спецпредложениями на сайте с возможностью перехода на товары или страницы.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isCreating && !editingId && promotions.length === 0 && (
            <button
              type="button"
              onClick={handleSeedDefaults}
              className="admin-btn admin-btn--secondary"
              style={{ background: "var(--green-bg)", border: "1px solid var(--green-border)", color: "var(--green)" }}
            >
              <Plus size={16} /> Заполнить демо-акциями (4 шт.)
            </button>
          )}
          {!isCreating && !editingId && (
            <button type="button" onClick={startCreate} className="admin-btn admin-btn--primary">
              <Plus size={16} /> Добавить акцию / баннер
            </button>
          )}
        </div>
      </div>

      {/* Форма создания / редактирования */}
      {(isCreating || editingId) && (
        <div className="admin-card" style={{ border: "2px solid var(--adm-kraft)" }}>
          <div className="admin-card__pad admin-stack">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 className="admin-h2">
                {isCreating ? "Новая акция / спецпредложение" : "Редактирование акции"}
              </h2>
              <button type="button" onClick={cancelForm} className="admin-modal__close">
                <X size={18} />
              </button>
            </div>

            <div className="admin-grid-2">
              <div className="admin-field">
                <label className="admin-label">Заголовок *</label>
                <input
                  type="text"
                  className="admin-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Например: Скидка 10% на гофрокороб"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Подзаголовок / Описание</label>
                <input
                  type="text"
                  className="admin-input"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Например: При заказе от 50 штук"
                />
              </div>
            </div>

            <div className="admin-grid-3">
              <div className="admin-field">
                <label className="admin-label">Бейдж / Метка</label>
                <input
                  type="text"
                  className="admin-input"
                  value={badge}
                  onChange={(e) => setBadge(e.target.value)}
                  placeholder="Хит, Распродажа, Акция"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Порядок сортировки</label>
                <input
                  type="number"
                  className="admin-input"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                />
              </div>
              <div className="admin-field" style={{ justifyContent: "flex-end" }}>
                <label className="admin-check" style={{ marginTop: 18 }}>
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={(e) => setIsVisible(e.target.checked)}
                  />
                  <span>Активна / Видима</span>
                </label>
              </div>
            </div>

            {/* Картинка */}
            <div className="admin-field">
              <label className="admin-label">Изображение баннера</label>
              <ImageUploader
                images={imageUrl ? [{ url: imageUrl, publicId: "" }] : []}
                onChange={(imgs) => setImageUrl(imgs[0]?.url || "")}
              />
            </div>

            {/* Поля для отображения на главной странице (deal card) */}
            <div className="admin-field">
              <label className="admin-label">Иконка карточки</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <select
                  className="admin-input"
                  value={
                    GLYPH_CHOICES.some((g) => g.token === icon) ? icon : "box"
                  }
                  onChange={(e) => setIcon(e.target.value)}
                  style={{ flex: 1 }}
                >
                  {GLYPH_CHOICES.map((g) => (
                    <option key={g.token} value={g.token}>
                      {g.label}
                    </option>
                  ))}
                </select>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: "1px solid var(--adm-border-mid)",
                    background: "var(--adm-bg, #f8f7f4)",
                  }}
                >
                  <GlyphIcon value={icon} size={17} />
                </span>
              </div>
            </div>

            <div className="admin-grid-3">
              <div className="admin-field">
                <label className="admin-label">Цвет акцента (CSS переменная или HEX)</label>
                <input
                  type="text"
                  className="admin-input"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="var(--kraft) или #2D6A4F"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Светлый фон (CSS переменная или HEX)</label>
                <input
                  type="text"
                  className="admin-input"
                  value={light}
                  onChange={(e) => setLight(e.target.value)}
                  placeholder="var(--kraft-light) или #D8EFE3"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Дедлайн (до какой даты)</label>
                <input
                  type="text"
                  className="admin-input"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  placeholder="31 июля / 31.07.2024"
                />
              </div>
            </div>

            {/* Тип перехода / ссылки */}
            <div className="admin-grid-2">
              <div className="admin-field">
                <label className="admin-label">Куда ведет карточка (Переход)</label>
                <select
                  className="admin-select"
                  value={linkType}
                  onChange={(e) => setLinkType(e.target.value as any)}
                >
                  <option value="none">Без перехода (просто карточка / новость)</option>
                  <option value="product">Переход на товар из каталога</option>
                  <option value="url">Переход по произвольной ссылке</option>
                </select>
              </div>

              {linkType === "product" && (
                <div className="admin-field">
                  <label className="admin-label">Выберите товар</label>
                  <select
                    className="admin-select"
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                  >
                    <option value="">— Выберите товар —</option>
                    {products.map((prod) => (
                      <option key={prod.id} value={prod.id}>
                        {prod.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {linkType === "url" && (
                <div className="admin-field">
                  <label className="admin-label">Произвольная ссылка (URL)</label>
                  <input
                    type="text"
                    className="admin-input"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="/catalog/gofrokoroba или https://..."
                  />
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 10 }}>
              <button type="button" onClick={cancelForm} className="admin-btn admin-btn--ghost">
                Отмена
              </button>
              <button
                type="button"
                disabled={saving || !title.trim()}
                onClick={() => handleSave(editingId || undefined)}
                className="admin-btn admin-btn--primary"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isCreating ? "Создать акцию" : "Сохранить изменения"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Список акций */}
      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Баннер</th>
                <th>Заголовок и описание</th>
                <th>Метка</th>
                <th>Переход</th>
                <th style={{ width: 80, textAlign: "center" }}>Порядок</th>
                <th style={{ width: 80, textAlign: "center" }}>Статус</th>
                <th style={{ width: 100, textAlign: "right" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="admin-product-thumb">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" />
                      ) : (
                        <Megaphone size={16} />
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, color: "var(--adm-ink)" }}>{p.title}</div>
                    {p.subtitle && <div className="admin-muted">{p.subtitle}</div>}
                  </td>
                  <td>
                    {p.badge ? (
                      <span className="admin-badge admin-badge--amber">{p.badge}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span className="admin-badge admin-badge--muted">
                      {p.linkType === "product" ? (
                        <>
                          <GlyphIcon value="box" size={11} /> На товар
                        </>
                      ) : p.linkType === "url" ? (
                        <>
                          <GlyphIcon value="link" size={11} /> {p.linkUrl}
                        </>
                      ) : (
                        <>
                          <GlyphIcon value="file" size={11} /> Без ссылки
                        </>
                      )}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", fontWeight: 600 }}>{p.sortOrder}</td>
                  <td style={{ textAlign: "center" }}>
                    {p.isVisible ? (
                      <span className="admin-badge admin-badge--green">Активна</span>
                    ) : (
                      <span className="admin-badge admin-badge--red">Скрыта</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="admin-actions" style={{ justifyContent: "flex-end", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => startCopy(p)}
                        className="admin-btn admin-btn--icon"
                        title="Копировать"
                      >
                        <Copy size={14} style={{ color: "var(--adm-kraft)" }} />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        className="admin-btn admin-btn--icon"
                        title="Редактировать"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        className="admin-btn admin-btn--icon"
                        title="Удалить"
                      >
                        <Trash2 size={14} style={{ color: "var(--adm-rust)" }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {promotions.length === 0 && (
            <div className="admin-table__empty">Акции и спецпредложения пока не добавлены</div>
          )}
        </div>
      </div>
    </div>
  );
}
