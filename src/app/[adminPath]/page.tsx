// src/app/[adminPath]/page.tsx
// Единая панель операций: финансы двух независимых учётов, заказы,
// поступления и уже сформированные перевозки.

import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  ExternalLink,
  Landmark,
  PackageCheck,
  Recycle,
  ReceiptText,
  Truck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminDb } from "@/lib/supabase";
import { verifySession } from "@/lib/auth";
import {
  getAccountTransfers,
  getCashCollections,
  getDeals,
  getPayments,
  getReceipts,
  getSalaries,
  getTransports,
} from "@/lib/warehouse";
import { getMoneyAdjustments } from "@/lib/money-accounts";
import { getSupplyPlans } from "@/lib/supply-plans";
import { supplyPlansItemsCount } from "@/lib/supply-plans-shared";
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
  getCashCarryoverSummary,
  getDealPaidMap,
  getReceiptPaidMap,
  isDebtSalaryComment,
  isRentSalaryComment,
  isSalaryExcludedFromBalance,
  isWastepaperSalary,
  stripSalaryMetaTags,
  type BankPayment,
  type Salary,
} from "@/lib/warehouse-shared";
import { DashboardFinanceHistory, type DashboardFinanceRow } from "@/components/admin/DashboardFinanceHistory";
import { DashboardQuickActions } from "@/components/admin/DashboardQuickActions";
import { DashboardRealtime } from "@/components/admin/DashboardRealtime";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.NEXT_PUBLIC_ADMIN_PATH || process.env.ADMIN_SECRET_PATH || "admin";

/**
 * Дашборд должен оставаться доступным и при временном сбое Supabase:
 * в этом случае показываем пустую секцию, а не падаем всей страницей.
 */
function safeLoad<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch((error: unknown) => {
    console.error("dashboard: загрузка данных не удалась:", error);
    return fallback;
  });
}

async function countByStatus(table: string, status: string): Promise<number> {
  const db = getAdminDb();
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) {
    console.error(`dashboard: count ${table}/${status}:`, error.message);
    return 0;
  }
  return count || 0;
}

const money = (value: number) => `${(Number(value) || 0).toLocaleString("ru-RU")} ₽`;

function formatDate(raw?: string | null): string {
  if (!raw) return "Без даты";
  const dateOnly = String(raw).slice(0, 10);
  const date = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function formatMonth(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
}

function salaryMonthLabel(salary: Salary): string {
  return formatMonth(salary.periodMonth || salary.date.slice(0, 7));
}

function paymentPurpose(payment: BankPayment): string {
  if (payment.direction === "incoming" && payment.dealIds.length > 0) return "Оплата заказа";
  if (payment.direction === "outgoing" && payment.receiptIds.length > 0) return "Оплата поставки";
  if (payment.type === "refund") return "Возврат";
  if (payment.type === "deposit") return "Внесение";
  if (payment.type === "transfer") return "Перевод";
  if (payment.type === "cash") {
    return payment.direction === "incoming" ? "Приход наличными" : "Расход наличными";
  }
  return payment.direction === "incoming" ? "Прочий приход" : "Прочий расход";
}

const DEAL_STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "Новый", tone: "amber" },
  completed: { label: "Отпущен", tone: "green" },
  cancelled: { label: "Отменён", tone: "red" },
};

const RECEIPT_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Ожидает приёмки", tone: "amber" },
  posted: { label: "Принята", tone: "green" },
};

function DashboardRow({
  href,
  code,
  title,
  meta,
  amount,
  status,
  icon,
}: {
  href: string;
  code: string;
  title: string;
  meta: string;
  amount?: string;
  status?: { label: string; tone: string };
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} className="dash-control-row" prefetch={false}>
      <span className="dash-control-row__icon" aria-hidden="true">{icon}</span>
      <span className="dash-control-row__main">
        <span className="dash-control-row__title">
          <strong>{code}</strong>
          {status && <span className={`dash-control-status dash-control-status--${status.tone}`}>{status.label}</span>}
        </span>
        <span className="dash-control-row__name">{title}</span>
        <span className="dash-control-row__meta">{meta}</span>
      </span>
      <span className="dash-control-row__side">
        {amount && <strong>{amount}</strong>}
        <ArrowRight size={15} aria-hidden="true" />
      </span>
    </Link>
  );
}

export default async function AdminDashboard() {
  const session = await verifySession();
  if (!session) redirect(`/${ADMIN_PATH}/login`);
  if (session.role === "wastepaper") redirect(`/${ADMIN_PATH}/wastepaper-account`);
  const isLawyer = session.role === "lawyer";

  const [payments, accountTransfers, salaries, deals, receipts, cashCollections, transports, supplyPlans, newSiteRequests] =
    await Promise.all([
      safeLoad(getPayments(), []),
      safeLoad(getAccountTransfers(), []),
      safeLoad(getSalaries(), []),
      safeLoad(isLawyer ? Promise.resolve([]) : getDeals(), []),
      safeLoad(isLawyer ? Promise.resolve([]) : getReceipts(), []),
      safeLoad(getCashCollections(), []),
      safeLoad(getTransports(), []),
      safeLoad(isLawyer ? Promise.resolve([]) : getSupplyPlans(), []),
      safeLoad(isLawyer ? Promise.resolve(0) : countByStatus("orders", "new"), 0),
    ]);

  // Используем правки только в расчёте остатка — подробности остаются в учёте владельца.
  const moneyAdjustments = await getMoneyAdjustments().catch(() => []);
  const wpFinance = await getWpFinanceData().catch((error) => {
    console.error("dashboard: финансы макулатуры:", error);
    return null;
  });

  const dashboardDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Novosibirsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const monthKey = dashboardDate.slice(0, 7);
  const bankSummary = getBankSummary(
    payments,
    salaries,
    cashCollections,
    dashboardDate,
    deals.length ? deals : undefined,
    accountTransfers,
    moneyAdjustments,
  );
  const cashCarryover = getCashCarryoverSummary(
    payments,
    salaries,
    cashCollections,
    dashboardDate,
    accountTransfers,
    moneyAdjustments,
  );

  const dealPaidMap = getDealPaidMap(payments);
  const receiptPaidMap = getReceiptPaidMap(payments);
  const activeDeals = deals.filter((deal) => deal.status !== "cancelled" && !deal.isArchive);
  const unpaidDeals = activeDeals.filter((deal) => (dealPaidMap.get(deal.id) || 0) + 0.009 < deal.total);
  const unpaidReceipts = receipts.filter(
    (receipt) => receipt.status === "posted" && (receiptPaidMap.get(receipt.id) || 0) + 0.009 < receipt.total,
  );
  const openReceipts = receipts.filter((receipt) => receipt.status === "draft");
  const activeSupplyPlans = supplyPlans.filter((plan) => plan.status === "active");
  const plannedSupplyItems = supplyPlansItemsCount(activeSupplyPlans);
  const recentDeals = [...deals]
    .filter((deal) => !deal.isArchive)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5);
  const recentReceipts = [...receipts]
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 4);
  const activeTransports = transports
    .filter((transport) => transport.status === "draft" || transport.status === "active")
    .sort((a, b) => (a.plannedDate || a.date || "").localeCompare(b.plannedDate || b.date || ""))
    .slice(0, 5);

  const wpEvents = wpFinance
    ? wpCollectMoneyEvents(
        wpFinance.intakes,
        wpFinance.shipments,
        wpFinance.manualPayments,
        wpFinance.salaries,
        wpFinance.accountTransfers,
      )
    : [];
  const wpBalance = getWpBalance(wpEvents, dashboardDate);
  const wpForecast = getWpForecast(wpEvents);
  const wpStockTotalKg = wpFinance
    ? getWpStock(wpFinance.intakes, wpFinance.shipments, wpFinance.stockAdjustments).reduce(
        (sum, row) => sum + Math.max(0, row.stockKg),
        0,
      )
    : 0;
  const wpMonthEvents = wpEvents.filter(
    (event) =>
      !event.cancelled &&
      !event.internal &&
      event.isPaid &&
      wpEventEffectiveDate(event).startsWith(monthKey),
  );
  const wpMonthIncoming = wpMonthEvents
    .filter((event) => event.direction === "incoming")
    .reduce((sum, event) => sum + event.amount, 0);
  const wpMonthOutgoing = wpMonthEvents
    .filter((event) => event.direction === "outgoing")
    .reduce((sum, event) => sum + event.amount, 0);

  const paymentFinanceRows: DashboardFinanceRow[] = payments
    .filter((payment) => payment.isPaid && !payment.excludeFromBalance)
    .map((payment) => ({
      id: `payment-${payment.id}`,
      date: payment.paidAt || payment.date,
      direction: payment.direction,
      account:
        payment.type === "cash"
          ? "cash"
          : payment.type === "ym_card"
            ? "ym_card"
            : payment.type === "vm_card"
              ? "vm_card"
              : "bank",
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
      dealLinks: payment.dealIds.map((id, index) => ({ id, number: payment.dealNumbers[index] || 0 })),
      receiptLinks: payment.receiptIds.map((id, index) => ({ id, number: payment.receiptNumbers[index] || 0 })),
    }));

  // Выплаты с аренды/макулатуры относятся к другим счетам и не смешиваются
  // с фактом зарплат СибГофроТорга.
  const salaryFinanceRows: DashboardFinanceRow[] = salaries
    .filter(
      (salary) =>
        salary.isPaid &&
        !isSalaryExcludedFromBalance(salary.comment) &&
        !isRentSalaryComment(salary.comment, salary.source) &&
        !isWastepaperSalary(salary),
    )
    .map((salary) => ({
      id: `salary-${salary.id}`,
      date: salary.paidAt || salary.date,
      direction: "outgoing",
      account: salary.source,
      category: isDebtSalaryComment(salary.comment) ? "Выплата в счёт долга" : "Зарплата",
      counterparty: salary.employeeName,
      amount: salary.amount,
      detail: [
        isDebtSalaryComment(salary.comment) ? "не входит в факт зарплаты месяца" : `за ${salaryMonthLabel(salary)}`,
        stripSalaryMetaTags(salary.comment),
      ].filter(Boolean).join(" · "),
      href: `/${ADMIN_PATH}/warehouse?tab=salaries`,
    }));

  // Лента единая, но счета и бизнес-логика остаются раздельными.
  const wpFinanceRows: DashboardFinanceRow[] = wpEvents
    .filter((event) => event.isPaid && !event.cancelled && !event.internal)
    .map((event) => ({
      id: `wp-${event.kind}-${event.id}-${event.account}-${event.direction}`,
      date: wpEventEffectiveDate(event) || event.date,
      direction: event.direction,
      account:
        event.account === "cash"
          ? "wastepaper"
          : event.account === "bank"
            ? "wastepaper_bank"
            : "wastepaper_third",
      category:
        event.kind === "salary"
          ? "Зарплата · макулатура"
          : event.kind === "intake"
            ? "Приём макулатуры"
            : event.kind === "shipment"
              ? "Сдача макулатуры"
              : event.kind === "transfer"
                ? "Перевод"
                : "Платёж макулатуры",
      counterparty: event.counterpartyName || event.title,
      amount: event.amount,
      detail: event.comment || event.title,
      href: `/${ADMIN_PATH}/wastepaper-account?tab=bank`,
    }));
  const financeRows: DashboardFinanceRow[] = [...paymentFinanceRows, ...salaryFinanceRows, ...wpFinanceRows];

  const currentMonthFinanceRows = [...paymentFinanceRows, ...salaryFinanceRows].filter((row) =>
    row.date.startsWith(monthKey),
  );
  const financeIncoming = currentMonthFinanceRows
    .filter((row) => row.direction === "incoming")
    .reduce((sum, row) => sum + row.amount, 0);
  const financeOutgoing = currentMonthFinanceRows
    .filter((row) => row.direction === "outgoing")
    .reduce((sum, row) => sum + row.amount, 0);

  const displayDate = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Novosibirsk",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <main className="dash-page dash-control">
      <DashboardRealtime limited={isLawyer} />

      <header className="dash-control__hero">
        <div className="dash-control__hero-copy">
          <div className="dash-control__eyebrow"><span /> Единый центр операций</div>
          <h1>Панель управления</h1>
          <p>Деньги, заказы, поступления и сформированные перевозки — в одном месте.</p>
          <div className="dash-control__legend">
            <span><i className="dash-control__legend-dot dash-control__legend-dot--sgt" />СибГофроТорг</span>
            <span><i className="dash-control__legend-dot dash-control__legend-dot--wp" />Макулатура</span>
            <span className="dash-control__legend-note">счета раздельные · логистика общая</span>
          </div>
        </div>
        <div className="dash-control__hero-actions">
          <div className="dash-control__date"><CalendarDays size={15} aria-hidden="true" />{displayDate}</div>
          {!isLawyer && <DashboardQuickActions adminPath={ADMIN_PATH} />}
        </div>
      </header>

      <section className="dash-control__overview" aria-label="Сводка по подразделениям">
        <article className="dash-control-card dash-control-card--sgt">
          <div className="dash-control-card__head">
            <span className="dash-control-card__mark"><Landmark size={18} /></span>
            <div className="dash-control-card__title">
              <span>СИБГОФРОТОРГ</span>
              <small>Основной товарный учёт</small>
            </div>
            {!isLawyer && <Link href={`/${ADMIN_PATH}/warehouse?tab=bank`} className="dash-control-card__link" prefetch={false} aria-label="Открыть учёт СибГофроТорг"><ExternalLink size={15} /></Link>}
          </div>
          <div className="dash-control-card__balance">
            <span>Всего на счетах учёта</span>
            <strong>{money(bankSummary.balance)}</strong>
            <small>Ожидает поступления {money(bankSummary.expectedIn)}</small>
          </div>
          <div className="dash-control-card__accounts">
            <div><span><CreditCard size={14} />Расчётный счёт</span><b>{money(bankSummary.bankBalance)}</b></div>
            <div><span><Banknote size={14} />Касса</span><b>{money(bankSummary.cashBalance)}</b></div>
            <div><span><Wallet size={14} />Карта ЮМ</span><b>{money(bankSummary.ymCardBalance)}</b></div>
            <div><span><Wallet size={14} />Карта В.М.</span><b>{money(bankSummary.vmCardBalance)}</b></div>
          </div>
          <div className="dash-control-card__turnover">
            <span>Движение за месяц <b>{formatMonth(monthKey)}</b></span>
            <div><strong className="dash-money-in">+{money(financeIncoming)}</strong><strong className="dash-money-out">−{money(financeOutgoing)}</strong></div>
          </div>
          <div className="dash-control-card__carry">В кассе с прошлых дней: {money(cashCarryover.previousDaysRemaining)}</div>
        </article>

        {wpFinance && (
          <article className="dash-control-card dash-control-card--wp">
            <div className="dash-control-card__head">
              <span className="dash-control-card__mark"><Recycle size={18} /></span>
              <div className="dash-control-card__title">
                <span>МАКУЛАТУРА</span>
                <small>Отдельный денежный учёт</small>
              </div>
              {!isLawyer && <Link href={`/${ADMIN_PATH}/wastepaper-account?tab=bank`} className="dash-control-card__link" prefetch={false} aria-label="Открыть учёт макулатуры"><ExternalLink size={15} /></Link>}
            </div>
            <div className="dash-control-card__balance">
              <span>Общий остаток · без сторонних средств</span>
              <strong>{money(wpBalance.common)}</strong>
              <small>Склад макулатуры {wpStockTotalKg.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} кг</small>
            </div>
            <div className="dash-control-card__accounts dash-control-card__accounts--two">
              <div><span><Banknote size={14} />Наличка</span><b>{money(wpBalance.cash)}</b></div>
              <div><span><CreditCard size={14} />Безнал</span><b>{money(wpBalance.bank)}</b></div>
            </div>
            <div className="dash-control-card__third">
              <span><Wallet size={14} />Сторонние средства <small>отдельно от общего баланса</small></span>
              <b>{money(wpBalance.third_party)}</b>
            </div>
            <div className="dash-control-card__turnover">
              <span>Движение за месяц <b>{formatMonth(monthKey)}</b></span>
              <div><strong className="dash-money-in">+{money(wpMonthIncoming)}</strong><strong className="dash-money-out">−{money(wpMonthOutgoing)}</strong></div>
            </div>
            <div className="dash-control-card__forecast">Планируется: приход {money(wpForecast.inTotal)} · расход {money(wpForecast.outTotal)}</div>
          </article>
        )}

        <article className="dash-control-card dash-control-card--queue">
          <div className="dash-control-card__head">
            <span className="dash-control-card__mark"><ClipboardList size={18} /></span>
            <div className="dash-control-card__title">
              <span>РАБОЧАЯ ОЧЕРЕДЬ</span>
              <small>Что требует внимания сейчас</small>
            </div>
          </div>
          <div className="dash-control-queue">
            <Link href={`/${ADMIN_PATH}/warehouse?tab=deals`} prefetch={false}>
              <span className="dash-control-queue__icon"><ReceiptText size={15} /></span>
              <span><strong>Заказы СГТ</strong><small>{unpaidDeals.length} не оплачено полностью</small></span>
              <b>{activeDeals.length}</b>
            </Link>
            <Link href={`/${ADMIN_PATH}/warehouse?tab=receipts`} prefetch={false}>
              <span className="dash-control-queue__icon"><PackageCheck size={15} /></span>
              <span><strong>Поставки</strong><small>{openReceipts.length} ожидают приёмки</small></span>
              <b>{receipts.length}</b>
            </Link>
            <Link href={`/${ADMIN_PATH}/warehouse?tab=deliveries`} prefetch={false}>
              <span className="dash-control-queue__icon"><Truck size={15} /></span>
              <span><strong>Сформированные рейсы</strong><small>общая логистика двух подразделений</small></span>
              <b>{transports.filter((transport) => transport.status === "draft" || transport.status === "active").length}</b>
            </Link>
            <Link href={`/${ADMIN_PATH}/orders?status=new`} prefetch={false}>
              <span className="dash-control-queue__icon"><CheckCircle2 size={15} /></span>
              <span><strong>Новые заявки сайта</strong><small>отдельно от заказов внутреннего учёта</small></span>
              <b>{newSiteRequests}</b>
            </Link>
          </div>
          <div className="dash-control-card__queue-foot">
            Активные планы поставок: <b>{activeSupplyPlans.length}</b>
            <span> · {plannedSupplyItems} позиций</span>
          </div>
        </article>
      </section>

      {!isLawyer && (
        <section className="dash-control__work" aria-label="Заказы, поставки и перевозки">
          <article className="dash-control-panel">
            <div className="dash-control-panel__head">
              <div className="dash-control-panel__title">
                <span className="dash-control-panel__icon dash-control-panel__icon--orders"><ReceiptText size={17} /></span>
                <div><h2>Заказы СибГофроТорга</h2><p>Внутренний учёт покупателей</p></div>
              </div>
              <Link href={`/${ADMIN_PATH}/warehouse?tab=deals`} className="dash-control-panel__all" prefetch={false}>Все <ArrowRight size={14} /></Link>
            </div>
            <div className="dash-control-panel__summary">
              <span><b>{activeDeals.length}</b> активных</span>
              <span><b>{unpaidDeals.length}</b> с остатком к оплате</span>
            </div>
            {recentDeals.length ? (
              <div className="dash-control-panel__rows">
                {recentDeals.map((deal) => {
                  const status = DEAL_STATUS[deal.status] || { label: deal.status, tone: "muted" };
                  const paid = dealPaidMap.get(deal.id) || 0;
                  return (
                    <DashboardRow
                      key={deal.id}
                      href={`/${ADMIN_PATH}/warehouse?tab=deals&deal=${deal.id}`}
                      code={`ЗК-${deal.number}`}
                      title={deal.customerName || "Покупатель не указан"}
                      meta={`${formatDate(deal.date)} · ${deal.items.length} поз.`}
                      amount={money(deal.total)}
                      status={status}
                      icon={<ReceiptText size={15} />}
                    />
                  );
                })}
              </div>
            ) : <div className="dash-control-empty">Заказов пока нет</div>}
            <div className="dash-control-panel__footnote">Создано оплат: {money([...dealPaidMap.entries()].reduce((sum, [id, value]) => sum + (deals.some((deal) => deal.id === id) ? value : 0), 0))}</div>
          </article>

          <article className="dash-control-panel">
            <div className="dash-control-panel__head">
              <div className="dash-control-panel__title">
                <span className="dash-control-panel__icon dash-control-panel__icon--supplies"><PackageCheck size={17} /></span>
                <div><h2>Поставки</h2><p>Поступления и планы закупки</p></div>
              </div>
              <Link href={`/${ADMIN_PATH}/warehouse?tab=receipts`} className="dash-control-panel__all" prefetch={false}>Все <ArrowRight size={14} /></Link>
            </div>
            <div className="dash-control-panel__summary">
              <span><b>{openReceipts.length}</b> ожидают приёмки</span>
              <span><b>{unpaidReceipts.length}</b> не оплачено полностью</span>
            </div>
            {recentReceipts.length ? (
              <div className="dash-control-panel__rows">
                {recentReceipts.map((receipt) => {
                  const status = receipt.transportFinishedAt
                    ? { label: "Поставка закрыта", tone: "green" }
                    : RECEIPT_STATUS[receipt.status] || { label: receipt.status, tone: "muted" };
                  return (
                    <DashboardRow
                      key={receipt.id}
                      href={`/${ADMIN_PATH}/warehouse?tab=receipts&receipt=${receipt.id}`}
                      code={`ПО-${receipt.number}`}
                      title={receipt.supplier || "Поставщик не указан"}
                      meta={`${formatDate(receipt.date)} · ${receipt.items.length} поз.${receipt.needsTransport ? " · заберём сами" : ""}`}
                      amount={money(receipt.total)}
                      status={status}
                      icon={<PackageCheck size={15} />}
                    />
                  );
                })}
              </div>
            ) : <div className="dash-control-empty">Поступлений пока нет</div>}
            {activeSupplyPlans.length > 0 && (
              <div className="dash-control-plans">
                <div className="dash-control-plans__head"><span>Планы закупки</span><Link href={`/${ADMIN_PATH}/warehouse?tab=plans`} prefetch={false}>Открыть →</Link></div>
                {activeSupplyPlans.slice(0, 2).map((plan) => (
                  <Link key={plan.id} href={`/${ADMIN_PATH}/warehouse?tab=plans`} className="dash-control-plan" prefetch={false}>
                    <span><strong>{plan.name}</strong><small>{plan.items.length} поз. · {plan.items.slice(0, 2).map((item) => item.productName).join(", ") || "без позиций"}</small></span>
                    <small>{formatDate(plan.plannedDate)}</small>
                  </Link>
                ))}
              </div>
            )}
          </article>

          <article className="dash-control-panel dash-control-panel--delivery">
            <div className="dash-control-panel__head">
              <div className="dash-control-panel__title">
                <span className="dash-control-panel__icon dash-control-panel__icon--delivery"><Truck size={17} /></span>
                <div><h2>Сформированные доставки</h2><p>Единые рейсы для СГТ и макулатуры</p></div>
              </div>
              <Link href={`/${ADMIN_PATH}/warehouse?tab=deliveries`} className="dash-control-panel__all" prefetch={false}>Все <ArrowRight size={14} /></Link>
            </div>
            <div className="dash-control-panel__summary">
              <span><b>{transports.filter((transport) => transport.status === "active").length}</b> активных</span>
              <span><b>{transports.filter((transport) => transport.status === "draft").length}</b> черновиков</span>
            </div>
            {activeTransports.length ? (
              <div className="dash-control-panel__rows">
                {activeTransports.map((transport) => (
                  <DashboardRow
                    key={transport.id}
                    href={`/${ADMIN_PATH}/warehouse?tab=deliveries&transport=${transport.id}`}
                    code={`ПЕР-${transport.number}`}
                    title={transport.driverName || "Водитель не назначен"}
                    meta={`${formatDate(transport.plannedDate || transport.date)} · ${transport.items.length} точек · ${transport.totalItems} ед.`}
                    status={transport.status === "active" ? { label: "Сформирована", tone: "green" } : { label: "Черновик", tone: "amber" }}
                    icon={<Truck size={15} />}
                  />
                ))}
              </div>
            ) : <div className="dash-control-empty">Сформированных рейсов пока нет</div>}
            <div className="dash-control-panel__footnote">Поставки и макулатура попадают в один маршрут только через общий раздел перевозок.</div>
          </article>
        </section>
      )}

      <section className="dash-control-panel dash-control-panel--finance" aria-label="Движение средств">
        <div className="dash-control-panel__head dash-control-panel__head--finance">
          <div className="dash-control-panel__title">
            <span className="dash-control-panel__icon dash-control-panel__icon--finance"><Banknote size={18} /></span>
            <div><h2>Движение средств</h2><p>Единая лента операций · банковские остатки подразделений не объединяются</p></div>
          </div>
          {!isLawyer && <Link href={`/${ADMIN_PATH}/warehouse?tab=bank`} className="dash-control-panel__all" prefetch={false}>Учёт СГТ <ArrowRight size={14} /></Link>}
        </div>
        <div className="dash-control-movement-summary">
          <div className="dash-control-movement-summary__unit dash-control-movement-summary__unit--sgt">
            <span className="dash-control-movement-summary__label">СибГофроТорг · {formatMonth(monthKey)}</span>
            <span><ArrowDownLeft size={14} /> Приход <strong className="dash-money-in">+{money(financeIncoming)}</strong></span>
            <span><ArrowUpRight size={14} /> Расход <strong className="dash-money-out">−{money(financeOutgoing)}</strong></span>
          </div>
          <div className="dash-control-movement-summary__unit dash-control-movement-summary__unit--wp">
            <span className="dash-control-movement-summary__label">Макулатура · {formatMonth(monthKey)}</span>
            <span><ArrowDownLeft size={14} /> Приход <strong className="dash-money-in">+{money(wpMonthIncoming)}</strong></span>
            <span><ArrowUpRight size={14} /> Расход <strong className="dash-money-out">−{money(wpMonthOutgoing)}</strong></span>
          </div>
        </div>
        <DashboardFinanceHistory rows={financeRows} adminPath={ADMIN_PATH} allowNavigation={!isLawyer} />
      </section>
    </main>
  );
}
