// src/components/admin/ProductListClient.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Eye, EyeOff, Trash2, Loader2, Edit2 } from "lucide-react";

interface ProductItem {
  id: string;
  name: string;
  slug: string;
  sku?: string | null;
  categoryId?: string | null;
  price: number | null;
  priceWholesale?: number | null;
  inStock: boolean;
  isPromo: boolean;
  promoLabel?: string | null;
  madeToOrder?: boolean | null;
  isVisible: boolean;
  imageUrl?: string | null;
  viewCount?: number;
}

export function ProductListClient({
  products,
  categories,
  adminPath,
}: {
  products: ProductItem[];
  categories: { id: string; name: string }[];
  adminPath: string;
}) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStock, setSelectedStock] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  const filtered = products.filter((p) => {
    if (selectedCategory !== "all" && p.categoryId !== selectedCategory) return false;
    if (selectedStock === "in" && !p.inStock) return false;
    if (selectedStock === "out" && p.inStock) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (p.name && p.name.toLowerCase().includes(s)) ||
      (p.sku && p.sku.toLowerCase().includes(s))
    );
  });

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

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Удалить выбранные товары (${selectedIds.size} шт.)? Это действие необратимо.`))
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/products/bulk`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (e) {
      console.error(e);
    }
    setDeleting(false);
  }

  return (
    <div className="admin-stack">
      {/* Поиск и фильтры */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
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

        <select
          className="admin-select"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          style={{ minWidth: 180 }}
        >
          <option value="all">Все категории</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          className="admin-select"
          value={selectedStock}
          onChange={(e) => setSelectedStock(e.target.value)}
          style={{ minWidth: 150 }}
        >
          <option value="all">Все наличие</option>
          <option value="in">В наличии</option>
          <option value="out">Нет в наличии</option>
        </select>

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
      </div>

      {/* Таблица товаров */}
      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 44, textAlign: "center" }}>
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
                <th>Товар</th>
                <th>Категория</th>
                <th>Цена</th>
                <th style={{ width: 110 }} title="Уникальные посетители страницы товара">
                  Просмотры
                </th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => {
                const isSelected = selectedIds.has(product.id);
                return (
                  <tr
                    key={product.id}
                    style={{
                      background: isSelected
                        ? "rgba(200,134,10,0.06)"
                        : undefined,
                    }}
                  >
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(product.id)}
                        style={{ cursor: "pointer", accentColor: "var(--adm-kraft)" }}
                      />
                    </td>
                    <td>
                      <div className="admin-product-cell">
                        <div className="admin-product-thumb">
                          {product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.imageUrl} alt="" />
                          ) : (
                            "📦"
                          )}
                        </div>
                        <div>
                          <div className="admin-product-name">{product.name}</div>
                          <div className="admin-product-sku">
                            {product.sku || "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="admin-muted">
                      {product.categoryId
                        ? catMap.get(product.categoryId) || "—"
                        : "—"}
                    </td>
                    <td>
                      <div className="admin-price">
                        {product.madeToOrder ? (
                          <span style={{ color: "var(--green-dark)", fontWeight: 700 }}>
                            Под заказ
                          </span>
                        ) : product.price != null ? (
                          `${product.price.toLocaleString("ru-RU")} ₽`
                        ) : (
                          "по запросу"
                        )}
                      </div>
                      {product.priceWholesale != null && (
                        <div className="admin-price-opt">
                          опт: {product.priceWholesale.toLocaleString("ru-RU")} ₽
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className="admin-views-cell"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 600,
                          color: (product.viewCount ?? 0) > 0 ? "var(--ink)" : "var(--ink-faint)",
                        }}
                        title="Уникальные посетители страницы товара"
                      >
                        <Eye size={14} style={{ opacity: 0.55, flexShrink: 0 }} />
                        {(product.viewCount ?? 0).toLocaleString("ru-RU")}
                      </span>
                    </td>
                    <td>
                      <div className="admin-row">
                        {product.inStock ? (
                          <span className="admin-badge admin-badge--green">
                            В наличии
                          </span>
                        ) : (
                          <span className="admin-badge admin-badge--red">
                            Нет
                          </span>
                        )}
                        {product.isPromo && (
                          <span className="admin-badge admin-badge--amber">
                            {product.promoLabel || "Акция"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="admin-actions">
                        <Link
                          href={`/${adminPath}/products/${product.id}`}
                          className="admin-btn admin-btn--icon"
                          title="Редактировать"
                        >
                          <Edit2 size={15} />
                        </Link>
                        <Link
                          href={`/catalog/product/${product.slug}`}
                          className="admin-btn admin-btn--icon"
                          title="Просмотр"
                          target="_blank"
                        >
                          {product.isVisible ? (
                            <Eye size={16} />
                          ) : (
                            <EyeOff size={16} />
                          )}
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="admin-table__empty">
              {search || selectedCategory !== "all" || selectedStock !== "all"
                ? "Ничего не найдено по заданным критериям поиска"
                : "Товаров пока нет"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
