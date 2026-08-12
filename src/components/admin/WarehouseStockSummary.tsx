"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  Loader2,
  PackageCheck,
  History,
  ClipboardList,
  Truck,
} from "lucide-react";
import type { ProductStockSummary } from "@/lib/warehouse-shared";

const fmt = (value: number) => value.toLocaleString("ru-RU");

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("ru-RU", {
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
  completed: "Отпущен",
  cancelled: "Отменён",
};

export function ProductStockSummaryPanel({
  adminPath,
  summary,
  loading,
  error,
  onRetry,
}: {
  adminPath: string;
  summary?: ProductStockSummary;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const [panelTab, setPanelTab] = useState<"history" | "deals" | "receipts">("history");

  if (loading && !summary) {
    return (
      <div className="stock-summary__state" role="status">
        <Loader2 size={17} className="animate-spin" />
        Загружаем все заказы и поступления…
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="stock-summary__state stock-summary__state--error">
        <AlertTriangle size={17} />
        <span>{error}</span>
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm"
          onClick={onRetry}
        >
          Повторить
        </button>
      </div>
    );
  }

  if (!summary) return null;

  const hasOwnStock = summary.ownStockQty > 0.009;
  const hasAccountingShortage = summary.ownStockQty < -0.009;

  // ============ РАСЧЁТ ХРОНОЛОГИИ ДВИЖЕНИЯ ТОВАРА ============
  const postedReceiptEvents = summary.receipts
    .filter((r) => r.status === "posted")
    .map((r) => ({
      date: r.date,
      docId: r.id,
      docNumber: `ПО-${r.number}`,
      docType: "receipt" as const,
      partner: r.supplier,
      qtyChange: r.quantity,
      price: r.unitPrice,
    }));

  const shippedDealEvents = summary.deals
    .filter((d) => d.shippedQty > 0)
    .map((d) => ({
      date: d.date,
      docId: d.id,
      docNumber: `ЗК-${d.number}`,
      docType: "deal" as const,
      partner: d.customerName,
      qtyChange: -d.shippedQty,
      price: d.unitPrice || 0,
    }));

  // Объединяем и сортируем по дате (от старых к новым) для подсчёта остатка
  const allEvents = [...postedReceiptEvents, ...shippedDealEvents].sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    if (cmp !== 0) return cmp;
    return a.docNumber.localeCompare(b.docNumber);
  });

  // Рассчитываем бегущий остаток без мутации переменных во время рендера.
  // reduce возвращает новый аккумулятор для каждой операции, поэтому React
  // может безопасно повторно или прерванно отрисовывать компонент.
  const { chronologicalHistory } = allEvents.reduce<{
    runningBalance: number;
    chronologicalHistory: Array<(typeof allEvents)[number] & {
      balanceAfter: number;
      marginStr: string;
    }>;
  }>((acc, ev) => {
    const runningBalance = acc.runningBalance + ev.qtyChange;

    // Вычисляем маржу для продаж
    let marginStr = "—";
    if (ev.docType === "deal") {
      // Ищем последнюю цену закупки, действовавшую на дату продажи или ранее.
      // Если поставок по товару нет — берём общую закупочную цену
      // из карточки товара (приблизительную).
      const activeReceipts = summary.receipts
        .filter((r) => r.status === "posted" && r.date <= ev.date)
        .sort((a, b) => b.date.localeCompare(a.date));
      const purchasePrice =
        activeReceipts.length > 0
          ? activeReceipts[0].unitPrice
          : summary.purchasePrice ?? 0;

      if (ev.price > 0 && purchasePrice > 0) {
        const margin = Math.round(((ev.price - purchasePrice) / ev.price) * 100);
        marginStr = `${margin}%`;
      } else if (ev.price > 0) {
        marginStr = "100%";
      }
    }

    acc.chronologicalHistory.push({
      ...ev,
      balanceAfter: runningBalance,
      marginStr,
    });
    return { ...acc, runningBalance };
  }, { runningBalance: summary.ownStockQty, chronologicalHistory: [] });

  // Разворачиваем для отображения (свежие операции сверху)
  const displayedHistory = [...chronologicalHistory].reverse();

  return (
    <div className="stock-summary">
      <div className="stock-summary__head">
        <div>
          <span className="stock-summary__eyebrow">Расширенная сводка товара</span>
          <strong>Все заказы и поступления, включая архивные</strong>
        </div>
        <span className="admin-badge admin-badge--muted">
          {summary.deals.length} зак. · {summary.receipts.length} пост.
        </span>
      </div>

      <div className="stock-summary__stats">
        <div>
          <span>Сейчас на складе</span>
          <strong>{fmt(summary.currentStockQty)} шт.</strong>
        </div>
        <div>
          <span>Ещё отгрузить по заказам</span>
          <strong>{fmt(summary.pendingOrderQty)} шт.</strong>
        </div>
        <div
          className={
            summary.shortageQty > 0
              ? "stock-summary__stat--danger"
              : "stock-summary__stat--ok"
          }
        >
          <span>Недостача для заказов</span>
          <strong>
            {summary.shortageQty > 0
              ? `${fmt(summary.shortageQty)} шт.`
              : "Нет"}
          </strong>
        </div>
        <div>
          <span>В активных поступлениях</span>
          <strong>{fmt(summary.draftReceiptQty)} шт.</strong>
        </div>
      </div>

      <div
        className={`stock-summary__balance${
          hasAccountingShortage
            ? " stock-summary__balance--danger"
            : hasOwnStock
              ? " stock-summary__balance--own"
              : " stock-summary__balance--ok"
        }`}
      >
        {hasAccountingShortage ? (
          <>
            <AlertTriangle size={15} />
            <span>
              <b>Недостача по учёту: {fmt(Math.abs(summary.ownStockQty))} шт.</b>
              Проведённые поступления, отгрузки и текущий остаток не сходятся —
              проверьте ручные правки или ревизию.
            </span>
          </>
        ) : hasOwnStock ? (
          <>
            <Boxes size={15} />
            <span>
              <b>Наши остатки: {fmt(summary.ownStockQty)} шт.</b>
              Эта часть не привязана к поступлениям: товар внесли руками или он
              был на складе до начала учёта.
            </span>
          </>
        ) : (
          <>
            <PackageCheck size={15} />
            <span>
              <b>Остаток сходится.</b> Текущий склад подтверждён проведёнными
              поступлениями и отгрузками.
            </span>
          </>
        )}
        <small>
          {hasAccountingShortage ? (
            <>
              Проверка: {fmt(summary.postedReceiptQty)} поступило −{" "}
              {fmt(summary.shippedQty)} отгружено −{" "}
              {fmt(Math.abs(summary.ownStockQty))} недостача ={" "}
              {fmt(summary.currentStockQty)} на складе.
            </>
          ) : (
            <>
              Проверка: {fmt(summary.postedReceiptQty)} поступило −{" "}
              {fmt(summary.shippedQty)} отгружено + {fmt(summary.ownStockQty)} наши
              остатки = {fmt(summary.currentStockQty)} на складе.
            </>
          )}
        </small>
      </div>

      {/* Переключатель вкладок внутри карточки товара */}
      <div className="admin-filters admin-filters--sub" style={{ marginTop: 16, marginBottom: 12 }}>
        <button
          onClick={() => setPanelTab("history")}
          className={`admin-filter${panelTab === "history" ? " admin-filter--active" : ""}`}
        >
          <History size={12} />
          История движения
        </button>
        <button
          onClick={() => setPanelTab("deals")}
          className={`admin-filter${panelTab === "deals" ? " admin-filter--active" : ""}`}
        >
          <ClipboardList size={12} />
          Заказы с товаром
        </button>
        <button
          onClick={() => setPanelTab("receipts")}
          className={`admin-filter${panelTab === "receipts" ? " admin-filter--active" : ""}`}
        >
          <Truck size={12} />
          Поступления
        </button>
      </div>

      {/* 1. ВКЛАДКА: ИСТОРИЯ ДВИЖЕНИЯ ТОВАРА */}
      {panelTab === "history" && (
        <section className="stock-summary__section">
          <div className="stock-summary__section-head">
            <div>
              <strong>Хронология движения товара</strong>
              <span>Все приходы и расходы в хронологическом порядке</span>
            </div>
            <span>
              Операций всего: {chronologicalHistory.length}
            </span>
          </div>
          {chronologicalHistory.length > 0 ? (
            <div className="admin-table-wrap stock-summary__table-wrap">
              <table className="admin-table stock-summary__table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Документ</th>
                    <th>Операция / Контрагент</th>
                    <th style={{ textAlign: "right" }}>Кол-во</th>
                    <th style={{ textAlign: "right" }}>Цена</th>
                    <th style={{ textAlign: "right" }}>Остаток</th>
                    <th style={{ textAlign: "right" }}>Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedHistory.map((ev, idx) => (
                    <tr key={idx}>
                      <td>{fmtDate(ev.date)}</td>
                      <td>
                        <Link
                          href={`/${adminPath}/warehouse?tab=${ev.docType === "receipt" ? "receipts" : "deals"}&${ev.docType === "receipt" ? "receipt" : "deal"}=${ev.docId}`}
                          prefetch={false}
                          className="stock-origin-link"
                        >
                          {ev.docNumber} →
                        </Link>
                      </td>
                      <td>
                        {ev.docType === "receipt" ? (
                          <span style={{ color: "var(--adm-pine-dark)" }}>📥 Поступление от <b>{ev.partner}</b></span>
                        ) : (
                          <span style={{ color: "var(--adm-rust-dark)" }}>📤 Продажа клиенту <b>{ev.partner}</b></span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", color: ev.qtyChange >= 0 ? "var(--adm-pine)" : "var(--adm-rust)" }}>
                        <strong>{ev.qtyChange >= 0 ? `+${fmt(ev.qtyChange)}` : fmt(ev.qtyChange)} шт.</strong>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {fmt(ev.price)} ₽
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <strong>{fmt(ev.balanceAfter)} шт.</strong>
                      </td>
                      <td style={{ textAlign: "right", color: ev.marginStr !== "—" ? "var(--adm-pine)" : "inherit" }}>
                        <strong>{ev.marginStr}</strong>
                      </td>
                    </tr>
                  ))}
                  {summary.ownStockQty > 0.009 && (
                    <tr style={{ background: "rgba(125, 209, 129, 0.05)" }}>
                      <td className="admin-muted">—</td>
                      <td className="admin-muted">—</td>
                      <td><i>Начальный остаток (ручной ввод / ревизия)</i></td>
                      <td style={{ textAlign: "right" }} className="admin-muted">—</td>
                      <td style={{ textAlign: "right" }} className="admin-muted">—</td>
                      <td style={{ textAlign: "right" }}><strong>{fmt(summary.ownStockQty)} шт.</strong></td>
                      <td style={{ textAlign: "right" }} className="admin-muted">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stock-summary__empty">
              Движения товара пока не зафиксировано.
            </div>
          )}
        </section>
      )}

      {/* 2. ВКЛАДКА: ЗАКАЗЫ С ЭТИМ ТОВАРОМ */}
      {panelTab === "deals" && (
        <section className="stock-summary__section">
          <div className="stock-summary__section-head">
            <div>
              <strong>Заказы с этим товаром</strong>
              <span>Показываются активные, отпущенные и отменённые</span>
            </div>
            <span>
              Заказано {fmt(summary.orderedQty)} · отгружено{" "}
              {fmt(summary.shippedQty)} · осталось {fmt(summary.pendingOrderQty)} шт.
            </span>
          </div>
          {summary.deals.length > 0 ? (
            <div className="admin-table-wrap stock-summary__table-wrap">
              <table className="admin-table stock-summary__table">
                <thead>
                  <tr>
                    <th>Заказ</th>
                    <th>Дата</th>
                    <th>Покупатель</th>
                    <th>Статус</th>
                    <th style={{ textAlign: "right" }}>Заказано</th>
                    <th style={{ textAlign: "right" }}>Отгружено</th>
                    <th style={{ textAlign: "right" }}>Не отгружено</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.deals.map((deal) => (
                    <tr key={deal.id}>
                      <td>
                        <Link
                          href={`/${adminPath}/warehouse?tab=deals&deal=${deal.id}`}
                          prefetch={false}
                          className="stock-origin-link"
                        >
                          ЗК-{deal.number} →
                        </Link>
                      </td>
                      <td>{fmtDate(deal.date)}</td>
                      <td>{deal.customerName || "—"}</td>
                      <td>
                        <span
                          className={
                            dealStatusBadge[deal.status] ||
                            "admin-badge admin-badge--muted"
                          }
                        >
                          {dealStatusLabel[deal.status] || deal.status}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {fmt(deal.orderedQty)} шт.
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {fmt(deal.shippedQty)} шт.
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {deal.status === "cancelled" ? (
                          <span className="admin-muted">отменён</span>
                        ) : deal.remainingQty > 0 ? (
                          <strong className="stock-summary__missing">
                            {fmt(deal.remainingQty)} шт.
                          </strong>
                        ) : (
                          <span className="stock-summary__done">✓ всё</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stock-summary__empty">
              Заказов с этим товаром пока нет.
            </div>
          )}
        </section>
      )}

      {/* 3. ВКЛАДКА: ВСЕ ПОСТУПЛЕНИЯ */}
      {panelTab === "receipts" && (
        <section className="stock-summary__section">
          <div className="stock-summary__section-head">
            <div>
              <strong>Все поступления</strong>
              <span>Архивные поступления не скрываются</span>
            </div>
            <span>
              На склад проведено {fmt(summary.postedReceiptQty)} · ожидается{" "}
              {fmt(summary.draftReceiptQty)} шт.
            </span>
          </div>
          {summary.receipts.length > 0 ? (
            <div className="admin-table-wrap stock-summary__table-wrap">
              <table className="admin-table stock-summary__table">
                <thead>
                  <tr>
                    <th>Поступление</th>
                    <th>Дата</th>
                    <th>Поставщик</th>
                    <th>Статус</th>
                    <th style={{ textAlign: "right" }}>Количество</th>
                    <th style={{ textAlign: "right" }}>Цена за шт.</th>
                    <th style={{ textAlign: "right" }}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.receipts.map((receipt) => (
                    <tr key={receipt.id}>
                      <td>
                        <Link
                          href={`/${adminPath}/warehouse?tab=receipts&receipt=${receipt.id}`}
                          prefetch={false}
                          className="stock-origin-link"
                        >
                          ПО-{receipt.number} →
                        </Link>
                      </td>
                      <td>{fmtDate(receipt.date)}</td>
                      <td>{receipt.supplier || "—"}</td>
                      <td>
                        {receipt.status === "posted" ? (
                          <span className="admin-badge admin-badge--green">
                            проведено · архив
                          </span>
                        ) : (
                          <span className="admin-badge admin-badge--amber">
                            активное
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <strong>{fmt(receipt.quantity)} шт.</strong>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {fmt(receipt.unitPrice)} ₽
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {fmt(receipt.lineTotal)} ₽
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stock-summary__empty">
              Поступлений с этим товаром пока нет.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
