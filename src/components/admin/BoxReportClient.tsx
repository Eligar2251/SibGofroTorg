"use client";

import { useState, useMemo, useEffect, type CSSProperties } from "react";
import {
  Printer,
  Download,
  Search,
  Check,
  Square,
  Box,
  Type,
  LayoutGrid,
} from "lucide-react";

interface BoxProduct {
  id: string;
  name: string;
  sku?: string | null;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  material?: string | null;
  packQty?: number | null;
  volume?: number | null;
  price?: number | null;
  priceWholesale?: number | null;
  stockQty?: number | null;
  note?: string | null;
  categoryName?: string | null;
}

type FieldKey =
  | "name"
  | "sku"
  | "dimensions"
  | "length"
  | "width"
  | "height"
  | "material"
  | "packQty"
  | "volume"
  | "price"
  | "priceWholesale"
  | "stockQty"
  | "note"
  | "category";

type PrintLayout = "compact" | "large";
type PageOrientation = "portrait" | "landscape";

const FIELD_LABELS: Record<FieldKey, string> = {
  name: "Название",
  sku: "Артикул",
  dimensions: "Размеры (Д×Ш×В)",
  length: "Длина",
  width: "Ширина",
  height: "Высота",
  material: "Материал / Марка",
  packQty: "В упаковке",
  volume: "Объём, л",
  price: "Цена, ₽",
  priceWholesale: "Опт, ₽",
  stockQty: "Остаток",
  note: "Примечание",
  category: "Категория",
};

/** Поля, которые обычно крупнее в прайс-таблице */
const EMPHASIS_FIELDS = new Set<FieldKey>(["name", "dimensions", "price", "priceWholesale"]);

const STORAGE_KEY = "box-report-prefs-v2";

const DEFAULT_FIELDS: Record<FieldKey, boolean> = {
  name: true,
  sku: false,
  dimensions: true,
  length: false,
  width: false,
  height: false,
  material: false,
  packQty: false,
  volume: false,
  price: true,
  priceWholesale: false,
  stockQty: false,
  note: false,
  category: false,
};

function loadPrefs(): {
  fields?: Record<FieldKey, boolean>;
  layout?: PrintLayout;
  orientation?: PageOrientation;
} {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as {
      fields?: Record<FieldKey, boolean>;
      layout?: PrintLayout;
      orientation?: PageOrientation;
    };
  } catch {
    return {};
  }
}

/**
 * Авто-масштаб для крупной таблицы на A4.
 * Чем больше строк — тем меньше шрифт/паддинги, чтобы всё влезало.
 */
function largeTableScale(rowCount: number, colCount: number, orientation: PageOrientation) {
  // Ориентир: на портрете ~14–18 крупных строк, на альбоме ~10–14
  const baseRows = orientation === "landscape" ? 12 : 16;
  const rowFactor = Math.min(1.15, Math.max(0.42, baseRows / Math.max(rowCount, 1)));
  // Много колонок чуть сжимает
  const colFactor = Math.min(1, Math.max(0.72, 5 / Math.max(colCount, 1)));
  const factor = rowFactor * colFactor;

  const namePx = Math.round(22 * factor);
  const bodyPx = Math.round(18 * factor);
  const headPx = Math.round(13 * factor);
  const padY = Math.max(4, Math.round(14 * factor));
  const padX = Math.max(6, Math.round(16 * factor));
  const numPx = Math.round(14 * factor);
  const titlePx = Math.round(20 * factor);

  return {
    factor,
    namePx: Math.max(11, namePx),
    bodyPx: Math.max(10, bodyPx),
    headPx: Math.max(9, headPx),
    padY,
    padX,
    numPx: Math.max(10, numPx),
    titlePx: Math.max(12, titlePx),
    label:
      factor >= 0.95
        ? "очень крупно"
        : factor >= 0.75
          ? "крупно"
          : factor >= 0.55
            ? "средне"
            : "компактно",
  };
}

export function BoxReportClient({ products }: { products: BoxProduct[] }) {
  const prefs = useMemo(() => loadPrefs(), []);

  const [search, setSearch] = useState("");
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.categoryName) set.add(p.categoryName);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [products]);

  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(products.map((p) => p.id))
  );
  const [fields, setFields] = useState<Record<FieldKey, boolean>>(
    () => ({ ...DEFAULT_FIELDS, ...(prefs.fields || {}) })
  );
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [layout, setLayout] = useState<PrintLayout>(prefs.layout || "large");
  const [orientation, setOrientation] = useState<PageOrientation>(
    prefs.orientation || "portrait"
  );
  /** 0 = авто, иначе 70–130 % к авто-масштабу */
  const [scaleBoost, setScaleBoost] = useState(100);

  // Запоминаем выбор полей / макет
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ fields, layout, orientation })
      );
    } catch {
      /* ignore */
    }
  }, [fields, layout, orientation]);

  const filtered = useMemo(() => {
    let list = products;
    if (selectedCategory !== "all") {
      list = list.filter((p) => p.categoryName === selectedCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          (p.material && p.material.toLowerCase().includes(q))
      );
    }
    if (showOnlySelected) {
      list = list.filter((p) => selectedIds.has(p.id));
    }
    return list;
  }, [products, selectedCategory, search, showOnlySelected, selectedIds]);

  function toggleProduct(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filtered.forEach((p) => next.add(p.id));
      return next;
    });
  }

  function deselectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filtered.forEach((p) => next.delete(p.id));
      return next;
    });
  }

  const selectedProducts = useMemo(
    () => products.filter((p) => selectedIds.has(p.id)),
    [products, selectedIds]
  );

  function formatDimensions(p: BoxProduct): string {
    const l = p.dimensionLength != null ? Number(p.dimensionLength) : null;
    const w = p.dimensionWidth != null ? Number(p.dimensionWidth) : null;
    const h = p.dimensionHeight != null ? Number(p.dimensionHeight) : null;
    const unit = p.dimensionUnit || "мм";
    if (l == null && w == null && h == null) return "—";
    const parts = [l, w, h]
      .filter((v) => v != null && Number.isFinite(v) && (v as number) > 0)
      .map((v) => String(v));
    if (parts.length === 0) return "—";
    return `${parts.join("×")} ${unit}`;
  }

  function getFieldValue(p: BoxProduct, key: FieldKey): string {
    switch (key) {
      case "name":
        return p.name || "—";
      case "sku":
        return p.sku || "—";
      case "dimensions":
        return formatDimensions(p);
      case "length":
        return p.dimensionLength != null ? String(p.dimensionLength) : "—";
      case "width":
        return p.dimensionWidth != null ? String(p.dimensionWidth) : "—";
      case "height":
        return p.dimensionHeight != null ? String(p.dimensionHeight) : "—";
      case "material":
        return p.material || "—";
      case "packQty":
        return p.packQty != null ? String(p.packQty) : "—";
      case "volume":
        return p.volume != null ? String(p.volume) : "—";
      case "price":
        return p.price != null
          ? `${Number(p.price).toLocaleString("ru-RU")} ₽`
          : "—";
      case "priceWholesale":
        return p.priceWholesale != null
          ? `${Number(p.priceWholesale).toLocaleString("ru-RU")} ₽`
          : "—";
      case "stockQty":
        return p.stockQty != null ? String(p.stockQty) : "—";
      case "note":
        return p.note || "—";
      case "category":
        return p.categoryName || "—";
      default:
        return "";
    }
  }

  const activeFields = (Object.keys(fields) as FieldKey[]).filter((k) => fields[k]);

  const scale = useMemo(() => {
    const auto = largeTableScale(
      selectedProducts.length,
      activeFields.length + 1,
      orientation
    );
    const boost = scaleBoost / 100;
    return {
      ...auto,
      namePx: Math.max(10, Math.round(auto.namePx * boost)),
      bodyPx: Math.max(9, Math.round(auto.bodyPx * boost)),
      headPx: Math.max(8, Math.round(auto.headPx * boost)),
      padY: Math.max(3, Math.round(auto.padY * boost)),
      padX: Math.max(5, Math.round(auto.padX * boost)),
      numPx: Math.max(9, Math.round(auto.numPx * boost)),
      titlePx: Math.max(11, Math.round(auto.titlePx * boost)),
    };
  }, [selectedProducts.length, activeFields.length, orientation, scaleBoost]);

  function handlePrint() {
    window.print();
  }

  function escapeXml(str: string): string {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function handleExportExcel() {
    if (selectedProducts.length === 0 || activeFields.length === 0) {
      alert("Выберите хотя бы один товар и одно поле");
      return;
    }
    const headCells = activeFields
      .map(
        (k) =>
          `<th style="border:1px solid #999;padding:6px 8px;background:#eee;font-weight:bold;text-align:left;">${escapeXml(FIELD_LABELS[k])}</th>`
      )
      .join("");
    const bodyRows = selectedProducts
      .map((p, idx) => {
        const cells = activeFields
          .map(
            (k) =>
              `<td style="border:1px solid #999;padding:6px 8px;mso-number-format:'\\@';">${escapeXml(getFieldValue(p, k))}</td>`
          )
          .join("");
        return `<tr><td style="border:1px solid #999;padding:6px 8px;">${idx + 1}</td>${cells}</tr>`;
      })
      .join("");

    const html =
      `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
      `<head><meta charset="utf-8" />` +
      `<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>` +
      `<x:Name>Коробки</x:Name>` +
      `<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>` +
      `</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->` +
      `<style>table{border-collapse:collapse;font-family:Arial;font-size:11px;} th,td{border:1px solid #999;padding:6px 8px;}</style>` +
      `</head><body>` +
      `<div style="font-family:Arial;font-size:14px;font-weight:bold;margin-bottom:8px;">Отчёт по коробкам (${new Date().toLocaleDateString("ru-RU")})</div>` +
      `<table><thead><tr><th style="border:1px solid #999;padding:6px 8px;background:#eee;font-weight:bold;">№</th>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>` +
      `</body></html>`;

    const blob = new Blob(["\ufeff", html], {
      type: "application/vnd.ms-excel;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Коробки_отчет_${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleExportCsv() {
    if (selectedProducts.length === 0 || activeFields.length === 0) {
      alert("Выберите хотя бы один товар и одно поле");
      return;
    }
    const header = activeFields.map((k) => FIELD_LABELS[k]).join(";");
    const rows = selectedProducts.map((p) =>
      activeFields
        .map((k) => {
          const v = getFieldValue(p, k);
          const cleaned = String(v).replace(/"/g, '""');
          return `"${cleaned}"`;
        })
        .join(";")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Коробки_отчет_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function applyPreset(keys: FieldKey[]) {
    const set = new Set(keys);
    setFields(
      Object.fromEntries(
        (Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => [k, set.has(k)])
      ) as Record<FieldKey, boolean>
    );
  }

  const isLarge = layout === "large";
  const previewWidth = orientation === "landscape" ? 297 : 210;
  const previewHeight = orientation === "landscape" ? 210 : 297;

  return (
    <div className="admin-stack box-report">
      <style>{`
        /* ── Экранный предпросмотр ── */
        .box-report-field-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
          gap: 8px;
        }
        .box-report-field-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border: 1px solid var(--adm-border);
          border-radius: 8px;
          background: #fff;
          cursor: pointer;
          font-size: 13px;
        }
        .box-report-field-item--active {
          background: rgba(59,130,246,0.08);
          border-color: rgba(59,130,246,0.3);
        }
        .box-report-layout-toggle {
          display: inline-flex;
          border: 1px solid var(--adm-border);
          border-radius: 10px;
          overflow: hidden;
        }
        .box-report-layout-toggle button {
          border: 0;
          background: #fff;
          padding: 8px 14px;
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          color: var(--adm-ink-muted);
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .box-report-layout-toggle button + button {
          border-left: 1px solid var(--adm-border);
        }
        .box-report-layout-toggle button.is-on {
          background: var(--adm-ink-deep, #1a1a18);
          color: #fff;
        }
        .box-report-a4-stage {
          background: #e8e6e0;
          border-radius: 12px;
          padding: 20px;
          display: flex;
          justify-content: center;
          overflow: auto;
        }
        .box-report-a4-sheet {
          background: #fff;
          color: #111;
          box-shadow: 0 8px 32px rgba(0,0,0,0.12);
          width: min(100%, ${previewWidth}mm);
          min-height: ${Math.round(previewHeight * 0.55)}mm;
          padding: 12mm 10mm;
          box-sizing: border-box;
        }
        .box-report-a4-sheet h2 {
          margin: 0 0 4px;
          font-family: var(--adm-font-head, 'Oswald', sans-serif);
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: #111;
        }
        .box-report-a4-sheet .box-report-meta {
          font-size: 11px;
          color: #666;
          margin-bottom: 10px;
        }
        .box-report-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .box-report-table th,
        .box-report-table td {
          border: 1.5px solid #222;
          vertical-align: middle;
          word-break: break-word;
        }
        .box-report-table th {
          background: #f0eee8;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          text-align: left;
        }
        .box-report-table td.col-num,
        .box-report-table th.col-num {
          width: 48px;
          text-align: center;
          font-variant-numeric: tabular-nums;
        }
        .box-report-table td.col-price,
        .box-report-table th.col-price {
          text-align: right;
          white-space: nowrap;
          font-weight: 800;
        }
        .box-report-table td.col-name {
          font-weight: 800;
          line-height: 1.15;
        }
        .box-report-table td.col-dims {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.01em;
        }
        .box-report-table--compact th,
        .box-report-table--compact td {
          border: 1px solid #999;
          padding: 6px 8px;
          font-size: 11px;
        }
        .box-report-table--compact th { background: #eee; font-weight: 700; }
        .box-report-scale-hint {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 999px;
          background: var(--adm-kraft-pale, #fdf3dc);
          border: 1px solid var(--adm-kraft-line, rgba(200,134,10,0.22));
          color: var(--adm-ink);
          font-size: 12px;
          font-weight: 700;
        }

        @media print {
          @page {
            size: A4 ${orientation};
            margin: 8mm 7mm;
          }
          html, body {
            background: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body * { visibility: hidden !important; }
          .box-report-print-area,
          .box-report-print-area * { visibility: visible !important; }
          .box-report-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            box-shadow: none !important;
            border: none !important;
          }
          .box-report-print-area .admin-card__pad {
            padding: 0 !important;
          }
          .box-report-a4-stage {
            background: #fff !important;
            padding: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            overflow: visible !important;
          }
          .box-report-a4-sheet {
            width: 100% !important;
            min-height: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
          }
          .no-print { display: none !important; }
          .admin-sidebar,
          .admin-mobile-bar,
          .admin-sidebar-handle,
          .admin-notify,
          .admin-plans-shortcut,
          .admin-requests-shortcut { display: none !important; }
          .admin-content { margin: 0 !important; }
          .admin-main { padding: 0 !important; }
        }
      `}</style>

      <div className="admin-card no-print">
        <div className="admin-card__pad admin-stack">
          <h2
            className="admin-h2"
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <Box size={18} /> Отчёт по коробкам — выбор полей и печать
          </h2>
          <p className="admin-hint" style={{ marginTop: -4 }}>
            Выберите коробки и столбцы. Для прайса — режим «Крупная таблица
            A4»: название, размеры и цена крупным шрифтом; чем больше позиций —
            тем мельче шрифт (автоматически). Выбор полей запоминается.
          </p>

          {/* Макет печати */}
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span className="admin-label" style={{ margin: 0 }}>
              Макет печати
            </span>
            <div className="box-report-layout-toggle" role="group" aria-label="Макет">
              <button
                type="button"
                className={isLarge ? "is-on" : ""}
                onClick={() => setLayout("large")}
              >
                <Type size={14} /> Крупная таблица A4
              </button>
              <button
                type="button"
                className={!isLarge ? "is-on" : ""}
                onClick={() => setLayout("compact")}
              >
                <LayoutGrid size={14} /> Компактная
              </button>
            </div>

            {isLarge && (
              <>
                <div className="box-report-layout-toggle" role="group" aria-label="Ориентация">
                  <button
                    type="button"
                    className={orientation === "portrait" ? "is-on" : ""}
                    onClick={() => setOrientation("portrait")}
                  >
                    Книжная
                  </button>
                  <button
                    type="button"
                    className={orientation === "landscape" ? "is-on" : ""}
                    onClick={() => setOrientation("landscape")}
                  >
                    Альбомная
                  </button>
                </div>
                <label
                  className="admin-field"
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, margin: 0 }}
                >
                  <span className="admin-label" style={{ margin: 0 }}>
                    Масштаб
                  </span>
                  <input
                    type="range"
                    min={70}
                    max={130}
                    step={5}
                    value={scaleBoost}
                    onChange={(e) => setScaleBoost(Number(e.target.value))}
                    style={{ width: 120 }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 700, minWidth: 40 }}>
                    {scaleBoost}%
                  </span>
                </label>
                <span className="box-report-scale-hint">
                  Авто: {scale.label} · {selectedProducts.length} поз. · шрифт ≈
                  {scale.namePx}px
                </span>
              </>
            )}
          </div>

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
                placeholder="Поиск по названию, артикулу, материалу..."
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
              <option value="all">Все категории ({products.length})</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="admin-check" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={showOnlySelected}
                onChange={(e) => setShowOnlySelected(e.target.checked)}
              />
              <span>Только выбранные ({selectedIds.size})</span>
            </label>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={selectAllFiltered}
            >
              <Check size={14} /> Выбрать все видимые ({filtered.length})
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={deselectAllFiltered}
            >
              <Square size={14} /> Снять видимые
            </button>
          </div>

          <div>
            <div className="admin-label" style={{ marginBottom: 8 }}>
              Поля для таблицы (отметьте нужные):
            </div>
            <div className="box-report-field-grid">
              {(Object.keys(FIELD_LABELS) as FieldKey[]).map((key) => (
                <label
                  key={key}
                  className={`box-report-field-item ${
                    fields[key] ? "box-report-field-item--active" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={fields[key]}
                    onChange={(e) =>
                      setFields((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                  />
                  <span>{FIELD_LABELS[key]}</span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                style={
                  fields.name && fields.dimensions && fields.price && activeFields.length === 3
                    ? {
                        background: "rgba(59,130,246,0.12)",
                        borderColor: "rgba(59,130,246,0.5)",
                        fontWeight: 700,
                      }
                    : undefined
                }
                onClick={() => {
                  applyPreset(["name", "dimensions", "price"]);
                  setLayout("large");
                }}
              >
                Прайс: Название + Размер + Цена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => {
                  applyPreset(["name", "price"]);
                  setLayout("large");
                }}
              >
                Название + Цена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => applyPreset(["dimensions"])}
              >
                Только размеры Д×Ш×В
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => applyPreset(["length", "width", "height"])}
              >
                Длина, Ширина, Высота
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => setFields({ ...DEFAULT_FIELDS })}
              >
                Стандарт (имя · размер · цена)
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() =>
                  setFields(
                    Object.fromEntries(
                      (Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => [k, true])
                    ) as Record<FieldKey, boolean>
                  )
                }
              >
                Все поля
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() =>
                  setFields(
                    Object.fromEntries(
                      (Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => [k, false])
                    ) as Record<FieldKey, boolean>
                  )
                }
              >
                Снять все
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={handlePrint}
              disabled={selectedProducts.length === 0 || activeFields.length === 0}
            >
              <Printer size={15} /> Печать на A4
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={handleExportExcel}
              disabled={selectedProducts.length === 0 || activeFields.length === 0}
            >
              <Download size={15} /> Excel (.xls)
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={handleExportCsv}
              disabled={selectedProducts.length === 0 || activeFields.length === 0}
            >
              <Download size={15} /> CSV
            </button>
            <span className="admin-hint" style={{ alignSelf: "center" }}>
              Выбрано: {selectedProducts.length} · полей: {activeFields.length}
              {isLarge ? ` · ${orientation === "landscape" ? "альбом" : "книга"}` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Список коробок для выбора */}
      <div className="admin-card no-print">
        <div className="admin-card__head">
          <h3 className="admin-card__title">Коробки в каталоге — выбор позиций</h3>
          <span className="admin-badge admin-badge--muted">
            {filtered.length} показано / {products.length} всего · выбрано{" "}
            {selectedIds.size}
          </span>
        </div>
        <div className="admin-table-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={
                      filtered.length > 0 &&
                      filtered.every((p) => selectedIds.has(p.id))
                    }
                    onChange={(e) =>
                      e.target.checked ? selectAllFiltered() : deselectAllFiltered()
                    }
                  />
                </th>
                <th>Название / Артикул</th>
                <th>Размеры</th>
                <th>Материал</th>
                <th>Цена</th>
                <th>Остаток</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  style={{
                    background: selectedIds.has(p.id)
                      ? "rgba(59,130,246,0.06)"
                      : undefined,
                  }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleProduct(p.id)}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    {p.sku && (
                      <div style={{ fontSize: 11, color: "var(--adm-muted)" }}>
                        {p.sku}
                      </div>
                    )}
                  </td>
                  <td>{formatDimensions(p)}</td>
                  <td>{p.material || "—"}</td>
                  <td>
                    {p.price != null
                      ? `${Number(p.price).toLocaleString("ru-RU")} ₽`
                      : "—"}
                  </td>
                  <td>{p.stockQty != null ? `${p.stockQty}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="admin-table__empty">Ничего не найдено</div>
          )}
        </div>
      </div>

      {/* Предпросмотр / печать */}
      <div className="admin-card box-report-print-area">
        <div className="admin-card__pad" style={{ padding: isLarge ? 0 : undefined }}>
          {activeFields.length === 0 ? (
            <div className="admin-empty" style={{ padding: 24 }}>
              <p>Не выбрано ни одного поля для таблицы</p>
            </div>
          ) : selectedProducts.length === 0 ? (
            <div className="admin-empty" style={{ padding: 24 }}>
              <p>Не выбрано ни одной коробки</p>
            </div>
          ) : isLarge ? (
            <div className="box-report-a4-stage">
              <div
                className="box-report-a4-sheet"
                style={
                  {
                    "--br-name": `${scale.namePx}px`,
                    "--br-body": `${scale.bodyPx}px`,
                    "--br-head": `${scale.headPx}px`,
                    "--br-pad-y": `${scale.padY}px`,
                    "--br-pad-x": `${scale.padX}px`,
                    "--br-num": `${scale.numPx}px`,
                    "--br-title": `${scale.titlePx}px`,
                  } as CSSProperties
                }
              >
                <h2 style={{ fontSize: "var(--br-title)" }}>
                  Прайс · коробки — {new Date().toLocaleDateString("ru-RU")}
                </h2>
                <div className="box-report-meta no-print">
                  {selectedProducts.length} поз. ·{" "}
                  {activeFields.map((k) => FIELD_LABELS[k]).join(" · ")} · масштаб{" "}
                  {scale.label} ({scaleBoost}%)
                </div>
                <table className="box-report-table box-report-table--large">
                  <thead>
                    <tr>
                      <th
                        className="col-num"
                        style={{
                          fontSize: "var(--br-head)",
                          padding: `var(--br-pad-y) var(--br-pad-x)`,
                        }}
                      >
                        №
                      </th>
                      {activeFields.map((k) => (
                        <th
                          key={k}
                          className={
                            k === "price" || k === "priceWholesale"
                              ? "col-price"
                              : k === "name"
                                ? "col-name"
                                : k === "dimensions"
                                  ? "col-dims"
                                  : undefined
                          }
                          style={{
                            fontSize: "var(--br-head)",
                            padding: `var(--br-pad-y) var(--br-pad-x)`,
                          }}
                        >
                          {FIELD_LABELS[k]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedProducts.map((p, idx) => (
                      <tr key={p.id}>
                        <td
                          className="col-num"
                          style={{
                            fontSize: "var(--br-num)",
                            padding: `var(--br-pad-y) var(--br-pad-x)`,
                          }}
                        >
                          {idx + 1}
                        </td>
                        {activeFields.map((k) => {
                          const emphasis = EMPHASIS_FIELDS.has(k);
                          const cls =
                            k === "price" || k === "priceWholesale"
                              ? "col-price"
                              : k === "name"
                                ? "col-name"
                                : k === "dimensions"
                                  ? "col-dims"
                                  : undefined;
                          return (
                            <td
                              key={k}
                              className={cls}
                              style={{
                                fontSize: emphasis
                                  ? k === "name"
                                    ? "var(--br-name)"
                                    : "var(--br-body)"
                                  : `calc(var(--br-body) * 0.92)`,
                                padding: `var(--br-pad-y) var(--br-pad-x)`,
                                fontWeight:
                                  k === "name" ||
                                  k === "price" ||
                                  k === "priceWholesale"
                                    ? 800
                                    : k === "dimensions"
                                      ? 700
                                      : 500,
                              }}
                            >
                              {getFieldValue(p, k)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ padding: 16 }}>
              <h2 style={{ margin: "0 0 6px", fontSize: 16 }}>
                Отчёт по коробкам — {new Date().toLocaleDateString("ru-RU")}
              </h2>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
                Выбрано: {selectedProducts.length} · Поля:{" "}
                {activeFields.map((k) => FIELD_LABELS[k]).join(", ")}
              </div>
              <div className="admin-table-wrap">
                <table className="box-report-table box-report-table--compact">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>№</th>
                      {activeFields.map((k) => (
                        <th key={k}>{FIELD_LABELS[k]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedProducts.map((p, idx) => (
                      <tr key={p.id}>
                        <td>{idx + 1}</td>
                        {activeFields.map((k) => (
                          <td key={k}>{getFieldValue(p, k)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
