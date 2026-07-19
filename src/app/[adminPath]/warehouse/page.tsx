// =========================================================
// FILE: src/app/[adminPath]/warehouse/page.tsx
// Учёт: остатки склада, приходные ордера, заказы, банк
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
} from "lucide-react";
import {
  getWarehouseStock,
  getReceipts,
  getDeals,
  getPayments,
  getBankSummary,
  getDealPaidMap,
  type CustomerDeal,
} from "@/lib/warehouse";
import {
  ReceiptForm,
  ReceiptDeleteButton,
} from "@/components/admin/WarehouseReceipts";
import { DealForm, DealActions } from "@/components/admin/WarehouseDeals";
import { PaymentForm, PaymentControls } from "@/components/admin/WarehousePayments";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import type { DealLinkOption } from "@/components/admin/WarehousePayments";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("ru-RU");

function fmtDate(raw: string): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const dealStatusBadge: Record<string, string> = {
  new: "admin-badge admin-badge--amber",
  completed: "admin-badge admin-badge--green",
  cancelled: "admin-badge admin-badge--red",
};

const dealStatusLabel: Record<string, string> = {
  new: "Новый",
  completed: "Проведён",
  cancelled: "Отменён",
};

type TabKey = "stock" | "receipts" | "deals" | "payments";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "stock", label: "Остатки", icon: <Boxes size={13} /> },
  { key: "receipts", label: "Поступления", icon: <Truck size={13} /> },
  { key: "deals", label: "Заказы", icon: <ClipboardList size={13} /> },
  { key: "payments", label: "Банк", icon: <Wallet size={13} /> },
];

export default async function AdminWarehousePage({
  params,
  searchParams,
}: {
  params: Promise<{ adminPath: string }>;
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const sp = await searchParams;
  const activeTab: TabKey = (["stock", "receipts", "deals", "payments"] as const).includes(
    sp.tab as TabKey
  )
    ? (sp.tab as TabKey)
    : "stock";
  const query = (sp.q || "").toLowerCase().trim();

  // Данные под активную вкладку
  const stock = await getWarehouseStock();
  const pickerProducts: PickerProduct[] = stock.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    priceWholesale: p.priceWholesale,
    stockQty: p.stockQty,
  }));

  const receipts = activeTab === "receipts" ? await getReceipts() : [];
  const deals = activeTab === "deals" || activeTab === "payments" ? await getDeals() : [];
  const payments =
    activeTab === "payments" || activeTab === "deals" ? await getPayments() : [];
  const bankSummary = activeTab === "payments" ? getBankSummary(payments) : null;
  const dealPaidMap = getDealPaidMap(payments);

  const dealLinkOptions: DealLinkOption[] = deals.map((d: CustomerDeal) => ({
    id: d.id,
    number: d.number,
    date: d.date,
    customerName: d.customerName,
    total: d.total,
    status: d.status,
    paidAmount: dealPaidMap.get(d.id) || 0,
  }));

  // ── Остатки ──
  const filteredStock = query
    ? stock.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          (p.sku && p.sku.toLowerCase().includes(query))
      )
    : stock;
  const totalUnits = stock.reduce((s, p) => s + p.stockQty, 0);
  const stockValue = stock.reduce(
    (s, p) => s + p.stockQty * (p.price ?? 0),
    0
  );
  const zeroStock = stock.filter((p) => p.stockQty <= 0).length;

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
          {activeTab === "receipts" && (
            <ReceiptForm products={pickerProducts} />
          )}
          {activeTab === "deals" && <DealForm products={pickerProducts} />}
          {activeTab === "payments" && <PaymentForm deals={dealLinkOptions} />}
        </div>
      </div>

      <div className="admin-filters">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/${ADMIN_PATH}/warehouse?tab=${t.key}`}
            className={`admin-filter${activeTab === t.key ? " admin-filter--active" : ""}`}
          >
            {t.icon}
            {t.label}
          </Link>
        ))}
      </div>

      {/* ════════════ ВКЛАДКА: ОСТАТКИ ════════════ */}
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
              >
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
                          {p.name}
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
                          {p.stockQty <= 0 ? (
                            <span className="admin-badge admin-badge--red">
                              0
                            </span>
                          ) : (
                            <strong>{fmt(p.stockQty)}</strong>
                          )}
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
              <div className="admin-empty">
                <p>Товары не найдены</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════ ВКЛАДКА: ПОСТУПЛЕНИЯ ════════════ */}
      {activeTab === "receipts" && (
        <div className="admin-card">
          {receipts.length > 0 ? (
            receipts.map((r) => (
              <div key={r.id} className="admin-order">
                <div className="admin-order__row">
                  <div className="admin-order__main">
                    <div className="admin-order__top">
                      <span className="admin-order__id">ПО-{r.number}</span>
                      <span className="admin-badge admin-badge--teal">
                        <Truck size={11} />
                        Поступление
                      </span>
                      <span className="admin-order__date">{fmtDate(r.date)}</span>
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
                    </div>

                    <div className="admin-order__items">
                      <div className="admin-order__items-title">Товары</div>
                      {r.items.map((it, idx) => (
                        <div key={idx} className="admin-order__item">
                          <span>
                            {it.name} × {it.quantity}
                          </span>
                          <span className="admin-order__item-sum">
                            {fmt(it.quantity * it.price)} ₽
                          </span>
                        </div>
                      ))}
                      <div className="admin-order__total">
                        <span>Итого</span>
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
                    <ReceiptDeleteButton receiptId={r.id} />
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="admin-empty">
              <div className="admin-empty__icon">
                <Truck size={40} />
              </div>
              <p>Поступлений пока нет</p>
              <p className="admin-empty__hint">
                Оформите приходный ордер — товары добавятся на остатки склада.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ════════════ ВКЛАДКА: ЗАКАЗЫ ════════════ */}
      {activeTab === "deals" && (
        <div className="admin-card">
          {deals.length > 0 ? (
            deals.map((d) => {
              const paid = dealPaidMap.get(d.id) || 0;
              const isFullyPaid = d.total > 0 && paid >= d.total;
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
                      </div>

                      <div className="admin-order__items">
                        <div className="admin-order__items-title">Товары</div>
                        {d.items.map((it, idx) => (
                          <div key={idx} className="admin-order__item">
                            <span>
                              {it.name} × {it.quantity}
                            </span>
                            <span className="admin-order__item-sum">
                              {fmt(it.quantity * it.price)} ₽
                            </span>
                          </div>
                        ))}
                        <div className="admin-order__total">
                          <span>Итого</span>
                          <span>{fmt(d.total)} ₽</span>
                        </div>
                      </div>

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
                      <DealActions dealId={d.id} status={d.status} />
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

      {/* ════════════ ВКЛАДКА: БАНК ════════════ */}
      {activeTab === "payments" && bankSummary && (
        <>
          <div className="admin-stat-grid wh-stat-grid wh-bank-grid">
            <div className="admin-stat wh-bank-stat wh-bank-stat--balance">
              <div className="admin-stat__value">
                {fmt(bankSummary.balance)} ₽
              </div>
              <div className="admin-stat__label">На счету (факт)</div>
            </div>
            <div className="admin-stat wh-bank-stat wh-bank-stat--in">
              <div className="admin-stat__value">
                +{fmt(bankSummary.expectedIn)} ₽
              </div>
              <div className="admin-stat__label">Ожидается поступление</div>
            </div>
            <div className="admin-stat wh-bank-stat wh-bank-stat--out">
              <div className="admin-stat__value">
                −{fmt(bankSummary.expectedOut)} ₽
              </div>
              <div className="admin-stat__label">К оплате (исходящие)</div>
            </div>
          </div>

          <div className="admin-card">
            {payments.length > 0 ? (
              payments.map((p) => (
                <div key={p.id} className="admin-order">
                  <div className="admin-order__row">
                    <div className="admin-order__main">
                      <div className="admin-order__top">
                        <span className="admin-order__id">ПЛ-{p.number}</span>
                        {p.direction === "incoming" ? (
                          <span className="admin-badge admin-badge--green">
                            <ArrowDownLeft size={11} />
                            Поступление
                          </span>
                        ) : (
                          <span className="admin-badge admin-badge--red">
                            <ArrowUpRight size={11} />
                            Расход
                          </span>
                        )}
                        {p.isPaid ? (
                          <span className="admin-badge admin-badge--blue">
                            Оплачен
                          </span>
                        ) : (
                          <span className="admin-badge admin-badge--amber">
                            Ожидается
                          </span>
                        )}
                        <span className="admin-order__date">
                          {fmtDate(p.date)}
                        </span>
                      </div>

                      <div className="admin-order__grid">
                        <div className="admin-order__meta">
                          <span className="admin-order__meta-label wh-meta-label">
                            {p.direction === "incoming"
                              ? "Плательщик:"
                              : "Получатель:"}
                          </span>
                          <span className="admin-order__meta-val">
                            {p.counterparty}
                          </span>
                        </div>
                        {p.dealNumbers.length > 0 && (
                          <div className="admin-order__meta">
                            <span className="admin-order__meta-label wh-meta-label">
                              Заказы:
                            </span>
                            <span className="admin-order__meta-val">
                              {p.dealNumbers.map((n) => `ЗК-${n}`).join(", ")}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="wh-pay-amount">
                        <span
                          className={`wh-pay-amount__val ${
                            p.direction === "incoming"
                              ? "wh-pay-amount__val--in"
                              : "wh-pay-amount__val--out"
                          }`}
                        >
                          {p.direction === "incoming" ? "+" : "−"}
                          {fmt(p.amount)} ₽
                        </span>
                      </div>

                      {p.comment && (
                        <div className="admin-order__comment">
                          <strong>Комментарий</strong>
                          {p.comment}
                        </div>
                      )}
                    </div>

                    <div className="admin-order__side">
                      <PaymentControls paymentId={p.id} isPaid={p.isPaid} />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="admin-empty">
                <div className="admin-empty__icon">
                  <Wallet size={40} />
                </div>
                <p>Платежей пока нет</p>
                <p className="admin-empty__hint">
                  Добавьте поступление от покупателя или расход поставщику —
                  баланс банка посчитается автоматически.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
