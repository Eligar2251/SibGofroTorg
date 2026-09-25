"use client";

// =========================================================
// FILE: src/components/admin/ProfitReportDirector.tsx
// Развёрнутый многостраничный отчёт: сводка по всем позициям,
// прогноз на следующий месяц, отдельный лист на каждую позицию с
// графиками, статистикой закупок и рекомендациями.
// =========================================================

import { useMemo, type CSSProperties } from "react";
import {
  DENSITY_STYLE,
  PAPER,
  SHEET_FONT,
  Watermark,
  fmtDate,
  fmtMoney,
  fmtNum,
  fmtSum,
  resolveAccent,
  round2,
  viewRows,
  type PrintCalcRow,
  type PrintMeta,
  type PrintPosRow,
  type PrintSettings,
} from "@/components/admin/ProfitReportPrint";

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

function fmtPct(n: number, digits = 1): string {
  return `${round2(n).toFixed(digits).replace(".", ",")}%`;
}
function fmtInt(n: number): string {
  return round2(n).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return `${MONTHS_SHORT[idx] ?? m} ${y.slice(2)}`;
}
function daysBetween(a: string, b: string): number {
  const t1 = new Date(`${a}T00:00:00`).getTime();
  const t2 = new Date(`${b}T00:00:00`).getTime();
  return Math.abs(t2 - t1) / 86400000;
}

export interface DirectorMonth {
  key: string;
  label: string;
  qty: number;
  revenue: number;
  profit: number;
  benefit: number;
  orders: number;
}
export interface DirectorCustomer {
  name: string;
  qty: number;
  revenue: number;
  orders: number;
  avgQty: number;
  avgPrice: number;
  share: number;
}
export interface DirectorAdvice {
  level: "ok" | "watch" | "risk";
  text: string;
}
export interface DirectorStats {
  months: DirectorMonth[];
  activeMonths: number;
  orderCount: number;
  qty: number;
  revenue: number;
  profit: number;
  benefit: number;
  margin: number;
  unitCost: number;
  unitComp: number;
  unitPrice: number;
  unitProfit: number;
  unitBenefit: number;
  avgQtyMonth: number;
  avgRevenueMonth: number;
  avgProfitMonth: number;
  avgBenefitMonth: number;
  avgOrderQty: number;
  avgOrderRevenue: number;
  avgIntervalDays: number | null;
  customers: DirectorCustomer[];
  topCustomer: DirectorCustomer | null;
  priceMin: number;
  priceMax: number;
  priceAvg: number;
  priceSpreadPct: number;
  growthPct: number | null;
  trendPerMonth: number;
  forecastQty: number;
  forecastRevenue: number;
  forecastProfit: number;
  forecastBenefit: number;
  forecastQtyTrend: number;
  forecastRevenueTrend: number;
  forecastProfitTrend: number;
  forecastBenefitTrend: number;
  advice: DirectorAdvice[];
}

export function computeDirectorStats(
  pos: PrintPosRow,
  calc: PrintCalcRow
): DirectorStats {
  const sales = [...pos.sales].sort((a, b) => a.date.localeCompare(b.date));
  const byMonth = new Map<string, DirectorMonth>();
  for (const s of sales) {
    const key = (s.date || "").slice(0, 7);
    if (!key) continue;
    const item =
      byMonth.get(key) ??
      ({
        key,
        label: monthLabel(key),
        qty: 0,
        revenue: 0,
        profit: 0,
        benefit: 0,
        orders: 0,
      } as DirectorMonth);
    item.qty += s.qty;
    item.revenue += s.qty * s.price;
    item.orders += 1;
    byMonth.set(key, item);
  }
  const months = [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key));

  const qty = calc.qty;
  const revenue = calc.revenue;
  const profit = calc.ourProfit;
  const benefit = calc.benefit;
  const margin = calc.margin;
  const unitCost = round2(pos.productionCost);
  const unitComp = round2(pos.competitorPrice);

  const salesQty = sales.reduce((a, s) => a + s.qty, 0);
  const salesRevenue = sales.reduce((a, s) => a + s.qty * s.price, 0);
  const unitPrice =
    salesQty > 0 ? round2(salesRevenue / salesQty) : round2(pos.salePrice);

  // Пропорционально выручке раскладываем прибыль/выгоду по месяцам.
  for (const m of months) {
    const share = salesRevenue > 0 ? m.revenue / salesRevenue : 0;
    m.profit = profit * share;
    m.benefit = benefit * share;
  }

  const activeMonths = months.length;
  const monthsDivider = activeMonths || 1;
  const avgQtyMonth = qty / monthsDivider;
  const avgRevenueMonth = revenue / monthsDivider;
  const avgProfitMonth = profit / monthsDivider;
  const avgBenefitMonth = benefit / monthsDivider;

  const orderCount = sales.length || (qty > 0 ? 1 : 0);
  const avgOrderQty = orderCount > 0 ? qty / orderCount : 0;
  const avgOrderRevenue = orderCount > 0 ? revenue / orderCount : 0;
  const avgIntervalDays =
    sales.length >= 2
      ? daysBetween(sales[0].date, sales[sales.length - 1].date) /
        (sales.length - 1)
      : null;

  // Клиенты: сколько берут, как часто, по какой цене.
  const custMap = new Map<string, DirectorCustomer>();
  for (const s of sales) {
    const name = (s.customer || "—").trim() || "—";
    const item =
      custMap.get(name) ??
      { name, qty: 0, revenue: 0, orders: 0, avgQty: 0, avgPrice: 0, share: 0 };
    item.qty += s.qty;
    item.revenue += s.qty * s.price;
    item.orders += 1;
    custMap.set(name, item);
  }
  const revenueBase = revenue || salesRevenue;
  const customers = [...custMap.values()]
    .map((c) => ({
      ...c,
      avgQty: c.orders ? c.qty / c.orders : 0,
      avgPrice: c.qty ? round2(c.revenue / c.qty) : 0,
      share: revenueBase > 0 ? (c.revenue / revenueBase) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Цены продаж за период.
  const prices = sales.map((s) => s.price).filter((p) => p > 0);
  const priceMin = prices.length ? Math.min(...prices) : unitPrice;
  const priceMax = prices.length ? Math.max(...prices) : unitPrice;
  const priceAvg = prices.length ? round2(prices.reduce((a, p) => a + p, 0) / prices.length) : unitPrice;
  const priceSpreadPct = priceAvg > 0 ? ((priceMax - priceMin) / priceAvg) * 100 : 0;

  // Динамика: последняя половина месяцев против предыдущей.
  let growthPct: number | null = null;
  if (months.length >= 2) {
    const half = Math.max(1, Math.floor(months.length / 2));
    const prev = months.slice(0, months.length - half);
    const last = months.slice(months.length - half);
    const prevAvg = prev.reduce((a, m) => a + m.qty, 0) / (prev.length || 1);
    const lastAvg = last.reduce((a, m) => a + m.qty, 0) / (last.length || 1);
    if (prevAvg > 0) growthPct = ((lastAvg - prevAvg) / prevAvg) * 100;
  }

  // Тренд по месяцам (метод наименьших квадратов) → прогноз на следующий месяц.
  let trendPerMonth = 0;
  if (months.length >= 2) {
    const n = months.length;
    const meanX = (n - 1) / 2;
    const meanY = months.reduce((a, m) => a + m.qty, 0) / n;
    let num = 0;
    let den = 0;
    months.forEach((m, i) => {
      num += (i - meanX) * (m.qty - meanY);
      den += (i - meanX) ** 2;
    });
    trendPerMonth = den > 0 ? num / den : 0;
  }
  const lastQty = months.length ? months[months.length - 1].qty : 0;
  const forecastQty = Math.max(0, avgQtyMonth);
  const forecastQtyTrend = Math.max(0, lastQty + trendPerMonth);
  const priceForForecast = priceAvg || unitPrice;
  const unitProfit = round2(priceForForecast - unitCost);
  const unitBenefit = round2(unitComp - unitCost);
  const forecastRevenue = priceForForecast * forecastQty;
  const forecastProfit = unitProfit * forecastQty;
  const forecastBenefit = unitBenefit * forecastQty;
  const forecastRevenueTrend = priceForForecast * forecastQtyTrend;
  const forecastProfitTrend = unitProfit * forecastQtyTrend;
  const forecastBenefitTrend = unitBenefit * forecastQtyTrend;

  const advice: DirectorAdvice[] = [];
  if (unitCost > 0 || unitComp > 0) {
    if (unitBenefit > 0 && unitComp > 0) {
      const share = unitComp > 0 ? (unitBenefit / unitComp) * 100 : 0;
      advice.push({
        level: "ok",
        text: `Себестоимость ниже закупки у конкурента на ${fmtMoney(
          unitBenefit
        )}/шт (${fmtPct(share)}) — производство выгоднее закупки на ${fmtSum(
          round2(unitBenefit * qty)
        )} за период.`,
      });
    } else if (unitComp > 0) {
      advice.push({
        level: "risk",
        text: `Закупка у конкурента дешевле нашей себестоимости на ${fmtMoney(
          Math.abs(unitBenefit)
        )}/шт — позиция убыточна против закупки, снижать себестоимость ниже ${fmtMoney(
          unitComp
        )}.`,
      });
    }
    if (unitProfit < 0) {
      advice.push({
        level: "risk",
        text: `Средняя цена продажи ${fmtMoney(
          priceForForecast
        )} ниже себестоимости ${fmtMoney(
          unitCost
        )} на ${fmtMoney(Math.abs(unitProfit))}/шт — поднять цену минимум до ${fmtMoney(
          unitCost
        )}.`,
      });
    } else if (margin < 10) {
      advice.push({
        level: "risk",
        text: `Маржа ${fmtPct(margin)} ниже 10% — поднять отпускную цену до ${fmtMoney(
          Math.ceil(unitCost / 0.85)
        )} (маржа 15%) или снизить себестоимость.`,
      });
    } else if (margin < 20) {
      advice.push({
        level: "watch",
        text: `Маржа ${fmtPct(margin)} — ниже целевых 20%: цена от ${fmtMoney(
          Math.ceil(unitCost / 0.8)
        )} даёт 20%, потеря выручки при этом ${fmtMoney(
          round2(Math.max(0, Math.ceil(unitCost / 0.8) - priceForForecast) * qty)
        )} по текущему объёму.`,
      });
    } else {
      advice.push({
        level: "ok",
        text: `Маржа ${fmtPct(margin)} — прибыль ${fmtMoney(
          unitProfit
        )} с каждой штуки, за период ${fmtSum(profit)}.`,
      });
    }
    if (unitComp > 0 && priceForForecast > unitComp * 1.05) {
      advice.push({
        level: "watch",
        text: `Цена выше конкурента на ${fmtPct(
          ((priceForForecast - unitComp) / unitComp) * 100
        )} — держать не выше ${fmtMoney(round2(unitComp * 0.98))} для сохранения объёма.`,
      });
    } else if (unitComp > 0 && priceForForecast < unitComp * 0.9) {
      advice.push({
        level: "ok",
        text: `Цена ниже конкурента на ${fmtPct(
          ((unitComp - priceForForecast) / unitComp) * 100
        )} — есть запас для повышения до ${fmtMoney(round2(unitComp * 0.95))}.`,
      });
    }
  }
  if (growthPct !== null) {
    advice.push({
      level: growthPct >= 0 ? "ok" : "watch",
      text:
        growthPct >= 0
          ? `Продажи во второй половине периода выше на ${fmtPct(
              growthPct
            )} — держать запас не ниже ${fmtInt(avgQtyMonth)} шт/мес.`
          : `Продажи во второй половине периода ниже на ${fmtPct(
              Math.abs(growthPct)
            )} — не набирать больше ${fmtInt(avgQtyMonth)} шт/мес.`,
    });
  }
  if (avgIntervalDays !== null) {
    advice.push({
      level: "ok",
      text: `Берут в среднем ${fmtNum(
        avgOrderQty,
        0
      )} шт за заказ, интервал между заказами ${Math.round(
        avgIntervalDays
      )} дн. — ориентир для графика отгрузок.`,
    });
  }
  if (customers.length > 0) {
    const top = customers[0];
    advice.push({
      level: top.share > 60 ? "watch" : "ok",
      text:
        top.share > 60
          ? `${top.name} даёт ${fmtPct(
              top.share
            )} выручки позиции — зависимость от одного клиента, искать ещё покупателей.`
          : `Крупнейший клиент ${top.name} — ${fmtPct(
              top.share
            )} выручки, база клиентов распределена.`,
    });
  }
  advice.push({
    level: "ok",
    text: `Прогноз на следующий месяц: ${fmtInt(
      forecastQty
    )} шт, выручка ${fmtSum(forecastRevenue)}, прибыль ${fmtSum(
      forecastProfit
    )}, выгода ${fmtSum(forecastBenefit)}.`,
  });

  return {
    months,
    activeMonths,
    orderCount,
    qty,
    revenue,
    profit,
    benefit,
    margin,
    unitCost,
    unitComp,
    unitPrice,
    unitProfit: round2(priceForForecast - unitCost),
    unitBenefit,
    avgQtyMonth,
    avgRevenueMonth,
    avgProfitMonth,
    avgBenefitMonth,
    avgOrderQty,
    avgOrderRevenue,
    avgIntervalDays,
    customers,
    topCustomer: customers[0] ?? null,
    priceMin,
    priceMax,
    priceAvg,
    priceSpreadPct,
    growthPct,
    trendPerMonth,
    forecastQty,
    forecastRevenue,
    forecastProfit,
    forecastBenefit,
    forecastQtyTrend,
    forecastRevenueTrend,
    forecastProfitTrend,
    forecastBenefitTrend,
    advice,
  };
}

export interface DirectorSummary {
  stats: { pos: PrintPosRow; calc: PrintCalcRow; item: DirectorStats }[];
  totals: {
    qty: number;
    revenue: number;
    profit: number;
    benefit: number;
    margin: number;
    avgQtyMonth: number;
    avgOrderQty: number;
    orderCount: number;
    forecastQty: number;
    forecastRevenue: number;
    forecastProfit: number;
    forecastBenefit: number;
    forecastQtyTrend: number;
    forecastRevenueTrend: number;
    forecastProfitTrend: number;
    forecastBenefitTrend: number;
  };
  customers: DirectorCustomer[];
  advice: DirectorAdvice[];
}

export function computeDirectorSummary(
  positions: PrintPosRow[],
  calcs: PrintCalcRow[],
  totals: PrintCalcRow
): DirectorSummary {
  const stats = positions.map((pos, i) => ({
    pos,
    calc: calcs[i],
    item: computeDirectorStats(pos, calcs[i]),
  }));
  const sum = (pick: (s: DirectorStats) => number) =>
    stats.reduce((a, s) => a + pick(s.item), 0);

  const custMap = new Map<string, DirectorCustomer>();
  for (const { item, pos, calc } of stats) {
    for (const c of item.customers) {
      const found = custMap.get(c.name);
      if (found) {
        found.qty += c.qty;
        found.revenue += c.revenue;
        found.orders += c.orders;
      } else {
        custMap.set(c.name, { ...c });
      }
    }
    void pos;
    void calc;
  }
  const revenueBase = totals.revenue;
  const customers = [...custMap.values()]
    .map((c) => ({
      ...c,
      avgQty: c.orders ? c.qty / c.orders : 0,
      avgPrice: c.qty ? round2(c.revenue / c.qty) : 0,
      share: revenueBase > 0 ? (c.revenue / revenueBase) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const margin = totals.revenue > 0 ? (totals.ourProfit / totals.revenue) * 100 : 0;
  const summaryTotals = {
    qty: totals.qty,
    revenue: totals.revenue,
    profit: totals.ourProfit,
    benefit: totals.benefit,
    margin,
    avgQtyMonth: sum((s) => s.avgQtyMonth),
    avgOrderQty:
      sum((s) => s.orderCount) > 0
        ? sum((s) => s.avgOrderQty * s.orderCount) / sum((s) => s.orderCount)
        : 0,
    orderCount: sum((s) => s.orderCount),
    forecastQty: sum((s) => s.forecastQty),
    forecastRevenue: sum((s) => s.forecastRevenue),
    forecastProfit: sum((s) => s.forecastProfit),
    forecastBenefit: sum((s) => s.forecastBenefit),
    forecastQtyTrend: sum((s) => s.forecastQtyTrend),
    forecastRevenueTrend: sum((s) => s.forecastRevenueTrend),
    forecastProfitTrend: sum((s) => s.forecastProfitTrend),
    forecastBenefitTrend: sum((s) => s.forecastBenefitTrend),
  };

  const advice: DirectorAdvice[] = [];
  const byBenefit = [...stats].sort((a, b) => b.item.benefit - a.item.benefit);
  const byMargin = [...stats].sort((a, b) => a.item.margin - b.item.margin);
  if (byBenefit.length > 0) {
    const best = byBenefit[0];
    advice.push({
      level: "ok",
      text: `Наибольшая выгода: ${best.pos.name} — ${fmtSum(
        best.item.benefit
      )} (${fmtPct(best.item.margin)} маржи, ${fmtInt(best.item.qty)} шт).`,
    });
  }
  const risks = stats.filter((s) => s.item.margin < 10 || s.item.unitProfit < 0);
  if (risks.length > 0) {
    advice.push({
      level: "risk",
      text: `Низкая маржа у ${risks.length} поз.: ${risks
        .slice(0, 4)
        .map((s) => `${s.pos.name} (${fmtPct(s.item.margin)})`)
        .join(", ")}${risks.length > 4 ? " и др." : ""} — пересмотреть отпускные цены.`,
    });
  }
  const falling = stats.filter((s) => (s.item.growthPct ?? 0) < -10);
  if (falling.length > 0) {
    advice.push({
      level: "watch",
      text: `Спад продаж у ${falling.length} поз.: ${falling
        .slice(0, 4)
        .map((s) => s.pos.name)
        .join(", ")}${falling.length > 4 ? " и др." : ""} — проверить клиентов и цены.`,
    });
  }
  const topCustomer = customers[0];
  if (topCustomer && topCustomer.share > 30) {
    advice.push({
      level: "watch",
      text: `Клиент ${topCustomer.name} даёт ${fmtPct(
        topCustomer.share
      )} выручки — высокая зависимость.`,
    });
  }
  if (byMargin.length > 0) {
    const worst = byMargin[0];
    advice.push({
      level: worst.item.margin >= 15 ? "ok" : "watch",
      text:
        worst.item.margin >= 15
          ? `Минимальная маржа — ${fmtPct(worst.item.margin)} (${
              worst.pos.name
            }); все позиции с маржой выше 15%.`
          : `Минимальная маржа — ${fmtPct(worst.item.margin)} (${
              worst.pos.name
            }) — держать под контролем.`,
    });
  }
  advice.push({
    level: "ok",
    text: `Прогноз на следующий месяц по отчёту: ${fmtInt(
      summaryTotals.forecastQty
    )} шт, выручка ${fmtSum(
      summaryTotals.forecastRevenue
    )}, прибыль ${fmtSum(summaryTotals.forecastProfit)}, выгода ${fmtSum(
      summaryTotals.forecastBenefit
    )}.`,
  });

  return { stats, totals: summaryTotals, customers, advice };
}

// ── Элементы листа ──
function Kpi({
  label,
  value,
  hint,
  wide,
}: {
  label: string;
  value: string;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <div className={`prd-kpi${wide ? " prd-kpi--wide" : ""}`}>
      <div className="prd-kpi__label">{label}</div>
      <div className="prd-kpi__value">{value}</div>
      {hint ? <div className="prd-kpi__hint">{hint}</div> : null}
    </div>
  );
}

function BarsChartD({
  points,
  forecast,
  avg,
  caption,
  showForecast = true,
  wide = false,
}: {
  points: { key: string; label: string; qty: number }[];
  forecast: number;
  avg: number;
  caption: string;
  showForecast?: boolean;
  wide?: boolean;
}) {
  const cols = showForecast
    ? [...points, { key: "__fc", label: "прогноз", qty: forecast }]
    : points;
  const max = Math.max(avg, forecast, ...cols.map((c) => c.qty), 1);
  return (
    <div className="prd-chart">
      <div className="prd-chart__cap">{caption}</div>
      <div className={`prd-bars${wide ? " prd-bars--wide" : ""}`}>
        <div
          className="prd-bars__avg"
          style={{ bottom: `${(avg / max) * 100}%` }}
          title={`среднее ${fmtNum(avg, 0)}`}
        />
        {cols.map((c) => (
          <div className="prd-bar" key={c.key}>
            <div className="prd-bar__val">{fmtInt(c.qty)}</div>
            <div className="prd-bar__col">
              <span
                className={`prd-bar__fill${
                  c.key === "__fc" ? " prd-bar__fill--fc" : ""
                }`}
                style={{ height: `${Math.max(1.5, (c.qty / max) * 100)}%` }}
              />
            </div>
            <div className="prd-bar__lab">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientsBars({
  customers,
  unit,
  caption,
}: {
  customers: DirectorCustomer[];
  unit: string;
  caption: string;
}) {
  const list = customers.slice(0, 6);
  const max = Math.max(...list.map((c) => c.qty), 1);
  return (
    <div className="prd-chart">
      <div className="prd-chart__cap">{caption}</div>
      {list.length === 0 ? (
        <p className="prd-empty">Продаж за период нет</p>
      ) : (
        <div className="prd-rows">
          {list.map((c) => (
            <div className="prd-row" key={c.name}>
              <span className="prd-row__name" title={c.name}>
                {c.name}
              </span>
              <span className="prd-row__track">
                <span
                  className="prd-row__fill"
                  style={{ width: `${Math.max(2, (c.qty / max) * 100)}%` }}
                />
              </span>
              <span className="prd-row__val">
                {fmtNum(c.qty, 0)} {unit} · {c.orders} зак. · {fmtPct(c.share)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PriceBars({
  unitCost,
  unitComp,
  priceAvg,
  unitProfit,
  unitBenefit,
  caption,
}: {
  unitCost: number;
  unitComp: number;
  priceAvg: number;
  unitProfit: number;
  unitBenefit: number;
  caption: string;
}) {
  const bars = [
    { label: "Себестоимость (Мы)", value: unitCost, cls: "prd-prow__fill--solid" },
    { label: "Цена конкурента", value: unitComp, cls: "prd-prow__fill--gray" },
    { label: "Средняя цена продажи", value: priceAvg, cls: "prd-prow__fill--hatch" },
  ];
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="prd-chart">
      <div className="prd-chart__cap">{caption}</div>
      <div className="prd-rows">
        {bars.map((b) => (
          <div className="prd-row prd-row--price" key={b.label}>
            <span className="prd-row__name">{b.label}</span>
            <span className="prd-row__track">
              <span
                className={`prd-row__fill ${b.cls}`}
                style={{ width: `${Math.max(2, (b.value / max) * 100)}%` }}
              />
            </span>
            <span className="prd-row__val">{fmtMoney(b.value)}</span>
          </div>
        ))}
      </div>
      <div className="prd-price-note">
        <span>Прибыль с штуки: {fmtMoney(unitProfit)}</span>
        <span>Выгода производства с штуки: {fmtMoney(unitBenefit)}</span>
      </div>
    </div>
  );
}

function AdviceList({ advice }: { advice: DirectorAdvice[] }) {
  const mark: Record<DirectorAdvice["level"], string> = {
    ok: "✓",
    watch: "!",
    risk: "×",
  };
  return (
    <ul className="prd-advice">
      {advice.map((a, i) => (
        <li className={`prd-advice__item prd-advice__item--${a.level}`} key={i}>
          <span className="prd-advice__mark">{mark[a.level]}</span>
          <span>{a.text}</span>
        </li>
      ))}
    </ul>
  );
}

function MonthsForecastTable({
  stats,
}: {
  stats: DirectorStats;
}) {
  const rows = stats.months.map((m) => ({
    key: m.key,
    label: m.label,
    qty: m.qty,
    revenue: m.revenue,
    profit: m.profit,
    benefit: m.benefit,
    customers: 0,
    kind: "month" as const,
  }));
  return (
    <table className="prd-table prd-table--months">
      <thead>
        <tr>
          <th>Месяц</th>
          <th>Кол-во, шт</th>
          <th>Выручка</th>
          <th>Прибыль</th>
          <th>Выгода производства</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="prd-td-name">{r.label}</td>
            <td className="prd-td-num">{fmtNum(r.qty, 0)}</td>
            <td className="prd-td-num">{fmtSum(r.revenue)}</td>
            <td className="prd-td-num">{fmtSum(r.profit)}</td>
            <td className="prd-td-num">{fmtSum(r.benefit)}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} className="prd-td-empty">
              Продаж за период нет
            </td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr>
          <td>Среднее за {stats.activeMonths || 1} мес.</td>
          <td className="prd-td-num">{fmtInt(stats.forecastQty)}</td>
          <td className="prd-td-num">{fmtSum(stats.forecastRevenue)}</td>
          <td className="prd-td-num">{fmtSum(stats.forecastProfit)}</td>
          <td className="prd-td-num">{fmtSum(stats.forecastBenefit)}</td>
        </tr>
        <tr>
          <td>Прогноз по тренду продаж</td>
          <td className="prd-td-num">{fmtInt(stats.forecastQtyTrend)}</td>
          <td className="prd-td-num">{fmtSum(stats.forecastRevenueTrend)}</td>
          <td className="prd-td-num">{fmtSum(stats.forecastProfitTrend)}</td>
          <td className="prd-td-num">{fmtSum(stats.forecastBenefitTrend)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function SalesTable({
  pos,
  stats,
}: {
  pos: PrintPosRow;
  stats: DirectorStats;
}) {
  const base = stats.revenue || 1;
  // На один лист A4 помещается ~14 строк — остальные сворачиваем в пометку.
  const limit = 14;
  const rows = pos.sales.slice(0, limit);
  const hidden = pos.sales.length - rows.length;
  return (
    <table className="prd-table prd-table--sales">
      <thead>
        <tr>
          <th>Дата</th>
          <th>Клиент</th>
          <th>Кол-во, шт</th>
          <th>Цена</th>
          <th>Сумма</th>
          <th>Доля</th>
          <th>Отклонение от себестоимости</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          const sum = s.qty * s.price;
          const delta = s.price - stats.unitCost;
          return (
            <tr key={s.id}>
              <td className="prd-td-num">{fmtDate(s.date)}</td>
              <td className="prd-td-name">{s.customer || "—"}</td>
              <td className="prd-td-num">{fmtNum(s.qty, 0)}</td>
              <td className="prd-td-num">{fmtMoney(s.price)}</td>
              <td className="prd-td-num">{fmtSum(sum)}</td>
              <td className="prd-td-num">{fmtPct((sum / base) * 100)}</td>
              <td className="prd-td-num">
                {delta >= 0 ? "+" : "−"}
                {fmtMoney(Math.abs(delta))}/шт
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} className="prd-td-empty">
              Продаж за период нет
            </td>
          </tr>
        )}
        {hidden > 0 && (
          <tr>
            <td colSpan={7} className="prd-td-empty">
              и ещё {hidden} продаж(и) за период
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function StructureBar({
  items,
  caption,
}: {
  items: { id: string; label: string; value: number; share: number }[];
  caption: string;
}) {
  const tones = [
    "prd-seg--1",
    "prd-seg--2",
    "prd-seg--3",
    "prd-seg--4",
    "prd-seg--5",
    "prd-seg--6",
    "prd-seg--7",
    "prd-seg--8",
  ];
  return (
    <div className="prd-chart">
      <div className="prd-chart__cap">{caption}</div>
      {items.length === 0 ? (
        <p className="prd-empty">Данных нет</p>
      ) : (
        <>
          <div className="prd-stack">
            {items.map((it, i) => (
              <span
                key={it.id}
                className={`prd-seg ${tones[i % tones.length]}`}
                style={{ width: `${Math.max(1, it.share)}%` }}
                title={`${it.label}: ${fmtPct(it.share)}`}
              />
            ))}
          </div>
          <div
            className="prd-legend"
            style={{
              "--prd-legend-cols": items.length <= 4 ? 1 : 2,
            } as CSSProperties}
          >
            {items.map((it, i) => (
              <div className="prd-legend__item" key={it.id}>
                <span className={`prd-legend__dot ${tones[i % tones.length]}`} />
                <span className="prd-legend__name" title={it.label}>
                  {it.label}
                </span>
                <span className="prd-legend__val">
                  {fmtSum(it.value)} · {fmtPct(it.share)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Отчёт ──
export function DirectorReport({
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
  const summary = useMemo(
    () => {
      // Строки с учётом скрытия позиций без продаж и выбранной сортировки.
      const view = viewRows(positions, calcs, settings);
      return computeDirectorSummary(
        view.map((v) => v.pos),
        view.map((v) => v.calc),
        totals
      );
    },
    [positions, calcs, totals, settings]
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

  const pages: { key: string; node: React.ReactNode }[] = [];

  // Сколько будет страниц всего — нужно для колонтитула «Лист X из Y».
  const itemCount = settings.directorItems
    ? settings.directorTop > 0
      ? Math.min(settings.directorTop, summary.stats.length)
      : summary.stats.length
    : 0;
  const totalPages = (settings.directorSummary ? 1 : 0) + itemCount;
  const watermark = settings.watermark.trim();
  const footNote =
    settings.footerText.trim() || meta.company || "ООО «СибГофроТорг»";

  if (settings.directorSummary) {
    const structure = summary.stats
      .map((s) => ({
        id: s.pos.id,
        label: s.pos.name || "—",
        value: s.item.benefit,
        share: 0,
      }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    const rest = structure.slice(8);
    const top = structure.slice(0, 8);
    const restSum = rest.reduce((a, s) => a + s.value, 0);
    const structureTotal = structure.reduce((a, s) => a + s.value, 0) || 1;
    const items = [
      ...top.map((s) => ({ ...s, share: (s.value / structureTotal) * 100 })),
      ...(rest.length
        ? [
            {
              id: "__rest",
              label: `Прочие (${rest.length})`,
              value: restSum,
              share: (restSum / structureTotal) * 100,
            },
          ]
        : []),
    ];

    pages.push({
      key: "summary",
      node: (
        <section className="prd-page">
          {watermark ? <Watermark text={watermark} /> : null}
          <header className="prd-head">
            <div>
              <div className="prd-company">
                {meta.company || "ООО «СибГофроТорг»"}
              </div>
              <h2 className="prd-title">
                {meta.title || "План по выгоде продаж"}
              </h2>
            </div>
            <div className="prd-head__meta">
              {settings.showPeriod && <div>Период: {periodText}</div>}
              {settings.showGenDate && <div>Сформирован: {genDate}</div>}
              <div>Позиций: {summary.stats.length}</div>
            </div>
          </header>

          <div className="prd-kpis">
            <Kpi label="Выручка за период" value={fmtSum(summary.totals.revenue)} />
            <Kpi
              label="Прибыль с производства"
              value={fmtSum(summary.totals.profit)}
              hint={`маржа ${fmtPct(summary.totals.margin)}`}
            />
            <Kpi
              label="Выгода против закупки"
              value={fmtSum(summary.totals.benefit)}
            />
            <Kpi
              label="Продано"
              value={`${fmtInt(summary.totals.qty)} шт`}
              hint={`${summary.totals.orderCount} заказов`}
            />
            <Kpi
              label="Обычно берут"
              value={`${fmtInt(summary.totals.avgQtyMonth)} шт/мес`}
              hint={`средний заказ ${fmtInt(summary.totals.avgOrderQty)} шт`}
            />
            <Kpi
              label="Прогноз: количество"
              value={`${fmtInt(summary.totals.forecastQty)} шт`}
              hint={`по тренду ${fmtInt(summary.totals.forecastQtyTrend)} шт`}
            />
            <Kpi
              label="Прогноз: выручка"
              value={fmtSum(summary.totals.forecastRevenue)}
              hint={`по тренду ${fmtSum(summary.totals.forecastRevenueTrend)}`}
            />
            <Kpi
              label="Прогноз: выгода"
              value={fmtSum(summary.totals.forecastBenefit)}
              hint={`по тренду ${fmtSum(summary.totals.forecastBenefitTrend)}`}
            />
          </div>

          <div className="prd-section">
            <h3 className="prd-h3">Сводная таблица по позициям</h3>
            <table className="prd-table prd-table--grid">
              <thead>
                <tr>
                  <th style={{ "--prd-colw": "3.6%" } as CSSProperties}>№</th>
                  <th style={{ "--prd-colw": "21%" } as CSSProperties}>
                    Позиция
                  </th>
                  <th style={{ "--prd-colw": "6.6%" } as CSSProperties}>
                    Кол-во, шт
                  </th>
                  <th style={{ "--prd-colw": "7.6%" } as CSSProperties}>
                    Обычно шт/мес
                  </th>
                  <th style={{ "--prd-colw": "6.6%" } as CSSProperties}>Цена</th>
                  <th style={{ "--prd-colw": "6.6%" } as CSSProperties}>
                    Себест.
                  </th>
                  <th style={{ "--prd-colw": "6.6%" } as CSSProperties}>
                    Конкур.
                  </th>
                  <th style={{ "--prd-colw": "8%" } as CSSProperties}>
                    Выручка
                  </th>
                  <th style={{ "--prd-colw": "7.6%" } as CSSProperties}>
                    Прибыль
                  </th>
                  <th style={{ "--prd-colw": "7.6%" } as CSSProperties}>
                    Выгода
                  </th>
                  <th style={{ "--prd-colw": "5.6%" } as CSSProperties}>
                    Маржа
                  </th>
                  <th style={{ "--prd-colw": "8%" } as CSSProperties}>
                    Динамика
                  </th>
                  <th style={{ "--prd-colw": "14.2%" } as CSSProperties}>
                    Прогноз мес.
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.stats.map((s, i) => (
                  <tr key={s.pos.id}>
                    <td className="prd-td-num">{i + 1}</td>
                    <td className="prd-td-name">{s.pos.name || "—"}</td>
                    <td className="prd-td-num">{fmtNum(s.item.qty, 0)}</td>
                    <td className="prd-td-num">{fmtInt(s.item.avgQtyMonth)}</td>
                    <td className="prd-td-num">{fmtMoney(s.item.unitPrice)}</td>
                    <td className="prd-td-num">{fmtMoney(s.item.unitCost)}</td>
                    <td className="prd-td-num">{fmtMoney(s.item.unitComp)}</td>
                    <td className="prd-td-num">{fmtSum(s.item.revenue)}</td>
                    <td className="prd-td-num">{fmtSum(s.item.profit)}</td>
                    <td className="prd-td-num prd-strong">
                      {fmtSum(s.item.benefit)}
                    </td>
                    <td className="prd-td-num">{fmtPct(s.item.margin)}</td>
                    <td className="prd-td-num">
                      {s.item.growthPct === null
                        ? "—"
                        : `${s.item.growthPct >= 0 ? "▲" : "▼"} ${fmtPct(
                            Math.abs(s.item.growthPct)
                          )}`}
                    </td>
                    <td className="prd-td-num">
                      {fmtInt(s.item.forecastQty)} / {fmtSum(s.item.forecastRevenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td className="prd-td-name">ИТОГО</td>
                  <td className="prd-td-num">{fmtNum(summary.totals.qty, 0)}</td>
                  <td className="prd-td-num">{fmtInt(summary.totals.avgQtyMonth)}</td>
                  <td className="prd-td-num">—</td>
                  <td className="prd-td-num">—</td>
                  <td className="prd-td-num">—</td>
                  <td className="prd-td-num">{fmtSum(summary.totals.revenue)}</td>
                  <td className="prd-td-num">{fmtSum(summary.totals.profit)}</td>
                  <td className="prd-td-num prd-strong">
                    {fmtSum(summary.totals.benefit)}
                  </td>
                  <td className="prd-td-num">{fmtPct(summary.totals.margin)}</td>
                  <td className="prd-td-num">—</td>
                  <td className="prd-td-num">
                    {fmtInt(summary.totals.forecastQty)} /{" "}
                    {fmtSum(summary.totals.forecastRevenue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {settings.directorCharts && (
            <div className="prd-cols2">
              <StructureBar items={items} caption="Структура выгоды производства" />
              <BarsChartD
                points={summary.stats
                  .map((s) => ({
                    key: s.pos.id,
                    label: s.pos.name || "—",
                    qty: s.item.forecastQty,
                  }))
                  .sort((a, b) => b.qty - a.qty)
                  .slice(0, 8)}
                forecast={0}
                avg={summary.totals.avgQtyMonth}
                caption="Прогноз спроса по позициям, шт/мес"
                showForecast={false}
                wide
              />
            </div>
          )}

          {settings.directorCharts && summary.stats.length > 0 && (
            <div className="prd-section">
              <h3 className="prd-h3">
                Где выгода: рейтинг позиций за период
              </h3>
              <div className="prd-rows prd-rows--lead">
                {[...summary.stats]
                  .sort((a, b) => b.item.benefit - a.item.benefit)
                  .slice(0, 12)
                  .map((s, i) => {
                    const max = Math.max(
                      ...[...summary.stats].map((x) => Math.abs(x.item.benefit)),
                      1
                    );
                    return (
                      <div className="prd-row prd-row--lead" key={s.pos.id}>
                        <span className="prd-row__name">
                          {i + 1}. {s.pos.name || "—"}
                        </span>
                        <span className="prd-row__track">
                          <span
                            className={`prd-row__fill${
                              s.item.benefit < 0 ? " prd-row__fill--neg" : ""
                            }`}
                            style={{
                              width: `${Math.max(
                                2,
                                (Math.abs(s.item.benefit) / max) * 100
                              )}%`,
                            }}
                          />
                        </span>
                        <span className="prd-row__val">
                          {fmtSum(s.item.benefit)} · {fmtPct(s.item.margin)} ·{" "}
                          {fmtInt(s.item.qty)} шт
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {settings.directorClients && (
            <div className="prd-section">
              <h3 className="prd-h3">Клиенты по всем позициям</h3>
              <table className="prd-table prd-table--grid">
                <thead>
                  <tr>
                    <th>Клиент</th>
                    <th>Заказов</th>
                    <th>Кол-во, шт</th>
                    <th>Средний заказ, шт</th>
                    <th>Средняя цена</th>
                    <th>Выручка</th>
                    <th>Доля</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.customers.slice(0, 12).map((c) => (
                    <tr key={c.name}>
                      <td className="prd-td-name">{c.name}</td>
                      <td className="prd-td-num">{c.orders}</td>
                      <td className="prd-td-num">{fmtNum(c.qty, 0)}</td>
                      <td className="prd-td-num">{fmtInt(c.avgQty)}</td>
                      <td className="prd-td-num">{fmtMoney(c.avgPrice)}</td>
                      <td className="prd-td-num">{fmtSum(c.revenue)}</td>
                      <td className="prd-td-num">{fmtPct(c.share)}</td>
                    </tr>
                  ))}
                  {summary.customers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="prd-td-empty">
                        Продаж за период нет
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {settings.directorAdvice && (
            <div className="prd-section">
              <h3 className="prd-h3">Выводы по ассортименту</h3>
              <AdviceList advice={summary.advice} />
            </div>
          )}

          {settings.directorOverall && (
            <div className="prd-foot">
              <span>{footNote}</span>
              <span>
                Лист 1 из {totalPages}
              </span>
            </div>
          )}
        </section>
      ),
    });
  }

  if (settings.directorItems) {
    const list =
      settings.directorTop > 0
        ? summary.stats.slice(0, settings.directorTop)
        : summary.stats;
    list.forEach((s, idx) => {
      const { pos, item } = s;
      pages.push({
        key: pos.id,
        node: (
          <section className="prd-page">
            {watermark ? <Watermark text={watermark} /> : null}
            <header className="prd-head prd-head--item">
              <div>
                <div className="prd-item-index">
                  Позиция {idx + 1} из {list.length}
                </div>
                <h2 className="prd-item-title">{pos.name || "—"}</h2>
                <div className="prd-item-sub">
                  {pos.sku ? `Артикул ${pos.sku} · ` : ""}
                  {fmtNum(item.qty, 0)} шт за период · {item.orderCount} заказов
                  {item.topCustomer ? ` · основной клиент ${item.topCustomer.name}` : ""}
                </div>
              </div>
              <div className="prd-head__meta">
                {settings.showPeriod && <div>Период: {periodText}</div>}
                <div>
                  Выгода: <strong>{fmtSum(item.benefit)}</strong>
                </div>
                <div>
                  Маржа: <strong>{fmtPct(item.margin)}</strong>
                </div>
              </div>
            </header>

            <div className="prd-kpis prd-kpis--item">
              <Kpi label="Выручка" value={fmtSum(item.revenue)} />
              <Kpi label="Прибыль" value={fmtSum(item.profit)} />
              <Kpi label="Выгода производства" value={fmtSum(item.benefit)} />
              <Kpi label="Продано" value={`${fmtNum(item.qty, 0)} шт`} />
              <Kpi
                label="Обычно берут"
                value={`${fmtInt(item.avgQtyMonth)} шт/мес`}
                hint={`в активный месяц`}
              />
              <Kpi
                label="Средний заказ"
                value={`${fmtNum(item.avgOrderQty, 0)} шт`}
                hint={item.avgIntervalDays !== null ? `интервал ${Math.round(item.avgIntervalDays)} дн.` : undefined}
              />
              <Kpi label="Себестоимость 1 шт" value={fmtMoney(item.unitCost)} />
              <Kpi label="Цена конкурента 1 шт" value={fmtMoney(item.unitComp)} />
              <Kpi
                label="Средняя цена продажи"
                value={fmtMoney(item.priceAvg || item.unitPrice)}
                hint={`от ${fmtMoney(item.priceMin)} до ${fmtMoney(item.priceMax)}`}
              />
              <Kpi label="Прибыль с 1 шт" value={fmtMoney(item.unitProfit)} />
              <Kpi label="Выгода с 1 шт" value={fmtMoney(item.unitBenefit)} />
              <Kpi
                label="Динамика продаж"
                value={
                  item.growthPct === null
                    ? "—"
                    : `${item.growthPct >= 0 ? "▲" : "▼"} ${fmtPct(
                        Math.abs(item.growthPct)
                      )}`
                }
                hint={item.trendPerMonth ? `тренд ${item.trendPerMonth >= 0 ? "+" : "−"}${fmtInt(Math.abs(item.trendPerMonth))} шт/мес` : undefined}
              />
            </div>

            {settings.directorCharts && (
              <>
                <BarsChartD
                  points={item.months.map((m) => ({
                    key: m.key,
                    label: m.label,
                    qty: m.qty,
                  }))}
                  forecast={item.forecastQty}
                  avg={item.avgQtyMonth}
                  caption="Продажи по месяцам, шт (пунктир — среднее, штриховка — прогноз продаж)"
                />
                <div className="prd-cols2">
                  {settings.directorClients && (
                    <ClientsBars
                      customers={item.customers}
                      unit={pos.unit || "шт"}
                      caption="Как обычно берут: клиенты, объём и доля"
                    />
                  )}
                  <PriceBars
                    unitCost={item.unitCost}
                    unitComp={item.unitComp}
                    priceAvg={item.priceAvg || item.unitPrice}
                    unitProfit={item.unitProfit}
                    unitBenefit={item.unitBenefit}
                    caption="Цены за единицу и результат"
                  />
                </div>
              </>
            )}

            {settings.directorForecast && (
              <div className="prd-section">
                <h3 className="prd-h3">
                  Продажи по месяцам и прогноз на следующий месяц
                </h3>
                <MonthsForecastTable stats={item} />
              </div>
            )}

            {settings.directorAdvice && (
              <div className="prd-section">
                <h3 className="prd-h3">Рекомендации</h3>
                <AdviceList advice={item.advice} />
              </div>
            )}

            {settings.directorSales && (
              <div className="prd-section">
                <h3 className="prd-h3">Продажи за период</h3>
                <SalesTable pos={pos} stats={item} />
              </div>
            )}

            {settings.directorOverall && (
              <div className="prd-foot">
                <span>
                  {footNote}
                  {settings.footerText.trim() ? "" : ` · ${pos.name}`}
                </span>
                <span>
                  Лист {idx + (settings.directorSummary ? 2 : 1)} из {totalPages}
                </span>
              </div>
            )}
          </section>
        ),
      });
    });
  }

  const mono = settings.mono;
  return (
    <div
      className={`pr-doc pr-doc--${settings.orientation}${
        mono ? " pr-doc--mono" : ""
      }`}
    >
      {pages.map((p, i) => (
        <div
          className="pr-doc-page"
          key={p.key}
          style={{ marginBottom: i === pages.length - 1 ? 0 : "8mm" }}
        >
          {p.node}
        </div>
      ))}
    </div>
  );
}

// ── Стили отчёта ──
export function buildDirectorCss(s: PrintSettings): string {
  const dens = DENSITY_STYLE[s.density];
  const paper = PAPER[s.orientation];
  const fit = dens.base / 9;
  const accent = resolveAccent(s);
  const c = s.mono
    ? {
        ink: "#111111",
        soft: "#444444",
        mute: "#6b6b6b",
        line: "#8f8f8f",
        light: "#d0d0d0",
        band: "#f2f2f2",
        band2: "#e6e6e6",
        head: "#111111",
        headInk: "#ffffff",
        ok: "#111111",
        watch: "#333333",
        risk: "#000000",
      }
    : {
        ink: "#0f172a",
        soft: "#334155",
        mute: "#64748b",
        line: "#cbd5e1",
        light: "#e2e8f0",
        band: "#f8fafc",
        band2: "#eef2f7",
        head: accent ? accent.main : "#1e293b",
        headInk: "#ffffff",
        ok: "#15803d",
        watch: "#b45309",
        risk: "#b91c1c",
      };

  return `
/* ── Развёрнутый отчёт: страницы ── */
.pr-doc { display: flex; flex-direction: column; align-items: center; width: 100%; }
.pr-doc-page {
  width: ${paper.w}mm;
  min-height: ${paper.h}mm;
  max-width: 100%;
  background: #fff;
  box-shadow: 0 8px 30px rgba(0,0,0,0.12);
  padding: 8mm 7mm;
  box-sizing: border-box;
  font-family: ${SHEET_FONT};
  color: ${c.ink};
  font-size: calc(${dens.base}px * ${fit});
  line-height: ${dens.line};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.pr-doc-page * { box-sizing: border-box; }

.prd-head {
  display: flex; justify-content: space-between; align-items: flex-end; gap: 10px;
  border-bottom: 2px solid ${c.ink}; padding-bottom: 5px; margin-bottom: 7px;
}
.prd-company { font-size: calc(9.5px * ${fit}); font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: ${c.soft}; }
.prd-title { font-size: calc(15px * ${fit}); font-weight: 800; margin: 2px 0 0; line-height: 1.15; }
.prd-head__meta { text-align: right; font-size: calc(8.2px * ${fit}); color: ${c.soft}; line-height: 1.45; white-space: nowrap; }
.prd-head--item { border-bottom-width: 3px; }
.prd-item-index { font-size: calc(8.4px * ${fit}); text-transform: uppercase; letter-spacing: .5px; color: ${c.mute}; }
.prd-item-title { font-size: calc(14px * ${fit}); font-weight: 800; margin: 1px 0 2px; line-height: 1.15; }
.prd-item-sub { font-size: calc(8.8px * ${fit}); color: ${c.soft}; }

.prd-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 8px; }
.prd-kpis--item { grid-template-columns: repeat(6, 1fr); }
.prd-kpi { border: 1px solid ${c.line}; border-radius: 4px; padding: calc(3px * ${fit}) calc(5px * ${fit}); background: ${c.band}; overflow: hidden; }
.prd-kpi--wide { grid-column: span 2; }
.prd-kpi__label { font-size: calc(7.5px * ${fit}); color: ${c.mute}; margin-bottom: 1px; }
.prd-kpi__value { font-size: calc(10.4px * ${fit}); font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prd-kpi__hint { font-size: calc(7.4px * ${fit}); color: ${c.mute}; }

.prd-section { margin-top: 5px; break-inside: avoid; page-break-inside: avoid; }
.prd-h3 { font-size: calc(9.6px * ${fit}); font-weight: 800; text-transform: uppercase; letter-spacing: .3px; margin: 0 0 4px; padding-bottom: 2px; border-bottom: 1px solid ${c.light}; }

.prd-cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 5px; break-inside: avoid; page-break-inside: avoid; }
.pr-doc--landscape .prd-cols2 { grid-template-columns: 1fr 1fr; }

.prd-chart { border: 1px solid ${c.line}; border-radius: 4px; padding: calc(4px * ${fit}) calc(6px * ${fit}); background: #fff; min-width: 0; }
.prd-chart__cap { font-size: calc(8.2px * ${fit}); font-weight: 700; color: ${c.soft}; margin-bottom: 3px; }
.prd-empty { font-size: calc(8.4px * ${fit}); color: ${c.mute}; margin: 4px 0; }

/* Столбчатая диаграмма по месяцам */
.prd-bars { position: relative; display: flex; align-items: flex-end; justify-content: center; gap: 3px; padding-top: 12px; }
.prd-bars--wide .prd-bar { max-width: 26mm; }
.prd-bars__avg { position: absolute; left: 0; right: 0; border-top: 1.4px dashed ${c.ink}; opacity: .75; }
.prd-bar { flex: 1 1 0; min-width: 0; max-width: 14mm; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; }
.prd-bar__val { font-size: calc(7px * ${fit}); color: ${c.soft}; font-variant-numeric: tabular-nums; white-space: nowrap; }
.prd-bar__col { height: ${s.orientation === "landscape" ? 13 : 15}mm; width: 100%; display: flex; align-items: flex-end; justify-content: center; border-bottom: 1px solid ${c.line}; }
.prd-bar__fill { display: block; width: 78%; background: ${c.ink}; border-radius: 1.5px 1.5px 0 0; }
.prd-bar__fill--fc { background: repeating-linear-gradient(45deg, ${c.ink} 0 1.1px, #fff 1.1px 3px); border: 1px solid ${c.ink}; }
.prd-bar__lab { font-size: calc(6.8px * ${fit}); color: ${c.soft}; max-width: 100%; text-align: center; line-height: 1.05; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }

/* Строки-полосы (клиенты, цены) */
.prd-rows { display: flex; flex-direction: column; gap: calc(3px * ${fit}); }
.prd-row { display: grid; grid-template-columns: minmax(0, 34%) 1fr minmax(0, 34%); gap: 5px; align-items: center; font-size: calc(8.2px * ${fit}); }
.prd-row--price { grid-template-columns: minmax(0, 34%) 1fr minmax(0, 24%); }
.prd-row__name { color: ${c.soft}; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prd-row__track { height: calc(6.4px * ${fit}); background: ${c.band2}; border-radius: 3px; overflow: hidden; }
.prd-row__fill { display: block; height: 100%; background: ${c.ink}; border-radius: 3px; }
.prd-row__fill--gray { background: #8c8c8c; }
.prd-row--lead { grid-template-columns: minmax(0, 34%) 1fr minmax(0, 30%); }
.prd-row__fill--neg { background: repeating-linear-gradient(45deg, ${c.ink} 0 1.1px, #fff 1.1px 3px); }
.prd-rows--lead .prd-row__val { font-weight: 700; }
.prd-row__fill--hatch { background: repeating-linear-gradient(45deg, ${c.ink} 0 1.1px, #fff 1.1px 3px); border: 1px solid ${c.ink}; }
.prd-row__val { text-align: right; font-variant-numeric: tabular-nums; color: ${c.ink}; font-weight: 600; white-space: nowrap; overflow: hidden; }
.prd-price-note { display: flex; justify-content: space-between; gap: 8px; margin-top: 4px; font-size: calc(7.8px * ${fit}); color: ${c.soft}; border-top: 1px solid ${c.light}; padding-top: 3px; }

/* Стеклянная полоса структуры */
.prd-stack { display: flex; height: calc(9px * ${fit}); border: 1px solid ${c.ink}; border-radius: 3px; overflow: hidden; }
.prd-seg { display: block; height: 100%; }
.prd-seg--1, .prd-legend__dot.prd-seg--1 { background: #111111; }
.prd-seg--2, .prd-legend__dot.prd-seg--2 { background: repeating-linear-gradient(45deg, #111 0 1.1px, #fff 1.1px 3px); }
.prd-seg--3, .prd-legend__dot.prd-seg--3 { background: #8c8c8c; }
.prd-seg--4, .prd-legend__dot.prd-seg--4 { background: repeating-linear-gradient(90deg, #111 0 1.1px, #fff 1.1px 3px); }
.prd-seg--5, .prd-legend__dot.prd-seg--5 { background: #4d4d4d; }
.prd-seg--6, .prd-legend__dot.prd-seg--6 { background: radial-gradient(#111 34%, #fff 36%); background-size: 3px 3px; }
.prd-seg--7, .prd-legend__dot.prd-seg--7 { background: #b3b3b3; }
.prd-seg--8, .prd-legend__dot.prd-seg--8 { background: repeating-linear-gradient(135deg, #111 0 1.1px, #fff 1.1px 3px); }
.prd-legend { display: grid; grid-template-columns: repeat(var(--prd-legend-cols, 2), minmax(0, 1fr)); gap: 1px 10px; margin-top: 5px; }
.prd-legend__item { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 5px; align-items: center; font-size: calc(7.8px * ${fit}); }
.prd-legend__value, .prd-legend__val { white-space: nowrap; }
.prd-legend__dot { width: 8px; height: 8px; border: 1px solid #111; }
.prd-legend__name { color: ${c.soft}; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; line-height: 1.15; }
.prd-legend__val { font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }

/* Таблицы */
.prd-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: calc(7.9px * ${fit}); }
.prd-table th, .prd-table td { border: 1px solid ${c.line}; padding: calc(1.7px * ${fit}) calc(3px * ${fit}); vertical-align: middle; overflow: hidden; }
.prd-table thead { display: table-header-group; }
.prd-table tfoot { display: table-footer-group; }
.prd-table tr { break-inside: avoid; page-break-inside: avoid; }
.prd-table thead th { background: ${c.head}; color: ${c.headInk}; font-size: calc(7.4px * ${fit}); font-weight: 700; text-align: center; line-height: 1.15; }
.prd-table tfoot td { background: ${c.band2}; font-weight: 800; }
.prd-table tbody tr:nth-child(even) td { background: ${c.band}; }
.prd-td-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.prd-td-name { text-align: left; overflow-wrap: break-word; }
.prd-td-empty { text-align: center; color: ${c.mute}; padding: 6px; }
.prd-strong { font-weight: 800; }
.prd-table th[style*="--prd-colw"], .prd-table td[style*="--prd-colw"] { width: var(--prd-colw); }
.prd-table--sales { font-size: calc(7.4px * ${fit}); }
.prd-table--months th:first-child, .prd-table--months td:first-child { width: 34%; text-align: left; }
.prd-table--months tfoot td { background: ${c.band2}; }
.prd-table--months tfoot tr:last-child td { border-top: 1.5px solid ${c.ink}; }

/* Рекомендации */
.prd-advice { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.prd-advice__item { display: flex; gap: 5px; align-items: flex-start; border: 1px solid ${c.line}; border-left-width: 3.5px; border-radius: 3px; padding: calc(2px * ${fit}) calc(5px * ${fit}); font-size: calc(8px * ${fit}); background: #fff; break-inside: avoid; }
.prd-advice__item--ok { border-left-color: ${c.ok}; }
.prd-advice__item--watch { border-left-color: ${c.watch}; background: ${c.band}; }
.prd-advice__item--risk { border-left-color: ${c.risk}; background: ${c.band2}; }
.prd-advice__mark { font-weight: 800; flex: 0 0 auto; }
.prd-foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 7px; padding-top: 3px; border-top: 1px solid ${c.light}; font-size: calc(7.4px * ${fit}); color: ${c.mute}; }

/* ── Печать: каждый блок — новая страница ── */
@media print {
  .pr-doc { display: block !important; }
  .pr-doc-page {
    width: auto !important;
    min-height: 0 !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    background: #fff !important;
    break-inside: auto !important;
    page-break-inside: auto !important;
    break-after: page !important;
    page-break-after: always !important;
  }
  .pr-doc-page:last-child {
    break-after: auto !important;
    page-break-after: auto !important;
  }
  .pr-doc-page > .prd-page > .prd-head { break-after: avoid; page-break-after: avoid; }
}
`;
}
