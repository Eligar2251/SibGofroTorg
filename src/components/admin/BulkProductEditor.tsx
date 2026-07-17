// src/components/admin/BulkProductEditor.tsx
"use client";

import { useState, useCallback } from "react";
import { Save, Loader2, RotateCcw, Search, Trash2 } from "lucide-react";

interface BulkProduct {
  id: string;
  name: string;
  sku: string;
  categoryId: string;
  price: number | null;
  priceWholesale: number | null;
  minWholesaleQty: number | null;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionUnit: string;
  weight: number | null;
  material: string;
  packQty: number | null;
  volume: number | null;
  note: string;
  stockQty: number | null;
  inStock: boolean;
  isVisible: boolean;
  isPromo: boolean;
  isFeatured: boolean;
  promoLabel: string;
}

interface Category {
  id: string;
  name: string;
}

export function BulkProductEditor({
  products: initialProducts,
  categories,
  catMap,
}: {
  products: BulkProduct[];
  categories: Category[];
  catMap: Record<string, string>;
}) {
  const [products, setProducts] = useState<BulkProduct[]>(initialProducts);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState("");

  const update = useCallback(
    (id: string, field: keyof BulkProduct, value: any) => {
      setProducts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
      );
      setChanged((prev) => new Set(prev).add(id));
      setSaved(false);
    },
    []
  );

  const filtered = products.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
  );

  function toggleSelectAll() {
    if (filtered.length > 0 && selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function handleSave() {
    const toSave = products.filter((p) => changed.has(p.id));
    if (toSave.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/products/bulk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: toSave }),
      });
      if (res.ok) {
        setChanged(new Set());
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `Удалить выбранные товары (${selectedIds.size} шт.)? Это действие необратимо.`
      )
    )
      return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/products/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        setProducts((prev) => prev.filter((p) => !selectedIds.has(p.id)));
        setSelectedIds(new Set());
      }
    } catch (e) {
      console.error(e);
    }
    setDeleting(false);
  }

  function handleReset() {
    setProducts(initialProducts);
    setChanged(new Set());
    setSaved(false);
  }

  return (
    <div className="admin-stack">
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
          <Search
            size={15}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--adm-muted)",
            }}
          />
          <input
            type="text"
            placeholder="Поиск по названию или артикулу..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="admin-input"
            style={{ paddingLeft: 32 }}
          />
        </div>

        {changed.size > 0 && (
          <span
            style={{
              fontSize: 13,
              color: "var(--adm-amber)",
              fontWeight: 600,
            }}
          >
            Изменено: {changed.size} товаров
          </span>
        )}

        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={deleting}
            className="admin-btn admin-btn--danger"
          >
            {deleting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            Удалить ({selectedIds.size})
          </button>
        )}

        <button
          type="button"
          onClick={handleReset}
          className="admin-btn admin-btn--ghost"
          disabled={changed.size === 0}
        >
          <RotateCcw size={14} /> Сбросить
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || changed.size === 0}
          className="admin-btn admin-btn--primary"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {saving ? "Сохранение..." : `Сохранить (${changed.size})`}
        </button>

        {saved && (
          <span
            style={{ color: "var(--adm-green)", fontSize: 13, fontWeight: 600 }}
          >
            ✓ Сохранено!
          </span>
        )}
      </div>

      {/* Таблица со всеми полями */}
      <div className="admin-card">
        <div className="admin-table-wrap" style={{ overflowX: "auto" }}>
          <table
            className="admin-table"
            style={{ minWidth: 1700, fontSize: 13 }}
          >
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={
                      filtered.length > 0 &&
                      selectedIds.size === filtered.length
                    }
                    onChange={toggleSelectAll}
                    style={{ cursor: "pointer", accentColor: "var(--adm-kraft)" }}
                  />
                </th>
                <th style={{ minWidth: 180 }}>Название</th>
                <th style={{ minWidth: 90 }}>Артикул</th>
                <th style={{ minWidth: 130 }}>Категория</th>
                <th style={{ minWidth: 90 }}>Цена ₽</th>
                <th style={{ minWidth: 90 }}>Опт ₽</th>
                <th style={{ minWidth: 70 }}>Мин.опт</th>
                <th style={{ minWidth: 70 }}>Длина</th>
                <th style={{ minWidth: 70 }}>Ширина</th>
                <th style={{ minWidth: 70 }}>Высота</th>
                <th style={{ minWidth: 60 }}>Ед.</th>
                <th style={{ minWidth: 70 }}>Вес, кг</th>
                <th style={{ minWidth: 80 }}>Материал</th>
                <th style={{ minWidth: 70 }}>Упак.</th>
                <th style={{ minWidth: 70 }}>Объем</th>
                <th style={{ minWidth: 80 }}>Остаток</th>
                <th style={{ minWidth: 110 }}>Примечание</th>
                <th style={{ minWidth: 60 }}>Акция</th>
                <th style={{ minWidth: 90 }}>Метка</th>
                <th style={{ minWidth: 60 }}>Хит</th>
                <th style={{ minWidth: 60 }}>Видим</th>
                <th style={{ minWidth: 70 }}>В наличии</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isDirty = changed.has(p.id);
                const isSelected = selectedIds.has(p.id);
                return (
                  <tr
                    key={p.id}
                    style={{
                      background: isDirty
                        ? "rgba(217,119,6,0.05)"
                        : isSelected
                        ? "rgba(200,134,10,0.06)"
                        : undefined,
                      outline: isDirty
                        ? "1px solid rgba(217,119,6,0.3)"
                        : undefined,
                    }}
                  >
                    {/* Чекбокс выбора */}
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(p.id)}
                        style={{ cursor: "pointer", accentColor: "var(--adm-kraft)" }}
                      />
                    </td>

                    {/* Название */}
                    <td>
                      <input
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.name}
                        onChange={(e) => update(p.id, "name", e.target.value)}
                      />
                    </td>

                    {/* Артикул */}
                    <td>
                      <input
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.sku}
                        onChange={(e) => update(p.id, "sku", e.target.value)}
                      />
                    </td>

                    {/* Категория */}
                    <td>
                      <select
                        className="admin-select"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.categoryId}
                        onChange={(e) =>
                          update(p.id, "categoryId", e.target.value)
                        }
                      >
                        <option value="">—</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Цена */}
                    <td>
                      <input
                        type="number"
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.price ?? ""}
                        onChange={(e) =>
                          update(
                            p.id,
                            "price",
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </td>

                    {/* Оптовая цена */}
                    <td>
                      <input
                        type="number"
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.priceWholesale ?? ""}
                        onChange={(e) =>
                          update(
                            p.id,
                            "priceWholesale",
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </td>

                    {/* Мин. опт */}
                    <td>
                      <input
                        type="number"
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.minWholesaleQty ?? ""}
                        onChange={(e) =>
                          update(
                            p.id,
                            "minWholesaleQty",
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </td>

                    {/* Длина */}
                    <td>
                      <input
                        type="number"
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.dimensionLength ?? ""}
                        onChange={(e) =>
                          update(
                            p.id,
                            "dimensionLength",
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </td>

                    {/* Ширина */}
                    <td>
                      <input
                        type="number"
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.dimensionWidth ?? ""}
                        onChange={(e) =>
                          update(
                            p.id,
                            "dimensionWidth",
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </td>

                    {/* Высота */}
                    <td>
                      <input
                        type="number"
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.dimensionHeight ?? ""}
                        onChange={(e) =>
                          update(
                            p.id,
                            "dimensionHeight",
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </td>

                    {/* Ед. изм */}
                    <td>
                      <select
                        className="admin-select"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.dimensionUnit}
                        onChange={(e) =>
                          update(p.id, "dimensionUnit", e.target.value)
                        }
                      >
                        <option value="мм">мм</option>
                        <option value="см">см</option>
                        <option value="м">м</option>
                      </select>
                    </td>

                    {/* Вес */}
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.weight ?? ""}
                        onChange={(e) =>
                          update(
                            p.id,
                            "weight",
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </td>

                    {/* Материал */}
                    <td>
                      <input
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.material}
                        onChange={(e) => update(p.id, "material", e.target.value)}
                      />
                    </td>

                    {/* Упаковка */}
                    <td>
                      <input
                        type="number"
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.packQty ?? ""}
                        onChange={(e) =>
                          update(
                            p.id,
                            "packQty",
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </td>

                    {/* Объем */}
                    <td>
                      <input
                        type="number"
                        step="0.001"
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.volume ?? ""}
                        onChange={(e) =>
                          update(
                            p.id,
                            "volume",
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </td>

                    {/* Остаток */}
                    <td>
                      <input
                        type="number"
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.stockQty ?? ""}
                        onChange={(e) =>
                          update(
                            p.id,
                            "stockQty",
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </td>

                    {/* Примечание */}
                    <td>
                      <input
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.note}
                        onChange={(e) => update(p.id, "note", e.target.value)}
                      />
                    </td>

                    {/* Акция */}
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={p.isPromo}
                        onChange={(e) =>
                          update(p.id, "isPromo", e.target.checked)
                        }
                      />
                    </td>

                    {/* Метка акции */}
                    <td>
                      <input
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.promoLabel}
                        placeholder="Хит, Акция..."
                        onChange={(e) =>
                          update(p.id, "promoLabel", e.target.value)
                        }
                      />
                    </td>

                    {/* Хит */}
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={p.isFeatured}
                        onChange={(e) =>
                          update(p.id, "isFeatured", e.target.checked)
                        }
                      />
                    </td>

                    {/* Видим */}
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={p.isVisible}
                        onChange={(e) =>
                          update(p.id, "isVisible", e.target.checked)
                        }
                      />
                    </td>

                    {/* В наличии */}
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={p.inStock}
                        onChange={(e) =>
                          update(p.id, "inStock", e.target.checked)
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="admin-table__empty">
              {search ? `Ничего не найдено по «${search}»` : "Товаров нет"}
            </div>
          )}
        </div>
      </div>

      {/* Нижняя панель действий */}
      {changed.size > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            type="button"
            onClick={handleReset}
            className="admin-btn admin-btn--ghost"
          >
            <RotateCcw size={14} /> Сбросить изменения
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="admin-btn admin-btn--primary"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Сохранить {changed.size} товаров
          </button>
        </div>
      )}
    </div>
  );
}
