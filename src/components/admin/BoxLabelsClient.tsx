// =========================================================
// FILE: src/components/admin/BoxLabelsClient.tsx
// Отдельная печать этикеток ЯЩИКОВ: лист A4 вертикально,
// одна этикетка = одна страница.
//
// Макет — одна ГОРИЗОНТАЛЬНАЯ полоса на всю ширину A4:
//   [ № 670 | размеры | штрихкод ]
// Название товара, артикул и прочий текст на этикетке не печатаются.
//
// Товары подставляются автоматически (№ = артикул, размеры из
// карточки), но каждая этикетка редактируется вручную прямо
// на странице перед печатью.
// =========================================================

"use client";

/* eslint-disable @next/next/no-img-element -- SVG штрихкода должен печататься нативным вектором. */

import { useEffect, useMemo, useState } from "react";
import { Filter, Hash, ListOrdered, Loader2, Printer, Search } from "lucide-react";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string;
  categoryId: string | null;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionUnit: string | null;
};

interface LabelData {
  boxNumber: string;
  sizes: string;
}

interface Props {
  products: Product[];
  categories: { id: string; name: string }[];
}

/** Автоматические размеры из карточки товара: «400×300×200 мм». */
function autoSizes(p: Product): string {
  const parts = [p.dimensionLength, p.dimensionWidth, p.dimensionHeight].filter(
    (v) => v != null && Number(v) > 0
  );
  if (parts.length === 0) return "";
  return `${parts.join("×")} ${p.dimensionUnit || "мм"}`;
}

function defaultLabel(p: Product): LabelData {
  return { boxNumber: p.sku || "", sizes: autoSizes(p) };
}

export function BoxLabelsClient({ products, categories }: Props) {
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Record<string, LabelData>>({});
  const [printPreparing, setPrintPreparing] = useState(false);

  // Режим печати: прячем интерфейс админки, оставляем только лист.
  useEffect(() => {
    document.body.classList.add("boxlabel-mode");
    return () => document.body.classList.remove("boxlabel-mode");
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("ru-RU");
    return products.filter((p) => {
      if (cat && p.categoryId !== cat) return false;
      if (!needle) return true;
      return `${p.name} ${p.sku || ""}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [products, cat, q]);

  const selectedProducts = useMemo(
    () => products.filter((p) => selected.has(p.id)),
    [products, selected]
  );

  function getLabel(p: Product): LabelData {
    return labels[p.id] || defaultLabel(p);
  }

  function setLabel(p: Product, patch: Partial<LabelData>) {
    setLabels((prev) => ({
      ...prev,
      [p.id]: { ...(prev[p.id] || defaultLabel(p)), ...patch },
    }));
  }

  function toggle(p: Product) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id))
    );
  }

  /** Заполнить № ящиков по порядку: 1, 2, 3… в порядке выбора. */
  function numberSequentially() {
    setLabels((prev) => {
      const next = { ...prev };
      selectedProducts.forEach((p, i) => {
        next[p.id] = { ...(next[p.id] || defaultLabel(p)), boxNumber: String(i + 1) };
      });
      return next;
    });
  }

  async function handlePrint() {
    if (printPreparing || selectedProducts.length === 0) return;
    setPrintPreparing(true);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const images = Array.from(
        document.querySelectorAll<HTMLImageElement>(".boxlabel-sheet img")
      );
      await Promise.all(
        images.map(
          (image) =>
            new Promise<void>((resolve) => {
              if (image.complete && image.naturalWidth > 0) {
                image.decode().catch(() => undefined).finally(resolve);
                return;
              }
              const done = () => resolve();
              image.addEventListener("load", done, { once: true });
              image.addEventListener("error", done, { once: true });
              window.setTimeout(done, 8000);
            })
        )
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      window.print();
    } finally {
      setPrintPreparing(false);
    }
  }

  return (
    <div className="qrprint">
      {/* Полоса занимает физическую ширину A4 — 210 мм, без CSS-полей. */}
      <style>{`@media print { @page { size: A4 portrait; margin: 0; } }`}</style>

      <div className="qrprint__filters no-print">
        <div className="qrprint__filter-row">
          <div className="qrprint__filter">
            <Filter size={14} />
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="qrprint__select">
              <option value="">Все категории ({products.length})</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="qrprint__filter" style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }} />
            <input
              className="qrprint__select"
              style={{ paddingLeft: 30 }}
              placeholder="Поиск: название или артикул"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button type="button" className="qrprint__seg-btn" onClick={toggleAll}>
            {selected.size === filtered.length && filtered.length > 0
              ? "Снять всё"
              : `Выбрать все (${filtered.length})`}
          </button>
        </div>
      </div>

      <div className="boxlabel-edit no-print">
        {filtered.map((p) => {
          const isSel = selected.has(p.id);
          const label = getLabel(p);
          return (
            <div key={p.id} className={`boxlabel-item${isSel ? " boxlabel-item--on" : ""}`}>
              <div className="boxlabel-item__head" onClick={() => toggle(p)}>
                <input type="checkbox" checked={isSel} readOnly />
                <span className="boxlabel-item__name">{p.name}</span>
                {p.sku && <span className="admin-badge admin-badge--muted">{p.sku}</span>}
              </div>
              {isSel && (
                <div className="boxlabel-item__form" onClick={(e) => e.stopPropagation()}>
                  <div className="admin-field" style={{ marginBottom: 0 }}>
                    <label className="admin-label">
                      <Hash size={11} /> № ящика (крупно на этикетке)
                    </label>
                    <input
                      className="admin-input"
                      value={label.boxNumber}
                      onChange={(e) => setLabel(p, { boxNumber: e.target.value })}
                      placeholder="например 14 или АРТ-001"
                    />
                  </div>
                  <div className="admin-field" style={{ marginBottom: 0 }}>
                    <label className="admin-label">Размеры коробки</label>
                    <input
                      className="admin-input"
                      value={label.sizes}
                      onChange={(e) => setLabel(p, { sizes: e.target.value })}
                      placeholder="400×300×200 мм"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="admin-empty">Ничего не найдено</div>
        )}
      </div>

      <div
        className="no-print"
        style={{ display: "flex", gap: 10, alignItems: "center", margin: "14px 0", flexWrap: "wrap" }}
      >
        <button
          type="button"
          className="admin-btn admin-btn--outline"
          disabled={selectedProducts.length === 0}
          onClick={numberSequentially}
          title="Заполнит № ящиков 1, 2, 3… по порядку выбора"
        >
          <ListOrdered size={15} /> № по порядку
        </button>
        <button
          type="button"
          className="qrprint__print-btn"
          disabled={selectedProducts.length === 0 || printPreparing}
          onClick={handlePrint}
        >
          {printPreparing ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
          {printPreparing ? "Подготавливаем штрихкоды…" : `Печатать ${selectedProducts.length} этикеток`}
        </button>
      </div>

      {/* ── Печатный лист: превью на экране + печать ──
          Горизонтальные полосы 60мм высотой, несколько на листе A4 вертикально */}
      <div className={`boxlabel-sheet${selectedProducts.length ? " boxlabel-sheet--preview" : ""}`}>
        {selectedProducts.map((p) => {
          const label = getLabel(p);
          return (
            <div key={p.id} className="boxlabel">
              <div className="boxlabel__band">
                <div className="boxlabel__cell boxlabel__num">
                  № {label.boxNumber || "—"}
                </div>
                <div className="boxlabel__vsep" />
                <div className="boxlabel__cell boxlabel__info">
                  <div className="boxlabel__sizes">{label.sizes || "—"}</div>
                </div>
                <div className="boxlabel__vsep" />
                <div className="boxlabel__cell boxlabel__code">
                  <img
                    src={`/api/admin/qr/barcode/${p.id}?format=svg&height=35`}
                    alt={`Штрихкод ${p.barcode}`}
                    className="boxlabel__bc"
                  />
                  <div className="boxlabel__ean">{p.barcode}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
