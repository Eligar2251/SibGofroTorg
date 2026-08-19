// =========================================================
// FILE: src/components/admin/CategoryManager.tsx
// =========================================================

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Loader2,
  Save,
  Eye,
  EyeOff,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { GlyphIcon, GLYPH_CHOICES } from "@/components/ui/Glyph";

interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  description?: string | null;
  sortOrder?: number | null;
  isVisible?: boolean | null;
  imageUrl?: string | null;
  createdAt?: string | null;
  productCount: number;
}

export function CategoryManager({
  categories: initialCats,
}: {
  categories: Category[];
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCats);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newCat, setNewCat] = useState({
    name: "",
    icon: "box",
    description: "",
  });

  // Синхронизация со свежими данными сервера (после router.refresh()
  // после удаления счётчики «Без категории»/товаров обновляются).
  useEffect(() => {
    setCategories(initialCats);
  }, [initialCats]);

  async function deleteCategory(cat: Category) {
    if (deletingId) return;
    const message =
      cat.productCount > 0
        ? `Удалить категорию «${cat.name}»?\n\nВ ней ${cat.productCount} товар(ов). Сами товары не удаляются — они перейдут в раздел «Без категории».`
        : `Удалить категорию «${cat.name}»? Это действие необратимо.`;
    if (!confirm(message)) return;

    setDeletingId(cat.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/categories/${cat.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось удалить категорию");
        setDeletingId(null);
        return;
      }
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      // Перезапросить серверные данные — счётчики товаров у других
      // категорий и список «Без категории» обновятся корректно.
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Ошибка сети при удалении категории");
    }
    setDeletingId(null);
  }

  async function addCategory() {
    if (!newCat.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCat),
      });
      const created = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(created.error || "Не удалось создать категорию");
        setSaving(false);
        return;
      }
      setCategories([
        ...categories,
        {
          id: created.id,
          name: newCat.name,
          slug: created.slug || "",
          icon: newCat.icon,
          description: newCat.description,
          isVisible: true,
          sortOrder: 0,
          imageUrl: null,
          createdAt: null,
          productCount: 0,
        },
      ]);
      setNewCat({ name: "", icon: "box", description: "" });
      setShowAdd(false);
    } catch (err) {
      console.error(err);
      setError("Ошибка сети при создании категории");
    }
    setSaving(false);
  }

  return (
    <div className="admin-stack">
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="admin-btn admin-btn--primary"
        >
          <Plus size={16} /> Добавить категорию
        </button>
      </div>

      {showAdd && (
        <div className="admin-card">
          <div className="admin-card__pad">
            <h3 className="admin-h2">Новая категория</h3>
            <div className="admin-grid-3" style={{ marginBottom: 16 }}>
              <div className="admin-field">
                <label className="admin-label">Название *</label>
                <input
                  type="text"
                  value={newCat.name}
                  onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
                  className="admin-input"
                  placeholder="Картонные коробки"
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Иконка</label>
                <select
                  value={newCat.icon}
                  onChange={(e) => setNewCat({ ...newCat, icon: e.target.value })}
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
                <label className="admin-label">Описание</label>
                <input
                  type="text"
                  value={newCat.description}
                  onChange={(e) =>
                    setNewCat({ ...newCat, description: e.target.value })
                  }
                  className="admin-input"
                  placeholder="Краткое описание"
                />
              </div>
            </div>
            <div className="admin-row">
              <button
                type="button"
                onClick={addCategory}
                disabled={saving || !newCat.name.trim()}
                className="admin-btn admin-btn--navy"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Создать
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setError("");
                }}
                className="admin-btn admin-btn--ghost"
              >
                Отмена
              </button>
            </div>
            {error && (
              <div className="admin-error" style={{ marginTop: 12 }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="admin-error">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Категория</th>
                <th>Slug</th>
                <th>Товаров</th>
                <th>Видимость</th>
                <th>Дата создания</th>
                <th style={{ width: 60 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id}>
                  <td>
                    <div className="admin-cat-cell">
                      <span className="admin-cat-icon"><GlyphIcon value={cat.icon} size={20} /></span>
                      <div>
                        <div className="admin-cat-name">{cat.name}</div>
                        {cat.description && (
                          <div className="admin-cat-desc">{cat.description}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="admin-mono">{cat.slug || "—"}</span>
                  </td>
                  <td>
                    <strong style={{ color: "var(--adm-navy)" }}>
                      {cat.productCount}
                    </strong>
                  </td>
                  <td>
                    {cat.isVisible !== false ? (
                      <span className="admin-badge admin-badge--green">
                        <Eye size={10} /> Видна
                      </span>
                    ) : (
                      <span className="admin-badge admin-badge--red">
                        <EyeOff size={10} /> Скрыта
                      </span>
                    )}
                  </td>
                  <td className="admin-muted">
                    {cat.createdAt
                      ? new Date(cat.createdAt).toLocaleDateString("ru-RU")
                      : "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => deleteCategory(cat)}
                      disabled={deletingId === cat.id}
                      className="admin-btn admin-btn--icon"
                      title="Удалить категорию"
                      aria-label={`Удалить категорию ${cat.name}`}
                    >
                      {deletingId === cat.id ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Trash2 size={15} />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {categories.length === 0 && (
            <div className="admin-table__empty">Категорий пока нет</div>
          )}
        </div>
      </div>
    </div>
  );
}