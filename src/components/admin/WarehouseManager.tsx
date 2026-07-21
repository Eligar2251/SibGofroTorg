"use client";

import { useState, useMemo } from "react";
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
  includedVat,
  VAT_RATE,
} from "@/lib/warehouse";
import {
  ReceiptForm,
  ReceiptPostButton,
  ReceiptCancelButton,
  ReceiptDeleteButton,
} from "@/components/admin/WarehouseReceipts";
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

type TabKey = "stock" | "deals" | "bank" | "counterparties";
type StockSub = "stock" | "receipts";

interface WarehouseManagerProps {
  adminPath: string;
  initialTab: TabKey;
  initialSub: StockSub;
  stock: WarehouseStockRow[];
  receipts: WarehouseReceipt[];
  deals: CustomerDeal[];
  payments: BankPayment[];
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
  counterpartyRows,
  pickerProducts,
  counterpartyOptions,
  counterpartyDocuments,
}: WarehouseManagerProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [stockSub, setStockSub] = useState<StockSub>(initialSub);

  // Filters
  const [q, setQ] = useState(""); // Stock/Deals query
  const [bq, setBq] = useState(""); // Bank query
  const [bdir, setBdir] = useState("all");
  const [bstat, setBstat] = useState("all");
  const [bsort, setBsort] = useState<"asc" | "desc">("desc");

  // Calculations
  const dealPaidMap = useMemo(() => getDealPaidMap(payments), [payments]);
  const receiptPaidMap = useMemo(() => getReceiptPaidMap(payments), [payments]);
  const bankSummary = useMemo(() => getBankSummary(payments), [payments]);
  
  const allCounterparties = useMemo(
    () => getCounterpartyBalances(deals, receipts, payments),
    [deals, receipts, payments]
  );

  // Filter counterparties to only show those with debt
  const counterpartiesWithDebt = useMemo(
    () => allCounterparties.filter((c) => Math.abs(c.balance) > 0.009),
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

  const bankList = useMemo(() => {
    const query = bq.toLowerCase().trim();
    let list = payments.filter((p) => {
      if (bdir !== "all" && p.direction !== bdir) return false;
      if (bstat === "paid" && !p.isPaid) return false;
      if (bstat === "pending" && p.isPaid) return false;
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
  }, [payments, bq, bdir, bstat, bsort]);

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
            />
          )}
          {activeTab === "deals" && (
            <DealForm
              products={pickerProducts}
              counterparties={counterpartyOptions}
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
              {receipts.length > 0 ? (
                receipts.map((r) => {
                  const paid = receiptPaidMap.get(r.id) || 0;
                  const isFullyPaid = r.total > 0 && paid >= r.total;
                  return (
                    <div key={r.id} id={`receipt-${r.id}`} className="admin-order">
                      <div className="admin-order__row">
                        <div className="admin-order__main">
                          <div className="admin-order__top">
                            <span className="admin-order__id">
                              ПО-{r.number}
                            </span>
                            <span className="admin-badge admin-badge--teal">
                              <Truck size={11} />
                              Поступление
                            </span>
                            <span
                              className={`admin-badge ${
                                r.status === "posted"
                                  ? "admin-badge--green"
                                  : "admin-badge--amber"
                              }`}
                            >
                              {r.status === "posted"
                                ? "На складе"
                                : "Не проведено"}
                            </span>
                            {isFullyPaid ? (
                              <span className="admin-badge admin-badge--green">
                                Оплачен
                              </span>
                            ) : paid > 0 ? (
                              <span className="admin-badge admin-badge--blue">
                                Оплачено {fmt(paid)} из {fmt(r.total)} ₽
                              </span>
                            ) : (
                              <span className="admin-badge admin-badge--amber">
                                Не оплачен
                              </span>
                            )}
                            <span className="admin-order__date">
                              {fmtDate(r.date)}
                            </span>
                          </div>

                          <div className="admin-order__grid">
                            <div className="admin-order__meta">
                              <span className="admin-order__meta-label wh-meta-label">
                                Поставщик:
                              </span>
                              <span className="admin-order__meta-val">
                                {r.supplier || "—"}
                              </span>
                            </div>
                            {r.inn && (
                              <div className="admin-order__meta">
                                <span className="admin-order__meta-label wh-meta-label">
                                  ИНН:
                                </span>
                                <span className="admin-order__meta-val">
                                  {r.inn}
                                  {r.kpp ? ` · КПП ${r.kpp}` : ""}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="admin-order__items">
                            <div className="admin-order__items-title">
                              Товары (с НДС)
                            </div>
                            {r.items.map((it, idx) => (
                              <div key={idx} className="admin-order__item">
                                <span>
                                  {it.name} × {it.quantity}
                                  <span className="wh-item-unit">
                                    {fmt(it.price)} ₽/шт
                                  </span>
                                </span>
                                <span className="admin-order__item-sum">
                                  {fmt(it.lineTotal)} ₽
                                </span>
                              </div>
                            ))}
                            <div className="admin-order__total">
                              <span>
                                Итого (с НДС)
                                <small className="wh-vat-note">
                                  НДС {r.vatRate}%: {fmt(r.vatAmount)} ₽
                                </small>
                              </span>
                              <span>{fmt(r.total)} ₽</span>
                            </div>
                          </div>

                          {r.comment && (
                            <div className="admin-order__comment">
                              <strong>Комментарий</strong>
                              {r.comment}
                            </div>
                          )}
                        </div>

                        <div className="admin-order__side">
                          <ReceiptForm
                            products={pickerProducts}
                            counterparties={counterpartyOptions}
                            initialReceipt={{
                              id: r.id,
                              date: r.date,
                              supplier: r.supplier,
                              phone: r.phone ?? null,
                              email: r.email ?? null,
                              inn: r.inn ?? null,
                              kpp: r.kpp ?? null,
                              address: r.address ?? null,
                              contactName: r.contactName ?? null,
                              comment: r.comment ?? null,
                              items: r.items.map((item) => ({
                                productId: item.productId,
                                name: item.name,
                                sku: item.sku ?? null,
                                quantity: item.quantity,
                                lineTotal: item.lineTotal,
                              })),
                            }}
                          />
                          {r.status === "draft" && (
                            <ReceiptPostButton
                              receiptId={r.id}
                              paidEnough={isFullyPaid}
                            />
                          )}
                          {r.status === "posted" && (
                            <ReceiptCancelButton receiptId={r.id} />
                          )}
                          <ReceiptDeleteButton receiptId={r.id} />
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="admin-empty">
                  <div className="admin-empty__icon">
                    <Truck size={40} />
                  </div>
                  <p>Поступлений пока нет</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ════════════ ВКЛАДКА: ЗАКАЗЫ ════════════ */}
      {activeTab === "deals" && (
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
                placeholder="Поиск по покупателю или номеру..."
                className="admin-input"
                style={{ paddingLeft: 36 }}
              />
            </div>
          </div>
          <div className="admin-card">
            {deals.length > 0 ? (
              deals
                .filter(
                  (d) =>
                    d.customerName.toLowerCase().includes(q.toLowerCase()) ||
                    String(d.number).includes(q)
                )
                .map((d) => {
                  const paid = dealPaidMap.get(d.id) || 0;
                  const isFullyPaid = d.total > 0 && paid >= d.total;
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
                            {isFullyPaid && (
                              <span className="admin-badge admin-badge--green">
                                Оплачен
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
                <p>Заказов пока нет</p>
              </div>
            )}
          </div>
        </>
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
              <div className="bank-hero__label">На счету (факт)</div>
              <div
                className={`bank-hero__value${
                  bankSummary.balance < 0 ? " bank-hero__value--neg" : ""
                }`}
              >
                {fmt(bankSummary.balance)} ₽
              </div>
              <div className="bank-hero__note">
                Из них <strong>{fmt(bankSummary.cashBalance)} ₽</strong> наличными
              </div>
            </div>
            <div className="bank-hero__stats">
              <div className="bank-hero__stat bank-hero__stat--in">
                <CreditCard size={15} />
                <div>
                  <span>Безналичный расчет</span>
                  <strong>{fmt(bankSummary.bankBalance)} ₽</strong>
                </div>
              </div>
              <div className="bank-hero__stat bank-hero__stat--plan">
                <Banknote size={15} />
                <div>
                  <span>Касса (наличные)</span>
                  <strong>{fmt(bankSummary.cashBalance)} ₽</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Unpaid Posted Receipts Block */}
          {unpaidPostedReceipts.length > 0 && (
            <div className="admin-card" style={{ border: "1px solid var(--adm-rust-line)", background: "var(--adm-rust-pale)" }}>
              <div className="admin-card__head" style={{ background: "transparent" }}>
                <h3 className="admin-card__title" style={{ color: "var(--adm-rust)" }}>
                  <AlertTriangle size={16} style={{ verticalAlign: "middle", marginRight: 8 }} />
                  Нужно оплатить поставщикам
                </h3>
              </div>
              <div className="admin-card__pad" style={{ paddingTop: 0 }}>
                <div className="bank-month__list">
                  {unpaidPostedReceipts.map((r) => {
                    const paid = receiptPaidMap.get(r.id) || 0;
                    return (
                      <div key={r.id} className="bank-pay" style={{ background: "#fff" }}>
                        <div className="bank-pay__icon bank-pay__icon--out">
                          <Truck size={17} />
                        </div>
                        <div className="bank-pay__main">
                          <div className="bank-pay__row1">
                            <span className="bank-pay__counterparty">{r.supplier}</span>
                            <span className="bank-pay__num">ПО-{r.number}</span>
                            <span className="admin-badge admin-badge--green">На складе</span>
                          </div>
                          <div className="bank-pay__row2">
                            <span className="bank-pay__date">Поступление от {fmtDate(r.date)}</span>
                          </div>
                        </div>
                        <div className="bank-pay__side">
                          <span className="bank-pay__amount bank-pay__amount--out">
                            {fmt(r.total - paid)} ₽
                          </span>
                          <div style={{ fontSize: 11, color: "var(--adm-sand)" }}>
                            остаток из {fmt(r.total)} ₽
                          </div>
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
                Покупатели <span>долг нам</span>
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
                          заказов: {c.docsCount}
                          {c.lastPaymentDate && ` · последний платёж ${fmtDate(c.lastPaymentDate)}`}
                        </span>
                      </div>
                      <div className="bank-due__sum bank-due__sum--debt">
                        {fmt(c.balance)} ₽
                      </div>
                    </div>
                  ))
              )}
            </div>

            <div className="bank-due__group">
              <div className="bank-due__title">
                Поставщики <span>мы должны</span>
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
                          поступлений: {c.docsCount}
                          {c.lastPaymentDate && ` · последний платёж ${fmtDate(c.lastPaymentDate)}`}
                        </span>
                      </div>
                      <div className="bank-due__sum bank-due__sum--debt">
                        {fmt(c.balance)} ₽
                      </div>
                    </div>
                  ))
              )}
            </div>
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
            <select
              className="admin-select bank-toolbar__select"
              value={bstat}
              onChange={(e) => setBstat(e.target.value)}
            >
              <option value="all">Любой статус</option>
              <option value="paid">Проведённые</option>
              <option value="pending">В ожидании</option>
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
            {(bq || bdir !== "all" || bstat !== "all") && (
              <button
                onClick={() => {
                  setBq("");
                  setBdir("all");
                  setBstat("all");
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
                          p.direction === "incoming"
                            ? "bank-pay__amount--in"
                            : "bank-pay__amount--out"
                        }`}
                      >
                        {p.direction === "incoming" ? "+" : "−"}
                        {fmt(p.amount)} ₽
                      </span>
                      <PaymentControls
                        paymentId={p.id}
                        isPaid={p.isPaid}
                        edit={{
                          date: p.date,
                          type: p.type,
                          counterparty: p.counterparty,
                          amount: p.amount,
                          invoiceNumber: p.invoiceNumber ?? null,
                          comment: p.comment ?? null,
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
