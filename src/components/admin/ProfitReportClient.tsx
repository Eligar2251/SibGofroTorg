"use client";

// =========================================================
// FILE: src/components/admin/ProfitReportClient.tsx
// Расчёт выгоды продаж за период + красивая печать на A4.
//
// Данные о продажах приходят из учёта (по каждому товару — список продаж:
// кому, когда, сколько, по какой цене). Пользователь выбирает товары,
// задаёт один раз на позицию цену производства (Мы) и цену закупки у
// конкурента, а компонент считает:
//   • общее проданное количество и выручку (кол-во × цена продажи);
//   • себестоимость нашего производства и прибыль с него;
//   • во сколько обошлась бы закупка у конкурента и прибыль в этом случае;
//   • выгоду производства = экономия против закупки у конкурента.
// Любую сумму (включая итоги) можно переопределить вручную — полная
// редактируемость. Готовую сводку печатаем на A4.
//
// Настройки печати (ориентация, компактность, оформление, колонки, графики,
// выравнивание) живут в ProfitReportPrint.tsx — там же сам лист и стили.
// =========================================================

import {
  Fragment,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import {
  Printer,
  Search,
  Plus,
  X,
  Trash2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Calculator,
  Info,
  SlidersHorizontal,
  Sparkles,
  Table2,
  BarChart3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Gauge,
  ZoomIn,
  Ruler,
  LayoutGrid,
  BookOpen,
  FileText,
  Palette,
  LayoutList,
  Download,
  Droplet,
  Filter,
} from "lucide-react";
import {
  DirectorReport,
  buildDirectorCss,
} from "@/components/admin/ProfitReportDirector";
import {
  ACCENT_LABELS,
  ACCENT_THEMES,
  COLUMN_LABELS,
  DEFAULT_PRINT_SETTINGS,
  DENSITY_LABELS,
  LAYOUT_LABELS,
  METRIC_LABELS,
  ORIENTATION_LABELS,
  PRINT_VARIANTS,
  PrintSheet,
  REPORT_MODE_LABELS,
  SORT_LABELS,
  VARIANT_LABELS,
  applyVariant,
  buildReportCss,
  describeSettings,
  fmtMoney,
  fmtNum,
  measureText,
  patchSettings,
  planSheet,
  round2,
  viewRows,
  type PrintAccent,
  type PrintChartMetric,
  type PrintColumns,
  type PrintDensity,
  type PrintLayout,
  type PrintOrientation,
  type PrintReportMode,
  type PrintSettings,
  type PrintSort,
} from "@/components/admin/ProfitReportPrint";

export interface ProfitSale {
  dealNumber: number;
  date: string;
  customer: string;
  qty: number;
  price: number;
  total: number;
  status: "new" | "completed" | "cancelled";
  isArchive: boolean;
}

export interface ProfitProduct {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  priceWholesale: number | null;
  purchasePrice: number | null;
  sales: ProfitSale[];
}

interface PositionSale {
  id: string;
  date: string;
  customer: string;
  qty: number;
  price: number;
}

// Переопределяемые (вычисляемые) поля позиции.
type OvField =
  | "qty"
  | "revenue"
  | "ourCost"
  | "competitorCost"
  | "ourProfit"
  | "competitorProfit"
  | "benefit";

interface Position {
  id: string;
  productId: string | null;
  name: string;
  sku: string | null;
  unit: string;
  productionCost: number; // Мы: себестоимость 1 шт
  competitorPrice: number; // Конкурент: цена 1 шт
  salePrice: number; // Цена продажи 1 шт
  sales: PositionSale[];
  expanded: boolean;
  ov: Partial<Record<OvField, number>>;
}

type GovField =
  | "qty"
  | "revenue"
  | "ourCost"
  | "competitorCost"
  | "ourProfit"
  | "competitorProfit"
  | "benefit";

interface ReportMeta {
  title: string;
  company: string;
  periodFrom: string;
  periodTo: string;
  note: string;
  completedOnly: boolean;
  signer: string;
}

interface StoredState {
  meta: ReportMeta;
  positions: Position[];
  gov: Partial<Record<GovField, number>>;
  /** Настройки печати (появились позже — у старых сохранений поля нет). */
  settings?: Partial<PrintSettings>;
}

const STORAGE_KEY = "profit-report-v1";

const DEFAULT_META: ReportMeta = {
  title: "План по выгоде продаж",
  company: "ООО «СибГофроТорг»",
  periodFrom: "",
  periodTo: "",
  note: "",
  completedOnly: false,
  signer: "",
};

// Готовые грифы для водяного знака + свой текст — в настройках печати.
const WATERMARK_PRESETS = [
  "КОНФИДЕНЦИАЛЬНО",
  "Для внутреннего пользования",
  "Черновик",
];

// ── Утилиты чисел/формата ──
function parseNum(s: string): number {
  if (typeof s !== "string") return Number(s) || 0;
  const cleaned = s.replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}
function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Колонки интерактивной таблицы-редактора ──
type EditColKey =
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
  | "act";

interface EditColDef {
  key: EditColKey;
  lines: string[];
  cls: string;
  /** Минимальная ширина колонки, px. */
  minPx: number;
  /** Коэффициент «жадности»: название товара забирает лишнюю ширину. */
  grow?: number;
}

// Порядок колонок совпадает с порядком <td> в PositionRows.
const EDIT_COLS: EditColDef[] = [
  { key: "name", lines: ["Товар"], cls: "pr-col-name", minPx: 150, grow: 1.15 },
  { key: "qty", lines: ["Кол-во,", "шт"], cls: "", minPx: 52 },
  { key: "salePrice", lines: ["Цена", "продажи"], cls: "", minPx: 62 },
  { key: "revenue", lines: ["Выручка"], cls: "", minPx: 72 },
  { key: "ourUnit", lines: ["Мы: с/с", "1 шт"], cls: "pr-th-us", minPx: 58 },
  { key: "ourSum", lines: ["Мы: сумма"], cls: "pr-th-us", minPx: 70 },
  { key: "compUnit", lines: ["Конкур.", "1 шт"], cls: "pr-th-comp", minPx: 58 },
  { key: "compSum", lines: ["Конкур.:", "сумма"], cls: "pr-th-comp", minPx: 70 },
  { key: "ourProfit", lines: ["Прибыль", "(наша)"], cls: "pr-th-profit", minPx: 66 },
  { key: "compProfit", lines: ["Прибыль у", "конкур."], cls: "pr-th-profit", minPx: 66 },
  { key: "benefit", lines: ["Выгода", "произв."], cls: "pr-th-benefit", minPx: 66 },
  { key: "act", lines: [], cls: "pr-col-act", minPx: 34 },
];

// Продажи товара, отфильтрованные по периоду и статусу → в позиции.
function pickSales(
  product: ProfitProduct,
  meta: ReportMeta
): PositionSale[] {
  return product.sales
    .filter((s) => {
      if (meta.completedOnly && s.status !== "completed") return false;
      if (meta.periodFrom && s.date < meta.periodFrom) return false;
      if (meta.periodTo && s.date > meta.periodTo) return false;
      return true;
    })
    .map((s) => ({
      id: uid(),
      date: s.date,
      customer: s.customer,
      qty: s.qty,
      price: s.price,
    }));
}

function makePosition(product: ProfitProduct, meta: ReportMeta): Position {
  const sales = pickSales(product, meta);
  const sumQty = sales.reduce((a, s) => a + s.qty, 0);
  const sumSum = sales.reduce((a, s) => a + s.qty * s.price, 0);
  const avgPrice =
    sumQty > 0 ? round2(sumSum / sumQty) : round2(product.price ?? 0);
  return {
    id: uid(),
    productId: product.id,
    name: product.name,
    sku: product.sku,
    unit: "шт",
    // Себестоимость производства как стартовое значение берём из закупочной
    // цены в базе (если задана) — её всегда можно поправить.
    productionCost: round2(product.purchasePrice ?? 0),
    competitorPrice: 0,
    salePrice: avgPrice,
    sales,
    expanded: false,
    ov: {},
  };
}

function emptyPosition(): Position {
  return {
    id: uid(),
    productId: null,
    name: "",
    sku: null,
    unit: "шт",
    productionCost: 0,
    competitorPrice: 0,
    salePrice: 0,
    sales: [],
    expanded: false,
    ov: {},
  };
}

// ── Вычисления позиции ──
interface Calc {
  qty: number;
  revenue: number;
  ourCost: number;
  competitorCost: number;
  ourProfit: number;
  competitorProfit: number;
  benefit: number;
  margin: number;
}
function calcPosition(p: Position): Calc {
  const sumQty = p.sales.reduce((a, s) => a + s.qty, 0);
  const qty = p.ov.qty ?? sumQty;
  const revenue = p.ov.revenue ?? round2(qty * p.salePrice);
  const ourCost = p.ov.ourCost ?? round2(qty * p.productionCost);
  const competitorCost =
    p.ov.competitorCost ?? round2(qty * p.competitorPrice);
  const ourProfit = p.ov.ourProfit ?? round2(revenue - ourCost);
  const competitorProfit =
    p.ov.competitorProfit ?? round2(revenue - competitorCost);
  const benefit = p.ov.benefit ?? round2(competitorCost - ourCost);
  const margin = revenue !== 0 ? round2((ourProfit / revenue) * 100) : 0;
  return {
    qty,
    revenue,
    ourCost,
    competitorCost,
    ourProfit,
    competitorProfit,
    benefit,
    margin,
  };
}

export function ProfitReportClient({
  products,
  storageKey = STORAGE_KEY,
  demo = false,
}: {
  products: ProfitProduct[];
  /** Ключ localStorage (превью использует отдельный, чтобы не затирать рабочий отчёт). */
  storageKey?: string;
  /** Демо-режим: при пустом отчёте автоматически подставить примеры позиций. */
  demo?: boolean;
}) {
  const [meta, setMeta] = useState<ReportMeta>(DEFAULT_META);
  const [positions, setPositions] = useState<Position[]>([]);
  const [gov, setGov] = useState<Partial<Record<GovField, number>>>({});
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zoomMode, setZoomMode] = useState<"auto" | number>("auto");
  const [stageWidth, setStageWidth] = useState(0);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  // После монтирования canvas уже доступен → ширины колонок считаем
  // по фактическим метрикам шрифта (на сервере была грубая оценка).
  const [measured, setMeasured] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMeasured(true), []);

  // ── Загрузка из localStorage ──
  useEffect(() => {
    let hadStored = false;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredState;
        if (parsed.meta) {
          const oldMeta = parsed.meta as ReportMeta & { showDetails?: boolean };
          setMeta({ ...DEFAULT_META, ...oldMeta });
          // Старые отчёты хранили «детали продаж» в meta — переносим в настройки.
          if (typeof oldMeta.showDetails === "boolean") {
            setSettings((s) => ({
              ...s,
              showDetails: Boolean(oldMeta.showDetails),
              variant: "custom",
            }));
          }
        }
        if (Array.isArray(parsed.positions)) setPositions(parsed.positions);
        if (parsed.gov) setGov(parsed.gov);
        if (parsed.settings) {
          setSettings((s) => ({
            ...DEFAULT_PRINT_SETTINGS,
            ...parsed.settings,
            columns: {
              ...DEFAULT_PRINT_SETTINGS.columns,
              ...(parsed.settings?.columns || {}),
            },
          }));
        }
        hadStored = true;
      }
    } catch {
      /* нет сохранёнки */
    }
    // Демо-режим (страница предпросмотра): если отчёт пуст — подставим
    // несколько примеров, чтобы сразу видеть расчёт и печать.
    if (!hadStored && demo && products.length > 0) {
      const seed = products.slice(0, 3).map((p, i) => {
        const pos = makePosition(p, DEFAULT_META);
        pos.competitorPrice = round2(pos.productionCost * (1.35 + i * 0.1)) || 0;
        return pos;
      });
      setPositions(seed);
    }
    setLoaded(true);
  }, [storageKey, demo, products]);

  // ── Сохранение ──
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ meta, positions, gov, settings } satisfies StoredState)
      );
    } catch {
      /* localStorage недоступен */
    }
  }, [meta, positions, gov, settings, loaded, storageKey]);

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const calcs = useMemo(() => positions.map(calcPosition), [positions]);


  // ── Итоги (сумма отображаемых + ручное переопределение) ──
  const totals = useMemo(() => {
    const sum = (key: keyof Calc) =>
      calcs.reduce((a, c) => a + (c[key] as number), 0);
    const qty = gov.qty ?? sum("qty");
    const revenue = gov.revenue ?? round2(sum("revenue"));
    const ourCost = gov.ourCost ?? round2(sum("ourCost"));
    const competitorCost = gov.competitorCost ?? round2(sum("competitorCost"));
    const ourProfit = gov.ourProfit ?? round2(sum("ourProfit"));
    const competitorProfit =
      gov.competitorProfit ?? round2(sum("competitorProfit"));
    const benefit = gov.benefit ?? round2(sum("benefit"));
    const margin = revenue !== 0 ? round2((ourProfit / revenue) * 100) : 0;
    return {
      qty,
      revenue,
      ourCost,
      competitorCost,
      ourProfit,
      competitorProfit,
      benefit,
      margin,
    };
  }, [calcs, gov]);

  // Ширины колонок редактора считаем по фактическому содержимому
  // (заголовки + значения + строка «ИТОГО»): числа и тексты остаются
  // внутри своих ячеек, ничего не «вылезает» и не разъезжается.
  const editPlan = useMemo(() => {
    const values: Record<EditColKey, string[]> = {
      name: positions.map((p) => p.name),
      qty: calcs.map((c) => fmtNum(c.qty)),
      salePrice: positions.map((p) => String(round2(p.salePrice))),
      revenue: calcs.map((c) => fmtMoney(c.revenue, false)),
      ourUnit: positions.map((p) => String(round2(p.productionCost))),
      ourSum: calcs.map((c) => fmtMoney(c.ourCost, false)),
      compUnit: positions.map((p) => String(round2(p.competitorPrice))),
      compSum: calcs.map((c) => fmtMoney(c.competitorCost, false)),
      ourProfit: calcs.map((c) => fmtMoney(c.ourProfit, false)),
      compProfit: calcs.map((c) => fmtMoney(c.competitorProfit, false)),
      benefit: calcs.map((c) => fmtMoney(c.benefit, false)),
      act: [],
    };
    const totalsValues: Partial<Record<EditColKey, string>> = {
      qty: fmtNum(totals.qty),
      revenue: fmtMoney(totals.revenue, false),
      ourSum: fmtMoney(totals.ourCost, false),
      compSum: fmtMoney(totals.competitorCost, false),
      ourProfit: fmtMoney(totals.ourProfit, false),
      compProfit: fmtMoney(totals.competitorProfit, false),
      benefit: fmtMoney(totals.benefit, false),
    };
    const widthOf = (text: string, fontPx: number, weight = 400) =>
      measured ? measureText(text, fontPx, weight) : text.length * fontPx * 0.56;
    const widths = EDIT_COLS.map((col) => {
      let w = col.minPx;
      // Заголовок (11px, полужирный).
      for (const line of col.lines) {
        w = Math.max(w, widthOf(line, 11, 600) + 12);
      }
      // Все значения колонки (12px).
      for (const v of values[col.key]) {
        w = Math.max(w, widthOf(v, 12, 400) + 12);
      }
      const tv = totalsValues[col.key];
      if (tv) w = Math.max(w, widthOf(tv, 12, 700) + 12);
      if (col.grow) w *= col.grow;
      return { ...col, w };
    });
    const totalPx = Math.round(widths.reduce((a, c) => a + c.w, 0));
    const cols = widths.map((c) => ({ ...c, pct: (c.w / totalPx) * 100 }));
    return { cols, totalPx };
  }, [positions, calcs, totals, measured]);

  // ── Мутации ──
  const updatePos = useCallback(
    (id: string, patch: Partial<Position>) => {
      setPositions((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
      );
    },
    []
  );
  const setOv = useCallback(
    (id: string, field: OvField, value: number | undefined) => {
      setPositions((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const ov = { ...p.ov };
          if (value === undefined) delete ov[field];
          else ov[field] = value;
          return { ...p, ov };
        })
      );
    },
    []
  );
  const setGovField = useCallback(
    (field: GovField, value: number | undefined) => {
      setGov((prev) => {
        const next = { ...prev };
        if (value === undefined) delete next[field];
        else next[field] = value;
        return next;
      });
    },
    []
  );

  function addProduct(product: ProfitProduct) {
    if (positions.some((p) => p.productId === product.id)) {
      // Уже добавлен — просто прокрутимся к нему.
      return;
    }
    setPositions((prev) => [...prev, makePosition(product, meta)]);
  }

  function addManual() {
    setPositions((prev) => [...prev, emptyPosition()]);
    setPickerOpen(false);
  }

  function removePos(id: string) {
    setPositions((prev) => prev.filter((p) => p.id !== id));
  }

  function rebuildFromSource() {
    setPositions((prev) =>
      prev.map((p) => {
        if (!p.productId) return p;
        const src = productMap.get(p.productId);
        if (!src) return p;
        const sales = pickSales(src, meta);
        const sumQty = sales.reduce((a, s) => a + s.qty, 0);
        const sumSum = sales.reduce((a, s) => a + s.qty * s.price, 0);
        const avgPrice =
          sumQty > 0 ? round2(sumSum / sumQty) : p.salePrice;
        return {
          ...p,
          sales,
          salePrice: avgPrice || p.salePrice,
          // Пересобрали фактические продажи — снимаем ручные правки
          // количества/выручки, чтобы отражать период. Цены (Мы/конкурент)
          // остаются как заданы вручную.
          ov: {},
        };
      })
    );
  }

  function resetAll() {
    if (
      !window.confirm(
        "Очистить отчёт полностью? Позиции и правки будут удалены."
      )
    )
      return;
    setPositions([]);
    setGov({});
    setMeta(DEFAULT_META);
    setSettings(DEFAULT_PRINT_SETTINGS);
  }

  // ── Настройки печати ──
  const changeSetting = useCallback((patch: Partial<PrintSettings>) => {
    setSettings((s) => patchSettings(s, patch));
  }, []);
  const toggleColumn = useCallback((key: keyof PrintColumns) => {
    setSettings((s) =>
      patchSettings(s, {
        columns: { ...s.columns, [key]: !s.columns[key] },
      })
    );
  }, []);

  // ── Экспорт таблицы отчёта в CSV ──
  // Файл собирается из тех же строк/колонок, что печатаются: с учётом
  // сортировки, скрытия позиций без продаж и выбранных колонок.
  function exportCsv() {
    const view = viewRows(positions, calcs, settings);
    const plan = planSheet(
      view.map((v) => v.pos),
      view.map((v) => v.calc),
      totals,
      settings
    );
    const cell = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    // Числа чистим от ₽ и неразрывных пробелов — Excel увидит числа, а не текст.
    const num = (v: string) => v.replace(/[\s\u00A0]/g, "").replace("₽", "");
    const lines: string[] = [];
    lines.push(plan.cols.map((c) => cell(c.lines.join(" "))).join(";"));
    view.forEach(({ pos, calc }, i) => {
      lines.push(
        plan.cols
          .map((col) => {
            if (col.key === "name") {
              return cell(
                pos.name
                  ? settings.showSku && pos.sku
                    ? `${pos.name} (${pos.sku})`
                    : pos.name
                  : "—"
              );
            }
            const v = col.value ? col.value(pos, calc, i) : "—";
            return cell(col.align === "num" ? num(v) : v);
          })
          .join(";")
      );
    });
    if (settings.showTotals) {
      lines.push(
        plan.cols
          .map((col) => {
            if (col.key === "name") return cell("ИТОГО");
            const v = col.total ? col.total(totals) : "—";
            return cell(col.align === "num" ? num(v) : v);
          })
          .join(";")
      );
    }
    // BOM — чтобы кириллица в Excel открывалась без «кракозябр».
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vygoda-prodazh-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Продажи внутри позиции ──
  function addSale(posId: string) {
    setPositions((prev) =>
      prev.map((p) =>
        p.id === posId
          ? {
              ...p,
              expanded: true,
              sales: [
                ...p.sales,
                {
                  id: uid(),
                  date: meta.periodTo || new Date().toISOString().slice(0, 10),
                  customer: "",
                  qty: 0,
                  price: p.salePrice,
                },
              ],
            }
          : p
      )
    );
  }
  function updateSale(
    posId: string,
    saleId: string,
    patch: Partial<PositionSale>
  ) {
    setPositions((prev) =>
      prev.map((p) =>
        p.id === posId
          ? {
              ...p,
              sales: p.sales.map((s) =>
                s.id === saleId ? { ...s, ...patch } : s
              ),
            }
          : p
      )
    );
  }
  function removeSale(posId: string, saleId: string) {
    setPositions((prev) =>
      prev.map((p) =>
        p.id === posId
          ? { ...p, sales: p.sales.filter((s) => s.id !== saleId) }
          : p
      )
    );
  }

  // ── Поиск товаров ──
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q)
      );
    });
    // Сначала товары с продажами.
    return list
      .sort((a, b) => {
        const av = a.sales.length > 0 ? 0 : 1;
        const bv = b.sales.length > 0 ? 0 : 1;
        if (av !== bv) return av - bv;
        return a.name.localeCompare(b.name, "ru");
      })
      .slice(0, 60);
  }, [products, search]);

  const addedIds = useMemo(
    () => new Set(positions.map((p) => p.productId).filter(Boolean) as string[]),
    [positions]
  );

  // Активируем режим печати отчёта на странице для полной изоляции стилей
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("profit-report-mode");
    const onBefore = () => document.body.classList.add("profit-report-mode");
    const onAfter = () => document.body.classList.add("profit-report-mode");
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
      document.body.classList.remove("profit-report-mode");
    };
  }, []);

  function handlePrint() {
    if (typeof document !== "undefined") {
      document.body.classList.add("profit-report-mode");
    }
    window.print();
  }

  const hasPositions = positions.length > 0;

  const directorItemCount = useMemo(() => {
    if (settings.reportMode !== "director" || !settings.directorItems) return 0;
    return settings.directorTop > 0
      ? Math.min(settings.directorTop, positions.length)
      : positions.length;
  }, [settings.reportMode, settings.directorItems, settings.directorTop, positions.length]);

  const directorPageCount =
    settings.reportMode === "director"
      ? (settings.directorSummary ? 1 : 0) + directorItemCount
      : 0;

  // Масштаб превью листа: «авто» подгоняет лист (особенно альбомный)
  // под ширину колонки, чтобы не приходилось крутить горизонтальный скролл.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || 0;
      setStageWidth(w);
    });
    ro.observe(el);
    setStageWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [hasPositions]);

  const sheetWidthPx = (settings.orientation === "landscape" ? 297 : 210) * 3.7795;
  const previewZoom =
    zoomMode === "auto"
      ? stageWidth > 0
        ? Math.min(1, Math.max(0.3, (stageWidth - 40) / sheetWidthPx))
        : 1
      : zoomMode;

  // Стили листа зависят от настроек (ориентация, компактность, оформление,
  // выравнивание) — собираем их на каждый вариант.
  const reportCss = useMemo(
    () =>
      UI_CSS +
      buildReportCss(settings) +
      (settings.reportMode === "director" ? buildDirectorCss(settings) : ""),
    [settings]
  );

  // ── Ячейка с переопределением (вычисляемое поле) ──
  function OvInput({
    pos,
    field,
    computed,
    tone,
  }: {
    pos: Position;
    field: OvField;
    computed: number;
    tone?: "profit" | "benefit";
  }) {
    const overridden = pos.ov[field] !== undefined;
    const val = overridden ? pos.ov[field]! : computed;
    return (
      <div className={`pr-ovcell${overridden ? " pr-ovcell--ov" : ""}`}>
        <input
          className={`pr-num${tone ? ` pr-num--${tone}` : ""}`}
          inputMode="decimal"
          value={String(round2(val))}
          onChange={(e) => {
            const t = e.target.value.trim();
            if (t === "") setOv(pos.id, field, undefined);
            else setOv(pos.id, field, parseNum(t));
          }}
        />
        {overridden && (
          <button
            type="button"
            className="pr-reset"
            title="Вернуть расчётное значение"
            onClick={() => setOv(pos.id, field, undefined)}
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    );
  }

  function GovInput({
    field,
    computed,
    tone,
  }: {
    field: GovField;
    computed: number;
    tone?: "profit" | "benefit";
  }) {
    const overridden = gov[field] !== undefined;
    const val = overridden ? gov[field]! : computed;
    return (
      <div className={`pr-ovcell${overridden ? " pr-ovcell--ov" : ""}`}>
        <input
          className={`pr-num pr-num--bold${tone ? ` pr-num--${tone}` : ""}`}
          inputMode="decimal"
          value={String(round2(val))}
          onChange={(e) => {
            const t = e.target.value.trim();
            if (t === "") setGovField(field, undefined);
            else setGovField(field, parseNum(t));
          }}
        />
        {overridden && (
          <button
            type="button"
            className="pr-reset"
            title="Вернуть расчётное значение"
            onClick={() => setGovField(field, undefined)}
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`pr-root${
        settings.alignNumbers === "center" ? " pr-align-num--center" : ""
      }${settings.alignName === "center" ? " pr-align-name--center" : ""}`}
    >
      <style>{reportCss}</style>

      {/* ── Панель управления ── */}
      <div className="admin-card no-print">
        <div className="admin-card__pad admin-stack">
          <div className="pr-controls">
            <label className="pr-field">
              <span className="pr-field__label">Заголовок отчёта</span>
              <input
                className="admin-input"
                value={meta.title}
                onChange={(e) => setMeta({ ...meta, title: e.target.value })}
              />
            </label>
            <label className="pr-field">
              <span className="pr-field__label">Организация</span>
              <input
                className="admin-input"
                value={meta.company}
                onChange={(e) => setMeta({ ...meta, company: e.target.value })}
              />
            </label>
            <label className="pr-field pr-field--sm">
              <span className="pr-field__label">Период с</span>
              <input
                type="date"
                className="admin-input"
                value={meta.periodFrom}
                onChange={(e) =>
                  setMeta({ ...meta, periodFrom: e.target.value })
                }
              />
            </label>
            <label className="pr-field pr-field--sm">
              <span className="pr-field__label">по</span>
              <input
                type="date"
                className="admin-input"
                value={meta.periodTo}
                onChange={(e) => setMeta({ ...meta, periodTo: e.target.value })}
              />
            </label>
          </div>

          <div className="pr-controls">
            <label className="pr-field">
              <span className="pr-field__label">
                Примечание (под шапкой листа)
              </span>
              <input
                className="admin-input"
                placeholder="Например: по данным учёта на текущую дату"
                value={meta.note}
                onChange={(e) => setMeta({ ...meta, note: e.target.value })}
              />
            </label>
            <label className="pr-field pr-field--sm">
              <span className="pr-field__label">Подпись (ФИО / должность)</span>
              <input
                className="admin-input"
                placeholder="кто подписывает отчёт"
                value={meta.signer}
                onChange={(e) => setMeta({ ...meta, signer: e.target.value })}
              />
            </label>
          </div>

          <div className="pr-controls">
            <label className="pr-check">
              <input
                type="checkbox"
                checked={meta.completedOnly}
                onChange={(e) =>
                  setMeta({ ...meta, completedOnly: e.target.checked })
                }
              />
              <span>Только завершённые сделки</span>
            </label>
            <label className="pr-check">
              <input
                type="checkbox"
                checked={settings.showDetails}
                onChange={(e) => changeSetting({ showDetails: e.target.checked })}
              />
              <span>Детали продаж в печати (кому / когда)</span>
            </label>
          </div>

          <div className="pr-actions">
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={() => setPickerOpen((v) => !v)}
            >
              <Plus size={15} /> Добавить товар
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={addManual}
            >
              <Plus size={15} /> Своя позиция
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={rebuildFromSource}
              title="Заново подтянуть продажи из учёта за выбранный период"
              disabled={!hasPositions}
            >
              <RefreshCw size={15} /> Пересобрать из учёта
            </button>
            <div className="pr-actions__spacer" />
            <button
              type="button"
              className="admin-btn admin-btn--navy"
              onClick={handlePrint}
              disabled={!hasPositions}
              title={`Печать отчёта на A4 — ${ORIENTATION_LABELS[
                settings.orientation
              ].toLowerCase()}`}
            >
              <Printer size={15} /> Печать A4 ·{" "}
              {settings.reportMode === "director"
                ? `${directorPageCount} л.`
                : settings.orientation === "landscape"
                  ? "горизонтально"
                  : "вертикально"}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={exportCsv}
              disabled={!hasPositions}
              title="Выгрузить таблицу отчёта в CSV (как в печати: с сортировкой и колонками)"
            >
              <Download size={15} /> CSV
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger-ghost"
              onClick={resetAll}
            >
              <Trash2 size={15} /> Очистить
            </button>
          </div>

          {/* ── Настройки печати: варианты, ориентация, компактность, графики ── */}
          <div className="pr-settings-bar">
            <button
              type="button"
              className="pr-settings-toggle"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
            >
              <SlidersHorizontal size={15} />
              Настройки печати
              <span className="pr-settings-toggle__sum">
                {describeSettings(settings)}
              </span>
              {settingsOpen ? (
                <ChevronDown size={15} />
              ) : (
                <ChevronRight size={15} />
              )}
            </button>
            <div className="pr-chips">
              {(
                [
                  ["portrait", "Вертикально"],
                  ["landscape", "Горизонтально"],
                ] as [PrintOrientation, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`pr-chip${
                    settings.orientation === id ? " pr-chip--on" : ""
                  }`}
                  onClick={() => changeSetting({ orientation: id })}
                  title={ORIENTATION_LABELS[id]}
                >
                  {id === "portrait" ? (
                    <Ruler size={13} />
                  ) : (
                    <LayoutGrid size={13} />
                  )}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {settingsOpen && (
            <div className="pr-settings">
              {/* Готовые варианты */}
              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <Sparkles size={13} /> Готовый вариант
                </span>
                <div className="pr-chips">
                  {PRINT_VARIANTS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={`pr-chip${
                        settings.variant === v.id ? " pr-chip--on" : ""
                      }`}
                      onClick={() => setSettings(applyVariant(v.id, settings))}
                      title={v.hint}
                    >
                      {v.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="pr-chip pr-chip--ghost"
                    onClick={() => setSettings(DEFAULT_PRINT_SETTINGS)}
                    title="Вернуть настройки печати по умолчанию"
                  >
                    <RotateCcw size={13} /> Сбросить
                  </button>
                </div>
                <p className="pr-settings__hint">
                  {PRINT_VARIANTS.find((v) => v.id === settings.variant)?.hint ||
                    "Свои настройки: правьте любой параметр ниже."}
                </p>
              </div>

              {/* Тип отчёта */}
              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <FileText size={13} /> Тип отчёта
                </span>
                <div className="pr-chips">
                  {(
                    [
                      ["table", "Таблица на лист"],
                      ["director", "Развёрнутый (по листу на позицию)"],
                    ] as [PrintReportMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className={`pr-chip${
                        settings.reportMode === mode ? " pr-chip--on" : ""
                      }`}
                      onClick={() =>
                        mode === "director"
                          ? setSettings(
                              applyVariant("director", {
                                ...settings,
                                reportMode: "director",
                              })
                            )
                          : changeSetting({
                              reportMode: mode,
                              variant:
                                settings.variant === "director"
                                  ? "full"
                                  : settings.variant,
                            })
                      }
                    >
                      {mode === "director" ? (
                        <BookOpen size={13} />
                      ) : (
                        <Table2 size={13} />
                      )}
                      {label}
                    </button>
                  ))}
                </div>
                <p className="pr-settings__hint">
                  {settings.reportMode === "director"
                    ? `Многостраничный отчёт: сводка по всем позициям, прогноз на месяц, отдельный лист на каждую позицию с графиками, клиентами и рекомендациями. Листов: ${directorPageCount}.`
                    : "Один лист A4 с таблицей расчёта и графиками."}
                </p>
              </div>

              {settings.reportMode === "director" && (
                <>
                  <div className="pr-settings__group">
                    <span className="pr-settings__label">
                      <BookOpen size={13} /> Состав отчёта
                    </span>
                    <div className="pr-settings__cols">
                      {(
                        [
                          ["directorSummary", "Сводный лист"],
                          ["directorItems", "Лист на каждую позицию"],
                          ["directorCharts", "Графики (месяцы, цены)"],
                          ["directorClients", "Кто и сколько берёт"],
                          ["directorForecast", "Прогноз на месяц"],
                          ["directorAdvice", "Рекомендации"],
                          ["directorSales", "Все продажи позиции"],
                          ["directorOverall", "Колонтитул листа"],
                        ] as [keyof PrintSettings, string][]
                      ).map(([key, label]) => (
                        <label className="pr-check" key={String(key)}>
                          <input
                            type="checkbox"
                            checked={Boolean(settings[key])}
                            onChange={(e) =>
                              changeSetting({
                                [key]: e.target.checked,
                              } as Partial<PrintSettings>)
                            }
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="pr-settings__group">
                    <span className="pr-settings__label">
                      <LayoutList size={13} /> Позиций в отчёте
                    </span>
                    <div className="pr-chips">
                      {[0, 10, 20, 50].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`pr-chip${
                            settings.directorTop === n ? " pr-chip--on" : ""
                          }`}
                          onClick={() => changeSetting({ directorTop: n })}
                        >
                          {n === 0 ? "Все позиции" : `Первые ${n}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Ориентация + компактность + оформление */}
              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <Gauge size={13} /> Ориентация листа
                </span>
                <div className="pr-chips">
                  {(["portrait", "landscape"] as PrintOrientation[]).map((o) => (
                    <button
                      key={o}
                      type="button"
                      className={`pr-chip${
                        settings.orientation === o ? " pr-chip--on" : ""
                      }`}
                      onClick={() => changeSetting({ orientation: o })}
                    >
                      {ORIENTATION_LABELS[o]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <Table2 size={13} /> Компактность
                </span>
                <div className="pr-chips">
                  {(
                    ["comfort", "normal", "compact", "ultra"] as PrintDensity[]
                  ).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`pr-chip${
                        settings.density === d ? " pr-chip--on" : ""
                      }`}
                      onClick={() => changeSetting({ density: d })}
                    >
                      {DENSITY_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <LayoutGrid size={13} /> Оформление
                </span>
                <div className="pr-chips">
                  {(
                    ["classic", "striped", "minimal", "accent"] as PrintLayout[]
                  ).map((l) => (
                    <button
                      key={l}
                      type="button"
                      className={`pr-chip${
                        settings.layout === l ? " pr-chip--on" : ""
                      }`}
                      onClick={() => changeSetting({ layout: l })}
                      disabled={settings.mono}
                      title={
                        settings.mono
                          ? "В чёрно-белом режиме оформление задаётся автоматически"
                          : LAYOUT_LABELS[l]
                      }
                    >
                      {LAYOUT_LABELS[l]}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`pr-chip${
                      settings.mono ? " pr-chip--on" : ""
                    }`}
                    onClick={() => changeSetting({ mono: !settings.mono })}
                    title="Чёрно-белая печать: без цветных заливок, смысл — жирным, штриховкой и знаками"
                  >
                    <Palette size={13} /> Чёрно-белая печать
                  </button>
                </div>
                <div className="pr-settings__row">
                  <span className="pr-settings__hint">Акцентный цвет:</span>
                  <div className="pr-chips">
                    {(
                      [
                        "auto",
                        "blue",
                        "violet",
                        "green",
                        "cyan",
                        "orange",
                        "rose",
                        "graphite",
                      ] as PrintAccent[]
                    ).map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={`pr-chip${
                          settings.accent === a ? " pr-chip--on" : ""
                        }`}
                        onClick={() => changeSetting({ accent: a })}
                        disabled={settings.mono}
                        title={
                          settings.mono
                            ? "В чёрно-белом режиме цвет не используется"
                            : `Акцент: ${ACCENT_LABELS[a].toLowerCase()} — плашки выгоды, графики, таблицы`
                        }
                      >
                        <span
                          className="pr-dot"
                          style={
                            a === "auto"
                              ? {
                                  background:
                                    "linear-gradient(135deg,#2563eb,#7c3aed 50%,#ea580c)",
                                }
                              : { background: ACCENT_THEMES[a].main }
                          }
                        />
                        {ACCENT_LABELS[a]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Порядок строк и фильтры */}
              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <Filter size={13} /> Порядок и фильтр строк
                </span>
                <div className="pr-chips">
                  {(
                    [
                      "asIs",
                      "benefitDesc",
                      "profitDesc",
                      "revenueDesc",
                      "qtyDesc",
                      "nameAsc",
                    ] as PrintSort[]
                  ).map((so) => (
                    <button
                      key={so}
                      type="button"
                      className={`pr-chip${
                        settings.sort === so ? " pr-chip--on" : ""
                      }`}
                      onClick={() => changeSetting({ sort: so })}
                    >
                      {SORT_LABELS[so]}
                    </button>
                  ))}
                </div>
                <div className="pr-settings__cols">
                  <label className="pr-check">
                    <input
                      type="checkbox"
                      checked={settings.hideEmpty}
                      onChange={(e) =>
                        changeSetting({ hideEmpty: e.target.checked })
                      }
                    />
                    <span>Скрыть позиции без продаж</span>
                  </label>
                  <label className="pr-check">
                    <input
                      type="checkbox"
                      checked={settings.wholeRubles}
                      onChange={(e) =>
                        changeSetting({ wholeRubles: e.target.checked })
                      }
                    />
                    <span>Суммы без копеек</span>
                  </label>
                </div>
                <p className="pr-settings__hint">
                  Порядок и фильтр действуют на печать, графики, развёрнутый
                  отчёт и CSV. Суммы округляются до рублей, цены за штуку — как
                  есть.
                </p>
              </div>

              {/* Водяной знак (гриф) */}
              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <Droplet size={13} /> Водяной знак (гриф)
                </span>
                <div className="pr-chips">
                  {WATERMARK_PRESETS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      className={`pr-chip${
                        settings.watermark.trim() === w ? " pr-chip--on" : ""
                      }`}
                      onClick={() =>
                        changeSetting({
                          watermark:
                            settings.watermark.trim() === w ? "" : w,
                        })
                      }
                      title="Поверх листа полупрозрачным текстом под углом"
                    >
                      {w}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="pr-chip pr-chip--ghost"
                    onClick={() => changeSetting({ watermark: "" })}
                    disabled={!settings.watermark}
                  >
                    <X size={13} /> Без грифа
                  </button>
                </div>
                <label className="pr-field">
                  <span className="pr-field__label">
                    Свой текст (пусто — без водяного знака)
                  </span>
                  <input
                    className="admin-input"
                    placeholder="например: Предварительный расчёт"
                    value={settings.watermark}
                    onChange={(e) =>
                      changeSetting({ watermark: e.target.value })
                    }
                  />
                </label>
              </div>

              {/* Графики */}
              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <BarChart3 size={13} /> Графики на листе
                </span>
                <div className="pr-chips">
                  <button
                    type="button"
                    className={`pr-chip${
                      settings.chartBars ? " pr-chip--on" : ""
                    }`}
                    onClick={() => changeSetting({ chartBars: !settings.chartBars })}
                  >
                    Полосы по позициям
                  </button>
                  <button
                    type="button"
                    className={`pr-chip${
                      settings.chartDonut ? " pr-chip--on" : ""
                    }`}
                    onClick={() => changeSetting({ chartDonut: !settings.chartDonut })}
                  >
                    Структура (кольцо)
                  </button>
                  <button
                    type="button"
                    className={`pr-chip${
                      settings.chartTimeline ? " pr-chip--on" : ""
                    }`}
                    onClick={() =>
                      changeSetting({ chartTimeline: !settings.chartTimeline })
                    }
                  >
                    По дням продаж
                  </button>
                </div>
                {(settings.chartBars ||
                  settings.chartDonut ||
                  settings.chartTimeline) && (
                  <div className="pr-settings__row">
                    <span className="pr-settings__hint">Показатель:</span>
                    <div className="pr-chips">
                      {(
                        [
                          "benefit",
                          "profit",
                          "revenue",
                          "qty",
                        ] as PrintChartMetric[]
                      ).map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`pr-chip${
                            settings.chartMetric === m ? " pr-chip--on" : ""
                          }`}
                          onClick={() => changeSetting({ chartMetric: m })}
                        >
                          {METRIC_LABELS[m]}
                        </button>
                      ))}
                    </div>
                    <span className="pr-settings__hint">Позиций в графике:</span>
                    <div className="pr-chips">
                      {[5, 8, 12, 0].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`pr-chip${
                            settings.chartTop === n ? " pr-chip--on" : ""
                          }`}
                          onClick={() => changeSetting({ chartTop: n })}
                        >
                          {n === 0 ? "Все" : `Топ ${n}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Выравнивание и масштаб */}
              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <AlignCenter size={13} /> Выравнивание и масштаб
                </span>
                <div className="pr-settings__row">
                  <span className="pr-settings__hint">Числа:</span>
                  <div className="pr-chips">
                    <button
                      type="button"
                      className={`pr-chip${
                        settings.alignNumbers === "right" ? " pr-chip--on" : ""
                      }`}
                      onClick={() => changeSetting({ alignNumbers: "right" })}
                    >
                      <AlignRight size={13} /> По правому краю
                    </button>
                    <button
                      type="button"
                      className={`pr-chip${
                        settings.alignNumbers === "center" ? " pr-chip--on" : ""
                      }`}
                      onClick={() => changeSetting({ alignNumbers: "center" })}
                    >
                      <AlignCenter size={13} /> По центру
                    </button>
                  </div>
                  <span className="pr-settings__hint">Названия:</span>
                  <div className="pr-chips">
                    <button
                      type="button"
                      className={`pr-chip${
                        settings.alignName === "left" ? " pr-chip--on" : ""
                      }`}
                      onClick={() => changeSetting({ alignName: "left" })}
                    >
                      <AlignLeft size={13} /> Слева
                    </button>
                    <button
                      type="button"
                      className={`pr-chip${
                        settings.alignName === "center" ? " pr-chip--on" : ""
                      }`}
                      onClick={() => changeSetting({ alignName: "center" })}
                    >
                      <AlignCenter size={13} /> По центру
                    </button>
                  </div>
                </div>
                <div className="pr-settings__row">
                  <span className="pr-settings__hint">Размер таблицы:</span>
                  <div className="pr-chips">
                    <button
                      type="button"
                      className={`pr-chip${
                        settings.scaleMode === "auto" ? " pr-chip--on" : ""
                      }`}
                      onClick={() => changeSetting({ scaleMode: "auto" })}
                      title="Ширина колонок и размер шрифта подбираются под содержимое листа"
                    >
                      Авто
                    </button>
                    <button
                      type="button"
                      className={`pr-chip${
                        settings.scaleMode === "manual" ? " pr-chip--on" : ""
                      }`}
                      onClick={() => changeSetting({ scaleMode: "manual" })}
                    >
                      Вручную
                    </button>
                  </div>
                  <label className="pr-scale">
                    <input
                      type="range"
                      min={0.6}
                      max={1.3}
                      step={0.02}
                      value={settings.scale}
                      disabled={settings.scaleMode === "auto"}
                      onChange={(e) =>
                        changeSetting({
                          scaleMode: "manual",
                          scale: Number(e.target.value),
                        })
                      }
                    />
                    {Math.round(settings.scale * 100)}%
                  </label>
                  <label className="pr-check">
                    <input
                      type="checkbox"
                      checked={settings.currency}
                      onChange={(e) =>
                        changeSetting({ currency: e.target.checked })
                      }
                    />
                    <span>Знак ₽ в ячейках</span>
                  </label>
                </div>
              </div>

              {/* Колонки */}
              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <Table2 size={13} /> Колонки таблицы
                </span>
                <div className="pr-settings__cols">
                  {(Object.keys(COLUMN_LABELS) as (keyof PrintColumns)[]).map(
                    (key) => (
                      <label className="pr-check" key={key}>
                        <input
                          type="checkbox"
                          checked={settings.columns[key]}
                          onChange={() => toggleColumn(key)}
                        />
                        <span>{COLUMN_LABELS[key]}</span>
                      </label>
                    )
                  )}
                </div>
              </div>

              {/* Блоки листа */}
              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <LayoutGrid size={13} /> Блоки листа
                </span>
                <div className="pr-settings__cols">
                  {(
                    [
                      ["showHeader", "Шапка (организация, период)"],
                      ["showPeriod", "Период в шапке"],
                      ["showGenDate", "Дата формирования"],
                      ["showCards", "Плашки с итогами"],
                      ["showPositions", "Таблица позиций"],
                      ["showTotals", "Строка «ИТОГО»"],
                      ["showDetails", "Расшифровка продаж"],
                      ["showSku", "Артикул под названием"],
                      ["showAbc", "ABC-анализ по выгоде"],
                      ["showSignature", "Подпись"],
                      ["showFooter", "Сноска внизу листа"],
                    ] as [keyof PrintSettings, string][]
                  ).map(([key, label]) => (
                    <label className="pr-check" key={String(key)}>
                      <input
                        type="checkbox"
                        checked={Boolean(settings[key])}
                        onChange={(e) =>
                          changeSetting({
                            [key]: e.target.checked,
                          } as Partial<PrintSettings>)
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <label className="pr-field">
                  <span className="pr-field__label">
                    Свой текст сноски (пусто — «Расчёт сформирован
                    автоматически…»)
                  </span>
                  <input
                    className="admin-input"
                    placeholder="например: СибГофроТорг · внутренний документ"
                    value={settings.footerText}
                    onChange={(e) =>
                      changeSetting({ footerText: e.target.value })
                    }
                  />
                </label>
              </div>

              <div className="pr-settings__group">
                <span className="pr-settings__label">
                  <ZoomIn size={13} /> Масштаб превью
                </span>
                <div className="pr-chips">
                  {(["auto", 1, 0.85, 0.7, 0.5] as ("auto" | number)[]).map(
                    (z) => (
                      <button
                        key={String(z)}
                        type="button"
                        className={`pr-chip${
                          zoomMode === z ? " pr-chip--on" : ""
                        }`}
                        onClick={() => setZoomMode(z)}
                      >
                        {z === "auto" ? "По ширине" : `${Math.round(z * 100)}%`}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
          )}

          {pickerOpen && (
            <div className="pr-picker">
              <div className="pr-picker__search">
                <Search size={16} />
                <input
                  className="admin-input"
                  placeholder="Поиск товара по названию или артикулу…"
                  value={search}
                  autoFocus
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  type="button"
                  className="admin-btn admin-btn--icon admin-btn--ghost"
                  onClick={() => setPickerOpen(false)}
                  aria-label="Закрыть"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="pr-picker__list">
                {filteredProducts.length === 0 && (
                  <div className="pr-picker__empty">Ничего не найдено</div>
                )}
                {filteredProducts.map((p) => {
                  const soldQty = p.sales
                    .filter((s) => {
                      if (meta.completedOnly && s.status !== "completed")
                        return false;
                      if (meta.periodFrom && s.date < meta.periodFrom)
                        return false;
                      if (meta.periodTo && s.date > meta.periodTo) return false;
                      return true;
                    })
                    .reduce((a, s) => a + s.qty, 0);
                  const added = addedIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`pr-picker__item${added ? " pr-picker__item--added" : ""}`}
                      onClick={() => addProduct(p)}
                      disabled={added}
                    >
                      <span className="pr-picker__name">
                        {p.name}
                        {p.sku ? (
                          <span className="pr-picker__sku"> · {p.sku}</span>
                        ) : null}
                      </span>
                      <span className="pr-picker__meta">
                        {soldQty > 0 ? (
                          <span className="pr-picker__sold">
                            продано {fmtNum(soldQty)} шт
                          </span>
                        ) : (
                          <span className="pr-picker__nosold">нет продаж</span>
                        )}
                        {added ? <span className="pr-picker__tag">добавлен</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="pr-hint">
            <Info size={13} /> Цена производства (Мы) и цена конкурента задаются
            один раз на позицию. «Проданное количество» и продажи (кому/когда)
            подтягиваются из учёта за период. Любую сумму, включая итоги, можно
            переопределить вручную — рядом появится кнопка «↺», чтобы вернуть
            расчётное значение.
          </p>
        </div>
      </div>

      {/* ── Редактор (интерактивная таблица) ── */}
      {hasPositions ? (
        <div className="admin-card no-print">
          <div className="admin-card__pad">
            <div className="pr-table-scroll">
              <table
                  className="pr-edit-table"
                  style={{ minWidth: `${editPlan.totalPx}px` }}
                >
                  <colgroup>
                    {editPlan.cols.map((c) => (
                      <col key={c.key} style={{ width: `${c.pct}%` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      {editPlan.cols.map((c) => (
                        <th key={c.key} className={c.cls}>
                          {c.lines.map((line, li) => (
                            <Fragment key={line}>
                              {li > 0 ? <br /> : null}
                              {line}
                            </Fragment>
                          ))}
                        </th>
                      ))}
                    </tr>
                </thead>
                <tbody>
                  {positions.map((p, idx) => {
                    const c = calcs[idx];
                    return (
                      <PositionRows
                        key={p.id}
                        p={p}
                        c={c}
                        OvInput={OvInput}
                        updatePos={updatePos}
                        removePos={removePos}
                        addSale={addSale}
                        updateSale={updateSale}
                        removeSale={removeSale}
                      />
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="pr-total-row">
                    <td className="pr-col-name">ИТОГО</td>
                    <td>
                      <GovInput field="qty" computed={totals.qty} />
                    </td>
                    <td className="pr-dim">—</td>
                    <td>
                      <GovInput field="revenue" computed={totals.revenue} />
                    </td>
                    <td className="pr-dim">—</td>
                    <td>
                      <GovInput field="ourCost" computed={totals.ourCost} />
                    </td>
                    <td className="pr-dim">—</td>
                    <td>
                      <GovInput
                        field="competitorCost"
                        computed={totals.competitorCost}
                      />
                    </td>
                    <td>
                      <GovInput
                        field="ourProfit"
                        computed={totals.ourProfit}
                        tone="profit"
                      />
                    </td>
                    <td>
                      <GovInput
                        field="competitorProfit"
                        computed={totals.competitorProfit}
                      />
                    </td>
                    <td>
                      <GovInput
                        field="benefit"
                        computed={totals.benefit}
                        tone="benefit"
                      />
                    </td>
                    <td className="pr-col-act" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="admin-card no-print">
          <div className="admin-card__pad">
            <div className="admin-empty">
              <Calculator size={26} />
              <p>
                Пока нет позиций. Нажмите «Добавить товар», чтобы выбрать товары
                из учёта, или «Своя позиция» для ручного ввода.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Печатный лист A4 (то же, что уходит в печать) ── */}
      {hasPositions && (
        <div className="admin-card pr-print-wrap">
          <div className="admin-card__pad">
            <div className="pr-settings-bar no-print" style={{ marginBottom: 12 }}>
              <span className="pr-settings__hint">
                {settings.reportMode === "director"
                  ? `Развёрнутый отчёт · листов ${directorPageCount} · ${
                      ORIENTATION_LABELS[settings.orientation]
                    } · ${DENSITY_LABELS[settings.density]}`
                  : `Лист A4 · ${ORIENTATION_LABELS[settings.orientation]} · ${
                      VARIANT_LABELS[settings.variant]
                    } · ${DENSITY_LABELS[settings.density]} · ${
                      LAYOUT_LABELS[settings.layout]
                    }`}
                {settings.mono ? " · ч/б" : ""}
              </span>
              <div className="pr-actions__spacer" />
              <div className="pr-chips pr-zoom no-print">
                <ZoomIn size={14} />
                {(["auto", 1, 0.85, 0.7, 0.5] as ("auto" | number)[]).map((z) => (
                  <button
                    key={String(z)}
                    type="button"
                    className={`pr-chip${zoomMode === z ? " pr-chip--on" : ""}`}
                    onClick={() => setZoomMode(z)}
                  >
                    {z === "auto" ? "По ширине" : `${Math.round(z * 100)}%`}
                  </button>
                ))}
              </div>
            </div>
            <div className="pr-a4-stage" ref={stageRef}>
              <div
                className="pr-print-area"
                style={{ display: "inline-block", zoom: previewZoom }}
              >
                {settings.reportMode === "director" ? (
                  <DirectorReport
                    meta={meta}
                    positions={positions}
                    calcs={calcs}
                    totals={totals}
                    settings={settings}
                  />
                ) : (
                  <div className="pr-a4-sheet">
                    <PrintSheet
                      meta={meta}
                      positions={positions}
                      calcs={calcs}
                      totals={totals}
                      settings={settings}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Строки одной позиции в редакторе (основная + детали продаж) ──
function PositionRows({
  p,
  c,
  OvInput,
  updatePos,
  removePos,
  addSale,
  updateSale,
  removeSale,
}: {
  p: Position;
  c: Calc;
  OvInput: (args: {
    pos: Position;
    field: OvField;
    computed: number;
    tone?: "profit" | "benefit";
  }) => React.JSX.Element;
  updatePos: (id: string, patch: Partial<Position>) => void;
  removePos: (id: string) => void;
  addSale: (posId: string) => void;
  updateSale: (
    posId: string,
    saleId: string,
    patch: Partial<PositionSale>
  ) => void;
  removeSale: (posId: string, saleId: string) => void;
}) {
  return (
    <>
      <tr className="pr-pos-row">
        <td className="pr-col-name">
          <div className="pr-name-cell">
            <button
              type="button"
              className="pr-expand"
              onClick={() => updatePos(p.id, { expanded: !p.expanded })}
              title={p.expanded ? "Свернуть продажи" : "Показать продажи"}
            >
              {p.expanded ? (
                <ChevronDown size={15} />
              ) : (
                <ChevronRight size={15} />
              )}
            </button>
            <input
              className="pr-name-input"
              value={p.name}
              placeholder="Название товара"
              title={p.name}
              onChange={(e) => updatePos(p.id, { name: e.target.value })}
            />
          </div>
          {p.sales.length > 0 && (
            <span className="pr-sales-badge">
              {p.sales.length} прод.
            </span>
          )}
        </td>
        <td>
          <OvInput pos={p} field="qty" computed={c.qty} />
        </td>
        <td>
          <input
            className="pr-num"
            inputMode="decimal"
            value={String(p.salePrice)}
            onChange={(e) =>
              updatePos(p.id, { salePrice: parseNum(e.target.value) })
            }
          />
        </td>
        <td>
          <OvInput pos={p} field="revenue" computed={c.revenue} />
        </td>
        <td className="pr-td-us">
          <input
            className="pr-num"
            inputMode="decimal"
            value={String(p.productionCost)}
            onChange={(e) =>
              updatePos(p.id, { productionCost: parseNum(e.target.value) })
            }
          />
        </td>
        <td className="pr-td-us">
          <OvInput pos={p} field="ourCost" computed={c.ourCost} />
        </td>
        <td className="pr-td-comp">
          <input
            className="pr-num"
            inputMode="decimal"
            value={String(p.competitorPrice)}
            onChange={(e) =>
              updatePos(p.id, { competitorPrice: parseNum(e.target.value) })
            }
          />
        </td>
        <td className="pr-td-comp">
          <OvInput pos={p} field="competitorCost" computed={c.competitorCost} />
        </td>
        <td className="pr-td-profit">
          <OvInput pos={p} field="ourProfit" computed={c.ourProfit} tone="profit" />
        </td>
        <td className="pr-td-profit">
          <OvInput
            pos={p}
            field="competitorProfit"
            computed={c.competitorProfit}
          />
        </td>
        <td className="pr-td-benefit">
          <OvInput pos={p} field="benefit" computed={c.benefit} tone="benefit" />
        </td>
        <td className="pr-col-act">
          <button
            type="button"
            className="pr-row-del"
            onClick={() => removePos(p.id)}
            title="Удалить позицию"
          >
            <X size={15} />
          </button>
        </td>
      </tr>

      {p.expanded && (
        <tr className="pr-detail-row">
          <td colSpan={12}>
            <div className="pr-detail">
              <div className="pr-detail__head">
                <span>Продажи (кому · когда · сколько · по какой цене)</span>
                <button
                  type="button"
                  className="admin-btn admin-btn--sm admin-btn--ghost"
                  onClick={() => addSale(p.id)}
                >
                  <Plus size={13} /> Добавить продажу
                </button>
              </div>
              {p.sales.length === 0 ? (
                <p className="pr-detail__empty">
                  Продаж нет. Добавьте вручную или подтяните из учёта. Если
                  оставить пусто — количество можно ввести прямо в колонке
                  «Кол-во».
                </p>
              ) : (
                <table className="pr-detail-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Клиент</th>
                      <th>Кол-во</th>
                      <th>Цена</th>
                      <th>Сумма</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.sales.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <input
                            type="date"
                            className="pr-num pr-date"
                            value={s.date}
                            onChange={(e) =>
                              updateSale(p.id, s.id, { date: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="pr-cust"
                            value={s.customer}
                            placeholder="Кому"
                            onChange={(e) =>
                              updateSale(p.id, s.id, {
                                customer: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="pr-num pr-num--narrow"
                            inputMode="decimal"
                            value={String(s.qty)}
                            onChange={(e) =>
                              updateSale(p.id, s.id, {
                                qty: parseNum(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="pr-num pr-num--narrow"
                            inputMode="decimal"
                            value={String(s.price)}
                            onChange={(e) =>
                              updateSale(p.id, s.id, {
                                price: parseNum(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td className="pr-detail-sum">
                          {fmtMoney(s.qty * s.price)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="pr-row-del"
                            onClick={() => removeSale(p.id, s.id)}
                            title="Удалить продажу"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
const UI_CSS = `
.pr-root { display: flex; flex-direction: column; gap: 16px; }

.pr-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.pr-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 220px; min-width: 160px; }
.pr-field--sm { flex: 0 0 150px; min-width: 120px; }
.pr-field__label { font-size: 12px; font-weight: 600; color: var(--adm-muted, #64748b); }
.pr-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.pr-check input { width: 16px; height: 16px; }

.pr-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pr-actions__spacer { flex: 1 1 auto; }

.pr-hint {
  display: flex; gap: 6px; align-items: flex-start;
  font-size: 12px; color: var(--adm-muted, #64748b);
  background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.18);
  border-radius: 8px; padding: 8px 10px; margin: 0;
}
.pr-hint svg { flex: 0 0 auto; margin-top: 2px; }

/* ── Пикер ── */
.pr-picker { border: 1px solid var(--adm-border, #e2e8f0); border-radius: 10px; overflow: hidden; }
.pr-picker__search { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--adm-border, #e2e8f0); }
.pr-picker__search svg { flex: 0 0 auto; color: var(--adm-muted, #94a3b8); }
.pr-picker__list { max-height: 320px; overflow-y: auto; }
.pr-picker__item {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  width: 100%; text-align: left; padding: 9px 12px; background: none; border: none;
  border-bottom: 1px solid var(--adm-border, #f1f5f9); cursor: pointer; font-size: 13px;
}
.pr-picker__item:hover:not(:disabled) { background: rgba(59,130,246,0.06); }
.pr-picker__item--added { opacity: 0.55; cursor: default; }
.pr-picker__name { font-weight: 500; }
.pr-picker__sku { color: var(--adm-muted, #94a3b8); font-weight: 400; }
.pr-picker__meta { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; font-size: 12px; }
.pr-picker__sold { color: #16a34a; font-weight: 600; }
.pr-picker__nosold { color: var(--adm-muted, #94a3b8); }
.pr-picker__tag { background: #e0e7ff; color: #4338ca; border-radius: 6px; padding: 1px 6px; font-size: 11px; }
.pr-picker__empty { padding: 16px; text-align: center; color: var(--adm-muted, #94a3b8); font-size: 13px; }

/* ── Таблица-редактор ── */
.pr-table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.pr-edit-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1100px; table-layout: fixed; }
.pr-edit-table th, .pr-edit-table td { border: 1px solid var(--adm-border, #e2e8f0); padding: 4px 5px; text-align: center; vertical-align: middle; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; }
.pr-edit-table thead th { background: var(--adm-soft, #f8fafc); font-weight: 600; font-size: 11px; color: var(--adm-fg, #334155); position: sticky; top: 0; z-index: 2; line-height: 1.25; text-align: center; white-space: normal; word-break: normal; overflow-wrap: break-word; hyphens: none; }
.pr-th-us { background: rgba(37,99,235,0.08) !important; }
.pr-th-comp { background: rgba(217,119,6,0.09) !important; }
.pr-th-profit { background: rgba(22,163,74,0.09) !important; }
.pr-th-benefit { background: rgba(147,51,234,0.10) !important; }
.pr-td-us { background: rgba(37,99,235,0.03); }
.pr-td-comp { background: rgba(217,119,6,0.04); }
.pr-td-profit { background: rgba(22,163,74,0.04); }
.pr-td-benefit { background: rgba(147,51,234,0.05); }
.pr-col-name { text-align: left !important; min-width: 180px; overflow: hidden; }
.pr-col-act { width: 34px; text-align: center !important; }
.pr-dim { color: var(--adm-muted, #cbd5e1); }

.pr-name-cell { display: flex; align-items: center; gap: 4px; min-width: 0; }
.pr-name-input { width: 100%; min-width: 0; border: none; background: transparent; font-size: 12px; font-weight: 500; padding: 2px 4px; border-radius: 4px; text-overflow: ellipsis; }
.pr-name-input:focus { outline: 2px solid rgba(59,130,246,0.4); background: #fff; }
.pr-expand { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: none; cursor: pointer; color: var(--adm-muted, #64748b); border-radius: 4px; }
.pr-expand:hover { background: rgba(0,0,0,0.05); }
.pr-sales-badge { display: inline-block; margin-left: 24px; font-size: 10px; color: var(--adm-muted, #94a3b8); }

.pr-num { width: 100%; min-width: 0; border: 1px solid transparent; background: transparent; text-align: right; font-size: 12px; padding: 3px 4px; border-radius: 4px; font-variant-numeric: tabular-nums; box-sizing: border-box; }
.pr-num:hover { border-color: var(--adm-border, #e2e8f0); }
.pr-num:focus { outline: none; border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
.pr-num--narrow { min-width: 0; }
.pr-num--bold { font-weight: 700; }
.pr-root.pr-align-num--center .pr-num { text-align: center; }
.pr-root.pr-align-name--center .pr-name-input { text-align: center; }
.pr-num--profit { color: #15803d; font-weight: 600; }
.pr-num--benefit { color: #7c3aed; font-weight: 600; }

.pr-ovcell { display: flex; align-items: center; justify-content: flex-end; gap: 2px; width: 100%; min-width: 0; position: relative; }
.pr-ovcell .pr-num { flex: 1 1 auto; min-width: 0; }
.pr-ovcell--ov .pr-num { background: rgba(250,204,21,0.15); border-color: rgba(202,138,4,0.5); }
.pr-reset { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: none; background: none; color: #ca8a04; cursor: pointer; border-radius: 3px; }
.pr-reset:hover { background: rgba(202,138,4,0.15); }

.pr-row-del { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: #dc2626; cursor: pointer; border-radius: 4px; }
.pr-row-del:hover { background: rgba(220,38,38,0.1); }

.pr-total-row td { background: var(--adm-soft, #f1f5f9); font-weight: 700; }

/* Детали продаж в редакторе */
.pr-detail-row td { background: #fbfcfe; padding: 0 !important; }
.pr-detail { padding: 10px 14px 14px 36px; }
.pr-detail__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--adm-muted, #475569); }
.pr-detail__empty { font-size: 12px; color: var(--adm-muted, #94a3b8); margin: 0; }
.pr-detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pr-detail-table th, .pr-detail-table td { border: 1px solid var(--adm-border, #e2e8f0); padding: 3px 6px; }
.pr-detail-table th { background: #fff; font-weight: 600; font-size: 11px; color: var(--adm-muted, #64748b); }
.pr-date { min-width: 110px; text-align: left; }
.pr-cust { width: 100%; min-width: 120px; border: 1px solid transparent; background: transparent; font-size: 12px; padding: 3px 5px; border-radius: 5px; }
.pr-cust:hover { border-color: var(--adm-border, #e2e8f0); }
.pr-cust:focus { outline: none; border-color: #3b82f6; background: #fff; }
.pr-detail-sum { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ── Настройки печати ── */
.pr-settings-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pr-settings-toggle {
  display: inline-flex; align-items: center; gap: 8px; padding: 7px 11px;
  border: 1px solid var(--adm-border, #e2e8f0); border-radius: 9px;
  background: var(--adm-soft, #f8fafc); cursor: pointer; font-size: 13px; font-weight: 600;
  color: var(--adm-fg, #334155);
}
.pr-settings-toggle:hover { border-color: #93c5fd; background: #f0f7ff; }
.pr-settings-toggle__sum { font-weight: 500; font-size: 12px; color: var(--adm-muted, #64748b); }
.pr-settings { display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--adm-border, #e2e8f0); border-radius: 10px; padding: 12px; background: #fcfdff; }
.pr-settings__group { display: flex; flex-direction: column; gap: 6px; }
.pr-settings__label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--adm-muted, #475569); text-transform: uppercase; letter-spacing: 0.2px; }
.pr-settings__row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pr-settings__hint { margin: 0; font-size: 12px; color: var(--adm-muted, #64748b); }
.pr-settings__cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px 12px; }
.pr-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pr-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; font-size: 12px;
  border: 1px solid var(--adm-border, #e2e8f0); border-radius: 999px; background: #fff;
  color: var(--adm-fg, #334155); cursor: pointer; line-height: 1.2;
}
.pr-chip:hover { border-color: #93c5fd; }
.pr-chip--on { background: #1d4ed8; border-color: #1d4ed8; color: #fff; font-weight: 600; }
.pr-chip--on:hover { border-color: #1d4ed8; }
.pr-chip--ghost { background: transparent; }
.pr-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; border: 1px solid rgba(0,0,0,0.18); flex: 0 0 auto; }
.pr-scale { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--adm-muted, #475569); }
.pr-scale input[type="range"] { width: 160px; }
.pr-zoom { display: inline-flex; align-items: center; gap: 6px; }
`;
