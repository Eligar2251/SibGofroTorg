// =========================================================
// FILE: src/components/admin/BoxLabelsClient.tsx
// Печать этикеток ЯЩИКОВ на листе A4 — два варианта.
//
// • «Стандартный вид» — как было раньше и по умолчанию:
//   полоса 210×60 мм во всю ширину A4, раскладка
//   [ № ящика | размеры | штрихкод EAN-13 ] с цифрами кода,
//   линия реза снизу, 4 мм между этикетками.
// • «Свой размер» — конструктор: любая ширина и высота в мм
//   (маленькие коробки печатаются по 2–5 в ряд), поля листа,
//   отступы, рамка, название и свой текст, тумблеры содержимого,
//   шрифты и высота штриха.
//
// В обоих вариантах: живые тексты каждой этикетки, нумерация
// ящиков по порядку или с любого числа, предпросмотр настоящих
// листов A4 (1:1 по миллиметрам) и печать того же, что на экране.
// Настройки вариантов запоминаются в браузере.
// =========================================================

"use client";

/* eslint-disable @next/next/no-img-element -- SVG штрихкода должен печататься нативным вектором. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Filter,
  Hash,
  LayoutTemplate,
  ListOrdered,
  Loader2,
  Printer,
  Ruler,
  Search,
  SlidersHorizontal,
  Sparkles,
  Type,
  X,
} from "lucide-react";

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

/** Шрифты этикетки, pt. Общие лежат в настройках, у этикетки — переопределение. */
interface LabelFonts {
  number: number;
  title: number;
  sizes: number;
  barcode: number;
  extra: number;
}

/** Тексты одной этикетки + необязательное переопределение шрифтов. */
interface LabelData {
  boxNumber: string;
  title: string;
  sizes: string;
  extra: string;
  fonts?: Partial<LabelFonts>;
}

type Align = "center" | "left";
type LayoutMode = "auto" | "row" | "stack";
type BorderStyle = "none" | "line" | "frame";
/** Вариант этикетки: стандартный вид или полностью свой размер. */
type LabelMode = "standard" | "custom";

interface SheetSettings {
  widthMm: number;
  heightMm: number;
  pagePadMm: number;
  gapXMm: number;
  gapYMm: number;
  align: Align;
  layout: LayoutMode;
  border: BorderStyle;
  barcodeBars: boolean;
  barcodeDigits: boolean;
  barcodeHeightMm: number;
  showNumber: boolean;
  showTitle: boolean;
  showSizes: boolean;
  showExtra: boolean;
  fonts: LabelFonts;
}

interface Props {
  products: Product[];
  categories: { id: string; name: string }[];
}

/** А4 и константы перевода миллиметров. */
const A4_W_MM = 210;
const A4_H_MM = 297;
/** 1 мм в pt (шрифты) и в CSS-пикселях (предпросмотр). */
const PT_PER_MM = 2.834_645_669;
const PX_PER_MM = 96 / 25.4;

const STORAGE_KEY = "sgt-boxlabel-settings-v3";

/** Стандартный вид — ровно то, что печаталось раньше. */
const STANDARD_SETTINGS: SheetSettings = {
  widthMm: 210,
  heightMm: 60,
  pagePadMm: 0,
  gapXMm: 0,
  gapYMm: 4,
  align: "center",
  layout: "row",
  border: "line",
  barcodeBars: true,
  barcodeDigits: true,
  barcodeHeightMm: 25,
  showNumber: true,
  showTitle: false,
  showSizes: true,
  showExtra: false,
  fonts: { number: 54, title: 16, sizes: 16, barcode: 9, extra: 14 },
};

/** «Свой размер» — стартовая раскладка конструктора: 2 этикетки в ряд. */
const CUSTOM_SETTINGS: SheetSettings = {
  ...STANDARD_SETTINGS,
  widthMm: 100,
  heightMm: 50,
  border: "frame",
  showTitle: true,
  barcodeHeightMm: 21,
  fonts: { number: 40, title: 12, sizes: 11, barcode: 7, extra: 11 },
};

/** Готовые размеры под типовые коробки, мм. */
const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Во всю ширину 210×60", w: 210, h: 60 },
  { label: "Половина листа 105×60", w: 105, h: 60 },
  { label: "Два в ряд 100×50", w: 100, h: 50 },
  { label: "Три в ряд 70×60", w: 70, h: 60 },
  { label: "Термо 6×4 см 60×40", w: 60, h: 40 },
  { label: "Маленькая 50×30", w: 50, h: 30 },
  { label: "Квадрат 40×40", w: 40, h: 40 },
];

function clampNum(value: number, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
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
  return {
    boxNumber: p.sku || "",
    title: p.name,
    sizes: autoSizes(p),
    extra: "",
  };
}

/** Автоподбор шрифтов под размер этикетки (стартовая раскладка). */
function fitFonts(heightMm: number, stacked: boolean): LabelFonts {
  const pt = (mm: number) => Math.max(1, Math.round(mm * PT_PER_MM));
  const k = stacked ? 0.2 : 0.3;
  return {
    number: clampNum(pt(heightMm * k), 8, 200, 54),
    title: clampNum(pt(heightMm * 0.1), 5, 72, 16),
    sizes: clampNum(pt(heightMm * 0.095), 5, 72, 16),
    barcode: clampNum(pt(heightMm * 0.055), 4, 48, 9),
    extra: clampNum(pt(heightMm * 0.085), 4, 72, 14),
  };
}

function fitBarcodeHeight(heightMm: number, stacked: boolean): number {
  return clampNum(heightMm * (stacked ? 0.3 : 0.42), 8, 30, 25);
}

const FONT_LIMITS: Record<keyof LabelFonts, [number, number]> = {
  number: [8, 200],
  title: [5, 72],
  sizes: [5, 72],
  barcode: [4, 48],
  extra: [4, 72],
};

/**
 * Рамка этикетки: «frame» | «line» | «none».
 * Совместимость: в прежней версии настройка была булевым полем
 * border, поэтому true читаем как «frame», а false как «none».
 */
function resolveBorder(
  saved: Partial<SheetSettings>,
  base: SheetSettings
): BorderStyle {
  const value: unknown = saved.border;
  if (value === "none" || value === "line" || value === "frame") return value;
  if (value === true) return "frame";
  if (value === false) return "none";
  return base.border;
}

function sanitize(
  base: SheetSettings,
  saved: Partial<SheetSettings> | null | undefined
): SheetSettings {
  if (!saved || typeof saved !== "object") return base;
  const fonts = { ...base.fonts, ...(saved.fonts || {}) };
  return {
    ...base,
    ...saved,
    widthMm: clampNum(saved.widthMm ?? 0, 30, A4_W_MM, base.widthMm),
    heightMm: clampNum(saved.heightMm ?? 0, 15, A4_H_MM, base.heightMm),
    pagePadMm: clampNum(saved.pagePadMm ?? 0, 0, 25, base.pagePadMm),
    gapXMm: clampNum(saved.gapXMm ?? 0, 0, 20, base.gapXMm),
    gapYMm: clampNum(saved.gapYMm ?? 0, 0, 20, base.gapYMm),
    barcodeHeightMm: clampNum(
      saved.barcodeHeightMm ?? 0,
      8,
      30,
      base.barcodeHeightMm
    ),
    border: resolveBorder(saved, base),
    fonts: {
      number: clampNum(fonts.number, ...FONT_LIMITS.number, base.fonts.number),
      title: clampNum(fonts.title, ...FONT_LIMITS.title, base.fonts.title),
      sizes: clampNum(fonts.sizes, ...FONT_LIMITS.sizes, base.fonts.sizes),
      barcode: clampNum(fonts.barcode, ...FONT_LIMITS.barcode, base.fonts.barcode),
      extra: clampNum(fonts.extra, ...FONT_LIMITS.extra, base.fonts.extra),
    },
  };
}

/** Достаём сохранённые настройки обоих вариантов (битые значения отсекаем). */
function loadState(): { mode: LabelMode; standard: SheetSettings; custom: SheetSettings } {
  const fallback = {
    mode: "standard" as LabelMode,
    standard: STANDARD_SETTINGS,
    custom: CUSTOM_SETTINGS,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as {
      mode?: LabelMode;
      standard?: Partial<SheetSettings>;
      custom?: Partial<SheetSettings>;
    };
    return {
      mode: saved.mode === "custom" ? "custom" : "standard",
      standard: sanitize(STANDARD_SETTINGS, saved.standard),
      custom: sanitize(CUSTOM_SETTINGS, saved.custom),
    };
  } catch {
    return fallback;
  }
}

function pageCss(): string {
  // Поля листа держим нулевыми: собственную «рамку печати» задаёт
  // настройка «Поля страницы» (padding листа), иначе драйверы
  // добавляли свою и этикетки уезжали вниз.
  return "@media print { @page { size: A4 portrait; margin: 0; } }";
}

export function BoxLabelsClient({ products, categories }: Props) {
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Record<string, LabelData>>({});
  const [state, setState] = useState(() => ({
    mode: "standard" as LabelMode,
    standard: STANDARD_SETTINGS,
    custom: CUSTOM_SETTINGS,
  }));
  const [printPreparing, setPrintPreparing] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [bulkNumber, setBulkNumber] = useState<string>("");

  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);

  // Настройки вариантов переживают перезагрузку страницы.
  useEffect(() => {
    setState(loadState());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* приватный режим — просто не сохраняем */
    }
  }, [state]);

  // Режим печати: прячем интерфейс админки, оставляем только лист.
  useEffect(() => {
    document.body.classList.add("boxlabel-mode");
    return () => document.body.classList.remove("boxlabel-mode");
  }, []);

  const isCustom = state.mode === "custom";
  const settings = isCustom ? state.custom : state.standard;

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

  const setMode = useCallback((mode: LabelMode) => {
    setState((prev) => ({ ...prev, mode }));
  }, []);

  const patchSettings = useCallback(
    (patch: Partial<SheetSettings>) => {
      setState((prev) => {
        const key = prev.mode === "custom" ? "custom" : "standard";
        return { ...prev, [key]: { ...prev[key], ...patch } };
      });
    },
    []
  );

  const patchFonts = useCallback(
    (patch: Partial<LabelFonts>) => {
      setState((prev) => {
        const key = prev.mode === "custom" ? "custom" : "standard";
        const current = prev[key];
        return { ...prev, [key]: { ...current, fonts: { ...current.fonts, ...patch } } };
      });
    },
    []
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

  function setLabelFont(
    p: Product,
    key: keyof LabelFonts,
    value: number,
    fallback: number
  ) {
    const [min, max] = FONT_LIMITS[key];
    const next = clampNum(value, min, max, fallback);
    setLabels((prev) => {
      const base = prev[p.id] || defaultLabel(p);
      return {
        ...prev,
        [p.id]: { ...base, fonts: { ...(base.fonts || {}), [key]: next } },
      };
    });
  }

  function resetLabelFonts(p: Product) {
    setLabels((prev) => {
      const base = prev[p.id];
      if (!base) return prev;
      return { ...prev, [p.id]: { ...base, fonts: undefined } };
    });
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
      prev.size === filtered.length && filtered.length > 0
        ? new Set()
        : new Set(filtered.map((p) => p.id))
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

  /** Общий старт: 1, 2, 3… в поле «Начать с» — для нумерации партий. */
  function numberFrom() {
    const start = clampNum(Number(bulkNumber), -9999, 99999, 1);
    setLabels((prev) => {
      const next = { ...prev };
      selectedProducts.forEach((p, i) => {
        next[p.id] = { ...(next[p.id] || defaultLabel(p)), boxNumber: String(start + i) };
      });
      return next;
    });
  }

  /** Вертикальная раскладка: вручную или автоматически для узких этикеток. */
  function resolveStacked(s: SheetSettings): boolean {
    if (s.layout === "stack") return true;
    if (s.layout === "row") return false;
    // Уже 90 мм три колонки («№ | текст | штрихкод») уже не читаются —
    // такие этикетки собираем в колонку по центру.
    return s.widthMm < 90;
  }

  /** Подогнать шрифты и высоту штриха под выбранный размер этикетки. */
  function applyAutoFit() {
    const stacked = resolveStacked(settings);
    setState((prev) => {
      const key = prev.mode === "custom" ? "custom" : "standard";
      const current = prev[key];
      return {
        ...prev,
        [key]: {
          ...current,
          fonts: fitFonts(current.heightMm, stacked),
          barcodeHeightMm: fitBarcodeHeight(current.heightMm, stacked),
        },
      };
    });
    // Убираем персональные переопределения, иначе часть этикеток
    // осталась бы со старым размером и результат выглядел случайным.
    setLabels((prev) => {
      const next: Record<string, LabelData> = {};
      for (const [id, data] of Object.entries(prev)) {
        next[id] = { ...data, fonts: undefined };
      }
      return next;
    });
  }

  function resetSettings() {
    setState((prev) => {
      const key = prev.mode === "custom" ? "custom" : "standard";
      return {
        ...prev,
        [key]: key === "custom" ? CUSTOM_SETTINGS : STANDARD_SETTINGS,
      };
    });
  }

  /** Один клик — стандартный вид в исходном состоянии (210×60). */
  function restoreStandard() {
    setState((prev) => ({ ...prev, standard: STANDARD_SETTINGS }));
  }

  const stacked = resolveStacked(settings);
  const usableW = Math.max(10, A4_W_MM - settings.pagePadMm * 2);
  // 0,5 мм запаса по высоте: страница ровно 297 мм, и без запаса
  // браузер иногда выкидывал пустой лист из-за округления мм в пиксели.
  const usableH = Math.max(10, A4_H_MM - settings.pagePadMm * 2 - 0.5);
  const cols = Math.max(
    1,
    Math.floor((usableW + settings.gapXMm) / (settings.widthMm + settings.gapXMm))
  );
  const rowsPerPage = Math.max(
    1,
    Math.floor((usableH + settings.gapYMm) / (settings.heightMm + settings.gapYMm))
  );
  const perPage = cols * rowsPerPage;

  // Разбиваем этикетки по страницам A4 сами: каждая страница — отдельный
  // лист ровно 210×297 мм с разрывом после себя, поэтому пагинация не
  // зависит от того, как браузер режет длинную сетку.
  const pages = useMemo(() => {
    const result: Product[][] = [];
    for (let i = 0; i < selectedProducts.length; i += perPage) {
      result.push(selectedProducts.slice(i, i + perPage));
    }
    return result;
  }, [selectedProducts, perPage]);

  // ── Предпросмотр: настоящие листы A4 в масштабе ──
  useEffect(() => {
    const wrap = previewRef.current;
    if (!wrap || !showPreview) return;
    const measure = () => setPreviewWidth(wrap.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [showPreview, selectedProducts.length, settings]);

  const sheetScale =
    previewWidth > 0 ? Math.min(1, (previewWidth - 8) / (A4_W_MM * PX_PER_MM)) : 1;

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

  const sheetVars = {
    "--bl-w": `${settings.widthMm}mm`,
    "--bl-h": `${settings.heightMm}mm`,
    "--bl-gap-x": `${settings.gapXMm}mm`,
    "--bl-gap-y": `${settings.gapYMm}mm`,
    "--bl-cols": String(cols),
    "--bl-pad": `${settings.pagePadMm}mm`,
    "--bl-justify": settings.align === "left" ? "start" : "center",
  } as React.CSSProperties;

  function renderLabel(p: Product) {
    const data = getLabel(p);
    const fonts: LabelFonts = { ...settings.fonts, ...(data.fonts || {}) };
    // Высота штриха: сколько задал пользователь, но с оглядкой на
    // высоту самой этикетки — иначе код вылезал бы за её пределы.
    const barcodeHeightMm = Math.min(
      settings.barcodeHeightMm,
      settings.heightMm * (stacked ? 0.45 : 0.7)
    );
    const code = (
      <div className="boxlabel__code">
        {settings.barcodeBars && (
          <img
            src={`/api/admin/qr/barcode/${p.id}?format=svg&height=${settings.barcodeHeightMm}`}
            alt={`Штрихкод ${p.barcode}`}
            className="boxlabel__bc"
          />
        )}
        {settings.barcodeDigits && (
          <div className="boxlabel__ean" style={{ fontSize: `${fonts.barcode}pt` }}>
            {p.barcode}
          </div>
        )}
      </div>
    );
    const texts = (
      <>
        {settings.showTitle && data.title.trim() && (
          <div className="boxlabel__title" style={{ fontSize: `${fonts.title}pt` }}>
            {data.title}
          </div>
        )}
        {settings.showSizes && data.sizes.trim() && (
          <div className="boxlabel__sizes" style={{ fontSize: `${fonts.sizes}pt` }}>
            {data.sizes}
          </div>
        )}
        {settings.showExtra && data.extra.trim() && (
          <div className="boxlabel__extra" style={{ fontSize: `${fonts.extra}pt` }}>
            {data.extra}
          </div>
        )}
      </>
    );

    return (
      <div
        key={p.id}
        className={`boxlabel${settings.border === "frame" ? " boxlabel--frame" : ""}${
          settings.border === "line" ? " boxlabel--line" : ""
        }${stacked ? " boxlabel--stack" : ""}`}
        style={{ "--bl-bc-h": `${barcodeHeightMm}mm` } as React.CSSProperties}
      >
        {stacked ? (
          <>
            {settings.showNumber && (
              <div className="boxlabel__num" style={{ fontSize: `${fonts.number}pt` }}>
                № {data.boxNumber || "—"}
              </div>
            )}
            {texts}
            {(settings.barcodeBars || settings.barcodeDigits) && code}
          </>
        ) : (
          <>
            {settings.showNumber && (
              <>
                <div className="boxlabel__num" style={{ fontSize: `${fonts.number}pt` }}>
                  № {data.boxNumber || "—"}
                </div>
                <div className="boxlabel__vsep" />
              </>
            )}
            <div className="boxlabel__mid">{texts}</div>
            {(settings.barcodeBars || settings.barcodeDigits) && (
              <>
                <div className="boxlabel__vsep" />
                {code}
              </>
            )}
          </>
        )}
      </div>
    );
  }

  const standardSummary = `стандарт 210×60 мм · № | размеры | штрихкод`;
  const customSummary = `${settings.widthMm}×${settings.heightMm} мм · в ряд ${cols} · на лист ${perPage}`;

  return (
    <div className="qrprint">
      <style>{pageCss()}</style>

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

      {/* ── Переключатель варианта: стандартный вид / свой размер ── */}
      <section className="boxlabel-variant no-print">
        <span className="qrprint__seg-label">Вариант этикетки:</span>
        <div className="qrprint__seg">
          <button
            type="button"
            className={`qrprint__seg-btn${!isCustom ? " qrprint__seg-btn--active" : ""}`}
            onClick={() => setMode("standard")}
            title="Как было: полоса 210×60 мм во всю ширину A4 — № ящика, размеры и штрихкод"
          >
            <LayoutTemplate size={12} /> Стандартный вид
          </button>
          <button
            type="button"
            className={`qrprint__seg-btn${isCustom ? " qrprint__seg-btn--active" : ""}`}
            onClick={() => setMode("custom")}
            title="Свой размер: любая ширина и высота, поля листа, название и свой текст"
          >
            <SlidersHorizontal size={12} /> Свой размер
          </button>
        </div>
        <span className="boxlabel-variant__note">
          {isCustom ? customSummary : standardSummary}
        </span>
        {!isCustom && (
          <button
            type="button"
            className="admin-btn admin-btn--outline boxlabel-variant__link"
            onClick={() => setMode("custom")}
          >
            Настроить свой размер →
          </button>
        )}
        {isCustom && (
          <button
            type="button"
            className="admin-btn admin-btn--outline boxlabel-variant__link"
            onClick={restoreStandard}
            title="Вернуть стандартному виду исходные 210×60 мм и стандартные шрифты"
          >
            Сбросить стандартный вид
          </button>
        )}
      </section>

      <section className="boxlabel-panel no-print">
        <div className="boxlabel-panel__head">
          <div>
            <div className="boxlabel-panel__eyebrow">
              {isCustom ? "Конструктор этикетки" : "Стандартный вид этикетки"}
            </div>
            <h2 className="boxlabel-panel__title">
              {isCustom ? (
                <>
                  <SlidersHorizontal size={16} /> Размер и содержимое
                </>
              ) : (
                <>
                  <Ruler size={16} /> Полоса 210×60 мм на всю ширину A4
                </>
              )}
            </h2>
          </div>
          <div className="boxlabel-panel__summary">
            <span>этикетка <b>{settings.widthMm}×{settings.heightMm} мм</b></span>
            {isCustom ? (
              <>
                <span>в ряд <b>{cols}</b></span>
                <span>на лист A4 <b>{perPage}</b></span>
              </>
            ) : (
              <span>содержимое <b>№ · размеры · штрихкод</b></span>
            )}
            {selectedProducts.length > 0 && (
              <span>выбрано <b>{selectedProducts.length}</b> · листов <b>{pages.length}</b></span>
            )}
          </div>
        </div>

        {isCustom ? (
          <div className="boxlabel-panel__grid">
            <div className="boxlabel-panel__block">
              <div className="boxlabel-panel__block-title">
                <Ruler size={14} /> Размер этикетки, мм
              </div>
              <div className="boxlabel-presets">
                {SIZE_PRESETS.map((preset) => {
                  const active =
                    settings.widthMm === preset.w && settings.heightMm === preset.h;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      className={`boxlabel-preset${active ? " boxlabel-preset--on" : ""}`}
                      onClick={() => patchSettings({ widthMm: preset.w, heightMm: preset.h })}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="boxlabel-panel__row">
                <label className="boxlabel-field">
                  <span>Ширина</span>
                  <input
                    type="number"
                    min={30}
                    max={210}
                    value={settings.widthMm}
                    onChange={(e) =>
                      patchSettings({
                        widthMm: clampNum(e.currentTarget.valueAsNumber, 30, A4_W_MM, 210),
                      })
                    }
                  />
                  <small>мм</small>
                </label>
                <label className="boxlabel-field">
                  <span>Высота</span>
                  <input
                    type="number"
                    min={15}
                    max={297}
                    value={settings.heightMm}
                    onChange={(e) =>
                      patchSettings({
                        heightMm: clampNum(e.currentTarget.valueAsNumber, 15, A4_H_MM, 60),
                      })
                    }
                  />
                  <small>мм</small>
                </label>
                <label className="boxlabel-field">
                  <span>Поля листа</span>
                  <input
                    type="number"
                    min={0}
                    max={25}
                    value={settings.pagePadMm}
                    onChange={(e) =>
                      patchSettings({
                        pagePadMm: clampNum(e.currentTarget.valueAsNumber, 0, 25, 0),
                      })
                    }
                  />
                  <small>мм</small>
                </label>
              </div>
              <div className="boxlabel-panel__row">
                <label className="boxlabel-field">
                  <span>Отступ по горизонтали</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={settings.gapXMm}
                    onChange={(e) =>
                      patchSettings({
                        gapXMm: clampNum(e.currentTarget.valueAsNumber, 0, 20, 0),
                      })
                    }
                  />
                  <small>мм</small>
                </label>
                <label className="boxlabel-field">
                  <span>Отступ по вертикали</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={settings.gapYMm}
                    onChange={(e) =>
                      patchSettings({
                        gapYMm: clampNum(e.currentTarget.valueAsNumber, 0, 20, 4),
                      })
                    }
                  />
                  <small>мм</small>
                </label>
                <label className="boxlabel-field">
                  <span>Выравнивание</span>
                  <select
                    value={settings.align}
                    onChange={(e) => patchSettings({ align: e.target.value as Align })}
                  >
                    <option value="center">По центру листа</option>
                    <option value="left">По левому краю</option>
                  </select>
                </label>
              </div>
              <div className="boxlabel-panel__hint">
                Ширину больше 210 мм лист не вместит. Для маленьких коробок
                ставьте 60×40, 50×30 и т. п. — браузер сам разложит их в ряд.
              </div>
            </div>

            <div className="boxlabel-panel__block">
              <div className="boxlabel-panel__block-title">
                <LayoutTemplate size={14} /> Что печатать на этикетке
              </div>
              <div className="boxlabel-toggles">
                {([
                  ["showNumber", "№ ящика"],
                  ["showTitle", "Название"],
                  ["showSizes", "Размеры"],
                  ["showExtra", "Свой текст"],
                  ["barcodeBars", "Штрихкод (полосы)"],
                  ["barcodeDigits", "Цифры EAN-13 строкой"],
                ] as [keyof SheetSettings, string][]).map(([key, label]) => (
                  <label key={String(key)} className="boxlabel-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(settings[key])}
                      onChange={(e) =>
                        patchSettings({ [key]: e.target.checked } as Partial<SheetSettings>)
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="boxlabel-panel__row">
                <label className="boxlabel-field">
                  <span>Раскладка полосы</span>
                  <select
                    value={settings.layout}
                    onChange={(e) => patchSettings({ layout: e.target.value as LayoutMode })}
                  >
                    <option value="auto">Авто (по ширине)</option>
                    <option value="row">Горизонтально</option>
                    <option value="stack">Вертикально</option>
                  </select>
                </label>
                <label className="boxlabel-field">
                  <span>Высота штриха</span>
                  <input
                    type="number"
                    min={8}
                    max={30}
                    value={settings.barcodeHeightMm}
                    onChange={(e) =>
                      patchSettings({
                        barcodeHeightMm: clampNum(e.currentTarget.valueAsNumber, 8, 30, 25),
                      })
                    }
                  />
                  <small>мм</small>
                </label>
                <label className="boxlabel-field">
                  <span>Рамка</span>
                  <select
                    value={settings.border}
                    onChange={(e) => patchSettings({ border: e.target.value as BorderStyle })}
                  >
                    <option value="frame">Рамка реза</option>
                    <option value="line">Линия снизу</option>
                    <option value="none">Без рамки</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="boxlabel-panel__block">
              <div className="boxlabel-panel__block-title">
                <Type size={14} /> Шрифты (pt) — общие для всех этикеток
              </div>
              <div className="boxlabel-panel__row">
                {([
                  ["number", "Номер"],
                  ["title", "Название"],
                  ["sizes", "Размеры"],
                  ["extra", "Свой текст"],
                  ["barcode", "Цифры кода"],
                ] as [keyof LabelFonts, string][]).map(([key, label]) => (
                  <label key={key} className="boxlabel-field">
                    <span>{label}</span>
                    <input
                      type="number"
                      min={FONT_LIMITS[key][0]}
                      max={FONT_LIMITS[key][1]}
                      value={settings.fonts[key]}
                      onChange={(e) =>
                        patchFonts({
                          [key]: clampNum(
                            e.currentTarget.valueAsNumber,
                            FONT_LIMITS[key][0],
                            FONT_LIMITS[key][1],
                            settings.fonts[key]
                          ),
                        })
                      }
                    />
                    <small>pt</small>
                  </label>
                ))}
              </div>
              <div className="boxlabel-panel__actions">
                <button type="button" className="admin-btn admin-btn--outline" onClick={applyAutoFit}>
                  <Sparkles size={14} /> Подогнать под размер {settings.heightMm} мм
                </button>
                <button type="button" className="admin-btn admin-btn--outline" onClick={resetSettings}>
                  Сбросить настройки
                </button>
                <label className="boxlabel-toggle boxlabel-toggle--inline">
                  <input
                    type="checkbox"
                    checked={showPreview}
                    onChange={(e) => setShowPreview(e.target.checked)}
                  />
                  <span>Предпросмотр листа</span>
                </label>
              </div>
              <div className="boxlabel-panel__hint">
                «Подогнать под размер» подбирает стартовые шрифты и высоту
                штриха под высоту этикетки — дальше правьте вручную. Шрифт
                одной конкретной этикетки можно переопределить в её карточке
                ниже.
              </div>
            </div>
          </div>
        ) : (
          // Стандартный вид: настраиваются только шрифты — размер и
          // содержимое полосы зафиксированы, как было раньше.
          <div className="boxlabel-panel__block">
            <div className="boxlabel-panel__block-title">
              <Type size={14} /> Шрифты перед печатью (pt) — можно изменить у каждой этикетки
            </div>
            <div className="boxlabel-panel__row">
              {([
                ["number", "Номер"],
                ["sizes", "Размеры"],
                ["barcode", "Цифры кода"],
              ] as [keyof LabelFonts, string][]).map(([key, label]) => (
                <label key={key} className="boxlabel-field">
                  <span>{label}</span>
                  <input
                    type="number"
                    min={FONT_LIMITS[key][0]}
                    max={FONT_LIMITS[key][1]}
                    value={settings.fonts[key]}
                    onChange={(e) =>
                      patchFonts({
                        [key]: clampNum(
                          e.currentTarget.valueAsNumber,
                          FONT_LIMITS[key][0],
                          FONT_LIMITS[key][1],
                          settings.fonts[key]
                        ),
                      })
                    }
                  />
                  <small>pt</small>
                </label>
              ))}
              <label className="boxlabel-field">
                <span>Высота штриха</span>
                <input
                  type="number"
                  min={8}
                  max={30}
                  value={settings.barcodeHeightMm}
                  onChange={(e) =>
                    patchSettings({
                      barcodeHeightMm: clampNum(e.currentTarget.valueAsNumber, 8, 30, 25),
                    })
                  }
                />
                <small>мм</small>
              </label>
              <label className="boxlabel-toggle boxlabel-toggle--inline">
                <input
                  type="checkbox"
                  checked={showPreview}
                  onChange={(e) => setShowPreview(e.target.checked)}
                />
                <span>Предпросмотр листа</span>
              </label>
            </div>
            <div className="boxlabel-panel__actions">
              <button type="button" className="admin-btn admin-btn--outline" onClick={resetSettings}>
                Вернуть стандартные шрифты
              </button>
            </div>
            <div className="boxlabel-panel__hint">
              Это прежний вид этикетки ящика: полоса 210×60 мм во всю ширину
              листа с рамкой реза, крупный №, размеры по центру и штрихкод
              EAN-13 с цифрами. Нужен другой размер — переключите вариант на
              «Свой размер» выше.
            </div>
          </div>
        )}
      </section>

      {/* ── Тексты этикеток: по карточке на товар ── */}
      <div className="boxlabel-edit no-print">
        {filtered.map((p) => {
          const isSel = selected.has(p.id);
          const label = getLabel(p);
          const overridden = label.fonts && Object.keys(label.fonts).length > 0;
          const fonts: LabelFonts = { ...settings.fonts, ...(label.fonts || {}) };
          const fontKeys: ([keyof LabelFonts, string][]) = isCustom
            ? [
                ["number", "Номер"],
                ["title", "Название"],
                ["sizes", "Размеры"],
                ["extra", "Свой текст"],
                ["barcode", "Цифры кода"],
              ]
            : [
                ["number", "Номер"],
                ["sizes", "Размеры"],
                ["barcode", "Цифры кода"],
              ];
          return (
            <div key={p.id} className={`boxlabel-item${isSel ? " boxlabel-item--on" : ""}`}>
              <div className="boxlabel-item__head" onClick={() => toggle(p)}>
                <input type="checkbox" checked={isSel} readOnly />
                <span className="boxlabel-item__name">{p.name}</span>
                {p.sku && <span className="admin-badge admin-badge--muted">{p.sku}</span>}
                {overridden && <span className="admin-badge">шрифт свой</span>}
              </div>
              {isSel && (
                <div className="boxlabel-item__form" onClick={(e) => e.stopPropagation()}>
                  <div className="boxlabel-item__grid">
                    <div className="admin-field" style={{ marginBottom: 0 }}>
                      <label className="admin-label">
                        <Hash size={11} /> № ящика (крупно)
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
                    {isCustom && (
                      <>
                        <div className="admin-field" style={{ marginBottom: 0 }}>
                          <label className="admin-label">Название на этикетке</label>
                          <input
                            className="admin-input"
                            value={label.title}
                            onChange={(e) => setLabel(p, { title: e.target.value })}
                            placeholder="Название товара"
                          />
                        </div>
                        <div className="admin-field" style={{ marginBottom: 0 }}>
                          <label className="admin-label">Свой текст (одна строка)</label>
                          <input
                            className="admin-input"
                            value={label.extra}
                            onChange={(e) => setLabel(p, { extra: e.target.value })}
                            placeholder="ХРУПКОЕ · верх"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  <details className="boxlabel-item__fonts">
                    <summary>Шрифты этой этикетки {overridden ? "(свои)" : "(как у всех)"}</summary>
                    <div className="boxlabel-item__fonts-row">
                      {fontKeys.map(([key, label2]) => (
                        <label key={key} className="boxlabel-field boxlabel-field--mini">
                          <span>{label2}</span>
                          <input
                            type="number"
                            value={fonts[key]}
                            onChange={(e) =>
                              setLabelFont(p, key, e.currentTarget.valueAsNumber, settings.fonts[key])
                            }
                          />
                        </label>
                      ))}
                      {overridden && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--outline"
                          onClick={() => resetLabelFonts(p)}
                        >
                          <X size={13} /> Как у всех
                        </button>
                      )}
                    </div>
                  </details>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="admin-empty">Ничего не найдено</div>}
      </div>

      <div className="boxlabel-actions no-print">
        <button
          type="button"
          className="admin-btn admin-btn--outline"
          disabled={selectedProducts.length === 0}
          onClick={numberSequentially}
          title="Заполнит № ящиков 1, 2, 3… по порядку выбора"
        >
          <ListOrdered size={15} /> № по порядку с 1
        </button>
        <label className="boxlabel-numstart">
          <span>Начать с</span>
          <input
            className="admin-input"
            type="number"
            placeholder="1"
            value={bulkNumber}
            onChange={(e) => setBulkNumber(e.target.value)}
          />
          <button
            type="button"
            className="admin-btn admin-btn--outline"
            disabled={selectedProducts.length === 0}
            onClick={numberFrom}
            title="Пронумеровать выбранные, начиная с указанного числа"
          >
            Пронумеровать
          </button>
        </label>
        <button
          type="button"
          className="qrprint__print-btn"
          disabled={selectedProducts.length === 0 || printPreparing}
          onClick={handlePrint}
        >
          {printPreparing ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
          {printPreparing
            ? "Подготавливаем штрихкоды…"
            : isCustom
              ? `Печатать ${selectedProducts.length} шт. · ${settings.widthMm}×${settings.heightMm} мм`
              : `Печатать ${selectedProducts.length} шт. · стандарт 210×60 мм`}
        </button>
      </div>

      {selectedProducts.length === 0 && (
        <div className="boxlabel-empty no-print">
          Выберите товары выше — появится предпросмотр листа и кнопка печати.
        </div>
      )}

      {/* ── Предпросмотр настоящих листов A4 (они же уходят в печать) ── */}
      <div
        className={`boxlabel-preview${showPreview && pages.length > 0 ? "" : " boxlabel-preview--hidden"}`}
        ref={previewRef}
      >
        {pages.map((page, index) => (
          <div className="boxlabel-page" key={index}>
            <div className="boxlabel-page__caption no-print">
              Лист {index + 1} из {pages.length} · {page.length} шт.
            </div>
            <div
              className="boxlabel-page__viewport"
              style={{
                width: `${A4_W_MM * PX_PER_MM * sheetScale}px`,
                height: `${A4_H_MM * PX_PER_MM * sheetScale}px`,
              }}
            >
              <div
                className="boxlabel-sheet"
                style={{ ...sheetVars, transform: `scale(${sheetScale})` }}
              >
                {page.map((p) => renderLabel(p))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
