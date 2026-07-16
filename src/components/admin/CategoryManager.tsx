// =========================================================
// FILE: src/components/admin/CategoryManager.tsx
// =========================================================

"use client";

import { useState } from "react";
import { Plus, Loader2, Save, Eye, EyeOff } from "lucide-react";

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
  const [categories, setCategories] = useState(initialCats);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState({
    name: "",
    icon: "📦",
    description: "",
  });

  async function addCategory() {
    if (!newCat.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCat),
      });
      if (res.ok) {
        const created = await res.json();
        setCategories([
          ...categories,
          {
            ...created,
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
        setNewCat({ name: "", icon: "📦", description: "" });
        setShowAdd(false);
      }
    } catch (err) {
      console.error(err);
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
                <label className="admin-label">Иконка (эмодзи)</label>
                <input
                  type="text"
                  value={newCat.icon}
                  onChange={(e) => setNewCat({ ...newCat, icon: e.target.value })}
                  className="admin-input"
                  placeholder="📦"
                />
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
                onClick={() => setShowAdd(false)}
                className="admin-btn admin-btn--ghost"
              >
                Отмена
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
                <th>Категория</th>
                <th>Slug</th>
                <th>Товаров</th>
                <th>Видимость</th>
                <th>Дата создания</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id}>
                  <td>
                    <div className="admin-cat-cell">
                      <span className="admin-cat-icon">{cat.icon ?? "📦"}</span>
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