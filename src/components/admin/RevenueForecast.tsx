// =========================================================
// FILE: src/components/admin/RevenueForecast.tsx
// Компактная карточка прогноза выручки для дашборда.
//
// Полноценный расчёт живёт во вкладке «Учёт → План»
// (SalesPlan + computeProfitPlan): план на произвольный
// период с прибылью по контрагентам. Здесь — свёрнутая
// сводка «на этот месяц», чтобы на главной видеть цифру
// и топ-5 контрагентов, не открывая учёт.
// =========================================================

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { TrendingUp, Wallet, UsersRound, Receipt, ArrowRight, Info } from "lucide-react";
import type { CustomerDeal } from "@/lib/warehouse-shared";
import {
  computeRevenueForecast,
  type ForecastCounterpartyRow,
} from "@/lib/revenue-forecast";

const fmt = (n: number) =>
  n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });

const fmtMoney = (n: number) => `${fmt(n)} ₽`;

const STATUS_META: Record<
  ForecastCounterpartyRow["status"],
  { label: string; className: string; title: string }
> = {
  active: {
    label: "активен",
    className: "admin-badge admin-badge--green",
    title: "Заказывал в прошлом или текущем месяце",
  },
  recent: {
    label: "недавно",
    className: "admin-badge admin-badge--blue",
    title: "Заказывал в последние 3 месяца",
  },
  sleeping: {
    label: "спит",
    className: "admin-badge admin-badge--gray",
    title: "Давно не заказывал — в прогнозе только уже оформленное",
  },
};

function fmtDate(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/**
 * Полная таблица прогноза по контрагентам (используется на дашборде
 * в раскрывающейся секции «Прогноз выручки»).
 */
export function RevenueForecast({
  deals,
  adminPath,
  compact = false,
}: {
  deals: CustomerDeal[];
  adminPath: string;
  /** Компактный режим для дашборда: без выбора месяца и поиска. */
  compact?: boolean;
}) {
  const forecast = useMemo(() => computeRevenueForecast(deals, 0, 6), [deals]);
  const visibleRows = compact ? forecast.rows.slice(0, 6) : forecast.rows;

  if (deals.length === 0) {
    return (
      <div className="admin-card">
        <div className="admin-empty" style={{ padding: 32 }}>
          <div className="admin-empty__icon"><TrendingUp size={34} /></div>
          <p>
            Пока нет заказов в учёте — прогноз появится автоматически,
            как только будут созданы заказы покупателей или загружены
            старые заказы через массовую загрузку.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rf">
      <div className="rf-summary">
        <div className="rf-summary__main">
          <span className="rf-summary__label">Прогноз выручки · {forecast.monthLabel}</span>
          <strong className="rf-summary__value">{fmtMoney(forecast.totalForecast)}</strong>
          <span className="rf-summary__hint">
            из них уже оформлено {fmtMoney(forecast.totalKnown)}
            {forecast.totalExpectedRemaining > 0 &&
              ` · ожидаем ещё ${fmtMoney(forecast.totalExpectedRemaining)}`}
          </span>
        </div>
        <div className="rf-summary__stats">
          <div className="rf-stat">
            <span className="rf-stat__icon" style={{ color: "var(--adm-pine)" }}><Wallet size={15} /></span>
            <span className="rf-stat__val">{fmtMoney(forecast.totalAvgMonthly)}</span>
            <span className="rf-stat__label">среднемесячный объём</span>
          </div>
          <div className="rf-stat">
            <span className="rf-stat__icon" style={{ color: "var(--adm-steel)" }}><UsersRound size={15} /></span>
            <span className="rf-stat__val">{forecast.activeCounterparties} / {forecast.rows.length}</span>
            <span className="rf-stat__label">активных контрагентов</span>
          </div>
          <div className="rf-stat">
            <span className="rf-stat__icon" style={{ color: "var(--adm-kraft)" }}><Receipt size={15} /></span>
            <span className="rf-stat__val">{fmtMoney(forecast.avgCheck)}</span>
            <span className="rf-stat__label">средний чек</span>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table rf-table">
            <thead>
              <tr>
                <th>Контрагент</th>
                <th className="rf-num">Заказов</th>
                <th className="rf-num">Средний чек</th>
                <th className="rf-num">Среднемесячно</th>
                <th className="rf-num">За прошлый мес.</th>
                <th className="rf-num">Известно в месяце</th>
                <th className="rf-num">Прогноз</th>
                <th>Активность</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const status = STATUS_META[row.status];
                return (
                  <tr key={row.counterparty}>
                    <td>
                      <div className="rf-party">
                        <span className="rf-party__name">{row.displayName}</span>
                        <span className="rf-party__meta">
                          последний заказ: {fmtDate(row.lastOrderDate)}
                        </span>
                      </div>
                    </td>
                    <td className="rf-num">{row.ordersCount}</td>
                    <td className="rf-num">{fmtMoney(row.avgCheck)}</td>
                    <td className="rf-num">{fmtMoney(row.avgMonthly)}</td>
                    <td className="rf-num">{row.lastMonthSum > 0 ? fmtMoney(row.lastMonthSum) : "—"}</td>
                    <td className="rf-num">
                      {row.knownMonthSum > 0 ? (
                        <span style={{ color: "var(--adm-steel)", fontWeight: 600 }}>{fmtMoney(row.knownMonthSum)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="rf-num rf-forecast">{fmtMoney(row.forecast)}</td>
                    <td>
                      <span className={status.className} title={status.title} style={{ whiteSpace: "nowrap" }}>
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {forecast.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={6}>Итого по {visibleRows.length} {visibleRows.length === 1 ? "контрагенту" : "контрагентам"}</td>
                  <td className="rf-num rf-forecast">{fmtMoney(forecast.rows.reduce((s, r) => s + r.forecast, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {compact && forecast.rows.length > 6 && (
        <Link
          href={`/${adminPath}/warehouse?tab=plan`}
          className="admin-btn admin-btn--ghost admin-btn--sm"
          prefetch={false}
          style={{ marginTop: 10 }}
        >
          Все {forecast.rows.length} контрагентов <ArrowRight size={13} />
        </Link>
      )}

      <div className="rf-note">
        <Info size={13} />
        <span>
          Прогноз приблизительный — автоматический план на основе заказов за последние 6 месяцев.
          Полноценный план на произвольный период с прибылью — во вкладке «План».
        </span>
      </div>
    </div>
  );
}

/** Компактная карточка для дашборда: только цифры и топ контрагентов. */
export function RevenueForecastSummary({
  deals,
  adminPath,
}: {
  deals: CustomerDeal[];
  adminPath: string;
}) {
  const forecast = useMemo(() => computeRevenueForecast(deals, 0, 6), [deals]);
  const top = forecast.rows.slice(0, 5);

  return (
    <div className="rf rf--compact">
      <div className="rf-summary">
        <div className="rf-summary__main">
          <span className="rf-summary__label">Прогноз выручки · {forecast.monthLabel}</span>
          <strong className="rf-summary__value">{fmtMoney(forecast.totalForecast)}</strong>
          <span className="rf-summary__hint">
            оформлено {fmtMoney(forecast.totalKnown)} · ещё ожидаем {fmtMoney(forecast.totalExpectedRemaining)}
          </span>
        </div>
      </div>
      {top.length > 0 && (
        <div className="rf-top">
          {top.map((row, idx) => (
            <div key={row.counterparty} className="rf-top__row">
              <span className="rf-top__idx">{idx + 1}</span>
              <span className="rf-top__name">{row.displayName}</span>
              <span className="rf-top__sum">{fmtMoney(row.forecast)}</span>
            </div>
          ))}
        </div>
      )}
      {forecast.rows.length > top.length && (
        <div className="rf-top__more">
          + ещё {forecast.rows.length - top.length} —{" "}
          <Link href={`/${adminPath}/warehouse?tab=plan`} prefetch={false}>
            открыть план →
          </Link>
        </div>
      )}
    </div>
  );
}
