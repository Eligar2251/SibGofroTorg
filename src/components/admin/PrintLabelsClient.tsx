// =========================================================
// FILE: src/components/admin/PrintLabelsClient.tsx
// Клиентская часть страницы массовой печати этикеток
// (штрихкоды EAN-13 и/или QR).
//
// Два режима печати:
// • sheet (лист A4): квадратные этикетки 4×4 / 5×5 / 6×6 см,
//   сетка repeat(N, M), печатаются на обычном принтере/листе —
//   НЕСКОЛЬКО этикеток на одном листе.
// • tape (этикетка 40×60 мм = 6×4 см, альбомная): для термопринтера
//   этикеток (Xprinter XP-365B, Brother, MUNBYN, Mercury и т.п.).
//   ОДНА этикетка = ОДНА страница печати = ОДИН код:
//   @page { size: 60mm 40mm; margin: 0 } + разрыв страницы после
//   каждой этикетки. Так драйвер принтера получает ровно одну
//   этикетку на одну физическую отрывную этикетку.
//
// Что печатаем — переключатель «Код»:
// • barcode (по умолчанию): обычный штрихкод EAN-13 — постоянный
//   код товара из БД. Сканируется камерой телефона и любым
//   USB-сканером, надёжнее QR.
// • qr: QR-код со ссылкой на товар (старое поведение этикеток).
//
// Правило @page зависит от режима, поэтому оно НЕ в admin.css,
// а инъектируется отсюда тегом <style> (см. ниже в разметке).
//
// Состав этикетки (в обоих режимах) настраивается тумблерами
// «На этикетке»: Название / Цена / Размеры — можно оставить
// один голый код. Размеры берутся из карточки товара (Д×Ш[×В] мм)
// и печатаются только там, где они заданы.
// =========================================================

"use client";

/* eslint-disable @next/next/no-img-element -- SVG codes must be rendered at native vector URLs for print fidelity. */

import { useEffect, useMemo, useState } from "react";
import {
  Printer,
  Search,
  Filter,
  Square,
  CheckSquare,
  ScanLine,
  LayoutGrid,
  Type,
  Tag,
  Ruler,
  Barcode,
  QrCode,
} from "lucide-react";

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
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionUnit: string | null;
};

interface Props {
  products: Product[];
  categories: { id: string; name: string }[];
  selectedCategory: string;
  query: string;
  adminPath: string;
}

/** Режим печати. */
type PrintMode = "sheet" | "tape";
/** Размер этикетки на листе A4 (квадратные). */
type SheetSize = "4x4" | "5x5" | "6x6";
/** Какой код печатать на этикетке. */
type CodeType = "barcode" | "qr";

const fmt = (n: number) => n.toLocaleString("ru-RU");

function formatBarcode(s: string): string {
  if (s.length !== 13) return s;
  return `${s.slice(0, 3)} ${s.slice(3, 7)} ${s.slice(7, 12)} ${s.slice(12)}`;
}

/**
 * Размеры товара для этикетки: «Д×Ш[×В] мм», как на странице товара
 * в каталоге (catalog/product/[slug]). Нужны минимум Д и Ш.
 */
function formatDims(p: Product): string | null {
  const L = p.dimensionLength;
  const W = p.dimensionWidth;
  if (!L || !W) return null;
  const H = p.dimensionHeight;
  return `${L}×${W}${H ? `×${H}` : ""} ${p.dimensionUnit || "мм"}`;
}

// ── Размеры этикеток на листе A4 ──
// Квадратные 4×4, 5×5, 6×6 см. На листе A4 (210×297 мм) с полями
// 8 мм (см. @page margin) — рабочая зона 194×281 мм. Раскладка:
//   4×4 см → 4×6 = 24 шт/лист
//   5×5 см → 3×5 = 15 шт/лист
//   6×6 см → 3×4 = 12 шт/лист
const SHEET_DIM: Record<
  SheetSize,
  {
    sideCm: number;
    cols: number;
    rows: number;
    qrSize: number;
    bcHeight: number;
    /** Высота штрихов, когда штрихкод — основной код этикетки. */
    bcMainMm: number;
  }
> = {
  "4x4": { sideCm: 4, cols: 4, rows: 6, qrSize: 170, bcHeight: 30, bcMainMm: 18 },
  "5x5": { sideCm: 5, cols: 3, rows: 5, qrSize: 210, bcHeight: 36, bcMainMm: 22 },
  "6x6": { sideCm: 6, cols: 3, rows: 4, qrSize: 250, bcHeight: 42, bcMainMm: 26 },
};

// ── Размер этикетки на термопринтере (Xprinter XP-365B) ──
// Отрывная этикетка 40×60 мм (6×4 см), печать в АЛЬБОМНОЙ ориентации:
// ширина 60 мм × высота 40 мм. Раскладка — колонка по центру:
// название сверху, код по центру, цена под кодом.
// Код — штрихкод EAN-13 (по умолчанию) или QR, см. переключатель
// «Код». Оба приходят в SVG: на термопечати 203 dpi вектор даёт
// идеально ровные штрихи/модули, поэтому код пробивается с первого
// раза. qrSize — только width/height атрибуты <img> для резервирования
// места в лейауте (этикетки не «прыгают» до загрузки картинки).
// См. .qrprint__tape-qr / .qrprint__tape-bc в admin.css.
const TAPE_DIM = {
  widthMm: 60,
  heightMm: 40,
  qrSize: 280,
};

// ── Правило @page — зависит от режима печати ──
// Инъектируем CSS тегом <style>, потому что статический @page в
// admin.css не умеет переключаться между режимами (второй @page
// всегда перебивал первый и ломал A4-печать).
//   sheet → лист A4 с полями 8 мм (несколько этикеток на листе)
//   tape  → страница = ровно одна этикетка 60×40 мм, поля 0,
//           а разрывы страниц гарантируют 1 QR на 1 этикетку.
function pageCss(mode: PrintMode): string {
  return mode === "tape"
    ? "@media print { @page { size: 60mm 40mm; margin: 0; } }"
    : "@media print { @page { size: A4; margin: 8mm; } }";
}

export function PrintLabelsClient({
  products,
  categories,
  selectedCategory: initialCat,
  query: initialQ,
}: Props) {
  const [cat, setCat] = useState<string>(initialCat);
  const [q, setQ] = useState<string>(initialQ);
  const [mode, setMode] = useState<PrintMode>("sheet");
  const [size, setSize] = useState<SheetSize>("4x4");
  // Какой код печатать. По умолчанию — обычный штрихкод EAN-13:
  // сканируется надёжнее и быстрее QR (в т.ч. USB-сканерами,
  // которые QR не читают), и именно его формат хранится в БД.
  const [codeType, setCodeType] = useState<CodeType>("barcode");
  // ── Что печатать на этикетке ПОМИМО QR-кода ──
  // Название / цена / размеры — включаются отдельными тумблерами.
  // По умолчанию всё включено (как было раньше).
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showSizes, setShowSizes] = useState(true);
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
  const dim = mode === "sheet" ? SHEET_DIM[size] : null;

  // При монтировании снимаем фокус с авто-инпутов, чтобы они не
  // получали синюю рамку при печати.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("qrprint-mode");
    return () => document.body.classList.remove("qrprint-mode");
  }, []);

  return (
    <div className="qrprint">
      {/* @page зависит от режима: A4 (лист, много этикеток) или
          60×40 мм (термоэтикетка, ровно 1 код на страницу/этикетку).
          Статический @page в admin.css так переключать нельзя —
          поэтому инъектируем отсюда. */}
      <style>{pageCss(mode)}</style>
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
            {/* ── Переключатель режима печати: лист / лента ── */}
            <span className="qrprint__seg-label">Режим:</span>
            <button
              type="button"
              onClick={() => setMode("sheet")}
              className={`qrprint__seg-btn${
                mode === "sheet" ? " qrprint__seg-btn--active" : ""
              }`}
              title="Лист A4 с сеткой этикеток — несколько штук на листе"
            >
              <LayoutGrid size={12} /> Лист A4
            </button>
            <button
              type="button"
              onClick={() => setMode("tape")}
              className={`qrprint__seg-btn${
                mode === "tape" ? " qrprint__seg-btn--active" : ""
              }`}
              title="Термопринтер этикеток (Xprinter XP-365B и др.): отрывная этикетка 40×60 мм альбомная (6×4 см), один код на этикетку"
            >
              <ScanLine size={12} /> Этикетка 40×60
            </button>
            <span className="qrprint__seg-divider" />
            {/* ── Какой код печатать: обычный штрихкод (EAN-13,
                 по умолчанию — сканируется надёжнее) или QR ── */}
            <span className="qrprint__seg-label">Код:</span>
            <button
              type="button"
              onClick={() => setCodeType("barcode")}
              className={`qrprint__seg-btn${
                codeType === "barcode" ? " qrprint__seg-btn--active" : ""
              }`}
              title="Обычный штрихкод EAN-13 — тот самый постоянный код товара из БД. Читается камерой и любым USB-сканером"
            >
              <Barcode size={12} /> Штрихкод
            </button>
            <button
              type="button"
              onClick={() => setCodeType("qr")}
              className={`qrprint__seg-btn${
                codeType === "qr" ? " qrprint__seg-btn--active" : ""
              }`}
              title="QR-код со ссылкой на товар (старый формат этикеток)"
            >
              <QrCode size={12} /> QR-код
            </button>
            {mode === "sheet" && (
              <>
                <span className="qrprint__seg-divider" />
                <span className="qrprint__seg-label">Размер:</span>
                {(["4x4", "5x5", "6x6"] as SheetSize[]).map((s) => (
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
              </>
            )}
          </div>
          {/* ── Состав этикетки: что печатать ПОМИМО QR ──
              Три независимых тумблера. Работают для обоих режимов
              (лист A4 и термоэтикетка 40×60). */}
          <div className="qrprint__seg" role="group" aria-label="Что печатать помимо QR-кода">
            <span className="qrprint__seg-label">На этикетке:</span>
            <button
              type="button"
              onClick={() => setShowName((v) => !v)}
              className={`qrprint__seg-btn${
                showName ? " qrprint__seg-btn--active" : ""
              }`}
              title="Название товара на этикетке"
            >
              <Type size={12} /> Название
            </button>
            <button
              type="button"
              onClick={() => setShowPrice((v) => !v)}
              className={`qrprint__seg-btn${
                showPrice ? " qrprint__seg-btn--active" : ""
              }`}
              title="Цена на этикетке"
            >
              <Tag size={12} /> Цена
            </button>
            <button
              type="button"
              onClick={() => setShowSizes((v) => !v)}
              className={`qrprint__seg-btn${
                showSizes ? " qrprint__seg-btn--active" : ""
              }`}
              title="Габариты Д×Ш×В на этикетке (печатаются, только если размеры заданы в карточке товара)"
            >
              <Ruler size={12} /> Размеры
            </button>
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
        {mode === "tape" && (
          <div className="qrprint__hint">
            <strong>
              Этикетка 40×60 мм (альбомная, 6×4 см) — один{" "}
              {codeType === "barcode" ? "штрихкод EAN-13" : "QR-код"} по
              центру этикетки.
            </strong>{" "}
            Каждая этикетка печатается отдельной страницей ровно 60×40
            мм: название сверху, {codeType === "barcode" ? "штрихкод" : "QR"}{" "}
            по центру, цена под ним. В диалоге печати выберите ваш
            термопринтер (Xprinter XP-365B / Brother / MUNBYN /
            Mercury), бумагу <strong>60×40 мм</strong> (она же «6×4 см» в
            драйвере), поля — <strong>«Нет»</strong>, масштаб —{" "}
            <strong>100%</strong> (не «по размеру страницы»), колонтитулы
            — выкл. Если этикетки «съезжают» — значит в диалоге стоит
            масштаб или поля: поставьте как указано выше.
            {codeType === "barcode" && (
              <>
                {" "}
                Штрихкод — тот же постоянный EAN-13, что хранится в
                карточке товара: перепечатка этикетки не меняет сам код.
              </>
            )}
          </div>
        )}
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

      {/*
       * ── Лист A4 (сетка) ──
       * Табличная сетка: фиксированное число колонок/рядов,
       * все этикетки одинакового квадратного размера, gap между
       * ними — это «линии реза» при печати. Контент этикетки
       * центрирован в своей ячейке.
       */}
      {mode === "sheet" && dim && (
        <div
          className="qrprint__sheet qrprint__sheet--grid"
          style={{
            ["--qr-cols" as string]: String(dim.cols),
            ["--qr-side" as string]: `${dim.sideCm}cm`,
          } as React.CSSProperties}
        >
          {selectedProducts.map((p) => {
            const dims = showSizes ? formatDims(p) : null;
            return (
            <div key={p.id} className="qrprint__label">
              {/* Шапка этикетки: только выбранные тумблерами поля.
                  Если всё выключено — шапку не рисуем вовсе (код
                  займёт всю этикетку). */}
              {(showName || (showPrice && p.price != null) || dims) && (
              <div className="qrprint__label-head">
                {showName && (
                  <div className="qrprint__label-name">{p.name}</div>
                )}
                {showPrice && p.price != null && (
                  <div className="qrprint__label-price">
                    {`${fmt(p.price)} ₽`}
                  </div>
                )}
                {dims && (
                  <div className="qrprint__label-dims">{dims}</div>
                )}
              </div>
              )}
              {codeType === "barcode" ? (
                // ── Основной штрихкод: один EAN-13 крупно ──
                // SVG: вектор печатается без растровой интерполяции —
                // штрихи идеально ровные при любом DPI принтера,
                // сканируется с первого раза даже на термобумаге.
                <div className="qrprint__label-code qrprint__label-code--center">
                  <img
                    src={`/api/admin/qr/barcode/${p.id}?format=svg&height=${dim.bcMainMm}`}
                    alt={`Штрихкод ${p.barcode}`}
                    className="qrprint__label-bconly"
                  />
                </div>
              ) : (
                // ── QR-режим (старое поведение): QR + маленький
                //    штрихкод с цифрами под ним ──
                <>
                  <div className="qrprint__label-code">
                    {/* SVG, а не PNG — см. комментарий выше. */}
                    <img
                      src={`/api/admin/qr/${p.id}?format=svg`}
                      alt=""
                      className="qrprint__label-qr"
                      width={dim.qrSize}
                      height={dim.qrSize}
                    />
                  </div>
                  <div className="qrprint__label-code">
                    <img
                      src={`/api/admin/qr/barcode/${p.id}`}
                      alt=""
                      className="qrprint__label-bc"
                      width={dim.qrSize + 20}
                      height={dim.bcHeight}
                    />
                    <div className="qrprint__label-ean">
                      {formatBarcode(p.barcode)}
                    </div>
                  </div>
                </>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/*
       * ── Термоэтикетка 40×60 мм (альбомная, Xprinter XP-365B) ──
       * Вертикальный стек этикеток 60×40 мм. При печати каждая
       * этикетка — ОТДЕЛЬНАЯ страница 60×40 мм (@page инъектируется
       * выше + break-after: page в CSS), поэтому на одну физическую
       * этикетку попадает ровно ОДИН код.
       * Раскладка — классическая для ценников 4×6: всё по ЦЕНТРУ
       * колонкой: название (1 строка) сверху, штрихкод EAN-13 (или
       * QR — переключатель «Код») по центру этикетки, цена под ним.
       */}
      {mode === "tape" && (
        <div
          className="qrprint__tape"
          style={{
            ["--tape-w" as string]: `${TAPE_DIM.widthMm}mm`,
            ["--tape-h" as string]: `${TAPE_DIM.heightMm}mm`,
          } as React.CSSProperties}
        >
          {selectedProducts.map((p) => {
            const dims = showSizes ? formatDims(p) : null;
            // Включены ВСЕ три поля (название+цена+размеры) — код
            // чуть уменьшаем (compact), чтобы всё гарантированно
            // уместилось на 40 мм высоты и этикетки не «поползли».
            const compact = showName && showPrice && !!dims;
            return (
            <div
              key={p.id}
              className={`qrprint__tape-label${
                compact ? " qrprint__tape-label--compact" : ""
              }`}
            >
              {showName && (
                <div className="qrprint__tape-name" title={p.name}>
                  {p.name}
                </div>
              )}
              {codeType === "barcode" ? (
                // ── Штрихкод на Xprinter 6×4 см ──
                // EAN-13 почти во всю ширину этикетки (54 мм из 60) —
                // читается камерой и USB-сканером. SVG: на 203 dpi
                // термопечати вектор критичен, растянутый PNG терял
                // чёткость штрихов и код не пробивался.
                <img
                  src={`/api/admin/qr/barcode/${p.id}?format=svg&height=${
                    compact ? 14 : 18
                  }`}
                  alt={`Штрихкод ${p.barcode}`}
                  className="qrprint__tape-bc"
                />
              ) : (
                // ── QR на Xprinter (старый формат этикеток) ──
                // SVG — см. комментарий в режиме листа: на термопринтере
                // (203 dpi) векторный QR критичен, растянутый PNG там
                // терял чёткость границ модулей.
                <img
                  src={`/api/admin/qr/${p.id}?format=svg`}
                  alt=""
                  className="qrprint__tape-qr"
                  width={TAPE_DIM.qrSize}
                  height={TAPE_DIM.qrSize}
                />
              )}
              {showPrice && p.price != null && (
                <div className="qrprint__tape-price">
                  {`${fmt(p.price)} ₽`}
                </div>
              )}
              {dims && (
                <div className="qrprint__tape-dims" title={dims}>
                  {dims}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
