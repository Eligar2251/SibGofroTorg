// =========================================================
// FILE: src/lib/price-list.ts
// Расчёт прайс-листа «по объёмам» (админка → «Прайс-лист»).
//
// Как считается:
//   обычная цена  = закупка × (1 + наценка / 100)      — по умолчанию +30%;
//   цена столбца  = обычная цена × (1 − скидка / 100)  — чем больше объём,
//                                                       тем больше скидка.
// Скидка может быть отрицательной — тогда столбец дороже обычной цены
// (полезно, если нужно задать цену «наценкой к закупке», а не скидкой).
//
// Ручные цены (обычная цена или цена конкретного столбца) НЕ
// пересчитываются: их ввёл человек, поэтому округление к ним не применяется.
// Автоматические цены округляются выбранным правилом из price-calc.ts —
// тем же, что в «Массовых ценах».
//
// Модуль без React и без обращений к базе: формулы используют и интерфейс,
// и тесты (tests/price-list.test.mjs).
// =========================================================

import {
  applyRounding,
  marginPercent,
  markupPercent,
  parsePriceInput,
  round2,
  type RoundingMode,
} from "./price-calc";

/** Столбец объёма: «до 100», «от 100 до 500», … */
export type PriceTierConfig = {
  /** Стабильный ключ столбца (по нему запоминаются ручные цены). */
  id: string;
  /** Верхняя граница объёма (не включая). null — последний столбец без границы. */
  upTo: number | null;
  /** Скидка от обычной цены, %. Отрицательная — наценка. */
  discount: number;
  /** Столбец включён в прайс. */
  enabled: boolean;
};

/** Сколько столбцов объёма по умолчанию (как в задаче: 4 объёма). */
export const DEFAULT_PRICE_TIERS: readonly PriceTierConfig[] = [
  { id: "t1", upTo: 100, discount: 0, enabled: true },
  { id: "t2", upTo: 500, discount: 5, enabled: true },
  { id: "t3", upTo: 1000, discount: 10, enabled: true },
  { id: "t4", upTo: null, discount: 15, enabled: true },
];

/** Наценка на закупку для «обычной» цены. */
export const DEFAULT_BASE_MARKUP = 30;

/**
 * Наценка и скидки отдельной категории. Пустое значение
 * (null) — «берём общую настройку».
 */
export type CategoryMarginConfig = {
  /** Наценка категории на обычную цену, % (null — общая). */
  markup: number | null;
  /** Скидки столбцов объёма: id столбца → скидка, %.
   *  Ключ без значения (null) — общая скидка столбца. */
  tierDiscounts: Record<string, number | null>;
};

/** Наценки/скидки по категориям: id категории → настройка. */
export type CategoryMargins = Record<string, CategoryMarginConfig>;

/** Пустая карта — всё считается по общим настройкам. */
export const DEFAULT_CATEGORY_MARGINS: CategoryMargins = {};

/** Допустимые пределы процентов, чтобы localStorage не сломал расчёт. */
const MIN_DISCOUNT = -500;
const MAX_DISCOUNT = 100;
const MIN_MARKUP = -90;
const MAX_MARKUP = 1000;

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Закупка/цена: только положительное число, иначе «нет значения». */
export function toPrice(value: unknown): number | null {
  const parsed =
    typeof value === "string" ? parsePriceInput(value) : finiteNumber(value);
  if (parsed === null || parsed <= 0) return null;
  return round2(parsed);
}

/** Процент из поля ввода: пусто/мусор → null. */
export function toPercent(value: unknown): number | null {
  return finiteNumber(value);
}

/** Процент наценки: не даём уйти в абсурдные значения из localStorage. */
export function normalizeMarkup(value: unknown): number {
  const n = finiteNumber(value);
  if (n === null) return DEFAULT_BASE_MARKUP;
  return clamp(round2(n), MIN_MARKUP, MAX_MARKUP);
}

/** Скидка столбца: −500…100 %. */
export function normalizeDiscount(value: unknown): number {
  const n = finiteNumber(value);
  if (n === null) return 0;
  return clamp(round2(n), MIN_DISCOUNT, MAX_DISCOUNT);
}

/**
 * Проверка и нормализация столбцов (например, из localStorage).
 * Границы обязаны возрастать, последний столбец — без верхней границы.
 * Любое расхождение → возвращаем значения по умолчанию, чтобы прайс
 * не напечатался с «от 500 до 100».
 */
export function sanitizePriceTiers(raw: unknown): PriceTierConfig[] {
  const fallback = DEFAULT_PRICE_TIERS.map((tier) => ({ ...tier }));
  if (!Array.isArray(raw) || raw.length !== DEFAULT_PRICE_TIERS.length) {
    return fallback;
  }

  const result: PriceTierConfig[] = [];
  let previous = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (!item || typeof item !== "object") return fallback;
    const source = item as Record<string, unknown>;
    const defaultTier = DEFAULT_PRICE_TIERS[index];
    const id =
      typeof source.id === "string" && /^[a-zA-Z0-9_-]{1,20}$/.test(source.id)
        ? source.id
        : defaultTier.id;
    const enabled = source.enabled === undefined ? true : Boolean(source.enabled);
    const discount = normalizeDiscount(source.discount);

    if (index === raw.length - 1) {
      result.push({ id, upTo: null, discount, enabled });
      break;
    }

    const upTo = finiteNumber(source.upTo);
    if (upTo === null || upTo <= previous || !Number.isInteger(upTo)) {
      return fallback;
    }
    result.push({ id, upTo, discount, enabled });
    previous = upTo;
  }
  return result;
}

/**
 * Проверка и нормализация наценок/скидок по категориям
 * (например, из localStorage). Незнакомые id категорий
 * и столбцов выкидываем — настроек для удалённых сущностей
 * быть не должно.
 */
export function sanitizeCategoryMargins(
  raw: unknown,
  categoryIds: Set<string>,
  tierIds: Set<string>
): CategoryMargins {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_CATEGORY_MARGINS;
  }
  const result: CategoryMargins = {};
  for (const [categoryId, value] of Object.entries(
    raw as Record<string, unknown>
  )) {
    if (!categoryIds.has(categoryId)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const source = value as Record<string, unknown>;

    let markup: number | null = null;
    if (source.markup !== undefined && source.markup !== null) {
      const n = Number(source.markup);
      if (Number.isFinite(n)) markup = clamp(round2(n), MIN_MARKUP, MAX_MARKUP);
    }

    const tierDiscounts: Record<string, number | null> = {};
    if (source.tierDiscounts && typeof source.tierDiscounts === "object") {
      const rawDiscounts = source.tierDiscounts as Record<string, unknown>;
      for (const tierId of tierIds) {
        const raw = rawDiscounts[tierId];
        if (raw === undefined || raw === null) continue;
        const n = Number(raw);
        if (Number.isFinite(n)) {
          tierDiscounts[tierId] = clamp(round2(n), MIN_DISCOUNT, MAX_DISCOUNT);
        }
      }
    }

    if (markup === null && Object.keys(tierDiscounts).length === 0) continue;
    result[categoryId] = { markup, tierDiscounts };
  }
  return result;
}

/**
 * Настройки цен для конкретной категории: общие наценка и
 * столбцы, переписанные настройками категории (где они есть).
 * Возвращает новые объекты — исходные не меняем.
 */
export function resolveCategoryPricing(
  categoryId: string | null | undefined,
  categoryMargins: CategoryMargins | null | undefined,
  baseMarkup: number,
  tiers: readonly PriceTierConfig[]
): { baseMarkup: number; tiers: PriceTierConfig[] } {
  const override =
    categoryId && categoryMargins
      ? categoryMargins[categoryId]
      : undefined;
  if (!override) {
    return { baseMarkup, tiers: tiers.map((tier) => ({ ...tier })) };
  }

  const markup =
    override.markup !== null && override.markup !== undefined
      ? normalizeMarkup(override.markup)
      : baseMarkup;

  const resolvedTiers = tiers.map((tier) => {
    const discount = override.tierDiscounts[tier.id];
    if (discount === null || discount === undefined) return { ...tier };
    return { ...tier, discount: normalizeDiscount(discount) };
  });

  return { baseMarkup: markup, tiers: resolvedTiers };
}

/** Нижняя граница столбца: 0 у первого, иначе верхняя граница предыдущего. */
export function tierFrom(
  tiers: readonly PriceTierConfig[],
  index: number
): number {
  if (index <= 0) return 0;
  return tiers[index - 1]?.upTo ?? 0;
}

/** Подпись столбца: «до 100», «от 100 до 500», «от 1000». */
export function tierLabel(
  tiers: readonly PriceTierConfig[],
  index: number
): string {
  const tier = tiers[index];
  if (!tier) return "";
  const from = tierFrom(tiers, index);
  const to = tier.upTo;
  if (from <= 0) return to == null ? "любой объём" : `до ${to}`;
  if (to == null) return `от ${from}`;
  return `от ${from} до ${to}`;
}

/**
 * Скидка от обычной цены, которая даёт нужную накрутку к закупке при
 * базовой наценке. Пример: база +30%, хотим +25% → скидка 3,85%.
 */
export function discountForMarkup(baseMarkup: number, markup: number): number {
  const base = 1 + normalizeMarkup(baseMarkup) / 100;
  if (base <= 0) return 0;
  return clamp(round2((1 - (1 + markup / 100) / base) * 100), MIN_DISCOUNT, MAX_DISCOUNT);
}

/**
 * Накрутка к закупке, которую даёт скидка столбца при базовой наценке.
 * Пример: база +30%, скидка 10% → фактическая накрутка +17%.
 */
export function markupForDiscount(baseMarkup: number, discount: number): number {
  const base = 1 + normalizeMarkup(baseMarkup) / 100;
  return round2((base * (1 - normalizeDiscount(discount) / 100) - 1) * 100);
}

export type PriceListRowInput = {
  /** Закупочная цена (из базы или введённая вручную). */
  purchase: number | null | undefined;
  /** Ручная обычная цена: если задана, она важнее расчёта от закупки. */
  baseOverride?: number | null;
  /** Ручные цены столбцов: id столбца → цена. */
  tierOverrides?: Record<string, number | null | undefined> | null;
  /** Наценка для обычной цены, %. */
  baseMarkup: number;
  /** Правило округления автоматических цен. */
  rounding: RoundingMode;
  tiers: readonly PriceTierConfig[];
};

export type PriceListRowResult = {
  /** Обычная цена (ручная или рассчитанная). */
  base: number | null;
  /** Обычная цена введена вручную. */
  baseManual: boolean;
  /** Цены по включённым столбцам (ключ — id столбца). */
  tiers: Record<string, number | null>;
  /** Какие столбцы заданы вручную (для подсветки в редакторе). */
  manualTiers: Record<string, boolean>;
  /** Фактическая накрутка обычной цены к закупке, %. */
  markupPercent: number | null;
  /** Фактическая маржа обычной цены, %. */
  marginPercent: number | null;
};

/**
 * Все цены одной строки прайса. Ручные значения не округляются,
 * автоматические — округляются правилом `rounding`.
 */
export function computePriceListRow(
  input: PriceListRowInput
): PriceListRowResult {
  const purchase = toPrice(input.purchase);
  const manualBase = toPrice(input.baseOverride);
  const factor = 1 + normalizeMarkup(input.baseMarkup) / 100;
  const computedBase =
    purchase !== null && factor > 0
      ? applyRounding(purchase * factor, input.rounding)
      : null;
  const base = manualBase ?? computedBase;

  const tiers: Record<string, number | null> = {};
  const manualTiers: Record<string, boolean> = {};

  for (const tier of input.tiers) {
    if (!tier.enabled) continue;
    const manual = toPrice(input.tierOverrides?.[tier.id]);
    if (manual !== null) {
      tiers[tier.id] = manual;
      manualTiers[tier.id] = true;
      continue;
    }
    manualTiers[tier.id] = false;
    if (base === null) {
      tiers[tier.id] = null;
      continue;
    }
    const discount = normalizeDiscount(tier.discount);
    const price = base * Math.max(0, 1 - discount / 100);
    tiers[tier.id] = applyRounding(price, input.rounding);
  }

  return {
    base,
    baseManual: manualBase !== null,
    tiers,
    manualTiers,
    markupPercent: markupPercent(base, purchase),
    marginPercent: marginPercent(base, purchase),
  };
}

/**
 * Деньги для печати и интерфейса: «1 234» или «1 234,56».
 * Форматируем вручную (а не toLocaleString), чтобы сервер и браузер
 * давали одинаковую строку — иначе React ругался бы на гидрацию.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const fixed = round2(n).toFixed(2);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction === "00" ? grouped : `${grouped},${fraction}`;
}

/** Число для поля ввода: без пробелов, с точкой (её понимает parsePriceInput). */
export function moneyInputValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "";
  }
  return String(round2(Number(value)));
}
