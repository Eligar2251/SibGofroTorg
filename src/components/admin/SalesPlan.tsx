// =========================================================
// FILE: src/components/admin/SalesPlan.tsx
// Единая вкладка «План» (бывшие «Прогноз» + «План»):
// просчитывает, какую ПРИБЫЛЬ получим за выбранные месяцы
// (один или несколько), по каждому контрагенту, исходя из
// их заказов и среднего чека, и какую прибыль дадут товары.
//
// Методика — см. computeProfitPlan в @/lib/sales-plan:
// скользящее среднее по 6 месяцам до начала периода;
// средний чек = сумма заказов окна ÷ число заказов;
// прибыль = выручка − закупка (закупочная цена из карточки).
// =========================================================

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Target,
  Wallet,
  UsersRound,
  Package,
  ChevronLeft,
  ChevronRight,
  Info,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Search,
} from "lucide-react";
import type { CustomerDeal, WarehouseStockRow } from "@/lib/warehouse-shared";
import {
  computeProfitPlan,
  type ProfitPlanCounterparty,
} from "@/lib/sales-plan";
import { monthKeyOffset, monthLabelOf } from "@/lib/revenue-forecast";
import { formatCuttableStock } from "@/lib/types";

const fmt = (n: number) =>
  n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });

const fmtMoney = (n: number) => `${fmt(n)} ₽`;

const fmtQty = (n: number) =>
  n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

const STATUS_META: Record<
  ProfitPlanCounterparty["status"],
  { label: string; className: string; title: string }
> = {
  active: {
    label: "активен",
    className: "admin-badge admin-badge--green",
    title: "Заказывал в месяц перед началом периода или уже оформил в периоде",
  },
  recent: {
    label: "недавно",
    className: "admin-badge admin-badge--blue",
    title: "Заказывал в последние 3 месяца окна анализа",
  },
  sleeping: {
    label: "спит",
    className: "admin-badge admin-badge--gray",
    title: "Давно не заказывал, но уже оформил заказ в периоде",
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

/** Быстрые пресеты длительности периода. */
const PERIOD_PRESETS = [
  { label: "1 мес", months: 1 },
  { label: "3 мес", months: 3 },
  { label: "6 мес", months: 6 },
  { label: "12 мес", months: 12 },
];

export function SalesPlan({
  deals,
  stock,
  adminPath,
}: {
  deals: CustomerDeal[];
  stock: WarehouseStockRow[];
  adminPath: string;
}) {
  // Период задаётся сдвигом начала и конца от текущего месяца.
  // По умолчанию — текущий месяц (как было в старой вкладке).
  const [startOffset, setStartOffset] = useState(0);
  const [endOffset, setEndOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const startKey = monthKeyOffset(Math.min(startOffset, endOffset));
  const endKey = monthKeyOffset(Math.max(startOffset, endOffset));

  const plan = useMemo(
    () => computeProfitPlan(deals, stock, startKey, endKey, 6),
    [deals, stock, startKey, endKey]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru-RU");
    if (!q) return plan.counterparties;
    return plan.counterparties.filter((cp) =>
      cp.displayName.toLocaleLowerCase("ru-RU").includes(q)
    );
  }, [plan.counterparties, query]);

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
  const moveStart = (delta: number) =>
    setStartOffset((v) => Math.max(-23, Math.min(endOffset, v + delta)));
  const moveEnd = (delta: number) =>
    setEndOffset((v) => Math.max(startOffset, Math.min(23, v + delta)));

  return (
    <div className="sp">
      {/* ── Период: «от» — «до» ── */}
      <div className="sp-toolbar">
        <div className="sp-period">
          <span className="sp-period__label">План на период:</span>
          <div className="rf-month-nav">
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => moveStart(-1)}
              disabled={startOffset <= -23 || startOffset === endOffset}
              aria-label="Начало периода — предыдущий месяц"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="rf-month-label">{monthLabelOf(startKey)}</span>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => moveStart(1)}
              disabled={startOffset >= endOffset}
              aria-label="Начало периода — следующий месяц"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <span className="sp-period__dash">—</span>
          <div className="rf-month-nav">
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => moveEnd(-1)}
              disabled={endOffset <= startOffset}
              aria-label="Конец периода — предыдущий месяц"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="rf-month-label">{monthLabelOf(endKey)}</span>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => moveEnd(1)}
              disabled={endOffset >= 23}
              aria-label="Конец периода — следующий месяц"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
        <div className="sp-period__presets">
          {PERIOD_PRESETS.map((preset) => (
            <button
              key={preset.months}
              type="button"
              className={`admin-btn admin-btn--ghost admin-btn--sm${
                plan.monthCount === preset.months ? " sp-preset--on" : ""
              }`}
              onClick={() => {
                setStartOffset(0);
                setEndOffset(preset.months - 1);
              }}
              title={`Текущий месяц + ещё ${preset.months - 1}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div style={{ position: "relative", flex: 1, maxWidth: 280, marginLeft: "auto" }}>
          <Search
            size={15}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--adm-sand)",
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по контрагенту..."
            className="admin-input"
            style={{ paddingLeft: 32 }}
          />
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

      {/* ── Сводка: прибыль за период — главная цифра ── */}
      <div className="sp-summary">
        <div className="sp-summary__main">
          <span className="sp-summary__label">План на период · {plan.periodLabel}</span>
          <strong className="sp-summary__value sp-profit">{fmtMoney(plan.totalProfit)}</strong>
          <span className="sp-summary__hint">
            ожидаемая прибыль · выручка <b>{fmtMoney(plan.totalRevenue)}</b> −
            закупка <b>{fmtMoney(plan.totalCost)}</b>
          </span>
        </div>
        <div className="sp-summary__stats">
          <div className="rf-stat">
            <span className="rf-stat__icon" style={{ color: "var(--adm-pine)" }}><Wallet size={15} /></span>
            <span className="rf-stat__val">{fmtMoney(plan.totalRevenue)}</span>
            <span className="rf-stat__label">выручка за период</span>
          </div>
          <div className="rf-stat">
            <span className="rf-stat__icon" style={{ color: "var(--adm-rust)" }}><Package size={15} /></span>
            <span className="rf-stat__val">{fmtMoney(plan.totalCost)}</span>
            <span className="rf-stat__label">себестоимость</span>
          </div>
          <div className="rf-stat">
            <span className="rf-stat__icon" style={{ color: "var(--adm-steel)" }}><UsersRound size={15} /></span>
            <span className="rf-stat__val">{plan.activeCounterparties} / {plan.counterparties.length}</span>
            <span className="rf-stat__label">контрагентов в работе</span>
          </div>
          <div className="rf-stat">
            <span className="rf-stat__icon" style={{ color: "var(--adm-kraft)" }}><Target size={15} /></span>
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
            {plan.shortageProductsCount === 1 ? "позиции" : "позиций"} на складе
            — потребуется докупить примерно на{" "}
            <b>{fmtMoney(plan.totalShortageCost)}</b>. Смотрите блок «Покрытие склада».
          </span>
        </div>
      )}

      {/* ── Контрагенты: средний чек и прибыль за период ── */}
      <div className="admin-card">
        <div className="admin-card__head">
          <h3 className="admin-card__title">
            Контрагенты: средний чек и прибыль · {plan.periodLabel.toLowerCase()}
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
                <th className="sp-num">Прибыль</th>
                <th>Активность</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((cp) => {
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
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="admin-empty" style={{ padding: 20 }}>
                      <p>Ничего не найдено по запросу «{query}»</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3}>Итого по {rows.length} {rows.length === 1 ? "контрагенту" : "контрагентам"}</td>
                  <td className="sp-num sp-revenue">{fmtMoney(rows.reduce((s, c) => s + c.revenue, 0))}</td>
                  <td className="sp-num">
                    {fmtMoney(rows.reduce((s, c) => s + c.knownRevenue, 0))}
                  </td>
                  <td className="sp-num sp-revenue">
                    {fmtMoney(rows.reduce((s, c) => s + c.remainingRevenue, 0))}
                  </td>
                  <td className={`sp-num ${rows.reduce((s, c) => s + c.profit, 0) >= 0 ? "sp-margin" : "sp-margin--neg"}`}>
                    {fmtMoney(rows.reduce((s, c) => s + c.profit, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Позиции плана: сколько потратим и сколько получим ── */}
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
                <th className="sp-num">План на период</th>
                <th className="sp-num">Уже в периоде</th>
                <th className="sp-num">Осталось к плану</th>
                <th className="sp-num">Выручка</th>
                <th className="sp-num">Закупка</th>
                <th className="sp-num">Прибыль</th>
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
                    <td className={`sp-num ${p.profit >= 0 ? "sp-margin" : "sp-margin--neg"}`}>
                      {p.hasPurchasePrice ? fmtMoney(p.profit) : "—"}
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
                      <p>В выбранном периоде пока нет позиций в плане</p>
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
                  <td className={`sp-num ${plan.totalProfit >= 0 ? "sp-margin" : "sp-margin--neg"}`}>
                    {fmtMoney(plan.totalProfit)}
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
          <b>Методика плана:</b> для каждого контрагента берём его заказы за
          последние {plan.windowMonths} месяцев до начала периода (скользящее
          среднее, месяцы без заказов считаются нулями) и считаем <b>средний чек</b>.
          План на период = средний чек × ожидаемое число заказов за выбранные
          месяцы (+ уже оформленное в периоде). Прибыль = выручка − закупка
          (закупочная цена из карточки товара). «Закупка» у товара без закупочной
          цены не считается. Архивные заказы из массовой загрузки участвуют в
          расчёте наравне с обычными.
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
  cp: ProfitPlanCounterparty;
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
        <td className={`sp-num ${cp.profit >= 0 ? "sp-margin" : "sp-margin--neg"}`}>
          {fmtMoney(cp.profit)}
        </td>
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
                  <th className="sp-num">Закупка</th>
                  <th className="sp-num">Прибыль</th>
                </tr>
              </thead>
              <tbody>
                {cp.productLines.map((line) => (
                  <tr key={line.productId}>
                    <td>{line.name}</td>
                    <td className="sp-num">{fmtQty(line.planQty)}</td>
                    <td className="sp-num sp-revenue">{fmtMoney(line.revenue)}</td>
                    <td className="sp-num">{line.cost > 0 ? fmtMoney(line.cost) : "—"}</td>
                    <td className={`sp-num ${line.profit >= 0 ? "sp-margin" : "sp-margin--neg"}`}>
                      {fmtMoney(line.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sp-detail__foot">
              Прибыль по контрагенту:{" "}
              <b className={cp.profit >= 0 ? "sp-margin" : "sp-margin--neg"}>
                {fmtMoney(cp.profit)}
              </b>{" "}
              · выручка {fmtMoney(cp.revenue)} · себестоимость {fmtMoney(cp.cost)}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
