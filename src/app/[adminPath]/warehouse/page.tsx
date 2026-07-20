// =========================================================
// FILE: src/app/[adminPath]/warehouse/page.tsx
// Учёт: Склад (остатки + поступления), Заказы, Банк
// =========================================================

import Link from "next/link";
import { notFound } from "next/navigation";
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
} from "lucide-react";
import {
  getWarehouseStock,
  getReceipts,
  getReceiptById,
  getDeals,
  getPayments,
  getBankSummary,
  getDealPaidMap,
  getReceiptPaidMap,
  getCounterpartyBalances,
  getCounterparties,
  getProductStockOrigins,
  type BankPayment,
} from "@/lib/warehouse";
import {
  ReceiptForm,
  ReceiptPostButton,
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

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

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

type TabKey = "stock" | "deals" | "bank" | "counterparties";
type StockSub = "stock" | "receipts";

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

export default async function AdminWarehousePage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{
    tab?: string;
    sub?: string;
    q?: string;
    bq?: string;
    bdir?: string;
    bstat?: string;
    bsort?: string;
    product?: string;
    receipt?: string;
  }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const sp = await searchParams;
  const activeTab: TabKey = (
    ["stock", "deals", "bank", "counterparties"] as const
  ).includes(
    sp.tab as TabKey
  )
    ? (sp.tab as TabKey)
    : "stock";
  const stockSub: StockSub = sp.sub === "receipts" ? "receipts" : "stock";
  const query = (sp.q || "").toLowerCase().trim();

  // Фильтры банка
  const bq = (sp.bq || "").toLowerCase().trim();
  const bdir = sp.bdir === "incoming" || sp.bdir === "outgoing" ? sp.bdir : "all";
  const bstat = sp.bstat === "paid" || sp.bstat === "pending" ? sp.bstat : "all";
  const bsort = sp.bsort === "asc" ? "asc" : "desc";

  const selectedProductId =
    activeTab === "stock" && stockSub === "stock"
      ? String(sp.product || "").trim()
      : "";
  const selectedReceiptId = String(sp.receipt || "").trim();

  // Каждая вкладка читает только собственные коллекции. Раньше любой переход
  // в «Учёт» одновременно загружал товары, все поступления, заказы, платежи
  // и повторно те же документы через контрагентов.
  const needStock = activeTab === "stock" || activeTab === "deals";
  const needReceipts =
    (activeTab === "stock" && stockSub === "receipts") ||
    activeTab === "bank" ||
    activeTab === "counterparties";
  const needDeals =
    activeTab === "deals" ||
    activeTab === "bank" ||
    activeTab === "counterparties";
  const needPayments =
    activeTab === "deals" ||
    activeTab === "bank" ||
    (activeTab === "stock" && stockSub === "receipts");
  const needCounterparties =
    activeTab === "deals" ||
    activeTab === "bank" ||
    activeTab === "counterparties" ||
    (activeTab === "stock" && stockSub === "receipts");

  const [
    stock,
    loadedReceipts,
    deals,
    payments,
    counterpartyRows,
    stockOrigins,
    focusedReceipt,
  ] = await Promise.all([
    needStock ? getWarehouseStock() : Promise.resolve([]),
    needReceipts ? getReceipts() : Promise.resolve([]),
    needDeals ? getDeals() : Promise.resolve([]),
    needPayments ? getPayments() : Promise.resolve([]),
    needCounterparties
      ? getCounterparties({
          includeSupplierPrices:
            activeTab === "stock" && stockSub === "receipts",
        })
      : Promise.resolve([]),
    selectedProductId
      ? getProductStockOrigins(selectedProductId)
      : Promise.resolve([]),
    activeTab === "stock" && stockSub === "receipts" && selectedReceiptId
      ? getReceiptById(selectedReceiptId)
      : Promise.resolve(null),
  ]);
  const receipts =
    focusedReceipt &&
    !loadedReceipts.some((receipt) => receipt.id === focusedReceipt.id)
      ? [focusedReceipt, ...loadedReceipts]
      : loadedReceipts;

  const stockById = new Map(stock.map((p) => [p.id, p.stockQty]));
  const pickerProducts: PickerProduct[] = stock.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    priceWholesale: p.priceWholesale,
    stockQty: p.stockQty,
  }));

  const bankSummary = activeTab === "bank" ? getBankSummary(payments) : null;
  const dealPaidMap = getDealPaidMap(payments);
  const receiptPaidMap = getReceiptPaidMap(payments);
  const counterparties =
    activeTab === "bank"
      ? getCounterpartyBalances(deals, receipts, payments)
      : [];

  const counterpartyOptions: CounterpartyOption[] = counterpartyRows.map(
    (item) => ({
      id: item.id,
      name: item.name,
      roles: item.roles,
      supplierPrices: item.supplierPrices ?? {},
      phone: item.phone ?? null,
      email: item.email ?? null,
      inn: item.inn ?? null,
      kpp: item.kpp ?? null,
      address: item.address ?? null,
      contactName: item.contactName ?? null,
      comment: item.comment ?? null,
    })
  );
  const counterpartyDocuments: Record<string, CounterpartyDocument[]> = {};
  const normalizeName = (value: string) =>
    value.trim().toLocaleLowerCase("ru-RU").replace(/[«»"']/g, "").replace(/\s+/g, " ");
  for (const item of counterpartyRows) {
    counterpartyDocuments[item.id] = [
      ...deals
        .filter(
          (deal) =>
            deal.counterpartyId === item.id ||
            normalizeName(deal.customerName) === item.normalizedName
        )
        .map((deal) => ({
          id: deal.id,
          kind: "deal" as const,
          number: deal.number,
          date: deal.date,
          total: deal.total,
          status: dealStatusLabel[deal.status] || deal.status,
          itemCount: deal.items.length,
        })),
      ...receipts
        .filter(
          (receipt) =>
            receipt.counterpartyId === item.id ||
            normalizeName(receipt.supplier) === item.normalizedName
        )
        .map((receipt) => ({
          id: receipt.id,
          kind: "receipt" as const,
          number: receipt.number,
          date: receipt.date,
          total: receipt.total,
          status: null,
          itemCount: receipt.items.length,
        })),
    ].sort((a, b) => b.date.localeCompare(a.date));
  }

  const dealLinkOptions: DealLinkOption[] = deals.map((d) => ({
    id: d.id,
    number: d.number,
    date: d.date,
    customerName: d.customerName,
    total: d.total,
    status: d.status,
    paidAmount: dealPaidMap.get(d.id) || 0,
  }));

  const receiptLinkOptions: ReceiptLinkOption[] = receipts.map((r) => ({
    id: r.id,
    number: r.number,
    date: r.date,
    supplier: r.supplier,
    total: r.total,
    paidAmount: receiptPaidMap.get(r.id) || 0,
  }));

  // ── Склад / Остатки ──
  const filteredStock = query
    ? stock.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          (p.sku && p.sku.toLowerCase().includes(query))
      )
    : stock;
  const totalUnits = stock.reduce((s, p) => s + p.stockQty, 0);
  const stockValue = stock.reduce((s, p) => s + p.stockQty * (p.price ?? 0), 0);
  const zeroStock = stock.filter((p) => p.stockQty <= 0).length;
  const selectedStockProduct = selectedProductId
    ? stock.find((product) => product.id === selectedProductId) || null
    : null;
  const originsTotalQty = stockOrigins.reduce(
    (sum, origin) => sum + origin.quantity,
    0
  );
  const originsTotalSum = stockOrigins.reduce(
    (sum, origin) => sum + origin.lineTotal,
    0
  );

  // ── Банк: фильтрация, сортировка, группировка по месяцам ──
  let bankList: BankPayment[] = [];
  let bankFilteredIn = 0;
  let bankFilteredOut = 0;
  const bankGroups: { key: string; label: string; items: BankPayment[] }[] = [];
  if (activeTab === "bank") {
    bankList = payments.filter((p) => {
      if (bdir !== "all" && p.direction !== bdir) return false;
      if (bstat === "paid" && !p.isPaid) return false;
      if (bstat === "pending" && p.isPaid) return false;
      if (bq) {
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
        if (!hay.includes(bq)) return false;
      }
      return true;
    });
    bankList.sort((a, b) =>
      bsort === "asc"
        ? a.date.localeCompare(b.date) || a.number - b.number
        : b.date.localeCompare(a.date) || b.number - a.number
    );
    for (const p of bankList) {
      if (p.direction === "incoming") bankFilteredIn += p.amount;
      else bankFilteredOut += p.amount;
      const key = (p.date || "").slice(0, 7) || "unknown";
      const lastGroup = bankGroups[bankGroups.length - 1];
      if (lastGroup && lastGroup.key === key) {
        lastGroup.items.push(p);
      } else {
        bankGroups.push({
          key,
          label: key === "unknown" ? "Без даты" : monthLabel(key),
          items: [p],
        });
      }
    }
  }

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
          <Link
            key={t.key}
            href={`/${ADMIN_PATH}/warehouse?tab=${t.key}`}
            className={`admin-filter${activeTab === t.key ? " admin-filter--active" : ""}`}
           prefetch={false}>
            {t.icon}
            {t.label}
          </Link>
        ))}
      </div>

      {/* ════════════ ВКЛАДКА: СКЛАД ════════════ */}
      {activeTab === "stock" && (
        <>
          <div className="admin-filters admin-filters--sub">
            <Link
              href={`/${ADMIN_PATH}/warehouse?tab=stock`}
              className={`admin-filter${stockSub === "stock" ? " admin-filter--active" : ""}`}
             prefetch={false}>
              <Boxes size={12} />
              Остатки
            </Link>
            <Link
              href={`/${ADMIN_PATH}/warehouse?tab=stock&sub=receipts`}
              className={`admin-filter${stockSub === "receipts" ? " admin-filter--active" : ""}`}
             prefetch={false}>
              <Truck size={12} />
              Поступления
            </Link>
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

              {selectedStockProduct && (
                <section className="stock-origins" id="stock-origins">
                  <div className="stock-origins__head">
                    <div>
                      <span className="stock-origins__eyebrow">
                        История поступлений товара
                      </span>
                      <h2>{selectedStockProduct.name}</h2>
                      <p>
                        Артикул: {selectedStockProduct.sku || "—"} · текущий
                        остаток: <strong>{fmt(selectedStockProduct.stockQty)} шт.</strong>
                      </p>
                    </div>
                    <Link
                      href={`/${ADMIN_PATH}/warehouse?tab=stock`}
                      prefetch={false}
                      className="admin-btn admin-btn--ghost"
                    >
                      Закрыть
                    </Link>
                  </div>
                  <div className="stock-origins__summary">
                    <span>
                      Поставок: <strong>{stockOrigins.length}</strong>
                    </span>
                    <span>
                      Поступило: <strong>{fmt(originsTotalQty)} шт.</strong>
                    </span>
                    <span>
                      На сумму: <strong>{fmt(originsTotalSum)} ₽</strong>
                    </span>
                  </div>
                  {stockOrigins.length > 0 ? (
                    <div className="admin-table-wrap">
                      <table className="admin-table stock-origins__table">
                        <thead>
                          <tr>
                            <th>Поступление</th>
                            <th>Дата</th>
                            <th>Поставщик</th>
                            <th style={{ textAlign: "right" }}>Количество</th>
                            <th style={{ textAlign: "right" }}>Цена</th>
                            <th style={{ textAlign: "right" }}>Сумма</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stockOrigins.map((origin) => (
                            <tr key={origin.id}>
                              <td>
                                <Link
                                  href={`/${ADMIN_PATH}/warehouse?tab=stock&sub=receipts&receipt=${origin.receiptId}#receipt-${origin.receiptId}`}
                                  prefetch={false}
                                  className="stock-origin-link"
                                >
                                  ПО-{origin.receiptNumber} →
                                </Link>
                              </td>
                              <td>{fmtDate(origin.date)}</td>
                              <td>{origin.supplier || "—"}</td>
                              <td style={{ textAlign: "right" }}>
                                {fmt(origin.quantity)} шт.
                              </td>
                              <td style={{ textAlign: "right" }}>
                                {fmt(origin.unitPrice)} ₽
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <strong>{fmt(origin.lineTotal)} ₽</strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="stock-origins__empty">
                      Проведённых поступлений этого товара пока нет.
                    </div>
                  )}
                </section>
              )}

              <form
                method="GET"
                action={`/${ADMIN_PATH}/warehouse`}
                style={{ display: "flex", gap: 8, marginBottom: 14 }}
              >
                <input type="hidden" name="tab" value="stock" />
                <input
                  type="text"
                  name="q"
                  defaultValue={sp.q || ""}
                  placeholder="Поиск по названию или артикулу..."
                  className="admin-input"
                />
                <button type="submit" className="admin-btn admin-btn--navy">
                  Найти
                </button>
                {sp.q && (
                  <Link
                    href={`/${ADMIN_PATH}/warehouse?tab=stock`}
                    className="admin-btn admin-btn--ghost"
                   prefetch={false}>
                    Сбросить
                  </Link>
                )}
              </form>

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
                              <span className="wh-stock-product-name">{p.name}</span>
                              <Link
                                href={`/${ADMIN_PATH}/warehouse?tab=stock&product=${p.id}#stock-origins`}
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
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              {p.price != null ? `${fmt(p.price)} ₽` : "—"}
                            </td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
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
                    <div
                      key={r.id}
                      id={`receipt-${r.id}`}
                      className={`admin-order${
                        selectedReceiptId === r.id
                          ? " admin-order--highlighted"
                          : ""
                      }`}
                    >
                      <div className="admin-order__row">
                        <div className="admin-order__main">
                          <div className="admin-order__top">
                            <span className="admin-order__id">ПО-{r.number}</span>
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
                            <div className="admin-order__meta">
                              <span className="admin-order__meta-label wh-meta-label">
                                Позиций:
                              </span>
                              <span className="admin-order__meta-val">
                                {r.items.length}
                              </span>
                            </div>
                            {r.contactName && (
                              <div className="admin-order__meta">
                                <span className="admin-order__meta-label wh-meta-label">
                                  Контакт:
                                </span>
                                <span className="admin-order__meta-val">
                                  {r.contactName}
                                </span>
                              </div>
                            )}
                            {r.phone && (
                              <div className="admin-order__meta">
                                <span className="admin-order__meta-label wh-meta-label">
                                  Телефон:
                                </span>
                                <a href={`tel:${r.phone}`}>{r.phone}</a>
                              </div>
                            )}
                            {r.inn && (
                              <div className="admin-order__meta">
                                <span className="admin-order__meta-label wh-meta-label">
                                  ИНН:
                                </span>
                                <span className="admin-order__meta-val">
                                  {r.inn}{r.kpp ? ` · КПП ${r.kpp}` : ""}
                                </span>
                              </div>
                            )}
                            {r.address && (
                              <div className="admin-order__meta">
                                <span className="admin-order__meta-label wh-meta-label">
                                  Адрес:
                                </span>
                                <span className="admin-order__meta-val">
                                  {r.address}
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
                            {Math.abs(r.bankAdjustment) > 0.009 && (
                              <div className="admin-order__item admin-order__item--adjustment">
                                <span>Корректировка по фактической оплате</span>
                                <span className="admin-order__item-sum">
                                  {r.bankAdjustment > 0 ? "+" : ""}
                                  {fmt(r.bankAdjustment)} ₽
                                </span>
                              </div>
                            )}
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
                  <p className="admin-empty__hint">
                    Оформите поступление — связанный счёт появится в банке.
                    Товар добавится на склад только после оплаты счёта и
                    ручного проведения поступления.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ════════════ ВКЛАДКА: ЗАКАЗЫ ════════════ */}
      {activeTab === "deals" && (
        <div className="admin-card">
          {deals.length > 0 ? (
            deals.map((d) => {
              const paid = dealPaidMap.get(d.id) || 0;
              const isFullyPaid = d.total > 0 && paid >= d.total;
              // Нехватка товара — актуальна для неотпущенных заказов
              // (по отпущенным остаток уже списан)
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
                        {d.customerPhone && (
                          <div className="admin-order__meta">
                            <span className="admin-order__meta-label wh-meta-label">
                              Телефон:
                            </span>
                            <a href={`tel:${d.customerPhone}`}>
                              {d.customerPhone}
                            </a>
                          </div>
                        )}
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label wh-meta-label">
                            Оплата:
                          </span>
                          <span className="admin-order__meta-val">
                            {isFullyPaid ? (
                              "Клиент оплатил полностью"
                            ) : paid > 0 ? (
                              <>
                                Оплачено частично: {fmt(paid)} из{" "}
                                {fmt(d.total)} ₽
                              </>
                            ) : (
                              "Не оплачен"
                            )}
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
                        {Math.abs(d.bankAdjustment) > 0.009 && (
                          <div className="admin-order__item admin-order__item--adjustment">
                            <span>Корректировка по банковскому платежу</span>
                            <span className="admin-order__item-sum">
                              {d.bankAdjustment > 0 ? "+" : ""}
                              {fmt(d.bankAdjustment)} ₽
                            </span>
                          </div>
                        )}
                        <div className="admin-order__total">
                          <span>
                            Итого (с НДС)
                            <small className="wh-vat-note">
                              НДС {d.vatRate}%: {fmt(d.vatAmount)} ₽
                            </small>
                          </span>
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

                      {d.comment && (
                        <div className="admin-order__comment">
                          <strong>Комментарий</strong>
                          {d.comment}
                        </div>
                      )}
                      {d.cancelReason && (
                        <div className="admin-order__close-reason">
                          Причина отмены: {d.cancelReason}
                        </div>
                      )}
                    </div>

                    <div className="admin-order__side">
                      {d.status !== "cancelled" && (
                        <DealForm
                          products={pickerProducts}
                          counterparties={counterpartyOptions}
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
                      )}
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
              <div className="admin-empty__icon">
                <ClipboardList size={40} />
              </div>
              <p>Заказов пока нет</p>
              <p className="admin-empty__hint">
                Создайте заказ покупателя — цены подставятся из каталога, их
                можно изменить вручную.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ════════════ ВКЛАДКА: КОНТРАГЕНТЫ ════════════ */}
      {activeTab === "counterparties" && (
        <CounterpartiesManager
          initialCounterparties={counterpartyOptions}
          documents={counterpartyDocuments}
        />
      )}

      {/* ════════════ ВКЛАДКА: БАНК (отдельный инструмент) ════════════ */}
      {activeTab === "bank" && bankSummary && (
        <div className="bank">
          {/* Тёмная панель баланса */}
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
                Учитываются только проведённые платежи
              </div>
            </div>
            <div className="bank-hero__stats">
              <div className="bank-hero__stat bank-hero__stat--in">
                <ArrowDownLeft size={15} />
                <div>
                  <span>Ожидается поступление</span>
                  <strong>+{fmt(bankSummary.expectedIn)} ₽</strong>
                </div>
              </div>
              <div className="bank-hero__stat bank-hero__stat--out">
                <ArrowUpRight size={15} />
                <div>
                  <span>К оплате (исходящие)</span>
                  <strong>−{fmt(bankSummary.expectedOut)} ₽</strong>
                </div>
              </div>
              <div className="bank-hero__stat bank-hero__stat--plan">
                <Wallet size={15} />
                <div>
                  <span>Прогноз с ожидаемыми</span>
                  <strong>
                    {fmt(
                      bankSummary.balance +
                        bankSummary.expectedIn -
                        bankSummary.expectedOut
                    )}{" "}
                    ₽
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {/* Баланс по контрагентам */}
          {counterparties.length > 0 && (
            <div className="bank-due">
              <div className="bank-due__group">
                <div className="bank-due__title">
                  Покупатели <span>долг нам</span>
                </div>
                {counterparties.filter((c) => c.type === "customer").length ===
                0 ? (
                  <div className="bank-due__empty">Нет покупателей</div>
                ) : (
                  counterparties
                    .filter((c) => c.type === "customer")
                    .map((c) => (
                      <div key={`c-${c.name}`} className="bank-due__row">
                        <div className="bank-due__name">
                          {c.name}
                          <span className="bank-due__meta">
                            заказов: {c.docsCount}
                            {c.lastPaymentDate &&
                              ` · последний платёж ${fmtDate(c.lastPaymentDate)}`}
                          </span>
                        </div>
                        <div
                          className={`bank-due__sum ${
                            c.balance > 0.009
                              ? "bank-due__sum--debt"
                              : "bank-due__sum--clear"
                          }`}
                        >
                          {c.balance > 0.009 ? `${fmt(c.balance)} ₽` : "0 ₽"}
                        </div>
                      </div>
                    ))
                )}
              </div>

              <div className="bank-due__group">
                <div className="bank-due__title">
                  Поставщики <span>мы должны</span>
                </div>
                {counterparties.filter((c) => c.type === "supplier").length ===
                0 ? (
                  <div className="bank-due__empty">Нет поставщиков</div>
                ) : (
                  counterparties
                    .filter((c) => c.type === "supplier")
                    .map((c) => (
                      <div key={`s-${c.name}`} className="bank-due__row">
                        <div className="bank-due__name">
                          {c.name}
                          <span className="bank-due__meta">
                            поступлений: {c.docsCount}
                            {c.lastPaymentDate &&
                              ` · последний платёж ${fmtDate(c.lastPaymentDate)}`}
                          </span>
                        </div>
                        <div
                          className={`bank-due__sum ${
                            c.balance > 0.009
                              ? "bank-due__sum--debt"
                              : "bank-due__sum--clear"
                          }`}
                        >
                          {c.balance > 0.009 ? `${fmt(c.balance)} ₽` : "0 ₽"}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}

          {/* Панель работы: поиск, фильтры, сортировка */}
          <form
            method="GET"
            action={`/${ADMIN_PATH}/warehouse`}
            className="bank-toolbar"
          >
            <input type="hidden" name="tab" value="bank" />
            <input
              type="text"
              name="bq"
              defaultValue={sp.bq || ""}
              placeholder="Поиск: контрагент, № счёта, ЗК/ПО, комментарий..."
              className="admin-input bank-toolbar__search"
            />
            <select
              name="bdir"
              defaultValue={bdir}
              className="admin-select bank-toolbar__select"
            >
              <option value="all">Все операции</option>
              <option value="incoming">Только поступления</option>
              <option value="outgoing">Только расходы</option>
            </select>
            <select
              name="bstat"
              defaultValue={bstat}
              className="admin-select bank-toolbar__select"
            >
              <option value="all">Любой статус</option>
              <option value="paid">Проведённые</option>
              <option value="pending">В ожидании</option>
            </select>
            <button
              type="submit"
              name="bsort"
              value={bsort === "asc" ? "desc" : "asc"}
              className="admin-btn admin-btn--ghost bank-toolbar__sort"
              title="Переключить сортировку по дате"
            >
              {bsort === "desc" ? (
                <>
                  <ArrowDownWideNarrow size={14} /> Сначала новые
                </>
              ) : (
                <>
                  <ArrowUpNarrowWide size={14} /> Сначала старые
                </>
              )}
            </button>
            <button type="submit" className="admin-btn admin-btn--navy">
              Найти
            </button>
            {(sp.bq || bdir !== "all" || bstat !== "all") && (
              <Link
                href={`/${ADMIN_PATH}/warehouse?tab=bank`}
                className="admin-btn admin-btn--ghost"
               prefetch={false}>
                Сбросить
              </Link>
            )}
          </form>

          {(bq || bdir !== "all" || bstat !== "all") && (
            <div className="bank-totalbar">
              Найдено платежей: <strong>{bankList.length}</strong>
              <span className="bank-totalbar__sep" />
              Поступления: <strong className="bank-totalbar__in">+{fmt(bankFilteredIn)} ₽</strong>
              Расходы: <strong className="bank-totalbar__out">−{fmt(bankFilteredOut)} ₽</strong>
            </div>
          )}

          {/* Журнал платежей по месяцам */}
          {bankGroups.length > 0 ? (
            bankGroups.map((g) => (
              <div key={g.key} className="bank-month">
                <div className="bank-month__label">
                  {g.label}
                  <span className="bank-month__line" />
                </div>
                <div className="bank-month__list">
                  {g.items.map((p) => (
                    <div
                      key={p.id}
                      className={`bank-pay${
                        !p.isPaid ? " bank-pay--pending" : ""
                      }`}
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
                            {p.counterparty}
                          </span>
                          <span className="bank-pay__num">
                            {p.invoiceNumber || `ПЛ-${p.number}`}
                          </span>
                          {p.invoiceNumber && (
                            <span className="bank-pay__internal-num">
                              внутренний ПЛ-{p.number}
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
                          <span className="bank-pay__date">
                            {fmtDate(p.date)}
                            {p.isPaid && p.paidAt && p.paidAt !== p.date && (
                              <> · проведён {fmtDate(p.paidAt)}</>
                            )}
                          </span>
                        </div>
                        <div className="bank-pay__vat">
                          В том числе НДС {p.vatRate}%: {fmt(p.vatAmount)} ₽
                        </div>
                        {p.comment && (
                          <div className="bank-pay__comment">{p.comment}</div>
                        )}
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
            ))
          ) : (
            <div className="admin-card">
              <div className="admin-empty">
                <div className="admin-empty__icon">
                  <Wallet size={40} />
                </div>
                <p>Платежей не найдено</p>
                <p className="admin-empty__hint">
                  Добавьте поступление от покупателя или расход поставщику —
                  платёж встанет в ожидание, а кнопка «Провести» учтёт его в
                  балансе банка.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
