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

type TabKey = "stock" | "deals" | "bank" | "salaries" | "counterparties";
type StockSub = "stock" | "receipts" | "archive";
type DealsSub = "new" | "released";
type BankSub = "pending" | "history";

interface WarehouseManagerProps {
  adminPath: string;
  initialTab: TabKey;
  initialSub: StockSub;
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
}

export function WarehouseManager({
  adminPath,
  initialTab,
  initialSub,
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
}: WarehouseManagerProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [stockSub, setStockSub] = useState<StockSub>(initialSub);
  const [dealsSub, setDealsSub] = useState<DealsSub>("new");
  const [bankSub, setBankSub] = useState<BankSub>("pending");

  // Filters
  const [q, setQ] = useState(""); // Stock/Deals query
  const [bq, setBq] = useState(""); // Bank query
  const [bdir, setBdir] = useState("all");
  const [bsort, setBsort] = useState<"asc" | "desc">("desc");

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

  // Filtered Deals
  const filteredDeals = useMemo(() => {
    const query = q.toLowerCase().trim();
    return deals.filter((d) => {
      const paid = dealPaidMap.get(d.id) || 0;
      const isFullyPaid = d.total > 0 && paid + 0.009 >= d.total;

      // В "Новые" попадают: все статуса 'new' + отпущенные ('completed'), но не оплаченные.
      // В "Архив" попадают: отпущенные ('completed') + оплаченные, а также отмененные.
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

  const bankList = useMemo(() => {
    const query = bq.toLowerCase().trim();
    let list = payments.filter((p) => {
      const matchesTab = bankSub === "pending" ? !p.isPaid : p.isPaid;
      if (!matchesTab) return false;
      if (bdir !== "all" && p.direction !== bdir) return false;
      if (query) {
        const hay = [
          p.counterparty,
          p.comment || "",
          p.invoiceNumber || "",
          `пл-${p.number}`,
          `ПЛ-${p.number}`.toLowerCase(),
          ...p.dealNumbers.map((n) => `зк-${n}`),
          ...p.receiptNumbers.map((n) => `по-${n}`),
        ]
          .join(" ")
          .toLowerCase();
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
  }, [payments, bankSub, bq, bdir, bsort]);

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
    const groups: { key: string; label: string; items: BankPayment[] }[] = [];
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
    { key: "deals", label: "Заказы", icon: <ClipboardList size={13} /> },
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
      deals.map((d) => ({
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
        <div className="admin-page-head__actions">
          {activeTab === "stock" && stockSub === "receipts" && (
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

      <div className="admin-filters">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`admin-filter${activeTab === t.key ? " admin-filter--active" : ""}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ════════════ ВКЛАДКА: СКЛАД ════════════ */}
      {activeTab === "stock" && (
        <>
          <div className="admin-filters admin-filters--sub">
            <button
              onClick={() => setStockSub("stock")}
              className={`admin-filter${stockSub === "stock" ? " admin-filter--active" : ""}`}
            >
              <Boxes size={12} />
              Остатки
            </button>
            <button
              onClick={() => setStockSub("receipts")}
              className={`admin-filter${stockSub === "receipts" ? " admin-filter--active" : ""}`}
            >
              <Truck size={12} />
              Поступления
            </button>
            <button
              onClick={() => setStockSub("archive")}
              className={`admin-filter${stockSub === "archive" ? " admin-filter--active" : ""}`}
            >
              <Archive size={12} />
              Архив
            </button>
          </div>

          {stockSub === "stock" && (
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
                  <div className="admin-stat__label">
                    Оценка по ценам продажи
                  </div>
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
                  <button
                    onClick={() => setQ("")}
                    className="admin-btn admin-btn--ghost"
                  >
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
                          <th style={{ textAlign: "right" }}>Остаток</th>
                          <th style={{ textAlign: "right" }}>Цена продажи</th>
                          <th style={{ textAlign: "right" }}>Сумма</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStock.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <span className="wh-stock-product-name">
                                {p.name}
                              </span>
                              <Link
                                href={`/${adminPath}/warehouse?tab=stock&product=${p.id}#stock-origins`}
                                prefetch={false}
                                className="wh-stock-origin-link"
                              >
                                Откуда поступил →
                              </Link>
                              {!p.isVisible && (
                                <span
                                  className="admin-badge admin-badge--muted"
                                  style={{ marginLeft: 6 }}
                                >
                                  скрыт
                                </span>
                              )}
                            </td>
                            <td>{p.sku || "—"}</td>
                            <td style={{ textAlign: "right" }}>
                              <StockQtyEditor
                                productId={p.id}
                                initialQty={p.stockQty}
                              />
                            </td>
                            <td
                              style={{ textAlign: "right", whiteSpace: "nowrap" }}
                            >
                              {p.price != null ? `${fmt(p.price)} ₽` : "—"}
                            </td>
                            <td
                              style={{ textAlign: "right", whiteSpace: "nowrap" }}
                            >
                              {p.price != null
                                ? `${fmt(p.stockQty * p.price)} ₽`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="admin-empty">
                    <p>Товары не найдены</p>
                  </div>
                )}
              </div>
            </>
          )}

          {stockSub === "receipts" && (
            <div className="admin-card">
              {activeReceipts.length > 0 ? (
                activeReceipts.map((r) => (
                  <ReceiptCard
                    key={r.id}
                    receipt={r}
                    paidAmount={receiptPaidMap.get(r.id) || 0}
                    products={pickerProducts}
                    counterparties={counterpartyOptions}
                    deals={deals}
                    payments={payments}
                  />
                ))
              ) : (
                <div className="admin-empty">
                  <div className="admin-empty__icon">
                    <Truck size={40} />
                  </div>
                  <p>Активных поступлений нет</p>
                  <p className="admin-empty__hint">
                    Новые поступления появляются здесь. Проведённые
                    автоматически попадают в Архив.
                  </p>
                </div>
              )}
            </div>
          )}

          {stockSub === "archive" && (
            <div className="admin-card">
              {archivedReceipts.length > 0 ? (
                archivedReceipts.map((r) => (
                  <ReceiptCard
                    key={r.id}
                    receipt={r}
                    paidAmount={receiptPaidMap.get(r.id) || 0}
                    products={pickerProducts}
                    counterparties={counterpartyOptions}
                    deals={deals}
                    payments={payments}
                  />
                ))
              ) : (
                <div className="admin-empty">
                  <div className="admin-empty__icon">
                    <Archive size={40} />
                  </div>
                  <p>В архиве пусто</p>
                  <p className="admin-empty__hint">
                    Сюда попадают проведённые поступления. Отмена проведения
                    вернёт поступление обратно в список (товар спишется со
                    склада).
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ════════════ ВКЛАДКА: ЗАКАЗЫ ════════════ */}
      {activeTab === "deals" && (
        <>
          <div className="admin-filters admin-filters--sub">
            <button
              onClick={() => setDealsSub("new")}
              className={`admin-filter${dealsSub === "new" ? " admin-filter--active" : ""}`}
            >
              <ClipboardList size={12} />
              Новые заказы
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
                          return {
                            it,
                            available,
                            missing: Math.max(0, it.quantity - available),
                          };
                        })
                        .filter((r) => r.missing > 0)
                      : [];
                const hasShortage = shortage.length > 0;
                return (
                  <div key={d.id} className="admin-order">
                    <div className="admin-order__row">
                      <div className="admin-order__main">
                        <div className="admin-order__top">
                          <span className="admin-order__id">ЗК-{d.number}</span>
                          <span className={dealStatusBadge[d.status]}>
                            {dealStatusLabel[d.status]}
                          </span>
                          {isFullyPaid ? (
                            <span className="admin-badge admin-badge--green">
                              Оплачен
                            </span>
                          ) : (
                            <span className="admin-badge admin-badge--red" style={{ fontWeight: 800 }}>
                              <AlertTriangle size={10} style={{ marginRight: 4 }} />
                              Клиент не оплатил!
                            </span>
                          )}
                          {!isFullyPaid && paid > 0 && (
                            <span className="admin-badge admin-badge--blue">
                              Оплачено {fmt(paid)} из {fmt(d.total)} ₽
                            </span>
                          )}
                          <span className="admin-order__date">
                            {fmtDate(d.date)}
                          </span>
                        </div>

                        <div className="admin-order__grid">
                          <div className="admin-order__meta">
                            <span className="admin-order__meta-label wh-meta-label">
                              Покупатель:
                            </span>
                            <span className="admin-order__meta-val">
                              {d.customerName}
                            </span>
                          </div>
                        </div>

                        <div className="admin-order__items">
                          <div className="admin-order__items-title">Товары</div>
                          {d.items.map((it, idx) => (
                            <div key={idx} className="admin-order__item">
                              <span>
                                {it.name} × {it.quantity}
                              </span>
                              <span className="admin-order__item-sum">
                                {fmt(it.lineTotal)} ₽
                              </span>
                            </div>
                          ))}
                          <div className="admin-order__total">
                            <span>Итого (с НДС)</span>
                            <span>{fmt(d.total)} ₽</span>
                          </div>
                        </div>

                        {d.status === "new" &&
                          (hasShortage ? (
                            <div className="deal-stock deal-stock--miss">
                              <div className="deal-stock__title">
                                <AlertTriangle size={12} />
                                Не хватает на складе
                              </div>
                              {shortage.map((r) => (
                                <div
                                  key={r.it.productId}
                                  className="deal-stock__row"
                                >
                                  <span className="deal-stock__name">
                                    {r.it.name}
                                  </span>
                                  <span className="deal-stock__nums">
                                    нужно {r.it.quantity} · на складе{" "}
                                    {r.available} ·{" "}
                                    <b>не хватает {r.missing}</b>
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="deal-stock deal-stock--ok">
                              <PackageCheck size={13} />
                              Все позиции есть на складе
                            </div>
                          ))}
                      </div>

                      <div className="admin-order__side">
                        <DealForm
                          products={pickerProducts}
                          counterparties={counterpartyOptions}
                          payments={payments}
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
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="admin-empty">
                <p>В этом списке пока пусто</p>
              </div>
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
                          {p.type && p.type !== "regular" && (
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
                          {p.counterparty}
                        </span>
                        <span className="bank-pay__num">
                          {p.invoiceNumber || `ПЛ-${p.number}`}
                        </span>
                        {p.invoiceNumber && (
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
                        {p.isPaid && p.excludeFromBalance && (
                          <span className="admin-badge admin-badge--muted" style={{ marginLeft: 6 }}>
                            архив (вне баланса)
                          </span>
                        )}
                      </div>
                      <div className="bank-pay__row2">
                        {(p.dealNumbers.length > 0 ||
                          p.receiptNumbers.length > 0) && (
                          <span className="bank-pay__links">
                            {p.dealNumbers.map((n) => (
                              <span key={`d${n}`} className="bank-pay__doc">
                                ЗК-{n}
                              </span>
                            ))}
                            {p.receiptNumbers.map((n) => (
                              <span key={`r${n}`} className="bank-pay__doc">
                                ПО-{n}
                              </span>
                            ))}
                          </span>
                        )}
                        <span className="bank-pay__date">{fmtDate(p.date)}</span>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: "var(--adm-pine)",
                          }}
                        >
                          В т.ч. НДС {p.vatRate}%: {fmt(p.vatAmount)} ₽
                        </div>
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
