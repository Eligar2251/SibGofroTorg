// =========================================================
// FILE: src/components/admin/PriceListClient.tsx
// Конструктор прайс-листа (админка → «Прайс-лист по объёмам»).
//
// Порядок работы — как в задаче:
//   1. Выбрать товары (поиск, категория, галочки).
//   2. Проверить закупочную цену — она подставляется из карточки товара,
//      но каждую строку можно переписать своей.
//   3. Обычная цена считается как закупка + 30% (наценка настраивается);
//      дальше идут столбцы объёмов: до 100, 100–500, 500–1000, от 1000 шт.
//      Чем больше объём — тем ниже цена. Скидку каждого столбца можно
//      менять (и задавать накруткой к закупке — значения связаны).
//   4. Оформление: шрифт, размеры, поля, ориентация, рамки, заливка.
//   5. Печать на А4 или «Сохранить как PDF» через окно печати.
//
// Любую посчитанную цену можно поправить вручную — она подсвечивается
// янтарным и не пересчитывается при изменении настроек. Ручные правки,
// выбор товаров и оформление запоминаются в localStorage.
//
// Все формулы — в src/lib/price-list.ts (там же тесты).
// =========================================================

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  Loader2,
  Printer,
  RotateCcw,
  Save,
  Search,
  X,
} from "lucide-react";
import { useWindowedList } from "@/hooks/use-windowed-list";
import { adminErrorText, adminFetch } from "@/lib/admin-fetch";
import { ROUNDING_MODES, type RoundingMode } from "@/lib/price-calc";
import {
  DEFAULT_BASE_MARKUP,
  DEFAULT_PRICE_TIERS,
  computePriceListRow,
  discountForMarkup,
  formatMoney,
  markupForDiscount,
  moneyInputValue,
  normalizeMarkup,
  sanitizePriceTiers,
  tierFrom,
  tierLabel,
  toPrice,
  type PriceListRowResult,
  type PriceTierConfig,
} from "@/lib/price-list";
import {
  PriceListSheet,
  type PriceListSheetRow,
  type PriceListSheetSettings,
  type PriceListOrientation,
} from "./PriceListSheet";
import "./PriceList.css";

// ── Данные, которые приходят со страницы ───────────────────

export type PriceListProduct = {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** Цена на сайте (для подсказки в каталоге). */
  price: number | null;
  /** Закупочная цена из карточки товара. */
  purchasePrice: number | null;
  size: string | null;
  packQty: number | null;
  stockQty: number | null;
  isVisible: boolean;
};

export type PriceListCompany = {
  name: string;
  contacts: string;
};

// ── Настройки листа ────────────────────────────────────────

type Margins = { top: number; right: number; bottom: number; left: number };

type PriceListSettings = {
  title: string;
  subtitle: string;
  company: string;
  contacts: string;
  note: string;
  baseMarkup: number;
  tiers: PriceTierConfig[];
  rounding: RoundingMode;
  orientation: PriceListOrientation;
  fontFamily: string;
  titleSize: number;
  companySize: number;
  headerSize: number;
  bodySize: number;
  rowPadding: number;
  lineWidth: number;
  borders: boolean;
  zebra: boolean;
  headerFill: boolean;
  headerBg: string;
  titleBold: boolean;
  headerBold: boolean;
  priceBold: boolean;
  showDate: boolean;
  showSku: boolean;
  showSize: boolean;
  showPack: boolean;
  showPurchase: boolean;
  showRegular: boolean;
  groupByCategory: boolean;
  margins: Margins;
};

type ProductEdits = {
  /** Введённая вручную закупка (строка — чтобы не мешать набору). */
  purchase?: string;
  /** Введённая вручную обычная цена. */
  base?: string;
  /** Введённые вручную цены столбцов: id столбца → строка. */
  tiers?: Record<string, string>;
};

type EditsMap = Record<string, ProductEdits>;

type StoredState = {
  version: 1;
  settings: PriceListSettings;
  selectedIds: string[];
  edits: EditsMap;
};

const STORAGE_KEY = "price-list:v1";

const FONTS = [
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "Inter, sans-serif", label: "Inter" },
  { value: "Montserrat, sans-serif", label: "Montserrat" },
  { value: "Oswald, sans-serif", label: "Oswald" },
] as const;

const DEFAULT_NOTE =
  "Цены указаны в рублях за единицу продукции. Наличие и сроки изготовления уточняйте у менеджера.";

const CATEGORY_NONE = "__none__";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function defaultSettings(company: PriceListCompany): PriceListSettings {
  return {
    title: "ПРАЙС-ЛИСТ",
    subtitle: "Оптовые цены на гофроупаковку",
    company: company.name,
    contacts: company.contacts,
    note: DEFAULT_NOTE,
    baseMarkup: DEFAULT_BASE_MARKUP,
    tiers: DEFAULT_PRICE_TIERS.map((tier) => ({ ...tier })),
    rounding: "ruble",
    orientation: "portrait",
    fontFamily: FONTS[0].value,
    titleSize: 20,
    companySize: 13,
    headerSize: 8,
    bodySize: 9,
    rowPadding: 1.2,
    lineWidth: 0.75,
    borders: true,
    zebra: false,
    headerFill: true,
    headerBg: "#f1efe8",
    titleBold: true,
    headerBold: true,
    priceBold: true,
    showDate: true,
    showSku: false,
    showSize: true,
    showPack: false,
    showPurchase: false,
    showRegular: true,
    groupByCategory: true,
    margins: { top: 12, right: 10, bottom: 12, left: 10 },
  };
}

// ── Безопасное чтение настроек из localStorage ─────────────

function readText(value: unknown, fallback: string, maxLength = 600): string {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

function sanitizeSettings(raw: unknown, company: PriceListCompany): PriceListSettings {
  const defaults = defaultSettings(company);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const source = raw as Record<string, unknown>;

  const rounding = ROUNDING_MODES.some((mode) => mode.value === source.rounding)
    ? (source.rounding as RoundingMode)
    : defaults.rounding;

  const fontFamily = FONTS.some((font) => font.value === source.fontFamily)
    ? (source.fontFamily as string)
    : defaults.fontFamily;

  const orientation: PriceListOrientation =
    source.orientation === "landscape"
      ? "landscape"
      : source.orientation === "portrait"
        ? "portrait"
        : defaults.orientation;

  const rawMargins =
    source.margins && typeof source.margins === "object"
      ? (source.margins as Record<string, unknown>)
      : {};

  return {
    title: readText(source.title, defaults.title, 120),
    subtitle: readText(source.subtitle, defaults.subtitle, 200),
    company: readText(source.company, defaults.company, 200),
    contacts: readText(source.contacts, defaults.contacts, 400),
    note: readText(source.note, defaults.note, 1200),
    baseMarkup: normalizeMarkup(source.baseMarkup ?? defaults.baseMarkup),
    tiers: sanitizePriceTiers(source.tiers),
    rounding,
    orientation,
    fontFamily,
    titleSize: readNumber(source.titleSize, defaults.titleSize, 8, 60),
    companySize: readNumber(source.companySize, defaults.companySize, 6, 40),
    headerSize: readNumber(source.headerSize, defaults.headerSize, 5, 24),
    bodySize: readNumber(source.bodySize, defaults.bodySize, 5, 24),
    rowPadding: readNumber(source.rowPadding, defaults.rowPadding, 0.2, 6),
    lineWidth: readNumber(source.lineWidth, defaults.lineWidth, 0.2, 3),
    borders: readBool(source.borders, defaults.borders),
    zebra: readBool(source.zebra, defaults.zebra),
    headerFill: readBool(source.headerFill, defaults.headerFill),
    headerBg:
      typeof source.headerBg === "string" && /^#[0-9a-f]{6}$/i.test(source.headerBg)
        ? source.headerBg
        : defaults.headerBg,
    titleBold: readBool(source.titleBold, defaults.titleBold),
    headerBold: readBool(source.headerBold, defaults.headerBold),
    priceBold: readBool(source.priceBold, defaults.priceBold),
    showDate: readBool(source.showDate, defaults.showDate),
    showSku: readBool(source.showSku, defaults.showSku),
    showSize: readBool(source.showSize, defaults.showSize),
    showPack: readBool(source.showPack, defaults.showPack),
    showPurchase: readBool(source.showPurchase, defaults.showPurchase),
    showRegular: readBool(source.showRegular, defaults.showRegular),
    groupByCategory: readBool(source.groupByCategory, defaults.groupByCategory),
    margins: {
      top: readNumber(rawMargins.top, defaults.margins.top, 0, 50),
      right: readNumber(rawMargins.right, defaults.margins.right, 0, 50),
      bottom: readNumber(rawMargins.bottom, defaults.margins.bottom, 0, 50),
      left: readNumber(rawMargins.left, defaults.margins.left, 0, 50),
    },
  };
}

function sanitizeEdits(
  raw: unknown,
  productIds: Set<string>,
  tierIds: Set<string>
): EditsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: EditsMap = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!productIds.has(id) || !value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const source = value as Record<string, unknown>;
    const entry: ProductEdits = {};
    if (typeof source.purchase === "string") entry.purchase = source.purchase.slice(0, 32);
    if (typeof source.base === "string") entry.base = source.base.slice(0, 32);
    if (source.tiers && typeof source.tiers === "object" && !Array.isArray(source.tiers)) {
      const tiers: Record<string, string> = {};
      for (const [tierId, tierValue] of Object.entries(
        source.tiers as Record<string, unknown>
      )) {
        if (tierIds.has(tierId) && typeof tierValue === "string") {
          tiers[tierId] = tierValue.slice(0, 32);
        }
      }
      if (Object.keys(tiers).length > 0) entry.tiers = tiers;
    }
    if (entry.purchase !== undefined || entry.base !== undefined || entry.tiers) {
      result[id] = entry;
    }
  }
  return result;
}

function loadStored(
  company: PriceListCompany,
  products: readonly PriceListProduct[]
): StoredState | null {
  if (typeof window === "undefined") return null;
  let parsed: unknown;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;

  const settings = sanitizeSettings(source.settings, company);
  const productIds = new Set(products.map((product) => product.id));
  const selectedIds = Array.isArray(source.selectedIds)
    ? Array.from(
        new Set(
          source.selectedIds.filter(
            (id): id is string => typeof id === "string" && productIds.has(id)
          )
        )
      )
    : [];
  const tierIds = new Set(settings.tiers.map((tier) => tier.id));
  const edits = sanitizeEdits(source.edits, productIds, tierIds);

  return { version: 1, settings, selectedIds, edits };
}

/** Дата для шапки: 18.10.2026. */
function todayLabel(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
}

function percentText(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

// ── Мелкие переиспользуемые поля ───────────────────────────

/**
 * Числовое поле с локальным черновиком: пока пользователь печатает,
 * внешнее значение не «дёргает» курсор (иначе «3,5» превращалось бы
 * в «3» после первой запятой). На blur значение приводится к min/max.
 */
function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  className = "",
  ariaLabel,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  ariaLabel?: string;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(() => String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  return (
    <span className="pl-inline">
      <input
        type="text"
        inputMode="decimal"
        className={`admin-input ${className}`.trim()}
        value={draft}
        step={step}
        aria-label={ariaLabel}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const normalized = raw.replace(",", ".").trim();
          if (normalized === "") return;
          const n = Number(normalized);
          if (Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => {
          setFocused(false);
          const normalized = draft.replace(",", ".").trim();
          const n = normalized === "" ? value : Number(normalized);
          const next = Number.isFinite(n) ? clamp(n, min, max) : value;
          onChange(next);
          setDraft(String(next));
        }}
      />
      {suffix && <span className="pl-suffix">{suffix}</span>}
    </span>
  );
}

/** Ячейка цены: редактируемая, с отметкой «ручная» и сбросом. */
function PriceCell({
  value,
  manual,
  invalid,
  placeholder,
  ariaLabel,
  onChange,
  onReset,
}: {
  value: string;
  manual: boolean;
  invalid: boolean;
  placeholder?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <span
      className={`pl-cell${manual ? " pl-cell--manual" : ""}${
        invalid ? " pl-cell--invalid" : ""
      }`}
      title={
        invalid
          ? "Введите цену числом (0 или больше)"
          : manual
            ? "Цена изменена вручную — пересчёт её больше не меняет"
            : undefined
      }
    >
      <input
        type="text"
        inputMode="decimal"
        className="admin-input"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {manual && <span className="pl-cell__badge" aria-hidden="true" />}
      {manual && (
        <button
          type="button"
          className="pl-cell__reset"
          onClick={onReset}
          title="Вернуть автоматический расчёт"
          aria-label="Вернуть автоматический расчёт"
        >
          <RotateCcw size={11} />
        </button>
      )}
    </span>
  );
}

// ── Основной компонент ─────────────────────────────────────

type EditorEntry =
  | { kind: "group"; label: string }
  | { kind: "row"; product: PriceListProduct; number: number };

export function PriceListClient({
  products,
  categories,
  company,
}: {
  products: PriceListProduct[];
  categories: { id: string; name: string }[];
  company: PriceListCompany;
}) {
  const [settings, setSettings] = useState<PriceListSettings>(() =>
    defaultSettings(company)
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [edits, setEdits] = useState<EditsMap>({});
  const [loaded, setLoaded] = useState(false);
  const [dateText, setDateText] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [onlyWithoutPurchase, setOnlyWithoutPurchase] = useState(false);
  const [status, setStatus] = useState<{
    kind: "ok" | "err" | "warn";
    text: string;
  } | null>(null);
  const [savingDb, setSavingDb] = useState(false);
  /** Закупки, только что сохранённые в карточки: обновляем без перезагрузки. */
  const [dbPurchases, setDbPurchases] = useState<Record<string, number>>({});

  const didLoad = useRef(false);

  // Настройки и выбор из прошлого раза.
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    const stored = loadStored(company, products);
    if (stored) {
      setSettings(stored.settings);
      setSelectedIds(stored.selectedIds);
      setEdits(stored.edits);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Сегодняшняя дата для шапки (не запоминаем: прайс всегда «от сегодня»).
  useEffect(() => {
    setDateText(`от ${todayLabel()}`);
  }, []);

  // Запоминаем всё, что пользователь настроил (с небольшой задержкой).
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      try {
        const state: StoredState = {
          version: 1,
          settings,
          selectedIds,
          edits,
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* localStorage может быть недоступен (приватный режим) — не мешаем работе */
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loaded, settings, selectedIds, edits]);

  // Сообщение о сохранении закупок исчезает само.
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 7000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );

  const categoryIndex = useMemo(() => {
    const map = new Map<string, number>();
    categories.forEach((category, index) => map.set(category.id, index));
    return map;
  }, [categories]);

  /**
   * Закупка по каждому товару: ручная правка → сохранённая в этой сессии →
   * значение из базы. Считаем один раз, чтобы не пересчитывать на каждый
   * рендер и не плодить зависимости у useMemo.
   */
  const purchaseById = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const product of products) {
      const manual = edits[product.id]?.purchase;
      if (manual !== undefined) {
        map.set(product.id, toPrice(manual));
      } else if (product.id in dbPurchases) {
        map.set(product.id, dbPurchases[product.id]);
      } else {
        map.set(product.id, toPrice(product.purchasePrice));
      }
    }
    return map;
  }, [products, edits, dbPurchases]);

  const purchaseFor = useCallback(
    (product: PriceListProduct): number | null =>
      purchaseById.get(product.id) ?? null,
    [purchaseById]
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  /** Выбранные товары в порядке печати. */
  const selectedProducts = useMemo(() => {
    const list = selectedIds
      .map((id) => productById.get(id))
      .filter((product): product is PriceListProduct => Boolean(product));

    if (!settings.groupByCategory) {
      return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }

    return list.sort((a, b) => {
      const aIndex = a.categoryId ? categoryIndex.get(a.categoryId) ?? 9999 : 9999;
      const bIndex = b.categoryId ? categoryIndex.get(b.categoryId) ?? 9999 : 9999;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.name.localeCompare(b.name, "ru");
    });
  }, [selectedIds, productById, settings.groupByCategory, categoryIndex]);

  const activeTiers = useMemo(
    () => settings.tiers.filter((tier) => tier.enabled),
    [settings.tiers]
  );

  /** Посчитанные цены выбранных товаров. */
  const priceById = useMemo(() => {
    const map = new Map<string, PriceListRowResult>();
    for (const product of selectedProducts) {
      const entry = edits[product.id];
      const tierOverrides: Record<string, number | null> = {};
      if (entry?.tiers) {
        for (const [tierId, raw] of Object.entries(entry.tiers)) {
          tierOverrides[tierId] = toPrice(raw);
        }
      }
      map.set(
        product.id,
        computePriceListRow({
          purchase: purchaseFor(product),
          baseOverride: entry?.base !== undefined ? toPrice(entry.base) : null,
          tierOverrides,
          baseMarkup: settings.baseMarkup,
          rounding: settings.rounding,
          tiers: settings.tiers,
        })
      );
    }
    return map;
  }, [selectedProducts, edits, purchaseFor, settings]);

  /** Строки для листа печати. */
  const printRows = useMemo<PriceListSheetRow[]>(() => {
    return selectedProducts.map((product) => {
      const price = priceById.get(product.id);
      const tierPrices: Record<string, number | null> = {};
      for (const tier of activeTiers) {
        tierPrices[tier.id] = price?.tiers[tier.id] ?? null;
      }
      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        size: product.size,
        packQty: product.packQty,
        categoryName: product.categoryName,
        purchase: purchaseFor(product),
        base: price?.base ?? null,
        tierPrices,
      };
    });
  }, [selectedProducts, priceById, activeTiers, purchaseFor]);

  /** Строки редактора: те же группы категорий, что и на печати. */
  const editorEntries = useMemo<EditorEntry[]>(() => {
    if (!settings.groupByCategory) {
      return selectedProducts.map((product, index) => ({
        kind: "row" as const,
        product,
        number: index + 1,
      }));
    }
    const entries: EditorEntry[] = [];
    let currentGroup: string | null = null;
    let number = 0;
    for (const product of selectedProducts) {
      const label = product.categoryName?.trim() || "Без категории";
      if (label !== currentGroup) {
        currentGroup = label;
        entries.push({ kind: "group", label });
      }
      number += 1;
      entries.push({ kind: "row", product, number });
    }
    return entries;
  }, [selectedProducts, settings.groupByCategory]);

  // ── Каталог ──────────────────────────────────────────────

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const queryDigits = query.replace(/\s+/g, "");

    return products.filter((product) => {
      if (categoryFilter === CATEGORY_NONE) {
        if (product.categoryId) return false;
      } else if (categoryFilter !== "all" && product.categoryId !== categoryFilter) {
        return false;
      }

      if (onlyWithoutPurchase && purchaseFor(product) !== null) return false;

      if (!query) return true;
      if (product.name.toLowerCase().includes(query)) return true;
      if (product.sku && product.sku.toLowerCase().includes(query)) return true;
      if (queryDigits && product.sku && product.sku.toLowerCase().includes(queryDigits)) {
        return true;
      }
      return false;
    });
  }, [products, search, categoryFilter, onlyWithoutPurchase, purchaseFor]);

  const win = useWindowedList(filtered, {
    min: 60,
    step: 60,
    resetKey: `${search}|${categoryFilter}|${onlyWithoutPurchase}`,
  });

  const hasNoCategoryProducts = useMemo(
    () => products.some((product) => !product.categoryId),
    [products]
  );

  const selectedCount = selectedIds.length;
  const missingBaseCount = useMemo(
    () =>
      selectedProducts.filter(
        (product) => (priceById.get(product.id)?.base ?? null) === null
      ).length,
    [selectedProducts, priceById]
  );

  /** Ручные правки цен (обычная + столбцы) — их сбрасывает кнопка. */
  const manualPriceCount = useMemo(() => {
    let count = 0;
    for (const product of selectedProducts) {
      const entry = edits[product.id];
      if (!entry) continue;
      if (entry.base !== undefined) count += 1;
      if (entry.tiers) count += Object.keys(entry.tiers).length;
    }
    return count;
  }, [selectedProducts, edits]);

  /** Все ручные правки строк, включая закупку (для подписи внизу). */
  const manualCount = useMemo(() => {
    let count = 0;
    for (const product of selectedProducts) {
      const entry = edits[product.id];
      if (!entry) continue;
      if (entry.purchase !== undefined) count += 1;
      if (entry.base !== undefined) count += 1;
      if (entry.tiers) count += Object.keys(entry.tiers).length;
    }
    return count;
  }, [selectedProducts, edits]);

  /** Изменённые закупки, которые можно записать в карточки товаров. */
  const purchaseChanges = useMemo(() => {
    const rows: { id: string; name: string; value: number }[] = [];
    for (const product of selectedProducts) {
      const raw = edits[product.id]?.purchase;
      if (raw === undefined) continue;
      const value = toPrice(raw);
      if (value === null) continue;
      // Сравниваем с тем, что сейчас в базе: закупка, сохранённая в этой
      // сессии, уже не равна исходному значению из props.
      const current = product.id in dbPurchases
        ? dbPurchases[product.id]
        : product.purchasePrice;
      if (current !== null && Math.abs(current - value) < 0.005) continue;
      rows.push({ id: product.id, name: product.name, value });
    }
    return rows;
  }, [selectedProducts, edits, dbPurchases]);

  const example = useMemo(
    () =>
      computePriceListRow({
        purchase: 100,
        baseMarkup: settings.baseMarkup,
        rounding: settings.rounding,
        tiers: settings.tiers,
      }),
    [settings.baseMarkup, settings.rounding, settings.tiers]
  );

  // ── Действия ─────────────────────────────────────────────

  function updateSettings(patch: Partial<PriceListSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function toggleProduct(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  function selectAllFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      filtered.forEach((product) => next.add(product.id));
      return Array.from(next);
    });
  }

  function scrollToPrices() {
    document
      .getElementById("pl-prices")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * Точечная правка строки товара.
   *
   * Пустая строка — это тоже правка («цены нет»), а не «вернуть расчёт»:
   * иначе стереть поле и вписать новое число было бы невозможно — после
   * первого Backspace в поле возвращалось посчитанное значение. Вернуть
   * расчёт можно кнопкой ↺ (resetField / resetTierCell).
   */
  function patchEdits(
    id: string,
    patch: { purchase?: string; base?: string; tiers?: Record<string, string> }
  ) {
    setEdits((current) => {
      const previous = current[id] ?? {};
      const next: ProductEdits = { ...previous };

      if (patch.purchase !== undefined) next.purchase = patch.purchase;
      if (patch.base !== undefined) next.base = patch.base;
      if (patch.tiers) {
        next.tiers = { ...(previous.tiers ?? {}), ...patch.tiers };
      }

      return { ...current, [id]: next };
    });
  }

  /** Убрать ручную правку поля — вернуть расчёт/значение из базы. */
  function resetField(id: string, field: "purchase" | "base") {
    setEdits((current) => {
      const entry = current[id];
      if (!entry || entry[field] === undefined) return current;
      const next: ProductEdits = { ...entry };
      delete next[field];
      const result = { ...current };
      if (
        next.purchase === undefined &&
        next.base === undefined &&
        next.tiers === undefined
      ) {
        delete result[id];
      } else {
        result[id] = next;
      }
      return result;
    });
  }

  /** Сброс ручных цен строки: закупку не трогаем — это данные, а не цена. */
  function resetRow(id: string) {
    setEdits((current) => {
      const entry = current[id];
      if (!entry) return current;
      const next: ProductEdits = { ...entry };
      delete next.base;
      delete next.tiers;
      const result = { ...current };
      if (next.purchase === undefined) delete result[id];
      else result[id] = next;
      return result;
    });
  }

  function resetTierCell(id: string, tierId: string) {
    setEdits((current) => {
      const entry = current[id];
      if (!entry?.tiers?.[tierId]) return current;
      const tiers = { ...entry.tiers };
      delete tiers[tierId];
      const next: ProductEdits = { ...entry };
      if (Object.keys(tiers).length > 0) next.tiers = tiers;
      else delete next.tiers;
      const result = { ...current };
      if (
        next.purchase === undefined &&
        next.base === undefined &&
        next.tiers === undefined
      ) {
        delete result[id];
      } else {
        result[id] = next;
      }
      return result;
    });
  }

  function resetManualPrices() {
    const selected = new Set(selectedProducts.map((product) => product.id));
    setEdits((current) => {
      const next: EditsMap = { ...current };
      for (const id of selected) {
        const entry = next[id];
        if (!entry) continue;
        const copy: ProductEdits = { ...entry };
        delete copy.base;
        delete copy.tiers;
        if (copy.purchase !== undefined) next[id] = copy;
        else delete next[id];
      }
      return next;
    });
  }

  function resetEverything() {
    if (
      !window.confirm(
        "Сбросить выбранные товары, закупки, цены и оформление прайс-листа?"
      )
    ) {
      return;
    }
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setSettings(defaultSettings(company));
    setSelectedIds([]);
    setEdits({});
    setSearch("");
    setCategoryFilter("all");
    setOnlyWithoutPurchase(false);
    setDateText(`от ${todayLabel()}`);
    setStatus(null);
  }

  function resetDesign() {
    const defaults = defaultSettings(company);
    setSettings((current) => ({
      ...current,
      title: defaults.title,
      subtitle: defaults.subtitle,
      company: defaults.company,
      contacts: defaults.contacts,
      note: defaults.note,
      orientation: defaults.orientation,
      fontFamily: defaults.fontFamily,
      titleSize: defaults.titleSize,
      companySize: defaults.companySize,
      headerSize: defaults.headerSize,
      bodySize: defaults.bodySize,
      rowPadding: defaults.rowPadding,
      lineWidth: defaults.lineWidth,
      borders: defaults.borders,
      zebra: defaults.zebra,
      headerFill: defaults.headerFill,
      headerBg: defaults.headerBg,
      titleBold: defaults.titleBold,
      headerBold: defaults.headerBold,
      priceBold: defaults.priceBold,
      showDate: defaults.showDate,
      showSku: defaults.showSku,
      showSize: defaults.showSize,
      showPack: defaults.showPack,
      showPurchase: defaults.showPurchase,
      showRegular: defaults.showRegular,
      groupByCategory: defaults.groupByCategory,
      margins: { ...defaults.margins },
    }));
  }

  function updateTier(id: string, patch: Partial<PriceTierConfig>) {
    setSettings((current) => ({
      ...current,
      tiers: current.tiers.map((tier) =>
        tier.id === id ? { ...tier, ...patch } : tier
      ),
    }));
  }

  /**
   * Границы объёмов хранятся как верхние границы столбцов. Держим их
   * строго возрастающими: иначе получилось бы «от 500 до 100».
   */
  function setTierBoundary(index: number, value: number) {
    setSettings((current) => {
      const tiers = current.tiers.map((tier) => ({ ...tier }));
      const previous = index === 0 ? 0 : tiers[index - 1]?.upTo ?? 0;
      const following = tiers[index + 1]?.upTo ?? null;
      const min = previous + 1;
      const max = following === null ? 1_000_000 : following - 1;
      const next = clamp(Math.round(value), min, max);
      tiers[index] = { ...tiers[index], upTo: next };
      return { ...current, tiers };
    });
  }

  async function savePurchasesToDb() {
    if (purchaseChanges.length === 0 || savingDb) return;
    const confirmed = window.confirm(
      `Сохранить закупочные цены в карточки товаров (${purchaseChanges.length} шт.)?\n\n` +
        "Цены в прайс-листе останутся прежними, изменится только закупочная цена товара в базе."
    );
    if (!confirmed) return;

    setSavingDb(true);
    setStatus(null);

    const queue = [...purchaseChanges];
    const saved: { id: string; value: number }[] = [];
    const errors: string[] = [];

    const worker = async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        try {
          const response = await adminFetch(
            `/api/admin/products/${encodeURIComponent(item.id)}/purchase-price`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ purchasePrice: item.value }),
            }
          );
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as unknown;
            throw new Error(adminErrorText(body, `Ошибка ${response.status}`));
          }
          saved.push({ id: item.id, value: item.value });
        } catch (error) {
          errors.push(
            `${item.name}: ${error instanceof Error ? error.message : "ошибка"}`
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(4, purchaseChanges.length) }, () => worker())
    );

    if (saved.length > 0) {
      setDbPurchases((current) => {
        const next = { ...current };
        for (const item of saved) next[item.id] = item.value;
        return next;
      });
      setEdits((current) => {
        const next: EditsMap = { ...current };
        for (const item of saved) {
          const entry = next[item.id];
          if (!entry) continue;
          const copy: ProductEdits = { ...entry };
          delete copy.purchase;
          if (copy.base !== undefined || copy.tiers !== undefined) next[item.id] = copy;
          else delete next[item.id];
        }
        return next;
      });
    }

    setSavingDb(false);
    if (errors.length > 0) {
      setStatus({
        kind: "err",
        text: `Сохранено ${saved.length} из ${purchaseChanges.length}. ${errors
          .slice(0, 3)
          .join(" · ")}`,
      });
    } else {
      setStatus({
        kind: "ok",
        text: `Закупочные цены сохранены в карточки товаров: ${saved.length}.`,
      });
    }
  }

  function print() {
    if (printRows.length === 0) return;
    window.print();
  }

  const sheetSettings: PriceListSheetSettings = {
    ...settings,
    dateText,
  };

  const canPrint = printRows.length > 0;

  // ── Разметка ─────────────────────────────────────────────

  return (
    <div className="admin-stack pl-root">
      {/* Ориентация листа: @page нельзя ограничить селектором, поэтому
          правило живёт вместе с компонентом и действует только здесь. */}
      <style>{`@media print { @page { size: A4 ${settings.orientation}; margin: 0; } }`}</style>

      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Прайс-лист по объёмам</h1>
          <p className="admin-sub">
            Выберите товары и проверьте закупочные цены — обычная цена (+
            {percentText(settings.baseMarkup)}%) и цены по объёмам (до 100 ·
            100–500 · 500–1000 · от 1000 шт) посчитаются сами. Любую цену можно
            поправить вручную, а шрифт, размеры и поля — настроить перед печатью.
          </p>
        </div>
        <div className="pl-actions">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={resetEverything}
          >
            <RotateCcw size={15} /> Сбросить всё
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--navy"
            onClick={print}
            disabled={!canPrint}
            title={canPrint ? "Печать или сохранение в PDF" : "Сначала выберите товары"}
          >
            <Printer size={15} /> Печать / PDF
          </button>
        </div>
      </div>

      {status && (
        <div className={`pl-status pl-status--${status.kind}`} role="status">
          {status.kind === "err" ? (
            <AlertTriangle size={15} />
          ) : status.kind === "warn" ? (
            <AlertTriangle size={15} />
          ) : (
            <Check size={15} />
          )}
          <span>{status.text}</span>
        </div>
      )}

      {/* ── ШАГ 1. ТОВАРЫ ─────────────────────────────────── */}
      <section className="admin-card">
        <div className="admin-card__pad">
          <div className="pl-section-head">
            <div>
              <h2 className="pl-section-title">
                <span className="pl-step">1</span> Выберите товары
              </h2>
              <p className="pl-section-sub">
                Отметьте позиции для прайса. Можно выбрать все найденные по
                фильтру — например, целую категорию.
              </p>
            </div>
            <div className="pl-actions">
              <span className="pl-counter">Найдено: {filtered.length}</span>
              <span className="pl-counter pl-counter--accent">
                <Check size={12} /> Выбрано: {selectedCount}
              </span>
            </div>
          </div>

          <div className="pl-catalog-toolbar">
            <div className="pl-search">
              <Search size={14} />
              <input
                type="text"
                className="admin-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Название или артикул…"
                aria-label="Поиск товара"
              />
            </div>

            <select
              className="admin-select"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label="Категория"
            >
              <option value="all">Все категории</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
              {hasNoCategoryProducts && (
                <option value={CATEGORY_NONE}>Без категории</option>
              )}
            </select>

            <label className="pl-check">
              <input
                type="checkbox"
                checked={onlyWithoutPurchase}
                onChange={(event) => setOnlyWithoutPurchase(event.target.checked)}
              />
              без закупки
            </label>

            <div className="pl-actions" style={{ marginLeft: "auto" }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={selectAllFiltered}
                disabled={filtered.length === 0}
              >
                Выбрать найденные
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => setSelectedIds([])}
                disabled={selectedCount === 0}
              >
                Снять все
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--outline admin-btn--sm"
                onClick={scrollToPrices}
                disabled={selectedCount === 0}
              >
                К ценам <ArrowDown size={13} />
              </button>
            </div>
          </div>

          <div className="pl-catalog">
            {filtered.length === 0 ? (
              <div className="pl-empty">
                {products.length === 0 ? (
                  <>В базе пока нет товаров — прайс составить не из чего.</>
                ) : (
                  <>
                    <b>Ничего не найдено.</b>
                    <br />
                    Попробуйте изменить запрос или категорию.
                  </>
                )}
              </div>
            ) : (
              <div className="pl-catalog-list">
                {win.visible.map((product) => {
                  const checked = selectedSet.has(product.id);
                  const purchase = purchaseFor(product);
                  const manualPurchase = edits[product.id]?.purchase !== undefined;
                  return (
                    <label
                      key={product.id}
                      className={`pl-pick${checked ? " is-checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProduct(product.id)}
                      />
                      <span className="pl-pick__text">
                        <span className="pl-pick__name" title={product.name}>
                          {product.name}
                        </span>
                        <span className="pl-pick__sub">
                          {product.sku && <span>арт. {product.sku}</span>}
                          {product.categoryName && <span>{product.categoryName}</span>}
                          {product.size && <span>{product.size}</span>}
                          {!product.isVisible && <span>скрыт на сайте</span>}
                          {manualPurchase && (
                            <span className="pl-badge pl-badge--manual">
                              закупка вручную
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="pl-pick__meta">
                        <div>
                          {purchase !== null ? (
                            <>
                              <b>{formatMoney(purchase)}</b> ₽ закупка
                            </>
                          ) : (
                            <span className="pl-badge pl-badge--missing">
                              нет закупки
                            </span>
                          )}
                        </div>
                        <div>на сайте {formatMoney(product.price)} ₽</div>
                      </span>
                    </label>
                  );
                })}

                {win.hidden > 0 && (
                  <div className="pl-catalog-more">
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={win.showAll}
                    >
                      Показать все ({win.total})
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── ШАГ 2. ЦЕНЫ ───────────────────────────────────── */}
      <section className="admin-card pl-anchor" id="pl-prices">
        <div className="admin-card__pad">
          <div className="pl-section-head">
            <div>
              <h2 className="pl-section-title">
                <span className="pl-step">2</span> Закупка, обычная цена и объёмы
              </h2>
              <p className="pl-section-sub">
                Обычная цена = закупка × (1 + наценка). Цены столбцов = обычная
                цена × (1 − скидка столбца): чем больше объём, тем ниже цена.
                Любую цену можно переписать вручную — она будет выделена.
              </p>
            </div>
            <div className="pl-actions">
              <span className="pl-counter">Ручных цен: {manualPriceCount}</span>
              {manualPriceCount > 0 && (
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={resetManualPrices}
                >
                  <RotateCcw size={13} /> Сбросить ручные цены
                </button>
              )}
            </div>
          </div>

          <div className="pl-price-toolbar">
            <label className="pl-field">
              <span className="pl-label">Наценка на обычную цену</span>
              <NumberField
                value={settings.baseMarkup}
                onChange={(value) =>
                  updateSettings({ baseMarkup: normalizeMarkup(value) })
                }
                min={-90}
                max={1000}
                step={1}
                suffix="%"
                ariaLabel="Наценка на обычную цену, процентов"
              />
            </label>

            <label className="pl-field pl-field--grow">
              <span className="pl-label">Округление цен</span>
              <select
                className="admin-select"
                value={settings.rounding}
                onChange={(event) =>
                  updateSettings({ rounding: event.target.value as RoundingMode })
                }
              >
                {ROUNDING_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="pl-toolbar-actions">
              {purchaseChanges.length > 0 && (
                <button
                  type="button"
                  className="admin-btn admin-btn--outline"
                  onClick={savePurchasesToDb}
                  disabled={savingDb}
                  title="Записать введённые закупочные цены в карточки товаров"
                >
                  {savingDb ? (
                    <Loader2 size={15} className="pl-spin" />
                  ) : (
                    <Save size={15} />
                  )}
                  Сохранить закупки в базу ({purchaseChanges.length})
                </button>
              )}
            </div>
          </div>

          <div className="pl-example">
            <span>
              Пример на закупке <b>100 ₽</b> при наценке{" "}
              <b>{percentText(settings.baseMarkup)}%</b>:
            </span>
            <span className="pl-example__item">
              <span>обычная</span>
              <b>{formatMoney(example.base)} ₽</b>
            </span>
            {settings.tiers
              .filter((tier) => tier.enabled)
              .map((tier) => {
                const index = settings.tiers.indexOf(tier);
                return (
                  <span className="pl-example__item" key={tier.id}>
                    <span>{tierLabel(settings.tiers, index)}</span>
                    <b>{formatMoney(example.tiers[tier.id])} ₽</b>
                  </span>
                );
              })}
          </div>

          <p className="pl-hint" style={{ marginTop: 8 }}>
            «До 100» по умолчанию совпадает с обычной ценой. Если дублировать её
            не нужно, задайте первому столбцу скидку или выключите колонку
            «Обычная цена» в шаге 3.
          </p>

          <div className="pl-tier-scroll">
          <table className="pl-tier-table">
            <thead>
              <tr>
                <th>Столбец</th>
                <th>Диапазон объёма</th>
                <th>Скидка от обычной, %</th>
                <th>Накрутка к закупке, %</th>
              </tr>
            </thead>
            <tbody>
              {settings.tiers.map((tier, index) => {
                const previous = tierFrom(settings.tiers, index);
                const nextBoundary = settings.tiers[index + 1]?.upTo ?? null;
                const minBoundary = previous + 1;
                const maxBoundary =
                  nextBoundary === null ? 1_000_000 : nextBoundary - 1;
                return (
                  <tr key={tier.id}>
                    <td>
                      <label className="pl-tier-name">
                        <input
                          type="checkbox"
                          checked={tier.enabled}
                          onChange={(event) =>
                            updateTier(tier.id, { enabled: event.target.checked })
                          }
                          aria-label={`Показывать столбец «${tierLabel(
                            settings.tiers,
                            index
                          )}»`}
                        />
                        {tierLabel(settings.tiers, index)}
                      </label>
                    </td>
                    <td>
                      {index === 0 ? (
                        <span className="pl-inline">
                          до
                          <NumberField
                            value={tier.upTo ?? 1}
                            onChange={(value) => setTierBoundary(index, value)}
                            min={minBoundary}
                            max={maxBoundary}
                            ariaLabel="Верхняя граница первого объёма"
                          />
                          шт
                        </span>
                      ) : tier.upTo === null ? (
                        <span className="pl-muted">без верхней границы</span>
                      ) : (
                        <span className="pl-inline">
                          от {previous} до
                          <NumberField
                            value={tier.upTo}
                            onChange={(value) => setTierBoundary(index, value)}
                            min={minBoundary}
                            max={maxBoundary}
                            ariaLabel={`Верхняя граница объёма ${index + 1}`}
                          />
                          шт
                        </span>
                      )}
                    </td>
                    <td className="pl-tier-table__discount">
                      <NumberField
                        value={tier.discount}
                        onChange={(value) =>
                          updateTier(tier.id, {
                            discount: clamp(value, -500, 100),
                          })
                        }
                        min={-500}
                        max={100}
                        suffix="%"
                        ariaLabel={`Скидка столбца ${index + 1}`}
                      />
                    </td>
                    <td className="pl-tier-table__markup">
                      <NumberField
                        value={markupForDiscount(
                          settings.baseMarkup,
                          tier.discount
                        )}
                        onChange={(value) =>
                          updateTier(tier.id, {
                            discount: discountForMarkup(
                              settings.baseMarkup,
                              value
                            ),
                          })
                        }
                        min={-90}
                        max={1000}
                        suffix="%"
                        ariaLabel={`Накрутка к закупке для столбца ${index + 1}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {missingBaseCount > 0 && (
            <div className="pl-status pl-status--warn" style={{ marginTop: 12 }}>
              <AlertTriangle size={15} />
              <span>
                У {missingBaseCount}{" "}
                {missingBaseCount === 1 ? "товара" : "товаров"} нет закупочной
                цены и не задана обычная цена — в прайсе на их месте будет «—».
                Впишите закупку в колонке «Закупка» ниже.
              </span>
            </div>
          )}

          {selectedProducts.length === 0 ? (
            <div className="pl-empty" style={{ marginTop: 12 }}>
              <b>Товары ещё не выбраны.</b>
              <br />
              Отметьте их в шаге 1 — здесь появится таблица цен и объёмов.
            </div>
          ) : (
            <>
              <div className="pl-edit-scroll" style={{ marginTop: 12 }}>
                <table className="pl-edit">
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Товар</th>
                      <th className="pl-right">Закупка, ₽</th>
                      <th className="pl-right">
                        Обычная цена, ₽
                        <span className="pl-th-sub">
                          +{percentText(settings.baseMarkup)}% к закупке
                        </span>
                      </th>
                      {activeTiers.map((tier) => {
                        const index = settings.tiers.indexOf(tier);
                        const discount = tier.discount;
                        return (
                          <th className="pl-right" key={tier.id}>
                            {tierLabel(settings.tiers, index)}
                            <span className="pl-th-sub">
                              {discount === 0
                                ? "= обычная"
                                : discount > 0
                                  ? `−${percentText(discount)}% от обычной`
                                  : `+${percentText(-discount)}% к обычной`}
                            </span>
                          </th>
                        );
                      })}
                      <th aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {editorEntries.map((entry, entryIndex) => {
                      if (entry.kind === "group") {
                        return (
                          <tr
                            key={`group-${entry.label}-${entryIndex}`}
                            className="pl-edit__group"
                          >
                            <td colSpan={5 + activeTiers.length}>{entry.label}</td>
                          </tr>
                        );
                      }

                      const { product, number } = entry;
                      const entryEdits = edits[product.id];
                      const price = priceById.get(product.id);
                      const purchaseValue =
                        entryEdits?.purchase !== undefined
                          ? entryEdits.purchase
                          : purchaseFor(product) !== null
                            ? moneyInputValue(purchaseFor(product))
                            : "";
                      const purchaseInvalid =
                        entryEdits?.purchase !== undefined &&
                        entryEdits.purchase.trim() !== "" &&
                        toPrice(entryEdits.purchase) === null;
                      const baseValue =
                        entryEdits?.base !== undefined
                          ? entryEdits.base
                          : moneyInputValue(price?.base);
                      const baseInvalid =
                        entryEdits?.base !== undefined &&
                        entryEdits.base.trim() !== "" &&
                        toPrice(entryEdits.base) === null;

                      return (
                        <tr key={product.id}>
                          <td className="pl-edit__num">{number}</td>
                          <td className="pl-edit__name">
                            <b>{product.name}</b>
                            <span className="pl-edit__sku">
                              {product.sku ? `арт. ${product.sku}` : ""}
                              {product.sku && product.categoryName ? " · " : ""}
                              {product.categoryName || ""}
                            </span>
                          </td>
                          <td>
                            <PriceCell
                              value={purchaseValue}
                              manual={entryEdits?.purchase !== undefined}
                              invalid={purchaseInvalid}
                              placeholder="—"
                              ariaLabel={`Закупочная цена: ${product.name}`}
                              onChange={(value) =>
                                patchEdits(product.id, { purchase: value })
                              }
                              onReset={() => resetField(product.id, "purchase")}
                            />
                          </td>
                          <td>
                            <PriceCell
                              value={baseValue}
                              manual={entryEdits?.base !== undefined}
                              invalid={baseInvalid}
                              placeholder={
                                price?.base != null ? formatMoney(price.base) : "—"
                              }
                              ariaLabel={`Обычная цена: ${product.name}`}
                              onChange={(value) =>
                                patchEdits(product.id, { base: value })
                              }
                              onReset={() => resetField(product.id, "base")}
                            />
                          </td>
                          {activeTiers.map((tier) => {
                            const manualValue = entryEdits?.tiers?.[tier.id];
                            const computed = price?.tiers[tier.id] ?? null;
                            const invalid =
                              manualValue !== undefined &&
                              manualValue.trim() !== "" &&
                              toPrice(manualValue) === null;
                            return (
                              <td key={tier.id}>
                                <PriceCell
                                  value={
                                    manualValue !== undefined
                                      ? manualValue
                                      : moneyInputValue(computed)
                                  }
                                  manual={manualValue !== undefined}
                                  invalid={invalid}
                                  placeholder={
                                    computed != null ? formatMoney(computed) : "—"
                                  }
                                  ariaLabel={`Цена ${tierLabel(
                                    settings.tiers,
                                    settings.tiers.indexOf(tier)
                                  )}: ${product.name}`}
                                  onChange={(value) =>
                                    patchEdits(product.id, {
                                      tiers: { [tier.id]: value },
                                    })
                                  }
                                  onReset={() => resetTierCell(product.id, tier.id)}
                                />
                              </td>
                            );
                          })}
                          <td>
                            <div className="pl-row-actions">
                              {(entryEdits?.base !== undefined ||
                                entryEdits?.tiers !== undefined) && (
                                <button
                                  type="button"
                                  onClick={() => resetRow(product.id)}
                                  title="Сбросить ручные цены строки (закупка останется)"
                                  aria-label="Сбросить ручные цены строки"
                                >
                                  <RotateCcw size={13} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="pl-remove"
                                onClick={() => toggleProduct(product.id)}
                                title="Убрать товар из прайса"
                                aria-label="Убрать товар из прайса"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="pl-edit-foot">
                <span>
                  Позиций: <b>{selectedProducts.length}</b> · столбцов объёма:{" "}
                  <b>{activeTiers.length}</b> · ручных цен: <b>{manualCount}</b>
                </span>
                <span className="pl-hint">
                  Янтарная ячейка — цена введена вручную и не пересчитывается.
                  ↺ возвращает расчёт.
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── ШАГ 3. ОФОРМЛЕНИЕ ─────────────────────────────── */}
      <section className="admin-card">
        <div className="admin-card__pad">
          <div className="pl-section-head">
            <div>
              <h2 className="pl-section-title">
                <span className="pl-step">3</span> Оформление листа
              </h2>
              <p className="pl-section-sub">
                Шрифт, размеры, поля и колонки. Всё сразу видно в предпросмотре
                ниже — на печать уйдёт ровно то, что на экране. Настройки,
                выбранные товары и ручные цены запоминаются в этом браузере.
              </p>
            </div>
            <div className="pl-actions">
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={resetDesign}
              >
                <RotateCcw size={13} /> Сбросить оформление
              </button>
            </div>
          </div>

          <div className="pl-grid">
            <label className="pl-field pl-field--full">
              <span className="pl-label">Название прайса</span>
              <input
                type="text"
                className="admin-input"
                value={settings.title}
                onChange={(event) => updateSettings({ title: event.target.value })}
                placeholder="ПРАЙС-ЛИСТ"
              />
            </label>

            <label className="pl-field pl-field--full">
              <span className="pl-label">Подзаголовок</span>
              <input
                type="text"
                className="admin-input"
                value={settings.subtitle}
                onChange={(event) =>
                  updateSettings({ subtitle: event.target.value })
                }
                placeholder="Например: Оптовые цены на гофроупаковку"
              />
            </label>

            <label className="pl-field">
              <span className="pl-label">Компания</span>
              <input
                type="text"
                className="admin-input"
                value={settings.company}
                onChange={(event) =>
                  updateSettings({ company: event.target.value })
                }
              />
            </label>

            <label className="pl-field pl-field--full">
              <span className="pl-label">Контакты в шапке</span>
              <input
                type="text"
                className="admin-input"
                value={settings.contacts}
                onChange={(event) =>
                  updateSettings({ contacts: event.target.value })
                }
                placeholder="Телефон · почта · адрес"
              />
            </label>

            <label className="pl-field">
              <span className="pl-label">Дата в шапке</span>
              <input
                type="text"
                className="admin-input"
                value={dateText}
                onChange={(event) => setDateText(event.target.value)}
                placeholder="от 18.10.2026"
              />
            </label>

            <div className="pl-field">
              <span className="pl-label">Ориентация</span>
              <div className="pl-seg">
                <button
                  type="button"
                  className={`pl-seg__btn${
                    settings.orientation === "portrait" ? " pl-seg__btn--active" : ""
                  }`}
                  onClick={() => updateSettings({ orientation: "portrait" })}
                >
                  Портрет
                </button>
                <button
                  type="button"
                  className={`pl-seg__btn${
                    settings.orientation === "landscape"
                      ? " pl-seg__btn--active"
                      : ""
                  }`}
                  onClick={() => updateSettings({ orientation: "landscape" })}
                >
                  Альбом
                </button>
              </div>
            </div>

            <label className="pl-field">
              <span className="pl-label">Шрифт</span>
              <select
                className="admin-select"
                value={settings.fontFamily}
                onChange={(event) =>
                  updateSettings({ fontFamily: event.target.value })
                }
              >
                {FONTS.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="pl-field">
              <span className="pl-label">Заголовок, pt</span>
              <NumberField
                value={settings.titleSize}
                onChange={(value) => updateSettings({ titleSize: value })}
                min={8}
                max={60}
                ariaLabel="Размер заголовка прайса"
              />
            </label>

            <label className="pl-field">
              <span className="pl-label">Компания, pt</span>
              <NumberField
                value={settings.companySize}
                onChange={(value) => updateSettings({ companySize: value })}
                min={6}
                max={40}
                ariaLabel="Размер названия компании"
              />
            </label>

            <label className="pl-field">
              <span className="pl-label">Шапка таблицы, pt</span>
              <NumberField
                value={settings.headerSize}
                onChange={(value) => updateSettings({ headerSize: value })}
                min={5}
                max={24}
                ariaLabel="Размер шрифта шапки таблицы"
              />
            </label>

            <label className="pl-field">
              <span className="pl-label">Текст таблицы, pt</span>
              <NumberField
                value={settings.bodySize}
                onChange={(value) => updateSettings({ bodySize: value })}
                min={5}
                max={24}
                ariaLabel="Размер шрифта таблицы"
              />
            </label>

            <label className="pl-field">
              <span className="pl-label">Отступ в ячейке, мм</span>
              <NumberField
                value={settings.rowPadding}
                onChange={(value) => updateSettings({ rowPadding: value })}
                min={0.2}
                max={6}
                step={0.1}
                ariaLabel="Отступ в ячейке, мм"
              />
            </label>

            <label className="pl-field">
              <span className="pl-label">Толщина линий, pt</span>
              <NumberField
                value={settings.lineWidth}
                onChange={(value) => updateSettings({ lineWidth: value })}
                min={0.2}
                max={3}
                step={0.05}
                ariaLabel="Толщина линий таблицы"
              />
            </label>
          </div>

          <div
            className="pl-grid"
            style={{ marginTop: 14 }}
            aria-label="Отступы страницы"
          >
            <label className="pl-field">
              <span className="pl-label">Поле сверху, мм</span>
              <NumberField
                value={settings.margins.top}
                onChange={(value) =>
                  updateSettings({ margins: { ...settings.margins, top: value } })
                }
                min={0}
                max={50}
                ariaLabel="Поле сверху"
              />
            </label>
            <label className="pl-field">
              <span className="pl-label">Поле снизу, мм</span>
              <NumberField
                value={settings.margins.bottom}
                onChange={(value) =>
                  updateSettings({
                    margins: { ...settings.margins, bottom: value },
                  })
                }
                min={0}
                max={50}
                ariaLabel="Поле снизу"
              />
            </label>
            <label className="pl-field">
              <span className="pl-label">Поле слева, мм</span>
              <NumberField
                value={settings.margins.left}
                onChange={(value) =>
                  updateSettings({ margins: { ...settings.margins, left: value } })
                }
                min={0}
                max={50}
                ariaLabel="Поле слева"
              />
            </label>
            <label className="pl-field">
              <span className="pl-label">Поле справа, мм</span>
              <NumberField
                value={settings.margins.right}
                onChange={(value) =>
                  updateSettings({
                    margins: { ...settings.margins, right: value },
                  })
                }
                min={0}
                max={50}
                ariaLabel="Поле справа"
              />
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <span className="pl-label">Колонки и вид таблицы</span>
            <div className="pl-checks" style={{ marginTop: 8 }}>
              <label className="pl-check">
                <input
                  type="checkbox"
                  checked={settings.groupByCategory}
                  onChange={(event) =>
                    updateSettings({ groupByCategory: event.target.checked })
                  }
                />
                Группировать по категориям
              </label>
              <label className="pl-check">
                <input
                  type="checkbox"
                  checked={settings.showRegular}
                  onChange={(event) =>
                    updateSettings({ showRegular: event.target.checked })
                  }
                />
                Обычная цена
              </label>
              <label className="pl-check">
                <input
                  type="checkbox"
                  checked={settings.showSize}
                  onChange={(event) =>
                    updateSettings({ showSize: event.target.checked })
                  }
                />
                Размер
              </label>
              <label className="pl-check">
                <input
                  type="checkbox"
                  checked={settings.showSku}
                  onChange={(event) =>
                    updateSettings({ showSku: event.target.checked })
                  }
                />
                Артикул
              </label>
              <label className="pl-check">
                <input
                  type="checkbox"
                  checked={settings.showPack}
                  onChange={(event) =>
                    updateSettings({ showPack: event.target.checked })
                  }
                />
                В упаковке
              </label>
              <label className="pl-check">
                <input
                  type="checkbox"
                  checked={settings.showPurchase}
                  onChange={(event) =>
                    updateSettings({ showPurchase: event.target.checked })
                  }
                />
                Закупка (внутренний прайс)
              </label>
              <label className="pl-check">
                <input
                  type="checkbox"
                  checked={settings.showDate}
                  onChange={(event) =>
                    updateSettings({ showDate: event.target.checked })
                  }
                />
                Дата
              </label>
              <label className="pl-check">
                <input
                  type="checkbox"
                  checked={settings.borders}
                  onChange={(event) =>
                    updateSettings({ borders: event.target.checked })
                  }
                />
                Сетка таблицы (все рамки)
              </label>
              <label className="pl-check">
                <input
                  type="checkbox"
                  checked={settings.zebra}
                  onChange={(event) =>
                    updateSettings({ zebra: event.target.checked })
                  }
                />
                Полосатые строки
              </label>
              <label className="pl-check">
                <input
                  type="checkbox"
                  checked={settings.headerFill}
                  onChange={(event) =>
                    updateSettings({ headerFill: event.target.checked })
                  }
                />
                Заливка шапки
              </label>
            </div>
          </div>

          <div className="pl-grid" style={{ marginTop: 14 }}>
            <div className="pl-field">
              <span className="pl-label">Цвет заливки шапки</span>
              <div className="pl-inline">
                <input
                  type="color"
                  className="admin-input"
                  style={{ width: 54, padding: 3, height: 34 }}
                  value={settings.headerBg}
                  onChange={(event) =>
                    updateSettings({ headerBg: event.target.value, headerFill: true })
                  }
                  aria-label="Цвет заливки шапки"
                />
                <span className="pl-hint">{settings.headerBg}</span>
              </div>
            </div>

            <div className="pl-field">
              <span className="pl-label">Жирность</span>
              <div className="pl-checks">
                <label className="pl-check">
                  <input
                    type="checkbox"
                    checked={settings.titleBold}
                    onChange={(event) =>
                      updateSettings({ titleBold: event.target.checked })
                    }
                  />
                  заголовок
                </label>
                <label className="pl-check">
                  <input
                    type="checkbox"
                    checked={settings.headerBold}
                    onChange={(event) =>
                      updateSettings({ headerBold: event.target.checked })
                    }
                  />
                  шапка
                </label>
                <label className="pl-check">
                  <input
                    type="checkbox"
                    checked={settings.priceBold}
                    onChange={(event) =>
                      updateSettings({ priceBold: event.target.checked })
                    }
                  />
                  цены
                </label>
              </div>
            </div>

            <label className="pl-field pl-field--full">
              <span className="pl-label">Примечание под таблицей</span>
              <textarea
                className="admin-input"
                rows={2}
                value={settings.note}
                onChange={(event) => updateSettings({ note: event.target.value })}
                placeholder="Условия, срок действия цен, контакты менеджера…"
              />
            </label>
          </div>
        </div>
      </section>

      {/* ── ШАГ 4. ПРЕДПРОСМОТР И ПЕЧАТЬ ──────────────────── */}
      <section className="admin-card pl-print-area">
        <div className="admin-card__pad">
          <div className="pl-preview-head pl-no-print">
            <div>
              <h2 className="pl-section-title">
                <span className="pl-step">4</span> Предпросмотр и печать
              </h2>
              <p className="pl-section-sub" style={{ marginBottom: 0 }}>
                Лист А4 — ровно то, что уйдёт на печать. В окне печати выберите
                «Сохранить как PDF», если нужен файл для клиента.
              </p>
            </div>
            <div className="pl-actions">
              <span className="pl-counter">
                {printRows.length} поз. ·{" "}
                {settings.orientation === "landscape" ? "альбом" : "портрет"}
              </span>
              <button
                type="button"
                className="admin-btn admin-btn--navy"
                onClick={print}
                disabled={!canPrint}
              >
                <Printer size={15} /> Печать / PDF
              </button>
            </div>
          </div>

          <div className="pl-stage">
            <PriceListSheet
              rows={printRows}
              tiers={settings.tiers}
              settings={sheetSettings}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
