// =========================================================
// FILE: src/components/admin/HomeTilesManager.tsx
// Плитки главной страницы: набор, порядок, фото, правило отбора.
// Каталог не затрагивается — это только витрина главной.
// =========================================================

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Plus,
  Save,
  Trash2,
  Loader2,
  Edit2,
  X,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  AlertCircle,
  LayoutGrid,
} from "lucide-react";
import { ImageUploader } from "./ImageUploader";
import { GlyphIcon, GLYPH_CHOICES } from "@/components/ui/Glyph";
import {
  describeHomeTileRule,
  parseTagList,
  type HomeTile,
  type HomeTileKind,
} from "@/lib/home-tiles";

interface CategoryOption {
  id: string;
  name: string;
}

const KIND_OPTIONS: { value: HomeTileKind; label: string; hint: string }[] = [
  {
    value: "category",
    label: "Категория каталога",
    hint: "В плитку попадают все товары выбранной категории.",
  },
  {
    value: "tag",
    label: "Метка / бейдж",
    hint: "Товары с указанной меткой. Можно перечислить несколько через запятую: «озон, ozon». Учитываются и метки товара, и бейдж («Хит», «Акция»).",
  },
  {
    value: "featured",
    label: "Популярные",
    hint: "Товары с флагом «Популярный товар».",
  },
  {
    value: "sale",
    label: "Распродажа",
    hint: "Товары с флагом «Распродажа остатков».",
  },
  { value: "all", label: "Весь каталог", hint: "Все видимые товары." },
];

interface TileWithCount extends HomeTile {
  productCount: number;
}

export function HomeTilesManager({
  tiles: initialTiles,
  categories,
  knownTags,
  migrationMissing,
}: {
  tiles: TileWithCount[];
  categories: CategoryOption[];
  knownTags: string[];
  migrationMissing: boolean;
}) {
  const router = useRouter();
  const [tiles, setTiles] = useState<TileWithCount[]>(initialTiles);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);
  const [error, setError] = useState("");

  // ── Форма ──
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [kind, setKind] = useState<HomeTileKind>("category");
  const [categoryId, setCategoryId] = useState("");
  const [tag, setTag] = useState("");
  const [icon, setIcon] = useState("box");
  const [accent, setAccent] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imagePublicId, setImagePublicId] = useState("");
  const [isVisible, setIsVisible] = useState(true);

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );

  function resetForm() {
    setTitle("");
    setSubtitle("");
    setKind("category");
    setCategoryId(categories[0]?.id || "");
    setTag("");
    setIcon("box");
    setAccent("");
    setImageUrl("");
    setImagePublicId("");
    setIsVisible(true);
  }

  function startCreate() {
    resetForm();
    setEditingId(null);
    setIsCreating(true);
    setError("");
  }

  function startEdit(tile: TileWithCount) {
    setTitle(tile.title);
    setSubtitle(tile.subtitle || "");
    setKind(tile.kind);
    setCategoryId(tile.categoryId || categories[0]?.id || "");
    setTag(tile.tag || "");
    setIcon(tile.icon || "box");
    setAccent(tile.accent || "");
    setImageUrl(tile.imageUrl || "");
    setImagePublicId("");
    setIsVisible(tile.isVisible);
    setIsCreating(false);
    setEditingId(tile.id);
    setError("");
  }

  function cancelForm() {
    setIsCreating(false);
    setEditingId(null);
    setError("");
  }

  async function saveTile() {
    if (!title.trim()) {
      setError("Укажите название плитки");
      return;
    }
    if (kind === "category" && !categoryId) {
      setError("Выберите категорию");
      return;
    }
    if (kind === "tag" && parseTagList(tag).length === 0) {
      setError("Укажите метку (например: озон)");
      return;
    }

    setSaving(true);
    setError("");
    const payload = {
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      kind,
      categoryId: kind === "category" ? categoryId : null,
      tag: kind === "tag" ? tag.trim() : null,
      icon,
      accent: accent.trim() || null,
      imageUrl: imageUrl || null,
      isVisible,
      sortOrder: editingId
        ? tiles.find((t) => t.id === editingId)?.sortOrder ?? 0
        : tiles.length,
    };

    try {
      const url = editingId ? `/api/admin/home-tiles/${editingId}` : "/api/admin/home-tiles";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось сохранить плитку");
        setSaving(false);
        return;
      }
      cancelForm();
      router.refresh();
    } catch (e) {
      console.error(e);
      setError("Ошибка сети при сохранении");
    }
    setSaving(false);
  }

  async function removeTile(tile: TileWithCount) {
    if (!confirm(`Удалить плитку «${tile.title}»? Товары и категории не пострадают.`))
      return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/home-tiles/${tile.id}`, { method: "DELETE" });
      if (res.ok) {
        setTiles((prev) => prev.filter((t) => t.id !== tile.id));
        router.refresh();
      } else {
        setError("Не удалось удалить плитку");
      }
    } catch (e) {
      console.error(e);
      setError("Ошибка сети при удалении");
    }
    setSaving(false);
  }

  function move(index: number, delta: number) {
    const next = [...tiles];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTiles(next.map((t, i) => ({ ...t, sortOrder: i })));
    setOrderDirty(true);
  }

  async function saveOrder() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/home-tiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: tiles.map((t) => t.id) }),
      });
      if (res.ok) {
        setOrderDirty(false);
        router.refresh();
      } else {
        setError("Не удалось сохранить порядок");
      }
    } catch (e) {
      console.error(e);
      setError("Ошибка сети при сохранении порядка");
    }
    setSaving(false);
  }

  const showForm = isCreating || editingId !== null;
  const activeKindHint = KIND_OPTIONS.find((k) => k.value === kind)?.hint || "";

  return (
    <div className="admin-stack">
      {migrationMissing && (
        <div className="admin-error">
          <AlertCircle size={14} /> Таблицы <code>home_tiles</code> нет в базе.
          Выполните <code>supabase/migration_home_tiles.sql</code> в Supabase → SQL
          Editor — до этого главная показывает плитки, собранные автоматически из
          категорий.
        </div>
      )}

      <div className="admin-row" style={{ justifyContent: "space-between" }}>
        <p className="admin-sub" style={{ margin: 0 }}>
          Плитки показываются на главной вместо блока «Популярные товары». Клик по
          плитке открывает окно каталога с поиском — без перехода на другую страницу.
        </p>
        <div className="admin-row">
          {orderDirty && (
            <button
              type="button"
              onClick={saveOrder}
              disabled={saving}
              className="admin-btn admin-btn--navy"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Сохранить порядок
            </button>
          )}
          <button type="button" onClick={startCreate} className="admin-btn admin-btn--primary">
            <Plus size={16} /> Добавить плитку
          </button>
        </div>
      </div>

      {error && (
        <div className="admin-error">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {showForm && (
        <div className="admin-card">
          <div className="admin-card__pad">
            <h3 className="admin-h2">
              {editingId ? "Редактирование плитки" : "Новая плитка"}
            </h3>

            <div className="admin-grid-3" style={{ marginBottom: 12 }}>
              <div className="admin-field">
                <label className="admin-label">Название плитки *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="admin-input"
                  placeholder="Коробки для Ozon"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Подпись</label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  className="admin-input"
                  placeholder="Размеры под поставки на склад"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Что показывать</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as HomeTileKind)}
                  className="admin-input"
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <span className="admin-hint">{activeKindHint}</span>
              </div>
            </div>

            <div className="admin-grid-3" style={{ marginBottom: 12 }}>
              {kind === "category" && (
                <div className="admin-field">
                  <label className="admin-label">Категория *</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="admin-input"
                  >
                    <option value="">— выберите —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {kind === "tag" && (
                <div className="admin-field">
                  <label className="admin-label">Метки *</label>
                  <input
                    type="text"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    className="admin-input"
                    placeholder="озон, ozon"
                    list="home-tile-tags"
                  />
                  <datalist id="home-tile-tags">
                    {knownTags.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                  <span className="admin-hint">
                    Метка берётся из поля «Метки товара» и из бейджа товара
                    («Хит», «Акция»). У товара может быть несколько меток — он
                    попадёт сразу в несколько плиток.
                  </span>
                  {knownTags.length > 0 && (
                    <div className="admin-row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {knownTags.slice(0, 24).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="admin-btn admin-btn--ghost admin-btn--sm"
                          onClick={() =>
                            setTag((prev) =>
                              parseTagList(prev).includes(t)
                                ? prev
                                : [...parseTagList(prev), t].join(", ")
                            )
                          }
                        >
                          + {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="admin-field">
                <label className="admin-label">Иконка (если нет фото)</label>
                <select
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="admin-input"
                >
                  {GLYPH_CHOICES.map((g) => (
                    <option key={g.token} value={g.token}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="admin-field">
                <label className="admin-label">Акцентный цвет</label>
                <input
                  type="text"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="admin-input"
                  placeholder="#2d6a4f — необязательно"
                />
              </div>
            </div>

            <div className="admin-field">
              <label className="admin-label">Фото плитки</label>
              <ImageUploader
                images={imageUrl ? [{ url: imageUrl, publicId: imagePublicId }] : []}
                onChange={(imgs) => {
                  const last = imgs[imgs.length - 1];
                  setImageUrl(last?.url || "");
                  setImagePublicId(last?.publicId || "");
                }}
              />
              <span className="admin-hint">
                Если фото не загружено — плитка возьмёт фото категории, а затем
                фото первого товара раздела.
              </span>
            </div>

            <label className="admin-check" style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={isVisible}
                onChange={(e) => setIsVisible(e.target.checked)}
              />
              <span>Показывать на главной</span>
            </label>

            <div className="admin-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                onClick={saveTile}
                disabled={saving}
                className="admin-btn admin-btn--navy"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Сохранить
              </button>
              <button type="button" onClick={cancelForm} className="admin-btn admin-btn--ghost">
                <X size={14} /> Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Порядок</th>
                <th style={{ width: 70 }}>Фото</th>
                <th>Плитка</th>
                <th>Правило отбора</th>
                <th>Товаров</th>
                <th>Видимость</th>
                <th style={{ width: 110 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {tiles.map((tile, index) => (
                <tr key={tile.id}>
                  <td>
                    <div className="admin-row" style={{ gap: 4 }}>
                      <button
                        type="button"
                        className="admin-btn admin-btn--icon"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label="Выше"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn--icon"
                        onClick={() => move(index, 1)}
                        disabled={index === tiles.length - 1}
                        aria-label="Ниже"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </td>
                  <td>
                    {tile.imageUrl ? (
                      <span
                        style={{
                          position: "relative",
                          display: "block",
                          width: 52,
                          height: 40,
                          borderRadius: 6,
                          overflow: "hidden",
                        }}
                      >
                        <Image
                          src={tile.imageUrl}
                          alt={tile.title}
                          fill
                          sizes="52px"
                          style={{ objectFit: "cover" }}
                        />
                      </span>
                    ) : (
                      <span className="admin-cat-icon">
                        <GlyphIcon value={tile.icon || "box"} size={20} />
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="admin-cat-name">{tile.title}</div>
                    {tile.subtitle && (
                      <div className="admin-cat-desc">{tile.subtitle}</div>
                    )}
                  </td>
                  <td className="admin-muted">
                    {describeHomeTileRule(
                      tile,
                      tile.categoryId ? categoryName.get(tile.categoryId) : null
                    )}
                  </td>
                  <td>
                    <strong style={{ color: "var(--adm-navy)" }}>{tile.productCount}</strong>
                  </td>
                  <td>
                    {tile.isVisible ? (
                      <span className="admin-badge admin-badge--green">
                        <Eye size={10} /> Видна
                      </span>
                    ) : (
                      <span className="admin-badge admin-badge--red">
                        <EyeOff size={10} /> Скрыта
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="admin-row" style={{ gap: 4 }}>
                      <button
                        type="button"
                        className="admin-btn admin-btn--icon"
                        onClick={() => startEdit(tile)}
                        aria-label="Редактировать"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn--icon"
                        onClick={() => removeTile(tile)}
                        aria-label="Удалить"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tiles.length === 0 && (
            <div className="admin-table__empty">
              <LayoutGrid size={18} /> Плиток пока нет — на главной показываются
              категории каталога
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
