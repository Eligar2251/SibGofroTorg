// =========================================================
// FILE: src/components/admin/BoxLabelsClient.tsx
// Печать этикеток ЯЩИКОВ на листе A4 — конструктор раскладки.
//
// Что настраивается (всё на одной странице, без SQL и модалок):
// • Размер этикетки: ширина × высота в мм (пресеты + своё значение).
//   Маленькие коробки больше не обязаны занимать всю ширину A4 —
//   этикетки раскладываются в сетку: 210×60 = 1 в ряд,
//   100×50 = 2 в ряд, 70×60 = 3 в ряд и т.д.
// • Поля страницы, отступы между этикетками, выравнивание, рамка реза.
// • Что печатать: № ящика, название, размеры, свой текст, штрихкод
//   (полосы) и/или цифры EAN-13 отдельной строкой.
// • Шрифты (общие для всех) + высота штриха. У отдельной этикетки
//   шрифт можно переопределить в её карточке.
// • Живой предпросмотр настоящего листа A4 в масштабе 1:1 по мм,
//   поэтому на экране видно ровно то, что уйдёт в печать.
//
// Товары подставляются автоматически (№ = артикул, размеры из
// карточки), но каждая этикетка редактируется вручную.
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

interface SheetSettings {
  widthMm: number;
  heightMm: number;
  pagePadMm: number;
  gapXMm: number;
  gapYMm: number;
  align: Align;
  layout: LayoutMode;
  border: boolean;
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

const STORAGE_KEY = "sgt-boxlabel-settings-v2";

const DEFAULT_SETTINGS: SheetSettings = {
  widthMm: 210,
  heightMm: 60,
  pagePadMm: 0,
  gapXMm: 0,
  gapYMm: 4,
  align: "center",
  layout: "auto",
  border: true,
  barcodeBars: true,
  barcodeDigits: false,
  barcodeHeightMm: 25,
  showNumber: true,
  showTitle: true,
  showSizes: true,
  showExtra: false,
  fonts: { number: 54, title: 16, sizes: 16, barcode: 9, extra: 14 },
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
  const k = stacked ? 0.20 : 0.30;
  return {
    number: clampNum(pt(heightMm * k), 8, 200, 54),
    title: clampNum(pt(heightMm * 0.10), 5, 72, 16),
    sizes: clampNum(pt(heightMm * 0.095), 5, 72, 16),
    barcode: clampNum(pt(heightMm * 0.055), 4, 48, 9),
    extra: clampNum(pt(heightMm * 0.085), 4, 72, 14),
  };
}

function fitBarcodeHeight(heightMm: number, stacked: boolean): number {
  return clampNum(heightMm * (stacked ? 0.30 : 0.42), 8, 30, 25);
}

/** Достаём сохранённые настройки (битые/старые значения отсекаем). */
function loadSettings(): SheetSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<SheetSettings>;
    const fonts = { ...DEFAULT_SETTINGS.fonts, ...(saved.fonts || {}) };
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      widthMm: clampNum(saved.widthMm ?? 0, 30, A4_W_MM, DEFAULT_SETTINGS.widthMm),
      heightMm: clampNum(saved.heightMm ?? 0, 15, A4_H_MM, DEFAULT_SETTINGS.heightMm),
      pagePadMm: clampNum(saved.pagePadMm ?? 0, 0, 25, 0),
      gapXMm: clampNum(saved.gapXMm ?? 0, 0, 20, DEFAULT_SETTINGS.gapXMm),
      gapYMm: clampNum(saved.gapYMm ?? 0, 0, 20, DEFAULT_SETTINGS.gapYMm),
      barcodeHeightMm: clampNum(saved.barcodeHeightMm ?? 0, 8, 30, DEFAULT_SETTINGS.barcodeHeightMm),
      fonts: {
        number: clampNum(fonts.number, 8, 200, DEFAULT_SETTINGS.fonts.number),
        title: clampNum(fonts.title, 5, 72, DEFAULT_SETTINGS.fonts.title),
        sizes: clampNum(fonts.sizes, 5, 72, DEFAULT_SETTINGS.fonts.sizes),
        barcode: clampNum(fonts.barcode, 4, 48, DEFAULT_SETTINGS.fonts.barcode),
        extra: clampNum(fonts.extra, 4, 72, DEFAULT_SETTINGS.fonts.extra),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
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
  const [settings, setSettings] = useState<SheetSettings>(DEFAULT_SETTINGS);
  const [printPreparing, setPrintPreparing] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [bulkNumber, setBulkNumber] = useState<string>("");

  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);

  // Настройки переживают перезагрузку страницы.
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* приватный режим — просто не сохраняем */
    }
  }, [settings]);

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

  const patchSettings = useCallback((patch: Partial<SheetSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const patchFonts = useCallback((patch: Partial<LabelFonts>) => {
    setSettings((prev) => ({ ...prev, fonts: { ...prev.fonts, ...patch } }));
  }, []);

  function getLabel(p: Product): LabelData {
    return labels[p.id] || defaultLabel(p);
  }

  function setLabel(p: Product, patch: Partial<LabelData>) {
    setLabels((prev) => ({
      ...prev,
      [p.id]: { ...(prev[p.id] || defaultLabel(p)), ...patch },
    }));
  }

  function setLabelFont(p: Product, key: keyof LabelFonts, value: number, fallback: number) {
    const limits: Record<keyof LabelFonts, [number, number]> = {
      number: [8, 200],
      title: [5, 72],
      sizes: [5, 72],
      barcode: [4, 48],
      extra: [4, 72],
    };
    const [min, max] = limits[key];
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

  /** Подогнать шрифты и высоту штриха под выбранный размер этикетки. */
  function applyAutoFit() {
    const stacked = resolveStacked(settings);
    setSettings((prev) => ({
      ...prev,
      fonts: fitFonts(prev.heightMm, stacked),
      barcodeHeightMm: fitBarcodeHeight(prev.heightMm, stacked),
    }));
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
    setSettings(DEFAULT_SETTINGS);
  }

  /** Вертикальная раскладка: вручную или автоматически для узких этикеток. */
  function resolveStacked(s: SheetSettings): boolean {
    if (s.layout === "stack") return true;
    if (s.layout === "row") return false;
    // Уже 90 мм три колонки («№ | текст | штрихкод») уже не читаются —
    // такие этикетки собираем в колонку по центру.
    return s.widthMm < 90;
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
    previewWidth > 0
      ? Math.min(1, (previewWidth - 8) / (A4_W_MM * PX_PER_MM))
      : 1;

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
        className={`boxlabel${settings.border ? " boxlabel--border" : ""}${
          stacked ? " boxlabel--stack" : ""
        }`}
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

      {/* ── Конструктор этикетки: размер, лист, содержимое, шрифты ── */}
      <section className="boxlabel-panel no-print">
        <div className="boxlabel-panel__head">
          <div>
            <div className="boxlabel-panel__eyebrow">Конструктор этикетки</div>
            <h2 className="boxlabel-panel__title">
              <SlidersHorizontal size={16} /> Размер и содержимое
            </h2>
          </div>
          <div className="boxlabel-panel__summary">
            <span>этикетка <b>{settings.widthMm}×{settings.heightMm} мм</b></span>
            <span>в ряд <b>{cols}</b></span>
            <span>на лист A4 <b>{perPage}</b></span>
            {selectedProducts.length > 0 && (
              <span>выбрано <b>{selectedProducts.length}</b> · листов <b>{pages.length}</b></span>
            )}
          </div>
        </div>

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
                    onChange={(e) => patchSettings({ [key]: e.target.checked } as Partial<SheetSettings>)}
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
              <label className="boxlabel-toggle boxlabel-toggle--inline">
                <input
                  type="checkbox"
                  checked={settings.border}
                  onChange={(e) => patchSettings({ border: e.target.checked })}
                />
                <span>Рамка реза</span>
              </label>
            </div>
          </div>

          <div className="boxlabel-panel__block">
            <div className="boxlabel-panel__block-title">
              <Type size={14} /> Шрифты (pt) — общие для всех этикеток
            </div>
            <div className="boxlabel-panel__row">
              {([
                ["number", "Номер", 8, 200],
                ["title", "Название", 5, 72],
                ["sizes", "Размеры", 5, 72],
                ["extra", "Свой текст", 4, 72],
                ["barcode", "Цифры кода", 4, 48],
              ] as [keyof LabelFonts, string, number, number][]).map(([key, label, min, max]) => (
                <label key={key} className="boxlabel-field">
                  <span>{label}</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={settings.fonts[key]}
                    onChange={(e) =>
                      patchFonts({
                        [key]: clampNum(e.currentTarget.valueAsNumber, min, max, settings.fonts[key]),
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
      </section>

      {/* ── Тексты этикеток: по карточке на товар ── */}
      <div className="boxlabel-edit no-print">
        {filtered.map((p) => {
          const isSel = selected.has(p.id);
          const label = getLabel(p);
          const overridden = label.fonts && Object.keys(label.fonts).length > 0;
          const fonts: LabelFonts = { ...settings.fonts, ...(label.fonts || {}) };
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
                      <label className="admin-label">Название на этикетке</label>
                      <input
                        className="admin-input"
                        value={label.title}
                        onChange={(e) => setLabel(p, { title: e.target.value })}
                        placeholder="Название товара"
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
                    <div className="admin-field" style={{ marginBottom: 0 }}>
                      <label className="admin-label">Свой текст (одна строка)</label>
                      <input
                        className="admin-input"
                        value={label.extra}
                        onChange={(e) => setLabel(p, { extra: e.target.value })}
                        placeholder="ХРУПКОЕ · верх"
                      />
                    </div>
                  </div>

                  <details className="boxlabel-item__fonts">
                    <summary>Шрифты этой этикетки {overridden ? "(свои)" : "(как у всех)"}</summary>
                    <div className="boxlabel-item__fonts-row">
                      {([
                        ["number", "Номер"],
                        ["title", "Название"],
                        ["sizes", "Размеры"],
                        ["extra", "Свой текст"],
                        ["barcode", "Цифры кода"],
                      ] as [keyof LabelFonts, string][]).map(([key, label2]) => (
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
            : `Печатать ${selectedProducts.length} шт. · ${settings.widthMm}×${settings.heightMm} мм`}
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
