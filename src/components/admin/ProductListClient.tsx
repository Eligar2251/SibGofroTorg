// src/components/admin/ProductListClient.tsx
"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Eye,
  EyeOff,
  Trash2,
  Loader2,
  Edit2,
  QrCode,
  RefreshCw,
  Printer,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { normalizeProductLabelColor } from "@/lib/product-fields";

interface ProductItem {
  id: string;
  name: string;
  slug: string;
  sku?: string | null;
  barcode?: string | null;
  categoryId?: string | null;
  price: number | null;
  priceWholesale?: number | null;
  stockQty: number;
  inStock: boolean;
  isPromo: boolean;
  promoLabel?: string | null;
  promoLabelColor?: string | null;
  promoLabelTextColor?: string | null;
  madeToOrder?: boolean | null;
  madeToOrderMinQty?: number | null;
  isCuttable?: boolean | null;
  cutMetersPerRoll?: number | null;
  cutPricePerMeter?: number | null;
  isVisible: boolean;
  isFeatured?: boolean;
  featuredOrder?: number | null;
  isSale?: boolean;
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
  const [selectedVisibility, setSelectedVisibility] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [fixingBarcodes, setFixingBarcodes] = useState(false);
  const [barcodeMessage, setBarcodeMessage] = useState<string | null>(null);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  function formatCutStock(rolls: number, mpr: number | null | undefined) {
    const r = Math.max(0, Number(rolls)||0);
    const m = Math.max(0, Number(mpr)||0);
    if (!m) return `${r} шт.`;
    const full = Math.floor(r + 1e-9);
    const rem = Math.round((r - full) * m * 100)/100;
    const total = Math.round(r*m*100)/100;
    if (rem > 0.009) return `${full} рул.+${rem}м (${total}м)`;
    return `${full} рул. (${total}м)`;
  }

  // Поиск через useDeferredValue: буквы в поле появляются сразу, а тяжёлая
  // перерисовка таблицы (сотни строк) идёт следом с низким приоритетом.
  // Раньше каждое нажатие клавиши перефильтровывало и перерисовывало весь
  // список синхронно — на большом каталоге это давало заметный лаг ввода.
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    const query = deferredSearch.toLowerCase();
    const digits = query.replace(/\s+/g, "");
    return products.filter((p) => {
      if (selectedCategory !== "all" && p.categoryId !== selectedCategory) return false;
      if (selectedStock === "in" && p.stockQty <= 0) return false;
      if (selectedStock === "out" && p.stockQty > 0) return false;
      if (selectedVisibility === "visible" && !p.isVisible) return false;
      if (selectedVisibility === "hidden" && p.isVisible) return false;
      if (!query) return true;
      return (
        (p.name && p.name.toLowerCase().includes(query)) ||
        (p.sku && p.sku.toLowerCase().includes(query)) ||
        (p.barcode && p.barcode.includes(digits))
      );
    });
  }, [products, deferredSearch, selectedCategory, selectedStock, selectedVisibility]);

  // «Обновить штрихкоды»: дозаписывает коды только товарам без кода
  // или с битым/дублирующимся. У товаров с валидным кодом ничего не
  // меняет — штрихкод остаётся один и навсегда.
  async function handleFixBarcodes() {
    if (fixingBarcodes) return;
    setFixingBarcodes(true);
    setBarcodeMessage(null);
    try {
      const res = await fetch("/api/admin/products/barcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setBarcodeMessage(
          `Ошибка: ${data?.error || "не удалось обновить штрихкоды"}`
        );
      } else if (data.assigned > 0) {
        setBarcodeMessage(
          `Готово: новые штрихкоды присвоены ${data.assigned} товарам ` +
            `(всего ${data.total}, уже с кодом — ${data.skipped}). ` +
            `Существующие коды не менялись.`
        );
        // Небольшая задержка, чтобы сообщение успели прочитать.
        window.setTimeout(() => window.location.reload(), 1500);
      } else {
        setBarcodeMessage(
          `Все товары уже имеют корректные штрихкоды (проверено: ${data.total}). Менять нечего.`
        );
      }
    } catch (e) {
      console.error(e);
      setBarcodeMessage("Ошибка сети — попробуйте ещё раз");
    }
    setFixingBarcodes(false);
  }

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
              color: "var(--adm-ink-muted)",
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

        <select
          className="admin-select"
          value={selectedVisibility}
          onChange={(e) => setSelectedVisibility(e.target.value)}
          style={{ minWidth: 150 }}
        >
          <option value="all">Любая видимость</option>
          <option value="visible">Видимые</option>
          <option value="hidden">Скрытые</option>
        </select>

        <button
          type="button"
          onClick={handleFixBarcodes}
          disabled={fixingBarcodes}
          className="admin-btn admin-btn--ghost"
          title="Присвоить штрихкоды товарам, у которых их нет или они битые/дублируются. Рабочие коды НЕ меняются — штрихкод остаётся один и навсегда."
        >
          {fixingBarcodes ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Обновить штрихкоды
        </button>

        <Link
          href={`/${adminPath}/products/box-report`}
          className="admin-btn admin-btn--ghost"
          style={{ background: 'rgba(59,130,246,0.08)', color: 'var(--adm-primary)', borderColor: 'rgba(59,130,246,0.3)' }}
          prefetch={false}
          title="Отчёт по коробкам: выбор столбцов, печать и скачивание таблицы (например, только размеры без названия)"
        >
          <Printer size={14} /> Отчёт по коробкам
        </Link>

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

      {barcodeMessage && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.45,
            background: "rgba(22,163,74,0.08)",
            border: "1px solid rgba(22,163,74,0.25)",
            color: "var(--green-dark, #166534)",
          }}
        >
          {barcodeMessage}
        </div>
      )}

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
                    style={{ cursor: "pointer" }}
                  />
                </th>
                <th>Товар</th>
                <th>Категория</th>
                <th>Цена</th>
                <th style={{ width: 105 }}>Склад</th>
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
                        style={{ cursor: "pointer" }}
                      />
                    </td>
                    <td>
                      <div className="admin-product-cell">
                        <div className="admin-product-thumb">
                          {product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.imageUrl} alt="" loading="lazy" decoding="async" />
                          ) : (
                            <GlyphIcon value="box" size={16} />
                          )}
                        </div>
                        <div>
                          <div className="admin-product-name">{product.name}</div>
                          <div className="admin-product-sku">
                            {product.sku || "—"}
                          </div>
                          {product.barcode && (
                            <div
                              className="admin-product-sku"
                              style={{ fontFamily: "var(--f-mono, monospace)" }}
                              title="Постоянный штрихкод товара (EAN-13)"
                            >
                              {product.barcode}
                            </div>
                          )}
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
                            Под заказ{product.madeToOrderMinQty ? ` от ${product.madeToOrderMinQty} шт.` : ""}
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
                      <Link
                        href={`/${adminPath}/warehouse?tab=stock&product=${product.id}`}
                        prefetch={false}
                        title="Открыть расширенную сводку: заказы, поступления и недостача"
                      >
                        <span
                          className={`admin-stock-count${
                            product.stockQty <= 0
                              ? " admin-stock-count--zero"
                              : ""
                          }`}
                        >
                          {product.isCuttable && Number(product.cutMetersPerRoll) > 0 ? formatCutStock(product.stockQty, product.cutMetersPerRoll) : `${product.stockQty.toLocaleString("ru-RU")} шт.`}
                        </span>
                      </Link>
                      {product.isCuttable && Number(product.cutMetersPerRoll) > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--adm-muted)' }}>рулон {product.cutMetersPerRoll || 100}м · {product.cutPricePerMeter ? `${product.cutPricePerMeter} ₽/м` : ''}</div>
                      )}
                    </td>
                    <td>
                      <span
                        className="admin-views-cell"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 12,
                          background: (product.viewCount ?? 0) > 0 ? "#ffffff" : "#1a1a18",
                          color: (product.viewCount ?? 0) > 0 ? "#111111" : "#ffffff",
                          border: (product.viewCount ?? 0) > 0 ? "1px solid #dbd8d0" : "1px solid #1a1a18",
                        }}
                        title="Уникальные посетители страницы товара"
                      >
                        <Eye size={12} style={{ opacity: (product.viewCount ?? 0) > 0 ? 0.7 : 0.9, flexShrink: 0 }} />
                        {(product.viewCount ?? 0).toLocaleString("ru-RU")}
                      </span>
                    </td>
                    <td>
                      <div className="admin-row">
                        {product.stockQty > 0 ? (
                          <span className="admin-badge admin-badge--green">
                            В наличии
                          </span>
                        ) : (
                          <span className="admin-badge admin-badge--red">
                            Нет
                          </span>
                        )}
                        {product.isPromo && (
                          <span
                            className="admin-badge admin-badge--amber"
                            style={{
                              backgroundColor: normalizeProductLabelColor(product.promoLabelColor) || undefined,
                              color: normalizeProductLabelColor(product.promoLabelTextColor) || undefined,
                              borderColor: normalizeProductLabelColor(product.promoLabelColor) || undefined,
                            }}
                          >
                            {product.promoLabel || "Акция"}
                          </span>
                        )}
                        {product.isFeatured && (
                          <span className="admin-badge admin-badge--blue">
                            Популярный{product.featuredOrder ? ` · #${product.featuredOrder}` : ""}
                          </span>
                        )}
                        {product.isSale && (
                          <span className="admin-badge admin-badge--red">
                            Распродажа
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="admin-actions">
                        <Link
                          href={`/${adminPath}/products/${product.id}`}
                          prefetch={false}
                          className="admin-btn admin-btn--icon"
                          title="Редактировать"
                        >
                          <Edit2 size={15} />
                        </Link>
                        <Link
                          href={`/${adminPath}/scan/${(product as any).qrSlug || (product as any).barcode || product.id}`}
                          prefetch={false}
                          className="admin-btn admin-btn--icon"
                          title="QR + штрихкод"
                        >
                          <QrCode size={15} />
                        </Link>
                        <Link
                          href={`/catalog/product/${product.slug}`}
                          prefetch={false}
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
