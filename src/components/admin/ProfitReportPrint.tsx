"use client";

// =========================================================
// FILE: src/components/admin/ProfitReportPrint.tsx
// Печатная форма отчёта «Выгода продаж» и настройки печати.
//
// Что здесь:
//   • PrintSettings — все настройки печати (ориентация листа, компактность,
//     оформление, акцентный цвет, состав колонок, графики, выравнивание,
//     масштаб, сортировка строк, водяной знак, сноска, ABC-анализ);
//   • PRINT_VARIANTS — готовые варианты («Полный», «Компактный»,
//     «Горизонтально», «С графиками», «По продажам», «Развёрнутый»,
//     «Только итоги»);
//   • planSheet() — расчёт ширины колонок по фактическому содержимому,
//     чтобы ни одна цифра не вылезала за свою ячейку (автоподбор размера
//     шрифта и паддингов под вертикальный/горизонтальный лист);
//   • PrintSheet — сам лист A4 с шапкой, таблицей, диаграммами (полосы,
//     кольцо, продажи по дням), плашками итогов и подписью;
//   • buildReportCss() — стили листа (одинаковые для превью и печати)
//     и правила @media print (ориентация @page, скрытие админки).
// =========================================================

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";

// ── Типы данных, которые приходят из ProfitReportClient ──
// (структурно совместимы с Position / Calc / ReportMeta)
export interface PrintSaleRow {
  id: string;
  date: string;
  customer: string;
  qty: number;
  price: number;
}
export interface PrintPosRow {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  productionCost: number;
  competitorPrice: number;
  salePrice: number;
  sales: PrintSaleRow[];
}
export interface PrintCalcRow {
  qty: number;
  revenue: number;
  ourCost: number;
  competitorCost: number;
  ourProfit: number;
  competitorProfit: number;
  benefit: number;
  margin: number;
}
export interface PrintMeta {
  title: string;
  company: string;
  periodFrom: string;
  periodTo: string;
  note: string;
  signer: string;
}

// ── Настройки печати ──
export type PrintOrientation = "portrait" | "landscape";
export type PrintDensity = "comfort" | "normal" | "compact" | "ultra";
export type PrintLayout = "classic" | "striped" | "minimal" | "accent";
export type PrintVariantId =
  | "full"
  | "compact"
  | "wide"
  | "chart"
  | "sales"
  | "summary"
  | "director"
  | "custom";
export type PrintReportMode = "table" | "director";
export type PrintChartMetric = "benefit" | "profit" | "revenue" | "qty";
export type PrintAlign = "right" | "center";
export type PrintNameAlign = "left" | "center";
/** Порядок строк таблицы в печати. */
export type PrintSort =
  | "asIs"
  | "benefitDesc"
  | "profitDesc"
  | "revenueDesc"
  | "qtyDesc"
  | "nameAsc";
/** Акцентный цвет оформления листа (для цветной печати). */
export type PrintAccent =
  | "auto"
  | "blue"
  | "violet"
  | "green"
  | "cyan"
  | "orange"
  | "rose"
  | "graphite";

export interface PrintColumns {
  index: boolean;
  qty: boolean;
  salePrice: boolean;
  revenue: boolean;
  ourUnit: boolean;
  ourSum: boolean;
  compUnit: boolean;
  compSum: boolean;
  ourProfit: boolean;
  compProfit: boolean;
  benefit: boolean;
  margin: boolean;
}

export interface PrintSettings {
  variant: PrintVariantId;
  reportMode: PrintReportMode;
  orientation: PrintOrientation;
  density: PrintDensity;
  layout: PrintLayout;
  /** Выравнивание чисел в ячейках. */
  alignNumbers: PrintAlign;
  /** Выравнивание названий товаров. */
  alignName: PrintNameAlign;
  /** Подбор размера таблицы: авто (по содержимому) или вручную. */
  scaleMode: "auto" | "manual";
  scale: number;
  /** Печатать знак ₽ в ячейках. */
  currency: boolean;
  showPositions: boolean;
  showHeader: boolean;
  showCards: boolean;
  showTotals: boolean;
  showSignature: boolean;
  showFooter: boolean;
  showSku: boolean;
  showDetails: boolean;
  chartBars: boolean;
  chartDonut: boolean;
  chartTimeline: boolean;
  chartMetric: PrintChartMetric;
  chartTop: number;
  columns: PrintColumns;
  mono: boolean;
  /** Порядок строк в печати. */
  sort: PrintSort;
  /** Не печатать позиции без продаж и количества. */
  hideEmpty: boolean;
  /** Суммы без копеек (цены за единицу всегда с копейками). */
  wholeRubles: boolean;
  /** Акцентный цвет оформления (в ч/б режиме игнорируется). */
  accent: PrintAccent;
  /** Водяной знак (гриф) поверх листа; пусто — без водяного знака. */
  watermark: string;
  /** Блок «ABC-анализ по выгоде» на листе. */
  showAbc: boolean;
  /** Показывать период в шапке. */
  showPeriod: boolean;
  /** Показывать дату формирования. */
  showGenDate: boolean;
  /** Свой текст сноски внизу листа; пусто — стандартный. */
  footerText: string;
  directorSummary: boolean;
  directorItems: boolean;
  directorCharts: boolean;
  directorClients: boolean;
  directorForecast: boolean;
  directorAdvice: boolean;
  directorSales: boolean;
  directorOverall: boolean;
  directorTop: number;
}

const ALL_COLUMNS: PrintColumns = {
  index: false,
  qty: true,
  salePrice: true,
  revenue: true,
  ourUnit: true,
  ourSum: true,
  compUnit: true,
  compSum: true,
  ourProfit: true,
  compProfit: false,
  benefit: true,
  margin: true,
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  variant: "full",
  reportMode: "table",
  orientation: "portrait",
  density: "normal",
  layout: "classic",
  alignNumbers: "right",
  alignName: "left",
  scaleMode: "auto",
  scale: 1,
  currency: true,
  showPositions: true,
  showHeader: true,
  showCards: true,
  showTotals: true,
  showSignature: true,
  showFooter: true,
  showSku: true,
  showDetails: false,
  chartBars: false,
  chartDonut: false,
  chartTimeline: false,
  chartMetric: "benefit",
  chartTop: 8,
  columns: ALL_COLUMNS,
  mono: true,
  sort: "asIs",
  hideEmpty: false,
  wholeRubles: false,
  accent: "auto",
  watermark: "",
  showAbc: false,
  showPeriod: true,
  showGenDate: true,
  footerText: "",
  directorSummary: true,
  directorItems: true,
  directorCharts: true,
  directorClients: true,
  directorForecast: true,
  directorAdvice: true,
  directorSales: true,
  directorOverall: true,
  directorTop: 0,
};

export interface VariantDef {
  id: Exclude<PrintVariantId, "custom">;
  label: string;
  hint: string;
  patch: Omit<Partial<PrintSettings>, "columns"> & { columns?: Partial<PrintColumns> };
}

// Готовые варианты печати: каждый задаёт полный набор параметров.
export const PRINT_VARIANTS: VariantDef[] = [
  {
    id: "full",
    label: "Полный",
    hint: "Все основные колонки, вертикальный лист, средняя плотность.",
    patch: {
      reportMode: "table",
      orientation: "portrait",
      density: "normal",
      layout: "classic",
      scaleMode: "auto",
      showPositions: true,
      showHeader: true,
      showCards: true,
      showTotals: true,
      showSignature: true,
      showFooter: true,
      showSku: true,
      showDetails: false,
      chartBars: false,
      chartDonut: false,
      chartTimeline: false,
      columns: { ...ALL_COLUMNS },
    },
  },
  {
    id: "compact",
    label: "Компактный",
    hint: "Мелкий шрифт и минимум колонок — влезает больше позиций на лист.",
    patch: {
      reportMode: "table",
      orientation: "portrait",
      density: "ultra",
      layout: "striped",
      scaleMode: "auto",
      showPositions: true,
      showHeader: true,
      showCards: false,
      showTotals: true,
      showSignature: false,
      showFooter: true,
      showSku: false,
      showDetails: false,
      chartBars: false,
      chartDonut: false,
      chartTimeline: false,
      columns: {
        ...ALL_COLUMNS,
        salePrice: false,
        ourUnit: false,
        compUnit: false,
        compProfit: false,
      },
    },
  },
  {
    id: "wide",
    label: "Горизонтально",
    hint: "Альбомный лист: все колонки, включая прибыль конкурента и №.",
    patch: {
      reportMode: "table",
      orientation: "landscape",
      density: "normal",
      layout: "classic",
      scaleMode: "auto",
      showPositions: true,
      showHeader: true,
      showCards: true,
      showTotals: true,
      showSignature: true,
      showFooter: true,
      showSku: true,
      showDetails: false,
      chartBars: false,
      chartDonut: false,
      chartTimeline: false,
      columns: { ...ALL_COLUMNS, index: true, compProfit: true },
    },
  },
  {
    id: "chart",
    label: "С графиками",
    hint: "Альбомный лист: таблица + полосы по позициям + структура выгоды.",
    patch: {
      reportMode: "table",
      orientation: "landscape",
      density: "compact",
      layout: "accent",
      scaleMode: "auto",
      showPositions: true,
      showHeader: true,
      showCards: true,
      showTotals: true,
      showSignature: true,
      showFooter: false,
      showSku: false,
      showDetails: false,
      chartBars: true,
      chartDonut: true,
      chartTimeline: false,
      chartMetric: "benefit",
      chartTop: 10,
      columns: {
        ...ALL_COLUMNS,
        salePrice: false,
        compUnit: false,
        compProfit: false,
      },
    },
  },
  {
    id: "sales",
    label: "По продажам",
    hint: "Вертикальный лист: под каждым товаром расшифровка — кому, когда, сколько.",
    patch: {
      reportMode: "table",
      orientation: "portrait",
      density: "compact",
      layout: "classic",
      scaleMode: "auto",
      showPositions: true,
      showHeader: true,
      showCards: false,
      showTotals: true,
      showSignature: true,
      showFooter: false,
      showSku: true,
      showDetails: true,
      chartBars: false,
      chartDonut: false,
      chartTimeline: false,
      columns: {
        ...ALL_COLUMNS,
        ourUnit: false,
        compUnit: false,
        compProfit: false,
        margin: false,
      },
    },
  },
  {
    id: "director",
    label: "Развёрнутый",
    hint: "Многостраничный отчёт: сводка, прогноз на месяц, отдельный лист на каждую позицию с графиками и рекомендациями.",
    patch: {
      reportMode: "director",
      orientation: "portrait",
      density: "normal",
      layout: "minimal",
      scaleMode: "auto",
      mono: true,
      showPositions: true,
      showHeader: true,
      showCards: true,
      showTotals: true,
      showSignature: true,
      showFooter: false,
      showSku: true,
      showDetails: false,
      chartBars: true,
      chartDonut: true,
      chartTimeline: true,
      chartMetric: "benefit",
      chartTop: 12,
      directorSummary: true,
      directorItems: true,
      directorCharts: true,
      directorClients: true,
      directorForecast: true,
      directorAdvice: true,
      directorSales: true,
      directorOverall: true,
      directorTop: 0,
      columns: { ...ALL_COLUMNS, index: true, compProfit: true },
    },
  },
  {
    id: "summary",
    label: "Только итоги",
    hint: "Краткая сводка: плашки, диаграммы и график продаж по дням.",
    patch: {
      reportMode: "table",
      orientation: "landscape",
      density: "comfort",
      layout: "minimal",
      scaleMode: "auto",
      showPositions: false,
      showHeader: true,
      showCards: true,
      showTotals: false,
      showSignature: true,
      showFooter: true,
      showSku: false,
      showDetails: false,
      chartBars: true,
      chartDonut: true,
      chartTimeline: true,
      chartMetric: "benefit",
      chartTop: 12,
    },
  },
];

export function applyVariant(
  id: Exclude<PrintVariantId, "custom">,
  settings: PrintSettings
): PrintSettings {
  const def = PRINT_VARIANTS.find((v) => v.id === id);
  if (!def) return settings;
  const { columns, ...rest } = def.patch;
  return {
    ...settings,
    ...rest,
    columns: { ...settings.columns, ...(columns || {}) },
    variant: id,
  };
}

/** Точечная правка настроек: помечаем вариант как «свой». */
export function patchSettings(
  settings: PrintSettings,
  patch: Partial<PrintSettings>
): PrintSettings {
  return { ...settings, ...patch, variant: "custom" };
}

export const VARIANT_LABELS: Record<PrintVariantId, string> = {
  director: "Развёрнутый",
  full: "Полный",
  compact: "Компактный",
  wide: "Горизонтально",
  chart: "С графиками",
  sales: "По продажам",
  summary: "Только итоги",
  custom: "Свои настройки",
};

export const REPORT_MODE_LABELS: Record<PrintReportMode, string> = {
  table: "Таблица",
  director: "Развёрнутый (по листу на позицию)",
};

export const SORT_LABELS: Record<PrintSort, string> = {
  asIs: "Как в редакторе",
  benefitDesc: "По выгоде",
  profitDesc: "По прибыли",
  revenueDesc: "По выручке",
  qtyDesc: "По количеству",
  nameAsc: "По названию (А–Я)",
};

export const ACCENT_LABELS: Record<PrintAccent, string> = {
  auto: "Авто",
  blue: "Синий",
  violet: "Фиолетовый",
  green: "Зелёный",
  cyan: "Бирюзовый",
  orange: "Оранжевый",
  rose: "Розовый",
  graphite: "Графит",
};

export const ORIENTATION_LABELS: Record<PrintOrientation, string> = {
  portrait: "Вертикально (книжная)",
  landscape: "Горизонтально (альбомная)",
};

export const DENSITY_LABELS: Record<PrintDensity, string> = {
  comfort: "Просторно",
  normal: "Стандарт",
  compact: "Плотно",
  ultra: "Очень плотно",
};

export const LAYOUT_LABELS: Record<PrintLayout, string> = {
  classic: "Классика",
  striped: "Полосы",
  minimal: "Строгий",
  accent: "Акцент",
};

export const METRIC_LABELS: Record<PrintChartMetric, string> = {
  benefit: "Выгода производства",
  profit: "Прибыль (наша)",
  revenue: "Выручка",
  qty: "Количество, шт",
};

export const COLUMN_LABELS: Record<keyof PrintColumns, string> = {
  index: "№",
  qty: "Кол-во, шт",
  salePrice: "Цена продажи",
  revenue: "Выручка",
  ourUnit: "Мы: с/с 1 шт",
  ourSum: "Мы: сумма",
  compUnit: "Конкур.: 1 шт",
  compSum: "Конкур.: сумма",
  ourProfit: "Прибыль (наша)",
  compProfit: "Прибыль конкур.",
  benefit: "Выгода произв.",
  margin: "Маржа",
};

export function describeSettings(s: PrintSettings): string {
  return [
    VARIANT_LABELS[s.variant],
    ORIENTATION_LABELS[s.orientation].split(" ")[0],
    DENSITY_LABELS[s.density],
    LAYOUT_LABELS[s.layout],
  ].join(" · ");
}

// ── Формат чисел/дат ──
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
export function fmtMoney(n: number, currency = true, maxFrac = 2): string {
  const v = round2(n || 0);
  const text = v.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
  return currency ? `${text}\u00A0₽` : text;
}
/** Суммы в развёрнутом отчёте — целыми рублями, чтобы таблицы не рябили копейками. */
export function fmtSum(n: number, currency = true): string {
  return fmtMoney(n, currency, 0);
}
export function fmtNum(n: number, maxFrac = 3): string {
  return round2(n || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
}
export function fmtShort(n: number): string {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${round2(n / 1_000_000)}\u00A0млн`;
  if (v >= 10_000) return `${Math.round(n / 1000)}\u00A0тыс`;
  return fmtNum(n, 0);
}
export function fmtDate(iso: string): string {
  if (!iso) return "—";
  const parts = iso.split("-");
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return iso;
}

// ── Акцентный цвет оформления ──
export interface AccentTheme {
  main: string;
  pale: string;
  border: string;
  ink: string;
}

/** Палитры акцентов: main — заливки/графики, pale/border — плашки, ink — текст. */
export const ACCENT_THEMES: Record<Exclude<PrintAccent, "auto">, AccentTheme> = {
  blue: { main: "#2563eb", pale: "#eff6ff", border: "#bfdbfe", ink: "#1d4ed8" },
  violet: { main: "#7c3aed", pale: "#faf5ff", border: "#d8b4fe", ink: "#6d28d9" },
  green: { main: "#16a34a", pale: "#f0fdf4", border: "#86efac", ink: "#15803d" },
  cyan: { main: "#0891b2", pale: "#ecfeff", border: "#a5f3fc", ink: "#0e7490" },
  orange: { main: "#ea580c", pale: "#fff7ed", border: "#fed7aa", ink: "#c2410c" },
  rose: { main: "#db2777", pale: "#fdf2f8", border: "#fbcfe8", ink: "#be185d" },
  graphite: { main: "#334155", pale: "#f8fafc", border: "#cbd5e1", ink: "#1e293b" },
};

/** Фиолетовый — цвет «выгоды» по умолчанию (как было). */
const DEFAULT_ACCENT: AccentTheme = ACCENT_THEMES.violet;

/**
 * Итоговый акцент листа: выбранная палитра либо фиолетовый по умолчанию.
 * В чёрно-белой печати цвет не используется — возвращается null.
 */
export function resolveAccent(s: PrintSettings): AccentTheme | null {
  if (s.mono) return null;
  return s.accent === "auto" ? DEFAULT_ACCENT : ACCENT_THEMES[s.accent];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

/** Hex → rgba() — нужно для водяного знака и лёгких заливок. */
export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Смешивание двух hex-цветов (t=0 → a, t=1 → b). */
function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(m(ar, br))}${hex(m(ag, bg))}${hex(m(ab, bb))}`;
}

/** Рампа оттенков акцента для кольцевой диаграммы (8 цветов). */
export function accentRamp(main: string): string[] {
  return [
    main,
    mixHex(main, "#ffffff", 0.35),
    mixHex(main, "#000000", 0.25),
    mixHex(main, "#ffffff", 0.6),
    mixHex(main, "#000000", 0.45),
    mixHex(main, "#ffffff", 0.15),
    mixHex(main, "#94a3b8", 0.5),
    "#94a3b8",
  ];
}

// ── Строки печати: фильтр и сортировка ──
export interface ViewRow<P extends PrintPosRow = PrintPosRow> {
  pos: P;
  calc: PrintCalcRow;
  index: number;
}

/**
 * Строки в том виде, в каком они попадут в печать: с учётом скрытия
 * позиций без продаж и выбранной сортировки. Индекс исходной строки
 * сохраняется — для него работают ручные переопределения.
 */
export function viewRows<P extends PrintPosRow>(
  positions: P[],
  calcs: PrintCalcRow[],
  settings: PrintSettings
): ViewRow<P>[] {
  let items: ViewRow<P>[] = positions.map((pos, index) => ({
    pos,
    calc: calcs[index],
    index,
  }));
  if (settings.hideEmpty) {
    items = items.filter((it) => it.calc.qty !== 0 || it.calc.revenue !== 0);
  }
  switch (settings.sort) {
    case "benefitDesc":
      items = [...items].sort((a, b) => b.calc.benefit - a.calc.benefit);
      break;
    case "profitDesc":
      items = [...items].sort((a, b) => b.calc.ourProfit - a.calc.ourProfit);
      break;
    case "revenueDesc":
      items = [...items].sort((a, b) => b.calc.revenue - a.calc.revenue);
      break;
    case "qtyDesc":
      items = [...items].sort((a, b) => b.calc.qty - a.calc.qty);
      break;
    case "nameAsc":
      items = [...items].sort((a, b) =>
        (a.pos.name || "").localeCompare(b.pos.name || "", "ru")
      );
      break;
    default:
      break;
  }
  return items;
}

// ── ABC-анализ по выгоде производства ──
export interface AbcRow {
  cls: "A" | "B" | "C";
  hint: string;
  count: number;
  qty: number;
  revenue: number;
  benefit: number;
  /** Доля класса в суммарной выгоде, %. */
  shareBenefit: number;
}

/**
 * Делит позиции на классы A/B/C по накопленной доле выгоды:
 * A — позиции, формирующие первые 80% выгоды, B — до 95%,
 * C — остальные (включая убыточные).
 */
export function abcBreakdown(
  positions: PrintPosRow[],
  calcs: PrintCalcRow[]
): AbcRow[] {
  const items = positions.map((pos, i) => ({ pos, calc: calcs[i] }));
  const positive = items
    .filter((it) => it.calc.benefit > 0)
    .sort((a, b) => b.calc.benefit - a.calc.benefit);
  const rest = items.filter((it) => it.calc.benefit <= 0);
  const totalBenefit = positive.reduce((a, it) => a + it.calc.benefit, 0) || 1;

  const buckets: Record<"A" | "B" | "C", { pos: PrintPosRow; calc: PrintCalcRow }[]> = {
    A: [],
    B: [],
    C: [...rest],
  };
  let acc = 0;
  for (const it of positive) {
    // Границу класса считаем по накопленной доле ДО этой позиции: она
    // попадает в класс, который «заполняет» — например, единственный
    // лидер на 87% выгоды остаётся классом A, а не «важным».
    const before = (acc / totalBenefit) * 100;
    acc += it.calc.benefit;
    if (before < 80) buckets.A.push(it);
    else if (before < 95) buckets.B.push(it);
    else buckets.C.push(it);
  }

  const hints: Record<"A" | "B" | "C", string> = {
    A: "основные — до 80% выгоды",
    B: "важные — до 95% выгоды",
    C: "прочие (в т.ч. убыточные)",
  };
  const benefitSum =
    items.reduce((a, it) => a + Math.max(0, it.calc.benefit), 0) || 1;
  return (["A", "B", "C"] as const).map((cls) => {
    const rows = buckets[cls];
    const benefit = rows.reduce((a, it) => a + it.calc.benefit, 0);
    return {
      cls,
      hint: hints[cls],
      count: rows.length,
      qty: rows.reduce((a, it) => a + it.calc.qty, 0),
      revenue: rows.reduce((a, it) => a + it.calc.revenue, 0),
      benefit,
      shareBenefit: (Math.max(0, benefit) / benefitSum) * 100,
    };
  });
}

// ── Размеры бумаги ──
const MM_PX = 96 / 25.4;
/** Запас по ширине листа (мм), чтобы таблица гарантированно влезла в печать. */
export const SHEET_SLACK_MM = 5;
export const SHEET_FONT = 'Arial, "Segoe UI", Helvetica, sans-serif';

export const PAPER: Record<
  PrintOrientation,
  { w: number; h: number; contentMm: number }
> = {
  // contentMm — полезная ширина листа минус поля печати (@page 8мм 6мм)
  // с запасом 2 мм, чтобы таблица гарантированно влезала.
  portrait: { w: 210, h: 297, contentMm: 210 - 12 - SHEET_SLACK_MM },
  landscape: { w: 297, h: 210, contentMm: 297 - 12 - SHEET_SLACK_MM },
};

export const DENSITY_STYLE: Record<
  PrintDensity,
  { base: number; header: number; padY: number; padX: number; line: number }
> = {
  comfort: { base: 10, header: 9.2, padY: 6, padX: 5, line: 1.4 },
  normal: { base: 9, header: 8.5, padY: 4, padX: 4, line: 1.3 },
  compact: { base: 8.2, header: 7.9, padY: 3, padX: 3, line: 1.22 },
  ultra: { base: 7.4, header: 7.1, padY: 2, padX: 2.4, line: 1.15 },
};

// ── Замер текста (canvas), чтобы колонки были ровно по содержимому ──
let measureCtx: CanvasRenderingContext2D | null | undefined;
const measureCache = new Map<string, number>();

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  try {
    if (typeof document === "undefined") {
      measureCtx = null;
    } else {
      measureCtx = document.createElement("canvas").getContext("2d");
    }
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

function estimateWidth(text: string, fontPx: number): number {
  // Грубая оценка на случай отсутствия canvas (SSR / старые браузеры).
  let w = 0;
  for (const ch of text) {
    if (ch === " " || ch === "\u00A0") w += 0.28;
    else if (/[0-9]/.test(ch)) w += 0.556;
    else if (/[.,:%]/.test(ch)) w += 0.3;
    else if (ch === "₽") w += 0.55;
    else if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) w += 0.66;
    else w += 0.53;
  }
  return w * fontPx;
}

function textWidth(text: string, fontPx: number, weight: number): number {
  if (!text) return 0;
  const key = `${weight}|${fontPx}|${text}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) return cached;
  let w: number;
  const ctx = getMeasureCtx();
  if (ctx) {
    ctx.font = `${weight} ${fontPx}px ${SHEET_FONT}`;
    w = ctx.measureText(text).width;
  } else {
    w = estimateWidth(text, fontPx);
  }
  if (measureCache.size > 6000) measureCache.clear();
  measureCache.set(key, w);
  return w;
}

/**
 * Ширина текста в пикселях — нужна и печатному листу, и редактору:
 * по этим замерам подбираются ширины колонок, чтобы ничего не вылезало.
 */
export function measureText(text: string, fontPx: number, weight = 400): number {
  return textWidth(text || "", fontPx, weight);
}

// ── Колонки печатной таблицы ──
export type ColKey =
  | "index"
  | "name"
  | "qty"
  | "salePrice"
  | "revenue"
  | "ourUnit"
  | "ourSum"
  | "compUnit"
  | "compSum"
  | "ourProfit"
  | "compProfit"
  | "benefit"
  | "margin";

interface ColDef {
  key: ColKey;
  lines: string[];
  align: "num" | "text";
  cls: string;
  minMm: number;
  /** Жирный текст — замер делаем с большим весом шрифта. */
  bold?: boolean;
  value?: (row: PrintPosRow, calc: PrintCalcRow, index: number) => string;
  total?: ((calc: PrintCalcRow) => string) | null;
}

function money(currency: boolean) {
  return (n: number) => fmtMoney(n, currency);
}
/** Суммы (не цены за штуку): по настройке — целыми рублями. */
function sumMoney(s: PrintSettings) {
  return (n: number) => fmtMoney(n, s.currency, s.wholeRubles ? 0 : 2);
}

function colDefs(s: PrintSettings): ColDef[] {
  const m = money(s.currency);
  const ms = sumMoney(s);
  const cols: ColDef[] = [
    {
      key: "index",
      lines: ["№"],
      align: "num",
      cls: "pr-col-idx",
      minMm: 7,
      bold: true,
      value: (_row, _calc, i) => String(i + 1),
      total: null,
    },
    {
      key: "name",
      lines: ["Товар"],
      align: "text",
      cls: "pr-col-name",
      minMm: 40,
      value: (row) => row.name,
      total: null,
    },
  ];
  if (s.columns.qty)
    cols.push({
      key: "qty",
      lines: ["Кол-во,", "шт"],
      align: "num",
      cls: "",
      minMm: 11,
      value: (_r, c) => fmtNum(c.qty),
      total: (c) => fmtNum(c.qty),
    });
  if (s.columns.salePrice)
    cols.push({
      key: "salePrice",
      lines: ["Цена", "прод."],
      align: "num",
      cls: "",
      minMm: 13,
      value: (row) => m(row.salePrice),
      total: null,
    });
  if (s.columns.revenue)
    cols.push({
      key: "revenue",
      lines: ["Выручка"],
      align: "num",
      cls: "",
      minMm: 15,
      value: (_r, c) => ms(c.revenue),
      total: (c) => ms(c.revenue),
    });
  if (s.columns.ourUnit)
    cols.push({
      key: "ourUnit",
      lines: ["Мы: с/с", "1 шт"],
      align: "num",
      cls: "pr-cell-us",
      minMm: 13,
      value: (row) => m(row.productionCost),
      total: null,
    });
  if (s.columns.ourSum)
    cols.push({
      key: "ourSum",
      lines: ["Мы:", "сумма"],
      align: "num",
      cls: "pr-cell-us",
      minMm: 14,
      value: (_r, c) => ms(c.ourCost),
      total: (c) => ms(c.ourCost),
    });
  if (s.columns.compUnit)
    cols.push({
      key: "compUnit",
      lines: ["Конкур.", "1 шт"],
      align: "num",
      cls: "pr-cell-comp",
      minMm: 13,
      value: (row) => m(row.competitorPrice),
      total: null,
    });
  if (s.columns.compSum)
    cols.push({
      key: "compSum",
      lines: ["Конкур.:", "сумма"],
      align: "num",
      cls: "pr-cell-comp",
      minMm: 14,
      value: (_r, c) => ms(c.competitorCost),
      total: (c) => ms(c.competitorCost),
    });
  if (s.columns.ourProfit)
    cols.push({
      key: "ourProfit",
      lines: ["Прибыль", "(наша)"],
      align: "num",
      cls: "pr-cell-profit",
      minMm: 14,
      bold: true,
      value: (_r, c) => ms(c.ourProfit),
      total: (c) => ms(c.ourProfit),
    });
  if (s.columns.compProfit)
    cols.push({
      key: "compProfit",
      lines: ["Прибыль", "конкур."],
      align: "num",
      cls: "pr-cell-comp",
      minMm: 14,
      value: (_r, c) => ms(c.competitorProfit),
      total: (c) => ms(c.competitorProfit),
    });
  if (s.columns.benefit)
    cols.push({
      key: "benefit",
      lines: ["Выгода", "произв."],
      align: "num",
      cls: "pr-cell-benefit",
      minMm: 14,
      bold: true,
      value: (_r, c) => ms(c.benefit),
      total: (c) => ms(c.benefit),
    });
  if (s.columns.margin)
    cols.push({
      key: "margin",
      lines: ["Маржа"],
      align: "num",
      cls: "",
      minMm: 10,
      value: (_r, c) => `${c.margin}%`,
      total: (c) => `${c.margin}%`,
    });
  return cols;
}

export interface PlanCol extends ColDef {
  /** Ширина в мм; null — колонка забирает остаток (название товара). */
  widthMm: number | null;
}

export interface SheetPlan {
  cols: PlanCol[];
  scale: number;
}

/**
 * Считает ширину каждой колонки по фактическому содержимому
 * (заголовки + значения + строка «ИТОГО») и масштаб шрифта так,
 * чтобы таблица целиком уложилась в лист выбранной ориентации.
 */
export function planSheet(
  rows: PrintPosRow[],
  calcs: PrintCalcRow[],
  totals: PrintCalcRow,
  settings: PrintSettings,
  measured = true
): SheetPlan {
  // На сервере (и в первом рендере) canvas недоступен — ширины считаем
  // грубой оценкой по символам, после монтирования PrintSheet передаёт
  // measured=true и план пересчитывается по фактическим метрикам шрифта.
  const widthOf = (text: string, fontPx: number, weight = 400) =>
    measured ? textWidth(text, fontPx, weight) : estimateWidth(text, fontPx);

  const dens = DENSITY_STYLE[settings.density];
  const cols = colDefs(settings);
  const availablePx = PAPER[settings.orientation].contentMm * MM_PX;
  const nameCol = cols.find((c) => c.key === "name");

  const contentPx = new Map<ColKey, number>();
  let numericSumPx = 0;
  let bordersPx = 0;

  for (const col of cols) {
    if (col.key === "name") continue;
    let w = 0;
    const headerWeight = 700;
    for (const line of col.lines) {
      w = Math.max(w, widthOf(line, dens.header, headerWeight));
    }
    if (col.value) {
      rows.forEach((row, i) => {
        const v = col.value!(row, calcs[i], i);
        w = Math.max(w, widthOf(v, dens.base, col.bold ? 700 : 400));
      });
      // Номер строки может быть шире значения «1».
      if (col.key === "index") {
        w = Math.max(w, widthOf(String(rows.length || 1), dens.base, 600));
      }
      if (col.total) {
        w = Math.max(w, widthOf(col.total(totals), dens.base, 800));
        w = Math.max(w, widthOf("ИТОГО", dens.base, 800) * 0.7);
      }
    }
    const minPx = col.minMm * MM_PX;
    w = Math.max(w, minPx * 0.62);
    contentPx.set(col.key, w);
    numericSumPx += w + dens.padX * 2;
    bordersPx += 1.2;
  }

  let scale = 1;
  if (settings.scaleMode === "manual") {
    scale = Math.min(1.4, Math.max(0.5, settings.scale || 1));
  } else if (numericSumPx > 0) {
    const nameIdealPx =
      (settings.orientation === "landscape" ? 70 : 45) * MM_PX;
    const nameFloorPx =
      (settings.orientation === "landscape" ? 42 : 26) * MM_PX;
    const free = availablePx - nameIdealPx - bordersPx;
    scale = Math.min(1, Math.max(0.5, free / numericSumPx));
    // Если даже при 100% название влезает с запасом — ничего не уменьшаем.
    if (availablePx - (numericSumPx * scale + bordersPx) < nameFloorPx) {
      scale = Math.max(
        0.45,
        (availablePx - nameFloorPx - bordersPx) / numericSumPx
      );
    }
    scale = Math.round(scale * 100) / 100;
  }

  const planCols: PlanCol[] = cols.map((col) => {
    if (col.key === "name") {
      return { ...col, widthMm: nameCol ? null : null };
    }
    const w = (contentPx.get(col.key) ?? col.minMm * MM_PX) * scale;
    const withPadding = w + dens.padX * 2 * scale + 1.2;
    const mm = Math.ceil((withPadding / MM_PX) * 100) / 100;
    return { ...col, widthMm: Math.max(mm, col.minMm) };
  });

  return { cols: planCols, scale };
}

// ── Данные для диаграмм ──
export function metricValue(c: PrintCalcRow, m: PrintChartMetric): number {
  switch (m) {
    case "benefit":
      return c.benefit;
    case "profit":
      return c.ourProfit;
    case "revenue":
      return c.revenue;
    case "qty":
      return c.qty;
    default:
      return c.benefit;
  }
}

const METRIC_COLOR: Record<PrintChartMetric, string> = {
  benefit: "#7c3aed",
  profit: "#15803d",
  revenue: "#2563eb",
  qty: "#0891b2",
};

const METRIC_COLOR_MONO: Record<PrintChartMetric, string> = {
  benefit: "#111111",
  profit: "#333333",
  revenue: "#4d4d4d",
  qty: "#666666",
};

const PIE_COLORS_MONO = [
  "#111111",
  "#3d3d3d",
  "#666666",
  "#8c8c8c",
  "#adadad",
  "#c9c9c9",
  "#dedede",
  "#ededed",
];

const PIE_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#16a34a",
  "#d97706",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#475569",
];

export interface ChartPoint {
  id: string;
  label: string;
  value: number;
}

export function chartPoints(
  rows: PrintPosRow[],
  calcs: PrintCalcRow[],
  settings: PrintSettings
): ChartPoint[] {
  const points = rows.map((row, i) => ({
    id: row.id,
    label: row.name || "—",
    value: metricValue(calcs[i], settings.chartMetric),
  }));
  points.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return settings.chartTop > 0 ? points.slice(0, settings.chartTop) : points;
}

export interface TimelinePoint {
  key: string;
  label: string;
  value: number;
}

/** Продажи по датам (для графика «по дням»); прибыль/выгода делятся пропорционально выручке продажи. */
export function timelinePoints(
  rows: PrintPosRow[],
  calcs: PrintCalcRow[],
  settings: PrintSettings
): TimelinePoint[] {
  const byDate = new Map<string, number>();
  rows.forEach((row, i) => {
    const c = calcs[i];
    const revenue = row.sales.reduce((a, s) => a + s.qty * s.price, 0);
    const metric = metricValue(c, settings.chartMetric);
    row.sales.forEach((s) => {
      const line = s.qty * s.price;
      const share =
        revenue > 0 ? line / revenue : row.sales.length ? 1 / row.sales.length : 0;
      byDate.set(s.date, (byDate.get(s.date) || 0) + metric * share);
    });
  });
  const dates = [...byDate.keys()].filter(Boolean).sort();
  if (dates.length === 0) return [];

  const points: TimelinePoint[] = [];
  if (dates.length <= 16) {
    for (const d of dates) points.push({ key: d, label: fmtDate(d).slice(0, 5), value: byDate.get(d) || 0 });
  } else {
    // Много дат — сворачиваем в недели, чтобы график остался читаемым.
    const weeks = new Map<string, { label: string; value: number }>();
    for (const d of dates) {
      const dt = new Date(`${d}T00:00:00`);
      const day = (dt.getDay() + 6) % 7;
      const monday = new Date(dt);
      monday.setDate(dt.getDate() - day);
      const key = monday.toISOString().slice(0, 10);
      const item = weeks.get(key) || {
        label: fmtDate(key).slice(0, 5),
        value: 0,
      };
      item.value += byDate.get(d) || 0;
      weeks.set(key, item);
    }
    for (const [key, item] of [...weeks.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      points.push({ key, label: item.label, value: item.value });
    }
  }
  return points.slice(-16);
}

function fmtMetric(value: number, metric: PrintChartMetric, currency: boolean): string {
  return metric === "qty" ? fmtNum(value) : fmtMoney(value, currency);
}

// ── Лист ──
export function PrintSheet({
  meta,
  positions,
  calcs,
  totals,
  settings,
}: {
  meta: PrintMeta;
  positions: PrintPosRow[];
  calcs: PrintCalcRow[];
  totals: PrintCalcRow;
  settings: PrintSettings;
}) {
  // Замеры текста доступны только в браузере: до монтирования используем
  // оценки, после — точные ширины (поэтому второй проход рендера).
  const [measured, setMeasured] = useState(false);
  useEffect(() => setMeasured(true), []);

  // Строки с учётом сортировки и скрытия позиций без продаж.
  const view = useMemo(
    () => viewRows(positions, calcs, settings),
    [positions, calcs, settings]
  );
  const viewPos = useMemo(() => view.map((v) => v.pos), [view]);
  const viewCalcs = useMemo(() => view.map((v) => v.calc), [view]);

  const plan = useMemo(
    () => planSheet(viewPos, viewCalcs, totals, settings, measured),
    // measured — чтобы после монтирования (когда canvas уже доступен)
    // план ширин пересчитался по реальным замерам текста.
    [viewPos, viewCalcs, totals, settings, measured]
  );

  const periodText =
    meta.periodFrom || meta.periodTo
      ? `${meta.periodFrom ? fmtDate(meta.periodFrom) : "…"} — ${
          meta.periodTo ? fmtDate(meta.periodTo) : "…"
        }`
      : "весь период";
  const today = new Date();
  const genDate = `${String(today.getDate()).padStart(2, "0")}.${String(
    today.getMonth() + 1
  ).padStart(2, "0")}.${today.getFullYear()}`;

  const sheetCls = [
    "pr-sheet",
    `pr-density--${settings.density}`,
    `pr-layout--${settings.layout}`,
    settings.alignNumbers === "center" ? "pr-align-num--center" : "",
    settings.alignName === "center" ? "pr-align-name--center" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const points = chartPoints(viewPos, viewCalcs, settings);
  const timeline = timelinePoints(viewPos, viewCalcs, settings);
  const accent = resolveAccent(settings);
  const chartAccent = accent ? accent.main : null;
  const abc = settings.showAbc ? abcBreakdown(viewPos, viewCalcs) : null;
  const chartCount = [settings.chartBars, settings.chartDonut, settings.chartTimeline].filter(Boolean).length;
  const watermark = settings.watermark.trim();

  return (
    <div
      className={sheetCls}
      style={{ "--pr-fit": String(plan.scale) } as CSSProperties}
    >
      {watermark ? <Watermark text={watermark} /> : null}

      {settings.showHeader && (
        <div className="pr-sheet__head">
          <div>
            <div className="pr-sheet__company">
              {meta.company || "ООО «СибГофроТорг»"}
            </div>
            <h2 className="pr-sheet__title">
              {meta.title || "План по выгоде продаж"}
            </h2>
          </div>
          <div className="pr-sheet__period">
            {settings.showPeriod && (
              <div>
                <span className="pr-sheet__plabel">Период:</span> {periodText}
              </div>
            )}
            {settings.showGenDate && (
              <div>
                <span className="pr-sheet__plabel">Сформирован:</span> {genDate}
              </div>
            )}
          </div>
        </div>
      )}

      {meta.note ? <p className="pr-sheet__note">{meta.note}</p> : null}

      {settings.showCards && (
        <div className="pr-sheet-summary">
          <SheetCard label="Выручка за период" value={fmtMoney(totals.revenue, settings.currency)} />
          <SheetCard
            label="Прибыль с нашего производства"
            value={fmtMoney(totals.ourProfit, settings.currency)}
            tone="profit"
          />
          <SheetCard
            label="Прибыль при закупке у конкурента"
            value={fmtMoney(totals.competitorProfit, settings.currency)}
          />
          <SheetCard
            label="Выгода собственного производства"
            value={fmtMoney(totals.benefit, settings.currency)}
            tone="benefit"
          />
        </div>
      )}

      {settings.showPositions && (
        <table className="pr-sheet-table">
          <colgroup>
            {plan.cols.map((c) => (
              <col
                key={c.key}
                style={c.widthMm ? { width: `${c.widthMm}mm` } : undefined}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {plan.cols.map((c) => (
                <th key={c.key} className={c.cls}>
                  {c.lines.map((line, i) => (
                    <Fragment key={line}>
                      {i > 0 ? <br /> : null}
                      {line}
                    </Fragment>
                  ))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map(({ pos: row, calc: c }, di) => {
              return (
                <Fragment key={row.id}>
                  <tr className="pr-sheet-pos">
                    {plan.cols.map((col) => (
                      <SheetCell
                        key={col.key}
                        col={col}
                        row={row}
                        calc={c}
                        index={di}
                        settings={settings}
                      />
                    ))}
                  </tr>
                  {settings.showDetails && row.sales.length > 0 && (
                    <tr className="pr-sheet-detail">
                      <td colSpan={plan.cols.length}>
                        <div className="pr-sheet-detail__wrap">
                          <span className="pr-sheet-detail__title">Продажи:</span>
                          <div className="pr-sheet-detail__list">
                            {row.sales.map((s) => (
                              <div key={s.id} className="pr-sheet-detail__item">
                                <span className="pr-sd-date">{fmtDate(s.date)}</span>
                                <span className="pr-sd-cust">
                                  {s.customer || "—"}
                                </span>
                                <span className="pr-sd-qty">
                                  {fmtNum(s.qty)}&nbsp;{row.unit || "шт"}
                                </span>
                                <span className="pr-sd-price">
                                  ×&nbsp;{fmtMoney(s.price, settings.currency)}
                                </span>
                                <span className="pr-sd-sum">
                                  =&nbsp;
                                  {fmtMoney(s.qty * s.price, settings.currency)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {settings.showTotals && (
            <tfoot>
              <tr className="pr-sheet-total">
                {plan.cols.map((col) => (
                  <td key={col.key} className={`pr-cell-num ${col.cls}`}>
                    {col.key === "name"
                      ? "ИТОГО"
                      : col.total
                        ? col.total(totals)
                        : "—"}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      )}

      {chartCount > 0 && view.length > 0 && (
        <div
          className={`pr-charts pr-charts--${chartCount}`}
          style={
            chartCount > 1 && settings.orientation === "landscape"
              ? { gridTemplateColumns: "1.25fr 1fr" }
              : undefined
          }
        >
          {settings.chartBars && (
            <BarsChart
              points={points}
              metric={settings.chartMetric}
              currency={settings.currency}
              mono={settings.mono}
              accent={chartAccent}
            />
          )}
          {settings.chartDonut && (
            <DonutChart
              points={points}
              metric={settings.chartMetric}
              currency={settings.currency}
              mono={settings.mono}
              accent={chartAccent}
            />
          )}
          {settings.chartTimeline && timeline.length > 0 && (
            <TimelineChart
              points={timeline}
              metric={settings.chartMetric}
              currency={settings.currency}
              mono={settings.mono}
              accent={chartAccent}
            />
          )}
        </div>
      )}

      {abc && (
        <AbcBlock rows={abc} currency={settings.currency} whole={settings.wholeRubles} />
      )}

      {(settings.showSignature || settings.showFooter) && (
        <div className="pr-sheet__foot">
          {settings.showSignature ? (
            <div className="pr-sign">
              <span className="pr-sign__line" />
              <span className="pr-sign__cap">
                {meta.signer ? meta.signer : "подпись / ФИО"}
              </span>
            </div>
          ) : (
            <span />
          )}
          {settings.showFooter ? (
            <div className="pr-sheet__foot-note">
              {settings.footerText.trim() ||
                `Расчёт сформирован автоматически · ${
                  meta.company || "СибГофроТорг"
                }`}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SheetCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "benefit";
}) {
  return (
    <div className={`pr-sum-card${tone ? ` pr-sum-card--${tone}` : ""}`}>
      <div className="pr-sum-card__label">{label}</div>
      <div className="pr-sum-card__value">{value}</div>
    </div>
  );
}

/** Водяной знак (гриф) поверх листа — печатается полупрозрачно под углом. */
export function Watermark({ text }: { text: string }) {
  return (
    <div className="pr-watermark" aria-hidden="true">
      <span>{text}</span>
    </div>
  );
}

/** Компактный блок ABC-анализа по выгоде производства. */
function AbcBlock({
  rows,
  currency,
  whole,
}: {
  rows: AbcRow[];
  currency: boolean;
  whole: boolean;
}) {
  const m = (n: number) => fmtMoney(n, currency, whole ? 0 : 2);
  return (
    <div className="pr-abc">
      <div className="pr-abc__title">
        ABC-анализ по выгоде производства · класс A — до 80% выгоды, B — до 95%,
        C — остальные
      </div>
      <table className="pr-abc__table">
        <thead>
          <tr>
            <th>Класс</th>
            <th>Характеристика</th>
            <th>Позиций</th>
            <th>Кол-во, шт</th>
            <th>Выручка</th>
            <th>Выгода</th>
            <th>Доля выгоды</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cls}>
              <td className={`pr-abc__cls pr-abc__cls--${r.cls.toLowerCase()}`}>
                {r.cls}
              </td>
              <td className="pr-abc__hint">{r.hint}</td>
              <td className="pr-cell-num">{r.count}</td>
              <td className="pr-cell-num">{fmtNum(r.qty)}</td>
              <td className="pr-cell-num">{m(r.revenue)}</td>
              <td className="pr-cell-num">{m(r.benefit)}</td>
              <td className="pr-cell-num">{r.shareBenefit.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SheetCell({
  col,
  row,
  calc,
  index,
  settings,
}: {
  col: PlanCol;
  row: PrintPosRow;
  calc: PrintCalcRow;
  index: number;
  settings: PrintSettings;
}) {
  if (col.key === "name") {
    return (
      <td className="pr-col-name pr-cell-text">
        <div className="pr-sheet-prod-name">{row.name || "—"}</div>
        {settings.showSku && row.sku ? (
          <div className="pr-sheet-sku">{row.sku}</div>
        ) : null}
      </td>
    );
  }
  if (col.key === "ourProfit") {
    return (
      <td
        className={`pr-cell-num ${col.cls} ${calc.ourProfit >= 0 ? "pr-pos" : "pr-neg"}`}
      >
        {fmtMoney(calc.ourProfit, settings.currency, settings.wholeRubles ? 0 : 2)}
      </td>
    );
  }
  if (col.key === "benefit") {
    return (
      <td
        className={`pr-cell-num ${col.cls} ${calc.benefit >= 0 ? "pr-ben" : "pr-neg"}`}
      >
        {fmtMoney(calc.benefit, settings.currency, settings.wholeRubles ? 0 : 2)}
      </td>
    );
  }
  return (
    <td className={`pr-cell-num ${col.cls}`}>
      {col.value ? col.value(row, calc, index) : "—"}
    </td>
  );
}

// ── Диаграммы ──
function BarsChart({
  points,
  metric,
  currency,
  mono,
  accent,
}: {
  points: ChartPoint[];
  metric: PrintChartMetric;
  currency: boolean;
  mono: boolean;
  accent: string | null;
}) {
  const max = points.reduce((a, p) => Math.max(a, Math.abs(p.value)), 0);
  const color = mono
    ? METRIC_COLOR_MONO[metric]
    : (accent ?? METRIC_COLOR[metric]);
  return (
    <div className="pr-chart">
      <div className="pr-chart__title">
        {METRIC_LABELS[metric]} по позициям
      </div>
      <div className="pr-chart__bars">
        {points.map((p) => (
          <div className="pr-bar" key={p.id}>
            <div className="pr-bar__label" title={p.label}>
              {p.label}
            </div>
            <div className="pr-bar__track">
              <span
                className={`pr-bar__fill${p.value < 0 ? " pr-bar__fill--neg" : ""}`}
                style={{
                  width: `${max > 0 ? Math.max(2, (Math.abs(p.value) / max) * 100) : 0}%`,
                  background: p.value < 0 && !mono ? "#dc2626" : color,
                }}
              />
            </div>
            <div className="pr-bar__value">
              {fmtMetric(p.value, metric, currency)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DonutChart({
  points,
  metric,
  currency,
  mono,
  accent,
}: {
  points: ChartPoint[];
  metric: PrintChartMetric;
  currency: boolean;
  mono: boolean;
  accent: string | null;
}) {
  const palette = mono
    ? PIE_COLORS_MONO
    : accent
      ? accentRamp(accent)
      : PIE_COLORS;
  const slices = useMemo(() => {
    const positive = points.filter((p) => p.value > 0);
    const total = positive.reduce((a, p) => a + p.value, 0);
    type Slice = { id: string; label: string; pct: number; value: number; color: string; offset: number };
    if (total <= 0) return { total: 0, items: [] as Slice[] };
    const max = 7;
    const head = positive.slice(0, max);
    const tail = positive.slice(max);
    const raw: Omit<Slice, "offset">[] = head.map((p, i) => ({
      id: p.id,
      label: p.label,
      value: p.value,
      pct: (p.value / total) * 100,
      color: palette[i % palette.length],
    }));
    if (tail.length > 0) {
      const restValue = tail.reduce((a, p) => a + p.value, 0);
      raw.push({
        id: "__rest",
        label: `Прочие (${tail.length})`,
        value: restValue,
        pct: (restValue / total) * 100,
        color: mono ? "#f5f5f5" : "#94a3b8",
      });
    }
    // Смещение каждого сегмента считаем заранее — в рендере не мутируем.
    let acc = 0;
    const items = raw.map((item) => {
      const offset = acc;
      acc += item.pct;
      return { ...item, offset };
    });
    return { total, items };
  }, [points, palette, mono]);

  if (slices.total <= 0) {
    return (
      <div className="pr-chart">
        <div className="pr-chart__title">Структура: {METRIC_LABELS[metric]}</div>
        <p className="pr-chart__empty">Нет положительных значений для диаграммы.</p>
      </div>
    );
  }

  return (
    <div className="pr-chart">
      <div className="pr-chart__title">Структура: {METRIC_LABELS[metric]}</div>
      <div className="pr-donut-wrap">
        <div className="pr-donut-box">
          <svg viewBox="0 0 42 42" className="pr-donut" role="img">
            <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#eef2f7" strokeWidth="6" />
            <g transform="rotate(-90 21 21)">
              {slices.items.map((s) => (
                <circle
                  key={s.id}
                  cx="21"
                  cy="21"
                  r="15.9155"
                  fill="none"
                  stroke={s.color}
                  strokeWidth="6"
                  strokeDasharray={`${s.pct} ${100 - s.pct}`}
                  strokeDashoffset={-s.offset}
                />
              ))}
            </g>
            <text
              x="21"
              y="20.6"
              textAnchor="middle"
              fontSize="4.6"
              fontWeight="700"
              fill="#0f172a"
            >
              {fmtShort(slices.total)}
            </text>
            <text
              x="21"
              y="25"
              textAnchor="middle"
              fontSize="2.6"
              fill="#64748b"
            >
              {metric === "qty" ? "шт" : currency ? "₽" : "всего"}
            </text>
          </svg>
        </div>
        <div className="pr-legend">
          {slices.items.map((s) => (
            <div className="pr-legend__item" key={s.id}>
              <span className="pr-legend__dot" style={{ background: s.color }} />
              <span className="pr-legend__name" title={s.label}>
                {s.label}
              </span>
              <span className="pr-legend__val">{s.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimelineChart({
  points,
  metric,
  currency,
  mono,
  accent,
}: {
  points: TimelinePoint[];
  metric: PrintChartMetric;
  currency: boolean;
  mono: boolean;
  accent: string | null;
}) {
  const max = points.reduce((a, p) => Math.max(a, p.value), 0);
  const color = mono
    ? METRIC_COLOR_MONO[metric]
    : (accent ?? METRIC_COLOR[metric]);
  const showValues = points.length <= 9;
  return (
    <div className="pr-chart">
      <div className="pr-chart__title">
        {METRIC_LABELS[metric]} по дням продаж
      </div>
      <div className="pr-timeline">
        {points.map((p) => (
          <div className="pr-tl" key={p.key}>
            {showValues && (
              <div className="pr-tl__val" title={fmtMetric(p.value, metric, currency)}>
                {fmtShort(p.value)}
              </div>
            )}
            <div className="pr-tl__col">
              <span
                className="pr-tl__bar"
                style={{
                  height: `${max > 0 ? Math.max(3, (p.value / max) * 100) : 0}%`,
                  background: color,
                }}
                title={fmtMetric(p.value, metric, currency)}
              />
            </div>
            <div className="pr-tl__lab">{p.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Стили листа, превью и печати ──
export function buildReportCss(s: PrintSettings): string {
  const dens = DENSITY_STYLE[s.density];
  const paper = PAPER[s.orientation];
  const accent = resolveAccent(s);
  // Базовый акцент (выгода): выбранный цвет либо фиолетовый по умолчанию,
  // в ч/б — серый, чтобы лист реально печатался без цвета.
  const ben = accent ??
    (s.mono
      ? { main: "#111111", pale: "#f4f4f4", border: "#9a9a9a", ink: "#111111" }
      : DEFAULT_ACCENT);
  const theme = s.mono
    ? MONO_THEME
    : {
        ...LAYOUT_THEME[s.layout],
        accent: accent ? accent.main : LAYOUT_THEME[s.layout].accent,
      };
  const wmColor = s.mono
    ? "rgba(0,0,0,0.07)"
    : hexToRgba(accent ? accent.main : DEFAULT_ACCENT.main, 0.1);
  return `
/* ── Превью листа A4 (${paper.w} × ${paper.h} мм) ── */
.pr-print-wrap { overflow: visible !important; }
.pr-a4-stage { background: #e9edf3; padding: 24px 16px; border-radius: 10px; display: flex; justify-content: center; overflow: auto; }
.pr-a4-sheet { width: ${paper.w}mm; min-height: ${paper.h}mm; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,0.12); padding: 8mm 7mm; box-sizing: border-box; }

/* ── Лист ── */
.pr-sheet {
  --pr-fit: 1;
  --pr-border: ${theme.border};
  font-family: ${SHEET_FONT};
  color: #1e293b;
  font-size: calc(${dens.base}px * var(--pr-fit));
  line-height: ${dens.line};
  width: 100%;
  box-sizing: border-box;
  position: relative;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.pr-sheet * { box-sizing: border-box; }
.pr-sheet > *:not(.pr-watermark), .pr-doc-page > *:not(.pr-watermark), .prd-page > *:not(.pr-watermark) { position: relative; z-index: 1; }

/* Водяной знак (гриф) */
.pr-watermark {
  position: absolute; inset: 0; z-index: 0;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; pointer-events: none; user-select: none;
}
.pr-watermark span {
  transform: rotate(-27deg);
  font-family: ${SHEET_FONT};
  font-size: calc(56px * var(--pr-fit, 0.9));
  font-weight: 800;
  letter-spacing: 6px;
  text-transform: uppercase;
  white-space: nowrap;
  color: ${wmColor};
}

/* Шапка листа */
.pr-sheet__head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 6px; break-inside: avoid; }
.pr-sheet__company { font-size: calc(11px * var(--pr-fit)); font-weight: 700; letter-spacing: 0.4px; color: #475569; text-transform: uppercase; }
.pr-sheet__title { font-size: calc(17px * var(--pr-fit)); font-weight: 800; color: #0f172a; margin: 2px 0 0; line-height: 1.15; }
.pr-sheet__period { text-align: right; font-size: calc(10px * var(--pr-fit)); line-height: 1.45; white-space: nowrap; color: #334155; }
.pr-sheet__plabel { color: #64748b; }
.pr-sheet__note { font-size: calc(9.5px * var(--pr-fit)); font-style: italic; color: #475569; margin: 4px 0 6px; }

/* Плашки итогов */
.pr-sheet-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 0 0 8px; break-inside: avoid; }
.pr-layout--minimal .pr-sheet-summary,
.pr-layout--striped .pr-sheet-summary { grid-template-columns: repeat(4, 1fr); }
.pr-sum-card { border: 1px solid ${theme.cardBorder}; border-radius: 5px; padding: calc(5px * var(--pr-fit)) calc(7px * var(--pr-fit)); background: ${theme.cardBg}; overflow: hidden; }
.pr-sum-card__label { font-size: calc(8.5px * var(--pr-fit)); color: #64748b; margin-bottom: 2px; }
.pr-sum-card__value { font-size: calc(12.5px * var(--pr-fit)); font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pr-sum-card--profit { background: ${s.mono ? "#f4f4f4" : "#f0fdf4"}; border-color: ${s.mono ? "#9a9a9a" : "#86efac"}; }
.pr-sum-card--profit .pr-sum-card__value { color: ${s.mono ? "#111111" : "#15803d"}; }
.pr-sum-card--benefit { background: ${ben.pale}; border-color: ${ben.border}; }
.pr-sum-card--benefit .pr-sum-card__value { color: ${ben.ink}; }

/* Таблица */
.pr-sheet-table { width: 100% !important; table-layout: fixed !important; border-collapse: collapse !important; margin-top: 4px; }
.pr-sheet-table th, .pr-sheet-table td {
  border: 1px solid var(--pr-border) !important;
  padding: calc(${dens.padY}px * var(--pr-fit)) calc(${dens.padX}px * var(--pr-fit)) !important;
  vertical-align: middle !important;
  overflow: hidden !important;
  text-overflow: clip !important;
  word-break: normal !important;
  overflow-wrap: break-word !important;
}
.pr-sheet-table thead { display: table-header-group; }
.pr-sheet-table tfoot { display: table-footer-group; }
.pr-sheet-table tr { break-inside: avoid; page-break-inside: avoid; }
.pr-sheet-table thead th {
  background: ${theme.headBg} !important;
  color: ${theme.headColor} !important;
  font-weight: 700 !important;
  font-size: calc(${dens.header}px * var(--pr-fit)) !important;
  line-height: 1.15 !important;
  text-align: center !important;
  hyphens: none;
  border-color: ${theme.headBorder} !important;
}
.pr-sheet-table tbody td { background: #fff; }
.pr-sheet-table tbody tr:nth-child(even) td { background: ${theme.altBg}; }
.pr-sheet-table tfoot td { background: ${theme.totalBg} !important; font-weight: 800 !important; border-top: ${theme.totalTop} !important; }

/* Выравнивание: цифры и названия */
.pr-cell-num { text-align: ${s.alignNumbers === "center" ? "center" : "right"} !important; font-variant-numeric: tabular-nums !important; white-space: nowrap !important; }
.pr-sheet .pr-align-num--center .pr-cell-num { text-align: center !important; }
.pr-cell-text { text-align: ${s.alignName === "center" ? "center" : "left"} !important; }
.pr-align-name--center .pr-cell-text { text-align: center !important; }
.pr-sheet-total .pr-col-name { text-align: left !important; }
.pr-sheet-prod-name { font-weight: 600; line-height: 1.22; overflow-wrap: break-word; }
.pr-sheet-sku { font-size: calc(7.6px * var(--pr-fit)); color: #64748b; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; margin-top: 1px; overflow-wrap: anywhere; }
.pr-col-idx { color: #64748b; }
.pr-cell-us { background: ${theme.usBg}; }
.pr-cell-comp { background: ${theme.compBg}; }
.pr-pos { color: ${s.mono ? "#111111" : "#15803d"}; font-weight: 700; }
.pr-ben { color: ${ben.ink}; font-weight: 700; }
.pr-neg { color: ${s.mono ? "#111111" : "#dc2626"}; font-weight: 700; }

/* Детализация продаж */
.pr-sheet-detail td { background: ${theme.detailBg} !important; padding: calc(3px * var(--pr-fit)) calc(6px * var(--pr-fit)) !important; border-left: 3px solid ${theme.accent} !important; }
.pr-sheet-detail__wrap { display: flex; flex-direction: column; gap: 2px; }
.pr-sheet-detail__title { font-weight: 700; color: #475569; font-size: calc(8.5px * var(--pr-fit)); }
.pr-sheet-detail__list { display: flex; flex-direction: column; gap: 2px; }
.pr-sheet-detail__item { display: flex; gap: 8px; align-items: baseline; font-size: calc(8.4px * var(--pr-fit)); color: #334155; flex-wrap: wrap; }
.pr-sd-date { color: #64748b; flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.pr-sd-cust { font-weight: 600; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-sd-qty, .pr-sd-price, .pr-sd-sum { font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.pr-sd-price { color: #64748b; }

/* ── Графики ── */
.pr-charts { display: grid; gap: 8px; grid-template-columns: 1fr; margin-top: 8px; }
.pr-chart { border: 1px solid ${theme.cardBorder}; border-radius: 5px; padding: calc(6px * var(--pr-fit)) calc(8px * var(--pr-fit)); background: #fff; break-inside: avoid; page-break-inside: avoid; min-width: 0; }
.pr-chart__title { font-size: calc(9.5px * var(--pr-fit)); font-weight: 800; color: #334155; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.2px; }
.pr-chart__empty { font-size: calc(9px * var(--pr-fit)); color: #94a3b8; margin: 0; }
.pr-chart__bars { display: flex; flex-direction: column; gap: calc(3px * var(--pr-fit)); }
.pr-bar { display: grid; grid-template-columns: minmax(0, 34%) 1fr minmax(0, 22%); gap: 6px; align-items: center; font-size: calc(8.6px * var(--pr-fit)); }
.pr-bar__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; font-weight: 600; }
.pr-bar__track { height: calc(7px * var(--pr-fit)); background: #eef2f7; border-radius: 4px; overflow: hidden; }
.pr-bar__fill { display: block; height: 100%; border-radius: 4px; min-width: 2px; }
.pr-bar__fill--neg { background: repeating-linear-gradient(45deg, #111 0 1.1px, #fff 1.1px 3px) !important; }
.pr-bar__value { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; }
.pr-donut-wrap { display: flex; gap: 10px; align-items: center; }
.pr-donut-box { flex: 0 0 34mm; max-width: 34mm; }
.pr-donut { width: 100%; height: auto; display: block; }
.pr-legend { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pr-legend__item { display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; gap: 5px; align-items: center; font-size: calc(8.4px * var(--pr-fit)); }
.pr-legend__dot { width: 7px; height: 7px; border-radius: 2px; }
.pr-legend__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; }
.pr-legend__val { font-variant-numeric: tabular-nums; font-weight: 700; color: #0f172a; }
.pr-timeline { display: flex; align-items: flex-end; gap: 3px; }
.pr-tl { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; }
.pr-tl__val { font-size: calc(7.4px * var(--pr-fit)); color: #64748b; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; max-width: 100%; }
.pr-tl__col { height: 22mm; width: 100%; display: flex; align-items: flex-end; justify-content: center; border-bottom: 1px solid #cbd5e1; }
.pr-tl__bar { display: block; width: 100%; border-radius: 2px 2px 0 0; }
.pr-tl__lab { font-size: calc(7px * var(--pr-fit)); color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-variant-numeric: tabular-nums; }

/* ABC-анализ по выгоде */
.pr-abc { border: 1px solid ${theme.cardBorder}; border-radius: 5px; padding: calc(6px * var(--pr-fit)) calc(8px * var(--pr-fit)); background: ${theme.cardBg}; margin-top: 8px; break-inside: avoid; page-break-inside: avoid; }
.pr-abc__title { font-size: calc(9px * var(--pr-fit)); font-weight: 800; color: #334155; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.2px; }
.pr-abc__table { width: 100%; border-collapse: collapse; font-size: calc(8.6px * var(--pr-fit)); }
.pr-abc__table th, .pr-abc__table td { border: 1px solid var(--pr-border); padding: calc(2.5px * var(--pr-fit)) calc(5px * var(--pr-fit)); }
.pr-abc__table thead th { background: ${theme.headBg}; color: ${theme.headColor}; font-weight: 700; text-align: center; font-size: calc(8px * var(--pr-fit)); }
.pr-abc__table tbody tr:nth-child(even) td { background: ${theme.altBg}; }
.pr-abc__cls { text-align: center; font-weight: 800; width: 9mm; }
.pr-abc__cls--a { color: ${ben.ink}; }
.pr-abc__cls--b { color: #b45309; }
.pr-abc__cls--c { color: #64748b; }
.pr-abc__hint { color: #475569; }

/* Подпись и сноска */
.pr-sheet__foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin-top: 12px; break-inside: avoid; page-break-inside: avoid; }
.pr-sign { display: flex; flex-direction: column; gap: 2px; min-width: 180px; }
.pr-sign__line { border-bottom: 1px solid #0f172a; height: 16px; }
.pr-sign__cap { font-size: calc(8.2px * var(--pr-fit)); color: #64748b; }
.pr-sheet__foot-note { font-size: calc(8.2px * var(--pr-fit)); color: #94a3b8; text-align: right; }

/* ── Печать: лист ${s.orientation === "landscape" ? "A4 горизонтально" : "A4 вертикально"} ── */
@media print {
  @page { size: A4 ${s.orientation}; margin: 8mm 6mm; }

  html, body {
    background: #fff !important;
    color: #0f172a !important;
    margin: 0 !important;
    padding: 0 !important;
    width: auto !important;
    max-width: none !important;
    overflow: visible !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body { position: static !important; top: auto !important; left: auto !important; }

  /* 1. Прячем всё, что не относится к отчёту (header — сайт-шапка;
        .prd-head — шапки листов развёрнутого отчёта, их НЕ трогаем:
        в них название коробки, номер позиции и артикул) */
  .no-print,
  .site-header-wrap, .site-header, .topbar, .site-footer, footer, nav, header:not(.prd-head),
  .admin-sidebar, .admin-sidebar-handle, .admin-mobile-bar, .admin-bottom-nav,
  .admin-page-head, .admin-notify, .admin-realtime-status, .admin-toast,
  .admin-plans-shortcut, .admin-requests-shortcut,
  .mobile-admin-shell > header, .mobile-admin-shell > nav,
  [data-admin="true"] .admin-sidebar,
  [data-admin="true"] .admin-mobile-bar,
  [data-admin="true"] .admin-page-head,
  .admin-card:not(.pr-print-wrap),
  .pr-root > *:not(.pr-print-wrap),
  .admin-stack > *:not(.pr-root),
  body > *:not(.admin-shell):not(main) {
    display: none !important;
    visibility: hidden !important;
  }

  /* 2. Контейнеры — в обычный поток, без фонов и отступов */
  .admin-shell, .admin-content, .admin-main, .admin-stack, .pr-root,
  .pr-print-wrap, .pr-print-wrap .admin-card__pad, .pr-a4-stage, .pr-a4-scaler {
    display: block !important;
    position: static !important;
    width: auto !important;
    max-width: none !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    overflow: visible !important;
  }

  /* 3. Лист — по ширине страницы */
  .pr-print-area { display: block !important; zoom: 1 !important; }
  .pr-a4-sheet {
    width: auto !important;
    max-width: none !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    zoom: 1 !important;
  }
  .pr-sheet { width: 100% !important; }
  .pr-chart, .pr-sheet__head, .pr-sheet-summary, .pr-sheet__foot { box-shadow: none !important; }
}
`;
}

// Чёрно-белое оформление (для печати без цвета).
const MONO_THEME: (typeof LAYOUT_THEME)["classic"] = {
  headBg: "#111111",
  headColor: "#ffffff",
  headBorder: "#111111",
  border: "#8f8f8f",
  altBg: "#f2f2f2",
  totalBg: "#e2e2e2",
  totalTop: "2px solid #000000",
  cardBg: "#f4f4f4",
  cardBorder: "#9a9a9a",
  usBg: "#f7f7f7",
  compBg: "#f0f0f0",
  detailBg: "#f7f7f7",
  accent: "#111111",
};

const LAYOUT_THEME: Record<
  PrintLayout,
  {
    headBg: string;
    headColor: string;
    headBorder: string;
    border: string;
    altBg: string;
    totalBg: string;
    totalTop: string;
    cardBg: string;
    cardBorder: string;
    usBg: string;
    compBg: string;
    detailBg: string;
    accent: string;
  }
> = {
  classic: {
    headBg: "#1e293b",
    headColor: "#ffffff",
    headBorder: "#1e293b",
    border: "#cbd5e1",
    altBg: "#f8fafc",
    totalBg: "#e2e8f0",
    totalTop: "2px solid #0f172a",
    cardBg: "#f8fafc",
    cardBorder: "#cbd5e1",
    usBg: "rgba(37,99,235,0.05)",
    compBg: "rgba(217,119,6,0.05)",
    detailBg: "#f8fafc",
    accent: "#3b82f6",
  },
  striped: {
    headBg: "#334155",
    headColor: "#ffffff",
    headBorder: "#334155",
    border: "#a9b7c6",
    altBg: "#eaf0f7",
    totalBg: "#d8e2ee",
    totalTop: "2px solid #334155",
    cardBg: "#f1f5f9",
    cardBorder: "#b6c2d0",
    usBg: "rgba(37,99,235,0.07)",
    compBg: "rgba(217,119,6,0.07)",
    detailBg: "#f1f5f9",
    accent: "#2563eb",
  },
  minimal: {
    headBg: "#ffffff",
    headColor: "#0f172a",
    headBorder: "#0f172a",
    border: "#d8dee7",
    altBg: "#ffffff",
    totalBg: "#f1f5f9",
    totalTop: "1.5px solid #0f172a",
    cardBg: "#ffffff",
    cardBorder: "#cbd5e1",
    usBg: "#ffffff",
    compBg: "#ffffff",
    detailBg: "#fafafa",
    accent: "#0f172a",
  },
  accent: {
    headBg: "#0f172a",
    headColor: "#f8fafc",
    headBorder: "#0f172a",
    border: "#c3cddb",
    altBg: "#f5f8ff",
    totalBg: "#e8edff",
    totalTop: "2px solid #2563eb",
    cardBg: "#f5f8ff",
    cardBorder: "#bfdbfe",
    usBg: "rgba(37,99,235,0.08)",
    compBg: "rgba(217,119,6,0.08)",
    detailBg: "#f5f8ff",
    accent: "#2563eb",
  },
};
