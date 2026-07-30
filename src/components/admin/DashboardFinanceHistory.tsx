"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Search, X } from "lucide-react";
import { PaymentDetailsModal } from "@/components/admin/PaymentDetailsModal";

export type DashboardFinanceRow = {
  id: string;
  date: string;
  direction: "incoming" | "outgoing";
  account: "bank" | "cash";
  category: string;
  counterparty: string;
  amount: number;
  detail: string;
  href: string;
  paymentId?: string;
  dealLinks?: { id: string; number: number }[];
  receiptLinks?: { id: string; number: number }[];
};

const money = (value: number) => `${value.toLocaleString("ru-RU")} ₽`;

function formatDate(raw: string): string {
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("ru-RU");
}

function periodLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  const text = new Date(year, month - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function DashboardFinanceHistory({
  rows,
  adminPath,
  allowNavigation = true,
}: {
  rows: DashboardFinanceRow[];
  adminPath: string;
  allowNavigation?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const [detailPaymentId, setDetailPaymentId] = useState<string | null>(null);

  const periods = useMemo(
    () => [
      ...new Set(rows.map((row) => row.date.slice(0, 7)).filter(Boolean)),
    ].sort((a, b) => b.localeCompare(a)),
    [rows]
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return [...rows]
      .filter((row) => {
        if (period !== "all" && !row.date.startsWith(period)) return false;
        if (dateFrom && row.date < dateFrom) return false;
        if (dateTo && row.date > dateTo) return false;
        if (!normalized) return true;
        const haystack = [
          row.counterparty,
          row.category,
          row.detail,
          row.account === "cash" ? "касса наличные" : "расчетный счет банк",
          ...(row.dealLinks || []).map((deal) => `зк-${deal.number}`),
          ...(row.receiptLinks || []).map((receipt) => `по-${receipt.number}`),
        ]
          .join(" ")
          .toLocaleLowerCase("ru-RU");
        return haystack.includes(normalized);
      })
      .sort((a, b) => {
        const byDate =
          sort === "asc"
            ? a.date.localeCompare(b.date)
            : b.date.localeCompare(a.date);
        if (byDate !== 0) return byDate;
        return sort === "asc"
          ? a.id.localeCompare(b.id)
          : b.id.localeCompare(a.id);
      });
  }, [dateFrom, dateTo, period, query, rows, sort]);

  const visible = filtered.slice(0, 60);
  const hasFilters =
    query || period !== "all" || dateFrom || dateTo || sort !== "desc";

  function reset() {
    setQuery("");
    setPeriod("all");
    setDateFrom("");
    setDateTo("");
    setSort("desc");
  }

  return (
    <>
      <PaymentDetailsModal
        paymentId={detailPaymentId}
        adminPath={adminPath}
        onClose={() => setDetailPaymentId(null)}
        allowDocumentNavigation={allowNavigation}
      />
      <div className="dash-finance-filter" aria-label="Фильтр истории платежей">
        <label className="dash-finance-filter__search">
          <span>Поиск</span>
          <div className="dash-finance-filter__search-control">
            <Search size={14} />
            <input
              className="admin-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Контрагент, назначение, ЗК или ПО…"
            />
          </div>
        </label>
        <label>
          <span>Период</span>
          <select
            className="admin-select"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            <option value="all">Все месяцы</option>
            {periods.map((item) => (
              <option key={item} value={item}>
                {periodLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Дата от</span>
          <input
            className="admin-input"
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label>
          <span>Дата до</span>
          <input
            className="admin-input"
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
        <label>
          <span>Сортировка</span>
          <select
            className="admin-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as "asc" | "desc")}
          >
            <option value="desc">Сначала новые</option>
            <option value="asc">Сначала старые</option>
          </select>
        </label>
        {hasFilters && (
          <button
            type="button"
            className="admin-btn admin-btn--ghost dash-finance-filter__reset"
            onClick={reset}
          >
            <X size={13} /> Сбросить
          </button>
        )}
      </div>

      <div className="dash-finance-list-head">
        <strong>История платежей</strong>
        <span>
          показано {visible.length} из {filtered.length}
          {filtered.length !== rows.length ? ` · всего ${rows.length}` : ""}
        </span>
      </div>

      {visible.length > 0 ? (
        <div className="dash-finance-list">
          {visible.map((row) => (
            <div
              key={row.id}
              className={`dash-finance-row${row.paymentId ? " payment-clickable" : ""}`}
              role={row.paymentId ? "button" : undefined}
              tabIndex={row.paymentId ? 0 : undefined}
              onClick={(event) => {
                if (!row.paymentId) return;
                if ((event.target as HTMLElement).closest("a,button")) return;
                setDetailPaymentId(row.paymentId);
              }}
              onKeyDown={(event) => {
                if (row.paymentId && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  setDetailPaymentId(row.paymentId);
                }
              }}
            >
              <span
                className={`dash-finance-row__icon dash-finance-row__icon--${row.direction}`}
                aria-hidden="true"
              >
                {row.direction === "incoming" ? (
                  <ArrowDownLeft size={15} />
                ) : (
                  <ArrowUpRight size={15} />
                )}
              </span>
              <div className="dash-finance-row__main">
                <div className="dash-finance-row__top">
                  <strong>{row.counterparty}</strong>
                  <span className="admin-badge admin-badge--muted">
                    {row.account === "cash" ? "касса" : "расчётный счёт"}
                  </span>
                  <span className="admin-badge admin-badge--blue">
                    {row.category}
                  </span>
                </div>
                <div className="dash-finance-row__detail">
                  <span>{formatDate(row.date)}</span>
                  {row.detail && <span>{row.detail}</span>}
                  {(row.dealLinks || []).map((deal) =>
                    allowNavigation ? (
                      <Link
                        key={`deal-${row.id}-${deal.id}`}
                        href={`/${adminPath}/warehouse?tab=deals&deal=${deal.id}`}
                        prefetch={false}
                      >
                        ЗК-{deal.number || "—"}
                      </Link>
                    ) : (
                      <span key={`deal-${row.id}-${deal.id}`}>
                        ЗК-{deal.number || "—"}
                      </span>
                    )
                  )}
                  {(row.receiptLinks || []).map((receipt) =>
                    allowNavigation ? (
                      <Link
                        key={`receipt-${row.id}-${receipt.id}`}
                        href={`/${adminPath}/warehouse?tab=receipts&receipt=${receipt.id}`}
                        prefetch={false}
                      >
                        ПО-{receipt.number || "—"}
                      </Link>
                    ) : (
                      <span key={`receipt-${row.id}-${receipt.id}`}>
                        ПО-{receipt.number || "—"}
                      </span>
                    )
                  )}
                </div>
              </div>
              <div className="dash-finance-row__side">
                <strong
                  className={
                    row.direction === "incoming"
                      ? "dash-money-in"
                      : "dash-money-out"
                  }
                >
                  {row.direction === "incoming" ? "+" : "−"}
                  {money(row.amount)}
                </strong>
                {row.paymentId ? (
                  <button
                    type="button"
                    className="dash-finance-row__open"
                    onClick={() => setDetailPaymentId(row.paymentId!)}
                  >
                    Подробнее →
                  </button>
                ) : allowNavigation ? (
                  <Link href={row.href} prefetch={false}>
                    Открыть →
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-empty">
          <p>
            {rows.length > 0
              ? "По выбранным фильтрам платежей не найдено"
              : "Проведённых платежей пока нет"}
          </p>
        </div>
      )}
    </>
  );
}
