"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Banknote,
  Boxes,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Download,
  FileBarChart,
  PackageCheck,
  Printer,
  Search,
  Truck,
  UsersRound,
} from "lucide-react";
import {
  getDealPaidMap,
  getReceiptPaidMap,
  getCashCarryoverSummary,
  getCashCollectionIncomeBreakdown,
  isSalaryExcludedFromBalance,
  isRentSalaryComment,
  isDebtSalaryComment,
  stripSalaryMetaTags,
  type BankPayment,
  type CashCollection,
  type CustomerDeal,
  type Salary,
  type WarehouseReceipt,
  type WarehouseStockRow,
} from "@/lib/warehouse-shared";
import type { TransportRow } from "@/components/admin/TransportManager";
import { PaymentDetailsModal } from "@/components/admin/PaymentDetailsModal";
import { ProductSalesPopularity } from "@/components/admin/ProductSalesPopularity";

type ReportKind =
  | "payments"
  | "deals"
  | "receipts"
  | "transports"
  | "salaries"
  | "cash"
  | "product-sales"
  | "stock";
type SortDirection = "asc" | "desc";

/** Счёт движения денег: расчётный счёт / безнал на карту / наличка. */
type AccountFilter = "all" | "bank" | "transfer" | "cash";
type DirectionFilter = "all" | "incoming" | "outgoing";
type StatusFilter = "all" | "paid" | "pending";

type AppliedFilters = {
  kind: ReportKind;
  from: string;
  to: string;
  query: string;
  sort: SortDirection;
  account: AccountFilter;
  direction: DirectionFilter;
  status: StatusFilter;
};

interface WarehouseReportsProps {
  adminPath: string;
  payments: BankPayment[];
  salaries: Salary[];
  deals: CustomerDeal[];
  receipts: WarehouseReceipt[];
  transports: TransportRow[];
  cashCollections: CashCollection[];
  stock: WarehouseStockRow[];
}

const REPORTS: {
  kind: ReportKind;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    kind: "payments",
    label: "Движения денежных средств",
    description: "Платежи банка и кассы: приход, расход, контрагент и документы",
    icon: <CreditCard size={15} />,
  },
  {
    kind: "deals",
    label: "Заказы покупателей",
    description: "Суммы, оплаты, статусы, товары и доставка",
    icon: <ClipboardList size={15} />,
  },
  {
    kind: "receipts",
    label: "Поступления от поставщиков",
    description: "Поставщики, оплаты, товары и состояние поступления",
    icon: <PackageCheck size={15} />,
  },
  {
    kind: "transports",
    label: "Перевозки и доставки",
    description: "Маршруты, водители, заказы, адреса и количество",
    icon: <Truck size={15} />,
  },
  {
    kind: "salaries",
    label: "Зарплаты",
    description: "Планы и фактические выплаты сотрудникам",
    icon: <UsersRound size={15} />,
  },
  {
    kind: "cash",
    label: "Кассовые смены",
    description: "Наличные, поступления на ЮМ, расходы и фактический остаток смен",
    icon: <Banknote size={15} />,
  },
  {
    kind: "product-sales",
    label: "Популярность продаж",
    description: "Что отпускают чаще всего, выручка и прибыль по товарам",
    icon: <BarChart3 size={15} />,
  },
  {
    kind: "stock",
    label: "Остатки склада",
    description: "Текущий остаток, стоимость и порог пополнения",
    icon: <Boxes size={15} />,
  },
];

const fmt = (value: number) => value.toLocaleString("ru-RU");
const money = (value: number) => `${fmt(Math.round(value * 100) / 100)} ₽`;

function collectionItemKind(item: {
  amount?: number;
  kind?: "cash" | "card";
  cardAmount?: number;
}): { label: string; className: "cash" | "card" } {
  const amount = Math.max(0, Number(item.amount) || 0);
  const card = Math.max(
    0,
    Number(
      item.cardAmount != null
        ? item.cardAmount
        : item.kind === "card"
          ? amount
          : 0
    ) || 0
  );
  const hasCard = card > 0.009;
  const hasCash = amount - card > 0.009;
  return {
    label: hasCard && hasCash ? "Нал + ЮМ" : hasCard ? "Карта ЮМ" : "Наличные",
    className: hasCard && !hasCash ? "card" : "cash",
  };
}

function localIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStartIso(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("ru-RU");
}

/** Вид счёта платежа для фильтров и колонки «Счёт». */
function paymentAccountKey(payment: BankPayment): "cash" | "transfer" | "bank" {
  if (payment.type === "cash") return "cash";
  if (payment.type === "transfer") return "transfer";
  return "bank";
}

const ACCOUNT_LABEL: Record<"cash" | "transfer" | "bank", string> = {
  cash: "Наличка",
  transfer: "Безнал (на карту)",
  bank: "Расчётный счёт",
};

function salaryPeriod(salary: Salary): string {
  const key = salary.periodMonth || salary.date.slice(0, 7);
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
}

function inPeriod(date: string, filters: AppliedFilters): boolean {
  const value = String(date || "").slice(0, 10);
  if (filters.from && value < filters.from) return false;
  if (filters.to && value > filters.to) return false;
  return true;
}

function includesQuery(values: unknown[], query: string): boolean {
  if (!query) return true;
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .join(" ")
    .toLocaleLowerCase("ru-RU")
    .includes(query.toLocaleLowerCase("ru-RU"));
}

function sortByDate<T>(rows: T[], dateOf: (row: T) => string, sort: SortDirection): T[] {
  return [...rows].sort((a, b) =>
    sort === "asc"
      ? dateOf(a).localeCompare(dateOf(b))
      : dateOf(b).localeCompare(dateOf(a))
  );
}

function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const dealStatusLabel: Record<string, string> = {
  new: "Новый",
  completed: "Отпущен",
  cancelled: "Отменён",
};

const transportStatusLabel: Record<string, string> = {
  draft: "Черновик",
  active: "В пути / активна",
  completed: "Завершена",
  archived: "Архив",
};

const ACCOUNT_BADGE: Record<"cash" | "transfer" | "bank", string> = {
  cash: "admin-badge admin-badge--teal",
  transfer: "admin-badge admin-badge--indigo",
  bank: "admin-badge admin-badge--muted",
};

export function WarehouseReports({
  adminPath,
  payments,
  salaries,
  deals,
  receipts,
  transports,
  cashCollections,
  stock,
}: WarehouseReportsProps) {
  const today = localIso();
  const [kind, setKind] = useState<ReportKind>("payments");
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortDirection>("desc");
  // Гибкие отборы для отчёта по платежам: счёт, направление, статус.
  const [account, setAccount] = useState<AccountFilter>("all");
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [filters, setFilters] = useState<AppliedFilters>({
    kind: "payments",
    from: monthStartIso(),
    to: today,
    query: "",
    sort: "desc",
    account: "all",
    direction: "all",
    status: "all",
  });
  // SSR и первый клиентский рендер должны совпадать. Текущее локальное время
  // проставляем только после гидратации, иначе секунды на сервере/клиенте
  // расходятся и React пересобирает весь конструктор отчётов.
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [detailPaymentId, setDetailPaymentId] = useState<string | null>(null);
  useEffect(() => {
    setGeneratedAt(new Date().toLocaleString("ru-RU"));
  }, []);

  const dealPaidMap = useMemo(() => getDealPaidMap(payments), [payments]);
  const receiptPaidMap = useMemo(() => getReceiptPaidMap(payments), [payments]);

  function applyPreset(preset: "today" | "month" | "previous" | "quarter" | "year" | "all") {
    const current = new Date();
    if (preset === "today") {
      const value = localIso(current);
      setFrom(value);
      setTo(value);
      return;
    }
    if (preset === "month") {
      setFrom(monthStartIso(current));
      setTo(localIso(current));
      return;
    }
    if (preset === "previous") {
      const first = new Date(current.getFullYear(), current.getMonth() - 1, 1);
      const last = new Date(current.getFullYear(), current.getMonth(), 0);
      setFrom(localIso(first));
      setTo(localIso(last));
      return;
    }
    if (preset === "quarter") {
      const quarterMonth = Math.floor(current.getMonth() / 3) * 3;
      setFrom(localIso(new Date(current.getFullYear(), quarterMonth, 1)));
      setTo(localIso(current));
      return;
    }
    if (preset === "year") {
      setFrom(`${current.getFullYear()}-01-01`);
      setTo(localIso(current));
      return;
    }
    setFrom("");
    setTo("");
  }

  function generate() {
    let nextFrom = kind === "stock" ? "" : from;
    let nextTo = kind === "stock" ? "" : to;
    if (nextFrom && nextTo && nextFrom > nextTo) {
      [nextFrom, nextTo] = [nextTo, nextFrom];
      setFrom(nextFrom);
      setTo(nextTo);
    }
    setFilters({ kind, from: nextFrom, to: nextTo, query, sort, account, direction, status });
    setGeneratedAt(new Date().toLocaleString("ru-RU"));
  }

  const moneyRows = useMemo(() => {
    const bankRows = payments.map((payment) => {
      const accountKey = paymentAccountKey(payment);
      return {
        id: `payment-${payment.id}`,
        sourceId: payment.id,
        kind: "payment" as const,
        date: payment.paidAt || payment.date,
        counterparty: payment.counterparty,
        purpose:
          payment.direction === "incoming"
            ? payment.dealIds.length
              ? "Оплата заказа"
              : "Приход"
            : payment.receiptIds.length
              ? "Оплата поставки"
              : "Расход",
        direction: payment.direction,
        accountKey,
        account: ACCOUNT_LABEL[accountKey],
        amount: payment.amount,
        paid: payment.isPaid,
        status: payment.isPaid ? "Проведён" : "Ожидается",
        details: [
          payment.comment,
          ...payment.dealNumbers.map((number) => `ЗК-${number}`),
          ...payment.receiptNumbers.map((number) => `ПО-${number}`),
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/${adminPath}/warehouse?tab=bank&payment=${payment.id}`,
      };
    });
    const salaryRowsLocal = salaries.map((salary) => {
      const isRent = isRentSalaryComment(salary.comment, salary.source);
      const isYm = salary.source === "ym_card" || (salary.comment && salary.comment.includes("[Карта ЮМ]"));
      const accountLabel = isRent ? "Аренда (отд. счёт)" : isYm ? "Карта ЮМ" : salary.source === "cash" ? "Касса" : "Аренда (отд. счёт)";
      const accountKey = salary.source === "cash" ? ("cash" as const) : ("bank" as const);
      return {
        id: `salary-${salary.id}`,
        sourceId: salary.id,
        kind: "salary" as const,
        date: salary.paidAt || salary.date,
        counterparty: salary.employeeName,
        purpose: isRent
          ? "Аренда (отдельный счёт)"
          : isDebtSalaryComment(salary.comment)
          ? "Выплата в счёт долга"
          : "Зарплата",
        direction: "outgoing" as const,
        accountKey,
        account: accountLabel,
        amount: salary.amount,
        paid: salary.isPaid,
        status: salary.isPaid ? "Выплачена" : "Запланирована",
        details: [
          isDebtSalaryComment(salary.comment)
            ? "не входит в факт месяца"
            : `за ${salaryPeriod(salary)}`,
          stripSalaryMetaTags(salary.comment),
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/${adminPath}/warehouse?tab=salaries`,
      };
    });
    return sortByDate(
      [...bankRows, ...salaryRowsLocal].filter(
        (row) =>
          inPeriod(row.date, filters) &&
          // Гибкий отбор по всем выбранным параметрам одновременно:
          (filters.account === "all" || row.accountKey === filters.account) &&
          (filters.direction === "all" || row.direction === filters.direction) &&
          (filters.status === "all" ||
            (filters.status === "paid" ? row.paid : !row.paid)) &&
          includesQuery(
            [row.counterparty, row.purpose, row.account, row.status, row.details],
            filters.query
          )
      ),
      (row) => row.date,
      filters.sort
    );
  }, [adminPath, filters, payments, salaries]);

  const dealRows = useMemo(
    () =>
      sortByDate(
        deals.filter(
          (deal) =>
            inPeriod(deal.date, filters) &&
            includesQuery(
              [
                deal.customerName,
                deal.number,
                dealStatusLabel[deal.status],
                deal.deliveryAddress,
                deal.items.map((item) => item.name),
              ],
              filters.query
            )
        ),
        (deal) => deal.date,
        filters.sort
      ),
    [deals, filters]
  );

  const receiptRows = useMemo(
    () =>
      sortByDate(
        receipts.filter(
          (receipt) =>
            inPeriod(receipt.date, filters) &&
            includesQuery(
              [
                receipt.supplier,
                receipt.number,
                receipt.status,
                receipt.items.map((item) => item.name),
              ],
              filters.query
            )
        ),
        (receipt) => receipt.date,
        filters.sort
      ),
    [filters, receipts]
  );

  const transportRows = useMemo(
    () =>
      sortByDate(
        transports.filter((transport) => {
          const date = transport.plannedDate || transport.date;
          return (
            inPeriod(date, filters) &&
            includesQuery(
              [
                transport.number,
                transport.driverName,
                transportStatusLabel[transport.status],
                transport.items.map((item) => [
                  item.customerName,
                  item.address,
                  item.dealNumber,
                ]),
              ],
              filters.query
            )
          );
        }),
        (transport) => transport.plannedDate || transport.date,
        filters.sort
      ),
    [filters, transports]
  );

  const salaryRows = useMemo(
    () =>
      sortByDate(
        salaries.filter(
          (salary) =>
            inPeriod(salary.paidAt || salary.date, filters) &&
            includesQuery(
              [
                salary.employeeName,
                salaryPeriod(salary),
                salary.source,
                stripSalaryMetaTags(salary.comment),
              ],
              filters.query
            )
        ),
        (salary) => salary.paidAt || salary.date,
        filters.sort
      ),
    [filters, salaries]
  );

  const cashRows = useMemo(
    () =>
      sortByDate(
        cashCollections.filter(
          (collection) =>
            inPeriod(collection.date, filters) &&
            includesQuery(
              [
                collection.note,
                collection.items?.map((item) => item.counterparty),
                collection.expenses?.map((expense) => expense.title),
              ],
              filters.query
            )
        ),
        (collection) => collection.date,
        filters.sort
      ),
    [cashCollections, filters]
  );

  // Остаток на начало каждой смены — это перенос наличности с прошлых дней.
  // Показываем его отдельно, чтобы итог «в кассе» не выглядел как приход
  // только от платежей текущей смены.
  const cashOpeningByCollectionId = useMemo(() => {
    const opening = new Map<string, number>();
    for (const collection of cashCollections) {
      const date = String(collection.date || "").slice(0, 10);
      if (!date) continue;
      opening.set(
        collection.id,
        getCashCarryoverSummary(payments, salaries, cashCollections, date).openingBalance
      );
    }
    return opening;
  }, [cashCollections, payments, salaries]);

  const stockRows = useMemo(
    () =>
      [...stock]
        .filter((product) =>
          includesQuery([product.name, product.sku], filters.query)
        )
        .sort((a, b) =>
          filters.sort === "asc"
            ? a.name.localeCompare(b.name, "ru")
            : b.name.localeCompare(a.name, "ru")
        ),
    [filters.query, filters.sort, stock]
  );

  const activeMeta = REPORTS.find((report) => report.kind === filters.kind)!;

  const csvRows = useMemo<unknown[][]>(() => {
    if (filters.kind === "payments") {
      return [
        ["Дата", "Контрагент", "Назначение", "Счёт", "Приход/расход", "Сумма", "Статус", "Расшифровка"],
        ...moneyRows.map((row) => [row.date, row.counterparty, row.purpose, row.account, row.direction === "incoming" ? "Приход" : "Расход", row.amount, row.status, row.details]),
      ];
    }
    if (filters.kind === "deals") {
      return [
        ["Дата", "Заказ", "Покупатель", "Статус", "Сумма", "Оплачено", "Доставка", "Товары"],
        ...dealRows.map((deal) => [deal.date, `ЗК-${deal.number}`, deal.customerName, dealStatusLabel[deal.status], deal.total, dealPaidMap.get(deal.id) || 0, deal.deliveryAddress || "", deal.items.map((item) => `${item.name} × ${item.quantity}`).join("; ")]),
      ];
    }
    if (filters.kind === "receipts") {
      return [
        ["Дата", "Поступление", "Поставщик", "Статус", "Сумма", "Оплачено", "Товары"],
        ...receiptRows.map((receipt) => [receipt.date, `ПО-${receipt.number}`, receipt.supplier, receipt.status === "posted" ? "Проведено" : "Активное", receipt.total, receiptPaidMap.get(receipt.id) || 0, receipt.items.map((item) => `${item.name} × ${item.quantity}`).join("; ")]),
      ];
    }
    if (filters.kind === "transports") {
      return [
        ["Дата", "Перевозка", "Статус", "Водитель", "Заказов", "Количество", "Адреса"],
        ...transportRows.map((transport) => [transport.plannedDate || transport.date, `ПР-${transport.number}`, transportStatusLabel[transport.status], transport.driverName || "", transport.items.length, transport.totalItems, transport.items.map((item) => `ЗК-${item.dealNumber}: ${item.address || "без адреса"}`).join("; ")]),
      ];
    }
    if (filters.kind === "salaries") {
      return [
        ["Дата", "Сотрудник", "За месяц", "Счёт", "Сумма", "Статус", "Комментарий"],
        ...salaryRows.map((salary) => [salary.paidAt || salary.date, salary.employeeName, isDebtSalaryComment(salary.comment) ? "В счёт отдельного долга" : salaryPeriod(salary), salary.source === "cash" ? "Наличка" : "Расчётный счёт", salary.amount, salary.isPaid ? "Выплачено" : "Запланировано", stripSalaryMetaTags(salary.comment)]),
      ];
    }
    if (filters.kind === "cash") {
      return [
        ["Дата", "Перенос с прошлого дня (не прибыль)", "Всего поступило", "Наличными", "На карту ЮМ", "Расходы наличными", "Остаток кассы", "Комментарий"],
        ...cashRows.map((collection) => {
          const income = getCashCollectionIncomeBreakdown(collection);
          return [
            collection.date,
            cashOpeningByCollectionId.get(collection.id) || 0,
            income.total,
            income.cash,
            income.card,
            collection.expensesAmount || 0,
            collection.cashAmount || 0,
            collection.note || "",
          ];
        }),
      ];
    }
    return [
      ["Товар", "Артикул", "Остаток", "Порог", "Цена", "Стоимость", "Видимость"],
      ...stockRows.map((product) => [product.name, product.sku || "", product.stockQty, product.stockWarnQty ?? "", product.price ?? "", product.stockQty * (product.price || 0), product.isVisible ? "Виден" : "Скрыт"]),
    ];
  }, [cashOpeningByCollectionId, cashRows, dealPaidMap, dealRows, filters.kind, moneyRows, receiptPaidMap, receiptRows, salaryRows, stockRows, transportRows]);

  function exportReport() {
    const safeName = activeMeta.label.replace(/\s+/g, "_");
    downloadCsv(`Отчет_${safeName}_${filters.from || "весь-период"}_${filters.to || ""}.csv`, csvRows);
  }

  const periodText = filters.from || filters.to
    ? `${filters.from ? fmtDate(filters.from) : "начало учёта"} — ${filters.to ? fmtDate(filters.to) : "сегодня"}`
    : "за весь период";

  const moneyIn = moneyRows
    .filter((row) => row.direction === "incoming")
    .reduce((sum, row) => sum + row.amount, 0);
  const moneyOut = moneyRows
    .filter((row) => row.direction === "outgoing")
    .reduce((sum, row) => sum + row.amount, 0);
  const dealTotal = dealRows.reduce((sum, deal) => sum + deal.total, 0);
  const dealPaid = dealRows.reduce((sum, deal) => sum + (dealPaidMap.get(deal.id) || 0), 0);
  const receiptTotal = receiptRows.reduce((sum, receipt) => sum + receipt.total, 0);
  const receiptPaid = receiptRows.reduce((sum, receipt) => sum + (receiptPaidMap.get(receipt.id) || 0), 0);

  return (
    <div className="wh-report-page">
      <PaymentDetailsModal
        paymentId={detailPaymentId}
        adminPath={adminPath}
        onClose={() => setDetailPaymentId(null)}
      />
      <div className="wh-report-head">
        <div>
          <span>Управленческий учёт</span>
          <h2><FileBarChart size={20} /> Отчёты</h2>
          <p>Формирование подробных отчётов по документам и движениям — с расшифровкой до исходной записи.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href={`/${adminPath}/products/box-report`}
            className="admin-btn admin-btn--ghost"
            style={{ background: 'rgba(59,130,246,0.08)', color: 'var(--adm-primary)', borderColor: 'rgba(59,130,246,0.3)' }}
            prefetch={false}
          >
            Отчёт по коробкам (печать размеров Д×Ш×В)
          </Link>
          <div className="wh-report-head__stamp">
            Сформировано {generatedAt || "—"}
          </div>
        </div>
      </div>

      <div className="wh-report-constructor">
        <div className="wh-report-types">
          {REPORTS.map((report) => (
            <button
              key={report.kind}
              type="button"
              className={kind === report.kind ? "wh-report-type wh-report-type--active" : "wh-report-type"}
              onClick={() => setKind(report.kind)}
            >
              {report.icon}
              <span><strong>{report.label}</strong><small>{report.description}</small></span>
            </button>
          ))}
        </div>

        <div className="wh-report-settings">
          <div className="wh-report-period-presets">
            <span><CalendarDays size={13} /> Период:</span>
            <button type="button" onClick={() => applyPreset("today")}>Сегодня</button>
            <button type="button" onClick={() => applyPreset("month")}>Этот месяц</button>
            <button type="button" onClick={() => applyPreset("previous")}>Прошлый месяц</button>
            <button type="button" onClick={() => applyPreset("quarter")}>Квартал</button>
            <button type="button" onClick={() => applyPreset("year")}>Год</button>
            <button type="button" onClick={() => applyPreset("all")}>Весь период</button>
          </div>
          <div className="wh-report-fields">
            <label>
              <span>Дата от</span>
              <input className="admin-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} disabled={kind === "stock"} />
            </label>
            <label>
              <span>Дата до</span>
              <input className="admin-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} disabled={kind === "stock"} />
            </label>
            <label className="wh-report-search">
              <span>Отбор / поиск</span>
              <div><Search size={14} /><input className="admin-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Контрагент, номер, товар, адрес…" /></div>
            </label>
            <label>
              <span>Сортировка</span>
              <select className="admin-select" value={sort} onChange={(event) => setSort(event.target.value as SortDirection)}>
                <option value="desc">Сначала новые</option>
                <option value="asc">Сначала старые</option>
              </select>
            </label>
            {/* Гибкие отборы платежей: действуют вместе с периодом,
                поиском и сортировкой — все выбранные параметры применяются разом. */}
            {kind === "payments" && (
              <>
                <label>
                  <span>Счёт</span>
                  <select className="admin-select" value={account} onChange={(event) => setAccount(event.target.value as AccountFilter)}>
                    <option value="all">Все (нал + безнал)</option>
                    <option value="bank">Расчётный счёт</option>
                    <option value="transfer">Безнал (на карту)</option>
                    <option value="cash">Наличка</option>
                  </select>
                </label>
                <label>
                  <span>Направление</span>
                  <select className="admin-select" value={direction} onChange={(event) => setDirection(event.target.value as DirectionFilter)}>
                    <option value="all">Приход и расход</option>
                    <option value="incoming">Только приход</option>
                    <option value="outgoing">Только расход</option>
                  </select>
                </label>
                <label>
                  <span>Статус</span>
                  <select className="admin-select" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
                    <option value="all">Все статусы</option>
                    <option value="paid">Проведённые</option>
                    <option value="pending">Ожидаемые</option>
                  </select>
                </label>
              </>
            )}
          </div>
          <div className="wh-report-actions">
            <button type="button" className="admin-btn admin-btn--primary" onClick={generate}>
              <FileBarChart size={14} /> Сформировать
            </button>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={exportReport}>
              <Download size={14} /> CSV для Excel
            </button>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => window.print()}>
              <Printer size={14} /> Печать
            </button>
          </div>
        </div>
      </div>

      <section className="wh-report-result">
        <div className="wh-report-result__head">
          <div>
            <span>{activeMeta.label}</span>
            <strong>{periodText}</strong>
          </div>
          <small>Нажмите номер документа, чтобы открыть расшифровку</small>
        </div>

        {filters.kind === "payments" && (
          <>
            <div className="wh-report-summary">
              <div><ArrowDownLeft size={15} /><span>Приход</span><strong className="wh-report-in">+{money(moneyIn)}</strong></div>
              <div><ArrowUpRight size={15} /><span>Расход</span><strong className="wh-report-out">−{money(moneyOut)}</strong></div>
              <div><CreditCard size={15} /><span>Сальдо периода</span><strong>{money(moneyIn - moneyOut)}</strong></div>
              <div><ClipboardList size={15} /><span>Операций</span><strong>{moneyRows.length}</strong></div>
            </div>
            <ReportTable headers={["Дата", "Контрагент", "Назначение", "Счёт", "Статус", "Подробности", "Сумма"]} empty={moneyRows.length === 0}>
              {moneyRows.map((row) => (
                <tr
                  key={row.id}
                  className={row.kind === "payment" ? "payment-clickable" : undefined}
                  onClick={(event) => {
                    if (row.kind !== "payment") return;
                    if ((event.target as HTMLElement).closest("a,button")) return;
                    setDetailPaymentId(row.sourceId);
                  }}
                >
                  <td>{fmtDate(row.date)}</td>
                  <td><strong>{row.counterparty || "—"}</strong></td>
                  <td>{row.purpose}</td>
                  <td><span className={ACCOUNT_BADGE[row.accountKey]}>{row.account}</span></td>
                  <td>{row.status}</td>
                  <td>
                    {row.kind === "payment" ? (
                      <button
                        type="button"
                        className="wh-report-payment-open"
                        onClick={() => setDetailPaymentId(row.sourceId)}
                      >
                        {row.details || "Открыть платёж"} →
                      </button>
                    ) : (
                      <Link href={row.href} prefetch={false}>{row.details || "Открыть операцию"} →</Link>
                    )}
                  </td>
                  <td className={row.direction === "incoming" ? "wh-report-in" : "wh-report-out"}>{row.direction === "incoming" ? "+" : "−"}{money(row.amount)}</td>
                </tr>
              ))}
            </ReportTable>
          </>
        )}

        {filters.kind === "deals" && (
          <>
            <div className="wh-report-summary">
              <div><ClipboardList size={15} /><span>Заказов</span><strong>{dealRows.length}</strong></div>
              <div><CreditCard size={15} /><span>На сумму</span><strong>{money(dealTotal)}</strong></div>
              <div><Banknote size={15} /><span>Оплачено</span><strong className="wh-report-in">{money(dealPaid)}</strong></div>
              <div><ArrowUpRight size={15} /><span>Долг покупателей</span><strong className="wh-report-out">{money(Math.max(0, dealTotal - dealPaid))}</strong></div>
            </div>
            <ReportTable headers={["Дата", "Заказ", "Покупатель", "Статус", "Товары", "Доставка", "Оплачено", "Сумма"]} empty={dealRows.length === 0}>
              {dealRows.map((deal) => {
                const paid = dealPaidMap.get(deal.id) || 0;
                return (
                  <tr key={deal.id}>
                    <td>{fmtDate(deal.date)}</td>
                    <td><Link href={`/${adminPath}/warehouse?tab=deals&deal=${deal.id}`} prefetch={false}>ЗК-{deal.number} →</Link></td>
                    <td><strong>{deal.customerName}</strong></td>
                    <td>{dealStatusLabel[deal.status]}</td>
                    <td>{deal.items.map((item) => `${item.name} × ${item.quantity}`).join("; ")}</td>
                    <td>{deal.hasDelivery ? deal.deliveryAddress || "Да, без адреса" : "Нет"}</td>
                    <td className={paid + .009 >= deal.total ? "wh-report-in" : "wh-report-out"}>{money(paid)}</td>
                    <td>{money(deal.total)}</td>
                  </tr>
                );
              })}
            </ReportTable>
          </>
        )}

        {filters.kind === "receipts" && (
          <>
            <div className="wh-report-summary">
              <div><PackageCheck size={15} /><span>Поступлений</span><strong>{receiptRows.length}</strong></div>
              <div><CreditCard size={15} /><span>На сумму</span><strong>{money(receiptTotal)}</strong></div>
              <div><Banknote size={15} /><span>Оплачено</span><strong className="wh-report-in">{money(receiptPaid)}</strong></div>
              <div><ArrowUpRight size={15} /><span>Долг поставщикам</span><strong className="wh-report-out">{money(Math.max(0, receiptTotal - receiptPaid))}</strong></div>
            </div>
            <ReportTable headers={["Дата", "Поступление", "Поставщик", "Статус", "Товары", "Оплачено", "Сумма"]} empty={receiptRows.length === 0}>
              {receiptRows.map((receipt) => {
                const paid = receiptPaidMap.get(receipt.id) || 0;
                return (
                  <tr key={receipt.id}>
                    <td>{fmtDate(receipt.date)}</td>
                    <td><Link href={`/${adminPath}/warehouse?tab=receipts&receipt=${receipt.id}`} prefetch={false}>ПО-{receipt.number} →</Link></td>
                    <td><strong>{receipt.supplier}</strong></td>
                    <td>{receipt.status === "posted" ? "Проведено / архив" : "Активное"}</td>
                    <td>{receipt.items.map((item) => `${item.name} × ${item.quantity}`).join("; ")}</td>
                    <td className={paid + .009 >= receipt.total ? "wh-report-in" : "wh-report-out"}>{money(paid)}</td>
                    <td>{money(receipt.total)}</td>
                  </tr>
                );
              })}
            </ReportTable>
          </>
        )}

        {filters.kind === "transports" && (
          <>
            <div className="wh-report-summary">
              <div><Truck size={15} /><span>Перевозок</span><strong>{transportRows.length}</strong></div>
              <div><ClipboardList size={15} /><span>Заказов</span><strong>{transportRows.reduce((sum, row) => sum + row.items.length, 0)}</strong></div>
              <div><Boxes size={15} /><span>Единиц товара</span><strong>{fmt(transportRows.reduce((sum, row) => sum + row.totalItems, 0))}</strong></div>
              <div><PackageCheck size={15} /><span>Завершено</span><strong>{transportRows.filter((row) => row.status === "completed" || row.status === "archived").length}</strong></div>
            </div>
            <ReportTable headers={["Дата", "Перевозка", "Статус", "Водитель", "Заказы и клиенты", "Адреса", "Количество"]} empty={transportRows.length === 0}>
              {transportRows.map((transport) => (
                <tr key={transport.id}>
                  <td>{fmtDate(transport.plannedDate || transport.date)}</td>
                  <td><Link href={`/${adminPath}/warehouse?tab=deliveries&transport=${transport.id}`} prefetch={false}>ПР-{transport.number} →</Link></td>
                  <td>{transportStatusLabel[transport.status]}</td>
                  <td>{transport.driverName || "Не назначен"}</td>
                  <td>{transport.items.map((item) => `ЗК-${item.dealNumber} · ${item.customerName}`).join("; ")}</td>
                  <td>{transport.items.map((item) => item.address || "Без адреса").join("; ")}</td>
                  <td>{fmt(transport.totalItems)} ед.</td>
                </tr>
              ))}
            </ReportTable>
          </>
        )}

        {filters.kind === "salaries" && (
          <>
            <div className="wh-report-summary">
              <div><UsersRound size={15} /><span>Записей</span><strong>{salaryRows.length}</strong></div>
              <div><Banknote size={15} /><span>Факт зарплаты</span><strong className="wh-report-in">{money(salaryRows.filter((row) => row.isPaid && !isDebtSalaryComment(row.comment)).reduce((sum, row) => sum + row.amount, 0))}</strong></div>
              <div><CreditCard size={15} /><span>В счёт долга</span><strong>{money(salaryRows.filter((row) => row.isPaid && isDebtSalaryComment(row.comment)).reduce((sum, row) => sum + row.amount, 0))}</strong></div>
              <div><CalendarDays size={15} /><span>Запланировано</span><strong>{money(salaryRows.filter((row) => !row.isPaid).reduce((sum, row) => sum + row.amount, 0))}</strong></div>
            </div>
            <ReportTable headers={["Дата", "Сотрудник", "Зарплата за", "Счёт", "Статус", "Комментарий", "Сумма"]} empty={salaryRows.length === 0}>
              {salaryRows.map((salary) => (
                <tr key={salary.id}>
                  <td>{fmtDate(salary.paidAt || salary.date)}</td>
                  <td><Link href={`/${adminPath}/warehouse?tab=salaries`} prefetch={false}>{salary.employeeName} →</Link></td>
                  <td>{isDebtSalaryComment(salary.comment) ? "В счёт отдельного долга" : salaryPeriod(salary)}</td>
                  <td>{salary.source === "cash" ? "Наличка" : "Расчётный счёт"}</td>
                  <td>{salary.isPaid ? "Выплачено" : "Запланировано"}{isDebtSalaryComment(salary.comment) ? " · не входит в факт месяца" : ""}{isSalaryExcludedFromBalance(salary.comment) ? " · вне баланса" : ""}</td>
                  <td>{stripSalaryMetaTags(salary.comment) || "—"}</td>
                  <td>{money(salary.amount)}</td>
                </tr>
              ))}
            </ReportTable>
          </>
        )}

        {filters.kind === "cash" && (
          <>
            <div className="wh-report-summary">
              <div><ClipboardList size={15} /><span>Смен</span><strong>{cashRows.length}</strong></div>
              <div><ArrowDownLeft size={15} /><span>Всего поступило</span><strong>{money(cashRows.reduce((sum, row) => sum + getCashCollectionIncomeBreakdown(row).total, 0))}</strong></div>
              <div><CreditCard size={15} /><span>На карту ЮМ</span><strong>{money(cashRows.reduce((sum, row) => sum + getCashCollectionIncomeBreakdown(row).card, 0))}</strong></div>
              <div><ArrowUpRight size={15} /><span>Расходы наличными</span><strong>{money(cashRows.reduce((sum, row) => sum + (row.expensesAmount || 0), 0))}</strong></div>
              <div><Banknote size={15} /><span>Последний остаток</span><strong>{money(cashRows[0]?.cashAmount || 0)}</strong></div>
            </div>
            <ReportTable headers={["Дата", "Платежи", "Расшифровка", "Перенос (не прибыль)", "Поступления за день", "Расходы наличными", "Остаток кассы", "Комментарий"]} empty={cashRows.length === 0}>
              {cashRows.map((collection) => (
                <tr key={collection.id}>
                  <td>{fmtDate(collection.date)}</td>
                  <td><Link href={`/${adminPath}/warehouse?tab=bank`} prefetch={false}>{collection.items?.length || 0} платежей →</Link></td>
                  <td>
                    {(collection.items || []).length > 0 ? (
                      <div className="wh-report-payment-links">
                        {(collection.items || []).map((item) => {
                          const kind = collectionItemKind(item);
                          const content = (
                            <>
                              <span>
                                ПЛ-{item.number || "—"} · {item.counterparty || ""} · {money(item.amount)}
                              </span>
                              <em className={`cashc-kind cashc-kind--${kind.className}`}>
                                {kind.label}
                              </em>
                            </>
                          );
                          // Технические строки manual:* — не платёж,
                          // карточки у них нет; показываем как текст.
                          return String(item.paymentId || "").startsWith("manual:") ? (
                            <span key={item.paymentId} className="wh-report-payment-open">
                              {content}
                            </span>
                          ) : (
                            <button
                              key={item.paymentId}
                              type="button"
                              className="wh-report-payment-open"
                              onClick={() => setDetailPaymentId(item.paymentId)}
                            >
                              {content}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      "Старая запись без расшифровки"
                    )}
                  </td>
                  <td>+{money(cashOpeningByCollectionId.get(collection.id) || 0)} <small className="admin-muted">не прибыль</small></td>
                  <td style={{ color: "var(--adm-pine)" }}>
                    {(() => {
                      const income = getCashCollectionIncomeBreakdown(collection);
                      return (
                        <>
                          +{money(income.total)}
                          <small className="admin-muted" style={{ display: "block" }}>
                            нал {money(income.cash)} · ЮМ {money(income.card)}
                          </small>
                        </>
                      );
                    })()}
                  </td>
                  <td style={{ color: "var(--adm-rust)" }}>−{money(collection.expensesAmount || 0)}</td>
                  <td><strong>{money(collection.cashAmount || 0)}</strong></td>
                  <td>{collection.note || "—"}</td>
                </tr>
              ))}
            </ReportTable>
          </>
        )}

        {filters.kind === "product-sales" && (
          <ProductSalesPopularity deals={deals} receipts={receipts} stock={stock} from={filters.from} to={filters.to} />
        )}

        {filters.kind === "stock" && (
          <>
            <div className="wh-report-summary">
              <div><Boxes size={15} /><span>Позиций</span><strong>{stockRows.length}</strong></div>
              <div><PackageCheck size={15} /><span>Единиц</span><strong>{fmt(stockRows.reduce((sum, row) => sum + row.stockQty, 0))}</strong></div>
              <div><CreditCard size={15} /><span>Стоимость</span><strong>{money(stockRows.reduce((sum, row) => sum + row.stockQty * (row.price || 0), 0))}</strong></div>
              <div><ArrowUpRight size={15} /><span>Нужно пополнить</span><strong>{stockRows.filter((row) => row.stockQty <= (row.stockWarnQty ?? 10)).length}</strong></div>
            </div>
            <ReportTable headers={["Товар", "Артикул", "Остаток", "Порог", "Цена", "Стоимость", "Статус"]} empty={stockRows.length === 0}>
              {stockRows.map((product) => (
                <tr key={product.id}>
                  <td><Link href={`/${adminPath}/warehouse?tab=stock&product=${product.id}`} prefetch={false}>{product.name} →</Link></td>
                  <td>{product.sku || "—"}</td>
                  <td className={product.stockQty <= 0 ? "wh-report-out" : ""}>{fmt(product.stockQty)} шт.</td>
                  <td>{product.stockWarnQty ?? 10} шт.</td>
                  <td>{product.price != null ? money(product.price) : "—"}</td>
                  <td>{money(product.stockQty * (product.price || 0))}</td>
                  <td>{product.stockQty <= 0 ? "Нет в наличии" : product.stockQty <= (product.stockWarnQty ?? 10) ? "Пополнить" : "В норме"}</td>
                </tr>
              ))}
            </ReportTable>
          </>
        )}
      </section>
    </div>
  );
}

function ReportTable({
  headers,
  empty,
  children,
}: {
  headers: string[];
  empty: boolean;
  children: React.ReactNode;
}) {
  if (empty) {
    return <div className="wh-report-empty">По выбранным условиям данных нет</div>;
  }
  return (
    <div className="admin-table-wrap wh-report-table-wrap">
      <table className="admin-table wh-report-table">
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
