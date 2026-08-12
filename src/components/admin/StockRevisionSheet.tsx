// src/components/admin/StockRevisionSheet.tsx
// Бланк ревизии склада: A4-таблица «Товар · Учёт · Факт».
//
// Два режима одного документа:
//   • пустой бланк — колонка «Факт» пустая, её заполняют ручкой на складе;
//   • заполненный — в «Факт» подставлены значения, введённые в электронной
//     форме, плюс колонка «Расхождение» с итогами.
"use client";

import { useEffect, useRef, useState } from "react";
import { SITE_ADDRESS, SITE_PHONE } from "@/lib/site-config";
import { SITE_NAME } from "@/lib/seo";

/**
 * Форматирует габариты товара для колонки «Размеры» бланка ревизии.
 * Пусто/нули → «—», иначе «Д×Ш×В ед.» (например «670×370×370 мм»).
 */
function formatDimensions(row: RevisionSheetRow): string {
  const l = Number(row.dimensionLength) || 0;
  const w = Number(row.dimensionWidth) || 0;
  const h = Number(row.dimensionHeight) || 0;
  if (l <= 0 && w <= 0 && h <= 0) return "—";
  const unit = row.dimensionUnit || "мм";
  return `${l}×${w}×${h} ${unit}`;
}

/** Цена за единицу в бланке ревизии: «1 234 ₽» или «—». */
function formatPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return "—";
  return `${price.toLocaleString("ru-RU")} ₽`;
}

export interface RevisionSheetRow {
  id: string;
  name: string;
  /**
   * Имя варианта (цвет/размер/фасовка). Если задано — у товара
   * есть варианты, и эта строка соответствует конкретному варианту.
   * Кладовщик должен видеть отдельный остаток по «красному» и
   * «синему», а не сводный «Ящик 670».
   */
  variantName?: string | null;
  sku: string | null;
  /** Остаток по учёту на момент печати */
  stockQty: number;
  /** Введённый факт (только для заполненного бланка) */
  actualQty?: number | null;
  /** Габариты товара в мм (или в dimensionUnit). Используются в
   *  колонке «Размеры» бланка, чтобы кладовщик видел, что именно
   *  он пересчитывает (ящик 670×370×370, а не абстрактный SKU). */
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  /** Розничная цена за единицу — показывается в бланке ревизии,
   *  чтобы при расхождениях сразу было видно, сколько стоит
   *  «недостача» / «излишек». */
  price?: number | null;
}

export function StockRevisionSheet({
  rows,
  filled,
  note,
  responsible,
  companyPhone,
  companyAddress,
  onDone,
}: {
  rows: RevisionSheetRow[];
  /** true — печатаем уже заполненный бланк с расхождениями */
  filled: boolean;
  note?: string | null;
  responsible?: string | null;
  companyPhone?: string;
  companyAddress?: string;
  onDone?: () => void;
}) {
  const [printing, setPrinting] = useState(false);
  const triggered = useRef(false);

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;
    const prev = document.title;
    document.title = filled ? "Акт ревизии склада" : "Бланк ревизии склада";
    function onAfter() {
      document.title = prev;
      onDone?.();
    }
    window.addEventListener("afterprint", onAfter);
    return () => {
      document.title = prev;
      window.removeEventListener("afterprint", onAfter);
    };
  }, [filled, onDone]);

  function doPrint() {
    setPrinting(true);
    requestAnimationFrame(() => window.print());
  }

  const phone = companyPhone || SITE_PHONE;
  const address = companyAddress || SITE_ADDRESS;
  const today = new Date().toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const totalAccounted = rows.reduce((s, r) => s + r.stockQty, 0);
  const filledRows = rows.filter((r) => r.actualQty != null);
  const totalActual = filledRows.reduce((s, r) => s + (r.actualQty || 0), 0);
  const diffRows = filledRows.filter((r) => (r.actualQty || 0) !== r.stockQty);

  return (
    <div className="rev-print-root">
      <style>{REVISION_PRINT_CSS}</style>

      {!printing && (
        <div className="rev-print-close">
          <button type="button" className="rev-print-btn" onClick={doPrint}>
            🖨 Печать
          </button>
          <button type="button" onClick={() => onDone?.()}>
            ✕ Закрыть
          </button>
        </div>
      )}

      <div className="rev-sheet">
        <header className="rev-head">
          <div className="rev-head__brand">
            {SITE_NAME}
            <div className="rev-head__sub">{address}</div>
            <div className="rev-head__sub">Тел.: {phone}</div>
          </div>
          <div className="rev-head__meta">
            <div className="rev-head__title">
              {filled ? "Акт ревизии склада" : "Бланк ревизии склада"}
            </div>
            <div>Дата: {today}</div>
            <div>Позиций: {rows.length}</div>
            {responsible ? <div>Ответственный: {responsible}</div> : null}
          </div>
        </header>

        {note ? <div className="rev-note">Примечание: {note}</div> : null}

        <table className="rev-table">
          <thead>
            <tr>
              <th className="rev-col-n">№</th>
              <th className="rev-col-name">Наименование товара</th>
              <th className="rev-col-sku">Артикул</th>
              <th className="rev-col-dims">Размеры</th>
              <th className="rev-col-num">По учёту</th>
              <th className="rev-col-num rev-col-fact">Факт</th>
              {filled && <th className="rev-col-num">Расхождение</th>}
              <th className="rev-col-num">Цена</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const actual = r.actualQty;
              const diff = actual != null ? actual - r.stockQty : null;
              return (
                <tr key={r.id}>
                  <td className="rev-col-n">{idx + 1}</td>
                  <td className="rev-col-name">
                    {r.name}
                    {r.variantName && (
                      <span className="rev-col-variant"> · {r.variantName}</span>
                    )}
                  </td>
                  <td className="rev-col-sku">{r.sku || "—"}</td>
                  <td className="rev-col-dims">{formatDimensions(r)}</td>
                  <td className="rev-col-num">{Number.isInteger(r.stockQty) ? r.stockQty.toLocaleString("ru-RU") : r.stockQty.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 3 })}</td>
                  <td className="rev-col-num rev-col-fact">
                    {filled && actual != null ? (Number.isInteger(actual) ? actual.toLocaleString("ru-RU") : actual.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 3 })) : ""}
                  </td>
                  {filled && (
                    <td
                      className={`rev-col-num${
                        diff != null && diff !== 0 ? " rev-diff" : ""
                      }`}
                    >
                      {diff == null ? "" : diff === 0 ? "0" : diff > 0 ? `+${Number.isInteger(diff) ? diff : diff.toFixed(3)}` : `${Number.isInteger(diff) ? diff : diff.toFixed(3)}`}
                    </td>
                  )}
                  <td className="rev-col-num">{formatPrice(r.price)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="rev-total-label">
                Итого единиц
              </td>
              <td className="rev-col-num">{totalAccounted.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</td>
              <td className="rev-col-num rev-col-fact">
                {filled ? totalActual.toLocaleString("ru-RU", { maximumFractionDigits: 3 }) : ""}
              </td>
              {filled && (
                <td className="rev-col-num">
                  {(totalActual - totalAccounted) > 0 ? "+" : ""}
                  {(totalActual - totalAccounted).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                </td>
              )}
              <td className="rev-col-num">—</td>
            </tr>
          </tfoot>
        </table>

        {filled && (
          <div className="rev-summary">
            Проверено позиций: <b>{filledRows.length}</b> из {rows.length} ·
            Расхождений: <b>{diffRows.length}</b>
          </div>
        )}

        <div className="rev-sign">
          <div className="rev-sign__cell">
            Пересчёт провёл: ______________________ / ______________________
            <span className="rev-sign__hint">подпись / расшифровка</span>
          </div>
          <div className="rev-sign__cell">
            Проверил: ______________________ / ______________________
            <span className="rev-sign__hint">подпись / расшифровка</span>
          </div>
        </div>

        <footer className="rev-foot">
          {SITE_NAME} · {address} · {phone}
        </footer>
      </div>
    </div>
  );
}

const REVISION_PRINT_CSS = `
@media screen {
  .rev-print-root { position: fixed; inset: 0; z-index: 99999; background: #f5f3ee; overflow: auto; padding: 24px; }
  .rev-sheet { max-width: 210mm; margin: 0 auto; background: #fff; padding: 10mm; box-shadow: 0 2px 20px rgba(0,0,0,0.12); border-radius: 4px; }
  .rev-print-close { position: fixed; top: 12px; right: 12px; z-index: 100000; display: flex; gap: 8px; }
  .rev-print-close button { padding: 8px 16px; background: #1a1a18; color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: system-ui, sans-serif; }
  .rev-print-close .rev-print-btn { background: #2d6a4f; }
  .rev-print-close button:hover { opacity: 0.9; }
}

@media print {
  @page { size: A4 portrait; margin: 10mm 8mm; }
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; height: auto !important; overflow: visible !important; }

  /* На печать уходит ТОЛЬКО бланк.
     Прячем через display:none, а не visibility:hidden — скрытый по
     visibility элемент сохраняет место и давал пустые первые страницы.
     Модалка ревизии — соседний узел в <body> (оба через портал), поэтому
     её нужно скрыть явно, иначе печаталась именно она. */
  body > *:not(.rev-print-root) { display: none !important; }
  .admin-shell, .admin-sidebar, .admin-mobile-bar, .admin-content,
  .admin-main, .NavigationProgress, .admin-modal-overlay { display: none !important; }

  .rev-print-root { display: block !important; }
  .rev-print-root, .rev-print-root * { visibility: visible !important; }
  .rev-print-root {
    position: static !important;
    inset: auto !important;
    width: auto !important;
    background: #fff !important;
    padding: 0 !important;
    margin: 0 !important;
    overflow: visible !important;
    z-index: auto !important;
  }
  .rev-sheet { padding: 0 !important; max-width: none !important; margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
  .rev-print-close { display: none !important; }
  /* Шапка таблицы повторяется на каждой странице многостраничного бланка */
  .rev-table thead { display: table-header-group; }
  .rev-table tfoot { display: table-footer-group; }
  .rev-table tr { break-inside: avoid; }
  .rev-sign { break-inside: avoid; }
}

.rev-sheet { font-family: Arial, Helvetica, sans-serif; color: #23231f; }

.rev-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; padding-bottom: 3mm; border-bottom: 1.5px solid #23231f; }
.rev-head__brand { font-size: 15px; font-weight: 700; line-height: 1.3; }
.rev-head__sub { font-size: 9.5px; font-weight: 400; color: #6f6a61; }
.rev-head__meta { text-align: right; font-size: 10px; color: #4a463f; line-height: 1.5; }
.rev-head__title { font-size: 14px; font-weight: 700; color: #23231f; margin-bottom: 1mm; }

.rev-note { margin-top: 3mm; padding: 2mm 3mm; background: #fdf8ec; border: 1px solid #eeddb4; border-radius: 1.5mm; font-size: 10.5px; }

.rev-table { width: 100%; border-collapse: collapse; margin-top: 4mm; }
.rev-table th {
  font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #55504a;
  padding: 2mm 1.5mm; border: 1px solid #bdb8ae; background: #f3f1ec; text-align: left;
}
.rev-table td { padding: 2.2mm 1.5mm; border: 1px solid #d5d1c8; font-size: 11px; vertical-align: middle; }
.rev-col-n { width: 9mm; text-align: center; color: #8a857c; }
.rev-col-name { font-weight: 600; }
/* Пометка варианта (цвет/размер) — чуть мельче и зеленоватее, чтобы
   кладовщик сразу видел, что это отдельная строка для конкретного SKU. */
.rev-col-variant {
  display: inline;
  color: #2d6a4f;
  font-size: 10.5px;
  font-weight: 600;
}
.rev-col-sku { width: 26mm; font-size: 10px; color: #6f6a61; }
/* Габариты — отдельная колонка, чтобы кладовщик видел «670×370×370» и не
   считал «абстрактный» SKU наугад. Шрифт мельче, по центру. */
.rev-col-dims { width: 30mm; text-align: center; font-size: 10px; color: #4a463f; white-space: nowrap; font-variant-numeric: tabular-nums; }
th.rev-col-dims { text-align: center; }
.rev-col-num { width: 22mm; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
th.rev-col-num { text-align: right; }
/* Колонка «Факт» — крупная и пустая: в неё пишут ручкой */
.rev-col-fact { width: 26mm; background: #fbfaf7; font-size: 13px; font-weight: 700; }
.rev-diff { font-weight: 700; color: #b4531f; }

.rev-table tfoot td { background: #f3f1ec; font-weight: 700; font-size: 11.5px; }
.rev-total-label { text-align: right; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.04em; }

.rev-summary { margin-top: 3mm; font-size: 11px; color: #4a463f; }

.rev-sign { margin-top: 8mm; display: flex; gap: 10mm; }
.rev-sign__cell { flex: 1; font-size: 10.5px; color: #23231f; display: flex; flex-direction: column; gap: 1mm; }
.rev-sign__hint { font-size: 8px; color: #8a857c; text-transform: uppercase; letter-spacing: 0.05em; }

.rev-foot { margin-top: 6mm; padding-top: 2mm; border-top: 1px solid #ddd8cd; font-size: 8.5px; color: #8a857c; text-align: center; }
`;
