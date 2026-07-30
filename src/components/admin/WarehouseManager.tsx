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
  Plus,
  Send,
  Loader2,
  Save,
  Gift,
  Trash2,
  ChevronRight,
  RotateCcw,
  BarChart3,
} from "lucide-react";
import {
  type BankPayment,
  getBankSummary,
  getPendingPaymentCounterpartyBalances,
  getCollectedBreakdown,
  getDealPaidMap,
  getReceiptPaidMap,
  getCashCarryoverSummary,
  type WarehouseStockRow,
  type ProductStockSummary,
  type WarehouseReceipt,
  type CustomerDeal,
  type Counterparty,
  type Employee,
  type Salary,
  type CashCollection,
  includedVat,
  VAT_RATE,
  isSalaryExcludedFromBalance,
  isDebtSalaryComment,
  stripSalaryMetaTags,
  getWarehouseBusinessDate,
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
import { ProductStockSummaryPanel } from "@/components/admin/WarehouseStockSummary";
import { PaymentDetailsModal } from "@/components/admin/PaymentDetailsModal";
import { StockRevision } from "@/components/admin/StockRevision";
import { CashCollectModal } from "@/components/admin/CashCollectModal";
import {
  CounterpartiesManager,
  type CounterpartyDocument,
  type CounterpartyOption,
} from "@/components/admin/WarehouseCounterparties";
import { WarehouseSalaries } from "@/components/admin/WarehouseSalaries";
import { WarehouseReports } from "@/components/admin/WarehouseReports";
import { ClientsManager } from "@/components/admin/ClientsManager";
import { TransportManager, type TransportDeal, type TransportRow, type DriverOption } from "@/components/admin/TransportManager";

const fmt = (n: number) => n.toLocaleString("ru-RU");

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
};

type TabKey = "stock" | "receipts" | "deals" | "bank" | "salaries" | "counterparties" | "clients" | "suppliers" | "deliveries" | "reports";
type StockSub = "stock" | "receipts" | "archive";
type SuppliesSub = "receipts" | "suppliers";
type ReceiptSub = "active" | "archive";
type DealsSub = "new" | "released";
type BankSub = "summary" | "pending" | "history" | "cash";
type ProcurementCartItem = { productId: string; supplierId: string; quantity: number; price: number; vatRate: number };
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
      source: "cash" | "bank";
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
  companyPhone?: string;
  companyAddress?: string;
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
  companyPhone,
  companyAddress,
}: WarehouseManagerProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [stockSub, setStockSub] = useState<string>(initialSub);
  
  // --- States for Financial Summary (Feature 1) ---
  const [financePeriod, setFinancePeriod] = useState<"today" | "week" | "month">("today");

  // --- States for Critical Stock Alerts (Feature 2) ---
  const [attentionCategory, setAttentionCategory] = useState<"outofstock" | "lowstock" | "popular" | "stagnant">("outofstock");
  const [orderingProduct, setOrderingProduct] = useState<WarehouseStockRow | null>(null);
  const [orderSupplierId, setOrderSupplierId] = useState("");
  const [orderSupplierName, setOrderSupplierName] = useState("");
  const [orderPrice, setOrderPrice] = useState<number>(0);
  const [orderQty, setOrderQty] = useState<number>(10);
  const [orderComment, setOrderComment] = useState("Автозаказ из уведомлений о критичных остатках");
  const [orderVat, setOrderVat] = useState<number>(22);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [suppliesSub, setSuppliesSub] = useState<SuppliesSub>("receipts");
  const [receiptSub, setReceiptSub] = useState<ReceiptSub>("active");
  const [dealsSub, setDealsSub] = useState<DealsSub>("new");
  const [expandedDealId, setExpandedDealId] = useState<string | null>(focusDealId ?? null);
  /** Раскрытые расширенные сводки в таблице склада. */
  const [expandedStockIds, setExpandedStockIds] = useState<Set<string>>(
    () => new Set(focusProductId ? [focusProductId] : [])
  );
  const [stockSummaries, setStockSummaries] = useState<Record<string, ProductStockSummary>>({});
  const [stockSummaryLoading, setStockSummaryLoading] = useState<Set<string>>(new Set());
  const [stockSummaryErrors, setStockSummaryErrors] = useState<Record<string, string>>({});
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [procurementQuery, setProcurementQuery] = useState("");
  const [supplierPriceQuery, setSupplierPriceQuery] = useState("");
  const [supplierPriceDrafts, setSupplierPriceDrafts] = useState<Record<string, string>>({});
  const [supplierPriceSaving, setSupplierPriceSaving] = useState(false);
  const [procurementCart, setProcurementCart] = useState<ProcurementCartItem[]>([]);
  const [procurementSaving, setProcurementSaving] = useState(false);
  const [bankSub, setBankSub] = useState<BankSub>("summary");
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

  // Filters
  const [q, setQ] = useState(""); // Stock/Deals query
  const [bq, setBq] = useState(""); // Bank query
  const [rq, setRq] = useState(""); // Receipts query (поставщик/номер/товар)
  const [bdir, setBdir] = useState("all");
  const [bankDateFrom, setBankDateFrom] = useState("");
  const [bankDateTo, setBankDateTo] = useState("");
  const [bsort, setBsort] = useState<"asc" | "desc">("desc");
  const [historyDaysPage, setHistoryDaysPage] = useState(0);

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
  // Способ оплаты заказа: dealId → "cash" | "regular".
  // Определяем по привязанным входящим платежам — отдельного поля
  // у заказа нет, а форме редактирования способ нужен, чтобы наличная
  // оплата при сохранении не превращалась в неоплаченный счёт.
  const dealPaymentMethod = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of payments) {
      if (p.direction !== "incoming" || p.type !== "cash") continue;
      for (const dealId of p.dealIds || []) map.set(dealId, "cash");
    }
    return map;
  }, [payments]);
  const bankSummary = useMemo(
    () => getBankSummary(payments, salaries, cashCollections),
    [payments, salaries, cashCollections]
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

  // --- Helper to find last supplier and price for critical stock alerts (Feature 2) ---
  const findLastSupplierAndPrice = (productId: string) => {
    let lastSupplierName = "";
    let lastSupplierId = "";
    let lastPrice = 0;
    let lastDate = "";

    // 1. Search in receipts
    for (const r of receipts) {
      const item = r.items?.find((it) => it.productId === productId);
      if (item) {
        if (!lastDate || r.date > lastDate) {
          lastDate = r.date;
          lastSupplierName = r.supplier;
          lastSupplierId = r.counterpartyId || "";
          lastPrice = item.price;
        }
      }
    }

    // 2. Search in supplierPrices of counterparties
    if (!lastSupplierName) {
      for (const cp of counterpartyOptions) {
        if (cp.supplierPrices && cp.supplierPrices[productId] !== undefined) {
          lastSupplierName = cp.name;
          lastSupplierId = cp.id;
          lastPrice = cp.supplierPrices[productId];
          break;
        }
      }
    }

    return { supplierName: lastSupplierName, supplierId: lastSupplierId, price: lastPrice };
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
  }, [stock, deals, counterpartyOptions, receipts]);

  // Autopopulate order supplier and price when ordering product changes
  useEffect(() => {
    if (orderingProduct) {
      const info = findLastSupplierAndPrice(orderingProduct.id);
      setOrderSupplierName(info.supplierName);
      setOrderSupplierId(info.supplierId);
      setOrderPrice(info.price || orderingProduct.priceWholesale || 0);
      setOrderQty(10); // Default to a standard 10 units
      setOrderError("");
    }
  }, [orderingProduct]);
  
  const allCounterparties = useMemo(
    () => getPendingPaymentCounterpartyBalances(payments),
    [payments]
  );

  // Filter counterparties to only show those with positive debt (what is owed)
  const counterpartiesWithDebt = useMemo(
    () => allCounterparties.filter((c) => c.balance > 0.009),
    [allCounterparties]
  );

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

    return payments
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
  }, [deals, payments, receipts]);

  // Закрытые смены кассы — инкассация на карту и перенос наличного остатка.
  const collectionsSorted = useMemo(
    () =>
      [...cashCollections]
        .filter((c) => c && typeof c.amount === "number")
        .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    [cashCollections]
  );
  const collectionsTotal = useMemo(
    () => collectionsSorted.reduce((sum, c) => sum + (c.amount || 0), 0),
    [collectionsSorted]
  );
  // Раскладка смен: сколько перенесено наличными, сколько ушло на карту.
  const collectedBreakdown = useMemo(
    () => getCollectedBreakdown(collectionsSorted),
    [collectionsSorted]
  );

  // Старая версия «закрыть без инкассации» не создавала документ сдачи,
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

  // Сдача кассы идёт через модалку: там каждый платёж помечается
  // «наличные / перевод», чтобы в отчёте было видно, сколько куда ушло.
  function handleCollectCash() {
    if (bankSummary.cashBalance <= 0.009) {
      setCollectError("Касса пуста — нечего сдавать");
      return;
    }
    setCollectError("");
    setShowCollect(true);
  }

  async function handleRestoreLegacyClosure(paymentIds: string[], amount: number) {
    if (
      !confirm(
        `Отменить проведение старой сдачи без инкассации на ${fmt(amount)} ₽?\n\n` +
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
      ? "Вернуть скрытые старые платежи в список сдачи? Баланс кассы не изменится."
      : "Отменить закрытие смены? Инкассированная сумма вернётся в кассу, а платежи снова появятся для разметки.";
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
      const matchesTab = bankSub === "pending" ? !p.isPaid : p.isPaid;
      if (!matchesTab) return false;
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
          : ["зп", "зарплата", p.counterparty, p.comment || "", p.source === "cash" ? "касса" : "банк"].join(" ").toLowerCase();
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
  const productById = useMemo(() => new Map(stock.map((p) => [p.id, p])), [stock]);
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
  const suppliersByProduct = useMemo(() => {
    const map = new Map<string, typeof supplierRows>();
    for (const row of supplierRows) {
      const current = map.get(row.productId) || [];
      current.push(row);
      current.sort((a, b) => a.price - b.price);
      map.set(row.productId, current);
    }
    return map;
  }, [supplierRows]);
  const procurementProducts = useMemo(() => {
    const query = procurementQuery.trim().toLocaleLowerCase("ru-RU");
    return stock
      .filter((product) => suppliersByProduct.has(product.id))
      .filter((product) => {
        if (!query) return true;
        return `${product.name} ${product.sku || ""}`.toLocaleLowerCase("ru-RU").includes(query);
      })
      .slice(0, 50);
  }, [procurementQuery, stock, suppliersByProduct]);
  const procurementGroups = useMemo(() => {
    return counterpartyOptions
      .filter((supplier) => procurementCart.some((item) => item.supplierId === supplier.id))
      .map((supplier) => ({
        supplier,
        items: procurementCart.filter((item) => item.supplierId === supplier.id),
      }));
  }, [counterpartyOptions, procurementCart]);

  function addProcurementProduct(productId: string) {
    const supplierOptions = suppliersByProduct.get(productId) || [];
    if (supplierOptions.length === 0) {
      alert("У товара нет поставщика с закупочной ценой");
      return;
    }
    let selected = supplierOptions[0];
    if (supplierOptions.length > 1) {
      const message = supplierOptions
        .map((row, index) => `${index + 1}. ${row.supplier.name} — ${fmt(row.price)} ₽`)
        .join("\n");
      const answer = window.prompt(`У какого поставщика взять товар?\n${message}`, "1");
      const idx = Math.max(0, Math.min(supplierOptions.length - 1, Number(answer || 1) - 1));
      selected = supplierOptions[idx] || supplierOptions[0];
    }
    setProcurementCart((prev) => {
      const found = prev.find((item) => item.productId === productId && item.supplierId === selected.supplier.id);
      if (found) {
        return prev.map((item) =>
          item.productId === productId && item.supplierId === selected.supplier.id
            ? { ...item, quantity: item.quantity + 1, price: selected.price || item.price }
            : item
        );
      }
      return [...prev, { productId, supplierId: selected.supplier.id, quantity: 1, price: selected.price, vatRate: VAT_RATE }];
    });
  }

  function patchProcurementItem(index: number, patch: Partial<ProcurementCartItem>) {
    setProcurementCart((prev) => prev.map((item, idx) => idx === index ? { ...item, ...patch } : item));
  }

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

  async function sendProcurementToReceipts() {
    if (procurementCart.length === 0) return;
    setProcurementSaving(true);
    try {
      for (const group of procurementGroups) {
        const byVat = new Map<number, ProcurementCartItem[]>();
        for (const item of group.items) {
          const vat = Math.max(0, Number(item.vatRate) || 0);
          byVat.set(vat, [...(byVat.get(vat) || []), item]);
        }
        for (const [vatRate, vatItems] of byVat) {
          const items = vatItems
            .map((item) => {
              const product = productById.get(item.productId);
              const quantity = Math.max(1, Number(item.quantity) || 1);
              const price = Math.max(0, Number(item.price) || 0);
              return {
                productId: item.productId,
                name: product?.name || "Товар",
                sku: product?.sku || null,
                quantity,
                price,
                lineTotal: Math.round(quantity * price * 100) / 100,
              };
            })
            .filter((item) => item.lineTotal > 0);
          if (items.length === 0) continue;
          const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
          const res = await fetch("/api/admin/warehouse/receipts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              date: new Date().toISOString().slice(0, 10),
              supplier: group.supplier.name,
              phone: group.supplier.phone ?? null,
              email: group.supplier.email ?? null,
              inn: group.supplier.inn ?? null,
              kpp: group.supplier.kpp ?? null,
              address: group.supplier.address ?? null,
              contactName: group.supplier.contactName ?? null,
              comment: `Создано из корзины заказа поставщику${byVat.size > 1 ? ` · НДС ${vatRate}%` : ""}`,
              items,
              vatRate,
              paymentSplits: [total],
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Не удалось создать поступление для ${group.supplier.name}`);
          }
        }
      }
      setProcurementCart([]);
      window.location.href = `/${adminPath}/warehouse?tab=receipts`;
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось отправить в поставки");
    } finally {
      setProcurementSaving(false);
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
                window.location.href = `/${adminPath}/warehouse?tab=${t.key}`;
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

      {/* ════════════ ВКЛАДКА: СКЛАД ════════════ */}
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

      {/* ════════════ ВКЛАДКА: СКЛАД ════════════ */}
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
                          <th>Поставщик</th>
                          <th style={{ textAlign: "right" }}>Остаток</th>
                          <th style={{ textAlign: "right" }}>Цена продажи</th>
                          <th style={{ textAlign: "right" }}>Сумма</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStock.map((p) => {
                          const summaryExpanded = expandedStockIds.has(p.id);
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
                                  {p.stockQty <= 0 && (
                                    <span className="admin-badge admin-badge--red" style={{ marginLeft: 6 }}>нет в наличии</span>
                                  )}
                                </td>
                                <td>{p.sku || "—"}</td>
                                <td>
                                  {(suppliersByProduct.get(p.id) || []).length > 0 ? (
                                    <div style={{ display: "grid", gap: 3 }}>
                                      {(suppliersByProduct.get(p.id) || []).slice(0, 2).map((row) => (
                                        <button
                                          key={row.supplier.id}
                                          type="button"
                                          onClick={() => { setActiveTab("suppliers"); setSelectedSupplierId(row.supplier.id); }}
                                          className="admin-badge admin-badge--blue"
                                          style={{ border: 0, cursor: "pointer", justifyContent: "flex-start" }}
                                        >
                                          {row.supplier.name} · {fmt(row.price)} ₽
                                        </button>
                                      ))}
                                    </div>
                                  ) : "—"}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <StockQtyEditor
                                    productId={p.id}
                                    initialQty={p.stockQty}
                                    onSaved={() => handleStockQuantitySaved(p.id)}
                                  />
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                  {p.price != null ? `${fmt(p.price)} ₽` : "—"}
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                  {p.price != null ? `${fmt(p.stockQty * p.price)} ₽` : "—"}
                                </td>
                              </tr>
                              {summaryExpanded && (
                                <tr id={`stock-summary-${p.id}`} className="stock-summary-row">
                                  <td colSpan={6}>
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

              {/* Products list for selected category */}
              <div className="admin-card">
                {(() => {
                  let list: React.ReactNode = null;
                  
                  if (attentionCategory === "outofstock") {
                    list = criticalProducts.outOfStock.length > 0 ? (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>Товар</th>
                              <th>Артикул</th>
                              <th style={{ textAlign: "right" }}>Действия</th>
                            </tr>
                          </thead>
                          <tbody>
                            {criticalProducts.outOfStock.map((p) => (
                              <tr key={p.id}>
                                <td>
                                  <Link href={`/${adminPath}/products/${p.id}`} className="wh-stock-product-name" style={{ fontWeight: 600 }}>
                                    {p.name}
                                  </Link>
                                </td>
                                <td>{p.sku || "—"}</td>
                                <td style={{ textAlign: "right" }}>
                                  <button
                                    onClick={() => setOrderingProduct(p)}
                                    className="admin-btn admin-btn--primary admin-btn--sm"
                                  >
                                    Заказать у поставщика
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="admin-empty"><p>Все товары в наличии!</p></div>
                    );
                  } else if (attentionCategory === "lowstock") {
                    list = criticalProducts.lowStock.length > 0 ? (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>Товар</th>
                              <th>Артикул</th>
                              <th style={{ textAlign: "right" }}>Остаток</th>
                              <th style={{ textAlign: "right" }}>Минимум</th>
                              <th style={{ textAlign: "right" }}>Действия</th>
                            </tr>
                          </thead>
                          <tbody>
                            {criticalProducts.lowStock.map((p) => (
                              <tr key={p.id}>
                                <td>
                                  <Link href={`/${adminPath}/products/${p.id}`} className="wh-stock-product-name" style={{ fontWeight: 600 }}>
                                    {p.name}
                                  </Link>
                                </td>
                                <td>{p.sku || "—"}</td>
                                <td style={{ textAlign: "right", color: "var(--adm-rust)", fontWeight: 700 }}>
                                  {p.stockQty} шт.
                                </td>
                                <td style={{ textAlign: "right" }}>{p.stockWarnQty} шт.</td>
                                <td style={{ textAlign: "right" }}>
                                  <button
                                    onClick={() => setOrderingProduct(p)}
                                    className="admin-btn admin-btn--primary admin-btn--sm"
                                  >
                                    Заказать у поставщика
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="admin-empty"><p>Нет товаров с остатком меньше минимального.</p></div>
                    );
                  } else if (attentionCategory === "popular") {
                    list = criticalProducts.frequentlyOrderedAbsent.length > 0 ? (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>Товар</th>
                              <th>Артикул</th>
                              <th style={{ textAlign: "right" }}>Кол-во заказов</th>
                              <th style={{ textAlign: "right" }}>Действия</th>
                            </tr>
                          </thead>
                          <tbody>
                            {criticalProducts.frequentlyOrderedAbsent.map(({ product: p, orderCount }) => (
                              <tr key={p.id}>
                                <td>
                                  <Link href={`/${adminPath}/products/${p.id}`} className="wh-stock-product-name" style={{ fontWeight: 600 }}>
                                    {p.name}
                                  </Link>
                                </td>
                                <td>{p.sku || "—"}</td>
                                <td style={{ textAlign: "right", fontWeight: 700, color: "var(--adm-pine)" }}>
                                  {orderCount} раз заказывали
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <button
                                    onClick={() => setOrderingProduct(p)}
                                    className="admin-btn admin-btn--primary admin-btn--sm"
                                  >
                                    Заказать у поставщика
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="admin-empty"><p>Нет отсутствующих популярных товаров.</p></div>
                    );
                  } else if (attentionCategory === "stagnant") {
                    list = criticalProducts.stagnantStock.length > 0 ? (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>Товар</th>
                              <th>Артикул</th>
                              <th style={{ textAlign: "right" }}>Текущий остаток</th>
                              <th style={{ textAlign: "right" }}>Дней без продаж</th>
                              <th style={{ textAlign: "right" }}>Последняя продажа</th>
                            </tr>
                          </thead>
                          <tbody>
                            {criticalProducts.stagnantStock.map(({ product: p, lastSaleDays, lastSaleDate }) => (
                              <tr key={p.id}>
                                <td>
                                  <Link href={`/${adminPath}/products/${p.id}`} className="wh-stock-product-name" style={{ fontWeight: 600 }}>
                                    {p.name}
                                  </Link>
                                </td>
                                <td>{p.sku || "—"}</td>
                                <td style={{ textAlign: "right" }}>{p.stockQty} шт.</td>
                                <td style={{ textAlign: "right", color: "var(--adm-rust)", fontWeight: 700 }}>
                                  {lastSaleDays === null ? "Никогда не продавался" : `${lastSaleDays} дн.`}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {lastSaleDate ? fmtDate(lastSaleDate) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="admin-empty"><p>Нет залежавшихся товаров на складе.</p></div>
                    );
                  }

                  return list;
                })()}
              </div>

              {/* Beautiful Ordering Modal */}
              {orderingProduct && (
                <ModalPortal>
                  <div className="admin-modal-overlay" onClick={() => setOrderingProduct(null)}>
                    <div className="admin-modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
                      <div className="admin-modal__head">
                        <h3 className="admin-modal__title">Заказать у поставщика</h3>
                        <button onClick={() => setOrderingProduct(null)} className="admin-modal__close" aria-label="Закрыть">
                          <X size={16} />
                        </button>
                      </div>
                      <p className="admin-modal__desc">
                        Создание проекта/черновика поступления для товара: <br />
                        <b>{orderingProduct.name}</b> {orderingProduct.sku ? `(арт. ${orderingProduct.sku})` : ""}
                      </p>

                      <form onSubmit={handleCreateOrderSubmit}>
                        {orderError && (
                          <div className="wh-form-error" style={{ marginBottom: 12 }}>
                            {orderError}
                          </div>
                        )}

                        <div className="wh-form-grid" style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
                          <div>
                            <label className="wh-form-label">Поставщик (выберите из базы):</label>
                            <select
                              value={orderSupplierId}
                              onChange={(e) => {
                                const val = e.target.value;
                                setOrderSupplierId(val);
                                if (val) {
                                  const found = counterpartyOptions.find(c => c.id === val);
                                  if (found) {
                                    setOrderSupplierName(found.name);
                                    if (found.supplierPrices && found.supplierPrices[orderingProduct.id]) {
                                      setOrderPrice(found.supplierPrices[orderingProduct.id]);
                                    }
                                  }
                                }
                              }}
                              className="admin-input"
                            >
                              <option value="">-- Выберите поставщика --</option>
                              {counterpartyOptions
                                .filter(c => c.roles.includes("supplier"))
                                .map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))
                              }
                            </select>
                          </div>

                          <div>
                            <label className="wh-form-label">Имя поставщика (можно ввести вручную):</label>
                            <input
                              type="text"
                              value={orderSupplierName}
                              onChange={(e) => setOrderSupplierName(e.target.value)}
                              placeholder="Имя поставщика"
                              className="admin-input"
                              required
                            />
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div>
                              <label className="wh-form-label">Цена закупки (₽):</label>
                              <input
                                type="number"
                                step="any"
                                value={orderPrice || ""}
                                onChange={(e) => setOrderPrice(Number(e.target.value) || 0)}
                                placeholder="Закупочная цена"
                                className="admin-input"
                                required
                              />
                            </div>
                            <div>
                              <label className="wh-form-label">Количество (шт.):</label>
                              <input
                                type="number"
                                value={orderQty || ""}
                                onChange={(e) => setOrderQty(Number(e.target.value) || 0)}
                                placeholder="Кол-во для заказа"
                                className="admin-input"
                                required
                              />
                            </div>
                          </div>

                          <div>
                            <label className="wh-form-label">Ставка НДС:</label>
                            <select
                              value={orderVat}
                              onChange={(e) => setOrderVat(Number(e.target.value))}
                              className="admin-input"
                            >
                              <option value={22}>22% (Стандартная)</option>
                              <option value={20}>20%</option>
                              <option value={10}>10%</option>
                              <option value={0}>0%</option>
                              <option value={-1}>Без НДС</option>
                            </select>
                          </div>

                          <div>
                            <label className="wh-form-label">Комментарий к заказу:</label>
                            <textarea
                              value={orderComment}
                              onChange={(e) => setOrderComment(e.target.value)}
                              className="admin-input"
                              rows={2}
                            />
                          </div>

                          <div style={{ background: "rgba(224, 155, 18, 0.05)", padding: 10, borderRadius: 4, fontSize: 12, color: "var(--adm-sink-soft)" }}>
                            Сумма заказа составит: <b>{fmt(orderPrice * orderQty)} ₽</b>. <br />
                            После создания заказ появится как <b>«Черновик»</b> в разделе «Поставки». Остатки не изменятся до тех пор, пока вы не проведёте поставку.
                          </div>
                        </div>

                        <div className="admin-modal__actions">
                          <button
                            type="button"
                            className="admin-btn admin-btn--ghost"
                            onClick={() => setOrderingProduct(null)}
                            disabled={orderSaving}
                          >
                            Отмена
                          </button>
                          <button
                            type="submit"
                            className="admin-btn admin-btn--primary"
                            disabled={orderSaving}
                          >
                            {orderSaving ? <Loader2 size={13} className="animate-spin" /> : null}
                            Создать черновик заказа
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                </ModalPortal>
              )}
            </div>
          )}
        </>
      )}
        </>
      )}

      {/* ════════════ ВКЛАДКА: ПОСТАВКИ (Поступления + Поставщики) ════════════ */}
      {activeTab === "receipts" && (
        <>
          <div className="admin-filters admin-filters--sub">
            <button onClick={() => setSuppliesSub("receipts")} className={`admin-filter${suppliesSub === "receipts" ? " admin-filter--active" : ""}`}>
              <Truck size={12} /> Поступления
            </button>
            <button onClick={() => setSuppliesSub("suppliers")} className={`admin-filter${suppliesSub === "suppliers" ? " admin-filter--active" : ""}`}>
              <UsersRound size={12} /> Поставщики
            </button>
          </div>

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
              <div className="admin-card">
                <div className="admin-card__head">
                  <h3 className="admin-card__title">Корзина заказа поставщикам</h3>
                  <button type="button" className="admin-btn admin-btn--primary" disabled={procurementSaving || procurementCart.length === 0} onClick={sendProcurementToReceipts}>
                    {procurementSaving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Отправить в поставки
                  </button>
                </div>
                <div className="admin-card__pad" style={{ display: "grid", gap: 14 }}>
                  <div style={{ position: "relative" }}>
                    <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--adm-sand)" }} />
                    <input className="admin-input" value={procurementQuery} onChange={(e) => setProcurementQuery(e.target.value)} placeholder="Поиск товара для заказа у поставщика..." style={{ paddingLeft: 36 }} />
                  </div>
                  {procurementQuery && (
                    <div className="admin-table-wrap" style={{ maxHeight: 280, overflow: "auto" }}>
                      <table className="admin-table">
                        <thead><tr><th>Товар</th><th>Остаток</th><th>Поставщики</th><th></th></tr></thead>
                        <tbody>
                          {procurementProducts.map((product) => {
                            const rows = suppliersByProduct.get(product.id) || [];
                            return (
                              <tr key={product.id}>
                                <td><strong>{product.name}</strong>{product.sku && <div style={{ color: "var(--adm-muted)", fontSize: 12 }}>арт. {product.sku}</div>}</td>
                                <td>{product.stockQty} шт.</td>
                                <td>{rows.map((row) => `${row.supplier.name} — ${fmt(row.price)} ₽`).join(" · ")}</td>
                                <td style={{ textAlign: "right" }}>
                                  <button type="button" className="admin-btn admin-btn--sm admin-btn--primary" onClick={() => addProcurementProduct(product.id)}><Plus size={13} /> Добавить</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {procurementGroups.length > 0 ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      {procurementGroups.map((group) => (
                        <div key={group.supplier.id} style={{ border: "1px solid var(--adm-border)", borderRadius: 12, overflow: "hidden" }}>
                          <div style={{ padding: "10px 14px", background: "var(--adm-paper)", display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <strong>{group.supplier.name}</strong>
                            <span style={{ color: "var(--adm-muted)", fontSize: 12 }}>Итого: {fmt(group.items.reduce((sum, item) => sum + item.quantity * item.price, 0))} ₽</span>
                          </div>
                          <div className="admin-table-wrap">
                            <table className="admin-table">
                              <thead><tr><th>Товар</th><th>Кол-во</th><th>Цена</th><th>НДС %</th><th>Сумма</th><th></th></tr></thead>
                              <tbody>
                                {group.items.map((item) => {
                                  const index = procurementCart.findIndex((c) => c.productId === item.productId && c.supplierId === item.supplierId);
                                  const product = productById.get(item.productId);
                                  return (
                                    <tr key={`${item.supplierId}-${item.productId}`}>
                                      <td>{product?.name || "Товар"}</td>
                                      <td><input className="admin-input" type="number" min={1} value={item.quantity} onChange={(e) => patchProcurementItem(index, { quantity: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 90 }} /></td>
                                      <td><input className="admin-input" type="number" min={0} step="0.01" value={item.price} onChange={(e) => patchProcurementItem(index, { price: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 120 }} /></td>
                                      <td><input className="admin-input" type="number" min={0} step="1" value={item.vatRate} onChange={(e) => patchProcurementItem(index, { vatRate: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 80 }} /></td>
                                      <td><strong>{fmt(item.quantity * item.price)} ₽</strong></td>
                                      <td><button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setProcurementCart((prev) => prev.filter((_, idx) => idx !== index))}>Убрать</button></td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="admin-empty" style={{ padding: 20 }}><p>Добавьте товары через поиск — они автоматически разложатся по поставщикам.</p></div>
                  )}
                </div>
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
                          <div style={{ color: "var(--adm-muted)", fontSize: 12 }}>Один список: товар, остаток, цена поставщика и добавление в корзину заказа.</div>
                        </div>
                        <button type="button" className="admin-btn admin-btn--primary" disabled={supplierPriceSaving} onClick={saveSupplierPrices}>
                          {supplierPriceSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Сохранить прайс
                        </button>
                      </div>
                      <div style={{ position: "relative" }}>
                        <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--adm-sand)" }} />
                        <input className="admin-input" value={supplierPriceQuery} onChange={(e) => setSupplierPriceQuery(e.target.value)} placeholder="Найти товар, добавить в прайс или в корзину..." style={{ paddingLeft: 36 }} />
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
                                      <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => {
                                        const price = Math.max(0, Number(String(supplierPriceDrafts[product.id] ?? "0").replace(",", ".")) || 0);
                                        setSupplierPriceDrafts((prev) => ({ ...prev, [product.id]: String(price) }));
                                        setProcurementCart((prev) => {
                                          const found = prev.find((item) => item.productId === product.id && item.supplierId === selectedSupplier!.supplier.id);
                                          if (found) return prev.map((item) => item.productId === product.id && item.supplierId === selectedSupplier!.supplier.id ? { ...item, quantity: item.quantity + 1, price } : item);
                                          return [...prev, { productId: product.id, supplierId: selectedSupplier!.supplier.id, quantity: 1, price, vatRate: VAT_RATE }];
                                        });
                                      }}>В корзину</button>
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

      {/* ════════════ ВКЛАДКА: ДОСТАВКИ ════════════ */}
      {activeTab === "deliveries" && (
        <TransportManager
          transports={transports}
          pendingDeals={pendingDeals}
          drivers={drivers}
          companyPhone={companyPhone}
          companyAddress={companyAddress}
          focusTransportId={focusTransportId}
        />
      )}

      {/* ════════════ ВКЛАДКА: ЗАКАЗЫ ════════════ */}      {/* ════════════ ВКЛАДКА: ЗАКАЗЫ ════════════ */}
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
                const shortage =
                  d.status === "new"
                    ? d.items
                        .map((it) => {
                          const available = stockById.get(it.productId) ?? 0;
                          return { it, available, missing: Math.max(0, it.quantity - available) };
                        })
                        .filter((r) => r.missing > 0)
                    : [];
                const hasShortage = shortage.length > 0;
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
                      {hasShortage && (
                        <span className="admin-badge admin-badge--red"><AlertTriangle size={10} /> не хватает товара</span>
                      )}
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
                              return (
                                <div key={idx} className={`admin-order__item${shipped > 0 && remaining > 0 ? " admin-order__item--partial" : ""}`}>
                                  <Link
                                    href={`/${adminPath}/products/${it.productId}`}
                                    prefetch={false}
                                    style={{ color: "inherit", fontWeight: 650 }}
                                  >
                                    {it.name} × {it.quantity}
                                    <span className="wh-item-unit">{fmt(it.price)} ₽/шт</span>
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
                                <div className="deal-stock__title"><AlertTriangle size={12} />Не хватает на складе</div>
                                {shortage.map((r) => (
                                  <div key={r.it.productId} className="deal-stock__row">
                                    <span className="deal-stock__name">{r.it.name}</span>
                                    <span className="deal-stock__nums">
                                      нужно {r.it.quantity} · на складе {r.available} · <b>не хватает {r.missing}</b>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="deal-stock deal-stock--ok"><PackageCheck size={13} />Все позиции есть на складе</div>
                            ))}
                        </div>

                        <div className="admin-order__side">
                          <DealForm
                            products={pickerProducts}
                            counterparties={counterpartyOptions}
                            payments={payments}
                            deliveryPrice={deliveryPrice}
                            freeDeliveryThreshold={freeDeliveryThreshold}
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
                              // Способ оплаты берём из привязанных платежей,
                              // чтобы наличный заказ не «переезжал» в безнал.
                              paymentMethod: dealPaymentMethod.get(d.id) ?? "regular",
                              items: d.items.map((item) => ({
                                productId: item.productId,
                                name: item.name,
                                sku: item.sku ?? null,
                                quantity: item.quantity,
                                price: item.price,
                                stockQty: stockById.get(item.productId) ?? 0,
                              })),
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

      {/* ════════════ ВКЛАДКА: ЗАРПЛАТЫ ════════════ */}
      {activeTab === "salaries" && (
        <WarehouseSalaries employees={employees} salaries={salaries} />
      )}

      {/* ════════════ ВКЛАДКА: ОТЧЁТЫ ════════════ */}
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

      {/* ════════════ ВКЛАДКА: КОНТРАГЕНТЫ ════════════ */}
      {activeTab === "counterparties" && (
        <CounterpartiesManager
          initialCounterparties={counterpartyOptions}
          documents={counterpartyDocuments}
        />
      )}

      {/* ════════════ ВКЛАДКА: КЛИЕНТЫ ════════════ */}
      {activeTab === "clients" && <ClientsManager clients={clients} />}

      {/* ════════════ ВКЛАДКА: ПОСТАВЩИКИ ════════════ */}
      {activeTab === "suppliers" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div className="admin-card">
            <div className="admin-card__head">
              <h3 className="admin-card__title">Корзина заказа поставщикам</h3>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                disabled={procurementSaving || procurementCart.length === 0}
                onClick={sendProcurementToReceipts}
              >
                {procurementSaving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Отправить в поставки
              </button>
            </div>
            <div className="admin-card__pad" style={{ display: "grid", gap: 14 }}>
              <div style={{ position: "relative" }}>
                <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--adm-sand)" }} />
                <input
                  className="admin-input"
                  value={procurementQuery}
                  onChange={(e) => setProcurementQuery(e.target.value)}
                  placeholder="Поиск товара для заказа у поставщика..."
                  style={{ paddingLeft: 36 }}
                />
              </div>

              {procurementQuery && (
                <div className="admin-table-wrap" style={{ maxHeight: 280, overflow: "auto" }}>
                  <table className="admin-table">
                    <thead><tr><th>Товар</th><th>Остаток</th><th>Поставщики</th><th></th></tr></thead>
                    <tbody>
                      {procurementProducts.map((product) => {
                        const rows = suppliersByProduct.get(product.id) || [];
                        return (
                          <tr key={product.id}>
                            <td><strong>{product.name}</strong>{product.sku && <div style={{ color: "var(--adm-muted)", fontSize: 12 }}>арт. {product.sku}</div>}</td>
                            <td>{product.stockQty} шт.</td>
                            <td>{rows.map((row) => `${row.supplier.name} — ${fmt(row.price)} ₽`).join(" · ")}</td>
                            <td style={{ textAlign: "right" }}>
                              <button type="button" className="admin-btn admin-btn--sm admin-btn--primary" onClick={() => addProcurementProduct(product.id)}>
                                <Plus size={13} /> Добавить
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {procurementGroups.length > 0 ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {procurementGroups.map((group) => (
                    <div key={group.supplier.id} style={{ border: "1px solid var(--adm-border)", borderRadius: 12, overflow: "hidden" }}>
                      <div style={{ padding: "10px 14px", background: "var(--adm-paper)", display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <strong>{group.supplier.name}</strong>
                        <span style={{ color: "var(--adm-muted)", fontSize: 12 }}>Итого: {fmt(group.items.reduce((sum, item) => sum + item.quantity * item.price, 0))} ₽</span>
                      </div>
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead><tr><th>Товар</th><th>Кол-во</th><th>Цена</th><th>НДС %</th><th>Сумма</th><th></th></tr></thead>
                          <tbody>
                            {group.items.map((item) => {
                              const index = procurementCart.findIndex((cartItem) => cartItem.productId === item.productId && cartItem.supplierId === item.supplierId);
                              const product = productById.get(item.productId);
                              return (
                                <tr key={`${item.supplierId}-${item.productId}`}>
                                  <td>{product?.name || "Товар"}</td>
                                  <td><input className="admin-input" type="number" min={1} value={item.quantity} onChange={(e) => patchProcurementItem(index, { quantity: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 90 }} /></td>
                                  <td><input className="admin-input" type="number" min={0} step="0.01" value={item.price} onChange={(e) => patchProcurementItem(index, { price: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 120 }} /></td>
                                  <td><input className="admin-input" type="number" min={0} step="1" value={item.vatRate} onChange={(e) => patchProcurementItem(index, { vatRate: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 80 }} /></td>
                                  <td><strong>{fmt(item.quantity * item.price)} ₽</strong></td>
                                  <td><button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setProcurementCart((prev) => prev.filter((_, idx) => idx !== index))}>Убрать</button></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="admin-empty" style={{ padding: 20 }}><p>Добавьте товары через поиск — они автоматически разложатся по поставщикам.</p></div>
              )}
            </div>
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
                      <div style={{ color: "var(--adm-muted)", fontSize: 12 }}>
                        Один список: товар, остаток, цена поставщика и добавление в корзину заказа. Если цены нет — поставьте 0 или свою цену и сохраните.
                      </div>
                    </div>
                    <button type="button" className="admin-btn admin-btn--primary" disabled={supplierPriceSaving} onClick={saveSupplierPrices}>
                      {supplierPriceSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      Сохранить прайс
                    </button>
                  </div>
                  <div style={{ position: "relative" }}>
                    <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--adm-sand)" }} />
                    <input
                      className="admin-input"
                      value={supplierPriceQuery}
                      onChange={(e) => setSupplierPriceQuery(e.target.value)}
                      placeholder="Найти товар, добавить в прайс или в корзину..."
                      style={{ paddingLeft: 36 }}
                    />
                  </div>
                  <div className="admin-table-wrap" style={{ maxHeight: 520, overflow: "auto" }}>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Товар</th>
                          <th>Остаток</th>
                          <th>Порог</th>
                          <th style={{ width: 170 }}>Цена поставщика</th>
                          <th>Статус</th>
                          <th style={{ width: 190 }}>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierPriceProducts.map((product) => {
                          const inPrice = supplierPriceDrafts[product.id] !== undefined;
                          const stockProduct = productById.get(product.id);
                          const warn = stockProduct?.stockWarnQty ?? 10;
                          const need = (product.stockQty || 0) <= warn;
                          return (
                            <tr key={product.id}>
                              <td>
                                <Link href={`/${adminPath}/products/${product.id}`} prefetch={false} style={{ fontWeight: 700 }}>
                                  {product.name}
                                </Link>
                                {product.sku && <div style={{ color: "var(--adm-muted)", fontSize: 12 }}>арт. {product.sku}</div>}
                              </td>
                              <td>{product.stockQty ?? 0} шт.</td>
                              <td>{warn} шт.</td>
                              <td>
                                <input
                                  className="admin-input"
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={supplierPriceDrafts[product.id] ?? ""}
                                  onChange={(e) => setSupplierPriceDrafts((prev) => ({ ...prev, [product.id]: e.target.value }))}
                                  placeholder="0"
                                />
                              </td>
                              <td>{need ? <span className="admin-badge admin-badge--amber">заказать</span> : <span className="admin-badge admin-badge--green">достаточно</span>}</td>
                              <td>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  {!inPrice && (
                                    <button type="button" className="admin-btn admin-btn--primary admin-btn--sm" onClick={() => setSupplierPriceDrafts((prev) => ({ ...prev, [product.id]: "0" }))}>В прайс</button>
                                  )}
                                  {inPrice && (
                                    <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setSupplierPriceDrafts((prev) => { const next = { ...prev }; delete next[product.id]; return next; })}>Убрать</button>
                                  )}
                                  <button
                                    type="button"
                                    className="admin-btn admin-btn--ghost admin-btn--sm"
                                    onClick={() => {
                                      const price = Math.max(0, Number(String(supplierPriceDrafts[product.id] ?? "0").replace(",", ".")) || 0);
                                      setSupplierPriceDrafts((prev) => ({ ...prev, [product.id]: String(price) }));
                                      setProcurementCart((prev) => {
                                        const found = prev.find((item) => item.productId === product.id && item.supplierId === selectedSupplier.supplier.id);
                                        if (found) {
                                          return prev.map((item) => item.productId === product.id && item.supplierId === selectedSupplier.supplier.id ? { ...item, quantity: item.quantity + 1, price } : item);
                                        }
                                        return [...prev, { productId: product.id, supplierId: selectedSupplier.supplier.id, quantity: 1, price, vatRate: VAT_RATE }];
                                      });
                                    }}
                                  >
                                    В корзину
                                  </button>
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

      {/* ════════════ ВКЛАДКА: БАНК ════════════ */}
      {activeTab === "bank" && bankSummary && (
        <div className="bank">
          <div className="bank-hero">
            <div className="bank-hero__main">
              <div>
                <div className="bank-hero__label">
                  <CreditCard size={14} /> Безналичный расчет
                </div>
                <div className="bank-hero__value" style={{ color: '#fff' }}>
                  {fmt(bankSummary.bankBalance)} ₽
                </div>
              </div>
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
                      Касса в минусе. Обычно это значит, что приход, покрытый
                      прошлой сдачей, стал безналичным. Проверьте типы платежей
                      и суммы сдач — цифры разошлись.
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  className="admin-btn admin-btn--primary admin-btn--sm"
                  disabled={collecting || bankSummary.cashBalance <= 0.009}
                  onClick={handleCollectCash}
                  style={{ marginTop: 10 }}
                >
                  {collecting ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />}
                  Сдать кассу
                </button>
              </div>
              <div className="bank-hero__note" style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}>
                Общий итог (факт): <strong style={{ color: '#7dd181' }}>{fmt(bankSummary.balance)} ₽</strong>
              </div>
            </div>

            <div className="bank-hero__stats">
              <div className="bank-hero__stat" style={{ color: '#7dd181' }}>
                <ArrowDownLeft size={16} />
                <div>
                  <span style={{ color: 'rgba(125,209,129,0.7)', fontWeight: 700 }}>Должны нам (ожидаем)</span>
                  <strong style={{ fontSize: 22 }}>+{fmt(bankSummary.expectedIn)} ₽</strong>
                </div>
              </div>

              <div className="bank-hero__stat" style={{ color: '#9de3a5' }}>
                <Wallet size={16} />
                <div>
                  <span style={{ color: 'rgba(157,227,165,0.72)', fontWeight: 700 }}>
                    Общий приход (факт + будущие)
                  </span>
                  <strong style={{ color: '#fff', fontSize: 22 }}>
                    {fmt(bankSummary.balance + bankSummary.expectedIn)} ₽
                  </strong>
                  <small style={{ display: 'block', marginTop: 2, color: 'rgba(245,242,234,0.45)', fontSize: 10 }}>
                    Касса + безнал + все ожидаемые входящие платежи
                  </small>
                </div>
              </div>
              
              <div className="bank-hero__stat" style={{ color: '#ef8f76' }}>
                <ArrowUpRight size={16} />
                <div>
                  <span style={{ color: 'rgba(239,143,118,0.7)', fontWeight: 700 }}>Мы должны (к оплате)</span>
                  <strong style={{ fontSize: 22 }}>−{fmt(bankSummary.expectedOut)} ₽</strong>
                </div>
              </div>

              <div className="bank-hero__stat" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12, marginTop: 4, color: '#e09b12' }}>
                <History size={16} />
                <div>
                  <span style={{ color: 'rgba(224,155,18,0.7)' }}>Прогноз после всех оплат</span>
                  <strong style={{ color: '#fff', fontSize: 18 }}>{fmt(bankSummary.balance + bankSummary.expectedIn - bankSummary.expectedOut)} ₽</strong>
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
                      style={{ background: "#fff", padding: "10px 14px" }}
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
                  .map((c) => (
                    <div key={`c-${c.name}`} className="bank-due__row">
                      <div className="bank-due__name">
                        {c.name}
                        <span className="bank-due__meta">
                          {c.docsCount} плат. · последний {fmtDate(c.lastPaymentDate)}
                        </span>
                      </div>
                      <div className="bank-due__sum" style={{ fontSize: 18, color: c.balance > 0 ? '#7dd181' : '#ef8f76' }}>
                        {fmt(c.balance)} ₽
                      </div>
                    </div>
                  ))
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
                  .map((c) => (
                    <div key={`s-${c.name}`} className="bank-due__row">
                      <div className="bank-due__name">
                        {c.name}
                        <span className="bank-due__meta">
                          {c.docsCount} плат. · последний {fmtDate(c.lastPaymentDate)}
                        </span>
                      </div>
                      <div className="bank-due__sum" style={{ fontSize: 18, color: c.balance > 0 ? '#ef8f76' : '#7dd181' }}>
                        {fmt(c.balance)} ₽
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>


          <div className="admin-filters admin-filters--sub" style={{ marginTop: 12 }}>
            <button
              onClick={() => setBankSub("summary")}
              className={`admin-filter${bankSub === "summary" ? " admin-filter--active" : ""}`}
            >
              <BarChart3 size={12} />
              Финансовая сводка
            </button>
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
              onClick={() => setBankSub("cash")}
              className={`admin-filter${bankSub === "cash" ? " admin-filter--active" : ""}`}
            >
              <Banknote size={12} />
              Касса
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

                  {/* Правая колонка: Текущие остатки и Прогноз */}
                  <div className="admin-card" style={{ padding: 16 }}>
                    <div className="admin-card__head" style={{ borderBottom: "1px solid var(--adm-sand-pale)", paddingBottom: 10, marginBottom: 12 }}>
                      <h3 className="admin-card__title" style={{ fontSize: 14, fontWeight: 700 }}>
                        💰 Баланс и прогноз оплат (сейчас)
                      </h3>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--adm-ink-soft)" }}>Реально в кассе (наличные):</span>
                        <strong style={{ color: bankSummary.cashBalanceNegative ? '#ef8f76' : 'inherit' }}>
                          {fmt(bankSummary.cashBalance)} ₽
                        </strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--adm-ink-soft)" }}>Реально на безнале:</span>
                        <strong>{fmt(bankSummary.bankBalance)} ₽</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--adm-sand-pale)" }}>
                        <span style={{ color: "var(--adm-ink-soft)" }}>Ожидаем оплат от клиентов:</span>
                        <strong style={{ color: "var(--adm-pine)" }}>+{fmt(bankSummary.expectedIn)} ₽</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--adm-ink-soft)" }}>Надо оплатить (долги):</span>
                        <strong style={{ color: "var(--adm-rust)" }}>−{fmt(bankSummary.expectedOut)} ₽</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px dashed var(--adm-sand-pale)" }}>
                        <span style={{ fontWeight: 700 }}>Прогноз после всех оплат:</span>
                        <strong style={{ fontSize: 14, color: "var(--adm-ink)" }}>
                          {fmt(bankSummary.balance + bankSummary.expectedIn - bankSummary.expectedOut)} ₽
                        </strong>
                      </div>
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
                <h3 className="admin-card__title">
                  <Banknote size={16} style={{ verticalAlign: "middle", marginRight: 8 }} />
                  Отчёт по закрытым сменам кассы
                </h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="admin-badge admin-badge--muted">
                    В кассе: {fmt(Math.round(bankSummary.cashBalance * 100) / 100)} ₽
                  </span>
                  <span className="admin-badge admin-badge--blue">
                    <CreditCard size={10} /> На карту: {fmt(collectedBreakdown.transfer)} ₽
                  </span>
                  <span className="admin-badge admin-badge--green">
                    <Banknote size={10} /> Перенесено в кассе: {fmt(collectedBreakdown.cash)} ₽
                  </span>
                  <span className="admin-badge admin-badge--green">
                    Размечено по сменам: {fmt(Math.round(collectionsTotal * 100) / 100)} ₽
                  </span>
                </div>
              </div>
              <div className="admin-card__pad" style={{ display: "grid", gap: 14 }}>
                <div className="admin-muted" style={{ fontSize: 13 }}>
                  Кнопка «Сдать кассу» находится в верхнем блоке банка рядом с остатком наличных.
                  В смену попадают <b>только наличные платежи</b> — безналичный счёт не
                  затрагивается. Часть <b>на карту ЮМ</b> вычитается
                  из кассы, а часть <b>наличными</b> остаётся в кассе и автоматически
                  переносится на следующий день.
                </div>
                {collectionsSorted.length === 0 ? (
                  <div className="admin-empty" style={{ padding: 16 }}>
                    <p>Касса ещё ни разу не сдавалась</p>
                  </div>
                ) : (
                  <div className="admin-table-wrap" style={{ maxHeight: 520, overflow: "auto" }}>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Дата</th>
                          <th style={{ textAlign: "right" }}>На карту</th>
                          <th style={{ textAlign: "right" }}>Осталось в кассе</th>
                          <th style={{ textAlign: "right" }}>Размечено</th>
                          <th>Комментарий</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {collectionsSorted.map((c) => {
                          const legacyCollection = c.cashAmount == null;
                          const transfer =
                            Math.round(
                              (legacyCollection
                                ? c.amount || 0
                                : c.transferAmount || 0) * 100
                            ) / 100;
                          // У старых записей разбивки не было и вся сумма
                          // уменьшала кассу — не считаем её переносом.
                          const cashPart =
                            Math.round(
                              (legacyCollection ? 0 : c.cashAmount || 0) * 100
                            ) / 100;
                          const marked = (c.items || []).length;
                          const noAccounting = (c.items || []).some(
                            (item) => item.noAccounting
                          );
                          const exp = c.expenses || [];
                          const expSum =
                            Math.round((c.expensesAmount || 0) * 100) / 100;
                          const income =
                            Math.round(
                              (c.incomeAmount != null ? c.incomeAmount : c.amount) * 100
                            ) / 100;
                          const isOpen = openCollections.has(c.id);
                          const canOpen = marked > 0 || exp.length > 0;
                          return (
                            <React.Fragment key={c.id}>
                            <tr
                              className={canOpen ? "wh-cc-row" : undefined}
                              onClick={
                                canOpen
                                  ? () =>
                                      setOpenCollections((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(c.id)) next.delete(c.id);
                                        else next.add(c.id);
                                        return next;
                                      })
                                  : undefined
                              }
                              style={canOpen ? { cursor: "pointer" } : undefined}
                            >
                              <td>
                                {canOpen && (
                                  <ChevronRight
                                    size={13}
                                    style={{
                                      verticalAlign: "middle",
                                      marginRight: 4,
                                      transform: isOpen ? "rotate(90deg)" : "none",
                                      transition: "transform 0.15s",
                                    }}
                                  />
                                )}
                                {fmtDate(c.date)}
                                {noAccounting && (
                                  <span
                                    className="admin-badge admin-badge--amber"
                                    style={{ marginLeft: 6 }}
                                    title="Платежи только скрыты из списка сдачи; баланс не менялся"
                                  >
                                    без учёта и движения денег
                                  </span>
                                )}
                                {legacyCollection && (
                                  <span
                                    className="admin-badge admin-badge--muted"
                                    style={{ marginLeft: 6 }}
                                    title="Старая запись без разбивки: вся сумма была вычтена из кассы"
                                  >
                                    старый учёт
                                  </span>
                                )}
                                {marked > 0 && (
                                  <span
                                    className="admin-badge admin-badge--muted"
                                    style={{ marginLeft: 6 }}
                                    title="Платежей размечено в этой сдаче"
                                  >
                                    {marked} плат.
                                  </span>
                                )}
                                {expSum > 0 && (
                                  <span
                                    className="admin-badge admin-badge--red"
                                    style={{ marginLeft: 6 }}
                                    title="Потрачено налом в этот день"
                                  >
                                    −{fmt(expSum)} ₽
                                  </span>
                                )}
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 600, color: "var(--adm-steel)" }}>
                                {transfer > 0 ? `${fmt(transfer)} ₽` : "—"}
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>
                                {cashPart > 0 ? `${fmt(cashPart)} ₽` : "—"}
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 700, color: "var(--adm-pine)" }}>
                                +{fmt(Math.round(c.amount * 100) / 100)} ₽
                              </td>
                              <td>{c.note || "—"}</td>
                              <td style={{ textAlign: "right" }}>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--ghost admin-btn--sm"
                                  disabled={collecting}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteCollection(c.id, noAccounting);
                                  }}
                                >
                                  <Trash2 size={13} /> {noAccounting ? "Вернуть в список" : "Отменить закрытие"}
                                </button>
                              </td>
                            </tr>

                            {/* ── Детализация смены: платежи, траты, куда ушло ── */}
                            {isOpen && (
                              <tr className="wh-cc-details">
                                <td colSpan={6}>
                                  <div className="wh-cc-grid">
                                    {/* Платежи, вошедшие в сдачу */}
                                    <div className="wh-cc-box">
                                      <div className="wh-cc-box__head">
                                        <Banknote size={13} /> Платежи за наличку
                                        <b>{fmt(income)} ₽</b>
                                      </div>
                                      {marked === 0 ? (
                                        <div className="wh-cc-empty">
                                          Платежи не размечены (старая сдача)
                                        </div>
                                      ) : (
                                        (c.items || []).map((it, i) => (
                                          <div key={`${c.id}-i${i}`} className="wh-cc-line">
                                            <button
                                              type="button"
                                              className="wh-cc-payment-link"
                                              onClick={() => setDetailPaymentId(it.paymentId)}
                                            >
                                              {it.number ? `ПЛ-${it.number} · ` : ""}
                                              {it.counterparty || "Без контрагента"}
                                            </button>
                                            <span className="wh-cc-line__val">
                                              {fmt(it.amount)} ₽
                                              {/* Разбитый платёж: показываем все части */}
                                              {(it.cashAmount != null ||
                                                it.cardAmount != null ||
                                                it.expenseAmount != null) &&
                                              (it.expenseAmount || 0) > 0 ? (
                                                <>
                                                  {(it.cashAmount || 0) > 0 && (
                                                    <span className="wh-cc-dest wh-cc-dest--cash">
                                                      <Banknote size={10} />{" "}
                                                      {fmt(it.cashAmount || 0)} нал
                                                    </span>
                                                  )}
                                                  {(it.cardAmount || 0) > 0 && (
                                                    <span className="wh-cc-dest wh-cc-dest--card">
                                                      <CreditCard size={10} />{" "}
                                                      {fmt(it.cardAmount || 0)} карта
                                                    </span>
                                                  )}
                                                  <span className="wh-cc-dest wh-cc-dest--exp">
                                                    <Wallet size={10} />{" "}
                                                    {fmt(it.expenseAmount || 0)} расход
                                                  </span>
                                                </>
                                              ) : (
                                                <span
                                                  className={`wh-cc-dest wh-cc-dest--${
                                                    it.kind === "cash" ? "cash" : "card"
                                                  }`}
                                                >
                                                  {it.kind === "cash" ? (
                                                    <>
                                                      <Banknote size={10} /> наличка
                                                    </>
                                                  ) : (
                                                    <>
                                                      <CreditCard size={10} /> на карту
                                                    </>
                                                  )}
                                                </span>
                                              )}
                                            </span>
                                          </div>
                                        ))
                                      )}
                                    </div>

                                    {/* Траты налом */}
                                    <div className="wh-cc-box">
                                      <div className="wh-cc-box__head">
                                        <Wallet size={13} /> Потрачено налом
                                        <b style={{ color: "var(--adm-rust)" }}>
                                          −{fmt(expSum)} ₽
                                        </b>
                                      </div>
                                      {exp.length === 0 ? (
                                        <div className="wh-cc-empty">Трат не было</div>
                                      ) : (
                                        exp.map((e, i) => (
                                          <div key={`${c.id}-e${i}`} className="wh-cc-line">
                                            <span>
                                              {e.title}
                                              {e.comment && (
                                                <span className="wh-cc-note"> · {e.comment}</span>
                                              )}
                                            </span>
                                            <span
                                              className="wh-cc-line__val"
                                              style={{ color: "var(--adm-rust)" }}
                                            >
                                              −{fmt(e.amount)} ₽
                                            </span>
                                          </div>
                                        ))
                                      )}
                                    </div>

                                    {/* Куда поступили деньги */}
                                    <div className="wh-cc-box">
                                      <div className="wh-cc-box__head">
                                        Куда поступили деньги
                                      </div>
                                      <div className="wh-cc-line">
                                        <span>
                                          <CreditCard size={11} /> Инкассация на карту
                                        </span>
                                        <span
                                          className="wh-cc-line__val"
                                          style={{ color: "var(--adm-steel)" }}
                                        >
                                          {fmt(transfer)} ₽
                                        </span>
                                      </div>
                                      <div className="wh-cc-line">
                                        <span>
                                          <Banknote size={11} /> Осталось в кассе
                                        </span>
                                        <span className="wh-cc-line__val">
                                          {fmt(cashPart)} ₽
                                        </span>
                                      </div>
                                      <div className="wh-cc-total">
                                        Приход {fmt(income)} ₽
                                        {expSum > 0 && <> − траты {fmt(expSum)} ₽</>} ={" "}
                                        <b>{fmt(Math.round(c.amount * 100) / 100)} ₽</b> размечено
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                            </React.Fragment>
                          );
                        })}
                        <tr className="wh-cashcollect__total">
                          <td style={{ fontWeight: 800 }}>Итого по сменам</td>
                          <td style={{ textAlign: "right", fontWeight: 800, color: "var(--adm-steel)" }}>
                            {fmt(collectedBreakdown.transfer)} ₽
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 800 }}>
                            {fmt(collectedBreakdown.cash)} ₽
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 800, color: "var(--adm-pine)" }}>
                            +{fmt(Math.round(collectionsTotal * 100) / 100)} ₽
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
          {bankSub === "history" &&
            (collectionsSorted.length > 0 || legacyCashClosures.length > 0) && (
              <div className="admin-card bank-cash-postings">
                <div className="admin-card__head">
                  <div>
                    <h3 className="admin-card__title">
                      <Banknote size={15} style={{ verticalAlign: "middle", marginRight: 7 }} />
                      Проведённые сдачи кассы
                    </h3>
                    <div className="admin-muted" style={{ marginTop: 3, fontSize: 10 }}>
                      Отдельные документы кассы — не банковские платежи
                    </div>
                  </div>
                  <span className="admin-badge admin-badge--muted">
                    {collectionsSorted.length + legacyCashClosures.length} док.
                  </span>
                </div>
                <div className="bank-cash-postings__list">
                  {legacyCashClosures.map((closure) => (
                    <div key={closure.id} className="bank-cash-posting bank-cash-posting--legacy">
                      <span className="bank-cash-posting__icon"><Archive size={15} /></span>
                      <div className="bank-cash-posting__main">
                        <div className="bank-cash-posting__top">
                          <strong>Сдача кассы без инкассации · старое проведение</strong>
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
                  {collectionsSorted.map((collection) => {
                    const noAccounting = (collection.items || []).some(
                      (item) => item.noAccounting
                    );
                    const documentAmount = noAccounting
                      ? (collection.items || []).reduce(
                          (sum, item) => sum + (item.amount || 0),
                          0
                        )
                      : collection.amount;
                    return (
                      <div key={collection.id} className="bank-cash-posting">
                        <span className="bank-cash-posting__icon"><Banknote size={15} /></span>
                        <div className="bank-cash-posting__main">
                          <div className="bank-cash-posting__top">
                            <strong>
                              {noAccounting
                                ? "Закрытие старых платежей без движения денег"
                                : "Сдача кассы"}
                            </strong>
                            <span className="admin-badge admin-badge--green">проведено</span>
                            {noAccounting && (
                              <span className="admin-badge admin-badge--blue">без учёта</span>
                            )}
                          </div>
                          <div className="bank-cash-posting__meta">
                            <span>{fmtDate(collection.date)}</span>
                            <span>{(collection.items || []).length} платежей</span>
                            {!noAccounting && (
                              <>
                                <span>на карту {fmt(collection.transferAmount || 0)} ₽</span>
                                <span>в кассе {fmt(collection.cashAmount || 0)} ₽</span>
                              </>
                            )}
                            {collection.note && <span>{collection.note}</span>}
                          </div>
                        </div>
                        <strong className="bank-cash-posting__amount">{fmt(documentAmount)} ₽</strong>
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost admin-btn--sm"
                          disabled={collecting}
                          onClick={() =>
                            handleDeleteCollection(collection.id, noAccounting)
                          }
                        >
                          <RotateCcw size={12} /> Отменить проведение
                        </button>
                      </div>
                    );
                  })}
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
                {g.items.map((p) => (
                  <div
                    key={p.id}
                    id={`payment-${p.id}`}
                    className={`bank-pay${!p.isPaid ? " bank-pay--pending" : ""}${p.entryKind === "payment" ? " payment-clickable" : ""}`}
                    role={p.entryKind === "payment" ? "button" : undefined}
                    tabIndex={p.entryKind === "payment" ? 0 : undefined}
                    onClick={(event) => {
                      if (p.entryKind !== "payment") return;
                      if ((event.target as HTMLElement).closest("a,button,input,label,select")) return;
                      setDetailPaymentId(p.id);
                    }}
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
                ))}
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
