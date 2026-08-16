"use client";

import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Truck,
  ClipboardList,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  AlertTriangle,
  PackageCheck,
  UsersRound,
  X,
  Search,
  Banknote,
  CreditCard,
  History,
  Archive,
  Loader2,
  Save,
  Gift,
  Trash2,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  BarChart3,
  Lock,
  LockOpen,
  Calculator,
  Scissors,
  Package,
  Lightbulb,
} from "lucide-react";
import {
  type BankPayment,
  type CounterpartyBalance,
  getBankSummary,
  getPendingPaymentCounterpartyBalances,
  normalizeName,
  getDealPaidMap,
  getReceiptPaidMap,
  getCashCarryoverSummary,
  getCashCollectionIncomeBreakdown,
  getCashCollectionExpenseBreakdown,
  type WarehouseStockRow,
  type ProductStockSummary,
  type WarehouseReceipt,
  type CustomerDeal,
  type Counterparty,
  type Employee,
  type Salary,
  type CashCollection,
  includedVat,
  isSalaryExcludedFromBalance,
  isDebtSalaryComment,
  isYmCardSalaryComment,
  stripSalaryMetaTags,
  getWarehouseBusinessDate,
  type ConsignmentManualSale,
} from "@/lib/warehouse-shared";
import { ReceiptForm, ReceiptCard } from "@/components/admin/WarehouseReceipts";
import { DealForm, DealActions } from "@/components/admin/WarehouseDeals";
import {
  PaymentForm,
  PaymentControls,
  type DealLinkOption,
  type ReceiptLinkOption,
} from "@/components/admin/WarehousePayments";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import { StockQtyEditor } from "@/components/admin/WarehouseStockEditor";
import { StockPriceEditor } from "@/components/admin/StockPriceEditor";
import { ProductStockSummaryPanel } from "@/components/admin/WarehouseStockSummary";
import { PaymentDetailsModal } from "@/components/admin/PaymentDetailsModal";
import { StockRevision } from "@/components/admin/StockRevision";
import { CashCollectModal } from "@/components/admin/CashCollectModal";
import { ModalPortal } from "@/components/admin/ModalPortal";
import {
  CounterpartiesManager,
  type CounterpartyDocument,
  type CounterpartyOption,
} from "@/components/admin/WarehouseCounterparties";
import { WarehouseSalaries } from "@/components/admin/WarehouseSalaries";
import { SalaryAutoDistribute } from "@/components/admin/SalaryAutoDistribute";
import { WarehouseReports } from "@/components/admin/WarehouseReports";
import { ClientsManager } from "@/components/admin/ClientsManager";
import { ConsignmentTracker } from "@/components/admin/ConsignmentTracker";
import { TransportManager, type TransportDeal, type TransportRow, type DriverOption } from "@/components/admin/TransportManager";
import { SupplyPlanning } from "@/components/admin/SupplyPlanning";
import { PurchasePlanning } from "@/components/admin/PurchasePlanning";
import type { SupplyPlan } from "@/lib/supply-plans-shared";
import type { PurchasePlan } from "@/lib/purchase-plans-shared";

const fmt = (n: number) => n.toLocaleString("ru-RU");

/** Ключ контрагента в «Должны нам / Мы должны» (тип + нормализованное имя). */
function partyKey(type: "customer" | "supplier", name: string): string {
  return `${type}:${normalizeName(name)}`;
}

/** Ключ контрагента платежа — та же логика, что в расчёте долгов. */
function paymentPartyKey(p: BankPayment): string | null {
  if (!p.counterparty) return null;
  let type: "customer" | "supplier";
  if (p.dealIds && p.dealIds.length > 0) type = "customer";
  else if (p.receiptIds && p.receiptIds.length > 0) type = "supplier";
  else type = p.direction === "outgoing" ? "supplier" : "customer";
  return partyKey(type, p.counterparty);
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtDateTime(raw: string | null | undefined): string {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return fmtDate(raw);
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function requestProductStockSummary(
  productId: string
): Promise<ProductStockSummary> {
  const response = await fetch(
    `/api/admin/warehouse/stock/${encodeURIComponent(productId)}`,
    { cache: "no-store" }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Не удалось загрузить сводку товара");
  }
  return body as ProductStockSummary;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  const s = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function localDateIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarMonthRange(offset = 0): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: localDateIso(first), to: localDateIso(last) };
}

const dealStatusBadge: Record<string, string> = {
  new: "admin-badge admin-badge--amber",
  completed: "admin-badge admin-badge--green",
  cancelled: "admin-badge admin-badge--red",
};

const dealStatusLabel: Record<string, string> = {
  new: "Новый",
  completed: "Отпущен",
  cancelled: "Отменён",
};

const paymentTypeLabels: Record<string, string> = {
  regular: "Оплата",
  refund: "Возврат",
  cash: "Наличные",
  transfer: "Перевод",
  deposit: "Внесение",
  ym_card: "Карта ЮМ",
};

type TabKey = "stock" | "receipts" | "plans" | "purchases" | "deals" | "bank" | "salaries" | "counterparties" | "clients" | "deliveries" | "reports";
type StockSub = "stock" | "receipts" | "archive";
type SuppliesSub = "receipts" | "suppliers" | "consignment";
type ReceiptSub = "active" | "archive";
type DealsSub = "new" | "released";
type BankSub = "summary" | "pending" | "history" | "cash" | "ym";
type BankEntry =
  | (BankPayment & { entryKind: "payment" })
  | {
      entryKind: "salary";
      id: string;
      number: number;
      date: string;
      direction: "outgoing";
      counterparty: string;
      amount: number;
      isPaid: boolean;
      source: "cash" | "bank" | "ym_card";
      comment?: string | null;
      excludeFromBalance?: boolean;
      createdAt?: string | null;
      salary: Salary;
    };

interface WarehouseManagerProps {
  adminPath: string;
  initialTab: TabKey;
  initialSub: StockSub;
  focusDealId?: string | null;
  focusReceiptId?: string | null;
  focusProductId?: string | null;
  focusPaymentId?: string | null;
  focusTransportId?: string | null;
  stock: WarehouseStockRow[];
  receipts: WarehouseReceipt[];
  deals: CustomerDeal[];
  payments: BankPayment[];
  employees: Employee[];
  salaries: Salary[];
  counterpartyRows: Counterparty[];
  pickerProducts: PickerProduct[];
  counterpartyOptions: CounterpartyOption[];
  counterpartyDocuments: Record<string, CounterpartyDocument[]>;
  clients?: any[];
  deliveryPrice?: number;
  freeDeliveryThreshold?: number;
  transports?: TransportRow[];
  pendingDeals?: TransportDeal[];
  drivers?: DriverOption[];
  cashCollections?: CashCollection[];
  consignmentManual?: ConsignmentManualSale[];
  supplyPlans?: SupplyPlan[];
  purchasePlans?: PurchasePlan[];
  initialPlanProductId?: string | null;
  companyPhone?: string;
  companyAddress?: string;
  /** Скидки ценовых уровней контрагентов (из настроек админки). */
  tierDiscounts?: { special: number; exclusive: number };
}

export function WarehouseManager({
  adminPath,
  initialTab,
  initialSub,
  focusDealId,
  focusReceiptId,
  focusProductId,
  focusPaymentId,
  focusTransportId,
  stock,
  receipts,
  deals,
  payments,
  employees,
  salaries,
  counterpartyRows,
  pickerProducts,
  counterpartyOptions,
  counterpartyDocuments,
  clients = [],
  deliveryPrice = 800,
  freeDeliveryThreshold = 30000,
  transports = [],
  pendingDeals = [],
  drivers = [],
  cashCollections = [],
  consignmentManual = [],
  supplyPlans = [],
  purchasePlans = [],
  initialPlanProductId,
  companyPhone,
  companyAddress,
  tierDiscounts = { special: 5, exclusive: 10 },
}: WarehouseManagerProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [stockSub, setStockSub] = useState<string>(initialSub);

  // При переходе через query-параметр Next сохраняет экземпляр клиента.
  // Синхронизируем вкладку с новыми серверными props, иначе URL менялся,
  // а на экране оставалась предыдущая секция.
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);
  
  // --- States for Financial Summary (Feature 1) ---
  const [financePeriod, setFinancePeriod] = useState<"today" | "week" | "month">("today");
  const [financeNotes, setFinanceNotes] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setFinanceNotes(localStorage.getItem("sgt_finance_notes") || "");
    }
  }, []);

  // --- States for Critical Stock Alerts (Feature 2) ---
  const [attentionCategory, setAttentionCategory] = useState<"outofstock" | "lowstock" | "popular" | "stagnant">("outofstock");
  const [suppliesSub, setSuppliesSub] = useState<SuppliesSub>("receipts");
  const [receiptSub, setReceiptSub] = useState<ReceiptSub>("active");
  const [dealsSub, setDealsSub] = useState<DealsSub>("new");
  const [expandedDealId, setExpandedDealId] = useState<string | null>(focusDealId ?? null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Раскрытые расширенные сводки в таблице склада. */
  const [expandedStockIds, setExpandedStockIds] = useState<Set<string>>(
    () => new Set(focusProductId ? [focusProductId] : [])
  );
  const [stockSummaries, setStockSummaries] = useState<Record<string, ProductStockSummary>>({});
  const [stockSummaryLoading, setStockSummaryLoading] = useState<Set<string>>(new Set());
  const [stockSummaryErrors, setStockSummaryErrors] = useState<Record<string, string>>({});
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierPriceQuery, setSupplierPriceQuery] = useState("");
  const [supplierPriceDrafts, setSupplierPriceDrafts] = useState<Record<string, string>>({});
  const [supplierPriceSaving, setSupplierPriceSaving] = useState(false);
  // В банке в первую очередь показываем документы, требующие действия.
  const [bankSub, setBankSub] = useState<BankSub>("pending");
  const [detailPaymentId, setDetailPaymentId] = useState<string | null>(
    focusPaymentId || null
  );
  const router = useRouter();
  const [collecting, setCollecting] = useState(false);
  const [showCollect, setShowCollect] = useState(false);
  /** Раскрытые закрытия смен кассы: id -> показать детализацию. */
  const [openCollections, setOpenCollections] = useState<Set<string>>(new Set());
  const [collectError, setCollectError] = useState("");

  useEffect(() => {
    if (focusDealId) {
      setActiveTab("deals");
      const deal = deals.find((item) => item.id === focusDealId);
      setDealsSub(deal?.status === "completed" || deal?.status === "cancelled" ? "released" : "new");
      setExpandedDealId(focusDealId);
      window.setTimeout(() => document.getElementById(`deal-${focusDealId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    } else if (focusReceiptId) {
      setActiveTab("receipts");
      const receipt = receipts.find((item) => item.id === focusReceiptId);
      setReceiptSub(receipt?.status === "posted" ? "archive" : "active");
      window.setTimeout(() => document.getElementById(`receipt-${focusReceiptId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    } else if (focusProductId) {
      setActiveTab("stock");
      setStockSub("stock");
      setExpandedStockIds((prev) => new Set(prev).add(focusProductId));
      setStockSummaryLoading((prev) => new Set(prev).add(focusProductId));
      setStockSummaryErrors((prev) => {
        const next = { ...prev };
        delete next[focusProductId];
        return next;
      });
      void requestProductStockSummary(focusProductId)
        .then((summary) =>
          setStockSummaries((prev) => ({ ...prev, [focusProductId]: summary }))
        )
        .catch((error) =>
          setStockSummaryErrors((prev) => ({
            ...prev,
            [focusProductId]:
              error instanceof Error ? error.message : "Не удалось загрузить сводку",
          }))
        )
        .finally(() =>
          setStockSummaryLoading((prev) => {
            const next = new Set(prev);
            next.delete(focusProductId);
            return next;
          })
        );
      window.setTimeout(() => document.getElementById(`stock-${focusProductId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    } else if (focusPaymentId) {
      setActiveTab("bank");
      setDetailPaymentId(focusPaymentId);
      const payment = payments.find((item) => item.id === focusPaymentId);
      setBankSub(payment?.isPaid ? "history" : "pending");
      window.setTimeout(() => document.getElementById(`payment-${focusPaymentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    }
  }, [deals, focusDealId, focusPaymentId, focusProductId, focusReceiptId, payments, receipts]);

  async function loadStockSummary(productId: string, force = false) {
    if (
      !force &&
      (stockSummaries[productId] || stockSummaryLoading.has(productId))
    ) {
      return;
    }
    setStockSummaryLoading((prev) => new Set(prev).add(productId));
    setStockSummaryErrors((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    try {
      const summary = await requestProductStockSummary(productId);
      setStockSummaries((prev) => ({ ...prev, [productId]: summary }));
    } catch (error) {
      setStockSummaryErrors((prev) => ({
        ...prev,
        [productId]:
          error instanceof Error ? error.message : "Не удалось загрузить сводку",
      }));
    } finally {
      setStockSummaryLoading((prev) => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }
  }

  function toggleStockSummary(productId: string) {
    const isExpanded = expandedStockIds.has(productId);
    setExpandedStockIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    if (!isExpanded) void loadStockSummary(productId);
  }

  function handleStockQuantitySaved(productId: string) {
    setStockSummaries((prev) => {
      if (!prev[productId]) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    if (expandedStockIds.has(productId)) {
      void loadStockSummary(productId, true);
    }
  }

  // Локальные переопределения цен после инлайн-сохранения: колонка
  // «Разница» и «Сумма» пересчитываются сразу, без перезагрузки.
  const [stockPriceOverrides, setStockPriceOverrides] = useState<
    Map<string, { price?: number | null; purchasePrice?: number | null }>
  >(new Map());
  function handleStockPriceSaved(
    productId: string,
    field: "price" | "purchasePrice",
    value: number | null
  ) {
    setStockPriceOverrides((prev) => {
      const next = new Map(prev);
      next.set(productId, { ...(next.get(productId) || {}), [field]: value });
      return next;
    });
    // Сводка товара использует закупочную цену для маржи — сбрасываем кеш.
    setStockSummaries((prev) => {
      if (!prev[productId]) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    if (expandedStockIds.has(productId)) {
      void loadStockSummary(productId, true);
    }
  }

  // Filters
  const [q, setQ] = useState(""); // Stock/Deals query
  const [bq, setBq] = useState(""); // Bank query
  const [rq, setRq] = useState(""); // Receipts query (поставщик/номер/товар)
  const [bdir, setBdir] = useState("all");
  const [bankDateFrom, setBankDateFrom] = useState("");
  const [bankDateTo, setBankDateTo] = useState("");
  const [bsort, setBsort] = useState<"asc" | "desc">("desc");
  const [historyDaysPage, setHistoryDaysPage] = useState(0);
  // «Не считать» в «Должны нам / Мы должны»: клик по контрагенту в блоке
  // расчёта банка мгновенно вычитает его из ожидаемых сумм (строка
  // становится красной), повторный клик возвращает. Быстрая прикидка —
  // живёт только на клиенте, платежи и БД не меняются.
  const [skippedParties, setSkippedParties] = useState<Set<string>>(new Set());

  function toggleSkipParty(c: { type: "customer" | "supplier"; name: string }) {
    const key = partyKey(c.type, c.name);
    setSkippedParties((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ——— Поштучное «вычёркивание» платежей в «Должны нам / Мы должны» ———
  // Строку контрагента можно раскрыть: внутри — платежи, из которых
  // складывается его сумма. Клик по строке контрагента вычёркивает его
  // целиком (как раньше), клик по конкретному платежу вычитает из суммы
  // только его часть. Всё живёт на клиенте, БД не меняется.
  const [skippedPaymentIds, setSkippedPaymentIds] = useState<Set<string>>(new Set());
  const [expandedDueKeys, setExpandedDueKeys] = useState<Set<string>>(new Set());

  function toggleSkipPayment(paymentId: string) {
    setSkippedPaymentIds((prev) => {
      const next = new Set(prev);
      if (next.has(paymentId)) next.delete(paymentId);
      else next.add(paymentId);
      return next;
    });
  }

  function toggleDueExpanded(key: string) {
    setExpandedDueKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Строка контрагента в «Должны нам / Мы должны» + раскрываемый список
      платежей: клик по строке — вычеркнуть контрагента целиком, клик по
      платежу внутри — вычесть из суммы только его часть. */
  function renderDueParty(c: CounterpartyBalance, type: "customer" | "supplier") {
    const selKey = partyKey(type, c.name);
    const skipped = skippedParties.has(selKey);
    const isSel = selectedPartyKeys.has(selKey);
    const duePays = dueBreakdown.listByKey.get(selKey) || [];
    const skippedSum = Math.round((dueBreakdown.skippedByKey.get(selKey) || 0) * 100) / 100;
    const expanded = expandedDueKeys.has(selKey);
    // Если контрагент вычеркнут целиком — показываем исходную сумму
    // (зачёркнута вся строка). Иначе вычитаем поштучно вычеркнутые платежи.
    const shownBalance = skipped
      ? Math.round(c.balance * 100) / 100
      : Math.round((c.balance - skippedSum) * 100) / 100;
    const positiveColor = type === "customer" ? "#7dd181" : "#ef8f76";
    const negativeColor = type === "customer" ? "#ef8f76" : "#7dd181";
    const paySign = type === "customer" ? "+" : "−";
    return (
      <div key={`${type}-${c.name}`} className="bank-due__item">
        <div
          className={`bank-due__row bank-due__row--click${skipped ? " bank-due__row--skipped" : ""}${isSel ? " bank-due__row--selected" : ""}`}
          role="button"
          tabIndex={0}
          title={skipped
            ? "ЛКМ — вернуть в расчёт · ПКМ — выделить для прикидки"
            : type === "customer"
              ? "ЛКМ — не считать контрагента целиком · ПКМ — выделить для прикидки (приход +)"
              : "ЛКМ — не считать контрагента целиком · ПКМ — выделить для прикидки (расход −)"}
          onClick={() => toggleSkipParty(c)}
          onContextMenu={(e) => { e.preventDefault(); toggleSelectedParty({ type, name: c.name }); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleSkipParty(c);
            }
          }}
        >
          {duePays.length > 0 ? (
            <button
              type="button"
              className={`bank-due__expand${expanded ? " bank-due__expand--open" : ""}`}
              aria-label={expanded ? "Свернуть список платежей" : "Раскрыть список платежей"}
              title={expanded ? "Свернуть список платежей" : "Список платежей — можно вычеркнуть поштучно"}
              onClick={(e) => { e.stopPropagation(); toggleDueExpanded(selKey); }}
            >
              <ChevronDown size={14} />
            </button>
          ) : (
            <span className="bank-due__expand bank-due__expand--placeholder" aria-hidden="true" />
          )}
          <div className="bank-due__name">
            {c.name}
            <span className="bank-due__meta">
              {c.docsCount} плат. · последний {fmtDate(c.lastPaymentDate)}
              {!skipped && skippedSum > 0 ? ` · вычеркнуто ${fmt(skippedSum)} ₽` : ""}
            </span>
          </div>
          <div className="bank-due__sum" style={{ fontSize: 18, color: skipped ? undefined : shownBalance > 0 ? positiveColor : negativeColor }}>
            {fmt(shownBalance)} ₽
          </div>
        </div>
        {expanded && duePays.length > 0 && (
          <div className="bank-due__pays">
            {duePays.map((p) => {
              const pSkipped = skippedPaymentIds.has(p.id);
              const prodInfo = paymentProductsSummaryById.get(String(p.id));
              const hasBoxes = prodInfo && (prodInfo.itemsList.length > 0 || prodInfo.summaryText);
              const commentText = p.comment ? String(p.comment).trim() : "";
              const middleText = hasBoxes
                ? `📦 ${prodInfo.summaryText}${commentText ? ` · ${commentText}` : ""}`
                : commentText;
              return (
                <div
                  key={p.id}
                  className={`bank-due__pay${pSkipped ? " bank-due__pay--skipped" : ""}`}
                  role="button"
                  tabIndex={0}
                  title="ЛКМ — вычеркнуть/вернуть этот платёж · ПКМ — выделить для прикидки"
                  onClick={(e) => { e.stopPropagation(); toggleSkipPayment(p.id); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelectedPayment(p.id); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleSkipPayment(p.id);
                    }
                  }}
                >
                  <span className="bank-due__pay-num">{p.invoiceNumber || `ПЛ-${p.number}`}</span>
                  <span className="bank-due__pay-date">{fmtDate(p.date)}</span>
                  {middleText ? (
                    <span
                      className="bank-due__pay-comment"
                      style={{
                        fontSize: 11.5,
                        color: hasBoxes
                          ? pSkipped
                            ? "var(--adm-rust)"
                            : "var(--adm-primary)"
                          : undefined,
                        fontWeight: hasBoxes ? 550 : undefined,
                      }}
                      title={middleText}
                    >
                      {middleText}
                    </span>
                  ) : (
                    <span className="bank-due__pay-comment" />
                  )}
                  <span className="bank-due__pay-sum">{paySign}{fmt(p.amount)} ₽</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ——— Правый клик: выделение ожидающих платежей/контрагентов для быстрой прикидки ———
  // Левый клик остаётся «вычеркиванием» (skippedParties), правый — выделение.
  // Выделенные суммы показываются отдельным блоком «Выбрано», где приход + , расход −.
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<Set<string>>(new Set());
  const [selectedPartyKeys, setSelectedPartyKeys] = useState<Set<string>>(new Set());
  const [showCalculator, setShowCalculator] = useState(false);
  const [calcExpression, setCalcExpression] = useState("");
  const [calcResult, setCalcResult] = useState<string>("");

  function toggleSelectedParty(c: { type: "customer" | "supplier"; name: string }) {
    const key = partyKey(c.type, c.name);
    setSelectedPartyKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleSelectedPayment(paymentId: string) {
    setSelectedPaymentIds((prev) => {
      const next = new Set(prev);
      if (next.has(paymentId)) next.delete(paymentId);
      else next.add(paymentId);
      return next;
    });
  }

  // Платежи для итогов («Должны нам / Мы должны», прогноз): ожидающие
  // платежи пропущенных контрагентов И отдельно вычеркнутые платежи
  // не учитываются. Проведённые платежи (фактический баланс) не трогаем.
  const paymentsForTotals = useMemo(
    () =>
      skippedParties.size === 0 && skippedPaymentIds.size === 0
        ? payments
        : payments.filter((p) => {
            if (p.isPaid) return true;
            if (skippedPaymentIds.has(p.id)) return false;
            const key = paymentPartyKey(p);
            return !key || !skippedParties.has(key);
          }),
    [payments, skippedParties, skippedPaymentIds]
  );

  useEffect(() => {
    setHistoryDaysPage(0);
  }, [bankSub, bq, bdir, bsort, bankDateFrom, bankDateTo]);

  useEffect(() => {
    if (!selectedSupplierId) return;
    const supplier = counterpartyOptions.find((item) => item.id === selectedSupplierId);
    const next: Record<string, string> = {};
    for (const [productId, price] of Object.entries(supplier?.supplierPrices || {})) {
      next[productId] = String(price ?? 0);
    }
    setSupplierPriceDrafts(next);
    setSupplierPriceQuery("");
  }, [counterpartyOptions, selectedSupplierId]);

  // Calculations
  const dealPaidMap = useMemo(() => getDealPaidMap(payments), [payments]);
  const receiptPaidMap = useMemo(() => getReceiptPaidMap(payments), [payments]);
  // Способ оплаты заказа берём из входящего ПЛ: наличка, карта ЮМ или счёт.
  const dealPaymentMethod = useMemo(() => {
    const map = new Map<string, "cash" | "ym_card" | "regular">();
    for (const payment of payments) {
      if (payment.direction !== "incoming") continue;
      const method = payment.type === "cash"
        ? "cash"
        : payment.type === "ym_card" || payment.cashDestination === "card"
          ? "ym_card"
          : "regular";
      for (const dealId of payment.dealIds || []) map.set(dealId, method);
    }
    return map;
  }, [payments]);
  const bankSummary = useMemo(
    // Заказы нужны, чтобы ожидаемый приход по заказу автоматически
    // уменьшался на уже пришедшие частичные оплаты другими платежами.
    // paymentsForTotals — без платежей, отмеченных «не считать».
    () => getBankSummary(paymentsForTotals, salaries, cashCollections, undefined, deals),
    [paymentsForTotals, salaries, cashCollections, deals]
  );
  const cashCarryover = useMemo(
    () =>
      getCashCarryoverSummary(
        payments,
        salaries,
        cashCollections,
        localDateIso()
      ),
    [payments, salaries, cashCollections]
  );
  // --- Helper to get purchase price for any product ---
  const getProductPurchasePrice = (productId: string) => {
    // 0. Check product's own purchasePrice (set via card or report)
    const prod = (stock as any[]).find((p: any) => p.id === productId);
    if (prod && prod.purchasePrice != null && prod.purchasePrice > 0) return prod.purchasePrice;
    // 1. Check counterparties supplierPrices
    for (const cp of counterpartyOptions) {
      if (cp.supplierPrices && cp.supplierPrices[productId] !== undefined) {
        return cp.supplierPrices[productId];
      }
    }
    // 2. Fallback: Check receipts
    let lastDate = "";
    let lastPrice = 0;
    for (const r of receipts) {
      const rit = r.items?.find((item) => item.productId === productId);
      if (rit) {
        if (!lastDate || r.date > lastDate) {
          lastDate = r.date;
          lastPrice = rit.price;
        }
      }
    }
    return lastPrice || 0;
  };

  // --- Critical Products Calculation (Feature 2) ---
  const criticalProducts = useMemo(() => {
    const outOfStock: WarehouseStockRow[] = [];
    const lowStock: WarehouseStockRow[] = [];
    const frequentlyOrderedAbsent: { product: WarehouseStockRow; orderCount: number }[] = [];
    const stagnantStock: { product: WarehouseStockRow; lastSaleDays: number | null; lastSaleDate: string | null }[] = [];

    const todayStr = getWarehouseBusinessDate(new Date());

    for (const p of stock) {
      // Find all deals containing this product
      const productDeals = deals.filter(d => d.items?.some(it => it.productId === p.id));
      const orderCount = productDeals.length;

      // Find last sale date
      let lastSaleDate: string | null = null;
      let lastSaleDays: number | null = null;
      if (orderCount > 0) {
        const sorted = [...productDeals].sort((a, b) => b.date.localeCompare(a.date));
        lastSaleDate = sorted[0].date;
        const diffTime = new Date(todayStr).getTime() - new Date(lastSaleDate).getTime();
        lastSaleDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
      }

      if (p.stockQty <= 0) {
        outOfStock.push(p);
        if (orderCount >= 2) {
          frequentlyOrderedAbsent.push({ product: p, orderCount });
        }
      } else {
        if (p.stockWarnQty != null && p.stockWarnQty > 0 && p.stockQty <= p.stockWarnQty) {
          lowStock.push(p);
        }
        if (orderCount === 0 || (lastSaleDays !== null && lastSaleDays >= 60)) {
          stagnantStock.push({ product: p, lastSaleDays, lastSaleDate });
        }
      }
    }

    return { outOfStock, lowStock, frequentlyOrderedAbsent, stagnantStock };
  }, [stock, deals]);

  const allCounterparties = useMemo(
    // Полный список платежей: строки «пропущенных» контрагентов должны
    // оставаться видимыми (чтобы их можно было вернуть в расчёт кликом).
    // Итоги «Должны нам / Мы должны» считаются по paymentsForTotals.
    () => getPendingPaymentCounterpartyBalances(payments, deals),
    [payments, deals]
  );

  // Filter counterparties to only show those with positive debt (what is owed)
  const counterpartiesWithDebt = useMemo(
    () => allCounterparties.filter((c) => c.balance > 0.009),
    [allCounterparties]
  );

  // Разбивка «Должны нам / Мы должны» по платежам: для каждого
  // контрагента — список неоплаченных платежей, образующих его долг
  // (покупателю — входящие, поставщику — исходящие), и сумма уже
  // вычеркнутых поштучно. Ключ — тот же, что у partyKey().
  const dueBreakdown = useMemo(() => {
    const listByKey = new Map<string, BankPayment[]>();
    const skippedByKey = new Map<string, number>();
    for (const p of payments) {
      if (p.isPaid || p.excludeFromBalance) continue;
      const key = paymentPartyKey(p);
      if (!key) continue;
      const isCustomer = key.startsWith("customer:");
      const contributes = isCustomer
        ? p.direction === "incoming"
        : p.direction === "outgoing";
      if (!contributes) continue;
      const list = listByKey.get(key) || [];
      list.push(p);
      listByKey.set(key, list);
      if (skippedPaymentIds.has(p.id)) {
        skippedByKey.set(key, (skippedByKey.get(key) || 0) + (Number(p.amount) || 0));
      }
    }
    // Новые сверху — как в списке платежей
    for (const list of listByKey.values()) {
      list.sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.number - a.number);
    }
    return { listByKey, skippedByKey };
  }, [payments, skippedPaymentIds]);

  const selectedSum = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const key of selectedPartyKeys) {
      const found = allCounterparties.find((c) => partyKey(c.type as any, c.name) === key) || counterpartiesWithDebt.find((c) => partyKey(c.type as any, c.name) === key);
      if (found) {
        sum += found.type === "customer" ? found.balance : -found.balance;
        count++;
      }
    }
    for (const pid of selectedPaymentIds) {
      const p = payments.find((x) => x.id === pid);
      if (!p) continue;
      sum += p.direction === "incoming" ? p.amount : -p.amount;
      count++;
    }
    return { sum, count };
  }, [selectedPartyKeys, selectedPaymentIds, counterpartiesWithDebt, allCounterparties, payments]);

  // Непроведённые исходящие платежи поставщикам показываем только как
  // срочное напоминание, когда они связаны с уже отпущенным заказом.
  // Обычные долги поставщикам остаются в списке платежей, но не всплывают
  // отдельным красным блоком.
  const pendingSupplierPayments = useMemo(() => {
    const releasedDealIds = new Set(
      deals.filter((d) => d.status === "completed").map((d) => d.id)
    );
    const receiptIdsForReleasedDeals = new Set(
      receipts
        .filter((r) =>
          (r.linkedDealIds || []).some((dealId) => releasedDealIds.has(String(dealId)))
        )
        .map((r) => r.id)
    );

    return paymentsForTotals
      .filter((p) => {
        if (p.isPaid || p.direction !== "outgoing" || p.excludeFromBalance || p.amount <= 0) {
          return false;
        }
        const linkedToReleasedDeal = (p.dealIds || []).some((dealId) =>
          releasedDealIds.has(String(dealId))
        );
        const linkedToReceiptForReleasedDeal = (p.receiptIds || []).some((receiptId) =>
          receiptIdsForReleasedDeals.has(String(receiptId))
        );
        return linkedToReleasedDeal || linkedToReceiptForReleasedDeal;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  }, [deals, paymentsForTotals, receipts]);

  // Закрытые смены кассы — фактические сводки без движения денег.
  const collectionsSorted = useMemo(
    () =>
      [...cashCollections]
        .filter((c) => c && typeof c.amount === "number")
        .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    [cashCollections]
  );
  const collectionsIncomeTotal = useMemo(
    () => collectionsSorted.reduce(
      (sum, collection) =>
        sum + getCashCollectionIncomeBreakdown(collection).total,
      0
    ),
    [collectionsSorted]
  );
  const collectionsCardTotal = useMemo(
    () => collectionsSorted.reduce(
      (sum, collection) =>
        sum + getCashCollectionIncomeBreakdown(collection).card,
      0
    ),
    [collectionsSorted]
  );
  const collectionsExpenseTotal = useMemo(
    () => collectionsSorted.reduce(
      (sum, collection) =>
        sum + getCashCollectionExpenseBreakdown(collection).total,
      0
    ),
    [collectionsSorted]
  );
  const collectionsCardExpenseTotal = useMemo(
    () => collectionsSorted.reduce(
      (sum, collection) =>
        sum + getCashCollectionExpenseBreakdown(collection).card,
      0
    ),
    [collectionsSorted]
  );
  // Для каждой смены отдельно показываем остаток, пришедший на её начало.
  // Это важно: «осталось в кассе» включает не только платежи этой смены,
  // но и наличность, перенесённую с предыдущих дней.
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
  }, [payments, salaries, cashCollections]);
  // Старая версия «закрыть без перевода» не создавала документ сдачи,
  // а просто ставила платежам «вне баланса». Восстанавливаем виртуальные
  // документы по общему updatedAt, чтобы они были видны в проведённых и
  // отменялись одной кнопкой, как обычная сдача кассы.
  const legacyCashClosures = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        date: string;
        paymentIds: string[];
        numbers: number[];
        amount: number;
      }
    >();
    for (const payment of payments) {
      if (
        !payment.isPaid ||
        !payment.excludeFromBalance ||
        payment.type !== "cash" ||
        payment.direction !== "incoming"
      ) {
        continue;
      }
      const stamp = payment.updatedAt || payment.paidAt || payment.date;
      const key = String(stamp || "legacy").slice(0, 16);
      const current = groups.get(key) || {
        id: `legacy-${key}`,
        date: String(stamp || payment.date),
        paymentIds: [],
        numbers: [],
        amount: 0,
      };
      current.paymentIds.push(payment.id);
      current.numbers.push(payment.number);
      current.amount += payment.amount;
      groups.set(key, current);
    }
    return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [payments]);

  // Сводка смены помечает наличные и поступления на ЮМ, показывает перенос,
  // расходы и остаток кассы. Она ничего не переводит и не списывает.
  function handleCollectCash() {
    // Сводка фиксирует фактические цифры и ничего не списывает, поэтому её
    // можно сохранить даже при отрицательном остатке — это помогает увидеть
    // расхождение, а не скрывает его.
    setCollectError("");
    setShowCollect(true);
  }

  async function handleRestoreLegacyClosure(paymentIds: string[], amount: number) {
    if (
      !confirm(
        `Отменить проведение старой сдачи без перевода на ${fmt(amount)} ₽?\n\n` +
          "Платежи вернутся в баланс кассы и снова появятся в настройках сдачи."
      )
    ) {
      return;
    }
    setCollecting(true);
    setCollectError("");
    try {
      const response = await fetch("/api/admin/warehouse/cash-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", paymentIds }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Не удалось отменить проведение");
      }
      router.refresh();
    } catch (error) {
      setCollectError(
        error instanceof Error ? error.message : "Не удалось отменить проведение"
      );
    } finally {
      setCollecting(false);
    }
  }

  async function handleDeleteCollection(id: string, noAccounting = false) {
    const message = noAccounting
      ? "Вернуть скрытые старые платежи в список сводки? Баланс кассы не изменится."
      : "Удалить сводку смены? Деньги и баланс не изменятся; наличные платежи снова появятся в отчёте.";
    if (!confirm(message)) return;
    setCollecting(true);
    try {
      const res = await fetch(`/api/admin/warehouse/cash-collections/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Не удалось удалить");
      }
      router.refresh();
    } catch (err) {
      setCollectError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setCollecting(false);
    }
  }

  // Filtered Stock
  const filteredStock = useMemo(() => {
    const query = q.toLowerCase().trim();
    if (!query) return stock;
    return stock.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.sku && p.sku.toLowerCase().includes(query))
    );
  }, [stock, q]);

  // Filtered Deals - показываем все заказы (новые и отпущенные)
  const filteredDeals = useMemo(() => {
    const query = q.toLowerCase().trim();
    return deals.filter((d) => {
      const paid = dealPaidMap.get(d.id) || 0;
      const isFullyPaid = d.total > 0 && paid + 0.009 >= d.total;

      // В "Активные" попадают: все статуса 'new' + отпущенные ('completed'), но не полностью оплаченные.
      // В "Архив" попадают: полностью оплаченные или отмененные.
      let matchesTab = false;
      if (dealsSub === "new") {
        matchesTab = d.status === "new" || (d.status === "completed" && !isFullyPaid);
      } else {
        matchesTab = (d.status === "completed" && isFullyPaid) || d.status === "cancelled";
      }

      if (!matchesTab) return false;
      if (!query) return true;
      return (
        d.customerName.toLowerCase().includes(query) ||
        String(d.number).includes(query) ||
        // Поиск по товару: находим все заказы, где есть эта позиция
        // (по названию или артикулу).
        (d.items || []).some(
          (it) =>
            (it.name || "").toLowerCase().includes(query) ||
            (it.sku || "").toLowerCase().includes(query)
        )
      );
    });
  }, [deals, dealsSub, q, dealPaidMap]);

  const bankList = useMemo<BankEntry[]>(() => {
    const query = bq.toLowerCase().trim();
    const salaryEntries: BankEntry[] = salaries.map((salary, idx) => ({
      entryKind: "salary",
      id: `salary-${salary.id}`,
      number: idx + 1,
      date: salary.paidAt || salary.date,
      direction: "outgoing",
      counterparty: salary.employeeName,
      amount: salary.amount,
      isPaid: salary.isPaid,
      source: salary.source,
      comment: stripSalaryMetaTags(salary.comment),
      excludeFromBalance: isSalaryExcludedFromBalance(salary.comment),
      createdAt: salary.createdAt || salary.paidAt || salary.date,
      salary,
    }));
    let list: BankEntry[] = [
      ...payments.map((payment) => ({ ...payment, entryKind: "payment" as const })),
      ...salaryEntries,
    ].filter((p) => {
      if (bankSub === "cash") return false;
      const isYmPayment = p.entryKind === "payment" && (p as any).type === "ym_card";
      const isYmSalary = p.entryKind === "salary" && (p.source === "ym_card" || isYmCardSalaryComment((p as any).salary?.comment));
      if (bankSub === "ym") {
        if (!isYmPayment && !isYmSalary) return false;
      } else {
        // В обычных вкладках скрываем операции карты ЮМ — у них отдельная вкладка
        if (isYmPayment || isYmSalary) return false;
        // ЗП ведётся в отдельном разделе «Зарплаты». В «Ожидают оплаты»
        // банка показываем только реальные платёжные поручения, а не
        // начисления сотрудникам.
        if (bankSub === "pending" && p.entryKind === "salary") return false;
      }
      const matchesTab = bankSub === "pending" || bankSub === "ym" ? !p.isPaid : p.isPaid;
      // Для карты ЮМ показываем и ожидающие и проведённые в одном списке? Требование: вкладка с балансом и операциями.
      // Делаем как в банке: pending — неоплаченные, history — оплаченные, ym — показываем все если не фильтруем по paid? Для простоты покажем все в ym, независимо от isPaid, если выбран ym. Если хотим разделить, покажем через paid-фильтр ниже.
      // Сейчас для ym показываем и ожидающие и проведённые — не фильтруем по isPaid, а оставляем оба.
      if (bankSub !== "ym") {
        if (!matchesTab && bankSub !== "summary") return false;
        if (bankSub === "summary") {
          // в сводке не показываем список — bankList не используется, но для безопасности
        }
      }
      if (bdir !== "all" && p.direction !== bdir) return false;
      const operationDate = String(p.date || "").slice(0, 10);
      if (bankDateFrom && operationDate < bankDateFrom) return false;
      if (bankDateTo && operationDate > bankDateTo) return false;
      if (query) {
        const hay = p.entryKind === "payment"
          ? [
              p.counterparty,
              p.comment || "",
              p.invoiceNumber || "",
              `пл-${p.number}`,
              ...p.dealNumbers.map((n) => `зк-${n}`),
              ...p.receiptNumbers.map((n) => `по-${n}`),
            ].join(" ").toLowerCase()
          : ["зп", "зарплата", p.counterparty, p.comment || "", p.source === "cash" ? "касса" : p.source === "ym_card" ? "карта юм" : "банк"].join(" ").toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const createdKey = (entry: BankEntry) =>
      entry.entryKind === "payment"
        ? entry.createdAt || entry.updatedAt || entry.paidAt || entry.date
        : entry.createdAt || entry.salary.paidAt || entry.salary.date;

    list.sort((a, b) => {
      const byDate = bsort === "asc"
        ? a.date.localeCompare(b.date)
        : b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;

      const byCreated = bsort === "asc"
        ? createdKey(a).localeCompare(createdKey(b))
        : createdKey(b).localeCompare(createdKey(a));
      if (byCreated !== 0) return byCreated;

      return bsort === "asc"
        ? String(a.id).localeCompare(String(b.id))
        : String(b.id).localeCompare(String(a.id));
    });
    return list;
  }, [
    payments,
    salaries,
    bankSub,
    bq,
    bdir,
    bsort,
    bankDateFrom,
    bankDateTo,
  ]);

  const bankFilteredTotals = useMemo(() => {
    let inSum = 0;
    let outSum = 0;
    for (const p of bankList) {
      if (p.entryKind === "payment" && p.excludeFromBalance) continue;
      if (p.direction === "incoming") inSum += p.amount;
      else outSum += p.amount;
    }
    return { inSum, outSum };
  }, [bankList]);

  const bankHistoryDayGroups = useMemo(() => {
    const groups: { key: string; label: string; items: BankEntry[] }[] = [];
    for (const p of bankList) {
      const key = (p.date || "").slice(0, 10) || "unknown";
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.key === key) {
        lastGroup.items.push(p);
      } else {
        groups.push({
          key,
          label: key === "unknown" ? "Без даты" : fmtDate(key),
          items: [p],
        });
      }
    }
    return groups;
  }, [bankList]);

  const bankMonthGroups = useMemo(() => {
    const groups: { key: string; label: string; items: BankEntry[] }[] = [];
    for (const p of bankList) {
      const key = (p.date || "").slice(0, 7) || "unknown";
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.key === key) {
        lastGroup.items.push(p);
      } else {
        groups.push({
          key,
          label: key === "unknown" ? "Без даты" : monthLabel(key),
          items: [p],
        });
      }
    }
    return groups;
  }, [bankList]);

  const historyDaysPerPage = 7;
  const historyDaysTotalPages = Math.max(
    1,
    Math.ceil(bankHistoryDayGroups.length / historyDaysPerPage)
  );
  const visibleBankGroups = useMemo(() => {
    if (bankSub === "history") {
      const page = Math.min(historyDaysPage, historyDaysTotalPages - 1);
      const start = page * historyDaysPerPage;
      return bankHistoryDayGroups.slice(start, start + historyDaysPerPage);
    }
    return bankMonthGroups;
  }, [
    bankSub,
    historyDaysPage,
    historyDaysPerPage,
    historyDaysTotalPages,
    bankHistoryDayGroups,
    bankMonthGroups,
  ]);

  const totalUnits = useMemo(
    () => stock.reduce((s, p) => s + p.stockQty, 0),
    [stock]
  );
  const stockValue = useMemo(
    () => stock.reduce((s, p) => s + p.stockQty * (p.price ?? 0), 0),
    [stock]
  );
  const zeroStock = useMemo(
    () => stock.filter((p) => p.stockQty <= 0).length,
    [stock]
  );

  const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "stock", label: "Склад", icon: <Boxes size={13} /> },
    { key: "receipts", label: "Поставки", icon: <Truck size={13} /> },
    { key: "plans", label: "Планы поставок", icon: <Lightbulb size={13} /> },
    { key: "purchases", label: "Закупки", icon: <Wallet size={13} /> },
    { key: "deals", label: "Заказы", icon: <ClipboardList size={13} /> },
    { key: "deliveries", label: "Доставки", icon: <Truck size={13} /> },
    { key: "bank", label: "Банк", icon: <Wallet size={13} /> },
    { key: "salaries", label: "Зарплаты", icon: <Banknote size={13} /> },
    { key: "reports", label: "Отчёты", icon: <BarChart3 size={13} /> },
    {
      key: "counterparties",
      label: "Контрагенты",
      icon: <UsersRound size={13} />,
    },
  ];

  const dealLinkOptions: DealLinkOption[] = useMemo(
    () =>
      deals
        .filter((d) => {
          // Показываем только неоплаченные заказы для привязки к платежу
          const paid = dealPaidMap.get(d.id) || 0;
          const isFullyPaid = d.total > 0 && paid + 0.009 >= d.total;
          return !isFullyPaid;
        })
        .map((d) => ({
          id: d.id,
          number: d.number,
          date: d.date,
          customerName: d.customerName,
          total: d.total,
          status: d.status,
          paidAmount: dealPaidMap.get(d.id) || 0,
        })),
    [deals, dealPaidMap]
  );

  const receiptLinkOptions: ReceiptLinkOption[] = useMemo(
    () =>
      receipts.map((r) => ({
        id: r.id,
        number: r.number,
        date: r.date,
        supplier: r.supplier,
        total: r.total,
        paidAmount: receiptPaidMap.get(r.id) || 0,
      })),
    [receipts, receiptPaidMap]
  );

  const stockById = useMemo(
    () => new Map(stock.map((p) => [p.id, p.stockQty])),
    [stock]
  );
  // Резерв по товарам: сумма quantity по заказам со статусом != cancelled,
  // у которых включён isReserved и товар ещё не отгружен.
  const reservedById = useMemo(() => {
    const map = new Map<string, number>();
    const dealsByReserve = new Map<string, { number: number; qty: number }[]>();
    for (const deal of deals) {
      if (deal.status === "cancelled" || deal.status === "completed") continue;
      if (!deal.isReserved) continue;
      for (const it of deal.items || []) {
        const ordered = Number(it.quantity) || 0;
        const shipped = (deal.shippedItems || []).find(
          (s: any) => s.productId === it.productId
        )?.shippedQty || 0;
        const remaining = Math.max(0, ordered - Number(shipped || 0));
        if (remaining <= 0) continue;
        map.set(it.productId, (map.get(it.productId) || 0) + remaining);
        const arr = dealsByReserve.get(it.productId) || [];
        arr.push({ number: deal.number, qty: remaining });
        dealsByReserve.set(it.productId, arr);
      }
    }
    return { total: map, dealsByProduct: dealsByReserve };
  }, [deals]);
  const reservedTotalById = reservedById.total;
  const reservedDealsByProduct = reservedById.dealsByProduct;
  // Свободный остаток = остаток на складе минус резерв по другим заказам
  function freeStock(productId: string): number {
    return Math.max(0, (stockById.get(productId) ?? 0) - (reservedTotalById.get(productId) || 0));
  }
  const productById = useMemo(() => new Map(stock.map((p) => [p.id, p])), [stock]);

  const dealById = useMemo(() => new Map(deals.map((d) => [String(d.id), d])), [deals]);
  const receiptById = useMemo(() => new Map(receipts.map((r) => [String(r.id), r])), [receipts]);
  // Связь «поставка → заказ» хранится на приходном ордере. Учитываем только
  // активные (ещё не проведённые) поставки: проведённый товар уже находится
  // на складе и отдельно помечать заказ как ожидающий поставку не нужно.
  const activeSuppliesByDealId = useMemo(() => {
    const map = new Map<string, WarehouseReceipt[]>();
    for (const receipt of receipts) {
      if (receipt.status !== "draft") continue;
      for (const dealId of receipt.linkedDealIds || []) {
        const key = String(dealId);
        const linked = map.get(key) || [];
        linked.push(receipt);
        map.set(key, linked);
      }
    }
    return map;
  }, [receipts]);

  const paymentProductsSummaryById = useMemo(() => {
    const map = new Map<
      string,
      {
        summaryText: string;
        itemsList: {
          name: string;
          sku?: string | null;
          qty: number;
          unitLabel?: string;
          price?: number;
        }[];
      }
    >();
    for (const p of payments) {
      const itemsList: {
        name: string;
        sku?: string | null;
        qty: number;
        unitLabel?: string;
        price?: number;
      }[] = [];
      const namesSet = new Set<string>();

      for (const dealId of p.dealIds || []) {
        const d = dealById.get(String(dealId));
        if (d && Array.isArray(d.items)) {
          for (const it of d.items) {
            if (!it.name) continue;
            const unitStr =
              (it as any).unit === "meter"
                ? "м"
                : (it as any).unit === "roll" &&
                  ((it as any).isCuttable || (it as any).metersPerRoll)
                ? "рул."
                : "шт.";
            itemsList.push({
              name: it.name,
              sku: it.sku ?? null,
              qty: it.quantity,
              unitLabel: unitStr,
              price: Number(it.price) || 0,
            });
            namesSet.add(it.name.trim());
          }
        }
      }

      for (const recId of p.receiptIds || []) {
        const r = receiptById.get(String(recId));
        if (r && Array.isArray(r.items)) {
          for (const it of r.items) {
            if (!it.name) continue;
            const unitStr =
              (it as any).unit === "meter"
                ? "м"
                : (it as any).unit === "roll" &&
                  ((it as any).isCuttable || (it as any).metersPerRoll)
                ? "рул."
                : "шт.";
            itemsList.push({
              name: it.name,
              sku: it.sku ?? null,
              qty: it.quantity,
              unitLabel: unitStr,
              price: Number(it.price) || 0,
            });
            namesSet.add(it.name.trim());
          }
        }
      }

      const namesArr = Array.from(namesSet);
      let summaryText = "";
      if (namesArr.length > 0) {
        summaryText = namesArr.join(", ");
      } else if (p.comment) {
        summaryText = p.comment;
      }
      map.set(String(p.id), { summaryText, itemsList });
    }
    return map;
  }, [payments, dealById, receiptById]);
  const supplierRows = useMemo(() => {
    return counterpartyOptions
      .filter((cp) => cp.roles.includes("supplier"))
      .flatMap((supplier) =>
        Object.entries(supplier.supplierPrices || {}).map(([productId, price]) => {
          const product = productById.get(productId);
          return { supplier, productId, product, price: Number(price) || 0 };
        })
      )
      .filter((row) => row.product)
      .sort((a, b) => (a.product?.name || "").localeCompare(b.product?.name || "", "ru"));
  }, [counterpartyOptions, productById]);
  const supplierCards = useMemo(() => {
    return counterpartyOptions
      .filter((supplier) => supplier.roles.includes("supplier"))
      .map((supplier) => {
        const products = supplierRows.filter((row) => row.supplier.id === supplier.id);
        const needCount = products.filter((row) => {
          const warn = row.product?.stockWarnQty ?? 10;
          return (row.product?.stockQty || 0) <= warn;
        }).length;
        return { supplier, products, needCount };
      })
      .sort((a, b) => b.needCount - a.needCount || a.supplier.name.localeCompare(b.supplier.name, "ru"));
  }, [counterpartyOptions, supplierRows]);
  const selectedSupplier = supplierCards.find((item) => item.supplier.id === selectedSupplierId) || null;
  const supplierPriceProducts = useMemo(() => {
    const query = supplierPriceQuery.trim().toLocaleLowerCase("ru-RU");
    return pickerProducts
      .filter((product) => {
        if (!query) return supplierPriceDrafts[product.id] !== undefined;
        return `${product.name} ${product.sku || ""}`.toLocaleLowerCase("ru-RU").includes(query);
      })
      .slice(0, query ? 80 : 300);
  }, [pickerProducts, supplierPriceDrafts, supplierPriceQuery]);

  async function saveSupplierPrices() {
    if (!selectedSupplier) return;
    setSupplierPriceSaving(true);
    try {
      const prices = Object.entries(supplierPriceDrafts).map(([productId, price]) => ({
        productId,
        price: Math.max(0, Number(String(price).replace(",", ".")) || 0),
      }));
      const res = await fetch(`/api/admin/warehouse/counterparties/${selectedSupplier.supplier.id}/supplier-prices`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prices }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Не удалось сохранить прайс");
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось сохранить прайс");
    } finally {
      setSupplierPriceSaving(false);
    }
  }

  // Активные поступления (не проведены) и архив (проведённые/на складе).
  // Отмена проведения возвращает поступление из архива в активные.
  // Поиск — по поставщику, номеру и товару (название/артикул).
  const searchedReceipts = useMemo(() => {
    const query = rq.toLowerCase().trim();
    if (!query) return receipts;
    return receipts.filter(
      (r) =>
        (r.supplier || "").toLowerCase().includes(query) ||
        String(r.number).includes(query) ||
        (r.items || []).some(
          (it) =>
            (it.name || "").toLowerCase().includes(query) ||
            (it.sku || "").toLowerCase().includes(query)
        )
    );
  }, [receipts, rq]);

  const activeReceipts = useMemo(
    () => searchedReceipts.filter((r) => r.status !== "posted"),
    [searchedReceipts]
  );
  const archivedReceipts = useMemo(
    () => searchedReceipts.filter((r) => r.status === "posted"),
    [searchedReceipts]
  );

  return (
    <div>
      <PaymentDetailsModal
        paymentId={detailPaymentId}
        adminPath={adminPath}
        onClose={() => setDetailPaymentId(null)}
      />
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Учёт</h1>
          <p className="admin-sub">
            Склад, заказы покупателей и банк — внутренний учёт, не связан с
            заявками с сайта.
          </p>
        </div>
      </div>

      <div className="admin-tabs-with-actions">
        <div className="admin-filters">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                if (t.key === activeTab) return;
                router.push(`/${adminPath}/warehouse?tab=${t.key}`);
              }}
              className={`admin-filter${activeTab === t.key ? " admin-filter--active" : ""}`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="admin-page-head__actions">
          {activeTab === "receipts" && receiptSub === "active" && (
            <ReceiptForm
              products={pickerProducts}
              counterparties={counterpartyOptions}
              deals={deals}
              payments={payments}
            />
          )}
          {activeTab === "deals" && (
            <DealForm
              products={pickerProducts}
              counterparties={counterpartyOptions}
              payments={payments}
              deliveryPrice={deliveryPrice}
              freeDeliveryThreshold={freeDeliveryThreshold}
              reservedStockById={reservedTotalById}
              tierDiscounts={tierDiscounts}
            />
          )}
          {activeTab === "bank" && (
            <PaymentForm
              deals={dealLinkOptions}
              receipts={receiptLinkOptions}
              counterparties={counterpartyOptions}
            />
          )}
        </div>
      </div>



      {/* ============ ВКЛАДКА: СКЛАД ============ */}
      {activeTab === "stock" && (
        <>
          <div className="admin-stat-grid wh-stat-grid">
            <div className="admin-stat">
              <div className="admin-stat__value">{stock.length}</div>
              <div className="admin-stat__label">Позиций номенклатуры</div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat__value">{fmt(totalUnits)}</div>
              <div className="admin-stat__label">Единиц на складе</div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat__value">{fmt(stockValue)} ₽</div>
              <div className="admin-stat__label">Оценка по ценам продажи</div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat__value">{zeroStock}</div>
              <div className="admin-stat__label">С нулевым остатком</div>
            </div>
          </div>

          <div className="admin-filters admin-filters--sub" style={{ marginBottom: 14 }}>
            <button
              onClick={() => setStockSub("stock")}
              className={`admin-filter${stockSub === "stock" ? " admin-filter--active" : ""}`}
            >
              <Boxes size={12} />
              Остатки на складе
            </button>
            <button
              onClick={() => setStockSub("attention")}
              className={`admin-filter${stockSub === "attention" ? " admin-filter--active" : ""}`}
            >
              <AlertTriangle size={12} />
              Требуют внимания ({(criticalProducts.outOfStock.length + criticalProducts.lowStock.length + criticalProducts.frequentlyOrderedAbsent.length + criticalProducts.stagnantStock.length)})
            </button>
          </div>

          {stockSub === "stock" && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <Search
                    size={16}
                    style={{
                      position: "absolute",
                      left: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--adm-sand)",
                    }}
                  />
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Поиск по названию или артикулу..."
                    className="admin-input"
                    style={{ paddingLeft: 36 }}
                  />
                </div>
                {q && (
                  <button onClick={() => setQ("")} className="admin-btn admin-btn--ghost">
                    Сбросить
                  </button>
                )}
                {/* Ревизия: бланк для пересчёта + сверка фактических остатков */}
                <StockRevision stock={stock} />
              </div>

              <div className="admin-card">
                {filteredStock.length > 0 ? (
                  <div className="admin-table-wrap">
                    <table className="admin-table wh-stock-table">
                      <thead>
                        <tr>
                          <th>Товар</th>
                          <th>Артикул</th>
                          <th style={{ textAlign: "right" }}>Остаток</th>
                          <th style={{ textAlign: "right" }} title="Закупочная цена — общая, примерная. Для конкретного поставщика цена берётся из поставки.">Закуп</th>
                          <th style={{ textAlign: "right" }}>Цена продажи</th>
                          <th style={{ textAlign: "right" }} title="Разница между ценой продажи и закупочной">Разница</th>
                          <th style={{ textAlign: "right" }}>Сумма</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStock.map((p) => {
                          const summaryExpanded = expandedStockIds.has(p.id);
                          const priceOverride = stockPriceOverrides.get(p.id);
                          const effPrice =
                            priceOverride && priceOverride.price !== undefined
                              ? priceOverride.price
                              : p.price ?? null;
                          const effPurchase =
                            priceOverride && priceOverride.purchasePrice !== undefined
                              ? priceOverride.purchasePrice
                              : p.purchasePrice ?? null;
                          return (
                            <React.Fragment key={p.id}>
                              <tr id={`stock-${p.id}`} className={summaryExpanded ? "wh-stock-row--expanded" : undefined}>
                                <td>
                                  <Link href={`/${adminPath}/products/${p.id}`} prefetch={false} className="wh-stock-product-name">
                                    {p.name}
                                  </Link>
                                  <button
                                    type="button"
                                    className="wh-stock-origin-link"
                                    onClick={() => toggleStockSummary(p.id)}
                                    aria-expanded={summaryExpanded}
                                    aria-controls={`stock-summary-${p.id}`}
                                  >
                                    <History size={11} />
                                    {summaryExpanded ? "Скрыть сводку" : "Расширенная сводка"}
                                    <ChevronRight
                                      size={11}
                                      className={summaryExpanded ? "wh-stock-origin-link__chevron wh-stock-origin-link__chevron--open" : "wh-stock-origin-link__chevron"}
                                    />
                                  </button>
                                  {!p.isVisible && (
                                    <span className="admin-badge admin-badge--muted" style={{ marginLeft: 6 }}>скрыт</span>
                                  )}
                                  {p.stockQty > 0 && p.stockWarnQty != null && p.stockQty <= p.stockWarnQty && (
                                    <span className="admin-badge admin-badge--amber" style={{ marginLeft: 6 }}>пополните</span>
                                  )}
                                  {p.stockQty < 0 ? (
                                    <span
                                      className="admin-badge admin-badge--red"
                                      style={{ marginLeft: 6 }}
                                      title="Отрицательный остаток разрешён: его перекроет следующая поставка"
                                    >
                                      довезти {fmt(Math.abs(p.stockQty))} шт.
                                    </span>
                                  ) : p.stockQty === 0 ? (
                                    <span className="admin-badge admin-badge--red" style={{ marginLeft: 6 }}>нет в наличии</span>
                                  ) : null}
                                </td>
                                <td>{p.sku || "—"}</td>
                                <td style={{ textAlign: "right" }}>
                                  <StockQtyEditor
                                    productId={p.id}
                                    initialQty={p.stockQty}
                                    onSaved={() => handleStockQuantitySaved(p.id)}
                                  />
                                  {(reservedTotalById.get(p.id) || 0) > 0 && (
                                    <>
                                      <div style={{ fontSize: 11, color: "var(--adm-indigo)", marginTop: 2, whiteSpace: "nowrap" }}>
                                        в резерве {fmt(reservedTotalById.get(p.id) || 0)} шт.
                                      </div>
                                      <div style={{ fontSize: 11, color: "var(--adm-ink-muted)", marginTop: 1, whiteSpace: "nowrap" }}>
                                        свободно {fmt(freeStock(p.id))} шт.
                                      </div>
                                    </>
                                  )}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <StockPriceEditor
                                    productId={p.id}
                                    field="purchasePrice"
                                    initialValue={p.purchasePrice ?? null}
                                    variant="purchase"
                                    onSaved={(value) => handleStockPriceSaved(p.id, "purchasePrice", value)}
                                  />
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <StockPriceEditor
                                    productId={p.id}
                                    field="price"
                                    initialValue={p.price ?? null}
                                    onSaved={(value) => handleStockPriceSaved(p.id, "price", value)}
                                  />
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {effPrice != null && effPurchase != null && effPrice > 0 ? (
                                    <span
                                      className="wh-stock-diff"
                                      style={{ color: effPrice - effPurchase >= 0 ? "var(--adm-pine)" : "var(--adm-rust)" }}
                                      title="Цена продажи − закупочная цена"
                                    >
                                      {effPrice - effPurchase >= 0 ? "+" : ""}{fmt(Math.round((effPrice - effPurchase) * 100) / 100)} ₽
                                      <small style={{ display: "block", fontSize: 10, opacity: 0.75 }}>
                                        {Math.round(((effPrice - effPurchase) / effPrice) * 100)}%
                                      </small>
                                    </span>
                                  ) : (
                                    <span style={{ color: "var(--adm-sand)" }}>—</span>
                                  )}
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                  {effPrice != null ? `${fmt(p.stockQty * effPrice)} ₽` : "—"}
                                </td>
                              </tr>
                              {summaryExpanded && (
                                <tr id={`stock-summary-${p.id}`} className="stock-summary-row">
                                  <td colSpan={7}>
                                    <ProductStockSummaryPanel
                                      adminPath={adminPath}
                                      summary={stockSummaries[p.id]}
                                      loading={stockSummaryLoading.has(p.id)}
                                      error={stockSummaryErrors[p.id]}
                                      onRetry={() => void loadStockSummary(p.id, true)}
                                    />
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="admin-empty"><p>Товары не найдены</p></div>
                )}
              </div>
            </>
          )}

          {stockSub === "attention" && (
            <div style={{ marginTop: 12 }}>
              {/* Category selector inside attention tab */}
              <div className="admin-filters admin-filters--sub" style={{ marginBottom: 16 }}>
                <button
                  onClick={() => setAttentionCategory("outofstock")}
                  className={`admin-filter${attentionCategory === "outofstock" ? " admin-filter--active" : ""}`}
                >
                  Нет в наличии ({criticalProducts.outOfStock.length})
                </button>
                <button
                  onClick={() => setAttentionCategory("lowstock")}
                  className={`admin-filter${attentionCategory === "lowstock" ? " admin-filter--active" : ""}`}
                >
                  Мало товара ({criticalProducts.lowStock.length})
                </button>
                <button
                  onClick={() => setAttentionCategory("popular")}
                  className={`admin-filter${attentionCategory === "popular" ? " admin-filter--active" : ""}`}
                >
                  Часто заказывают, но нет ({criticalProducts.frequentlyOrderedAbsent.length})
                </button>
                <button
                  onClick={() => setAttentionCategory("stagnant")}
                  className={`admin-filter${attentionCategory === "stagnant" ? " admin-filter--active" : ""}`}
                >
                  Давно без продаж ({criticalProducts.stagnantStock.length})
                </button>
              </div>

              {/* Products list for selected category using highly responsive cards instead of tables */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(() => {
                  let list: React.ReactNode = null;
                  
                  if (attentionCategory === "outofstock") {
                    list = criticalProducts.outOfStock.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {criticalProducts.outOfStock.map((p) => (
                          <div key={p.id} className="admin-card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <div style={{ minWidth: 200, flex: "1 1 auto" }}>
                              <Link href={`/${adminPath}/products/${p.id}`} className="wh-stock-product-name" style={{ fontWeight: 600, fontSize: 13, display: "block" }}>
                                {p.name}
                              </Link>
                              <span style={{ fontSize: 11, color: "var(--adm-ink-soft)" }}>
                                Артикул: {p.sku || "—"} · Остаток:{" "}
                                <b style={{ color: "var(--adm-rust)" }}>{fmt(p.stockQty)} шт.</b>
                                {p.stockQty < 0 && (
                                  <> · нужно довезти <b style={{ color: "var(--adm-rust)" }}>{fmt(Math.abs(p.stockQty))} шт.</b></>
                                )}
                              </span>
                            </div>
                            <div>
                              <Link
                                href={`/${adminPath}/warehouse?tab=plans&planProduct=${encodeURIComponent(p.id)}`}
                                prefetch={false}
                                className="admin-btn admin-btn--primary admin-btn--sm"
                                style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center" }}
                              >
                                <Lightbulb size={12} style={{ marginRight: 6 }} /> Запланировать поставку
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="admin-empty"><p>Все товары в наличии!</p></div>
                    );
                  } else if (attentionCategory === "lowstock") {
                    list = criticalProducts.lowStock.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {criticalProducts.lowStock.map((p) => (
                          <div key={p.id} className="admin-card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <div style={{ minWidth: 200, flex: "1 1 auto" }}>
                              <Link href={`/${adminPath}/products/${p.id}`} className="wh-stock-product-name" style={{ fontWeight: 600, fontSize: 13, display: "block" }}>
                                {p.name}
                              </Link>
                              <span style={{ fontSize: 11, color: "var(--adm-ink-soft)" }}>
                                Артикул: {p.sku || "—"} · Остаток: <b style={{ color: "var(--adm-rust)" }}>{p.stockQty} шт.</b> (минимальный лимит: {p.stockWarnQty} шт.)
                              </span>
                            </div>
                            <div>
                              <Link
                                href={`/${adminPath}/warehouse?tab=plans&planProduct=${encodeURIComponent(p.id)}`}
                                prefetch={false}
                                className="admin-btn admin-btn--primary admin-btn--sm"
                                style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center" }}
                              >
                                <Lightbulb size={12} style={{ marginRight: 6 }} /> Запланировать поставку
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="admin-empty"><p>Нет товаров с остатком меньше минимального лимита.</p></div>
                    );
                  } else if (attentionCategory === "popular") {
                    list = criticalProducts.frequentlyOrderedAbsent.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {criticalProducts.frequentlyOrderedAbsent.map(({ product: p, orderCount }) => (
                          <div key={p.id} className="admin-card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <div style={{ minWidth: 200, flex: "1 1 auto" }}>
                              <Link href={`/${adminPath}/products/${p.id}`} className="wh-stock-product-name" style={{ fontWeight: 600, fontSize: 13, display: "block" }}>
                                {p.name}
                              </Link>
                              <span style={{ fontSize: 11, color: "var(--adm-ink-soft)", display: "block", marginTop: 4 }}>
                                Артикул: {p.sku || "—"} · <b style={{ color: "var(--adm-pine)" }}>Заказывали {orderCount} раз</b>
                              </span>
                            </div>
                            <div>
                              <Link
                                href={`/${adminPath}/warehouse?tab=plans&planProduct=${encodeURIComponent(p.id)}`}
                                prefetch={false}
                                className="admin-btn admin-btn--primary admin-btn--sm"
                                style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center" }}
                              >
                                <Lightbulb size={12} style={{ marginRight: 6 }} /> Запланировать поставку
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="admin-empty"><p>Нет отсутствующих популярных товаров.</p></div>
                    );
                  } else if (attentionCategory === "stagnant") {
                    list = criticalProducts.stagnantStock.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {criticalProducts.stagnantStock.map(({ product: p, lastSaleDays, lastSaleDate }) => (
                          <div key={p.id} className="admin-card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <div style={{ minWidth: 200, flex: "1 1 auto" }}>
                              <Link href={`/${adminPath}/products/${p.id}`} className="wh-stock-product-name" style={{ fontWeight: 600, fontSize: 13, display: "block" }}>
                                {p.name}
                              </Link>
                              <span style={{ fontSize: 11, color: "var(--adm-ink-soft)" }}>
                                Артикул: {p.sku || "—"} · Остаток: <b>{p.stockQty} шт.</b> · Дней без продаж: <b style={{ color: "var(--adm-rust)" }}>{lastSaleDays === null ? "Никогда" : `${lastSaleDays} дн.`}</b>
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--adm-ink-soft)" }}>
                              Последняя продажа: {lastSaleDate ? fmtDate(lastSaleDate) : "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="admin-empty"><p>Нет залежавшихся товаров на складе.</p></div>
                    );
                  }

                  return list;
                })()}
              </div>

            </div>
          )}
        </>
      )}

      {/* ============ ВКЛАДКА: ПОСТАВКИ (Поступления + Поставщики) ============ */}
      {activeTab === "receipts" && (
        <>
          <div className="admin-filters admin-filters--sub">
            <button onClick={() => setSuppliesSub("receipts")} className={`admin-filter${suppliesSub === "receipts" ? " admin-filter--active" : ""}`}>
              <Truck size={12} /> Поступления
            </button>
            <button onClick={() => setSuppliesSub("suppliers")} className={`admin-filter${suppliesSub === "suppliers" ? " admin-filter--active" : ""}`}>
              <UsersRound size={12} /> Поставщики
            </button>
            <button onClick={() => setSuppliesSub("consignment")} className={`admin-filter${suppliesSub === "consignment" ? " admin-filter--active" : ""}`}>
              <Wallet size={12} /> Товар на реализации
            </button>
          </div>

          {suppliesSub === "consignment" && (
            <div className="admin-card" style={{ marginTop: 12 }}><div className="admin-card__head"><h3 className="admin-card__title">Товар на реализации</h3></div><div className="admin-card__pad"><ConsignmentTracker receipts={receipts} deals={deals} payments={payments} manualSales={consignmentManual} /></div></div>
          )}

          {suppliesSub === "receipts" && (
            <>
              <div className="admin-filters admin-filters--sub" style={{ marginTop: 0 }}>
                <button onClick={() => setReceiptSub("active")} className={`admin-filter${receiptSub === "active" ? " admin-filter--active" : ""}`}>Активные</button>
                <button onClick={() => setReceiptSub("archive")} className={`admin-filter${receiptSub === "archive" ? " admin-filter--active" : ""}`}>Архив</button>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <Search
                    size={16}
                    style={{
                      position: "absolute",
                      left: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--adm-sand)",
                    }}
                  />
                  <input
                    type="text"
                    value={rq}
                    onChange={(e) => setRq(e.target.value)}
                    placeholder="Поиск по товару, поставщику или номеру..."
                    className="admin-input"
                    style={{ paddingLeft: 36 }}
                  />
                </div>
                {rq && (
                  <button onClick={() => setRq("")} className="admin-btn admin-btn--ghost">
                    Сбросить
                  </button>
                )}
              </div>

              <div className="admin-card">
                {receiptSub === "active" ? (
                  activeReceipts.length > 0 ? activeReceipts.map((r) => (
                    <ReceiptCard key={r.id} receipt={r} paidAmount={receiptPaidMap.get(r.id) || 0} products={pickerProducts} counterparties={counterpartyOptions} deals={deals} payments={payments} />
                  )) : (
                    <div className="admin-empty"><div className="admin-empty__icon"><Truck size={40} /></div><p>Активных поступлений нет</p></div>
                  )
                ) : (
                  archivedReceipts.length > 0 ? archivedReceipts.map((r) => (
                    <ReceiptCard key={r.id} receipt={r} paidAmount={receiptPaidMap.get(r.id) || 0} products={pickerProducts} counterparties={counterpartyOptions} deals={deals} payments={payments} />
                  )) : (
                    <div className="admin-empty"><div className="admin-empty__icon"><Archive size={40} /></div><p>Архив пуст</p></div>
                  )
                )}
              </div>
            </>
          )}

          {suppliesSub === "suppliers" && (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="admin-card supply-planning-link-card">
                <div>
                  <span><Lightbulb size={16} /> Планирование закупок</span>
                  <strong>Закупки теперь собираются в отдельных планах поставок</strong>
                  <p>Можно создать несколько поставок, назначить поставщика каждой позиции, оценить бюджет и переносить товары между планами.</p>
                </div>
                <Link href={`/${adminPath}/warehouse?tab=plans`} className="admin-btn admin-btn--primary" prefetch={false}>
                  <Lightbulb size={14} /> Открыть планирование
                </Link>
              </div>

              <div className="admin-card">
                {!selectedSupplier ? (
                  supplierCards.length > 0 ? (
                    <div className="admin-card__pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                      {supplierCards.map(({ supplier, products, needCount }) => (
                        <button key={supplier.id} type="button" onClick={() => setSelectedSupplierId(supplier.id)} className="admin-card" style={{ padding: 16, textAlign: "left", cursor: "pointer", border: "1px solid var(--adm-border)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                            <strong style={{ color: "var(--adm-navy)", fontSize: 15 }}>{supplier.name}</strong>
                            {needCount > 0 && <span className="admin-badge admin-badge--amber">заказать {needCount}</span>}
                          </div>
                          <div style={{ color: "var(--adm-muted)", fontSize: 12, marginTop: 6 }}>{products.length} товаров в закупочном прайсе</div>
                          <div style={{ display: "grid", gap: 2, marginTop: 10, fontSize: 12 }}>
                            {supplier.inn && <span>ИНН {supplier.inn}</span>}
                            {supplier.phone && <span>{supplier.phone}</span>}
                            {supplier.email && <span>{supplier.email}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : <div className="admin-empty"><p>Поставщики пока не заведены в контрагентах</p></div>
                ) : (
                  <div>
                    <div className="admin-card__head" style={{ alignItems: "flex-start", gap: 12 }}>
                      <div>
                        <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setSelectedSupplierId(null)} style={{ marginBottom: 10 }}>← Все поставщики</button>
                        <h3 className="admin-card__title" style={{ margin: 0 }}>{selectedSupplier.supplier.name}</h3>
                        <div style={{ color: "var(--adm-muted)", fontSize: 12, marginTop: 6 }}>
                          {[selectedSupplier.supplier.contactName, selectedSupplier.supplier.phone, selectedSupplier.supplier.email, selectedSupplier.supplier.inn ? `ИНН ${selectedSupplier.supplier.inn}` : ""].filter(Boolean).join(" · ")}
                        </div>
                        {selectedSupplier.supplier.address && <div style={{ color: "var(--adm-muted)", fontSize: 12, marginTop: 4 }}>{selectedSupplier.supplier.address}</div>}
                      </div>
                      <Link href={`/${adminPath}/warehouse?tab=counterparties`} className="admin-btn admin-btn--ghost" prefetch={false}>Открыть контрагентов</Link>
                    </div>
                    <div className="admin-card__pad" style={{ display: "grid", gap: 12, borderTop: "1px solid var(--adm-border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <strong style={{ color: "var(--adm-navy)" }}>Товары и прайс-лист</strong>
                          <div style={{ color: "var(--adm-muted)", fontSize: 12 }}>Товары, остатки и закупочные цены. Для будущих закупок добавляйте позиции в планы поставок.</div>
                        </div>
                        <button type="button" className="admin-btn admin-btn--primary" disabled={supplierPriceSaving} onClick={saveSupplierPrices}>
                          {supplierPriceSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Сохранить прайс
                        </button>
                      </div>
                      <div style={{ position: "relative" }}>
                        <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--adm-sand)" }} />
                        <input className="admin-input" value={supplierPriceQuery} onChange={(e) => setSupplierPriceQuery(e.target.value)} placeholder="Найти товар или добавить в прайс..." style={{ paddingLeft: 36 }} />
                      </div>
                      <div className="admin-table-wrap" style={{ maxHeight: 520, overflow: "auto" }}>
                        <table className="admin-table">
                          <thead><tr><th>Товар</th><th>Остаток</th><th>Порог</th><th style={{ width: 170 }}>Цена поставщика</th><th>Статус</th><th style={{ width: 190 }}>Действия</th></tr></thead>
                          <tbody>
                            {supplierPriceProducts.map((product) => {
                              const inPrice = supplierPriceDrafts[product.id] !== undefined;
                              const stockProduct = productById.get(product.id);
                              const warn = stockProduct?.stockWarnQty ?? 10;
                              const need = (product.stockQty || 0) <= warn;
                              return (
                                <tr key={product.id}>
                                  <td>
                                    <Link href={`/${adminPath}/products/${product.id}`} prefetch={false} style={{ fontWeight: 700 }}>{product.name}</Link>
                                    {product.sku && <div style={{ color: "var(--adm-muted)", fontSize: 12 }}>арт. {product.sku}</div>}
                                  </td>
                                  <td>{product.stockQty ?? 0} шт.</td>
                                  <td>{warn} шт.</td>
                                  <td><input className="admin-input" type="number" min={0} step="0.01" value={supplierPriceDrafts[product.id] ?? ""} onChange={(e) => setSupplierPriceDrafts((prev) => ({ ...prev, [product.id]: e.target.value }))} placeholder="0" /></td>
                                  <td>{need ? <span className="admin-badge admin-badge--amber">заказать</span> : <span className="admin-badge admin-badge--green">достаточно</span>}</td>
                                  <td>
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                      {!inPrice && <button type="button" className="admin-btn admin-btn--primary admin-btn--sm" onClick={() => setSupplierPriceDrafts((prev) => ({ ...prev, [product.id]: "0" }))}>В прайс</button>}
                                      {inPrice && <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setSupplierPriceDrafts((prev) => { const next = { ...prev }; delete next[product.id]; return next; })}>Убрать</button>}
                                      <Link
                                        href={`/${adminPath}/warehouse?tab=plans&planProduct=${encodeURIComponent(product.id)}&planSupplier=${encodeURIComponent(selectedSupplier!.supplier.id)}`}
                                        className="admin-btn admin-btn--ghost admin-btn--sm"
                                        prefetch={false}
                                      >
                                        <Lightbulb size={12} /> В план
                                      </Link>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ============ ВКЛАДКА: ДОСТАВКИ ============ */}
      {activeTab === "deliveries" && (
        <TransportManager
          transports={transports}
          pendingDeals={pendingDeals}
          drivers={drivers}
          companyPhone={companyPhone}
          companyAddress={companyAddress}
          focusTransportId={focusTransportId}
          products={pickerProducts}
        />
      )}

      {/* ============ ВКЛАДКА: ПЛАНЫ ПОСТАВОК ============ */}
      {activeTab === "plans" && (
        <SupplyPlanning
          initialPlans={supplyPlans}
          products={pickerProducts}
          initialProductId={initialPlanProductId}
        />
      )}

      {/* ============ ВКЛАДКА: НАКОПИТЕЛЬНЫЕ ЗАКУПКИ ============ */}
      {activeTab === "purchases" && (
        <PurchasePlanning initialPlans={purchasePlans} products={pickerProducts} />
      )}

      {/* ============ ВКЛАДКА: ЗАКАЗЫ ============ */}
      {activeTab === "deals" && (
        <>
          <div className="admin-filters admin-filters--sub">
            <button
              onClick={() => setDealsSub("new")}
              className={`admin-filter${dealsSub === "new" ? " admin-filter--active" : ""}`}
            >
              <ClipboardList size={12} />
              Активные заказы
            </button>
            <button
              onClick={() => setDealsSub("released")}
              className={`admin-filter${dealsSub === "released" ? " admin-filter--active" : ""}`}
            >
              <PackageCheck size={12} />
              Архив (отпущенные)
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search
                size={16}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--adm-sand)",
                }}
              />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск по товару, покупателю или номеру..."
                className="admin-input"
                style={{ paddingLeft: 36 }}
              />
            </div>
          </div>
          <div className="admin-card">
            {filteredDeals.length > 0 ? (
              filteredDeals.map((d) => {
                const paid = dealPaidMap.get(d.id) || 0;
                const isFullyPaid = d.total > 0 && paid + 0.009 >= d.total;
                // Резерв по другим заказам (кроме текущего)
                const reservedByOthers = (productId: string): number => {
                  let r = reservedTotalById.get(productId) || 0;
                  if (d.isReserved) {
                    const shipped = (d.shippedItems || []).find(
                      (s: any) => s.productId === productId
                    )?.shippedQty || 0;
                    const it = d.items.find((i: any) => i.productId === productId);
                    if (it) r -= Math.max(0, Number(it.quantity || 0) - Number(shipped || 0));
                  }
                  return Math.max(0, r);
                };
                const shortage =
                  d.status === "new"
                    ? d.items
                        .map((it) => {
                          const stock = stockById.get(it.productId) ?? 0;
                          const otherReserve = reservedByOthers(it.productId);
                          const free = Math.max(0, stock - otherReserve);
                          const missing = Math.max(0, it.quantity - free);
                          return { it, available: free, stock, otherReserve, missing };
                        })
                        .filter((r) => r.missing > 0)
                    : [];
                const hasShortage = shortage.length > 0;
                const linkedActiveSupplies = activeSuppliesByDealId.get(String(d.id)) || [];
                const isInSupply = d.status === "new" && linkedActiveSupplies.length > 0;
                const supplyNumbers = linkedActiveSupplies.map((receipt) => `ПО-${receipt.number}`).join(", ");
                const expanded = expandedDealId === d.id;
                return (
                  <div key={d.id} id={`deal-${d.id}`} className="admin-order">
                    <button
                      type="button"
                      className="receipt-head"
                      onClick={() => setExpandedDealId(expanded ? null : d.id)}
                      aria-expanded={expanded}
                    >
                      <span className="admin-order__id">ЗК-{d.number}</span>
                      <span className={dealStatusBadge[d.status]}>{dealStatusLabel[d.status]}</span>
                      {isFullyPaid ? (
                        <span className="admin-badge admin-badge--green">Оплачен</span>
                      ) : (
                        <span className="admin-badge admin-badge--red" style={{ fontWeight: 800 }}>
                          <AlertTriangle size={10} /> Клиент не оплатил
                        </span>
                      )}
                      {!isFullyPaid && paid > 0 && (
                        <span className="admin-badge admin-badge--blue">Оплачено {fmt(paid)} из {fmt(d.total)} ₽</span>
                      )}
                      {d.isReserved ? (
                        <span
                          className="admin-badge admin-badge--indigo"
                          title="Товар зарезервирован за этим заказом — не продаётся другим"
                        >
                          <Lock size={10} /> в резерве
                        </span>
                      ) : null}
                      {isInSupply ? (
                        <span
                          className="admin-badge admin-badge--blue"
                          title={`Товар ожидается по привязанной поставке ${supplyNumbers}`}
                        >
                          <Truck size={10} /> в поставке
                        </span>
                      ) : hasShortage ? (
                        <span
                          className="admin-badge admin-badge--red"
                          title={shortage
                            .map((r) => {
                              const parts = [
                                r.it.name,
                                `нужно ${r.it.quantity}`,
                                `свободно ${fmt(r.available)}`,
                              ];
                              if (r.otherReserve > 0) parts.push(`в резерве др. ${fmt(r.otherReserve)}`);
                              return parts.join(" · ");
                            })
                            .join("\n")}
                        >
                          <AlertTriangle size={10} /> не хватает товара
                        </span>
                      ) : null}
                      {(() => {
                        const shippedArr = Array.isArray(d.shippedItems) ? d.shippedItems : [];
                        const totalOrdered = d.items.reduce((s: number, it: any) => s + it.quantity, 0);
                        const totalShipped = shippedArr.reduce((s: number, it: any) => s + (it.shippedQty || 0), 0);
                        if (totalShipped > 0 && totalShipped < totalOrdered) {
                          return (
                            <span className="admin-badge admin-badge--indigo" title={`Отгружено ${totalShipped} из ${totalOrdered}`}>
                              <Truck size={10} /> Частично отгружено: {totalShipped}/{totalOrdered}
                            </span>
                          );
                        }
                        return null;
                      })()}
                      {d.hasDelivery && (
                        <span
                          className={
                            d.deliveryType === "paid"
                              ? "admin-badge admin-badge--amber"
                              : "admin-badge admin-badge--green"
                          }
                          title={d.deliveryAddress || "Доставка"}
                        >
                          {d.deliveryType === "paid" ? (
                            <Banknote size={10} />
                          ) : (
                            <Gift size={10} />
                          )}
                          {d.deliveryType === "paid"
                            ? `Доставка ${fmt(d.deliveryCost || 0)} ₽`
                            : "Бесплатная доставка"}
                        </span>
                      )}
                      <span className="receipt-head__supplier">{d.customerName}</span>
                      <span className="receipt-head__date">{fmtDate(d.date)}</span>
                      <span className="receipt-head__total">{fmt(d.total)} ₽</span>
                      <span className="receipt-head__chevron">{expanded ? "▲" : "▼"}</span>
                    </button>

                    {expanded && (
                      <div className="admin-order__row" style={{ paddingTop: 14 }}>
                        <div className="admin-order__main">
                          <div className="admin-order__grid">
                            <div className="admin-order__meta">
                              <span className="admin-order__meta-label wh-meta-label">Покупатель:</span>
                              <span className="admin-order__meta-val">{d.customerName}</span>
                            </div>
                          </div>

                          <div className="admin-order__items">
                            <div className="admin-order__items-title">Товары</div>
                            {d.items.map((it, idx) => {
                              const shipped = (Array.isArray(d.shippedItems) ? d.shippedItems : []).find((s: any) => s.productId === it.productId)?.shippedQty || 0;
                              const remaining = it.quantity - shipped;
                              const isMeter = (it as any).unit === 'meter';
                              const isRoll = (it as any).unit === 'roll' && Boolean((it as any).isCuttable || (it as any).metersPerRoll);
                              const saleQty = (it as any).saleQuantity != null ? (it as any).saleQuantity : (isMeter && (it as any).metersPerRoll ? Number(it.quantity) * Number((it as any).metersPerRoll) : Number(it.quantity));
                              const unitLabel = isMeter ? `${saleQty} м` : isRoll ? `${it.quantity} рул.` : `${it.quantity} шт.`;
                              const priceLabel = isMeter ? `${fmt((it as any).salePrice || it.price)} ₽/м` : isRoll ? `${fmt(it.price)} ₽/рул.` : `${fmt(it.price)} ₽/шт`;
                              return (
                                <div key={idx} className={`admin-order__item${shipped > 0 && remaining > 0 ? " admin-order__item--partial" : ""}`}>
                                  <Link
                                    href={`/${adminPath}/products/${it.productId}`}
                                    prefetch={false}
                                    style={{ color: "inherit", fontWeight: 650 }}
                                  >
                                    {it.name} × {unitLabel}
                                    <span className="wh-item-unit">{priceLabel}</span>
                                    {shipped > 0 && remaining > 0 && (
                                      <span className="wh-item-row__warn" style={{ marginLeft: 8, whiteSpace: "nowrap" }}>
                                        отгружено: {shipped} · осталось: {remaining}
                                      </span>
                                    )}
                                    {shipped > 0 && remaining <= 0 && (
                                      <span style={{ marginLeft: 8, color: "var(--adm-pine)", fontSize: 11, fontWeight: 600 }}>
                                        ✓ отгружено
                                      </span>
                                    )}
                                  </Link>
                                  <span className="admin-order__item-sum">{fmt(it.lineTotal)} ₽</span>
                                </div>
                              );
                            })}
                            {d.hasDelivery && (d.deliveryCost || 0) > 0 && (
                              <div className="admin-order__item admin-order__item--adjustment">
                                <span>Доставка (платная)</span>
                                <span className="admin-order__item-sum">
                                  {fmt(d.deliveryCost || 0)} ₽
                                </span>
                              </div>
                            )}
                            {d.hasDelivery && d.deliveryType === "free" && (
                              <div className="admin-order__item admin-order__item--adjustment">
                                <span>Доставка</span>
                                <span className="admin-order__item-sum">бесплатно</span>
                              </div>
                            )}
                            <div className="admin-order__total">
                              <span>
                                Итого (с НДС
                                {d.vatRate != null
                                  ? d.vatRate > 0
                                    ? ` ${d.vatRate}%`
                                    : d.vatRate === -1
                                    ? ", без НДС"
                                    : " 0%"
                                  : ""}
                                )
                              </span>
                              <span>{fmt(d.total)} ₽</span>
                            </div>
                            {d.vatAmount > 0 && (
                              <div style={{ fontSize: 11, color: "var(--adm-pine)", marginTop: 4 }}>
                                в т.ч. НДС {d.vatRate}%: {fmt(d.vatAmount)} ₽
                              </div>
                            )}
                            {d.hasDelivery && d.deliveryAddress && (
                              <div style={{ fontSize: 12, marginTop: 8, color: "var(--adm-ink-soft)" }}>
                                📍 {d.deliveryAddress}
                                {d.deliveryPlannedDate
                                  ? ` · план ${d.deliveryPlannedDate.split("-").reverse().join(".")}`
                                  : ""}
                              </div>
                            )}
                            
                            {(() => {
                              const totalPurchaseCost = d.items.reduce((sum: number, it: any) => {
                                const pPrice = getProductPurchasePrice(it.productId);
                                return sum + pPrice * it.quantity;
                              }, 0);
                              const deliveryCostForMargin = d.hasDelivery ? (d.deliveryCost || 0) : 0;
                              const profit = d.total - totalPurchaseCost - deliveryCostForMargin;
                              const marginPercent = d.total > 0 ? Math.round((profit / d.total) * 100) : 0;
                              return (
                                <div className="admin-order__margin-box" style={{
                                  marginTop: 14,
                                  padding: 12,
                                  borderRadius: 6,
                                  border: "1px solid var(--adm-sand-pale)",
                                  background: "rgba(245, 242, 234, 0.25)"
                                }}>
                                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--adm-ink)" }}>
                                    📊 Анализ прибыльности заказа:
                                  </div>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 12 }}>
                                    <div>Сумма продажи: <b>{fmt(d.total)} ₽</b></div>
                                    <div>Себестоимость: <b>{fmt(totalPurchaseCost)} ₽</b></div>
                                    <div>Доставка: <b>{d.hasDelivery ? `${fmt(deliveryCostForMargin)} ₽` : "нет"}</b></div>
                                    <div>Прибыль: <b style={{ color: profit >= 0 ? "var(--adm-pine)" : "var(--adm-rust)" }}>{fmt(profit)} ₽</b></div>
                                    <div style={{ gridColumn: "span 2", marginTop: 4, paddingTop: 4, borderTop: "1px dashed var(--adm-sand-pale)" }}>
                                      Маржа: <b style={{ fontSize: 13, color: profit >= 0 ? "var(--adm-pine)" : "var(--adm-rust)" }}>{marginPercent}%</b>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          {d.status === "new" &&
                            (hasShortage ? (
                              <div className="deal-stock deal-stock--miss">
                                <div className="deal-stock__title"><AlertTriangle size={12} />Не хватает свободного товара</div>
                                {shortage.map((r) => (
                                  <div key={r.it.productId} className="deal-stock__row">
                                    <span className="deal-stock__name">{r.it.name}</span>
                                    <span className="deal-stock__nums">
                                      нужно {r.it.quantity} · на складе {fmt(r.stock)}
                                      {r.otherReserve > 0 && <> · <b style={{color:"var(--adm-indigo)"}}>в резерве {fmt(r.otherReserve)}</b></>}
                                      {" "}· свободно {fmt(r.available)} · <b>не хватает {r.missing}</b>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="deal-stock deal-stock--ok"><PackageCheck size={13} />Все позиции есть на складе (с учётом резервов)</div>
                            ))}

                          {d.status === "new" && (
                            <div className="deal-reserve-row">
                              <button
                                type="button"
                                className={`admin-btn admin-btn--sm ${d.isReserved ? "admin-badge--indigo" : "admin-btn--ghost"}`}
                                disabled={busyId === d.id}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setBusyId(d.id);
                                  try {
                                    const res = await fetch(
                                      `/api/admin/warehouse/deals/${d.id}/reserve`,
                                      {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ reserved: !d.isReserved }),
                                      }
                                    );
                                    if (!res.ok) {
                                      const err = await res.json().catch(() => ({}));
                                      alert(err.error || "Не удалось изменить резерв");
                                    } else {
                                      router.refresh();
                                    }
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                                title={d.isReserved
                                  ? "Снять резерв — товары снова доступны другим заказам"
                                  : "Зарезервировать товар по этому заказу (выставлен счёт)"}
                              >
                                {busyId === d.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : d.isReserved ? (
                                  <><LockOpen size={13} /> Снять резерв</>
                                ) : (
                                  <><Lock size={13} /> Зарезервировать товар</>
                                )}
                              </button>
                              {d.isReserved && (
                                <span className="deal-reserve-hint">
                                  Товар зарезервирован — не уйдёт другим клиентам
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="admin-order__side">
                          <DealForm
                            products={pickerProducts}
                            counterparties={counterpartyOptions}
                            payments={payments}
                            deliveryPrice={deliveryPrice}
                            freeDeliveryThreshold={freeDeliveryThreshold}
                            reservedStockById={reservedTotalById}
                            tierDiscounts={tierDiscounts}
                            initialDeal={{
                              id: d.id,
                              date: d.date,
                              customerName: d.customerName,
                              customerPhone: d.customerPhone ?? null,
                              email: d.email ?? null,
                              inn: d.inn ?? null,
                              kpp: d.kpp ?? null,
                              address: d.address ?? null,
                              contactName: d.contactName ?? null,
                              comment: d.comment ?? null,
                              vatRate: d.vatRate,
                              hasDelivery: Boolean(d.hasDelivery),
                              deliveryType: d.deliveryType ?? null,
                              deliveryCost: d.deliveryCost ?? null,
                              deliveryAddress:
                                d.deliveryAddress ?? d.address ?? null,
                              deliveryPlannedDate: d.deliveryPlannedDate ?? null,
                              deliveryNote: d.deliveryNote ?? null,
                              deliveryContact: d.deliveryContact ?? d.contactName ?? null,
                              deliveryPhone: d.deliveryPhone ?? d.customerPhone ?? null,
                              // Способ оплаты берём из ПЛ: наличные, ЮМ или расчётный счёт.
                              paymentMethod: dealPaymentMethod.get(d.id) ?? "regular",
                              isReserved: Boolean(d.isReserved),
                              items: d.items.map((item) => {
                                const prod = productById.get(item.productId) as any;
                                const isCut = Boolean(prod?.isCuttable || (item as any).isCuttable);
                                const unit = isCut ? ((item as any).unit || 'roll') : 'piece';
                                const metersPerRoll = (item as any).metersPerRoll || prod?.cutMetersPerRoll || null;
                                const saleQty = (item as any).saleQuantity != null ? (item as any).saleQuantity : (unit === 'meter' && metersPerRoll ? Number(item.quantity) * Number(metersPerRoll) : Number(item.quantity));
                                return {
                                  productId: item.productId,
                                  name: item.name,
                                  sku: item.sku ?? null,
                                  quantity: saleQty,
                                  price: (item as any).salePrice != null ? (item as any).salePrice : item.price,
                                  stockQty: stockById.get(item.productId) ?? 0,
                                  isCuttable: Boolean(prod?.isCuttable),
                                  metersPerRoll: metersPerRoll,
                                  cutPricePerMeter: prod?.cutPricePerMeter || (item as any).salePrice || null,
                                  unit: unit as any,
                                  baseQty: Number(item.quantity) || 0,
                                };
                              }),
                            }}
                          />
                          <DealActions
                            dealId={d.id}
                            status={d.status}
                            hasShortage={hasShortage}
                            paidEnough={isFullyPaid}
                            dealItems={d.items.map((item) => ({
                              productId: item.productId,
                              name: item.name,
                              quantity: item.quantity,
                            }))}
                            shippedItems={Array.isArray(d.shippedItems) ? d.shippedItems : []}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="admin-empty"><p>В этом списке пока пусто</p></div>
            )}
          </div>
        </>
      )}

      {/* ============ ВКЛАДКА: ЗАРПЛАТЫ ============ */}
      {activeTab === "salaries" && (
        <>
          <div className="admin-filters admin-filters--sub" style={{ marginBottom: 14 }}>
            <SalaryTabsToggle />
          </div>
          <SalaryTabContent
            employees={employees}
            salaries={salaries}
          />
        </>
      )}

      {/* ============ ВКЛАДКА: ОТЧЁТЫ ============ */}
      {activeTab === "reports" && (
        <WarehouseReports
          adminPath={adminPath}
          payments={payments}
          salaries={salaries}
          deals={deals}
          receipts={receipts}
          transports={transports}
          cashCollections={cashCollections}
          stock={stock}
        />
      )}

      {/* ============ ВКЛАДКА: КОНТРАГЕНТЫ ============ */}
      {activeTab === "counterparties" && (
        <CounterpartiesManager
          initialCounterparties={counterpartyOptions}
          documents={counterpartyDocuments}
          tierDiscounts={tierDiscounts}
        />
      )}

      {/* ============ ВКЛАДКА: КЛИЕНТЫ ============ */}
      {activeTab === "clients" && <ClientsManager clients={clients} />}

      {/* ============ ВКЛАДКА: БАНК ============ */}
      {activeTab === "bank" && bankSummary && (
        <div className="bank">
          <div className="bank-hero">
            <div className="bank-hero__main">
              <div>
                <div className="bank-hero__label">
                  <CreditCard size={14} /> Безналичный расчет
                </div>
                <div className="bank-hero__value" style={{ color: '#fff', display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {fmt(bankSummary.bankBalance)} ₽
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    style={{ padding: "4px 6px", minWidth: 0, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff" }}
                    title="Калькулятор счёта — быстро прикинуть операции относительно расчётного счёта"
                    onClick={() => setShowCalculator(true)}
                  >
                    <Calculator size={14} />
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>ПКМ по ожидающим — выделение для прикидки</div>
              </div>

              {/* Касса и Карта ЮМ — на одной линии, по соседству, это по факту касса — кнопки на одном уровне */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, alignItems: "stretch" }} className="bank-hero__accounts-grid">
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div>
                    <div className="bank-hero__label">
                      <Banknote size={14} /> Касса (наличные)
                    </div>
                    <div
                      className="bank-hero__value"
                      style={{ color: bankSummary.cashBalanceNegative ? '#ef8f76' : '#fff' }}
                    >
                      {fmt(bankSummary.cashBalance)} ₽
                    </div>
                    <div className="cash-carryover-hero">
                      <span>
                        С прошлых дней: <b>{fmt(cashCarryover.previousDaysRemaining)} ₽</b>
                      </span>
                      <span>
                        На начало дня: <b>{fmt(cashCarryover.openingBalance)} ₽</b>
                      </span>
                      <span>
                        Сегодня: <b>{cashCarryover.todayIncoming - cashCarryover.todayOutgoing - cashCarryover.todayCardTransfers >= 0 ? "+" : ""}{fmt(cashCarryover.todayIncoming - cashCarryover.todayOutgoing - cashCarryover.todayCardTransfers)} ₽</b>
                      </span>
                    </div>
                    {bankSummary.cashBalanceNegative && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 6,
                          marginTop: 6,
                          fontSize: 12,
                          color: '#ef8f76',
                          maxWidth: 280,
                        }}
                      >
                        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span>
                          Касса в минусе: наличные расходы превысили доступный приход
                          и перенос прошлых дней. Сводку всё равно можно сохранить,
                          чтобы зафиксировать фактическое расхождение.
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: "auto", paddingTop: 10 }}>
                    <button
                      type="button"
                      className="admin-btn admin-btn--primary admin-btn--sm"
                      disabled={collecting}
                      onClick={handleCollectCash}
                    >
                      {collecting ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />}
                      Сводка кассы
                    </button>
                  </div>
                </div>

                <div style={{ borderLeft: "1px dashed rgba(255,255,255,0.12)", paddingLeft: 16, display: "flex", flexDirection: "column" }} className="bank-hero__ym-card">
                  <div>
                    <div className="bank-hero__label">
                      <CreditCard size={14} /> Карта ЮМ
                    </div>
                    <div className="bank-hero__value" style={{ color: '#e0b45a' }}>
                      {fmt(bankSummary.ymCardBalance)} ₽
                    </div>
                    <div className="cash-carryover-hero" style={{ marginTop: 6, flexWrap: "wrap" }}>
                      <span>Ожидаем +: <b>{fmt(bankSummary.ymExpectedIn)} ₽</b></span>
                      <span>К оплате −: <b>{fmt(bankSummary.ymExpectedOut)} ₽</b></span>
                      <span>Прогноз: <b>{fmt(bankSummary.ymForecast)} ₽</b></span>
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 6, lineHeight: 1.3 }}>
                      По факту касса: сюда приходят переводы из кассы. Отсюда — оплата, внесение, ЗП.
                    </div>
                  </div>
                  <div style={{ marginTop: "auto", paddingTop: 10 }}>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      style={{ background: "rgba(224,180,90,0.12)", border: "1px solid rgba(224,180,90,0.25)", color: "#e0b45a" }}
                      onClick={() => setBankSub("ym")}
                    >
                      <CreditCard size={13} /> Открыть карту ЮМ
                    </button>
                  </div>
                </div>
              </div>

              <div className="bank-hero__note" style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, lineHeight: 1.4, color: 'rgba(255,255,255,0.65)' }}>
                <div>Р/С: {fmt(bankSummary.bankBalance)} ₽ · +{fmt(bankSummary.expectedIn)} −{fmt(bankSummary.expectedOut)} = <b style={{ color: '#fff' }}>{fmt(bankSummary.bankForecast)} ₽</b></div>
                <div>Касса: {fmt(bankSummary.cashBalance)} ₽ · ЮМ: {fmt(bankSummary.ymCardBalance)} ₽ (прогн. {fmt(bankSummary.ymForecast)} ₽) · Аренда: {fmt((bankSummary as any).rentBalance || 0)} ₽ (к опл. {fmt((bankSummary as any).rentExpectedOut || 0)} ₽)</div>
                <div>Всего: {fmt(bankSummary.balance)} ₽ · прогноз {fmt(bankSummary.forecast)} ₽ · с арендой {fmt((bankSummary as any).forecastWithRent || bankSummary.forecast)} ₽</div>
              </div>
            </div>

            <div className="bank-hero__stats">
              <div className="bank-hero__stat" style={{ color: '#7dd181' }}>
                <ArrowDownLeft size={16} />
                <div>
                  <span style={{ color: 'rgba(125,209,129,0.7)', fontWeight: 700 }}>Должны нам (ожидаем, только р/с)</span>
                  <strong style={{ fontSize: 20 }}>+{fmt(bankSummary.expectedIn)} ₽</strong>
                </div>
              </div>

              <div className="bank-hero__stat" style={{ color: '#9de3a5' }}>
                <Wallet size={16} />
                <div>
                  <span style={{ color: 'rgba(157,227,165,0.72)', fontWeight: 700 }}>
                    Общий приход р/с (факт + будущие)
                  </span>
                  <strong style={{ color: '#fff', fontSize: 20 }}>
                    {fmt(bankSummary.bankIncomeTotal)} ₽
                  </strong>
                  <small style={{ display: 'block', marginTop: 2, color: 'rgba(245,242,234,0.55)', fontSize: 10 }}>
                    Только расчётный счёт: {fmt(bankSummary.bankBalance)} + {fmt(bankSummary.expectedIn)} · без налички и без карты ЮМ
                  </small>
                </div>
              </div>
              
              <div className="bank-hero__stat" style={{ color: '#ef8f76' }}>
                <ArrowUpRight size={16} />
                <div>
                  <span style={{ color: 'rgba(239,143,118,0.7)', fontWeight: 700 }}>Мы должны (к оплате, только р/с)</span>
                  <strong style={{ fontSize: 20 }}>−{fmt(bankSummary.expectedOut)} ₽</strong>
                </div>
              </div>

              <div className="bank-hero__stat" style={{ borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 12, marginTop: 4, color: '#e09b12' }}>
                <History size={16} />
                <div>
                  <span style={{ color: 'rgba(224,155,18,0.85)', fontWeight: 700 }}>Прогноз р/с после всех оплат</span>
                  <strong style={{ color: '#fff', fontSize: 18 }}>{fmt(bankSummary.bankForecast)} ₽</strong>
                  <small style={{ display: 'block', marginTop: 2, color: 'rgba(245,242,234,0.5)', fontSize: 10 }}>
                    {fmt(bankSummary.bankBalance)} + {fmt(bankSummary.expectedIn)} − {fmt(bankSummary.expectedOut)} · только расчётный счёт, без налички
                  </small>
                </div>
              </div>

              <div className="bank-hero__stat" style={{ borderTop: '1px dashed rgba(255,255,255,0.15)', paddingTop: 12, marginTop: 8, color: '#fff', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', width: '100%' }} className="bank-hero__forecast-grid">
                  <div style={{ flex: '1 1 120px' }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 600, letterSpacing: 0.3 }}>НАЛИЧКА</div>
                    <div style={{ fontSize: 14, marginTop: 2 }}>Касса: <b>{fmt(bankSummary.cashBalance)} ₽</b></div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>факт, не входит в прогноз р/с</div>
                  </div>
                  <div style={{ flex: '1 1 140px', borderLeft: '1px dashed rgba(255,255,255,0.12)', paddingLeft: 12 }}>
                    <div style={{ fontSize: 10, color: 'rgba(224,180,90,0.8)', fontWeight: 600, letterSpacing: 0.3 }}>БЕЗНАЛ · ПЕРЕВОДЫ</div>
                    <div style={{ fontSize: 12, marginTop: 2 }}>Карта ЮМ факт: <b style={{ color: '#e0b45a' }}>{fmt(bankSummary.ymCardBalance)} ₽</b></div>
                    <div style={{ fontSize: 11 }}>Прогноз ЮМ: <b style={{ color: '#e0b45a' }}>{fmt(bankSummary.ymForecast)} ₽</b></div>
                  </div>
                  <div style={{ flex: '1 1 120px', borderLeft: '1px dashed rgba(255,255,255,0.12)', paddingLeft: 12 }}>
                    <div style={{ fontSize: 10, color: 'rgba(147,197,253,0.85)', fontWeight: 600, letterSpacing: 0.3 }}>АРЕНДА (отдельный счёт)</div>
                    <div style={{ fontSize: 12, marginTop: 2 }}>Факт: <b style={{ color: '#93c5fd' }}>{fmt((bankSummary as any).rentBalance || 0)} ₽</b></div>
                    <div style={{ fontSize: 11 }}>К оплате: <b style={{ color: '#93c5fd' }}>{fmt((bankSummary as any).rentExpectedOut || 0)} ₽</b> · Прогноз: <b>{fmt((bankSummary as any).rentForecast || 0)} ₽</b></div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>Не списывает р/с, не входит в общий прогноз</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, marginTop: 4, width: '100%', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ background: 'rgba(255,255,255,0.08)', padding: '4px 8px', borderRadius: 6 }}>Р/С прогноз: <b>{fmt(bankSummary.bankForecast)} ₽</b></span>
                  <span style={{ background: 'rgba(125,209,129,0.12)', padding: '4px 8px', borderRadius: 6 }}>+ касса {fmt(bankSummary.cashBalance)} = <b>{fmt(bankSummary.bankForecast + bankSummary.cashBalance)} ₽</b></span>
                  <span style={{ background: 'rgba(224,180,90,0.12)', padding: '4px 8px', borderRadius: 6, color: '#e0b45a' }}>+ ЮМ {fmt(bankSummary.ymForecast)} = <b>{fmt(bankSummary.forecast)} ₽ всего</b></span>
                </div>
              </div>
            </div>
          </div>

          {collectError && <div className="wh-form-error" style={{ marginBottom: 12 }}>{collectError}</div>}

          {showCollect && (
            <CashCollectModal
              cashBalance={bankSummary.cashBalance}
              adminPath={adminPath}
              onClose={() => setShowCollect(false)}
            />
          )}

          {/* Непроведённые исходящие платежи поставщикам/получателям */}
          {bankSub !== "cash" && pendingSupplierPayments.length > 0 && (
            <div className="admin-card" style={{ border: "1px solid var(--adm-rust-line)", background: "var(--adm-rust-pale)", marginBottom: 16 }}>
              <div className="admin-card__head" style={{ background: "transparent", borderBottom: "1px solid var(--adm-rust-line)" }}>
                <h3 className="admin-card__title" style={{ color: "var(--adm-rust)" }}>
                  <AlertTriangle size={16} style={{ verticalAlign: "middle", marginRight: 8 }} />
                  Нужно оплатить поставщикам
                </h3>
                <span className="admin-badge admin-badge--red">
                  −{fmt(pendingSupplierPayments.reduce((sum, p) => sum + p.amount, 0))} ₽
                </span>
              </div>
              <div className="admin-card__pad">
                <div className="bank-month__list">
                  {pendingSupplierPayments.slice(0, 6).map((p) => (
                    <div
                      key={p.id}
                      className="bank-pay payment-clickable"
                      style={{ padding: "10px 14px" }}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a,button")) return;
                        setDetailPaymentId(p.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setDetailPaymentId(p.id);
                        }
                      }}
                    >
                      <div className="bank-pay__icon bank-pay__icon--out" style={{ width: 32, height: 32 }}>
                        <Truck size={15} />
                      </div>
                      <div className="bank-pay__main">
                        <div className="bank-pay__row1">
                          <span className="bank-pay__counterparty" style={{ fontSize: 13 }}>{p.counterparty}</span>
                          <span className="bank-pay__num">{p.invoiceNumber || `ПЛ-${p.number}`}</span>
                          <span className="bank-pay__wait">ожидается</span>
                        </div>
                        <div className="bank-pay__row2">
                          {p.receiptNumbers.length > 0 && (
                            <span className="bank-pay__links">
                              {p.receiptNumbers.map((n, idx) => (
                                <Link
                                  key={`alert-r${p.id}-${n}`}
                                  className="bank-pay__doc"
                                  href={`/${adminPath}/warehouse?tab=receipts&receipt=${p.receiptIds[idx] || ""}`}
                                  prefetch={false}
                                >
                                  ПО-{n}
                                </Link>
                              ))}
                            </span>
                          )}
                          <span className="bank-pay__date">{fmtDate(p.date)}</span>
                          {p.comment && <span className="bank-pay__comment">{p.comment}</span>}
                        </div>
                      </div>
                      <div className="bank-pay__side">
                        <span className="bank-pay__amount bank-pay__amount--out" style={{ fontSize: 16 }}>
                          −{fmt(p.amount)} ₽
                        </span>
                      </div>
                    </div>
                  ))}
                  {pendingSupplierPayments.length > 6 && (
                    <div className="admin-muted" style={{ fontSize: 12, padding: "0 4px" }}>
                      Ещё {pendingSupplierPayments.length - 6} платеж(а) в списке «Ожидают оплаты».
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Баланс по контрагентам (только с долгами) */}
          <div className="bank-due">
            <div className="bank-due__group">
              <div className="bank-due__title">
                Покупатели <span style={{ color: '#7dd181' }}>должны нам</span>
              </div>
              {counterpartiesWithDebt.filter((c) => c.type === "customer").length === 0 ? (
                <div className="bank-due__empty">Долгов нет</div>
              ) : (
                counterpartiesWithDebt
                  .filter((c) => c.type === "customer")
                  .map((c) => renderDueParty(c, "customer"))
              )}
            </div>

            <div className="bank-due__group">
              <div className="bank-due__title">
                Поставщики <span style={{ color: '#ef8f76' }}>мы должны</span>
              </div>
              {counterpartiesWithDebt.filter((c) => c.type === "supplier").length === 0 ? (
                <div className="bank-due__empty">Долгов нет</div>
              ) : (
                counterpartiesWithDebt
                  .filter((c) => c.type === "supplier")
                  .map((c) => renderDueParty(c, "supplier"))
              )}
            </div>
          </div>

          {/* Подсказка про ПКМ и выделенная сумма — отдельно от банка */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8, fontSize: 11, color: "var(--adm-muted)" }}>
            <span>ЛКМ по контрагенту — вычеркнуть целиком · стрелка — раскрыть платежи и вычеркнуть поштучно · ПКМ — выделить для прикидки (приход +, расход −)</span>
            {(selectedPaymentIds.size > 0 || selectedPartyKeys.size > 0) && (
              <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => { setSelectedPaymentIds(new Set()); setSelectedPartyKeys(new Set()); }}>Сбросить выделение</button>
            )}
            {(skippedParties.size > 0 || skippedPaymentIds.size > 0) && (
              <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => { setSkippedParties(new Set()); setSkippedPaymentIds(new Set()); }}>Вернуть вычеркнутые в расчёт</button>
            )}
          </div>
          {(selectedSum.count > 0) && (
            <div className="admin-card" style={{ marginTop: 8, border: "1px solid var(--adm-steel)", background: "rgba(63,111,163,0.07)", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--adm-muted)" }}>Выбрано (отдельно от банка) · {selectedSum.count} позиций · ПКМ по строкам</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: selectedSum.sum >= 0 ? "var(--adm-pine)" : "var(--adm-rust)" }}>{selectedSum.sum >= 0 ? "+" : ""}{fmt(Math.round(selectedSum.sum * 100) / 100)} ₽</div>
                <div style={{ fontSize: 10, color: "var(--adm-muted)" }}>Приход прибавляется, расход из правой колонки вычитается · прогноз баланса после этих операций: {fmt(Math.round((bankSummary.balance + selectedSum.sum) * 100) / 100)} ₽</div>
              </div>
              <button type="button" className="admin-btn admin-btn--ghost" onClick={() => { setSelectedPaymentIds(new Set()); setSelectedPartyKeys(new Set()); }}>Очистить</button>
            </div>
          )}

          {showCalculator && (
            <ModalPortal>
              <div className="admin-modal-overlay" onClick={() => setShowCalculator(false)}>
                <div className="admin-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
                  <div className="admin-modal__head">
                    <h3 className="admin-modal__title"><Calculator size={14} style={{ marginRight: 6 }} />Калькулятор счёта</h3>
                    <button type="button" className="admin-modal__close" onClick={() => setShowCalculator(false)}><X size={14} /></button>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--adm-muted)", marginBottom: 8 }}>
                    Расчётный счёт: <b>{fmt(bankSummary.bankBalance)} ₽</b> · Касса: <b>{fmt(bankSummary.cashBalance)} ₽</b> · Всего: <b>{fmt(bankSummary.balance)} ₽</b>
                  </div>
                  <div className="admin-field">
                    <label className="admin-label">Выражение</label>
                    <input className="admin-input" value={calcExpression} onChange={e => setCalcExpression(e.target.value)} placeholder="напр. 12500+3200*2  или  банк-5000" />
                    <div style={{ fontSize: 10, color: "var(--adm-muted)", marginTop: 4 }}>Поддерживаются + − * / ( ) и слова: банк, касса, всего · Enter = посчитать</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {[
                      ["+банк", () => setCalcExpression(v => (v ? v + "+" : "") + String(Math.round(bankSummary.bankBalance)))],
                      ["+касса", () => setCalcExpression(v => (v ? v + "+" : "") + String(Math.round(bankSummary.cashBalance)))],
                      ["Очистить", () => { setCalcExpression(""); setCalcResult(""); }],
                      ["Посчитать", () => {
                        try {
                          let expr = calcExpression.replace(/банк/g, String(bankSummary.bankBalance)).replace(/касса/g, String(bankSummary.cashBalance)).replace(/всего/g, String(bankSummary.balance)).replace(/[^0-9+\-*/(). ]/g, "");
                          if (!expr.trim()) { setCalcResult(""); return; }
                          // безопасный eval
                          const res = Function('"use strict";return (' + expr + ')')();
                          setCalcResult(String(Math.round(Number(res) * 100) / 100));
                        } catch { setCalcResult("ошибка"); }
                      }],
                    ].map(([label, fn]: any) => (
                      <button key={label} type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={fn}>{label}</button>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                    {["7","8","9","/","4","5","6","*","1","2","3","-","0",".","(",")"].map(ch => (
                      <button key={ch} type="button" className="admin-btn admin-btn--ghost" style={{ padding: "8px 0" }} onClick={() => setCalcExpression(v => v + ch)}>{ch}</button>
                    ))}
                    <button type="button" className="admin-btn admin-btn--ghost" style={{ padding: "8px 0" }} onClick={() => setCalcExpression(v => v + "+")}>+</button>
                    <button type="button" className="admin-btn admin-btn--primary" style={{ gridColumn: "span 3" }} onClick={() => {
                      try {
                        let expr = calcExpression.replace(/банк/g, String(bankSummary.bankBalance)).replace(/касса/g, String(bankSummary.cashBalance)).replace(/всего/g, String(bankSummary.balance)).replace(/[^0-9+\-*/(). ]/g, "");
                        if (!expr.trim()) { setCalcResult(""); return; }
                        const res = Function('"use strict";return (' + expr + ')')();
                        setCalcResult(String(Math.round(Number(res) * 100) / 100));
                      } catch { setCalcResult("ошибка"); }
                    }}>=</button>
                  </div>
                  {calcResult && (
                    <div style={{ marginTop: 10, padding: 10, background: "var(--adm-paper)", borderRadius: 8, border: "1px solid var(--adm-border)" }}>
                      <div style={{ fontSize: 11, color: "var(--adm-muted)" }}>Результат</div>
                      <div style={{ fontWeight: 800, fontSize: 18 }}>{calcResult} ₽</div>
                      <div style={{ fontSize: 11, color: "var(--adm-muted)", marginTop: 4 }}>
                        Баланс + результат: <b>{fmt(Math.round((bankSummary.balance + Number(calcResult || 0)) * 100) / 100)} ₽</b> · Банк + результат: <b>{fmt(Math.round((bankSummary.bankBalance + Number(calcResult || 0)) * 100) / 100)} ₽</b>
                      </div>
                    </div>
                  )}
                  <p style={{ fontSize: 10, color: "var(--adm-muted)", marginTop: 8 }}>Это не просто калькулятор: считает относительно счёта. Вставьте «банк» в выражение, чтобы быстро прикинуть новый остаток.</p>
                </div>
              </div>
            </ModalPortal>
          )}

          <div className="admin-filters admin-filters--sub" style={{ marginTop: 12 }}>
            <button
              onClick={() => setBankSub("pending")}
              className={`admin-filter${bankSub === "pending" ? " admin-filter--active" : ""}`}
            >
              <Wallet size={12} />
              Ожидают оплаты
            </button>
            <button
              onClick={() => setBankSub("history")}
              className={`admin-filter${bankSub === "history" ? " admin-filter--active" : ""}`}
            >
              <History size={12} />
              История (архив)
            </button>
            <button
              onClick={() => setBankSub("ym")}
              className={`admin-filter${bankSub === "ym" ? " admin-filter--active" : ""}`}
            >
              <CreditCard size={12} />
              Карта ЮМ · {fmt(bankSummary.ymCardBalance)} ₽
            </button>
            <button
              onClick={() => setBankSub("cash")}
              className={`admin-filter${bankSub === "cash" ? " admin-filter--active" : ""}`}
            >
              <Banknote size={12} />
              Касса
            </button>
            <button
              onClick={() => setBankSub("summary")}
              className={`admin-filter${bankSub === "summary" ? " admin-filter--active" : ""}`}
            >
              <BarChart3 size={12} />
              Финансовая сводка
            </button>
          </div>

          {bankSub === "summary" && (() => {
            const todayStr = getWarehouseBusinessDate(new Date());
            
            // Get period start date
            let periodStartStr = todayStr;
            let periodLabel = "Сегодня";
            
            if (financePeriod === "week") {
              periodLabel = "Эта неделя (с Пн)";
              const parts = todayStr.split("-").map(Number);
              const localToday = new Date(parts[0], parts[1] - 1, parts[2]);
              const dayOfWeek = localToday.getDay(); // 0 is Sunday, 1 is Monday
              const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
              const localMonday = new Date(localToday);
              localMonday.setDate(localToday.getDate() + diffToMonday);
              periodStartStr = `${localMonday.getFullYear()}-${String(localMonday.getMonth() + 1).padStart(2, "0")}-${String(localMonday.getDate()).padStart(2, "0")}`;
            } else if (financePeriod === "month") {
              periodLabel = "Этот месяц";
              const parts = todayStr.split("-").map(Number);
              periodStartStr = `${parts[0]}-${String(parts[1]).padStart(2, "0")}-01`;
            }

            // Calculations
            let periodIncoming = 0;
            let periodOutgoing = 0;

            for (const p of payments) {
              if (p.excludeFromBalance) continue;
              if (p.isPaid) {
                const pDate = String(p.date || "").slice(0, 10);
                if (pDate >= periodStartStr && pDate <= todayStr) {
                  if (p.direction === "incoming") {
                    periodIncoming += p.amount;
                  } else {
                    periodOutgoing += p.amount;
                  }
                }
              }
            }

            for (const s of salaries) {
              const bypassBalance = isSalaryExcludedFromBalance(s.comment);
              if (s.isPaid && !bypassBalance) {
                const sDate = String(s.paidAt || s.date || "").slice(0, 10);
                if (sDate >= periodStartStr && sDate <= todayStr) {
                  periodOutgoing += s.amount;
                }
              }
            }

            const periodNet = periodIncoming - periodOutgoing;

            return (
              <div style={{ marginTop: 12 }}>
                {/* Селектор периода */}
                <div className="admin-filters admin-filters--sub" style={{ marginBottom: 14 }}>
                  <button
                    onClick={() => setFinancePeriod("today")}
                    className={`admin-filter${financePeriod === "today" ? " admin-filter--active" : ""}`}
                  >
                    Сегодня
                  </button>
                  <button
                    onClick={() => setFinancePeriod("week")}
                    className={`admin-filter${financePeriod === "week" ? " admin-filter--active" : ""}`}
                  >
                    Неделя
                  </button>
                  <button
                    onClick={() => setFinancePeriod("month")}
                    className={`admin-filter${financePeriod === "month" ? " admin-filter--active" : ""}`}
                  >
                    Месяц
                  </button>
                </div>

                <div className="admin-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
                  {/* Левая колонка: Финансовые операции за период */}
                  <div className="admin-card" style={{ padding: 16 }}>
                    <div className="admin-card__head" style={{ borderBottom: "1px solid var(--adm-sand-pale)", paddingBottom: 10, marginBottom: 12 }}>
                      <h3 className="admin-card__title" style={{ fontSize: 14, fontWeight: 700 }}>
                        📊 Операции за период: <span style={{ color: "var(--adm-rust)" }}>{periodLabel}</span>
                      </h3>
                    </div>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                        <span style={{ color: "var(--adm-ink-soft)" }}>Продажи оплачено (Приход):</span>
                        <strong style={{ color: "var(--adm-pine)" }}>+{fmt(periodIncoming)} ₽</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                        <span style={{ color: "var(--adm-ink-soft)" }}>Поставщикам & ЗП оплачено (Расход):</span>
                        <strong style={{ color: "var(--adm-rust)" }}>−{fmt(periodOutgoing)} ₽</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, paddingTop: 10, borderTop: "1px dashed var(--adm-sand-pale)" }}>
                        <span style={{ fontWeight: 700 }}>Чистый итог:</span>
                        <strong style={{ fontSize: 15, color: periodNet >= 0 ? "var(--adm-pine)" : "var(--adm-rust)" }}>
                          {periodNet >= 0 ? "+" : ""}{fmt(periodNet)} ₽
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Правая колонка: Заметки и напоминания */}
                  <div className="admin-card" style={{ padding: 16 }}>
                    <div className="admin-card__head" style={{ borderBottom: "1px solid var(--adm-sand-pale)", paddingBottom: 10, marginBottom: 12 }}>
                      <h3 className="admin-card__title" style={{ fontSize: 14, fontWeight: 700 }}>
                        📝 Заметки и напоминания
                      </h3>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <textarea
                        className="admin-input"
                        style={{ width: "100%", height: "135px", resize: "vertical", fontSize: 13, background: "var(--adm-paper-warm)" }}
                        value={financeNotes}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFinanceNotes(val);
                          localStorage.setItem("sgt_finance_notes", val);
                        }}
                        placeholder="Запишите здесь напоминания, важные суммы, долги или любой другой рабочий текст..."
                      />
                      <span style={{ fontSize: 10, color: "var(--adm-sand)", textAlign: "right" }}>
                        💾 Сохраняется автоматически на этом устройстве
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {bankSub === "cash" ? (
            <>
            <div className="admin-card cash-carryover" style={{ marginTop: 12 }}>
              <div className="admin-card__head">
                <div>
                  <h3 className="admin-card__title">
                    <History size={16} style={{ verticalAlign: "middle", marginRight: 8 }} />
                    Перенос налички и источники остатка
                  </h3>
                  <div className="admin-muted" style={{ marginTop: 4, fontSize: 10 }}>
                    Наличка с прошлых дней автоматически входит в текущий баланс кассы.
                  </div>
                </div>
                <span className="admin-badge admin-badge--green">
                  С прошлых дней: {fmt(cashCarryover.previousDaysRemaining)} ₽
                </span>
              </div>
              <div className="cash-carryover__stats">
                <div><span>На начало дня</span><strong>{fmt(cashCarryover.openingBalance)} ₽</strong></div>
                <div><span>Приход сегодня</span><strong className="bank-totalbar__in">+{fmt(cashCarryover.todayIncoming)} ₽</strong></div>
                <div><span>Расход сегодня</span><strong className="bank-totalbar__out">−{fmt(cashCarryover.todayOutgoing + cashCarryover.todayCardTransfers)} ₽</strong></div>
                <div><span>Сейчас в кассе</span><strong>{fmt(cashCarryover.currentBalance)} ₽</strong></div>
              </div>
              {cashCarryover.origins.length > 0 ? (
                <div className="admin-table-wrap cash-carryover__origins">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Откуда поступило</th>
                        <th>Дата</th>
                        <th>Плательщик</th>
                        <th style={{ textAlign: "right" }}>Было</th>
                        <th style={{ textAlign: "right" }}>Осталось в кассе</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashCarryover.origins.map((origin) => (
                        <tr key={origin.paymentId}>
                          <td>
                            <Link
                              href={`/${adminPath}/warehouse?tab=bank&payment=${origin.paymentId}`}
                              prefetch={false}
                              className="stock-origin-link"
                            >
                              ПЛ-{origin.number} →
                            </Link>
                            {origin.date < cashCarryover.date && (
                              <span className="admin-badge admin-badge--muted" style={{ marginLeft: 6 }}>
                                с прошлых дней
                              </span>
                            )}
                          </td>
                          <td>{fmtDate(origin.date)}</td>
                          <td>{origin.counterparty}</td>
                          <td style={{ textAlign: "right" }}>{fmt(origin.originalAmount)} ₽</td>
                          <td style={{ textAlign: "right", fontWeight: 800, color: "var(--adm-pine)" }}>
                            {fmt(origin.remainingAmount)} ₽
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="admin-empty" style={{ padding: 18 }}>
                  <p>Остатка по наличным платежам нет</p>
                </div>
              )}
            </div>

            <div className="admin-card wh-cashcollect" style={{ marginTop: 12 }}>
              <div className="admin-card__head">
                <div>
                  <h3 className="admin-card__title">
                    <Banknote size={16} style={{ verticalAlign: "middle", marginRight: 8 }} />
                    Фактические сводки кассы и ЮМ
                  </h3>
                  <div className="admin-muted" style={{ marginTop: 3, fontSize: 10 }}>
                    Сводка не является платёжной операцией и не влияет на прибыль
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="admin-badge admin-badge--muted">
                    Наличная касса: {fmt(Math.round(bankSummary.cashBalance * 100) / 100)} ₽
                  </span>
                  <span className="admin-badge admin-badge--blue">
                    Карта ЮМ: {fmt(Math.round(bankSummary.ymCardBalance * 100) / 100)} ₽
                  </span>
                  <span className="admin-badge admin-badge--green">
                    <ArrowDownLeft size={10} /> Всего поступило: {fmt(Math.round(collectionsIncomeTotal * 100) / 100)} ₽
                  </span>
                  <span className="admin-badge admin-badge--blue">
                    <CreditCard size={10} /> На ЮМ: {fmt(Math.round(collectionsCardTotal * 100) / 100)} ₽
                  </span>
                  <span className="admin-badge admin-badge--red">
                    <ArrowUpRight size={10} /> Расходы всего: {fmt(Math.round(collectionsExpenseTotal * 100) / 100)} ₽
                  </span>
                  <span className="admin-badge admin-badge--blue">
                    <CreditCard size={10} /> Расходы с ЮМ: {fmt(Math.round(collectionsCardExpenseTotal * 100) / 100)} ₽
                  </span>
                </div>
              </div>
              <div className="admin-card__pad" style={{ display: "grid", gap: 12 }}>
                <div className="admin-muted" style={{ fontSize: 12 }}>
                  Наличная касса и карта ЮМ учитываются отдельно: по каждой видны поступления и расходы.
                  Перенос наличных не является прибылью, а сохранение ничего не переводит и не списывает.
                </div>
                {collectionsSorted.length === 0 ? (
                  <div className="admin-empty" style={{ padding: 18 }}>
                    <p>Сводок кассы пока нет</p>
                  </div>
                ) : (
                  <div className="admin-table-wrap" style={{ maxHeight: 560, overflow: "auto" }}>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Дата</th>
                          <th style={{ textAlign: "right" }}>Перенос</th>
                          <th style={{ textAlign: "right" }}>Поступления за день</th>
                          <th style={{ textAlign: "right" }}>Расходы</th>
                          <th style={{ textAlign: "right" }}>Остаток</th>
                          <th>Комментарий</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {collectionsSorted.map((collection) => {
                          const opening = Math.round(
                            (cashOpeningByCollectionId.get(collection.id) || 0) * 100
                          ) / 100;
                          const incomeBreakdown =
                            getCashCollectionIncomeBreakdown(collection);
                          const income = incomeBreakdown.total;
                          const cashIncome = incomeBreakdown.cash;
                          const cardIncome = incomeBreakdown.card;
                          const expenseBreakdown =
                            getCashCollectionExpenseBreakdown(collection);
                          const expense = expenseBreakdown.total;
                          const cashExpense = expenseBreakdown.cash;
                          const cardExpense = expenseBreakdown.card;
                          const closing = collection.cashAmount != null
                            ? Math.round(collection.cashAmount * 100) / 100
                            : Math.round((opening + cashIncome - cashExpense) * 100) / 100;
                          const items = collection.items || [];
                          const expenseRows = collection.expenses || [];
                          const noAccounting = items.some((item) => item.noAccounting);
                          const canOpen = items.length > 0 || expenseRows.length > 0;
                          const isOpen = openCollections.has(collection.id);
                          return (
                            <React.Fragment key={collection.id}>
                              <tr
                                className={canOpen ? "wh-cc-row" : undefined}
                                style={canOpen ? { cursor: "pointer" } : undefined}
                                onClick={canOpen ? () => setOpenCollections((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(collection.id)) next.delete(collection.id);
                                  else next.add(collection.id);
                                  return next;
                                }) : undefined}
                              >
                                <td>
                                  {canOpen && (
                                    <ChevronRight
                                      size={13}
                                      style={{
                                        verticalAlign: "middle",
                                        marginRight: 4,
                                        transform: isOpen ? "rotate(90deg)" : "none",
                                      }}
                                    />
                                  )}
                                  {fmtDate(collection.date)}
                                  {noAccounting && (
                                    <span className="admin-badge admin-badge--amber" style={{ marginLeft: 6 }}>
                                      старое закрытие
                                    </span>
                                  )}
                                </td>
                                <td style={{ textAlign: "right", color: "var(--adm-steel)" }}>
                                  +{fmt(opening)} ₽
                                  <small style={{ display: "block", color: "var(--adm-muted)" }}>не прибыль</small>
                                </td>
                                <td style={{ textAlign: "right", color: "var(--adm-pine)", fontWeight: 700 }}>
                                  +{fmt(income)} ₽
                                  <small style={{ display: "block", color: "var(--adm-muted)", fontWeight: 500 }}>
                                    нал {fmt(cashIncome)} · ЮМ {fmt(cardIncome)}
                                  </small>
                                </td>
                                <td style={{ textAlign: "right", color: "var(--adm-rust)", fontWeight: 700 }}>
                                  −{fmt(expense)} ₽
                                  <small style={{ display: "block", color: "var(--adm-muted)", fontWeight: 500 }}>
                                    нал {fmt(cashExpense)} · ЮМ {fmt(cardExpense)}
                                  </small>
                                </td>
                                <td style={{ textAlign: "right", fontWeight: 800 }}>{fmt(closing)} ₽</td>
                                <td>{collection.note || "—"}</td>
                                <td onClick={(event) => event.stopPropagation()}>
                                  <button
                                    type="button"
                                    className="admin-btn admin-btn--ghost admin-btn--sm"
                                    disabled={collecting}
                                    onClick={() => handleDeleteCollection(collection.id, noAccounting)}
                                  >
                                    <RotateCcw size={12} /> Отменить
                                  </button>
                                </td>
                              </tr>
                              {isOpen && (
                                <tr className="wh-cc-detail-row">
                                  <td colSpan={7}>
                                    <div className="wh-cc-detail-grid">
                                      <div className="wh-cc-box">
                                        <div className="wh-cc-box__head">
                                          <ArrowDownLeft size={13} /> Поступления за день
                                          <b style={{ color: "var(--adm-pine)" }}>+{fmt(income)} ₽</b>
                                        </div>
                                        {items.length === 0 ? (
                                          <div className="wh-cc-empty">Поступлений не было</div>
                                        ) : items.map((item) => {
                                          const itemAmount = Number(item.amount) || 0;
                                          const itemCard = Math.max(
                                            0,
                                            Number(
                                              item.cardAmount != null
                                                ? item.cardAmount
                                                : item.kind === "card"
                                                  ? itemAmount
                                                  : 0
                                            ) || 0
                                          );
                                          const hasCard = itemCard > 0.009;
                                          const hasCash = itemAmount - itemCard > 0.009;
                                          return (
                                            <div key={`${collection.id}-${item.paymentId}`} className="wh-cc-line">
                                              <span>
                                                ПЛ-{item.number || "—"} · {item.counterparty || ""}
                                                <em className={`cashc-kind cashc-kind--${hasCard && !hasCash ? "card" : "cash"}`} style={{ marginLeft: 6 }}>
                                                  {hasCard && hasCash ? "Нал + ЮМ" : hasCard ? "Карта ЮМ" : "Наличные"}
                                                </em>
                                              </span>
                                              <span className="wh-cc-line__val">+{fmt(itemAmount)} ₽</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <div className="wh-cc-box">
                                        <div className="wh-cc-box__head">
                                          <ArrowUpRight size={13} /> Расходы за день
                                          <b style={{ color: "var(--adm-rust)" }}>−{fmt(expense)} ₽</b>
                                        </div>
                                        {expenseRows.length === 0 ? (
                                          <div className="wh-cc-empty">Расходов не было</div>
                                        ) : expenseRows.map((row, index) => {
                                          const isCardExpense = row.sourceKind === "card";
                                          return (
                                            <div key={`${collection.id}-expense-${index}`} className="wh-cc-line">
                                              <span>
                                                {row.title}{row.comment ? ` · ${row.comment}` : ""}
                                                <em className={`cashc-kind cashc-kind--${isCardExpense ? "card" : "cash"}`} style={{ marginLeft: 6 }}>
                                                  {isCardExpense ? "Карта ЮМ" : "Наличные"}
                                                </em>
                                              </span>
                                              <span className="wh-cc-line__val" style={{ color: isCardExpense ? "var(--adm-steel)" : "var(--adm-rust)" }}>
                                                −{fmt(row.amount)} ₽
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <div className="wh-cc-box">
                                        <div className="wh-cc-box__head">Разбивка двух касс</div>
                                        <div className="wh-cc-line"><span><History size={11} /> Перенос наличных</span><b>+{fmt(opening)} ₽</b></div>
                                        <div className="wh-cc-line"><span><Banknote size={11} /> Поступило наличными</span><b>+{fmt(cashIncome)} ₽</b></div>
                                        <div className="wh-cc-line"><span><ArrowUpRight size={11} /> Расходы наличными</span><b>−{fmt(cashExpense)} ₽</b></div>
                                        <div className="wh-cc-line"><span><CreditCard size={11} /> Поступило на ЮМ</span><b style={{ color: "var(--adm-steel)" }}>+{fmt(cardIncome)} ₽</b></div>
                                        <div className="wh-cc-line"><span><CreditCard size={11} /> Расходы с ЮМ</span><b style={{ color: "var(--adm-steel)" }}>−{fmt(cardExpense)} ₽</b></div>
                                        <div className="wh-cc-total">Остаток наличных: <b>{fmt(closing)} ₽</b></div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                        <tr className="wh-cashcollect__total">
                          <td style={{ fontWeight: 800 }}>Итого за период</td>
                          <td />
                          <td style={{ textAlign: "right", color: "var(--adm-pine)", fontWeight: 800 }}>
                            +{fmt(Math.round(collectionsIncomeTotal * 100) / 100)} ₽
                          </td>
                          <td style={{ textAlign: "right", color: "var(--adm-rust)", fontWeight: 800 }}>
                            −{fmt(Math.round(collectionsExpenseTotal * 100) / 100)} ₽
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 800 }}>
                            {fmt(Math.round(bankSummary.cashBalance * 100) / 100)} ₽
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            </>
          ) : (
            <>
          {bankSub === "history" && legacyCashClosures.length > 0 && (
            <div className="admin-card bank-cash-postings">
              <div className="admin-card__head">
                <div>
                  <h3 className="admin-card__title">
                    <Archive size={15} style={{ verticalAlign: "middle", marginRight: 7 }} />
                    Старые проведения кассы
                  </h3>
                  <div className="admin-muted" style={{ marginTop: 3, fontSize: 10 }}>
                    Только платежи, закрытые до появления фактических сводок
                  </div>
                </div>
                <span className="admin-badge admin-badge--muted">
                  {legacyCashClosures.length} док.
                </span>
              </div>
              <div className="bank-cash-postings__list">
                {legacyCashClosures.map((closure) => (
                  <div key={closure.id} className="bank-cash-posting bank-cash-posting--legacy">
                    <span className="bank-cash-posting__icon"><Archive size={15} /></span>
                    <div className="bank-cash-posting__main">
                      <div className="bank-cash-posting__top">
                        <strong>Сдача кассы без перевода · старое проведение</strong>
                        <span className="admin-badge admin-badge--green">проведено</span>
                        <span className="admin-badge admin-badge--amber">вне баланса</span>
                      </div>
                      <div className="bank-cash-posting__meta">
                        <span>{fmtDateTime(closure.date)}</span>
                        <span>{closure.paymentIds.length} платежей</span>
                        <span>ПЛ-{closure.numbers.join(", ПЛ-")}</span>
                      </div>
                    </div>
                    <strong className="bank-cash-posting__amount">{fmt(closure.amount)} ₽</strong>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      disabled={collecting}
                      onClick={() =>
                        handleRestoreLegacyClosure(
                          closure.paymentIds,
                          closure.amount
                        )
                      }
                    >
                      <RotateCcw size={12} /> Отменить проведение
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="bank-toolbar">
            <div className="bank-toolbar__search" style={{ position: "relative" }}>
              <Search
                size={16}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--adm-sand)",
                }}
              />
              <input
                type="text"
                value={bq}
                onChange={(e) => setBq(e.target.value)}
                placeholder="Поиск: контрагент, комментарий..."
                className="admin-input"
                style={{ paddingLeft: 36 }}
              />
            </div>
            <select
              className="admin-select bank-toolbar__select"
              value={bdir}
              onChange={(e) => setBdir(e.target.value)}
            >
              <option value="all">Все операции</option>
              <option value="incoming">Только приход</option>
              <option value="outgoing">Только расход</option>
            </select>
            <label className="bank-toolbar__date">
              <span>Дата от</span>
              <input
                type="date"
                className="admin-input"
                value={bankDateFrom}
                max={bankDateTo || undefined}
                onChange={(e) => setBankDateFrom(e.target.value)}
              />
            </label>
            <label className="bank-toolbar__date">
              <span>Дата до</span>
              <input
                type="date"
                className="admin-input"
                value={bankDateTo}
                min={bankDateFrom || undefined}
                onChange={(e) => setBankDateTo(e.target.value)}
              />
            </label>
            <button
              onClick={() => setBsort(bsort === "asc" ? "desc" : "asc")}
              className="admin-btn admin-btn--ghost"
            >
              {bsort === "desc" ? (
                <ArrowDownWideNarrow size={14} />
              ) : (
                <ArrowUpNarrowWide size={14} />
              )}
            </button>
            {(bq || bdir !== "all" || bankDateFrom || bankDateTo) && (
              <button
                onClick={() => {
                  setBq("");
                  setBdir("all");
                  setBankDateFrom("");
                  setBankDateTo("");
                }}
                className="admin-btn admin-btn--ghost"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="bank-period-presets">
            <span>Быстрый период:</span>
            <button
              type="button"
              onClick={() => {
                const today = localDateIso();
                setBankDateFrom(today);
                setBankDateTo(today);
              }}
            >
              Сегодня
            </button>
            <button
              type="button"
              onClick={() => {
                const range = calendarMonthRange();
                setBankDateFrom(range.from);
                setBankDateTo(localDateIso());
              }}
            >
              Этот месяц
            </button>
            <button
              type="button"
              onClick={() => {
                const range = calendarMonthRange(-1);
                setBankDateFrom(range.from);
                setBankDateTo(range.to);
              }}
            >
              Прошлый месяц
            </button>
            <button
              type="button"
              onClick={() => {
                setBankDateFrom("");
                setBankDateTo("");
              }}
            >
              Весь период
            </button>
          </div>

          <div className="bank-totalbar">
            Найдено: <strong>{bankList.length}</strong>
            <span className="bank-totalbar__sep" />
            Приход: <strong className="bank-totalbar__in">+{fmt(bankFilteredTotals.inSum)} ₽</strong>
            Расход: <strong className="bank-totalbar__out">−{fmt(bankFilteredTotals.outSum)} ₽</strong>
          </div>

          {bankSub === "history" && bankHistoryDayGroups.length > 0 && (
            <div className="bank-totalbar" style={{ justifyContent: "space-between" }}>
              <span>
                Дни в архиве: <strong>{bankHistoryDayGroups.length}</strong> · страница{" "}
                <strong>{Math.min(historyDaysPage + 1, historyDaysTotalPages)}</strong> из <strong>{historyDaysTotalPages}</strong>
              </span>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  disabled={historyDaysPage <= 0}
                  onClick={() => setHistoryDaysPage((p) => Math.max(0, p - 1))}
                >
                  ← Новее
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  disabled={historyDaysPage >= historyDaysTotalPages - 1}
                  onClick={() =>
                    setHistoryDaysPage((p) => Math.min(historyDaysTotalPages - 1, p + 1))
                  }
                >
                  Старее →
                </button>
              </span>
            </div>
          )}

          {visibleBankGroups.map((g) => (
            <div key={g.key} className="bank-month">
              <div className="bank-month__label">
                {g.label}
                <span className="bank-month__line" />
              </div>
              <div className="bank-month__list">
                {g.items.map((p) => {
                  const isPendingPayment = p.entryKind === "payment" && !p.isPaid;
                  const isSelected = isPendingPayment && selectedPaymentIds.has(p.id);
                  return (
                  <div
                    key={p.id}
                    id={`payment-${p.id}`}
                    className={`bank-pay${!p.isPaid ? " bank-pay--pending" : ""}${p.entryKind === "payment" ? " payment-clickable" : ""}${isSelected ? " bank-pay--selected" : ""} ${p.direction === "incoming" ? "bank-pay--incoming" : "bank-pay--outgoing"}`}
                    role={p.entryKind === "payment" ? "button" : undefined}
                    tabIndex={p.entryKind === "payment" ? 0 : undefined}
                    onClick={(event) => {
                      if (p.entryKind !== "payment") return;
                      if ((event.target as HTMLElement).closest("a,button,input,label,select")) return;
                      setDetailPaymentId(p.id);
                    }}
                    onContextMenu={(event) => {
                      if (!isPendingPayment) return;
                      event.preventDefault();
                      toggleSelectedPayment(p.id);
                    }}
                    title={isPendingPayment ? (isSelected ? "ПКМ — снять выделение" : "ПКМ — выделить для прикидки (приход + / расход −)") : undefined}
                    onKeyDown={(event) => {
                      if (p.entryKind === "payment" && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        setDetailPaymentId(p.id);
                      }
                    }}
                  >
                    <div
                      className={`bank-pay__icon ${
                        p.direction === "incoming"
                          ? "bank-pay__icon--in"
                          : "bank-pay__icon--out"
                      }`}
                    >
                      {p.direction === "incoming" ? (
                        <ArrowDownLeft size={17} />
                      ) : (
                        <ArrowUpRight size={17} />
                      )}
                    </div>
                    <div className="bank-pay__main">
                      <div className="bank-pay__row1">
                        <span className="bank-pay__counterparty">
                          {p.entryKind === "salary" && (
                            <span className="admin-badge admin-badge--amber" style={{ marginRight: 8, textTransform: "none", fontWeight: 700 }}>
                              ЗП
                            </span>
                          )}
                          {p.entryKind === "payment" && p.type && p.type !== "regular" && (
                            <span
                              className="admin-badge admin-badge--muted"
                              style={{
                                marginRight: 8,
                                textTransform: "none",
                                fontWeight: 600,
                              }}
                            >
                              {paymentTypeLabels[p.type] || p.type}
                            </span>
                          )}
                          {p.entryKind === "salary" ? `Зарплата: ${p.counterparty}` : p.counterparty}
                        </span>
                        <span className="bank-pay__num">
                          {p.entryKind === "salary" ? `ЗП-${p.salary.id.slice(0, 6)}` : (p.invoiceNumber || `ПЛ-${p.number}`)}
                        </span>
                        {p.entryKind === "salary" && isDebtSalaryComment(p.salary.comment) && (
                          <span
                            className="admin-badge admin-badge--amber"
                            title="Списывает отдельный долг сотруднику и не входит в факт зарплаты месяца"
                          >
                            в счёт долга
                          </span>
                        )}
                        {p.entryKind === "payment" && p.invoiceNumber && (
                          <span
                            className="admin-badge admin-badge--muted"
                            style={{
                              fontSize: 9,
                              textTransform: "none",
                              marginLeft: 6,
                            }}
                          >
                            внутр. ПЛ-{p.number}
                          </span>
                        )}
                        {!p.isPaid && (
                          <span className="bank-pay__wait">ожидается</span>
                        )}
                        {p.excludeFromBalance && (
                          <span
                            className="admin-badge admin-badge--muted"
                            style={{ marginLeft: 6 }}
                            title={
                              p.entryKind === "salary"
                                ? "Историческая зарплата: показывается в архиве, но не влияет на текущий банк/кассу"
                                : "Платёж закрывает документ, но не влияет на текущий банк/кассу"
                            }
                          >
                            вне баланса
                          </span>
                        )}
                      </div>
                      <div className="bank-pay__row2">
                        {p.entryKind === "payment" && (p.dealNumbers.length > 0 ||
                          p.receiptNumbers.length > 0) && (
                          <span className="bank-pay__links">
                            {p.dealNumbers.map((n, idx) => (
                              <Link
                                key={`d${n}`}
                                className="bank-pay__doc"
                                href={`/${adminPath}/warehouse?tab=deals&deal=${p.dealIds[idx] || ""}`}
                                prefetch={false}
                              >
                                ЗК-{n}
                              </Link>
                            ))}
                            {p.receiptNumbers.map((n, idx) => (
                              <Link
                                key={`r${n}`}
                                className="bank-pay__doc"
                                href={`/${adminPath}/warehouse?tab=receipts&receipt=${p.receiptIds[idx] || ""}`}
                                prefetch={false}
                              >
                                ПО-{n}
                              </Link>
                            ))}
                          </span>
                        )}
                        <span className="bank-pay__date">{fmtDate(p.date)}</span>
                        {p.entryKind === "payment" ? (
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: "var(--adm-pine)",
                            }}
                          >
                            В т.ч. НДС {p.vatRate}%: {fmt(p.vatAmount)} ₽
                          </div>
                        ) : (
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--adm-kraft)" }}>
                            {isDebtSalaryComment(p.salary.comment)
                              ? "Выплата в счёт отдельного долга · не входит в факт месяца"
                              : `Зарплата за ${monthLabel(p.salary.periodMonth || p.salary.date.slice(0, 7))}`} · {p.source === "cash" ? "касса" : "банк"} · {p.isPaid ? "архив" : "к выплате"}
                          </div>
                        )}
                        {p.comment && (
                          <span className="bank-pay__comment">{p.comment}</span>
                        )}
                      </div>
                    </div>
                    <div className="bank-pay__side">
                      <span
                        className={`bank-pay__amount ${
                          p.direction === "incoming" ? "+" : "−"
                        }`}
                      >
                        {p.direction === "incoming" ? "+" : "−"}
                        {fmt(p.amount)} ₽
                      </span>
                      {p.entryKind === "payment" ? (
                        <PaymentControls
                          paymentId={p.id}
                          isPaid={p.isPaid}
                          excludeFromBalance={p.excludeFromBalance}
                          deals={dealLinkOptions}
                          receipts={receiptLinkOptions}
                          counterparties={counterpartyOptions}
                          edit={{
                            date: p.date,
                            type: p.type,
                            cashDestination: p.cashDestination,
                            counterparty: p.counterparty,
                            amount: p.amount,
                            invoiceNumber: p.invoiceNumber ?? null,
                            comment: p.comment ?? null,
                            dealIds: p.dealIds,
                            receiptIds: p.receiptIds,
                            direction: p.direction,
                          }}
                        />
                      ) : (
                        <button className="admin-status__btn admin-status__btn--outline" type="button" onClick={() => setActiveTab("salaries")}>
                          Открыть ЗП
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Вкладки внутри раздела «Зарплаты»: обычный учёт + автор расчёт ───
function SalaryTabsToggle() {
  const [sub, setSub] = useState<string>(() => {
    if (typeof window === "undefined") return "regular";
    return new URLSearchParams(window.location.search).get("salary") || "regular";
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (sub === "regular") url.searchParams.delete("salary");
    else url.searchParams.set("salary", sub);
    window.history.replaceState({}, "", url.toString());
    // Переключение видимости через событие storage не требуется — используем
    // кастомное событие, чтобы оба компонента синхронно перерисовались.
    window.dispatchEvent(new CustomEvent("salary-sub-changed", { detail: sub }));
  }, [sub]);
  useEffect(() => {
    const onCustom = (e: Event) => {
      const v = (e as CustomEvent<string>).detail;
      if (v && v !== sub) setSub(v);
    };
    window.addEventListener("salary-sub-changed", onCustom as EventListener);
    return () => window.removeEventListener("salary-sub-changed", onCustom as EventListener);
  }, [sub]);
  return (
    <>
      <button
        type="button"
        className={`admin-filter${sub === "regular" ? " admin-filter--active" : ""}`}
        onClick={() => setSub("regular")}
      >
        <Banknote size={12} /> Зарплаты (ведомости)
      </button>
      <button
        type="button"
        className={`admin-filter${sub === "auto" ? " admin-filter--active" : ""}`}
        onClick={() => setSub("auto")}
      >
        Авторасчёт по дням
      </button>
    </>
  );
}

function SalaryTabContent({
  employees,
  salaries,
}: {
  employees: Employee[];
  salaries: Salary[];
}) {
  const [sub, setSub] = useState<string>(() => {
    if (typeof window === "undefined") return "regular";
    return new URLSearchParams(window.location.search).get("salary") || "regular";
  });
  useEffect(() => {
    const onCustom = (e: Event) => {
      const v = (e as CustomEvent<string>).detail;
      if (v) setSub(v);
    };
    window.addEventListener("salary-sub-changed", onCustom as EventListener);
    return () => window.removeEventListener("salary-sub-changed", onCustom as EventListener);
  }, []);
  if (sub === "auto") {
    return <SalaryAutoDistribute />;
  }
  return <WarehouseSalaries employees={employees} salaries={salaries} />;
}

export default WarehouseManager;
