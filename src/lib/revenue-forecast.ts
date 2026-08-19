// =========================================================
// FILE: src/lib/revenue-forecast.ts
// Автоматический прогноз выручки за месяц по контрагентам.
//
// Идея: смотрим на уже существующие и закрытые (неотменённые) заказы
// учёта (customer_deals) за последние месяцы. По каждому контрагенту
// считаем его типичный месячный объём — «кто обычно берёт и на сколько»,
// и получаем ожидаемую выручку на выбранный месяц.
//
// Прогноз намеренно приблизительный: это план, а не точный расчёт.
// В расчёт входят и архивные заказы из массовой загрузки (is_archive),
// поэтому импортированная история сразу влияет на план.
// =========================================================

import type { CustomerDeal } from "./warehouse-shared";

export interface ForecastCounterpartyRow {
  /** Нормализованное имя контрагента (для ключей). */
  counterparty: string;
  /** Отображаемое имя (как в последнем заказе). */
  displayName: string;
  /** Заказов за период анализа (неотменённых). */
  ordersCount: number;
  /** Средний чек, ₽. */
  avgCheck: number;
  /** Среднемесячный объём по «активным» месяцам периода анализа, ₽. */
  avgMonthly: number;
  /** Объём за полный месяц перед прогнозным, ₽. */
  lastMonthSum: number;
  /** Уже оформленные заказы в прогнозном месяце, ₽. */
  knownMonthSum: number;
  /** Ожидаем получить в прогнозном месяце, ₽. */
  forecast: number;
  /** Дата последнего заказа (YYYY-MM-DD) или null. */
  lastOrderDate: string | null;
  /** Активность: active — брал в прошлом/текущем месяце, recent — в последние 3 мес, sleeping — давно. */
  status: "active" | "recent" | "sleeping";
}

export interface RevenueForecast {
  /** Ключ прогнозного месяца: YYYY-MM. */
  monthKey: string;
  /** Метка месяца, например «Август 2026». */
  monthLabel: string;
  /** Строки по контрагентам, отсортированы по прогнозу (убывание). */
  rows: ForecastCounterpartyRow[];
  /** Итоговый прогноз выручки на месяц, ₽. */
  totalForecast: number;
  /** Уже оформлено в этом месяце (известные заказы), ₽. */
  totalKnown: number;
  /** Ожидаем получить сверх уже известного (может быть 0), ₽. */
  totalExpectedRemaining: number;
  /** Среднемесячный объём всех контрагентов, ₽. */
  totalAvgMonthly: number;
  /** Сколько контрагентов «в работе» (active/recent). */
  activeCounterparties: number;
  /** Общий средний чек по периоду анализа, ₽. */
  avgCheck: number;
  /** Заказов (неотменённых) в периоде анализа. */
  totalOrders: number;
}

const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export function monthKeyOf(date: Date | string): string {
  if (typeof date === "string") {
    const m = /^(\d{4})-(\d{2})/.exec(date);
    if (m) return `${m[1]}-${m[2]}`;
  }
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabelOf(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  const label = RU_MONTHS[(m - 1 + 12) % 12] || String(m);
  return `${label} ${y}`;
}

/** Сдвиг месяца на offset (0 — текущий, 1 — следующий, -1 — прошлый). */
export function monthKeyOffset(offset: number, base = new Date()): string {
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeCounterparty(name: string): string {
  return String(name || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[«»"']/g, "")
    .replace(/\s+/g, " ");
}

/** Внутренний аккумулятор по контрагенту. */
interface CounterpartyAcc {
  counterparty: string;
  displayName: string;
  ordersCount: number;
  sum: number;
  monthSums: Map<string, number>;
  monthCounts: Map<string, number>;
  knownMonthSum: number;
  lastOrderDate: string | null;
}

/**
 * Считает прогноз выручки на месяц.
 *
 * @param deals все заказы учёта (CustomerDeal[])
 * @param monthOffset сдвиг прогнозного месяца от текущего (0 — текущий месяц)
 * @param lookbackMonths сколько полных месяцев истории берём для средних
 */
export function computeRevenueForecast(
  deals: CustomerDeal[],
  monthOffset = 0,
  lookbackMonths = 6
): RevenueForecast {
  const forecastKey = monthKeyOffset(monthOffset);

  // Период анализа: lookbackMonths полных месяцев, предшествующих прогнозному,
  // плюс сам прогнозный месяц (для «известных» заказов).
  const lookbackKeys: string[] = [];
  for (let i = 1; i <= lookbackMonths; i++) {
    lookbackKeys.push(monthKeyOffset(monthOffset - i));
  }

  const active = deals.filter(
    (d) => d && d.status !== "cancelled" && d.date && Number(d.total) > 0
  );

  const byCounterparty = new Map<string, CounterpartyAcc>();

  for (const deal of active) {
    const key = normalizeCounterparty(deal.customerName);
    if (!key) continue;
    let acc = byCounterparty.get(key);
    if (!acc) {
      acc = {
        counterparty: key,
        displayName: deal.customerName,
        ordersCount: 0,
        sum: 0,
        monthSums: new Map(),
        monthCounts: new Map(),
        knownMonthSum: 0,
        lastOrderDate: null,
      };
      byCounterparty.set(key, acc);
    }
    acc.ordersCount += 1;
    acc.sum += Number(deal.total) || 0;
    // Самое свежее написание имени — из заказа с самой поздней датой
    if (!acc.lastOrderDate || deal.date > acc.lastOrderDate) {
      acc.lastOrderDate = deal.date;
      acc.displayName = deal.customerName;
    }
    const dealMonth = monthKeyOf(deal.date);
    acc.monthSums.set(dealMonth, (acc.monthSums.get(dealMonth) || 0) + (Number(deal.total) || 0));
    acc.monthCounts.set(dealMonth, (acc.monthCounts.get(dealMonth) || 0) + 1);
    if (dealMonth === forecastKey) {
      acc.knownMonthSum += Number(deal.total) || 0;
    }
  }

  const rows: ForecastCounterpartyRow[] = [];

  for (const acc of byCounterparty.values()) {
    // Активные месяцы в периоде анализа (полные месяцы перед прогнозным)
    let activeMonths = 0;
    let lookbackSum = 0;
    for (const key of lookbackKeys) {
      const count = acc.monthCounts.get(key) || 0;
      if (count > 0) {
        activeMonths += 1;
        lookbackSum += acc.monthSums.get(key) || 0;
      }
    }

    // «Прошлый месяц» — ближайший полный месяц перед прогнозным
    const prevKey = monthKeyOffset(monthOffset - 1);
    const lastMonthSum = acc.monthSums.get(prevKey) || 0;

    const avgMonthly = activeMonths > 0 ? lookbackSum / activeMonths : 0;
    const avgCheck = acc.ordersCount > 0 ? acc.sum / acc.ordersCount : 0;
    const knownMonthSum = Math.round(acc.knownMonthSum * 100) / 100;

    // Активность: брал в прошлом полном месяце или в прогнозном → active;
    // в пределах последних трёх месяцев анализа → recent; иначе sleeping.
    const lastKey = acc.lastOrderDate ? monthKeyOf(acc.lastOrderDate) : null;
    let status: ForecastCounterpartyRow["status"] = "sleeping";
    if (lastKey === forecastKey || lastKey === prevKey) {
      status = "active";
    } else if (lastKey && lastKey >= monthKeyOffset(monthOffset - 3)) {
      status = "recent";
    }

    // Прогноз: типичный месячный объём активного контрагента, но не меньше
    // уже известного в этом месяце. «Спящие» (давно не заказывали) получают
    // только фактически оформленное в прогнозном месяце.
    let forecast = 0;
    if (status === "active" || status === "recent") {
      forecast = Math.max(avgMonthly, knownMonthSum);
    } else {
      forecast = knownMonthSum;
    }

    rows.push({
      counterparty: acc.counterparty,
      displayName: acc.displayName,
      ordersCount: acc.ordersCount,
      avgCheck: Math.round(avgCheck * 100) / 100,
      avgMonthly: Math.round(avgMonthly * 100) / 100,
      lastMonthSum: Math.round(lastMonthSum * 100) / 100,
      knownMonthSum,
      forecast: Math.round(forecast * 100) / 100,
      lastOrderDate: acc.lastOrderDate,
      status,
    });
  }

  rows.sort((a, b) => b.forecast - a.forecast || b.ordersCount - a.ordersCount);

  const totalForecast = rows.reduce((s, r) => s + r.forecast, 0);
  const totalKnown = rows.reduce((s, r) => s + r.knownMonthSum, 0);
  const totalAvgMonthly = rows.reduce((s, r) => s + r.avgMonthly, 0);
  const totalOrders = rows.reduce((s, r) => s + r.ordersCount, 0);
  const activeCounterparties = rows.filter((r) => r.status !== "sleeping").length;

  return {
    monthKey: forecastKey,
    monthLabel: monthLabelOf(forecastKey),
    rows,
    totalForecast: Math.round(totalForecast * 100) / 100,
    totalKnown: Math.round(totalKnown * 100) / 100,
    totalExpectedRemaining: Math.round(Math.max(0, totalForecast - totalKnown) * 100) / 100,
    totalAvgMonthly: Math.round(totalAvgMonthly * 100) / 100,
    activeCounterparties,
    avgCheck:
      rows.length > 0
        ? Math.round((rows.reduce((s, r) => s + r.avgCheck, 0) / rows.length) * 100) / 100
        : 0,
    totalOrders,
  };
}
