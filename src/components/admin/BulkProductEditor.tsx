// src/components/admin/BulkProductEditor.tsx
"use client";

import { useState, useCallback } from "react";
import { Save, Loader2, RotateCcw, Search } from "lucide-react";

interface BulkProduct {
  id: string;
  name: string;
  sku: string;
  categoryId: string;
  price: number;
  priceWholesale: number | null;
  minWholesaleQty: number | null;
  stockQty: number | null;
  inStock: boolean;
  isVisible: boolean;
  isPromo: boolean;
  isFeatured: boolean;
  promoLabel: string;
  material: string;
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
  const [saving, setSaving] = useState(false);
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
          {saving
            ? "Сохранение..."
            : `Сохранить (${changed.size})`}
        </button>

        {saved && (
          <span style={{ color: "var(--adm-green)", fontSize: 13, fontWeight: 600 }}>
            ✓ Сохранено!
          </span>
        )}
      </div>

      {/* Таблица */}
      <div className="admin-card">
        <div className="admin-table-wrap" style={{ overflowX: "auto" }}>
          <table
            className="admin-table"
            style={{ minWidth: 1100, fontSize: 13 }}
          >
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Название</th>
                <th style={{ minWidth: 100 }}>Артикул</th>
                <th style={{ minWidth: 140 }}>Категория</th>
                <th style={{ minWidth: 100 }}>Цена ₽</th>
                <th style={{ minWidth: 110 }}>Опт ₽</th>
                <th style={{ minWidth: 80 }}>Мин.опт</th>
                <th style={{ minWidth: 90 }}>Остаток</th>
                <th style={{ minWidth: 80 }}>Материал</th>
                <th style={{ minWidth: 70 }}>Акция</th>
                <th style={{ minWidth: 90 }}>Метка</th>
                <th style={{ minWidth: 70 }}>Хит</th>
                <th style={{ minWidth: 70 }}>Видим</th>
                <th style={{ minWidth: 70 }}>В наличии</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isDirty = changed.has(p.id);
                return (
                  <tr
                    key={p.id}
                    style={{
                      background: isDirty
                        ? "rgba(217,119,6,0.05)"
                        : undefined,
                      outline: isDirty
                        ? "1px solid rgba(217,119,6,0.3)"
                        : undefined,
                    }}
                  >
                    {/* Название */}
                    <td>
                      <input
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.name}
                        onChange={(e) =>
                          update(p.id, "name", e.target.value)
                        }
                      />
                    </td>

                    {/* Артикул */}
                    <td>
                      <input
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.sku}
                        onChange={(e) =>
                          update(p.id, "sku", e.target.value)
                        }
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
                          update(p.id, "price", Number(e.target.value))
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

                    {/* Материал */}
                    <td>
                      <input
                        className="admin-input"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        value={p.material}
                        onChange={(e) =>
                          update(p.id, "material", e.target.value)
                        }
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

      {/* Нижняя кнопка */}
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