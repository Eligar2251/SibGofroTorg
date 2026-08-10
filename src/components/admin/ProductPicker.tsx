// =========================================================
// FILE: src/components/admin/ProductPicker.tsx
// Поиск и выбор товара в формах учёта (комбобокс)
// =========================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export interface PickerProduct {
  id: string;
  name: string;
  sku: string | null;
  /** Цена продажи (эффективная, со скидкой) */
  price: number | null;
  /** Оптовая цена — подсказка для закупки */
  priceWholesale: number | null;
  /** Закупочная цена товара (если задана в карточке) */
  purchasePrice?: number | null;
  stockQty: number;
}

export function ProductPicker({
  products,
  onPick,
  placeholder = "Начните вводить название или артикул...",
}: {
  products: PickerProduct[];
  onPick: (p: PickerProduct) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const results = q
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q))
      )
    : products;

  return (
    <div className="wh-picker" ref={wrapRef}>
      <div className="wh-picker__input-wrap">
        <Search size={13} className="wh-picker__icon" />
        <input
          type="text"
          className="admin-input wh-picker__input"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {query && (
          <button
            type="button"
            className="wh-picker__clear"
            onClick={() => setQuery("")}
            aria-label="Очистить"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && (
        <div className="wh-picker__list">
          {results.length === 0 ? (
            <div className="wh-picker__empty">Ничего не найдено</div>
          ) : (
            results.slice(0, 50).map((p) => (
              <button
                key={p.id}
                type="button"
                className="wh-picker__opt"
                onClick={() => {
                  onPick(p);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="wh-picker__opt-name">
                  {p.name}
                  {p.sku && <span className="wh-picker__opt-sku">{p.sku}</span>}
                </span>
                <span className="wh-picker__opt-meta">
                  ост. {p.stockQty}
                  {p.price != null && ` · ${p.price.toLocaleString("ru-RU")} ₽`}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
