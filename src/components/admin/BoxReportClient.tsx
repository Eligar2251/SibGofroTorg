"use client";

import { useState, useMemo } from "react";
import { Printer, Download, Search, Check, Square, Box } from "lucide-react";

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
  price: false,
  priceWholesale: false,
  stockQty: false,
  note: false,
  category: false,
};

export function BoxReportClient({
  products,
}: {
  products: BoxProduct[];
}) {
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
  const [fields, setFields] = useState<Record<FieldKey, boolean>>(DEFAULT_FIELDS);
  const [showOnlySelected, setShowOnlySelected] = useState(false);

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
        return p.price != null ? `${Number(p.price).toLocaleString("ru-RU")} ₽` : "—";
      case "priceWholesale":
        return p.priceWholesale != null ? `${Number(p.priceWholesale).toLocaleString("ru-RU")} ₽` : "—";
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
      .map((k) => `<th style="border:1px solid #999;padding:6px 8px;background:#eee;font-weight:bold;text-align:left;">${escapeXml(FIELD_LABELS[k])}</th>`)
      .join("");
    const bodyRows = selectedProducts
      .map((p, idx) => {
        const cells = activeFields
          .map((k) => `<td style="border:1px solid #999;padding:6px 8px;mso-number-format:'\\@';">${escapeXml(getFieldValue(p, k))}</td>`)
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
      activeFields.map((k) => {
        const v = getFieldValue(p, k);
        // escape
        const cleaned = String(v).replace(/"/g, '""');
        return `"${cleaned}"`;
      }).join(";")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Коробки_отчет_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="admin-stack">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .box-report-print-area, .box-report-print-area * { visibility: visible !important; }
          .box-report-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 10mm; background: #fff; }
          .box-report-print-area table { width: 100%; border-collapse: collapse; }
          .box-report-print-area th, .box-report-print-area td { border: 1px solid #999; padding: 6px 8px; font-size: 11px; }
          .box-report-print-area th { background: #eee; }
          .no-print { display: none !important; }
        }
        .box-report-field-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
        .box-report-field-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--adm-border); border-radius: 8px; background: #fff; cursor: pointer; font-size: 13px; }
        .box-report-field-item--active { background: rgba(59,130,246,0.08); border-color: rgba(59,130,246,0.3); }
      `}</style>

      <div className="admin-card no-print">
        <div className="admin-card__pad admin-stack">
          <h2 className="admin-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Box size={18} /> Отчёт по коробкам — выбор полей и печать
          </h2>
          <p className="admin-hint" style={{ marginTop: -4 }}>
            Выберите нужные коробки (можно фильтром по названию) и отметьте, какие столбцы выводить в таблицу. Например, только размеры без названия — снимите галочку «Название» и оставьте «Размеры».
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--adm-ink-muted)' }} />
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
              <input type="checkbox" checked={showOnlySelected} onChange={(e) => setShowOnlySelected(e.target.checked)} />
              <span>Только выбранные ({selectedIds.size})</span>
            </label>
            <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={selectAllFiltered}>
              <Check size={14} /> Выбрать все видимые ({filtered.length})
            </button>
            <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={deselectAllFiltered}>
              <Square size={14} /> Снять видимые
            </button>
          </div>

          <div>
            <div className="admin-label" style={{ marginBottom: 8 }}>Поля для таблицы (отметьте нужные):</div>
            <div className="box-report-field-grid">
              {(Object.keys(FIELD_LABELS) as FieldKey[]).map((key) => (
                <label
                  key={key}
                  className={`box-report-field-item ${fields[key] ? "box-report-field-item--active" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={fields[key]}
                    onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  <span>{FIELD_LABELS[key]}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                style={!fields.name && fields.dimensions && activeFields.length === 1 ? { background: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.5)', fontWeight: 700 } : {}}
                onClick={() => setFields((prev) => Object.fromEntries((Object.keys(FIELD_LABELS) as FieldKey[]).map(k => [k, k === 'dimensions'])) as any)}
              >
                Только размеры Д×Ш×В (без названия)
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                style={!fields.name && fields.length && fields.width && fields.height && activeFields.length === 3 ? { background: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.5)', fontWeight: 700 } : {}}
                onClick={() => setFields((prev) => Object.fromEntries((Object.keys(FIELD_LABELS) as FieldKey[]).map(k => [k, k === 'length' || k === 'width' || k === 'height'])) as any)}
              >
                Длина, Ширина, Высота (3 столбца, без названия)
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => setFields({ ...DEFAULT_FIELDS })}
              >
                Название + Размеры (стандарт)
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => setFields((prev) => Object.fromEntries((Object.keys(FIELD_LABELS) as FieldKey[]).map(k => [k, k === 'name' || k === 'dimensions' || k === 'price' || k === 'stockQty'])) as any)}
              >
                Название + Размеры + Цена + Остаток
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => setFields(Object.fromEntries((Object.keys(FIELD_LABELS) as FieldKey[]).map(k => [k, true])) as any)}
              >
                Все поля
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => setFields(Object.fromEntries((Object.keys(FIELD_LABELS) as FieldKey[]).map(k => [k, false])) as any)}
              >
                Снять все
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="admin-btn admin-btn--primary" onClick={handlePrint} disabled={selectedProducts.length === 0 || activeFields.length === 0}>
              <Printer size={15} /> Печать таблицы
            </button>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={handleExportExcel} disabled={selectedProducts.length === 0 || activeFields.length === 0}>
              <Download size={15} /> Скачать Excel (.xls)
            </button>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={handleExportCsv} disabled={selectedProducts.length === 0 || activeFields.length === 0}>
              <Download size={15} /> Скачать CSV
            </button>
            <span className="admin-hint" style={{ alignSelf: 'center' }}>
              Выбрано коробок: {selectedProducts.length} · полей: {activeFields.length}
            </span>
          </div>
        </div>
      </div>

      {/* Список коробок для выбора */}
      <div className="admin-card no-print">
        <div className="admin-card__head">
          <h3 className="admin-card__title">Коробки в каталоге — выбор позиций</h3>
          <span className="admin-badge admin-badge--muted">{filtered.length} показано / {products.length} всего · выбрано {selectedIds.size}</span>
        </div>
        <div className="admin-table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}><input type="checkbox" checked={filtered.length > 0 && filtered.every(p => selectedIds.has(p.id))} onChange={(e) => e.target.checked ? selectAllFiltered() : deselectAllFiltered()} /></th>
                <th>Название / Артикул</th>
                <th>Размеры</th>
                <th>Материал</th>
                <th>Цена</th>
                <th>Остаток</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} style={{ background: selectedIds.has(p.id) ? "rgba(59,130,246,0.06)" : undefined }}>
                  <td><input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleProduct(p.id)} /></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    {p.sku && <div style={{ fontSize: 11, color: 'var(--adm-muted)' }}>{p.sku}</div>}
                  </td>
                  <td>{formatDimensions(p)}</td>
                  <td>{p.material || "—"}</td>
                  <td>{p.price != null ? `${Number(p.price).toLocaleString("ru-RU")} ₽` : "—"}</td>
                  <td>{p.stockQty != null ? `${p.stockQty}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="admin-table__empty">Ничего не найдено</div>}
        </div>
      </div>

      {/* Печатная таблица */}
      <div className="admin-card box-report-print-area">
        <div className="admin-card__pad">
          <h2 style={{ margin: 0, marginBottom: 6, fontSize: 16 }}>Отчёт по коробкам — {new Date().toLocaleDateString("ru-RU")}</h2>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
            Выбрано: {selectedProducts.length} позиций · Поля: {activeFields.map(k => FIELD_LABELS[k]).join(", ") || "не выбраны"}
          </div>
          {activeFields.length === 0 ? (
            <div className="admin-empty"><p>Не выбрано ни одного поля для таблицы</p></div>
          ) : selectedProducts.length === 0 ? (
            <div className="admin-empty"><p>Не выбрано ни одной коробки</p></div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
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
          )}
        </div>
      </div>
    </div>
  );
}
