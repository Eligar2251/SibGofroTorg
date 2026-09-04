"use client";

import { useEffect, useState } from "react";
import {
  Printer,
  Plus,
  Minus,
  RotateCcw,
  Grid3X3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// Печать на А4 — редактор таблицы «как в Excel».
// Позволяет собрать таблицу, выбрать шрифт/размер, размеры ячеек,
// поля страницы и напечатать на листе А4. Сетка ячеек НЕ печатается,
// пока не включён переключатель «Печатать сетку» (тонкие линии, как в Excel).
// ═══════════════════════════════════════════════════════════════════

const FONTS = [
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "Inter, sans-serif", label: "Inter" },
  { value: "Oswald, sans-serif", label: "Oswald" },
  { value: "Montserrat, sans-serif", label: "Montserrat" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Verdana, sans-serif", label: "Verdana" },
];

type Align = "left" | "center" | "right";

const clampInt = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.floor(v) || min));

function defaultCells(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () => Array(cols).fill(""));
}

export function PrintSheetEditor() {
  const [rows, setRows] = useState(6);
  const [cols, setCols] = useState(4);
  const [cells, setCells] = useState<string[][]>(() => defaultCells(6, 4));

  const [fontFamily, setFontFamily] = useState(FONTS[0].value);
  const [fontSize, setFontSize] = useState(12);
  const [bold, setBold] = useState(false);
  const [align, setAlign] = useState<Align>("left");

  // Размеры таблицы (мм)
  const [tableWidth, setTableWidth] = useState(0); // 0 = на всю ширину страницы
  const [rowHeight, setRowHeight] = useState(10);
  const [colWidths, setColWidths] = useState<number[]>(() => Array(4).fill(40));
  const [cellPadding, setCellPadding] = useState(2);

  // Поля страницы (мм)
  const [marginTop, setMarginTop] = useState(15);
  const [marginRight, setMarginRight] = useState(10);
  const [marginBottom, setMarginBottom] = useState(15);
  const [marginLeft, setMarginLeft] = useState(10);

  const [printGrid, setPrintGrid] = useState(false);

  function resizeCols(nextCols: number) {
    setCols(nextCols);
    setCells((prev) =>
      prev.map((row) => {
        const r = row.slice(0, nextCols);
        while (r.length < nextCols) r.push("");
        return r;
      })
    );
    setColWidths((prev) => {
      const w = prev.slice(0, nextCols);
      while (w.length < nextCols) w.push(40);
      return w;
    });
  }

  function resizeRows(nextRows: number) {
    setRows(nextRows);
    setCells((prev) => {
      const c = prev.slice(0, nextRows);
      while (c.length < nextRows) c.push(Array(cols).fill(""));
      return c;
    });
  }

  function setCell(r: number, c: number, value: string) {
    setCells((prev) =>
      prev.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row
      )
    );
  }

  function setColWidth(i: number, value: number) {
    setColWidths((prev) =>
      prev.map((w, wi) => (wi === i ? Math.max(0, value) : w))
    );
  }

  function reset() {
    setRows(6);
    setCols(4);
    setCells(defaultCells(6, 4));
    setFontFamily(FONTS[0].value);
    setFontSize(12);
    setBold(false);
    setAlign("left");
    setTableWidth(0);
    setRowHeight(10);
    setColWidths(Array(4).fill(40));
    setCellPadding(2);
    setMarginTop(15);
    setMarginRight(10);
    setMarginBottom(15);
    setMarginLeft(10);
    setPrintGrid(false);
  }

  const tableWidthPx = tableWidth > 0 ? `${tableWidth}mm` : "100%";

  return (
    <div className="ps-editor">
      {/* Нулевые поля страницы — ТОЛЬКО на этой странице: редактор задаёт
          поля сам (padding у .ps-print-area). Раньше это правило жило
          глобально в admin.css и сбрасывало поля у любой печати админки
          (отчёт по коробкам, бланк ревизии). @page нельзя скоупить
          селектором, поэтому рендерим его вместе с компонентом. */}
      <style>{`@media print { @page { size: A4; margin: 0; } }`}</style>
      {/* ── Панель настроек ── */}
      <div className="ps-controls admin-card">
        <div className="admin-card__pad">
          <div className="admin-page-head" style={{ marginBottom: 14 }}>
            <div>
              <h1 className="admin-h1">Печать на А4</h1>
              <p className="admin-sub">
                Таблица как в Excel: выберите шрифт, размер, размеры ячеек и
                поля. Сетка на печати появится только если включить
                «Печатать сетку».
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="admin-btn admin-btn--ghost" onClick={reset}>
                <RotateCcw size={15} /> Сбросить
              </button>
              <button type="button" className="admin-btn admin-btn--navy" onClick={() => window.print()}>
                <Printer size={15} /> Печать
              </button>
            </div>
          </div>

          <div className="ps-grid ps-grid--controls">
            {/* Шрифт и размер */}
            <label className="ps-field">
              <span className="ps-field__label">Шрифт</span>
              <select
                className="admin-select"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
              >
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="ps-field">
              <span className="ps-field__label">Размер (pt)</span>
              <input
                type="number"
                className="admin-input"
                min={6}
                max={72}
                value={fontSize}
                onChange={(e) =>
                  setFontSize(clampInt(Number(e.target.value) || 12, 6, 72))
                }
              />
            </label>

            <div className="ps-field">
              <span className="ps-field__label">Выравнивание</span>
              <div className="ps-seg">
                <button
                  type="button"
                  className={`ps-seg__btn${align === "left" ? " ps-seg__btn--active" : ""}`}
                  onClick={() => setAlign("left")}
                  title="По левому краю"
                >
                  <AlignLeft size={15} />
                </button>
                <button
                  type="button"
                  className={`ps-seg__btn${align === "center" ? " ps-seg__btn--active" : ""}`}
                  onClick={() => setAlign("center")}
                  title="По центру"
                >
                  <AlignCenter size={15} />
                </button>
                <button
                  type="button"
                  className={`ps-seg__btn${align === "right" ? " ps-seg__btn--active" : ""}`}
                  onClick={() => setAlign("right")}
                  title="По правому краю"
                >
                  <AlignRight size={15} />
                </button>
                <button
                  type="button"
                  className={`ps-seg__btn${bold ? " ps-seg__btn--active" : ""}`}
                  onClick={() => setBold((b) => !b)}
                  title="Жирный"
                >
                  <Bold size={15} />
                </button>
              </div>
            </div>

            {/* Структура таблицы */}
            <div className="ps-field">
              <span className="ps-field__label">Строк</span>
              <div className="ps-stepper">
                <button type="button" onClick={() => resizeRows(Math.max(1, rows - 1))}>
                  <Minus size={13} />
                </button>
                <span>{rows}</span>
                <button type="button" onClick={() => resizeRows(Math.min(100, rows + 1))}>
                  <Plus size={13} />
                </button>
              </div>
            </div>

            <div className="ps-field">
              <span className="ps-field__label">Столбцов</span>
              <div className="ps-stepper">
                <button type="button" onClick={() => resizeCols(Math.max(1, cols - 1))}>
                  <Minus size={13} />
                </button>
                <span>{cols}</span>
                <button type="button" onClick={() => resizeCols(Math.min(30, cols + 1))}>
                  <Plus size={13} />
                </button>
              </div>
            </div>

            {/* Размеры таблицы */}
            <label className="ps-field">
              <span className="ps-field__label">Ширина таблицы (мм · 0 = на всю)</span>
              <input
                type="number"
                className="admin-input"
                min={0}
                value={tableWidth}
                onChange={(e) => setTableWidth(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>

            <label className="ps-field">
              <span className="ps-field__label">Высота строки (мм)</span>
              <input
                type="number"
                className="admin-input"
                min={4}
                value={rowHeight}
                onChange={(e) => setRowHeight(Math.max(4, Number(e.target.value) || 4))}
              />
            </label>

            <label className="ps-field">
              <span className="ps-field__label">Отступ в ячейке (мм)</span>
              <input
                type="number"
                className="admin-input"
                min={0}
                value={cellPadding}
                onChange={(e) => setCellPadding(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>

            {/* Поля страницы */}
            <label className="ps-field">
              <span className="ps-field__label">Поле сверху (мм)</span>
              <input
                type="number"
                className="admin-input"
                min={0}
                value={marginTop}
                onChange={(e) => setMarginTop(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="ps-field">
              <span className="ps-field__label">Поле снизу (мм)</span>
              <input
                type="number"
                className="admin-input"
                min={0}
                value={marginBottom}
                onChange={(e) => setMarginBottom(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="ps-field">
              <span className="ps-field__label">Поле слева (мм)</span>
              <input
                type="number"
                className="admin-input"
                min={0}
                value={marginLeft}
                onChange={(e) => setMarginLeft(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="ps-field">
              <span className="ps-field__label">Поле справа (мм)</span>
              <input
                type="number"
                className="admin-input"
                min={0}
                value={marginRight}
                onChange={(e) => setMarginRight(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>

            {/* Сетка на печати */}
            <label className="ps-field ps-field--toggle">
              <input
                type="checkbox"
                checked={printGrid}
                onChange={(e) => setPrintGrid(e.target.checked)}
              />
              <span className="ps-field__label" style={{ display: "inline", margin: 0 }}>
                <Grid3X3 size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                Печатать сетку (границы ячеек)
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* ── Ширины столбцов ── */}
      <div className="ps-colwidths admin-card">
        <div className="admin-card__pad">
          <span className="ps-colwidths__label">Ширина столбцов (мм):</span>
          <div className="ps-colwidths__list">
            {colWidths.map((w, i) => (
              <label key={i} className="ps-colwidth">
                <span>{String.fromCharCode(65 + (i % 26))}</span>
                <input
                  type="number"
                  className="admin-input"
                  min={5}
                  value={w}
                  onChange={(e) => setColWidth(i, Math.max(5, Number(e.target.value) || 5))}
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── Редактор таблицы (экранный предпросмотр) ── */}
      <div className="ps-canvas admin-card">
        <div className="admin-card__pad">
          <table
            className="ps-table ps-table--screen"
            style={{ width: tableWidthPx, fontFamily, fontSize: `${fontSize}pt` }}
          >
            <tbody>
              {cells.map((row, ri) => (
                <tr key={ri} style={{ height: `${rowHeight}mm` }}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{
                        width: colWidths[ci] ? `${colWidths[ci]}mm` : undefined,
                        padding: `${cellPadding}mm`,
                        textAlign: align,
                        fontWeight: bold ? 700 : 400,
                      }}
                    >
                      <textarea
                        value={cell}
                        onChange={(e) => setCell(ri, ci, e.target.value)}
                        style={{
                          fontFamily,
                          fontSize: `${fontSize}pt`,
                          fontWeight: bold ? 700 : 400,
                          textAlign: align,
                        }}
                        placeholder=" "
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Зона печати (только она видна при печати) ── */}
      <div className="ps-print-root">
        <div
          className="ps-print-area"
          style={{
            paddingTop: `${marginTop}mm`,
            paddingRight: `${marginRight}mm`,
            paddingBottom: `${marginBottom}mm`,
            paddingLeft: `${marginLeft}mm`,
          }}
        >
          <table
            className={`ps-table ps-table--print${printGrid ? " ps-table--grid" : ""}`}
            style={{ width: tableWidthPx, fontFamily, fontSize: `${fontSize}pt` }}
          >
            <tbody>
              {cells.map((row, ri) => (
                <tr key={ri} style={{ height: `${rowHeight}mm` }}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{
                        width: colWidths[ci] ? `${colWidths[ci]}mm` : undefined,
                        padding: `${cellPadding}mm`,
                        textAlign: align,
                        fontWeight: bold ? 700 : 400,
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
