// =========================================================
// FILE: src/lib/sales-plan.ts
// План продаж на месяц по контрагентам и товарам.
//
// Методика (классическое скользящее среднее по календарным месяцам):
//  1. Окно анализа — 6 полных месяцев перед плановым.
//  2. По каждому контрагенту × товару считаем среднемесячный объём:
//     сумма количества (и суммы) за окно ÷ 6. Месяцы без заказов
//     участвуют нулями, поэтому частота заказов учитывается честно
//     (кто берёт раз в квартал, у того и план втрое меньше).
//  3. План на месяц = ожидаемое по окну + уже оформленное в плановом
//     месяце (заказы не отменены). «Осталось к плану» = план − уже
//     оформленное — это то, что ещё должно прийти.
//  4. В план попадают контрагенты, которые заказывали в прошлом или
//     плановом месяце («активны»), в последних 3 месяцах окна
//     («недавно») — плюс те, кто уже оформил заказ в плановом месяце.
//  5. Деньги: выручка = план-объём по ценам продажи; закупка
//     (себестоимость) = план-количество × закупочная цена из карточки
//     товара; маржа = выручка − закупка. То есть план сразу показывает,
//     сколько получим денег с вычетом поставок.
//  6. Склад: «осталось к плану» сравнивается с остатком — видно, чего
//     не хватает и на сколько нужно докупить.
//
// В расчёте участвуют и архивные заказы из массовой загрузки
// (is_archive) — импортированная история сразу влияет на план.
// =========================================================

import type { CustomerDeal } from "./warehouse-shared";
import {
  monthKeyOf,
  monthKeyOffset,
  monthLabelOf,
  normalizeCounterparty,
} from "./revenue-forecast";

/** Товар, участвующий в плане (агрегат по складу). */
export interface SalesPlanProduct {
  productId: string;
  name: string;
  sku: string | null;
  /** Ожидаемый расход за месяц, базовые единицы (рулоны/шт) = окно + уже оформленное. */
  planQty: number;
  /** Уже оформлено в плановом месяце (входит в план). */
  knownQty: number;
  /** Осталось ожидать по плану = план − уже оформленное. */
  remainingQty: number;
  /** Ожидаемая выручка за месяц, ₽ (окно + уже оформленное). */
  revenue: number;
  /** Себестоимость (закупка) по плану, ₽. */
  cost: number;
  /** Маржа = выручка − закупка, ₽. */
  margin: number;
  /** Есть ли закупочная цена (иначе себестоимость не считаем). */
  hasPurchasePrice: boolean;
  /** Остаток на складе (базовые единицы) или null. */
  stockQty: number | null;
  /** Сколько не хватает до «остатка к плану» (если план > остаток). */
  shortageQty: number;
  /** Стоимость докупки недостающего, ₽ (0, если нет закупочной цены). */
  shortageCost: number;
  isCuttable: boolean;
  metersPerRoll: number | null;
}

/** Входная карточка склада для расчёта плана. */
export interface SalesPlanStockRow {
  id: string;
  name: string;
  sku: string | null;
  stockQty: number;
  purchasePrice?: number | null;
  isCuttable?: boolean | null;
  cutMetersPerRoll?: number | null;
}

/** Строка плана по контрагенту. */
export interface SalesPlanCounterparty {
  /** Нормализованное имя (ключ). */
  key: string;
  displayName: string;
  /** Ожидаемое число заказов в месяц (частота по окну). */
  expectedOrders: number;
  /** Средний чек по окну анализа, ₽. */
  avgCheck: number;
  /** Ожидаемая выручка за месяц, ₽ (окно + уже оформленное). */
  revenue: number;
  /** Себестоимость (закупка) по его позициям, ₽. */
  cost: number;
  /** Маржа = выручка − закупка, ₽. */
  margin: number;
  /** Уже оформил в плановом месяце, ₽. */
  knownRevenue: number;
  /** Осталось ожидать от контрагента, ₽. */
  remainingRevenue: number;
  status: "active" | "recent" | "sleeping";
  lastOrderDate: string | null;
  /** Какие товары и в каком количестве ожидаем от него. */
  productLines: {
    productId: string;
    name: string;
    planQty: number;
    revenue: number;
  }[];
}

export interface SalesPlan {
  monthKey: string;
  monthLabel: string;
  counterparties: SalesPlanCounterparty[];
  products: SalesPlanProduct[];
  /** Ожидаемая выручка за месяц, ₽. */
  totalRevenue: number;
  /** Себестоимость (закупка) по плану, ₽. */
  totalCost: number;
  /** Маржа (выручка − закупка), ₽. */
  totalMargin: number;
  /** Сколько нужно докупить суммарно, ₽. */
  totalShortageCost: number;
  /** Позиций с дефицитом на складе. */
  shortageProductsCount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Ключ товара в агрегатах: productId, а для импортированных без id — по названию. */
function productKey(item: any): string {
  return item && item.productId ? String(item.productId) : `name:${item?.name || ""}`;
}

/** Сумма строки заказа (lineTotal с фолбэком на количество × цену). */
function itemTotal(item: any): number {
  const lt = Number(item?.lineTotal) || 0;
  if (lt > 0) return lt;
  const saleQty = Number(item?.saleQuantity) || 0;
  const salePrice = Number(item?.salePrice) || 0;
  if (saleQty > 0 && salePrice > 0) return round2(saleQty * salePrice);
  return round2((Number(item?.quantity) || 0) * (Number(item?.price) || 0));
}

/** Базовое количество (рулоны/шт) строки заказа. */
function itemBaseQty(item: any): number {
  return Number(item?.quantity) || 0;
}

export function computeSalesPlan(
  deals: CustomerDeal[],
  stock: SalesPlanStockRow[],
  monthOffset = 0,
  windowMonths = 6
): SalesPlan {
  const planKey = monthKeyOffset(monthOffset);
  const prevKey = monthKeyOffset(monthOffset - 1);

  const windowKeys: string[] = [];
  for (let i = 1; i <= windowMonths; i++) {
    windowKeys.push(monthKeyOffset(monthOffset - i));
  }
  const windowSet = new Set(windowKeys);

  const stockById = new Map(
    stock.map((p) => [
      p.id,
      {
        name: p.name,
        sku: p.sku ?? null,
        stockQty: Math.max(0, Number(p.stockQty) || 0),
        purchasePrice:
          p.purchasePrice != null && Number(p.purchasePrice) > 0
            ? Number(p.purchasePrice)
            : null,
        isCuttable: Boolean(p.isCuttable),
        metersPerRoll:
          p.cutMetersPerRoll != null && Number(p.cutMetersPerRoll) > 0
            ? Number(p.cutMetersPerRoll)
            : null,
      },
    ])
  );

  // Накопители по контрагентам
  type ProdAcc = { productId: string; name: string; qty: number; revenue: number };
  type CpAcc = {
    key: string;
    displayName: string;
    orders: number;
    sum: number;
    monthOrders: Map<string, number>;
    knownRevenue: number;
    lastOrderDate: string | null;
    /** Окно анализа: среднемесячный объём считается из них. */
    windowProducts: Map<string, ProdAcc>;
    /** Уже оформленное в плановом месяце. */
    knownProducts: Map<string, ProdAcc>;
  };
  const cpAccs = new Map<string, CpAcc>();

  const active = deals.filter(
    (d) => d && d.status !== "cancelled" && d.date && Number(d.total) > 0
  );

  for (const deal of active) {
    const key = normalizeCounterparty(deal.customerName);
    if (!key) continue;
    const month = monthKeyOf(deal.date);

    let acc = cpAccs.get(key);
    if (!acc) {
      acc = {
        key,
        displayName: deal.customerName,
        orders: 0,
        sum: 0,
        monthOrders: new Map(),
        knownRevenue: 0,
        lastOrderDate: null,
        windowProducts: new Map(),
        knownProducts: new Map(),
      };
      cpAccs.set(key, acc);
    }
    if (!acc.lastOrderDate || deal.date > acc.lastOrderDate) {
      acc.lastOrderDate = deal.date;
      acc.displayName = deal.customerName;
    }

    // Уже оформленное в плановом месяце (входит в план)
    if (month === planKey) {
      acc.knownRevenue = round2(acc.knownRevenue + (Number(deal.total) || 0));
      for (const it of deal.items || []) {
        if (!it?.name) continue;
        const pid = productKey(it);
        let prod = acc.knownProducts.get(pid);
        if (!prod) {
          prod = { productId: pid, name: String(it.name), qty: 0, revenue: 0 };
          acc.knownProducts.set(pid, prod);
        }
        prod.qty = roundQty(prod.qty + itemBaseQty(it));
        prod.revenue = round2(prod.revenue + itemTotal(it));
      }
    }

    // История для средних — только месяцы окна анализа
    if (windowSet.has(month)) {
      acc.orders += 1;
      acc.sum = round2(acc.sum + (Number(deal.total) || 0));
      acc.monthOrders.set(month, (acc.monthOrders.get(month) || 0) + 1);
      for (const it of deal.items || []) {
        if (!it?.name) continue;
        const pid = productKey(it);
        let prod = acc.windowProducts.get(pid);
        if (!prod) {
          prod = { productId: pid, name: String(it.name), qty: 0, revenue: 0 };
          acc.windowProducts.set(pid, prod);
        }
        prod.qty = roundQty(prod.qty + itemBaseQty(it));
        prod.revenue = round2(prod.revenue + itemTotal(it));
      }
    }
  }

  // ── Контрагенты плана ──
  const counterparties: SalesPlanCounterparty[] = [];

  for (const acc of cpAccs.values()) {
    const lastKey = acc.lastOrderDate ? monthKeyOf(acc.lastOrderDate) : null;
    let status: SalesPlanCounterparty["status"] = "sleeping";
    if (lastKey === planKey || lastKey === prevKey) {
      status = "active";
    } else if (lastKey && windowSet.has(lastKey) && lastKey >= windowKeys[2]) {
      status = "recent";
    }

    // В план попадают активные/недавние, а также те, кто уже оформил в месяце
    if (status === "sleeping" && acc.knownRevenue <= 0) continue;

    // Объединяем окно-продукты и уже оформленные
    const merged = new Map<string, ProdAcc>();
    for (const [pid, prod] of acc.windowProducts) {
      merged.set(pid, { ...prod });
    }
    for (const [pid, prod] of acc.knownProducts) {
      if (!merged.has(pid)) {
        // Товар брали только в плановом месяце (без истории по окну):
        // окно-часть нулевая, известная часть подтянется ниже.
        merged.set(pid, { ...prod, qty: 0, revenue: 0 });
      }
    }

    const productLines: SalesPlanCounterparty["productLines"] = [];
    let revenue = 0;
    let cost = 0;

    for (const prod of merged.values()) {
      const known = acc.knownProducts.get(prod.productId);
      const knownQty = known?.qty || 0;
      const knownRevenue = known?.revenue || 0;
      // План на месяц = среднее за окно + уже оформленное
      const planQty = roundQty(prod.qty / windowMonths + knownQty);
      const prodRevenue = round2(prod.revenue / windowMonths + knownRevenue);
      const meta = stockById.get(prod.productId);
      const hasPrice = Boolean(meta?.purchasePrice && meta.purchasePrice > 0);
      const lineCost = hasPrice ? round2(planQty * (meta?.purchasePrice || 0)) : 0;
      productLines.push({
        productId: prod.productId,
        name: known?.name || prod.name,
        planQty,
        revenue: prodRevenue,
      });
      revenue = round2(revenue + prodRevenue);
      cost = round2(cost + lineCost);
    }

    productLines.sort((a, b) => b.revenue - a.revenue);

    const expectedOrders = round2(acc.orders / windowMonths);
    const avgCheck = acc.orders > 0 ? round2(acc.sum / acc.orders) : 0;

    counterparties.push({
      key: acc.key,
      displayName: acc.displayName,
      expectedOrders,
      avgCheck,
      revenue,
      cost,
      margin: round2(revenue - cost),
      knownRevenue: acc.knownRevenue,
      remainingRevenue: round2(Math.max(0, revenue - acc.knownRevenue)),
      status,
      lastOrderDate: acc.lastOrderDate,
      productLines,
    });
  }

  counterparties.sort((a, b) => b.revenue - a.revenue || b.remainingRevenue - a.remainingRevenue);

  // ── Позиции плана (товары) ──
  const productAccs = new Map<string, SalesPlanProduct>();
  for (const cp of counterparties) {
    for (const line of cp.productLines) {
      const meta = stockById.get(line.productId);
      let row = productAccs.get(line.productId);
      if (!row) {
        const hasPrice = Boolean(meta?.purchasePrice && meta.purchasePrice > 0);
        row = {
          productId: line.productId,
          name: line.name,
          sku: meta?.sku ?? null,
          planQty: 0,
          knownQty: 0,
          remainingQty: 0,
          revenue: 0,
          cost: 0,
          margin: 0,
          hasPurchasePrice: hasPrice,
          stockQty: meta ? meta.stockQty : null,
          shortageQty: 0,
          shortageCost: 0,
          isCuttable: Boolean(meta?.isCuttable),
          metersPerRoll: meta?.metersPerRoll ?? null,
        };
        productAccs.set(line.productId, row);
      }
      row.planQty = roundQty(row.planQty + line.planQty);
      row.revenue = round2(row.revenue + line.revenue);
    }
  }

  const products: SalesPlanProduct[] = [];
  for (const row of productAccs.values()) {
    // Известное количество в плановом месяце собираем из knownProducts контрагентов
    row.knownQty = 0;
    for (const cp of counterparties) {
      const known = cpAccs.get(cp.key)?.knownProducts.get(row.productId);
      if (known) row.knownQty = roundQty(row.knownQty + known.qty);
    }
    row.remainingQty = roundQty(Math.max(0, row.planQty - row.knownQty));
    if (row.hasPurchasePrice) {
      const purchase = stockById.get(row.productId)?.purchasePrice || 0;
      row.cost = round2(row.planQty * purchase);
    }
    row.margin = round2(row.revenue - row.cost);
    if (row.stockQty != null) {
      row.shortageQty = roundQty(Math.max(0, row.remainingQty - row.stockQty));
      row.shortageCost = row.hasPurchasePrice
        ? round2(row.shortageQty * (stockById.get(row.productId)?.purchasePrice || 0))
        : 0;
    }
    products.push(row);
  }

  products.sort((a, b) => b.revenue - a.revenue || b.planQty - a.planQty);

  const totalRevenue = round2(products.reduce((s, p) => s + p.revenue, 0));
  const totalCost = round2(products.reduce((s, p) => s + p.cost, 0));
  const totalShortageCost = round2(products.reduce((s, p) => s + p.shortageCost, 0));
  const shortageProductsCount = products.filter((p) => p.shortageQty > 0.004).length;

  return {
    monthKey: planKey,
    monthLabel: monthLabelOf(planKey),
    counterparties,
    products,
    totalRevenue,
    totalCost,
    totalMargin: round2(totalRevenue - totalCost),
    totalShortageCost,
    shortageProductsCount,
  };
}
