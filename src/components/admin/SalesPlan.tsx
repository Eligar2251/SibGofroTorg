// =========================================================
// FILE: src/components/admin/SalesPlan.tsx
// План заказов на месяц: контрагенты, которые должны сделать заказ,
// какие товары и в каком количестве, сколько потратим со склада и
// сколько получим денег с вычетом закупки (поставок).
// =========================================================

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Target,
  Wallet,
  TrendingUp,
  UsersRound,
  Package,
  ChevronLeft,
  ChevronRight,
  Info,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import type { CustomerDeal, WarehouseStockRow } from "@/lib/warehouse-shared";
import { computeSalesPlan, type SalesPlanCounterparty } from "@/lib/sales-plan";
import { formatCuttableStock } from "@/lib/types";

const fmt = (n: number) =>
  n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });

const fmtMoney = (n: number) => `${fmt(n)} ₽`;

const fmtQty = (n: number) =>
  n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

const STATUS_META: Record<
  SalesPlanCounterparty["status"],
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
    title: "Давно не заказывал, но уже оформил заказ в этом месяце",
  },
};

/** Подпись количества в единицах товара (рулоны/шт/метры). */
function qtyLabel(
  qty: number,
  isCuttable: boolean,
  metersPerRoll: number | null,
  unitName?: string | null
): string {
  if (!isCuttable || !metersPerRoll) {
    return `${fmtQty(qty)} шт.`;
  }
  return formatCuttableStock(qty, metersPerRoll, unitName || "м");
}

function fmtDate(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export function SalesPlan({
  deals,
  stock,
  adminPath,
}: {
  deals: CustomerDeal[];
  stock: WarehouseStockRow[];
  adminPath: string;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const plan = useMemo(
    () => computeSalesPlan(deals, stock, monthOffset, 6),
    [deals, stock, monthOffset]
  );

  if (deals.length === 0) {
    return (
      <div className="admin-card">
        <div className="admin-empty" style={{ padding: 32 }}>
          <div className="admin-empty__icon"><Target size={34} /></div>
          <p>
            Пока нет заказов в учёте — план появится автоматически после
            создания заказов покупателей или загрузки истории через
            массовую загрузку.
          </p>
        </div>
      </div>
    );
  }

  const hasShortage = plan.shortageProductsCount > 0;

  return (
    <div className="sp">
      <div className="sp-toolbar">
        <div className="rf-month-nav">
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => setMonthOffset((v) => Math.max(-11, v - 1))}
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="rf-month-label">{plan.monthLabel}</span>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => setMonthOffset((v) => Math.min(11, v + 1))}
            aria-label="Следующий месяц"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <Link
          href={`/${adminPath}/warehouse/import`}
          className="admin-btn admin-btn--ghost admin-btn--sm"
          prefetch={false}
          title="Загрузить старые проведённые заказы — они сразу попадут в план"
        >
          <ArrowRight size={13} /> Загрузить историю
        </Link>
      </div>

      {/* ── Сводка ── */}
      <div className="sp-summary">
        <div className="sp-summary__main">
          <span className="sp-summary__label">План продаж · {plan.monthLabel}</span>
          <strong className="sp-summary__value">{fmtMoney(plan.totalRevenue)}</strong>
          <span className="sp-summary__hint">
            получим с вычетом закупки: <b className="sp-margin">{fmtMoney(plan.totalMargin)}</b> маржи
          </span>
        </div>
        <div className="sp-summary__stats">
          <div className="rf-stat">
            <span className="rf-stat__icon" style={{ color: "var(--adm-rust)" }}><Wallet size={15} /></span>
            <span className="rf-stat__val">{fmtMoney(plan.totalCost)}</span>
            <span className="rf-stat__label">закупка (себестоимость)</span>
          </div>
          <div className="rf-stat">
            <span className="rf-stat__icon" style={{ color: "var(--adm-steel)" }}><UsersRound size={15} /></span>
            <span className="rf-stat__val">{plan.counterparties.length}</span>
            <span className="rf-stat__label">контрагентов в плане</span>
          </div>
          <div className="rf-stat">
            <span className="rf-stat__icon" style={{ color: "var(--adm-kraft)" }}><Package size={15} /></span>
            <span className="rf-stat__val">{plan.products.length}</span>
            <span className="rf-stat__label">позиций (товаров)</span>
          </div>
        </div>
      </div>

      {hasShortage && (
        <div className="sp-shortage">
          <AlertTriangle size={15} />
          <span>
            По плану не хватает <b>{plan.shortageProductsCount}</b>{" "}
            {plan.shortageProductsCount === 1 ? "позиции" : "позиций"} на складе —
            потребуется докупить примерно на{" "}
            <b>{fmtMoney(plan.totalShortageCost)}</b>. Смотрите блок «Покрытие склада».
          </span>
        </div>
      )}

      {/* ── Контрагенты в плане ── */}
      <div className="admin-card">
        <div className="admin-card__head">
          <h3 className="admin-card__title">
            Контрагенты, которые должны сделать заказ · {plan.monthLabel.toLowerCase()}
          </h3>
          <span className="admin-badge admin-badge--muted">{plan.counterparties.length}</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table sp-table">
            <thead>
              <tr>
                <th>Контрагент</th>
                <th className="sp-num">Ожид. заказов</th>
                <th className="sp-num">Средний чек</th>
                <th className="sp-num">План выручки</th>
                <th className="sp-num">Уже оформил</th>
                <th className="sp-num">Осталось</th>
                <th className="sp-num">Товаров</th>
                <th>Активность</th>
              </tr>
            </thead>
            <tbody>
              {plan.counterparties.map((cp) => {
                const status = STATUS_META[cp.status];
                const expanded = expandedKey === cp.key;
                return (
                  <PlanCounterpartyRow
                    key={cp.key}
                    cp={cp}
                    status={status}
                    expanded={expanded}
                    onToggle={() => setExpandedKey(expanded ? null : cp.key)}
                  />
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Итого по {plan.counterparties.length} {plan.counterparties.length === 1 ? "контрагенту" : "контрагентам"}</td>
                <td className="sp-num sp-revenue">{fmtMoney(plan.totalRevenue)}</td>
                <td className="sp-num">
                  {fmtMoney(plan.counterparties.reduce((s, c) => s + c.knownRevenue, 0))}
                </td>
                <td className="sp-num sp-revenue">
                  {fmtMoney(plan.counterparties.reduce((s, c) => s + c.remainingRevenue, 0))}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Позиции плана ── */}
      <div className="admin-card">
        <div className="admin-card__head">
          <h3 className="admin-card__title">Позиции плана: сколько потратим и сколько получим</h3>
          <span className="admin-badge admin-badge--muted">{plan.products.length}</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table sp-table sp-table--products">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="sp-num">План на месяц</th>
                <th className="sp-num">Уже в месяце</th>
                <th className="sp-num">Осталось к плану</th>
                <th className="sp-num">Выручка</th>
                <th className="sp-num">Закупка</th>
                <th className="sp-num">Маржа</th>
                <th className="sp-num">Остаток</th>
                <th>Покрытие склада</th>
              </tr>
            </thead>
            <tbody>
              {plan.products.map((p) => {
                const planLabel = qtyLabel(p.planQty, p.isCuttable, p.metersPerRoll);
                const remainLabel = qtyLabel(p.remainingQty, p.isCuttable, p.metersPerRoll);
                const stockLabel =
                  p.stockQty != null
                    ? qtyLabel(p.stockQty, p.isCuttable, p.metersPerRoll)
                    : "—";
                return (
                  <tr key={p.productId}>
                    <td>
                      <div className="sp-party">
                        <span className="sp-party__name">{p.name}</span>
                        {p.sku && <span className="sp-party__meta">Артикул {p.sku}</span>}
                      </div>
                    </td>
                    <td className="sp-num">{planLabel}</td>
                    <td className="sp-num">
                      {p.knownQty > 0.004 ? (
                        <span style={{ color: "var(--adm-steel)", fontWeight: 600 }}>
                          {qtyLabel(p.knownQty, p.isCuttable, p.metersPerRoll)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="sp-num">{p.remainingQty > 0.004 ? remainLabel : "—"}</td>
                    <td className="sp-num sp-revenue">{fmtMoney(p.revenue)}</td>
                    <td className="sp-num">
                      {p.hasPurchasePrice ? fmtMoney(p.cost) : <span title="Не указана закупочная цена в карточке товара">—</span>}
                    </td>
                    <td className={`sp-num ${p.margin >= 0 ? "sp-margin" : "sp-margin--neg"}`}>
                      {p.hasPurchasePrice ? fmtMoney(p.margin) : "—"}
                    </td>
                    <td className="sp-num">{stockLabel}</td>
                    <td>
                      {p.stockQty == null ? (
                        <span className="admin-badge admin-badge--muted">нет в номенклатуре</span>
                      ) : p.shortageQty > 0.004 ? (
                        <span className="admin-badge admin-badge--red" title={`Не хватает ${qtyLabel(p.shortageQty, p.isCuttable, p.metersPerRoll)}`}>
                          <AlertTriangle size={10} /> докупить {qtyLabel(p.shortageQty, p.isCuttable, p.metersPerRoll)}
                          {p.hasPurchasePrice && p.shortageCost > 0 ? ` · ${fmtMoney(p.shortageCost)}` : ""}
                        </span>
                      ) : (
                        <span className="admin-badge admin-badge--green">
                          <CheckCircle2 size={10} /> хватает
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {plan.products.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="admin-empty" style={{ padding: 20 }}>
                      <p>В выбранном месяце пока нет позиций в плане</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {plan.products.length > 0 && (
              <tfoot>
                <tr>
                  <td>Итого</td>
                  <td colSpan={3} />
                  <td className="sp-num sp-revenue">{fmtMoney(plan.totalRevenue)}</td>
                  <td className="sp-num">{fmtMoney(plan.totalCost)}</td>
                  <td className={`sp-num ${plan.totalMargin >= 0 ? "sp-margin" : "sp-margin--neg"}`}>
                    {fmtMoney(plan.totalMargin)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="rf-note">
        <Info size={13} />
        <span>
          <b>Методика плана:</b> среднемесячный объём каждого контрагента и товара — за
          последние 6 месяцев (скользящее среднее по календарным месяцам, месяцы без заказов
          считаются нулями). В план попадают контрагенты, заказывавшие в прошлом/этом месяце
          или в последние 3 месяца, плюс оформившие заказ в плановом месяце. «Закупка» — план-количество ×
          закупочная цена из карточки товара, «маржа» = выручка − закупка. Архивные заказы из
          массовой загрузки участвуют в расчёте наравне с обычными.
        </span>
      </div>
    </div>
  );
}

function PlanCounterpartyRow({
  cp,
  status,
  expanded,
  onToggle,
}: {
  cp: SalesPlanCounterparty;
  status: { label: string; className: string; title: string };
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="sp-cp-row"
        onClick={onToggle}
        style={{ cursor: "pointer" }}
        title="Нажмите, чтобы увидеть товары контрагента"
      >
        <td>
          <div className="sp-party">
            <span className="sp-party__name">
              {expanded ? "▾ " : "▸ "}
              {cp.displayName}
            </span>
            <span className="sp-party__meta">
              последний заказ: {fmtDate(cp.lastOrderDate)}
            </span>
          </div>
        </td>
        <td className="sp-num">
          {cp.expectedOrders >= 0.05 ? `~${cp.expectedOrders.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}` : "—"}
        </td>
        <td className="sp-num">{cp.avgCheck > 0 ? fmtMoney(cp.avgCheck) : "—"}</td>
        <td className="sp-num sp-revenue">{fmtMoney(cp.revenue)}</td>
        <td className="sp-num">
          {cp.knownRevenue > 0 ? (
            <span style={{ color: "var(--adm-steel)", fontWeight: 600 }}>{fmtMoney(cp.knownRevenue)}</span>
          ) : (
            "—"
          )}
        </td>
        <td className="sp-num sp-revenue">
          {cp.remainingRevenue > 0 ? fmtMoney(cp.remainingRevenue) : "—"}
        </td>
        <td className="sp-num">{cp.productLines.length}</td>
        <td>
          <span className={status.className} title={status.title} style={{ whiteSpace: "nowrap" }}>
            {status.label}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="sp-detail">
          <td colSpan={8}>
            <table className="admin-table sp-table sp-table--nested">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="sp-num">Ожидаем кол-во</th>
                  <th className="sp-num">Ожидаемая выручка</th>
                </tr>
              </thead>
              <tbody>
                {cp.productLines.map((line) => (
                  <tr key={line.productId}>
                    <td>{line.name}</td>
                    <td className="sp-num">{fmtQty(line.planQty)}</td>
                    <td className="sp-num sp-revenue">{fmtMoney(line.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sp-detail__foot">
              Маржа по контрагенту:{" "}
              <b className={cp.margin >= 0 ? "sp-margin" : "sp-margin--neg"}>
                {fmtMoney(cp.margin)}
              </b>
              {" "}· себестоимость {fmtMoney(cp.cost)}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
