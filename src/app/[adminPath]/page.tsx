// src/app/[adminPath]/page.tsx
import {
  getAllCategories,
  getProducts,
  getOrders,
  getPromotions,
} from "@/lib/supabase-queries";
import {
  Package,
  ClipboardList,
  FolderOpen,
  TrendingUp,
  CheckCircle,
  CheckCircle2,
  Clock,
  XCircle,
  BarChart3,
  Megaphone,
  Star,
  Plus,
  Pencil,
  Settings,
  AlertTriangle,
  Banknote,
  CreditCard,
  ArrowDownLeft,
  ArrowUpRight,
  Truck,
  MapPin,
  ExternalLink,
  Recycle,
  Building2,
  Lightbulb,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminDb } from "@/lib/supabase";
import { verifySession } from "@/lib/auth";
import { getDeals, getPayments, getReceipts, getSalaries, getCashCollections, getTransports } from "@/lib/warehouse";
import { getRentSummary } from "@/lib/rent";
import { getSupplyPlans } from "@/lib/supply-plans";
import { supplyPlansItemsCount } from "@/lib/supply-plans-shared";
import { RENT_ORG_LABELS } from "@/lib/rent-shared";
import { getWpFinanceData } from "@/lib/wastepaper-account";
import {
  getWpBalance,
  getWpForecast,
  getWpStock,
  wpCollectMoneyEvents,
  wpEventEffectiveDate,
} from "@/lib/wastepaper-account-shared";
import {
  getBankSummary,
  getDealPaidMap,
  getReceiptPaidMap,
  getCashCarryoverSummary,
  dealNeedsDelivery,
  dealRemainingItems,
  isSalaryExcludedFromBalance,
  isDebtSalaryComment,
  stripSalaryMetaTags,
  type BankPayment,
  type Salary,
} from "@/lib/warehouse-shared";
import { DashboardRealtime } from "@/components/admin/DashboardRealtime";
import {
  DashboardFinanceHistory,
  type DashboardFinanceRow,
} from "@/components/admin/DashboardFinanceHistory";
import { CollapsibleSection, DashboardVisibilityToggle } from "@/components/admin/DashboardCollapsible";

export const dynamic = "force-dynamic";

async function countByStatus(table: string, status: string): Promise<number> {
  const db = getAdminDb();
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) { console.error(`countByStatus ${table} ${status}:`, error.message); return 0; }
  return count || 0;
}

/**
 * Защита дашборда от сетевых сбоев: если Supabase недоступен,
 * запрос возвращает fallback (пустой массив/ноль), страница рендерится
 * с пустыми секциями вместо полного падения. Саму логику запросов
 * и подключение не трогаем — только поглощаем ошибку загрузки.
 */
function safeLoad<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch((error: any) => {
    console.error("dashboard: загрузка данных не удалась:", error?.message || error);
    return fallback;
  });
}

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

const statusLabels: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Проведена",
  rejected: "Отменена",
};

const statusColors: Record<string, string> = {
  new: "admin-badge admin-badge--amber",
  in_progress: "admin-badge admin-badge--blue",
  completed: "admin-badge admin-badge--green",
  rejected: "admin-badge admin-badge--red",
};

function formatDate(raw: any): string {
  if (!raw) return "";
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toLocaleDateString("ru-RU");
  }
  if (typeof raw === "number")
    return new Date(raw).toLocaleDateString("ru-RU");
  if (raw?.seconds !== undefined)
    return new Date(raw.seconds * 1000).toLocaleDateString("ru-RU");
  return "";
}

const money = (value: number) => `${value.toLocaleString("ru-RU")} ₽`;

function financePeriodLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  const label = new Date(year, month - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function salaryMonthLabel(salary: Salary): string {
  return financePeriodLabel(salary.periodMonth || salary.date.slice(0, 7));
}

function paymentPurpose(payment: BankPayment): string {
  if (payment.direction === "incoming" && payment.dealIds.length > 0) {
    return "Оплата заказа";
  }
  if (payment.direction === "outgoing" && payment.receiptIds.length > 0) {
    return "Оплата поставки";
  }
  if (payment.type === "refund") return "Возврат";
  if (payment.type === "deposit") return "Внесение";
  if (payment.type === "transfer") return "Перевод";
  if (payment.type === "cash") {
    return payment.direction === "incoming" ? "Приход наличными" : "Расход наличными";
  }
  return payment.direction === "incoming" ? "Прочий приход" : "Прочий расход";
}

export default async function AdminDashboard() {
  const session = await verifySession();
  if (!session) redirect(`/${ADMIN_PATH}/login`);
  if (session.role === "wastepaper") redirect(`/${ADMIN_PATH}/wastepaper-account`);
  const isLawyer = session.role === "lawyer";

  const [
    allProducts,
    recentOrderPool,
    allCats,
    promotions,
    newOrdersAgg,
    newWastepaperAgg,
    inProgressAgg,
    inProgressWastepaperAgg,
    readyAgg,
    completedAgg,
    completedWastepaperAgg,
    rejectedAgg,
    rejectedWastepaperAgg,
    payments,
    salaries,
    deals,
    receipts,
    cashCollections,
    transports,
    supplyPlans,
  ] = await Promise.all([
    safeLoad(isLawyer ? Promise.resolve([]) : getProducts({ includeHidden: true }), []),
    safeLoad(isLawyer ? Promise.resolve([]) : getOrders({ limit: 50 }), []),
    safeLoad(isLawyer ? Promise.resolve([]) : getAllCategories(), []),
    safeLoad(isLawyer ? Promise.resolve([]) : getPromotions(), []),
    safeLoad(isLawyer ? Promise.resolve(0) : countByStatus("orders", "new"), 0),
    safeLoad(isLawyer ? Promise.resolve(0) : countByStatus("wastepaper_requests", "new"), 0),
    safeLoad(isLawyer ? Promise.resolve(0) : countByStatus("orders", "in_progress"), 0),
    safeLoad(isLawyer ? Promise.resolve(0) : countByStatus("wastepaper_requests", "in_progress"), 0),
    safeLoad(isLawyer ? Promise.resolve(0) : countByStatus("orders", "ready"), 0),
    safeLoad(isLawyer ? Promise.resolve(0) : countByStatus("orders", "completed"), 0),
    safeLoad(isLawyer ? Promise.resolve(0) : countByStatus("wastepaper_requests", "completed"), 0),
    safeLoad(isLawyer ? Promise.resolve(0) : countByStatus("orders", "rejected"), 0),
    safeLoad(isLawyer ? Promise.resolve(0) : countByStatus("wastepaper_requests", "rejected"), 0),
    safeLoad(getPayments(), []),
    safeLoad(getSalaries(), []),
    safeLoad(getDeals(), []),
    safeLoad(isLawyer ? Promise.resolve([]) : getReceipts(), []),
    safeLoad(getCashCollections(), []),
    safeLoad(getTransports(), []),
    safeLoad(isLawyer ? Promise.resolve([]) : getSupplyPlans(), []),
  ]);

  const wpFinance = await getWpFinanceData().catch((error) => {
    console.error("dashboard: финансы макулатуры:", error);
    return null;
  });

  const rentSummary = await getRentSummary().catch((error) => {
    console.error("dashboard: учёт аренды:", error);
    return null;
  });

  const newOrdersCount = newOrdersAgg + newWastepaperAgg;
  const inProgressOrdersCount = inProgressAgg + inProgressWastepaperAgg;
  const readyOrdersCount = readyAgg;
  const completedOrdersCount = completedAgg + completedWastepaperAgg;
  const rejectedOrdersCount = rejectedAgg + rejectedWastepaperAgg;
  const totalOrdersCount =
    newOrdersCount +
    inProgressOrdersCount +
    readyOrdersCount +
    completedOrdersCount +
    rejectedOrdersCount;
  const bankSummary = getBankSummary(
    payments,
    salaries,
    cashCollections,
    undefined,
    deals.length ? deals : undefined
  );
  const dashboardDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Novosibirsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const cashCarryover = getCashCarryoverSummary(
    payments,
    salaries,
    cashCollections,
    dashboardDate
  );
  const recentOrders = recentOrderPool.slice(0, 8);
  const activeSupplyPlans = supplyPlans.filter((plan) => plan.status === "active");
  const plannedSupplyItems = supplyPlansItemsCount(activeSupplyPlans);

  const wpEvents = wpFinance
    ? wpCollectMoneyEvents(
        wpFinance.intakes,
        wpFinance.shipments,
        wpFinance.manualPayments
      )
    : [];
  const wpBalance = getWpBalance(wpEvents, dashboardDate);
  const wpForecast = getWpForecast(wpEvents);
  const wpMonthKeys = dashboardDate.slice(0, 7);
  const wpMonthPaid = wpEvents.filter(
    (e) => !e.cancelled && e.isPaid && wpEventEffectiveDate(e).startsWith(wpMonthKeys)
  );
  const wpMonthIncoming = wpMonthPaid
    .filter((e) => e.direction === "incoming")
    .reduce((sum, e) => sum + e.amount, 0);
  const wpMonthOutgoing = wpMonthPaid
    .filter((e) => e.direction === "outgoing")
    .reduce((sum, e) => sum + e.amount, 0);
  const wpStockTotalKg = wpFinance
    ? getWpStock(wpFinance.intakes, wpFinance.shipments).reduce(
        (sum, row) => sum + Math.max(0, row.stockKg),
        0
      )
    : 0;
  const dealPaidMap = getDealPaidMap(payments);
  const receiptPaidMap = getReceiptPaidMap(payments);
  const stockValue = allProducts.reduce(
    (sum, product) => sum + (Number(product.stockQty) || 0) * (Number(product.price) || 0),
    0
  );
  const outOfStockProducts = allProducts.filter((product) => (Number(product.stockQty) || 0) <= 0);
  const lowStockProducts = allProducts.filter((product) => {
    const qty = Number(product.stockQty) || 0;
    const warn = product.stockWarnQty != null ? Number(product.stockWarnQty) : 10;
    return qty > 0 && qty <= warn;
  });
  const unpaidDeals = deals.filter((deal) => {
    if (deal.status === "cancelled") return false;
    const paid = dealPaidMap.get(deal.id) || 0;
    return paid + 0.009 < deal.total;
  });
  const unpaidReceipts = receipts.filter((receipt) => {
    if (receipt.status !== "posted") return false;
    const paid = receiptPaidMap.get(receipt.id) || 0;
    return paid + 0.009 < receipt.total;
  });

  const unpaidIndependentPayments = payments.filter((p) =>
    !p.isPaid &&
    p.direction === "outgoing" &&
    !p.excludeFromBalance &&
    (!p.receiptIds || p.receiptIds.length === 0) &&
    (!p.dealIds || p.dealIds.length === 0)
  );

  const paymentFinanceRows: DashboardFinanceRow[] = payments
    .filter((payment) => payment.isPaid && !payment.excludeFromBalance)
    .map((payment) => ({
      id: `payment-${payment.id}`,
      date: payment.paidAt || payment.date,
      direction: payment.direction,
      account: payment.type === "cash" ? "cash" : "bank",
      category: paymentPurpose(payment),
      counterparty: payment.counterparty || "Без контрагента",
      amount: payment.amount,
      detail:
        payment.comment ||
        [
          ...payment.dealNumbers.map((number) => `ЗК-${number}`),
          ...payment.receiptNumbers.map((number) => `ПО-${number}`),
        ].join(" · "),
      href: `/${ADMIN_PATH}/warehouse?tab=bank&payment=${payment.id}`,
      paymentId: payment.id,
      dealLinks: payment.dealIds.map((id, index) => ({
        id,
        number: payment.dealNumbers[index] || 0,
      })),
      receiptLinks: payment.receiptIds.map((id, index) => ({
        id,
        number: payment.receiptNumbers[index] || 0,
      })),
    }));

  const salaryFinanceRows: DashboardFinanceRow[] = salaries
    .filter(
      (salary) => salary.isPaid && !isSalaryExcludedFromBalance(salary.comment)
    )
    .map((salary) => ({
      id: `salary-${salary.id}`,
      date: salary.paidAt || salary.date,
      direction: "outgoing",
      account: salary.source,
      category: isDebtSalaryComment(salary.comment)
        ? "Выплата в счёт долга"
        : "Зарплата",
      counterparty: salary.employeeName,
      amount: salary.amount,
      detail: [
        isDebtSalaryComment(salary.comment)
          ? "не входит в факт зарплаты месяца"
          : `за ${salaryMonthLabel(salary)}`,
        stripSalaryMetaTags(salary.comment),
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/${ADMIN_PATH}/warehouse?tab=salaries`,
    }));

  // Закрытие смены — справочная сводка, а не финансовая операция.
  // Не добавляем её в прибыль/расход: реальные движения уже представлены
  // исходными платежами, зарплатами и расходами.

  const financeRows: DashboardFinanceRow[] = [
    ...paymentFinanceRows,
    ...salaryFinanceRows,
  ];
  const currentMonthFinanceRows = financeRows.filter((row) =>
    row.date.startsWith(dashboardDate.slice(0, 7))
  );
  const financeIncoming = currentMonthFinanceRows
    .filter((row) => row.direction === "incoming")
    .reduce((sum, row) => sum + row.amount, 0);
  const financeOutgoing = currentMonthFinanceRows
    .filter((row) => row.direction === "outgoing")
    .reduce((sum, row) => sum + row.amount, 0);
  const bankIncoming = currentMonthFinanceRows
    .filter((row) => row.account === "bank" && row.direction === "incoming")
    .reduce((sum, row) => sum + row.amount, 0);
  const bankOutgoing = currentMonthFinanceRows
    .filter((row) => row.account === "bank" && row.direction === "outgoing")
    .reduce((sum, row) => sum + row.amount, 0);
  const cashIncoming = currentMonthFinanceRows
    .filter((row) => row.account === "cash" && row.direction === "incoming")
    .reduce((sum, row) => sum + row.amount, 0);
  const cashOutgoing = currentMonthFinanceRows
    .filter((row) => row.account === "cash" && row.direction === "outgoing")
    .reduce((sum, row) => sum + row.amount, 0);

  const paidDeliveryDeals = deals
    .filter((deal) => {
      if (!deal.hasDelivery || !dealNeedsDelivery(deal)) return false;
      const paid = dealPaidMap.get(deal.id) || 0;
      return deal.total > 0 && paid + 0.009 >= deal.total;
    });

  const activeTransports = transports.filter(t => t.status === "draft" || t.status === "active");
  const independentTrips: any[] = [];
  for (const t of activeTransports) {
    if (t.items) {
      for (const item of t.items) {
        if (item.dealId === null) {
          independentTrips.push({
            id: `trip-${t.id}-${item.customerName}`,
            type: "independent",
            number: `ПЕР-${t.number}`,
            customerName: item.customerName,
            address: item.address || "Адрес не указан",
            phone: item.phone,
            note: item.deliveryNote,
            date: t.plannedDate || t.date,
            itemCount: item.items?.reduce((sum: number, i: any) => sum + (Number(i.transportQty) || 0), 0) || 0,
            totalSum: null,
            isPaid: false,
            link: `/${ADMIN_PATH}/warehouse?tab=deliveries&transport=${t.id}`,
          });
        }
      }
    }
  }

  const dashboardDeliveries = [
    ...paidDeliveryDeals.flatMap((deal) => {
      const remainingItems = dealRemainingItems(
        deal.items,
        deal.shippedItems
      ).filter((item) => item.remaining > 0);
      const itemCount = remainingItems.reduce(
        (sum, item) => sum + item.remaining,
        0
      );
      if (itemCount <= 0) return [];
      return [{
        id: `deal-${deal.id}`,
        type: "deal",
        number: `ЗК-${deal.number}`,
        customerName: deal.customerName,
        address: deal.deliveryAddress || deal.address || "Адрес не указан",
        phone: deal.customerPhone || deal.phone,
        note: deal.deliveryNote,
        date: deal.deliveryPlannedDate,
        itemCount,
        itemSummary: remainingItems
          .map((item) => `${item.name || "Товар"} × ${item.remaining}`)
          .join(" · "),
        totalSum: deal.total,
        isPaid: true,
        link: `/${ADMIN_PATH}/warehouse?tab=deals&deal=${deal.id}`,
      }];
    }),
    ...independentTrips.map((trip) => ({ ...trip, itemSummary: null })),
  ].sort((a, b) => {
    const aDate = a.date || "";
    const bDate = b.date || "";
    return aDate.localeCompare(bDate) || a.number.localeCompare(b.number);
  });

  return (
    <div className="dash-page">
      <DashboardRealtime limited={isLawyer} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h1 className="admin-h1" style={{ margin: 0 }}>
          {isLawyer ? "Финансы и перевозки" : "Панель управления"}
        </h1>
        <div style={{ fontSize: 13, color: "var(--adm-muted)" }}>
          {new Date().toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
          padding: "8px 12px",
          background: "var(--adm-paper-warm)",
          border: "1px dashed var(--adm-border)",
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--adm-muted)" }}>
          💡 Нажимайте на заголовок блока чтобы скрыть/раскрыть. Дашборд теперь в 2 колонки.
        </span>
        <DashboardVisibilityToggle />
      </div>

      {!isLawyer && (
        <CollapsibleSection
          id="stats"
          title="Главные показатели"
          subtitle="Товары, заявки, деньги — быстрый взгляд"
          defaultOpen
          accent="blue"
        >
          <div className="admin-stat-grid" style={{ margin: 0, padding: 16 }}>
            {[
              {
                label: "Товаров",
                value: allProducts.length,
                icon: <Package size={18} />,
                href: `/${ADMIN_PATH}/products`,
                iconBg: "var(--adm-sand-pale)",
                iconColor: "var(--adm-ink)",
                sub: `${allProducts.filter((p) => (p.stockQty ?? 0) > 0).length} в наличии`,
              },
              {
                label: "Категорий",
                value: allCats.length,
                icon: <FolderOpen size={18} />,
                href: `/${ADMIN_PATH}/categories`,
                iconBg: "var(--adm-kraft-pale)",
                iconColor: "var(--adm-kraft)",
                sub: `${allCats.filter((c) => c.isVisible !== false).length} видимых`,
              },
              {
                label: "Новых заявок",
                value: newOrdersCount,
                icon: <TrendingUp size={18} />,
                href: `/${ADMIN_PATH}/orders?status=new`,
                iconBg: "var(--adm-rust-pale)",
                iconColor: "var(--adm-rust)",
                sub: "требуют обработки",
              },
              {
                label: "Выручка",
                value:
                  financeIncoming - financeOutgoing !== 0
                    ? `${((financeIncoming - financeOutgoing) / 1000).toFixed(0)}К ₽`
                    : "—",
                icon: <BarChart3 size={18} />,
                href: `/${ADMIN_PATH}/orders?status=completed`,
                iconBg: "var(--adm-pine-pale)",
                iconColor: "var(--adm-pine)",
                sub: `оплаты минус расходы · ${dashboardDate.slice(0, 7)}`,
              },
              {
                label: "К оплате нам",
                value: `${(bankSummary.expectedIn / 1000).toFixed(0)}К ₽`,
                icon: <TrendingUp size={18} />,
                href: `/${ADMIN_PATH}/warehouse?tab=bank`,
                iconBg: "var(--adm-pine-pale)",
                iconColor: "var(--adm-pine)",
                sub: `${unpaidDeals.length} неоплаченных заказов`,
              },
              {
                label: "Мы должны",
                value: `${(bankSummary.expectedOut / 1000).toFixed(0)}К ₽`,
                icon: <AlertTriangle size={18} />,
                href: `/${ADMIN_PATH}/warehouse?tab=bank`,
                iconBg: "var(--adm-rust-pale)",
                iconColor: "var(--adm-rust)",
                sub: `${unpaidReceipts.length} поставок + ${unpaidIndependentPayments.length} платежей`,
              },
              {
                label: "Склад в ценах",
                value: `${(stockValue / 1000).toFixed(0)}К ₽`,
                icon: <Package size={18} />,
                href: `/${ADMIN_PATH}/warehouse?tab=stock`,
                iconBg: "var(--adm-sand-pale)",
                iconColor: "var(--adm-ink)",
                sub: `${outOfStockProducts.length} нет, ${lowStockProducts.length} скоро закончатся`,
              },
              {
                label: "Планы поставок",
                value: activeSupplyPlans.length,
                icon: <Lightbulb size={18} />,
                href: `/${ADMIN_PATH}/warehouse?tab=plans`,
                iconBg: "var(--adm-kraft-pale)",
                iconColor: "var(--adm-kraft)",
                sub: `${plannedSupplyItems} позиций без расчёта цен`,
              },
              {
                label: "Акции",
                value: promotions.length,
                icon: <Megaphone size={18} />,
                href: `/${ADMIN_PATH}/promotions`,
                iconBg: "var(--adm-kraft-pale)",
                iconColor: "var(--adm-kraft)",
                sub: `${promotions.filter((p) => p.isVisible !== false).length} активных`,
              },
            ].map((stat) => (
              <Link key={stat.label} href={stat.href} className="admin-stat" prefetch={false}>
                <div className="admin-stat__icon" style={{ background: stat.iconBg, color: stat.iconColor }}>
                  {stat.icon}
                </div>
                <div className="admin-stat__value">{stat.value}</div>
                <div className="admin-stat__label">{stat.label}</div>
                {stat.sub && (
                  <div style={{ fontSize: 10, color: "var(--adm-muted)", marginTop: 2 }}>{stat.sub}</div>
                )}
              </Link>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {!isLawyer && activeSupplyPlans.length > 0 && (
        <CollapsibleSection
          id="supply-plans"
          title="Планы поставок"
          subtitle={`${plannedSupplyItems} позиций в активных планах`}
          icon={<Lightbulb size={16} />}
          accent="amber"
          badge={activeSupplyPlans.length}
          sideContent={(
            <Link href={`/${ADMIN_PATH}/warehouse?tab=plans`} className="admin-btn admin-btn--ghost admin-btn--sm" prefetch={false}>
              Открыть планы →
            </Link>
          )}
        >
          <div className="dashboard-supply-plans">
            {activeSupplyPlans.map((plan) => (
              <Link key={plan.id} href={`/${ADMIN_PATH}/warehouse?tab=plans`} prefetch={false} className="dashboard-supply-plan">
                <span className="dashboard-supply-plan__icon"><Lightbulb size={16} /></span>
                <span className="dashboard-supply-plan__main">
                  <strong>{plan.name}</strong>
                  <small>
                    {plan.items.length} поз. · {plan.items.slice(0, 3).map((item) => item.productName).join(", ") || "пока пусто"}
                    {plan.items.length > 3 ? ` +${plan.items.length - 3}` : ""}
                  </small>
                </span>
                <span className="dashboard-supply-plan__date">{plan.plannedDate ? formatDate(plan.plannedDate) : "без даты"}</span>
              </Link>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* === ДВУХКОЛОНОЧНАЯ СЕТКА ДАШБОРДА === */}
      <div className="dash-main-grid">
        {/* Финансы */}
        <CollapsibleSection
          id="finance"
          title="Финансовая отчётность"
          subtitle="Приходы/расходы, банк и касса"
          icon={<Banknote size={16} />}
          accent="green"
          badge={money(bankSummary.balance)}
          sideContent={!isLawyer && (
            <Link href={`/${ADMIN_PATH}/warehouse?tab=bank`} className="admin-btn admin-btn--ghost admin-btn--sm" prefetch={false}>
              <ExternalLink size={12} /> Банк
            </Link>
          )}
        >
          <div className="dash-finance-flat">
            <div className="dash-section__desc">Фактические проведённые операции за текущий месяц</div>
            <div className="dash-finance-totals">
              <div className="dash-finance-total dash-finance-total--in">
                <span className="dash-finance-total__icon"><ArrowDownLeft size={16} /></span>
                <span className="dash-finance-total__content">
                  <span>Приход за месяц</span>
                  <strong>+{money(financeIncoming)}</strong>
                </span>
              </div>
              <div className="dash-finance-total dash-finance-total--out">
                <span className="dash-finance-total__icon"><ArrowUpRight size={16} /></span>
                <span className="dash-finance-total__content">
                  <span>Расход за месяц</span>
                  <strong>−{money(financeOutgoing)}</strong>
                </span>
              </div>
              <div className="dash-finance-total dash-finance-total--bank">
                <span className="dash-finance-total__icon"><CreditCard size={16} /></span>
                <span className="dash-finance-total__content">
                  <span>Расчётный счёт сейчас</span>
                  <strong>{money(bankSummary.bankBalance)}</strong>
                </span>
              </div>
              <div className="dash-finance-total dash-finance-total--cash">
                <span className="dash-finance-total__icon"><Banknote size={16} /></span>
                <span className="dash-finance-total__content">
                  <span>Касса сейчас</span>
                  <strong>{money(bankSummary.cashBalance)}</strong>
                </span>
              </div>
            </div>

            <div className="dash-account-grid">
              <div className="dash-account-card dash-account-card--bank">
                <div className="dash-account-card__head">
                  <div className="dash-account-card__icon"><CreditCard size={16} /></div>
                  <div className="dash-account-card__copy"><strong>Расчётный счёт</strong><span>Безнал</span></div>
                </div>
                <div className="dash-account-card__balance"><span>Остаток</span><strong>{money(bankSummary.bankBalance)}</strong></div>
                <div className="dash-account-card__turnover">
                  <span>Приход <b className="dash-money-in">+{money(bankIncoming)}</b></span>
                  <span>Расход <b className="dash-money-out">−{money(bankOutgoing)}</b></span>
                </div>
              </div>
              <div className="dash-account-card dash-account-card--cash">
                <div className="dash-account-card__head">
                  <div className="dash-account-card__icon"><Banknote size={16} /></div>
                  <div className="dash-account-card__copy"><strong>Касса</strong><span>С прошлых: {money(cashCarryover.previousDaysRemaining)}</span></div>
                </div>
                <div className="dash-account-card__balance"><span>Сейчас в кассе</span><strong>{money(bankSummary.cashBalance)}</strong></div>
                <div className="dash-account-card__turnover">
                  <span>Приход <b className="dash-money-in">+{money(cashIncoming)}</b></span>
                  <span>Расход <b className="dash-money-out">−{money(cashOutgoing)}</b></span>
                </div>
              </div>
            </div>

            <DashboardFinanceHistory rows={financeRows} adminPath={ADMIN_PATH} allowNavigation={!isLawyer} />
          </div>
        </CollapsibleSection>

        {/* Доставки */}
        <CollapsibleSection
          id="deliveries"
          title="Доставки и перевозки"
          subtitle={`К выполнению: ${dashboardDeliveries.length}`}
          icon={<Truck size={16} />}
          accent="blue"
          badge={dashboardDeliveries.length}
          sideContent={!isLawyer && (
            <Link href={`/${ADMIN_PATH}/warehouse?tab=deliveries`} className="admin-btn admin-btn--ghost admin-btn--sm" prefetch={false}>
              <Truck size={12} /> Все
            </Link>
          )}
        >
          <div className="dash-deliveries-flat">
            <div className="dash-section__desc">Оплаченные заказы с недовезённым товаром + самостоятельные рейсы</div>
            {dashboardDeliveries.length > 0 ? (
              <div className="dash-delivery-list">
                {dashboardDeliveries.map((del) => (
                  <div key={del.id} className="dash-delivery-row">
                    <span className="dash-delivery-row__icon"><Truck size={15} /></span>
                    <div className="dash-delivery-row__main">
                      <div className="dash-delivery-row__top">
                        {isLawyer ? <strong>{del.number}</strong> : <Link href={del.link} prefetch={false}>{del.number}</Link>}
                        <strong style={{ fontSize: 12 }}>{del.customerName}</strong>
                        {del.isPaid ? <span className="admin-badge admin-badge--green">оплачен</span> : <span className="admin-badge admin-badge--blue">перевозка</span>}
                        {del.date && <span className="admin-badge admin-badge--amber">план {formatDate(del.date)}</span>}
                      </div>
                      <div className="dash-delivery-row__address"><MapPin size={11} />{del.address}</div>
                      <div className="dash-delivery-row__meta">
                        {del.phone && <span>{del.phone}</span>}
                        <span>{del.type === "deal" ? "осталось довезти" : "в рейсе"}: {del.itemCount} ед.</span>
                        {del.totalSum !== null && <span>{money(del.totalSum)}</span>}
                      </div>
                      {del.itemSummary && (
                        <div className="dash-delivery-row__items">{del.itemSummary}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="admin-empty" style={{ padding: 20 }}><p>Нет доставок к выполнению</p></div>
            )}
          </div>
        </CollapsibleSection>

        {/* Аренда */}
        {rentSummary && (
          <CollapsibleSection
            id="rent"
            title="Учёт аренды"
            subtitle="Банк аренды и просрочки"
            icon={<Building2 size={16} />}
            accent="amber"
            badge={rentSummary.overdueSum > 0 ? `просрочено ${money(rentSummary.overdueSum)}` : "ок"}
            sideContent={
              <Link href={`/${ADMIN_PATH}/rent`} className="admin-btn admin-btn--ghost admin-btn--sm" prefetch={false}>
                <ExternalLink size={12} /> Аренда
              </Link>
            }
          >
            <div className="dash-finance-flat">
              <div className="dash-finance-totals">
                {Object.entries(rentSummary.balances).map(([orgId, b]: any) => (
                  <div key={orgId} className="dash-finance-total dash-finance-total--bank">
                    <span className="dash-finance-total__icon"><CreditCard size={16} /></span>
                    <span className="dash-finance-total__content">
                      <span>{RENT_ORG_LABELS[orgId] || orgId}</span>
                      <strong>{money(b.balance)}</strong>
                    </span>
                  </div>
                ))}
                <div className="dash-finance-total dash-finance-total--in">
                  <span className="dash-finance-total__icon"><ArrowDownLeft size={16} /></span>
                  <span className="dash-finance-total__content">
                    <span>Должны по счетам</span>
                    <strong>{money(rentSummary.totalDebt)}</strong>
                  </span>
                </div>
                <div className="dash-finance-total dash-finance-total--out">
                  <span className="dash-finance-total__icon"><AlertTriangle size={16} /></span>
                  <span className="dash-finance-total__content">
                    <span>Просрочено</span>
                    <strong>{money(rentSummary.overdueSum)} · {rentSummary.overdueCount}</strong>
                  </span>
                </div>
              </div>
              <div className="dash-section__desc" style={{ borderTop: "1px solid var(--adm-border)", borderBottom: "none" }}>
                Активных: <b>{rentSummary.activeTenants}</b> · в ближайшие 7 дней: <b>{rentSummary.upcomingCount}</b>
              </div>
            </div>
          </CollapsibleSection>
        )}

        {/* Макулатура */}
        {wpFinance && (
          <CollapsibleSection
            id="wastepaper"
            title="Макулатура"
            subtitle="Отдельный учёт"
            icon={<Recycle size={16} />}
            accent="green"
            badge={money(wpBalance.total)}
            defaultOpen={false}
            sideContent={session.role === "admin" && (
              <Link href={`/${ADMIN_PATH}/wastepaper-account`} className="admin-btn admin-btn--ghost admin-btn--sm" prefetch={false}>
                <Recycle size={12} /> Учёт
              </Link>
            )}
          >
            <div className="dash-finance-flat">
              <div className="dash-section__desc">Наличка/безнал и прогноз — не смешиваются с основным банком</div>
              <div className="dash-finance-totals">
                <div className="dash-finance-total dash-finance-total--in">
                  <span className="dash-finance-total__icon"><ArrowDownLeft size={16} /></span>
                  <span className="dash-finance-total__content"><span>Приход мес</span><strong>+{money(wpMonthIncoming)}</strong></span>
                </div>
                <div className="dash-finance-total dash-finance-total--out">
                  <span className="dash-finance-total__icon"><ArrowUpRight size={16} /></span>
                  <span className="dash-finance-total__content"><span>Расход мес</span><strong>−{money(wpMonthOutgoing)}</strong></span>
                </div>
                <div className="dash-finance-total dash-finance-total--in">
                  <span className="dash-finance-total__icon"><ArrowDownLeft size={16} /></span>
                  <span className="dash-finance-total__content"><span>Прогноз приход</span><strong>+{money(wpForecast.inTotal)}</strong></span>
                </div>
                <div className="dash-finance-total dash-finance-total--out">
                  <span className="dash-finance-total__icon"><ArrowUpRight size={16} /></span>
                  <span className="dash-finance-total__content"><span>Прогноз расход</span><strong>−{money(wpForecast.outTotal)}</strong></span>
                </div>
              </div>
              <div className="dash-account-grid">
                <div className="dash-account-card dash-account-card--cash">
                  <div className="dash-account-card__head"><div className="dash-account-card__icon"><Banknote size={16} /></div><div className="dash-account-card__copy"><strong>Наличка</strong><span>Прогноз +{money(wpForecast.inCash)} / −{money(wpForecast.outCash)}</span></div></div>
                  <div className="dash-account-card__balance"><span>Сейчас</span><strong>{money(wpBalance.cash)}</strong></div>
                  <div className="dash-account-card__turnover"><span>Итого <b>{money(wpBalance.total)}</b> · {Math.round(wpStockTotalKg)} кг</span></div>
                </div>
                <div className="dash-account-card dash-account-card--bank">
                  <div className="dash-account-card__head"><div className="dash-account-card__icon"><CreditCard size={16} /></div><div className="dash-account-card__copy"><strong>Безнал</strong><span>Прогноз +{money(wpForecast.inBank)} / −{money(wpForecast.outBank)}</span></div></div>
                  <div className="dash-account-card__balance"><span>Сейчас</span><strong>{money(wpBalance.bank)}</strong></div>
                  <div className="dash-account-card__turnover"><span>На площадке <b>{wpStockTotalKg.toFixed(1)} кг</b></span></div>
                </div>
              </div>
            </div>
          </CollapsibleSection>
        )}

        {!isLawyer && (
          <>
            <div className="dash-section--full">
              <CollapsibleSection id="statuses" title="Статусы заявок" subtitle={`Всего ${totalOrdersCount}`} icon={<Clock size={16} />} accent="amber" badge={totalOrdersCount} defaultOpen={false}>
              <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                {[
                  { label: "Новые", count: newOrdersCount, color: "var(--adm-kraft)", bg: "var(--adm-kraft-pale)", line: "var(--adm-kraft-line)", status: "new", icon: <Clock size={14} /> },
                  { label: "В работе", count: inProgressOrdersCount, color: "var(--adm-steel)", bg: "var(--adm-steel-pale)", line: "var(--adm-steel-line)", status: "in_progress", icon: <TrendingUp size={14} /> },
                  { label: "Готов", count: readyOrdersCount, color: "var(--adm-indigo)", bg: "var(--adm-indigo-pale)", line: "var(--adm-indigo-line)", status: "ready", icon: <Package size={14} /> },
                  { label: "Выполнены", count: completedOrdersCount, color: "var(--adm-pine)", bg: "var(--adm-pine-pale)", line: "var(--adm-pine-line)", status: "completed", icon: <CheckCircle size={14} /> },
                  { label: "Отменены", count: rejectedOrdersCount, color: "var(--adm-rust)", bg: "var(--adm-rust-pale)", line: "var(--adm-rust-line)", status: "rejected", icon: <XCircle size={14} /> },
                ].map((s) => (
                  <Link key={s.status} href={`/${ADMIN_PATH}/orders?status=${s.status}`} prefetch={false} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 8px", borderRadius: 10, background: s.bg, border: `1px solid ${s.line}`, textDecoration: "none", gap: 4 }}>
                    <div style={{ color: s.color }}>{s.icon}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.count}</div>
                    <div style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.label}</div>
                  </Link>
                ))}
              </div>
            </CollapsibleSection>
            </div>

            <div className="dash-section--full">
              <CollapsibleSection id="recent" title="Заявки и склад" subtitle="Последние операции и остатки" icon={<Clock size={16} />} accent="gray" defaultOpen={false}>
                <div className="admin-dash-grid" style={{ padding: 12, gap: 12 }}>
                  <div className="admin-card" style={{ borderRadius: 10, border: "1px solid var(--adm-border-soft)" }}>
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--adm-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Последние заявки</h3>
                      <Link href={`/${ADMIN_PATH}/orders`} style={{ fontSize: 11, color: "var(--adm-kraft)", fontWeight: 600 }} prefetch={false}>Все →</Link>
                    </div>
                    {recentOrders.length > 0 ? (
                      <div>
                        {recentOrders.map((order: any) => (
                          <div key={order.id} style={{ padding: "8px 12px", borderBottom: "1px solid var(--adm-border-soft)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <div style={{ flex: 1, minWidth: 100 }}>
                              <div style={{ fontWeight: 600, fontSize: 12 }}>{order.customerName}</div>
                              <div style={{ fontSize: 10, color: "var(--adm-muted)" }}>{order.customerPhone}</div>
                            </div>
                            <span className={statusColors[order.status || "new"] || statusColors.new} style={{ fontSize: 9 }}>{statusLabels[order.status || "new"] || order.status}</span>
                            {order.totalSum > 0 && <span style={{ fontSize: 12, fontWeight: 700 }}>{order.totalSum.toLocaleString("ru-RU")} ₽</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: 20, textAlign: "center", color: "var(--adm-muted)", fontSize: 12 }}>Заявок нет</div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="admin-card" style={{ borderRadius: 10, border: "1px solid var(--adm-border-soft)" }}>
                      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--adm-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, display: "flex", gap: 6, alignItems: "center" }}><AlertTriangle size={12} /> Мало на складе</h3>
                        <Link href={`/${ADMIN_PATH}/products/bulk`} style={{ fontSize: 11, color: "var(--adm-kraft)", fontWeight: 600 }} prefetch={false}>Ред. →</Link>
                      </div>
                      {outOfStockProducts.length + lowStockProducts.length > 0 ? (
                        <div>
                          {[...outOfStockProducts, ...lowStockProducts].slice(0, 6).map((p: any) => {
                            const qty = Number(p.stockQty) || 0;
                            return (
                              <Link key={p.id} href={`/${ADMIN_PATH}/products/${p.id}`} prefetch={false} style={{ padding: "8px 12px", borderBottom: "1px solid var(--adm-border-soft)", display: "flex", justifyContent: "space-between", gap: 8, textDecoration: "none" }}>
                                <span style={{ fontSize: 12, color: "var(--adm-ink)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                                <span style={{ fontSize: 10, fontWeight: 700, color: qty <= 0 ? "var(--adm-rust)" : "var(--adm-kraft)", background: qty <= 0 ? "var(--adm-rust-pale)" : "var(--adm-kraft-pale)", padding: "1px 6px", borderRadius: 999 }}>{qty <= 0 ? "нет" : `${qty} шт`}</span>
                              </Link>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ padding: 16, textAlign: "center", color: "var(--adm-muted)", fontSize: 12 }}><CheckCircle2 size={12} /> Склад в норме</div>
                      )}
                    </div>

                    <div className="admin-card" style={{ padding: 12, borderRadius: 10, border: "1px solid var(--adm-border-soft)" }}>
                      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>Быстрые действия</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {[
                          { href: `/${ADMIN_PATH}/products/new`, label: "Добавить товар", icon: <Plus size={12} /> },
                          { href: `/${ADMIN_PATH}/products/bulk`, label: "Массовое редактирование", icon: <Pencil size={12} /> },
                          { href: `/${ADMIN_PATH}/orders?status=new`, label: `Новые заявки (${newOrdersCount})`, icon: <ClipboardList size={12} /> },
                          { href: `/${ADMIN_PATH}/warehouse?tab=deliveries`, label: "Доставки", icon: <Truck size={12} /> },
                          { href: `/${ADMIN_PATH}/categories`, label: "Категории", icon: <FolderOpen size={12} /> },
                        ].map((a) => (
                          <Link key={a.href} href={a.href} prefetch={false} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 6, background: "var(--adm-paper-warm)", fontSize: 12, fontWeight: 500, color: "var(--adm-ink)", textDecoration: "none" }}>
                            {a.icon}
                            {a.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
