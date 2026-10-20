// =========================================================
// FILE: src/lib/tax-calc.ts
// Налоги и прибыль для ООО на ОСНО (октябрь 2026).
//
// Ставки по законодательству РФ на 10.2026:
//   • НДС — 22% (основная ставка с 01.01.2026);
//   • налог на прибыль — 25% (13% федеральная часть +
//     12% региональная; регион может снижать свою часть,
//     поэтому ставку можно поменять в интерфейсе).
//
// Исходные данные прайс-листа — цены с сайта и закупочные
// цены. Считаем, что и продажная цена, и закупка уже
// содержат НДС (так почти всегда работает Россия: цена
// для покупателя «включает НДС»). Если прайс без НДС —
// включите переключатель «цены без НДС», тогда НДС
// начисляется сверху цены.
//
// Формулы (цена P с НДС, закупка C с НДС, ставка НДС r):
//   выручка без НДС      = P / (1 + r)
//   НДС в цене           = P − выручка без НДС
//   себестоимость без НДС = C / (1 + r)
//   входной НДС (вычёт)  = C − себестоимость без НДС
//   НДС к уплате         = НДС в цене − входной НДС
//   прибыль до налога    = выручка без НДС − себестоимость без НДС
//   налог на прибыль     = прибыль × 25%
//   чистыми («на руки»)  = прибыль − налог на прибыль
//
// Модуль без React и без базы: формулы используют интерфейс
// прайс-листа и тесты (tests/tax-calc.test.mjs).
// =========================================================

import { round2 } from "./price-calc";
import { VAT_RATE } from "./vat";

/** Основная ставка НДС в РФ с 2026 года — 22%. */
export const DEFAULT_VAT_RATE = VAT_RATE; // 22

/** Ставка налога на прибыль ООО (ОСНО) — 25%. */
export const DEFAULT_PROFIT_TAX_RATE = 25;

export type TaxRates = {
  /** Ставка НДС, % (0 — без НДС). */
  vatRate: number;
  /** Ставка налога на прибыль, %. */
  profitTaxRate: number;
  /** Цены в прайсе уже содержат НДС (обычный случай). */
  pricesIncludeVat: boolean;
};

export const DEFAULT_TAX_RATES: TaxRates = {
  vatRate: DEFAULT_VAT_RATE,
  profitTaxRate: DEFAULT_PROFIT_TAX_RATE,
  pricesIncludeVat: true,
};

/** Ставка из поля ввода: мусор → fallback. Диапазон 0…50%. */
export function normalizeTaxRate(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return round2(Math.min(50, Math.max(0, n)));
}

export type UnitTaxes = {
  /** Цена продажи (с НДС, как в прайсе). */
  price: number;
  /** Закупочная цена (с НДС). */
  purchase: number;
  /** Выручка без НДС (налоговая база). */
  revenueNet: number;
  /** Сколько НДС содержится в цене продажи. */
  vatInRevenue: number;
  /** Себестоимость без НДС. */
  costNet: number;
  /** НДС в закупке — вычет при расчёте НДС к уплате. */
  vatDeduction: number;
  /** НДС, который платим в бюджет (НДС продажи − вычет). */
  vatPayable: number;
  /** Прибыль до налогообложения (до вычета налога на прибыль). */
  profitBeforeTax: number;
  /** Налог на прибыль. */
  profitTax: number;
  /** Чистая прибыль — сколько остаётся компании с единицы. */
  netProfit: number;
  /** Чистая маржа: доля чистой прибыли в выручке без НДС, %. */
  netMarginPercent: number;
};

/**
 * Налоги и прибыль с одной единицы товара.
 * Возвращает null, если нет цены или закупки — считать
 * нечего (в интерфейсе такие строки помечаются «—»).
 */
export function computeUnitTaxes(
  price: number | null | undefined,
  purchase: number | null | undefined,
  rates: TaxRates
): UnitTaxes | null {
  const p = Number(price);
  const c = Number(purchase);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (!Number.isFinite(c) || c <= 0) return null;

  const vat = Math.min(50, Math.max(0, rates.vatRate)) / 100;
  const profitTax = Math.min(100, Math.max(0, rates.profitTaxRate)) / 100;
  const includesVat = rates.pricesIncludeVat !== false;

  let revenueNet: number;
  let vatInRevenue: number;
  let costNet: number;
  let vatDeduction: number;

  if (vat <= 0) {
    // Без НДС: выручка и так без налога.
    revenueNet = p;
    vatInRevenue = 0;
    costNet = c;
    vatDeduction = 0;
  } else if (includesVat) {
    revenueNet = p / (1 + vat);
    vatInRevenue = p - revenueNet;
    costNet = c / (1 + vat);
    vatDeduction = c - costNet;
  } else {
    // Цена прайса без НДС — налог начисляется сверху.
    revenueNet = p;
    vatInRevenue = p * vat;
    costNet = c;
    vatDeduction = c * vat;
  }

  const vatPayable = vatInRevenue - vatDeduction;
  const profitBeforeTax = revenueNet - costNet;
  // Убыточная позиция налогом на прибыль не облагается.
  const tax = profitBeforeTax > 0 ? profitBeforeTax * profitTax : 0;
  const netProfit = profitBeforeTax - tax;

  return {
    price: round2(p),
    purchase: round2(c),
    revenueNet: round2(revenueNet),
    vatInRevenue: round2(vatInRevenue),
    costNet: round2(costNet),
    vatDeduction: round2(vatDeduction),
    vatPayable: round2(vatPayable),
    profitBeforeTax: round2(profitBeforeTax),
    profitTax: round2(tax),
    netProfit: round2(netProfit),
    netMarginPercent:
      revenueNet > 0 ? round2((netProfit / revenueNet) * 100) : 0,
  };
}

export type TaxSummaryItem = {
  /** Обычная цена (ручная или рассчитанная). */
  price: number | null;
  /** Закупочная цена. */
  purchase: number | null;
  /** Сколько штук этой позиции планируем продать. */
  qty: number;
};

export type TaxSummary = {
  /** Позиций, для которых посчитана цена. */
  pricedCount: number;
  /** Из них — с известной закупкой (прибыль считалась). */
  costedCount: number;
  /** Позиций без закупочной цены (прибыль по ним неизвестна). */
  missingPurchaseCount: number;
  /** Выручка с НДС (сумма цен × количество). */
  revenueGross: number;
  /** Выручка без НДС — налоговая база. */
  revenueNet: number;
  /** НДС, собранный с покупателей. */
  vatInRevenue: number;
  /** Себестоимость закупок с НДС. */
  costGross: number;
  /** Себестоимость без НДС. */
  costNet: number;
  /** Входной НДС — вычет из НДС к уплате. */
  vatDeduction: number;
  /** НДС к уплате в бюджет (с учётом вычета закупок). */
  vatPayable: number;
  /** Прибыль до налога (выручка без НДС − себестоимость без НДС). */
  profitBeforeTax: number | null;
  /** Налог на прибыль. */
  profitTax: number | null;
  /** Чистая прибыль — сколько получаем после всех вычетов. */
  netProfit: number | null;
  /** Чистая маржа, % от выручки без НДС. */
  netMarginPercent: number | null;
};

/**
 * Сводка по выбранным позициям прайса. Суммы — на всё
 * запланированное количество. Прибыль считается только по
 * товарам с известной закупкой; если таких нет, поля прибыли
 * возвращают null (интерфейс покажет «—» и подсказку).
 */
export function summarizeTaxes(
  items: readonly TaxSummaryItem[],
  rates: TaxRates
): TaxSummary {
  const vat = Math.min(50, Math.max(0, rates.vatRate)) / 100;
  const includesVat = rates.pricesIncludeVat !== false;

  let pricedCount = 0;
  let costedCount = 0;
  let missingPurchaseCount = 0;
  let revenueGross = 0;
  let revenueNet = 0;
  let vatInRevenue = 0;
  let costGross = 0;
  let costNet = 0;
  let vatDeduction = 0;
  let profitBeforeTax = 0;
  let profitTax = 0;
  let netProfit = 0;

  for (const item of items) {
    const qty = Number.isFinite(item.qty) && item.qty > 0 ? item.qty : 0;
    const p = Number(item.price);
    if (!Number.isFinite(p) || p <= 0) continue;

    // Выручка и НДС — по всем позициям с ценой.
    pricedCount += 1;
    revenueGross += p * qty;
    const revNet = vat > 0 && includesVat ? p / (1 + vat) : p;
    revenueNet += revNet * qty;
    vatInRevenue += (vat > 0 ? (includesVat ? p - revNet : p * vat) : 0) * qty;

    // Прибыль — только там, где известна закупка.
    const c = Number(item.purchase);
    if (!Number.isFinite(c) || c <= 0) {
      missingPurchaseCount += 1;
      continue;
    }
    costedCount += 1;
    const costNetUnit = vat > 0 && includesVat ? c / (1 + vat) : c;
    costGross += c * qty;
    costNet += costNetUnit * qty;
    vatDeduction += (vat > 0 ? (includesVat ? c - costNetUnit : c * vat) : 0) * qty;

    const profitUnit = revNet - costNetUnit;
    const taxUnit = profitUnit > 0 ? profitUnit * rates.profitTaxRate / 100 : 0;
    profitBeforeTax += profitUnit * qty;
    profitTax += taxUnit * qty;
    netProfit += (profitUnit - taxUnit) * qty;
  }

  const hasProfit = costedCount > 0;
  return {
    pricedCount,
    costedCount,
    missingPurchaseCount,
    revenueGross: round2(revenueGross),
    revenueNet: round2(revenueNet),
    vatInRevenue: round2(vatInRevenue),
    costGross: round2(costGross),
    costNet: round2(costNet),
    vatDeduction: round2(vatDeduction),
    vatPayable: round2(vatInRevenue - vatDeduction),
    profitBeforeTax: hasProfit ? round2(profitBeforeTax) : null,
    profitTax: hasProfit ? round2(profitTax) : null,
    netProfit: hasProfit ? round2(netProfit) : null,
    netMarginPercent:
      hasProfit && revenueNet > 0
        ? round2((netProfit / revenueNet) * 100)
        : null,
  };
}
