// =========================================================
// FILE: src/components/admin/PrintLabelsClient.tsx
// Клиентская часть страницы массовой печати QR.
//
// Что делает:
// 1) Фильтр по категории + поиск по названию/SKU.
// 2) Чекбоксы на каждый товар (по умолчанию отмечены все видимые).
// 3) Превью этикеток в виде сетки — каждая этикетка с QR, штрихкодом,
//    названием, артикулом и ценой.
// 4) Кнопка «Печатать N шт» — window.print(). Специальный @media print
//    CSS оставляет только сетку этикеток.
//
// Размер этикетки в режиме печати: 4×5 см (по умолчанию). 24 этикетки
// на листе A4. Можно переключить на 3×3 см (54 шт) или 5×7 см (12 шт).
// =========================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer, Search, Filter, Square, CheckSquare } from "lucide-react";

type Product = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  price: number | null;
  inStock: boolean;
  barcode: string;
  qrSlug: string;
  categoryId: string | null;
};

interface Props {
  products: Product[];
  categories: { id: string; name: string }[];
  selectedCategory: string;
  query: string;
  adminPath: string;
}

type LabelSize = "3x3" | "4x5" | "5x7";

const fmt = (n: number) => n.toLocaleString("ru-RU");

function formatBarcode(s: string): string {
  if (s.length !== 13) return s;
  return `${s.slice(0, 3)} ${s.slice(3, 7)} ${s.slice(7, 12)} ${s.slice(12)}`;
}

const LABEL_DIM: Record<
  LabelSize,
  { cm: string; cols: number; rows: number; qrSize: number }
> = {
  "3x3": { cm: "3.5cm 3.5cm", cols: 6, rows: 8, qrSize: 70 },
  "4x5": { cm: "4.5cm 5cm", cols: 5, rows: 5, qrSize: 95 },
  "5x7": { cm: "6cm 7.5cm", cols: 3, rows: 3, qrSize: 130 },
};

export function PrintLabelsClient({
  products,
  categories,
  selectedCategory: initialCat,
  query: initialQ,
}: Props) {
  const [cat, setCat] = useState<string>(initialCat);
  const [q, setQ] = useState<string>(initialQ);
  const [size, setSize] = useState<LabelSize>("4x5");
  const [selected, setSelected] = useState<Set<string>>(() => {
    // По умолчанию отмечены все видимые и в наличии
    return new Set(
      products.filter((p) => p.inStock).map((p) => p.id)
    );
  });

  // Фильтрация
  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (cat && p.categoryId !== cat) return false;
      if (q) {
        const needle = q.toLowerCase();
        const haystack = `${p.name} ${p.sku || ""} ${p.barcode}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [products, cat, q]);

  function toggleAll(on: boolean) {
    if (on) {
      setSelected(new Set(filtered.map((p) => p.id)));
    } else {
      setSelected(new Set());
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedProducts = filtered.filter((p) => selected.has(p.id));
  const dim = LABEL_DIM[size];

  // При монтировании снимаем фокус с авто-инпутов, чтобы они не
  // получали синюю рамку при печати.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("qrprint-mode");
    return () => document.body.classList.remove("qrprint-mode");
  }, []);

  return (
    <div className="qrprint">
      <div className="qrprint__filters no-print">
        <div className="qrprint__filter-row">
          <div className="qrprint__filter">
            <Filter size={14} />
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className="qrprint__select"
            >
              <option value="">Все категории ({products.length})</option>
              {categories.map((c) => {
                const count = products.filter(
                  (p) => p.categoryId === c.id
                ).length;
                return (
                  <option key={c.id} value={c.id}>
                    {c.name} ({count})
                  </option>
                );
              })}
            </select>
          </div>
          <div className="qrprint__search">
            <Search size={14} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по названию / SKU / штрихкоду"
            />
          </div>
        </div>
        <div className="qrprint__toolbar">
          <div className="qrprint__counts">
            <strong>{filtered.length}</strong> найдено · выбрано{" "}
            <strong>{selectedProducts.length}</strong>
          </div>
          <div className="qrprint__seg">
            <button
              type="button"
              onClick={() => toggleAll(true)}
              className="qrprint__seg-btn"
            >
              Все
            </button>
            <button
              type="button"
              onClick={() => toggleAll(false)}
              className="qrprint__seg-btn"
            >
              Снять
            </button>
            <span className="qrprint__seg-divider" />
            <span className="qrprint__seg-label">Размер этикетки:</span>
            {(["3x3", "4x5", "5x7"] as LabelSize[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={`qrprint__seg-btn${
                  size === s ? " qrprint__seg-btn--active" : ""
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="qrprint__print-btn"
            disabled={selectedProducts.length === 0}
          >
            <Printer size={15} />
            Печатать {selectedProducts.length} шт
          </button>
        </div>
      </div>

      <div className="qrprint__list no-print">
        {filtered.length === 0 && (
          <div className="qrprint__empty">Ничего не найдено по фильтру</div>
        )}
        {filtered.map((p) => (
          <label
            key={p.id}
            className={`qrprint__row${
              selected.has(p.id) ? " qrprint__row--on" : ""
            }${!p.inStock ? " qrprint__row--out" : ""}`}
          >
            <span className="qrprint__check">
              {selected.has(p.id) ? (
                <CheckSquare size={16} />
              ) : (
                <Square size={16} />
              )}
            </span>
            <input
              type="checkbox"
              checked={selected.has(p.id)}
              onChange={() => toggle(p.id)}
              className="qrprint__cb"
            />
            <span className="qrprint__row-name">{p.name}</span>
            {p.sku && <span className="qrprint__row-sku">{p.sku}</span>}
            <span className="qrprint__row-price">
              {p.price != null ? `${fmt(p.price)} ₽` : "—"}
            </span>
            <span className="qrprint__row-barcode">
              {formatBarcode(p.barcode)}
            </span>
          </label>
        ))}
      </div>

      {/* ── Лист для печати: виден только в @media print, иначе
            показывается как превью в сером фоне ── */}
      <div
        className="qrprint__sheet"
        style={
          {
            "--qr-cols": dim.cols,
            "--qr-rows": dim.rows,
            "--qr-size": dim.qrSize,
          } as React.CSSProperties
        }
      >
        {selectedProducts.map((p) => (
          <div
            key={p.id}
            className="qrprint__label"
            style={{ width: dim.cm.split(" ")[0], height: dim.cm.split(" ")[1] }}
          >
            <div className="qrprint__label-name">{p.name}</div>
            {p.sku && <div className="qrprint__label-sku">{p.sku}</div>}
            <img
              src={`/api/admin/qr/${p.id}?size=${dim.qrSize}`}
              alt=""
              className="qrprint__label-qr"
              width={dim.qrSize}
              height={dim.qrSize}
            />
            <img
              src={`/api/admin/qr/barcode/${p.id}`}
              alt=""
              className="qrprint__label-bc"
              width={dim.qrSize + 30}
              height={36}
            />
            <div className="qrprint__label-meta">
              <span className="qrprint__label-price">
                {p.price != null ? `${fmt(p.price)} ₽` : ""}
              </span>
              <span className="qrprint__label-code">
                {formatBarcode(p.barcode)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
