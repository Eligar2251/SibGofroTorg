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
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminDb } from "@/lib/supabase";
import { verifySession } from "@/lib/auth";
import { getDeals, getPayments, getReceipts, getSalaries, getCashCollections, getTransports } from "@/lib/warehouse";
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
  isSalaryExcludedFromBalance,
  isDebtSalaryComment,
  stripSalaryMetaTags,
  type BankPayment,
  type Salary,
  type CashCollection,
} from "@/lib/warehouse-shared";
import { DashboardRealtime } from "@/components/admin/DashboardRealtime";
import {
  DashboardFinanceHistory,
  type DashboardFinanceRow,
} from "@/components/admin/DashboardFinanceHistory";

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
  // Макулатурщик работает только в отдельном модуле учёта макулатуры;
  // proxy его и так перенаправит, здесь — явная подстраховка.
  if (session.role === "wastepaper") redirect(`/${ADMIN_PATH}/wastepaper-account`);
  const isLawyer = session.role === "lawyer";

  // Для дашборда читаем только 50 последних заявок. Общие показатели
  // получаем агрегатами Supabase: это значительно дешевле, чем загружать
  // целиком коллекции users и orders при каждом открытии панели.
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
  ] = await Promise.all([
    // Юристу не показываются товары, заявки, акции и склад, поэтому эти
    // данные для его ограниченного дашборда даже не запрашиваем.
    // includeHidden: для остальных ролей считаем ВСЕ товары, как и учёт.
    isLawyer ? Promise.resolve([]) : getProducts({ includeHidden: true }),
    isLawyer ? Promise.resolve([]) : getOrders({ limit: 50 }),
    isLawyer ? Promise.resolve([]) : getAllCategories(),
    isLawyer ? Promise.resolve([]) : getPromotions(),
    isLawyer ? Promise.resolve(0) : countByStatus("orders", "new"),
    isLawyer ? Promise.resolve(0) : countByStatus("wastepaper_requests", "new"),
    isLawyer ? Promise.resolve(0) : countByStatus("orders", "in_progress"),
    isLawyer ? Promise.resolve(0) : countByStatus("wastepaper_requests", "in_progress"),
    isLawyer ? Promise.resolve(0) : countByStatus("orders", "ready"),
    isLawyer ? Promise.resolve(0) : countByStatus("orders", "completed"),
    isLawyer ? Promise.resolve(0) : countByStatus("wastepaper_requests", "completed"),
    isLawyer ? Promise.resolve(0) : countByStatus("orders", "rejected"),
    isLawyer ? Promise.resolve(0) : countByStatus("wastepaper_requests", "rejected"),
    getPayments(),
    getSalaries(),
    getDeals(),
    isLawyer ? Promise.resolve([]) : getReceipts(),
    getCashCollections(),
    getTransports(),
  ]);

  // Отдельный учёт макулатуры: своя финансовая сводка на дашборде.
  // Баланс НЕ смешивается с банком/кассой товарного учёта. При сбое
  // (например, миграция модуля ещё не применена) просто прячем блок.
  const wpFinance = await getWpFinanceData().catch((error) => {
    console.error("dashboard: финансы макулатуры:", error);
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
  // Клиенты перенесены в «Учёт», поэтому на дашборде считаем только финансы/заявки.
  const bankSummary = getBankSummary(payments, salaries, cashCollections);
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
  const totalRevenue = bankSummary.balance;
  const recentOrders = recentOrderPool.slice(0, 8);

  // Финансы макулатуры: нал/безнал отдельно и вместе + прогноз.
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

  // Независимые неоплаченные платежи (без привязки к поступлению/заказу, не "вне баланса")
  const unpaidIndependentPayments = payments.filter((p) =>
    !p.isPaid &&
    p.direction === "outgoing" &&
    !p.excludeFromBalance &&
    (!p.receiptIds || p.receiptIds.length === 0) &&
    (!p.dealIds || p.dealIds.length === 0)
  );

  // ── Полная лента фактических движений по счетам ────────────────
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

  const collectionFinanceRows: DashboardFinanceRow[] = (
    cashCollections as CashCollection[]
  )
    .map((collection) => {
      const legacy = collection.cashAmount == null;
      const amount = legacy
        ? Number(collection.amount) || 0
        : Number(collection.transferAmount) || 0;
      return {
        id: `collection-${collection.id}`,
        date: collection.date,
        direction: "outgoing" as const,
        account: "cash" as const,
        category: legacy
          ? "Сдача кассы (старый учёт)"
          : "Перевод на карту ЮМ",
        counterparty: legacy ? "Сдача кассы" : "Карта ЮМ",
        amount,
        detail: collection.note || "Закрытие смены кассы",
        href: `/${ADMIN_PATH}/warehouse?tab=bank`,
      };
    })
    .filter((row) => row.amount > 0);

  const financeRows: DashboardFinanceRow[] = [
    ...paymentFinanceRows,
    ...salaryFinanceRows,
    ...collectionFinanceRows,
  ];
  // Карточки дашборда — только текущий календарный месяц. История ниже
  // остаётся полной и позволяет выбрать любой предыдущий месяц.
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

  // На дашборде нужны только оплаченные заказы, которые ещё действительно
  // надо доставить. Отменённые и уже полностью отгруженные не показываем.
  const paidDeliveryDeals = deals
    .filter((deal) => {
      if (!deal.hasDelivery || !dealNeedsDelivery(deal)) return false;
      const paid = dealPaidMap.get(deal.id) || 0;
      return deal.total > 0 && paid + 0.009 >= deal.total;
    });

  // Получаем активные самостоятельные перевозки (которые не привязаны к заказам)
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
    ...paidDeliveryDeals.map(deal => ({
      id: `deal-${deal.id}`,
      type: "deal",
      number: `ЗК-${deal.number}`,
      customerName: deal.customerName,
      address: deal.deliveryAddress || deal.address || "Адрес не указан",
      phone: deal.customerPhone || deal.phone,
      note: deal.deliveryNote,
      date: deal.deliveryPlannedDate,
      itemCount: deal.items.reduce((sum, item) => sum + item.quantity, 0),
      totalSum: deal.total,
      isPaid: true,
      link: `/${ADMIN_PATH}/warehouse?tab=deals&deal=${deal.id}`,
    })),
    ...independentTrips
  ].sort((a, b) => {
    const aDate = a.date || "";
    const bDate = b.date || "";
    return aDate.localeCompare(bDate) || a.number.localeCompare(b.number);
  });

  return (
    <div>
      <DashboardRealtime limited={isLawyer} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h1 className="admin-h1" style={{ margin: 0 }}>
          {isLawyer ? "Финансы и перевозки" : "Панель управления"}
        </h1>
        <div
          style={{ fontSize: 13, color: "var(--adm-muted)" }}
        >
          {new Date().toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
      </div>

      {/* Основная статистика */}
      {!isLawyer && (
      <div className="admin-stat-grid" style={{ marginBottom: 24 }}>
        {[
          {
            label: "Товаров",
            value: allProducts.length,
            icon: <Package size={20} />,
            href: `/${ADMIN_PATH}/products`,
            iconBg: "rgba(27,43,75,0.08)",
            iconColor: "#1b2b4b",
            sub: `${allProducts.filter((p) => (p.stockQty ?? 0) > 0).length} в наличии`,
          },
          {
            label: "Категорий",
            value: allCats.length,
            icon: <FolderOpen size={20} />,
            href: `/${ADMIN_PATH}/categories`,
            iconBg: "rgba(217,119,6,0.12)",
            iconColor: "#d97706",
            sub: `${allCats.filter((c) => c.isVisible !== false).length} видимых`,
          },
          {
            label: "Новых заявок",
            value: newOrdersCount,
            icon: <TrendingUp size={20} />,
            href: `/${ADMIN_PATH}/orders?status=new`,
            iconBg: "#fef2f2",
            iconColor: "#ef4444",
            sub: "требуют обработки",
          },

          {
            label: "Выручка",
            value:
              financeIncoming - financeOutgoing !== 0
                ? `${((financeIncoming - financeOutgoing) / 1000).toFixed(0)}К ₽`
                : "—",
            icon: <BarChart3 size={20} />,
            href: `/${ADMIN_PATH}/orders?status=completed`,
            iconBg: "rgba(16,185,129,0.1)",
            iconColor: "#10b981",
            sub: `оплаты минус расходы · ${dashboardDate.slice(0, 7)}`,
          },
          {
            label: "К оплате нам",
            value: `${(bankSummary.expectedIn / 1000).toFixed(0)}К ₽`,
            icon: <TrendingUp size={20} />,
            href: `/${ADMIN_PATH}/warehouse?tab=bank`,
            iconBg: "rgba(16,185,129,0.1)",
            iconColor: "#10b981",
            sub: `${unpaidDeals.length} неоплаченных заказов`,
          },
          {
            label: "Мы должны",
            value: `${(bankSummary.expectedOut / 1000).toFixed(0)}К ₽`,
            icon: <AlertTriangle size={20} />,
            href: `/${ADMIN_PATH}/warehouse?tab=bank`,
            iconBg: "#fef2f2",
            iconColor: "#ef4444",
            sub: `${unpaidReceipts.length} поставок + ${unpaidIndependentPayments.length} платежей`,
          },
          {
            label: "Склад в ценах",
            value: `${(stockValue / 1000).toFixed(0)}К ₽`,
            icon: <Package size={20} />,
            href: `/${ADMIN_PATH}/warehouse?tab=stock`,
            iconBg: "rgba(27,43,75,0.08)",
            iconColor: "#1b2b4b",
            sub: `${outOfStockProducts.length} нет, ${lowStockProducts.length} скоро закончатся`,
          },
          {
            label: "Акции",
            value: promotions.length,
            icon: <Megaphone size={20} />,
            href: `/${ADMIN_PATH}/promotions`,
            iconBg: "rgba(234,179,8,0.12)",
            iconColor: "#eaaf08",
            sub: `${promotions.filter((p) => p.isVisible !== false).length} активных`,
          },
          {
            label: "Отзывы",
            value: 0,
            icon: <Star size={20} />,
            href: `/${ADMIN_PATH}/reviews`,
            iconBg: "rgba(245,166,35,0.12)",
            iconColor: "#f5a623",
            sub: "управление отзывами",
          },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href} className="admin-stat" prefetch={false}>
            <div
              className="admin-stat__icon"
              style={{
                background: stat.iconBg,
                color: stat.iconColor,
              }}
            >
              {stat.icon}
            </div>
            <div className="admin-stat__value">{stat.value}</div>
            <div className="admin-stat__label">{stat.label}</div>
            {stat.sub && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--adm-muted)",
                  marginTop: 2,
                }}
              >
                {stat.sub}
              </div>
            )}
          </Link>
        ))}
      </div>
      )}

      <div className="dash-report-grid">
      {/* Полная аналитика по банку и кассе */}
      <section className="admin-card dash-finance">
        <div className="dash-section-head">
          <div>
            <span className="dash-section-kicker">Финансовая отчётность</span>
            <h2>Банковские счета: приход и расход</h2>
            <p id="dash-finance-period-label">Фактические проведённые операции за текущий месяц.</p>
          </div>
          {!isLawyer && (
            <Link
              href={`/${ADMIN_PATH}/warehouse?tab=bank`}
              className="admin-btn admin-btn--ghost"
              prefetch={false}
            >
              <ExternalLink size={13} /> Открыть банк
            </Link>
          )}
        </div>

        <div className="dash-finance-totals">
          <div className="dash-finance-total dash-finance-total--in">
            <span className="dash-finance-total__icon" aria-hidden="true">
              <ArrowDownLeft size={18} />
            </span>
            <span className="dash-finance-total__content">
              <span id="dash-finance-in-label">Приход за месяц</span>
              <strong id="dash-finance-in-value">+{money(financeIncoming)}</strong>
            </span>
          </div>
          <div className="dash-finance-total dash-finance-total--out">
            <span className="dash-finance-total__icon" aria-hidden="true">
              <ArrowUpRight size={18} />
            </span>
            <span className="dash-finance-total__content">
              <span id="dash-finance-out-label">Расход за месяц</span>
              <strong id="dash-finance-out-value">−{money(financeOutgoing)}</strong>
            </span>
          </div>
          <div className="dash-finance-total dash-finance-total--bank">
            <span className="dash-finance-total__icon" aria-hidden="true">
              <CreditCard size={18} />
            </span>
            <span className="dash-finance-total__content">
              <span>Расчётный счёт сейчас</span>
              <strong>{money(bankSummary.bankBalance)}</strong>
            </span>
          </div>
          <div className="dash-finance-total dash-finance-total--cash">
            <span className="dash-finance-total__icon" aria-hidden="true">
              <Banknote size={18} />
            </span>
            <span className="dash-finance-total__content">
              <span>Касса сейчас</span>
              <strong>{money(bankSummary.cashBalance)}</strong>
            </span>
          </div>
        </div>

        <div className="dash-account-grid">
          <div className="dash-account-card dash-account-card--bank">
            <div className="dash-account-card__head">
              <div className="dash-account-card__icon" aria-hidden="true">
                <CreditCard size={18} />
              </div>
              <div className="dash-account-card__copy">
                <strong>Расчётный счёт</strong>
                <span>Безналичные операции</span>
              </div>
            </div>
            <div className="dash-account-card__balance">
              <span>Текущий остаток</span>
              <strong>{money(bankSummary.bankBalance)}</strong>
            </div>
            <div className="dash-account-card__turnover">
              <span>Приход <b id="dash-finance-bank-in" className="dash-money-in">+{money(bankIncoming)}</b></span>
              <span>Расход <b id="dash-finance-bank-out" className="dash-money-out">−{money(bankOutgoing)}</b></span>
            </div>
          </div>
          <div className="dash-account-card dash-account-card--cash">
            <div className="dash-account-card__head">
              <div className="dash-account-card__icon" aria-hidden="true">
                <Banknote size={18} />
              </div>
              <div className="dash-account-card__copy">
                <strong>Касса</strong>
                <span>С прошлых дней: {money(cashCarryover.previousDaysRemaining)}</span>
              </div>
            </div>
            <div className="dash-account-card__balance">
              <span>Сейчас в кассе</span>
              <strong>{money(bankSummary.cashBalance)}</strong>
            </div>
            <div className="dash-account-card__turnover">
              <span>Приход <b id="dash-finance-cash-in" className="dash-money-in">+{money(cashIncoming)}</b></span>
              <span>Расход <b id="dash-finance-cash-out" className="dash-money-out">−{money(cashOutgoing)}</b></span>
            </div>
          </div>
        </div>

        <DashboardFinanceHistory
          rows={financeRows}
          adminPath={ADMIN_PATH}
          allowNavigation={!isLawyer}
        />
      </section>

      {/* Оплаченные заказы, которые нужно доставить */}
      <section className="admin-card dash-deliveries">
        <div className="dash-section-head">
          <div>
            <span className="dash-section-kicker">Перевозки</span>
            <h2>Доставки и перевозки к выполнению</h2>
            <p>Заказы к доставке и самостоятельные рейсы (вывоз макулатуры, отправки и т.д.).</p>
          </div>
          {!isLawyer && (
            <Link
              href={`/${ADMIN_PATH}/warehouse?tab=deliveries`}
              className="admin-btn admin-btn--ghost"
              prefetch={false}
            >
              <Truck size={13} /> Все перевозки
            </Link>
          )}
        </div>
        {dashboardDeliveries.length > 0 ? (
          <div className="dash-delivery-list">
            {dashboardDeliveries.map((del) => (
              <div key={del.id} className="dash-delivery-row">
                <span className="dash-delivery-row__icon" aria-hidden="true"><Truck size={17} /></span>
                <div className="dash-delivery-row__main">
                  <div className="dash-delivery-row__top">
                    {isLawyer ? (
                      <strong>{del.number}</strong>
                    ) : (
                      <Link
                        href={del.link}
                        prefetch={false}
                      >
                        {del.number}
                      </Link>
                    )}
                    <strong>{del.customerName}</strong>
                    {del.isPaid ? (
                      <span className="admin-badge admin-badge--green">оплачен</span>
                    ) : (
                      <span className="admin-badge admin-badge--blue">перевозка</span>
                    )}
                    {del.date && (
                      <span className="admin-badge admin-badge--amber">
                        план {formatDate(del.date)}
                      </span>
                    )}
                  </div>
                  <div className="dash-delivery-row__address">
                    <MapPin size={13} />
                    {del.address}
                  </div>
                  <div className="dash-delivery-row__meta">
                    {del.phone && (
                      <span>{del.phone}</span>
                    )}
                    <span>{del.itemCount} ед.</span>
                    {del.totalSum !== null && <span>{money(del.totalSum)}</span>}
                    {del.note && <span>{del.note}</span>}
                  </div>
                </div>
                {!isLawyer && (
                  <div className="dash-delivery-row__actions">
                    <Link
                      href={del.link}
                      prefetch={false}
                    >
                      Открыть →
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty">
            <CheckCircle2 size={30} />
            <p>Оплаченных заказов и самостоятельных перевозок к выполнению нет</p>
          </div>
        )}
      </section>
      </div>

      {/* Финансовая отчётность по макулатуре — отдельно от основной */}
      {wpFinance && (
        <section className="admin-card dash-finance" style={{ marginBottom: 24 }}>
          <div className="dash-section-head">
            <div>
              <span className="dash-section-kicker">Отдельный учёт макулатуры</span>
              <h2>Макулатура: наличка и безнал</h2>
              <p>
                Финансы отдельного учёта макулатуры — не смешиваются с банком и
                кассой выше.
              </p>
            </div>
            {session.role === "admin" && (
              <Link
                href={`/${ADMIN_PATH}/wastepaper-account`}
                className="admin-btn admin-btn--ghost"
                prefetch={false}
              >
                <Recycle size={13} /> Открыть учёт макулатуры
              </Link>
            )}
          </div>

          <div className="dash-finance-totals">
            <div className="dash-finance-total dash-finance-total--in">
              <span className="dash-finance-total__icon" aria-hidden="true">
                <ArrowDownLeft size={18} />
              </span>
              <span className="dash-finance-total__content">
                <span>Приход за месяц (макулатура)</span>
                <strong>+{money(wpMonthIncoming)}</strong>
              </span>
            </div>
            <div className="dash-finance-total dash-finance-total--out">
              <span className="dash-finance-total__icon" aria-hidden="true">
                <ArrowUpRight size={18} />
              </span>
              <span className="dash-finance-total__content">
                <span>Расход за месяц (макулатура)</span>
                <strong>−{money(wpMonthOutgoing)}</strong>
              </span>
            </div>
            <div className="dash-finance-total dash-finance-total--in">
              <span className="dash-finance-total__icon" aria-hidden="true">
                <ArrowDownLeft size={18} />
              </span>
              <span className="dash-finance-total__content">
                <span>Прогноз прихода</span>
                <strong>+{money(wpForecast.inTotal)}</strong>
              </span>
            </div>
            <div className="dash-finance-total dash-finance-total--out">
              <span className="dash-finance-total__icon" aria-hidden="true">
                <ArrowUpRight size={18} />
              </span>
              <span className="dash-finance-total__content">
                <span>Прогноз расхода</span>
                <strong>−{money(wpForecast.outTotal)}</strong>
              </span>
            </div>
          </div>

          <div className="dash-account-grid">
            <div className="dash-account-card dash-account-card--cash">
              <div className="dash-account-card__head">
                <div className="dash-account-card__icon" aria-hidden="true">
                  <Banknote size={18} />
                </div>
                <div className="dash-account-card__copy">
                  <strong>Наличка макулатуры</strong>
                  <span>
                    Прогноз: +{money(wpForecast.inCash)} / −{money(wpForecast.outCash)}
                  </span>
                </div>
              </div>
              <div className="dash-account-card__balance">
                <span>Сейчас наличкой</span>
                <strong>{money(wpBalance.cash)}</strong>
              </div>
              <div className="dash-account-card__turnover">
                <span>
                  Итого по учёту <b>{money(wpBalance.total)}</b>
                </span>
              </div>
            </div>
            <div className="dash-account-card dash-account-card--bank">
              <div className="dash-account-card__head">
                <div className="dash-account-card__icon" aria-hidden="true">
                  <CreditCard size={18} />
                </div>
                <div className="dash-account-card__copy">
                  <strong>Безнал макулатуры</strong>
                  <span>
                    Прогноз: +{money(wpForecast.inBank)} / −{money(wpForecast.outBank)}
                  </span>
                </div>
              </div>
              <div className="dash-account-card__balance">
                <span>Сейчас безналом</span>
                <strong>{money(wpBalance.bank)}</strong>
              </div>
              <div className="dash-account-card__turnover">
                <span>
                  Макулатуры на площадке{" "}
                  <b>
                    {(Math.round(wpStockTotalKg * 10) / 10).toLocaleString("ru-RU")} кг
                  </b>
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {!isLawyer && (
        <>
      {/* Воронка статусов */}
      <div
        className="admin-card"
        style={{ marginBottom: 24, padding: "20px 24px" }}
      >
        <div
          style={{
            fontFamily: "Oswald, sans-serif",
            fontWeight: 700,
            color: "#1b2b4b",
            fontSize: 16,
            marginBottom: 16,
          }}
        >
          Статусы заявок
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 12,
          }}
        >
          {[
            {
              label: "Новые",
              count: newOrdersCount,
              icon: <Clock size={16} />,
              color: "#f59e0b",
              bg: "#fffbeb",
              status: "new",
            },
            {
              label: "В работе",
              count: inProgressOrdersCount,
              icon: <TrendingUp size={16} />,
              color: "#3b82f6",
              bg: "#eff6ff",
              status: "in_progress",
            },
            {
              label: "Готов к выдаче",
              count: readyOrdersCount,
              icon: <Package size={16} />,
              color: "#7c3aed",
              bg: "#f5f3ff",
              status: "ready",
            },
            {
              label: "Выполнены",
              count: completedOrdersCount,
              icon: <CheckCircle size={16} />,
              color: "#16a34a",
              bg: "#f0fdf4",
              status: "completed",
            },
            {
              label: "Отменены",
              count: rejectedOrdersCount,
              icon: <XCircle size={16} />,
              color: "#ef4444",
              bg: "#fef2f2",
              status: "rejected",
            },
          ].map((s) => (
            <Link
              key={s.status}
              href={`/${ADMIN_PATH}/orders?status=${s.status}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "16px 12px",
                borderRadius: 12,
                background: s.bg,
                border: `1px solid ${s.color}30`,
                textDecoration: "none",
                gap: 6,
              }}
             prefetch={false}>
              <div style={{ color: s.color }}>{s.icon}</div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: s.color,
                  lineHeight: 1,
                }}
              >
                {s.count}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: s.color,
                  fontWeight: 600,
                }}
              >
                {s.label}
              </div>
              {totalOrdersCount > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    color: `${s.color}99`,
                  }}
                >
                  {Math.round((s.count / totalOrdersCount) * 100)}%
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginBottom: 24,
        }}
        className="admin-dash-grid"
      >
        {/* Последние заявки */}
        <div className="admin-card">
          <div
            style={{
              padding: "16px 24px",
              borderBottom: "1px solid rgba(200,196,188,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <h2
              style={{
                fontFamily: "Oswald, sans-serif",
                fontWeight: 700,
                color: "#1b2b4b",
                fontSize: 16,
              }}
            >
              Последние заявки
            </h2>
            <Link
              href={`/${ADMIN_PATH}/orders`}
              style={{
                fontSize: 13,
                color: "#d97706",
                fontWeight: 600,
              }}
             prefetch={false}>
              Все →
            </Link>
          </div>

          {recentOrders.length > 0 ? (
            <div>
              {recentOrders.map((order) => {
                const o = order as any;
                return (
                  <div
                    key={o.id}
                    style={{
                      padding: "12px 24px",
                      borderBottom: "1px solid rgba(200,196,188,0.15)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "#1b2b4b",
                          fontSize: 13,
                        }}
                      >
                        {o.customerName}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "rgba(55,65,81,0.5)",
                        }}
                      >
                        {o.customerPhone}
                      </div>
                    </div>
                    <span
                      className={
                        statusColors[o.status || "new"] ||
                        statusColors.new
                      }
                    >
                      {statusLabels[o.status || "new"] || o.status}
                    </span>
                    {o.totalSum > 0 && (
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#1b2b4b",
                        }}
                      >
                        {o.totalSum.toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        color: "rgba(55,65,81,0.4)",
                      }}
                    >
                      {formatDate(o.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                padding: "32px 24px",
                textAlign: "center",
                color: "rgba(55,65,81,0.4)",
                fontSize: 14,
              }}
            >
              Заявок пока нет
            </div>
          )}
        </div>

        {/* Правая колонка */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Мало на складе */}
          <div className="admin-card" style={{ flex: 1 }}>
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid rgba(200,196,188,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h2
                style={{
                  fontFamily: "Oswald, sans-serif",
                  fontWeight: 700,
                  color: "#1b2b4b",
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  whiteSpace: "nowrap",
                }}
              >
                <AlertTriangle size={15} />
                Мало на складе
              </h2>
              <Link
                href={`/${ADMIN_PATH}/products/bulk`}
                style={{
                  fontSize: 13,
                  color: "#d97706",
                  fontWeight: 600,
                }}
               prefetch={false}>
                Редактировать →
              </Link>
            </div>

            {outOfStockProducts.length + lowStockProducts.length > 0 ? (
              <div>
                {[...outOfStockProducts, ...lowStockProducts].slice(0, 8).map((p) => {
                  const qty = Number(p.stockQty) || 0;
                  const warn = p.stockWarnQty != null ? Number(p.stockWarnQty) : 10;
                  return (
                    <Link
                      key={p.id}
                      href={`/${ADMIN_PATH}/products/${p.id}`}
                      prefetch={false}
                      style={{
                        padding: "10px 24px",
                        borderBottom: "1px solid rgba(200,196,188,0.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        textDecoration: "none",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          color: "#1b2b4b",
                          fontWeight: 500,
                          flex: 1,
                        }}
                      >
                        {p.name}
                        <div style={{ color: "var(--adm-muted)", fontSize: 11 }}>
                          порог предупреждения: {warn} шт.
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: qty <= 0 ? "#ef4444" : "#f59e0b",
                          background: qty <= 0 ? "#fef2f2" : "#fffbeb",
                          padding: "2px 8px",
                          borderRadius: 999,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {qty <= 0 ? "нет в наличии" : `пополните: ${qty} шт.`}
                      </span>
                    </Link>
                  );
                })}
                {outOfStockProducts.length + lowStockProducts.length > 8 && (
                  <div
                    style={{
                      padding: "10px 24px",
                      fontSize: 12,
                      color: "var(--adm-muted)",
                    }}
                  >
                    + ещё {outOfStockProducts.length + lowStockProducts.length - 8} товаров
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  padding: "24px",
                  textAlign: "center",
                  color: "rgba(55,65,81,0.4)",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    whiteSpace: "nowrap",
                  }}
                >
                  <CheckCircle2 size={15} />
                  Склад в норме
                </span>
              </div>
            )}
          </div>

          {/* Быстрые действия */}
          <div
            className="admin-card"
            style={{ padding: "16px 24px" }}
          >
            <div
              style={{
                fontFamily: "Oswald, sans-serif",
                fontWeight: 700,
                color: "#1b2b4b",
                fontSize: 16,
                marginBottom: 14,
              }}
            >
              Быстрые действия
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {[
                {
                  href: `/${ADMIN_PATH}/products/new`,
                  label: "Добавить товар",
                  icon: <Plus size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/products/bulk`,
                  label: "Массовое редактирование",
                  icon: <Pencil size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/orders?status=new`,
                  label: `Новые заявки (${newOrdersCount})`,
                  icon: <ClipboardList size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/deliveries`,
                  label: "Доставки и планирование",
                  icon: <TrendingUp size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/categories`,
                  label: "Управление категориями",
                  icon: <FolderOpen size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/promotions`,
                  label: `Акции и спецпредложения (${promotions.length})`,
                  icon: <Megaphone size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/reviews`,
                  label: "Отзывы покупателей",
                  icon: <Star size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/settings`,
                  label: "Настройки сайта",
                  icon: <Settings size={14} />,
                },
              ]
                .filter(
                  (action) =>
                    session.role === "admin" ||
                    action.href !== `/${ADMIN_PATH}/settings`
                )
                .map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "var(--adm-bg, #f8f7f4)",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#1b2b4b",
                    textDecoration: "none",
                    border: "1px solid transparent",
                    transition: "border-color 0.15s",
                  }}
                 prefetch={false}>
                  {action.icon}
                  {action.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
        </>
      )}

      <style>{`\n        @media (max-width: 768px) {\n          .admin-dash-grid {\n            grid-template-columns: 1fr !important;\n          }\n        }\n      `}</style>
    </div>
  );
}