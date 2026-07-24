"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
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
} from "lucide-react";
import {
  type BankPayment,
  getBankSummary,
  getCounterpartyBalances,
  getDealPaidMap,
  getReceiptPaidMap,
  type WarehouseStockRow,
  type WarehouseReceipt,
  type CustomerDeal,
  type Counterparty,
  type Employee,
  type Salary,
  includedVat,
  VAT_RATE,
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
import {
  CounterpartiesManager,
  type CounterpartyDocument,
  type CounterpartyOption,
} from "@/components/admin/WarehouseCounterparties";
import { WarehouseSalaries } from "@/components/admin/WarehouseSalaries";
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

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  const s = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
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

type TabKey = "stock" | "receipts" | "deals" | "bank" | "salaries" | "counterparties" | "clients" | "suppliers" | "deliveries";
type StockSub = "stock" | "receipts" | "archive";
type SuppliesSub = "receipts" | "suppliers";
type ReceiptSub = "active" | "archive";
type DealsSub = "new" | "released";
type BankSub = "pending" | "history";
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
  companyPhone,
  companyAddress,
}: WarehouseManagerProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [stockSub, setStockSub] = useState<StockSub>(initialSub);
  const [suppliesSub, setSuppliesSub] = useState<SuppliesSub>("receipts");
  const [receiptSub, setReceiptSub] = useState<ReceiptSub>("active");
  const [dealsSub, setDealsSub] = useState<DealsSub>("new");
  const [expandedDealId, setExpandedDealId] = useState<string | null>(focusDealId ?? null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [procurementQuery, setProcurementQuery] = useState("");
  const [supplierPriceQuery, setSupplierPriceQuery] = useState("");
  const [supplierPriceDrafts, setSupplierPriceDrafts] = useState<Record<string, string>>({});
  const [supplierPriceSaving, setSupplierPriceSaving] = useState(false);
  const [procurementCart, setProcurementCart] = useState<ProcurementCartItem[]>([]);
  const [procurementSaving, setProcurementSaving] = useState(false);
  const [bankSub, setBankSub] = useState<BankSub>("pending");

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
      window.setTimeout(() => document.getElementById(`stock-${focusProductId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    } else if (focusPaymentId) {
      setActiveTab("bank");
      const payment = payments.find((item) => item.id === focusPaymentId);
      setBankSub(payment?.isPaid ? "history" : "pending");
      window.setTimeout(() => document.getElementById(`payment-${focusPaymentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    }
  }, [deals, focusDealId, focusPaymentId, focusProductId, focusReceiptId, payments, receipts]);

  // Filters
  const [q, setQ] = useState(""); // Stock/Deals query
  const [bq, setBq] = useState(""); // Bank query
  const [bdir, setBdir] = useState("all");
  const [bsort, setBsort] = useState<"asc" | "desc">("desc");

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
  const bankSummary = useMemo(
    () => getBankSummary(payments, salaries),
    [payments, salaries]
  );
  
  const allCounterparties = useMemo(
    () => getCounterpartyBalances(deals, receipts, payments),
    [deals, receipts, payments]
  );

  // Filter counterparties to only show those with positive debt (what is owed)
  const counterpartiesWithDebt = useMemo(
    () => allCounterparties.filter((c) => c.balance > 0.009),
    [allCounterparties]
  );

  // Find posted receipts that are not fully paid
  const unpaidPostedReceipts = useMemo(() => {
    return receipts.filter((r) => {
      const paid = receiptPaidMap.get(r.id) || 0;
      return r.status === "posted" && paid + 0.009 < r.total;
    });
  }, [receipts, receiptPaidMap]);

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
        String(d.number).includes(query)
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
      comment: salary.comment,
      salary,
    }));
    let list: BankEntry[] = [
      ...payments
        .filter((payment) => !payment.excludeFromBalance)
        .map((payment) => ({ ...payment, entryKind: "payment" as const })),
      ...salaryEntries,
    ].filter((p) => {
      const matchesTab = bankSub === "pending" ? !p.isPaid : p.isPaid;
      if (!matchesTab) return false;
      if (bdir !== "all" && p.direction !== bdir) return false;
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

    list.sort((a, b) =>
      bsort === "asc"
        ? a.date.localeCompare(b.date) || a.number - b.number
        : b.date.localeCompare(a.date) || b.number - a.number
    );
    return list;
  }, [payments, salaries, bankSub, bq, bdir, bsort]);

  const bankFilteredTotals = useMemo(() => {
    let inSum = 0;
    let outSum = 0;
    for (const p of bankList) {
      if (p.direction === "incoming") inSum += p.amount;
      else outSum += p.amount;
    }
    return { inSum, outSum };
  }, [bankList]);

  const bankGroups = useMemo(() => {
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
  const activeReceipts = useMemo(
    () => receipts.filter((r) => r.status !== "posted"),
    [receipts]
  );
  const archivedReceipts = useMemo(
    () => receipts.filter((r) => r.status === "posted"),
    [receipts]
  );

  return (
    <div>
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
                    {filteredStock.map((p) => (
                      <tr key={p.id} id={`stock-${p.id}`}>
                        <td>
                          <Link href={`/${adminPath}/products/${p.id}`} prefetch={false} className="wh-stock-product-name">
                            {p.name}
                          </Link>
                          <Link
                            href={`/${adminPath}/warehouse?tab=stock&product=${p.id}#stock-origins`}
                            prefetch={false}
                            className="wh-stock-origin-link"
                          >
                            Откуда поступил →
                          </Link>
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
                          <StockQtyEditor productId={p.id} initialQty={p.stockQty} />
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {p.price != null ? `${fmt(p.price)} ₽` : "—"}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {p.price != null ? `${fmt(p.stockQty * p.price)} ₽` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="admin-empty"><p>Товары не найдены</p></div>
            )}
          </div>
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
                placeholder="Поиск по покупателю или номеру..."
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
                <div className="bank-hero__value" style={{ color: '#fff' }}>
                  {fmt(bankSummary.cashBalance)} ₽
                </div>
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

          {/* Unpaid Posted Receipts Block */}
          {unpaidPostedReceipts.length > 0 && (
            <div className="admin-card" style={{ border: "1px solid var(--adm-rust-line)", background: "var(--adm-rust-pale)", marginBottom: 16 }}>
              <div className="admin-card__head" style={{ background: "transparent", borderBottom: "1px solid var(--adm-rust-line)" }}>
                <h3 className="admin-card__title" style={{ color: "var(--adm-rust)" }}>
                  <AlertTriangle size={16} style={{ verticalAlign: "middle", marginRight: 8 }} />
                  Нужно оплатить поставщикам
                </h3>
              </div>
              <div className="admin-card__pad">
                <div className="bank-month__list">
                  {unpaidPostedReceipts.map((r) => {
                    const paid = receiptPaidMap.get(r.id) || 0;
                    return (
                      <div key={r.id} className="bank-pay" style={{ background: "#fff", padding: "10px 14px" }}>
                        <div className="bank-pay__icon bank-pay__icon--out" style={{ width: 32, height: 32 }}>
                          <Truck size={15} />
                        </div>
                        <div className="bank-pay__main">
                          <div className="bank-pay__row1">
                            <span className="bank-pay__counterparty" style={{ fontSize: 13 }}>{r.supplier}</span>
                            <span className="bank-pay__num">ПО-{r.number}</span>
                          </div>
                          <div className="bank-pay__row2">
                            <span className="bank-pay__date">Поступление от {fmtDate(r.date)}</span>
                          </div>
                        </div>
                        <div className="bank-pay__side">
                          <span className="bank-pay__amount bank-pay__amount--out" style={{ fontSize: 16 }}>
                            {fmt(r.total - paid)} ₽
                          </span>
                        </div>
                      </div>
                    );
                  })}
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
                          {c.docsCount} док. · последний {fmtDate(c.lastPaymentDate)}
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
                          {c.docsCount} док. · последний {fmtDate(c.lastPaymentDate)}
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
          </div>

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
            {(bq || bdir !== "all") && (
              <button
                onClick={() => {
                  setBq("");
                  setBdir("all");
                }}
                className="admin-btn admin-btn--ghost"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="bank-totalbar">
            Найдено: <strong>{bankList.length}</strong>
            <span className="bank-totalbar__sep" />
            Приход: <strong className="bank-totalbar__in">+{fmt(bankFilteredTotals.inSum)} ₽</strong>
            Расход: <strong className="bank-totalbar__out">−{fmt(bankFilteredTotals.outSum)} ₽</strong>
          </div>

          {bankGroups.map((g) => (
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
                    className={`bank-pay${!p.isPaid ? " bank-pay--pending" : ""}`}
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
                        {p.entryKind === "payment" && p.isPaid && p.excludeFromBalance && (
                          <span className="admin-badge admin-badge--muted" style={{ marginLeft: 6 }}>
                            архив (вне баланса)
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
                            Зарплата · {p.source === "cash" ? "касса" : "банк"} · {p.isPaid ? "архив" : "к выплате"}
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
        </div>
      )}
    </div>
  );
}
