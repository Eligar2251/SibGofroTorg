"use client";

// =========================================================
// FILE: src/components/admin/ProfitReportClient.tsx
// Расчёт выгоды продаж за период + красивая печать на A4.
//
// Данные о продажах приходят из учёта (по каждому товару — список продаж:
// кому, когда, сколько, по какой цене). Пользователь выбирает товары,
// задаёт один раз на позицию цену производства (Мы) и цену закупки у
// конкурента, а компонент считает:
//   • общее проданное количество и выручку (кол-во × цена продажи);
//   • себестоимость нашего производства и прибыль с него;
//   • во сколько обошлась бы закупка у конкурента и прибыль в этом случае;
//   • выгоду производства = экономия против закупки у конкурента.
// Любую сумму (включая итоги) можно переопределить вручную — полная
// редактируемость. Готовую сводку печатаем на A4.
// =========================================================

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Printer,
  Search,
  Plus,
  X,
  Trash2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Calculator,
  Factory,
  Building2,
  Info,
} from "lucide-react";

export interface ProfitSale {
  dealNumber: number;
  date: string;
  customer: string;
  qty: number;
  price: number;
  total: number;
  status: "new" | "completed" | "cancelled";
  isArchive: boolean;
}

export interface ProfitProduct {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  priceWholesale: number | null;
  purchasePrice: number | null;
  sales: ProfitSale[];
}

interface PositionSale {
  id: string;
  date: string;
  customer: string;
  qty: number;
  price: number;
}

// Переопределяемые (вычисляемые) поля позиции.
type OvField =
  | "qty"
  | "revenue"
  | "ourCost"
  | "competitorCost"
  | "ourProfit"
  | "competitorProfit"
  | "benefit";

interface Position {
  id: string;
  productId: string | null;
  name: string;
  sku: string | null;
  unit: string;
  productionCost: number; // Мы: себестоимость 1 шт
  competitorPrice: number; // Конкурент: цена 1 шт
  salePrice: number; // Цена продажи 1 шт
  sales: PositionSale[];
  expanded: boolean;
  ov: Partial<Record<OvField, number>>;
}

type GovField =
  | "qty"
  | "revenue"
  | "ourCost"
  | "competitorCost"
  | "ourProfit"
  | "competitorProfit"
  | "benefit";

interface ReportMeta {
  title: string;
  company: string;
  periodFrom: string;
  periodTo: string;
  note: string;
  completedOnly: boolean;
  showDetails: boolean;
  signer: string;
}

interface StoredState {
  meta: ReportMeta;
  positions: Position[];
  gov: Partial<Record<GovField, number>>;
}

const STORAGE_KEY = "profit-report-v1";

const DEFAULT_META: ReportMeta = {
  title: "Отчёт о выгоде продаж",
  company: "СибГофроТорг",
  periodFrom: "",
  periodTo: "",
  note: "",
  completedOnly: false,
  showDetails: true,
  signer: "",
};

// ── Утилиты чисел/формата ──
function parseNum(s: string): number {
  if (typeof s !== "string") return Number(s) || 0;
  const cleaned = s.replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function fmtMoney(n: number): string {
  const v = round2(n || 0);
  return (
    v.toLocaleString("ru-RU", {
      minimumFractionDigits: v % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }) + " ₽"
  );
}
function fmtNum(n: number): string {
  const v = round2(n || 0);
  return v.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}
function fmtDate(iso: string): string {
  if (!iso) return "—";
  const parts = iso.split("-");
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return iso;
}
function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Продажи товара, отфильтрованные по периоду и статусу → в позиции.
function pickSales(
  product: ProfitProduct,
  meta: ReportMeta
): PositionSale[] {
  return product.sales
    .filter((s) => {
      if (meta.completedOnly && s.status !== "completed") return false;
      if (meta.periodFrom && s.date < meta.periodFrom) return false;
      if (meta.periodTo && s.date > meta.periodTo) return false;
      return true;
    })
    .map((s) => ({
      id: uid(),
      date: s.date,
      customer: s.customer,
      qty: s.qty,
      price: s.price,
    }));
}

function makePosition(product: ProfitProduct, meta: ReportMeta): Position {
  const sales = pickSales(product, meta);
  const sumQty = sales.reduce((a, s) => a + s.qty, 0);
  const sumSum = sales.reduce((a, s) => a + s.qty * s.price, 0);
  const avgPrice =
    sumQty > 0 ? round2(sumSum / sumQty) : round2(product.price ?? 0);
  return {
    id: uid(),
    productId: product.id,
    name: product.name,
    sku: product.sku,
    unit: "шт",
    // Себестоимость производства как стартовое значение берём из закупочной
    // цены в базе (если задана) — её всегда можно поправить.
    productionCost: round2(product.purchasePrice ?? 0),
    competitorPrice: 0,
    salePrice: avgPrice,
    sales,
    expanded: false,
    ov: {},
  };
}

function emptyPosition(): Position {
  return {
    id: uid(),
    productId: null,
    name: "",
    sku: null,
    unit: "шт",
    productionCost: 0,
    competitorPrice: 0,
    salePrice: 0,
    sales: [],
    expanded: false,
    ov: {},
  };
}

// ── Вычисления позиции ──
interface Calc {
  qty: number;
  revenue: number;
  ourCost: number;
  competitorCost: number;
  ourProfit: number;
  competitorProfit: number;
  benefit: number;
  margin: number;
}
function calcPosition(p: Position): Calc {
  const sumQty = p.sales.reduce((a, s) => a + s.qty, 0);
  const qty = p.ov.qty ?? sumQty;
  const revenue = p.ov.revenue ?? round2(qty * p.salePrice);
  const ourCost = p.ov.ourCost ?? round2(qty * p.productionCost);
  const competitorCost =
    p.ov.competitorCost ?? round2(qty * p.competitorPrice);
  const ourProfit = p.ov.ourProfit ?? round2(revenue - ourCost);
  const competitorProfit =
    p.ov.competitorProfit ?? round2(revenue - competitorCost);
  const benefit = p.ov.benefit ?? round2(competitorCost - ourCost);
  const margin = revenue !== 0 ? round2((ourProfit / revenue) * 100) : 0;
  return {
    qty,
    revenue,
    ourCost,
    competitorCost,
    ourProfit,
    competitorProfit,
    benefit,
    margin,
  };
}

export function ProfitReportClient({
  products,
  storageKey = STORAGE_KEY,
  demo = false,
}: {
  products: ProfitProduct[];
  /** Ключ localStorage (превью использует отдельный, чтобы не затирать рабочий отчёт). */
  storageKey?: string;
  /** Демо-режим: при пустом отчёте автоматически подставить примеры позиций. */
  demo?: boolean;
}) {
  const [meta, setMeta] = useState<ReportMeta>(DEFAULT_META);
  const [positions, setPositions] = useState<Position[]>([]);
  const [gov, setGov] = useState<Partial<Record<GovField, number>>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);

  // ── Загрузка из localStorage ──
  useEffect(() => {
    let hadStored = false;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredState;
        if (parsed.meta) setMeta({ ...DEFAULT_META, ...parsed.meta });
        if (Array.isArray(parsed.positions)) setPositions(parsed.positions);
        if (parsed.gov) setGov(parsed.gov);
        hadStored = true;
      }
    } catch {
      /* нет сохранёнки */
    }
    // Демо-режим (страница предпросмотра): если отчёт пуст — подставим
    // несколько примеров, чтобы сразу видеть расчёт и печать.
    if (!hadStored && demo && products.length > 0) {
      const seed = products.slice(0, 3).map((p, i) => {
        const pos = makePosition(p, DEFAULT_META);
        pos.competitorPrice = round2(pos.productionCost * (1.35 + i * 0.1)) || 0;
        return pos;
      });
      setPositions(seed);
      setMeta((m) => ({ ...m, note: "Пример расчёта на демо-данных." }));
    }
    setLoaded(true);
  }, [storageKey, demo, products]);

  // ── Сохранение ──
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ meta, positions, gov } satisfies StoredState)
      );
    } catch {
      /* localStorage недоступен */
    }
  }, [meta, positions, gov, loaded, storageKey]);

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const calcs = useMemo(() => positions.map(calcPosition), [positions]);

  // ── Итоги (сумма отображаемых + ручное переопределение) ──
  const totals = useMemo(() => {
    const sum = (key: keyof Calc) =>
      calcs.reduce((a, c) => a + (c[key] as number), 0);
    const qty = gov.qty ?? sum("qty");
    const revenue = gov.revenue ?? round2(sum("revenue"));
    const ourCost = gov.ourCost ?? round2(sum("ourCost"));
    const competitorCost = gov.competitorCost ?? round2(sum("competitorCost"));
    const ourProfit = gov.ourProfit ?? round2(sum("ourProfit"));
    const competitorProfit =
      gov.competitorProfit ?? round2(sum("competitorProfit"));
    const benefit = gov.benefit ?? round2(sum("benefit"));
    const margin = revenue !== 0 ? round2((ourProfit / revenue) * 100) : 0;
    return {
      qty,
      revenue,
      ourCost,
      competitorCost,
      ourProfit,
      competitorProfit,
      benefit,
      margin,
    };
  }, [calcs, gov]);

  // ── Мутации ──
  const updatePos = useCallback(
    (id: string, patch: Partial<Position>) => {
      setPositions((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
      );
    },
    []
  );
  const setOv = useCallback(
    (id: string, field: OvField, value: number | undefined) => {
      setPositions((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const ov = { ...p.ov };
          if (value === undefined) delete ov[field];
          else ov[field] = value;
          return { ...p, ov };
        })
      );
    },
    []
  );
  const setGovField = useCallback(
    (field: GovField, value: number | undefined) => {
      setGov((prev) => {
        const next = { ...prev };
        if (value === undefined) delete next[field];
        else next[field] = value;
        return next;
      });
    },
    []
  );

  function addProduct(product: ProfitProduct) {
    if (positions.some((p) => p.productId === product.id)) {
      // Уже добавлен — просто прокрутимся к нему.
      return;
    }
    setPositions((prev) => [...prev, makePosition(product, meta)]);
  }

  function addManual() {
    setPositions((prev) => [...prev, emptyPosition()]);
    setPickerOpen(false);
  }

  function removePos(id: string) {
    setPositions((prev) => prev.filter((p) => p.id !== id));
  }

  function rebuildFromSource() {
    setPositions((prev) =>
      prev.map((p) => {
        if (!p.productId) return p;
        const src = productMap.get(p.productId);
        if (!src) return p;
        const sales = pickSales(src, meta);
        const sumQty = sales.reduce((a, s) => a + s.qty, 0);
        const sumSum = sales.reduce((a, s) => a + s.qty * s.price, 0);
        const avgPrice =
          sumQty > 0 ? round2(sumSum / sumQty) : p.salePrice;
        return {
          ...p,
          sales,
          salePrice: avgPrice || p.salePrice,
          // Пересобрали фактические продажи — снимаем ручные правки
          // количества/выручки, чтобы отражать период. Цены (Мы/конкурент)
          // остаются как заданы вручную.
          ov: {},
        };
      })
    );
  }

  function resetAll() {
    if (
      !window.confirm(
        "Очистить отчёт полностью? Позиции и правки будут удалены."
      )
    )
      return;
    setPositions([]);
    setGov({});
    setMeta(DEFAULT_META);
  }

  // ── Продажи внутри позиции ──
  function addSale(posId: string) {
    setPositions((prev) =>
      prev.map((p) =>
        p.id === posId
          ? {
              ...p,
              expanded: true,
              sales: [
                ...p.sales,
                {
                  id: uid(),
                  date: meta.periodTo || new Date().toISOString().slice(0, 10),
                  customer: "",
                  qty: 0,
                  price: p.salePrice,
                },
              ],
            }
          : p
      )
    );
  }
  function updateSale(
    posId: string,
    saleId: string,
    patch: Partial<PositionSale>
  ) {
    setPositions((prev) =>
      prev.map((p) =>
        p.id === posId
          ? {
              ...p,
              sales: p.sales.map((s) =>
                s.id === saleId ? { ...s, ...patch } : s
              ),
            }
          : p
      )
    );
  }
  function removeSale(posId: string, saleId: string) {
    setPositions((prev) =>
      prev.map((p) =>
        p.id === posId
          ? { ...p, sales: p.sales.filter((s) => s.id !== saleId) }
          : p
      )
    );
  }

  // ── Поиск товаров ──
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q)
      );
    });
    // Сначала товары с продажами.
    return list
      .sort((a, b) => {
        const av = a.sales.length > 0 ? 0 : 1;
        const bv = b.sales.length > 0 ? 0 : 1;
        if (av !== bv) return av - bv;
        return a.name.localeCompare(b.name, "ru");
      })
      .slice(0, 60);
  }, [products, search]);

  const addedIds = useMemo(
    () => new Set(positions.map((p) => p.productId).filter(Boolean) as string[]),
    [positions]
  );

  function handlePrint() {
    window.print();
  }

  // ── Ячейка с переопределением (вычисляемое поле) ──
  function OvInput({
    pos,
    field,
    computed,
    tone,
  }: {
    pos: Position;
    field: OvField;
    computed: number;
    tone?: "profit" | "benefit";
  }) {
    const overridden = pos.ov[field] !== undefined;
    const val = overridden ? pos.ov[field]! : computed;
    return (
      <div className={`pr-ovcell${overridden ? " pr-ovcell--ov" : ""}`}>
        <input
          className={`pr-num${tone ? ` pr-num--${tone}` : ""}`}
          inputMode="decimal"
          value={String(round2(val))}
          onChange={(e) => {
            const t = e.target.value.trim();
            if (t === "") setOv(pos.id, field, undefined);
            else setOv(pos.id, field, parseNum(t));
          }}
        />
        {overridden && (
          <button
            type="button"
            className="pr-reset"
            title="Вернуть расчётное значение"
            onClick={() => setOv(pos.id, field, undefined)}
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    );
  }

  function GovInput({
    field,
    computed,
    tone,
  }: {
    field: GovField;
    computed: number;
    tone?: "profit" | "benefit";
  }) {
    const overridden = gov[field] !== undefined;
    const val = overridden ? gov[field]! : computed;
    return (
      <div className={`pr-ovcell${overridden ? " pr-ovcell--ov" : ""}`}>
        <input
          className={`pr-num pr-num--bold${tone ? ` pr-num--${tone}` : ""}`}
          inputMode="decimal"
          value={String(round2(val))}
          onChange={(e) => {
            const t = e.target.value.trim();
            if (t === "") setGovField(field, undefined);
            else setGovField(field, parseNum(t));
          }}
        />
        {overridden && (
          <button
            type="button"
            className="pr-reset"
            title="Вернуть расчётное значение"
            onClick={() => setGovField(field, undefined)}
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    );
  }

  const hasPositions = positions.length > 0;

  return (
    <div className="pr-root">
      <style>{PRINT_CSS}</style>

      {/* ── Панель управления ── */}
      <div className="admin-card no-print">
        <div className="admin-card__pad admin-stack">
          <div className="pr-controls">
            <label className="pr-field">
              <span className="pr-field__label">Заголовок отчёта</span>
              <input
                className="admin-input"
                value={meta.title}
                onChange={(e) => setMeta({ ...meta, title: e.target.value })}
              />
            </label>
            <label className="pr-field">
              <span className="pr-field__label">Организация</span>
              <input
                className="admin-input"
                value={meta.company}
                onChange={(e) => setMeta({ ...meta, company: e.target.value })}
              />
            </label>
            <label className="pr-field pr-field--sm">
              <span className="pr-field__label">Период с</span>
              <input
                type="date"
                className="admin-input"
                value={meta.periodFrom}
                onChange={(e) =>
                  setMeta({ ...meta, periodFrom: e.target.value })
                }
              />
            </label>
            <label className="pr-field pr-field--sm">
              <span className="pr-field__label">по</span>
              <input
                type="date"
                className="admin-input"
                value={meta.periodTo}
                onChange={(e) => setMeta({ ...meta, periodTo: e.target.value })}
              />
            </label>
          </div>

          <div className="pr-controls">
            <label className="pr-check">
              <input
                type="checkbox"
                checked={meta.completedOnly}
                onChange={(e) =>
                  setMeta({ ...meta, completedOnly: e.target.checked })
                }
              />
              <span>Только завершённые сделки</span>
            </label>
            <label className="pr-check">
              <input
                type="checkbox"
                checked={meta.showDetails}
                onChange={(e) =>
                  setMeta({ ...meta, showDetails: e.target.checked })
                }
              />
              <span>Детали продаж в печати (кому / когда)</span>
            </label>
          </div>

          <div className="pr-actions">
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={() => setPickerOpen((v) => !v)}
            >
              <Plus size={15} /> Добавить товар
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={addManual}
            >
              <Plus size={15} /> Своя позиция
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={rebuildFromSource}
              title="Заново подтянуть продажи из учёта за выбранный период"
              disabled={!hasPositions}
            >
              <RefreshCw size={15} /> Пересобрать из учёта
            </button>
            <div className="pr-actions__spacer" />
            <button
              type="button"
              className="admin-btn admin-btn--navy"
              onClick={handlePrint}
              disabled={!hasPositions}
            >
              <Printer size={15} /> Печать A4
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger-ghost"
              onClick={resetAll}
            >
              <Trash2 size={15} /> Очистить
            </button>
          </div>

          {pickerOpen && (
            <div className="pr-picker">
              <div className="pr-picker__search">
                <Search size={16} />
                <input
                  className="admin-input"
                  placeholder="Поиск товара по названию или артикулу…"
                  value={search}
                  autoFocus
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  type="button"
                  className="admin-btn admin-btn--icon admin-btn--ghost"
                  onClick={() => setPickerOpen(false)}
                  aria-label="Закрыть"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="pr-picker__list">
                {filteredProducts.length === 0 && (
                  <div className="pr-picker__empty">Ничего не найдено</div>
                )}
                {filteredProducts.map((p) => {
                  const soldQty = p.sales
                    .filter((s) => {
                      if (meta.completedOnly && s.status !== "completed")
                        return false;
                      if (meta.periodFrom && s.date < meta.periodFrom)
                        return false;
                      if (meta.periodTo && s.date > meta.periodTo) return false;
                      return true;
                    })
                    .reduce((a, s) => a + s.qty, 0);
                  const added = addedIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`pr-picker__item${added ? " pr-picker__item--added" : ""}`}
                      onClick={() => addProduct(p)}
                      disabled={added}
                    >
                      <span className="pr-picker__name">
                        {p.name}
                        {p.sku ? (
                          <span className="pr-picker__sku"> · {p.sku}</span>
                        ) : null}
                      </span>
                      <span className="pr-picker__meta">
                        {soldQty > 0 ? (
                          <span className="pr-picker__sold">
                            продано {fmtNum(soldQty)} шт
                          </span>
                        ) : (
                          <span className="pr-picker__nosold">нет продаж</span>
                        )}
                        {added ? <span className="pr-picker__tag">добавлен</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="pr-hint">
            <Info size={13} /> Цена производства (Мы) и цена конкурента задаются
            один раз на позицию. «Проданное количество» и продажи (кому/когда)
            подтягиваются из учёта за период. Любую сумму, включая итоги, можно
            переопределить вручную — рядом появится кнопка «↺», чтобы вернуть
            расчётное значение.
          </p>
        </div>
      </div>

      {/* ── Редактор (интерактивная таблица) ── */}
      {hasPositions ? (
        <div className="admin-card no-print">
          <div className="admin-card__pad">
            <div className="pr-table-scroll">
              <table className="pr-edit-table">
                <thead>
                  <tr>
                    <th className="pr-col-name">Товар</th>
                    <th>
                      Кол-во,
                      <br />
                      шт
                    </th>
                    <th>
                      Цена
                      <br />
                      продажи
                    </th>
                    <th>Выручка</th>
                    <th className="pr-th-us">
                      Мы: с/с
                      <br />1 шт
                    </th>
                    <th className="pr-th-us">Мы: сумма</th>
                    <th className="pr-th-comp">
                      Конкур.
                      <br />1 шт
                    </th>
                    <th className="pr-th-comp">Конкур.: сумма</th>
                    <th className="pr-th-profit">
                      Прибыль
                      <br />
                      (наша)
                    </th>
                    <th className="pr-th-profit">
                      Прибыль у
                      <br />
                      конкур.
                    </th>
                    <th className="pr-th-benefit">
                      Выгода
                      <br />
                      произв.
                    </th>
                    <th className="pr-col-act" />
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, idx) => {
                    const c = calcs[idx];
                    return (
                      <PositionRows
                        key={p.id}
                        p={p}
                        c={c}
                        OvInput={OvInput}
                        updatePos={updatePos}
                        removePos={removePos}
                        addSale={addSale}
                        updateSale={updateSale}
                        removeSale={removeSale}
                      />
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="pr-total-row">
                    <td className="pr-col-name">ИТОГО</td>
                    <td>
                      <GovInput field="qty" computed={totals.qty} />
                    </td>
                    <td className="pr-dim">—</td>
                    <td>
                      <GovInput field="revenue" computed={totals.revenue} />
                    </td>
                    <td className="pr-dim">—</td>
                    <td>
                      <GovInput field="ourCost" computed={totals.ourCost} />
                    </td>
                    <td className="pr-dim">—</td>
                    <td>
                      <GovInput
                        field="competitorCost"
                        computed={totals.competitorCost}
                      />
                    </td>
                    <td>
                      <GovInput
                        field="ourProfit"
                        computed={totals.ourProfit}
                        tone="profit"
                      />
                    </td>
                    <td>
                      <GovInput
                        field="competitorProfit"
                        computed={totals.competitorProfit}
                      />
                    </td>
                    <td>
                      <GovInput
                        field="benefit"
                        computed={totals.benefit}
                        tone="benefit"
                      />
                    </td>
                    <td className="pr-col-act" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="admin-card no-print">
          <div className="admin-card__pad">
            <div className="admin-empty">
              <Calculator size={26} />
              <p>
                Пока нет позиций. Нажмите «Добавить товар», чтобы выбрать товары
                из учёта, или «Своя позиция» для ручного ввода.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Красивое A4-превью (оно же печатается) ── */}
      {hasPositions && (
        <div className="admin-card pr-print-wrap">
          <div className="admin-card__pad">
            <div className="pr-a4-stage">
              <div className="pr-a4-sheet pr-print-area">
                <PrintSheet
                  meta={meta}
                  positions={positions}
                  calcs={calcs}
                  totals={totals}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Строки одной позиции в редакторе (основная + детали продаж) ──
function PositionRows({
  p,
  c,
  OvInput,
  updatePos,
  removePos,
  addSale,
  updateSale,
  removeSale,
}: {
  p: Position;
  c: Calc;
  OvInput: (args: {
    pos: Position;
    field: OvField;
    computed: number;
    tone?: "profit" | "benefit";
  }) => React.JSX.Element;
  updatePos: (id: string, patch: Partial<Position>) => void;
  removePos: (id: string) => void;
  addSale: (posId: string) => void;
  updateSale: (
    posId: string,
    saleId: string,
    patch: Partial<PositionSale>
  ) => void;
  removeSale: (posId: string, saleId: string) => void;
}) {
  return (
    <>
      <tr className="pr-pos-row">
        <td className="pr-col-name">
          <div className="pr-name-cell">
            <button
              type="button"
              className="pr-expand"
              onClick={() => updatePos(p.id, { expanded: !p.expanded })}
              title={p.expanded ? "Свернуть продажи" : "Показать продажи"}
            >
              {p.expanded ? (
                <ChevronDown size={15} />
              ) : (
                <ChevronRight size={15} />
              )}
            </button>
            <input
              className="pr-name-input"
              value={p.name}
              placeholder="Название товара"
              onChange={(e) => updatePos(p.id, { name: e.target.value })}
            />
          </div>
          {p.sales.length > 0 && (
            <span className="pr-sales-badge">
              {p.sales.length} прод.
            </span>
          )}
        </td>
        <td>
          <OvInput pos={p} field="qty" computed={c.qty} />
        </td>
        <td>
          <input
            className="pr-num"
            inputMode="decimal"
            value={String(p.salePrice)}
            onChange={(e) =>
              updatePos(p.id, { salePrice: parseNum(e.target.value) })
            }
          />
        </td>
        <td>
          <OvInput pos={p} field="revenue" computed={c.revenue} />
        </td>
        <td className="pr-td-us">
          <input
            className="pr-num"
            inputMode="decimal"
            value={String(p.productionCost)}
            onChange={(e) =>
              updatePos(p.id, { productionCost: parseNum(e.target.value) })
            }
          />
        </td>
        <td className="pr-td-us">
          <OvInput pos={p} field="ourCost" computed={c.ourCost} />
        </td>
        <td className="pr-td-comp">
          <input
            className="pr-num"
            inputMode="decimal"
            value={String(p.competitorPrice)}
            onChange={(e) =>
              updatePos(p.id, { competitorPrice: parseNum(e.target.value) })
            }
          />
        </td>
        <td className="pr-td-comp">
          <OvInput pos={p} field="competitorCost" computed={c.competitorCost} />
        </td>
        <td className="pr-td-profit">
          <OvInput pos={p} field="ourProfit" computed={c.ourProfit} tone="profit" />
        </td>
        <td className="pr-td-profit">
          <OvInput
            pos={p}
            field="competitorProfit"
            computed={c.competitorProfit}
          />
        </td>
        <td className="pr-td-benefit">
          <OvInput pos={p} field="benefit" computed={c.benefit} tone="benefit" />
        </td>
        <td className="pr-col-act">
          <button
            type="button"
            className="pr-row-del"
            onClick={() => removePos(p.id)}
            title="Удалить позицию"
          >
            <X size={15} />
          </button>
        </td>
      </tr>

      {p.expanded && (
        <tr className="pr-detail-row">
          <td colSpan={12}>
            <div className="pr-detail">
              <div className="pr-detail__head">
                <span>Продажи (кому · когда · сколько · по какой цене)</span>
                <button
                  type="button"
                  className="admin-btn admin-btn--sm admin-btn--ghost"
                  onClick={() => addSale(p.id)}
                >
                  <Plus size={13} /> Добавить продажу
                </button>
              </div>
              {p.sales.length === 0 ? (
                <p className="pr-detail__empty">
                  Продаж нет. Добавьте вручную или подтяните из учёта. Если
                  оставить пусто — количество можно ввести прямо в колонке
                  «Кол-во».
                </p>
              ) : (
                <table className="pr-detail-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Клиент</th>
                      <th>Кол-во</th>
                      <th>Цена</th>
                      <th>Сумма</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.sales.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <input
                            type="date"
                            className="pr-num pr-date"
                            value={s.date}
                            onChange={(e) =>
                              updateSale(p.id, s.id, { date: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="pr-cust"
                            value={s.customer}
                            placeholder="Кому"
                            onChange={(e) =>
                              updateSale(p.id, s.id, {
                                customer: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="pr-num pr-num--narrow"
                            inputMode="decimal"
                            value={String(s.qty)}
                            onChange={(e) =>
                              updateSale(p.id, s.id, {
                                qty: parseNum(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="pr-num pr-num--narrow"
                            inputMode="decimal"
                            value={String(s.price)}
                            onChange={(e) =>
                              updateSale(p.id, s.id, {
                                price: parseNum(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td className="pr-detail-sum">
                          {fmtMoney(s.qty * s.price)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="pr-row-del"
                            onClick={() => removeSale(p.id, s.id)}
                            title="Удалить продажу"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Печатная форма A4 ──
function PrintSheet({
  meta,
  positions,
  calcs,
  totals,
}: {
  meta: ReportMeta;
  positions: Position[];
  calcs: Calc[];
  totals: Calc;
}) {
  const periodText =
    meta.periodFrom || meta.periodTo
      ? `${meta.periodFrom ? fmtDate(meta.periodFrom) : "…"} — ${
          meta.periodTo ? fmtDate(meta.periodTo) : "…"
        }`
      : "весь период";
  const today = new Date();
  const genDate = `${String(today.getDate()).padStart(2, "0")}.${String(
    today.getMonth() + 1
  ).padStart(2, "0")}.${today.getFullYear()}`;

  return (
    <div className="pr-sheet">
      <div className="pr-sheet__head">
        <div>
          <div className="pr-sheet__company">{meta.company || "\u00A0"}</div>
          <h2 className="pr-sheet__title">{meta.title}</h2>
        </div>
        <div className="pr-sheet__period">
          <div>
            <span className="pr-sheet__plabel">Период:</span> {periodText}
          </div>
          <div>
            <span className="pr-sheet__plabel">Сформирован:</span> {genDate}
          </div>
        </div>
      </div>

      {meta.note ? <p className="pr-sheet__note">{meta.note}</p> : null}

      <table className="pr-sheet-table">
        <thead>
          <tr>
            <th className="pr-sheet-th-name">Товар</th>
            <th>Кол-во</th>
            <th>Цена прод.</th>
            <th>Выручка</th>
            <th>С/с 1 шт (Мы)</th>
            <th>Сумма произв.</th>
            <th>Конкур. 1 шт</th>
            <th>Сумма закупки</th>
            <th>Прибыль (наша)</th>
            <th>Выгода произв.</th>
            <th>Маржа</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => {
            const c = calcs[i];
            return (
              <PrintPositionBlock
                key={p.id}
                p={p}
                c={c}
                showDetails={meta.showDetails}
              />
            );
          })}
        </tbody>
        <tfoot>
          <tr className="pr-sheet-total">
            <td className="pr-sheet-th-name">ИТОГО</td>
            <td>{fmtNum(totals.qty)}</td>
            <td>—</td>
            <td>{fmtMoney(totals.revenue)}</td>
            <td>—</td>
            <td>{fmtMoney(totals.ourCost)}</td>
            <td>—</td>
            <td>{fmtMoney(totals.competitorCost)}</td>
            <td className="pr-pos">{fmtMoney(totals.ourProfit)}</td>
            <td className="pr-pos">{fmtMoney(totals.benefit)}</td>
            <td>{totals.margin}%</td>
          </tr>
        </tfoot>
      </table>

      {/* Итоговые плашки */}
      <div className="pr-sheet-summary">
        <div className="pr-sum-card">
          <div className="pr-sum-card__label">Выручка за период</div>
          <div className="pr-sum-card__value">{fmtMoney(totals.revenue)}</div>
        </div>
        <div className="pr-sum-card pr-sum-card--profit">
          <div className="pr-sum-card__label">
            Прибыль с нашего производства
          </div>
          <div className="pr-sum-card__value">{fmtMoney(totals.ourProfit)}</div>
        </div>
        <div className="pr-sum-card">
          <div className="pr-sum-card__label">
            Прибыль при закупке у конкурента
          </div>
          <div className="pr-sum-card__value">
            {fmtMoney(totals.competitorProfit)}
          </div>
        </div>
        <div className="pr-sum-card pr-sum-card--benefit">
          <div className="pr-sum-card__label">
            Выгода собственного производства
          </div>
          <div className="pr-sum-card__value">{fmtMoney(totals.benefit)}</div>
        </div>
      </div>

      <div className="pr-sheet__foot">
        <div className="pr-sign">
          <span className="pr-sign__line" />
          <span className="pr-sign__cap">
            {meta.signer ? meta.signer : "подпись / ФИО"}
          </span>
        </div>
        <div className="pr-sheet__foot-note">
          Расчёт сформирован автоматически · {meta.company || "СибГофроТорг"}
        </div>
      </div>
    </div>
  );
}

function PrintPositionBlock({
  p,
  c,
  showDetails,
}: {
  p: Position;
  c: Calc;
  showDetails: boolean;
}) {
  return (
    <>
      <tr className="pr-sheet-pos">
        <td className="pr-sheet-th-name">
          {p.name || "—"}
          {p.sku ? <span className="pr-sheet-sku"> · {p.sku}</span> : null}
        </td>
        <td>{fmtNum(c.qty)}</td>
        <td>{fmtMoney(p.salePrice)}</td>
        <td>{fmtMoney(c.revenue)}</td>
        <td>{fmtMoney(p.productionCost)}</td>
        <td>{fmtMoney(c.ourCost)}</td>
        <td>{fmtMoney(p.competitorPrice)}</td>
        <td>{fmtMoney(c.competitorCost)}</td>
        <td className="pr-pos">{fmtMoney(c.ourProfit)}</td>
        <td className="pr-pos">{fmtMoney(c.benefit)}</td>
        <td>{c.margin}%</td>
      </tr>
      {showDetails && p.sales.length > 0 && (
        <tr className="pr-sheet-detail">
          <td colSpan={11}>
            <div className="pr-sheet-detail__wrap">
              <span className="pr-sheet-detail__title">Продажи:</span>
              <ul className="pr-sheet-detail__list">
                {p.sales.map((s) => (
                  <li key={s.id}>
                    <span className="pr-sd-date">{fmtDate(s.date)}</span>
                    <span className="pr-sd-cust">{s.customer || "—"}</span>
                    <span className="pr-sd-qty">{fmtNum(s.qty)} шт</span>
                    <span className="pr-sd-price">× {fmtMoney(s.price)}</span>
                    <span className="pr-sd-sum">= {fmtMoney(s.qty * s.price)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Стили компонента + печати ──
const PRINT_CSS = `
.pr-root { display: flex; flex-direction: column; gap: 16px; }

.pr-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.pr-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 220px; min-width: 160px; }
.pr-field--sm { flex: 0 0 150px; min-width: 120px; }
.pr-field__label { font-size: 12px; font-weight: 600; color: var(--adm-muted, #64748b); }
.pr-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.pr-check input { width: 16px; height: 16px; }

.pr-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pr-actions__spacer { flex: 1 1 auto; }

.pr-hint {
  display: flex; gap: 6px; align-items: flex-start;
  font-size: 12px; color: var(--adm-muted, #64748b);
  background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.18);
  border-radius: 8px; padding: 8px 10px; margin: 0;
}
.pr-hint svg { flex: 0 0 auto; margin-top: 2px; }

/* ── Пикер ── */
.pr-picker { border: 1px solid var(--adm-border, #e2e8f0); border-radius: 10px; overflow: hidden; }
.pr-picker__search { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--adm-border, #e2e8f0); }
.pr-picker__search svg { flex: 0 0 auto; color: var(--adm-muted, #94a3b8); }
.pr-picker__list { max-height: 320px; overflow-y: auto; }
.pr-picker__item {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  width: 100%; text-align: left; padding: 9px 12px; background: none; border: none;
  border-bottom: 1px solid var(--adm-border, #f1f5f9); cursor: pointer; font-size: 13px;
}
.pr-picker__item:hover:not(:disabled) { background: rgba(59,130,246,0.06); }
.pr-picker__item--added { opacity: 0.55; cursor: default; }
.pr-picker__name { font-weight: 500; }
.pr-picker__sku { color: var(--adm-muted, #94a3b8); font-weight: 400; }
.pr-picker__meta { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; font-size: 12px; }
.pr-picker__sold { color: #16a34a; font-weight: 600; }
.pr-picker__nosold { color: var(--adm-muted, #94a3b8); }
.pr-picker__tag { background: #e0e7ff; color: #4338ca; border-radius: 6px; padding: 1px 6px; font-size: 11px; }
.pr-picker__empty { padding: 16px; text-align: center; color: var(--adm-muted, #94a3b8); font-size: 13px; }

/* ── Таблица-редактор ── */
.pr-table-scroll { overflow-x: auto; }
.pr-edit-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 1080px; }
.pr-edit-table th, .pr-edit-table td { border: 1px solid var(--adm-border, #e2e8f0); padding: 4px 6px; text-align: center; vertical-align: middle; }
.pr-edit-table thead th { background: var(--adm-soft, #f8fafc); font-weight: 600; font-size: 11.5px; color: var(--adm-fg, #334155); position: sticky; top: 0; }
.pr-th-us { background: rgba(37,99,235,0.08) !important; }
.pr-th-comp { background: rgba(217,119,6,0.09) !important; }
.pr-th-profit { background: rgba(22,163,74,0.09) !important; }
.pr-th-benefit { background: rgba(147,51,234,0.10) !important; }
.pr-td-us { background: rgba(37,99,235,0.03); }
.pr-td-comp { background: rgba(217,119,6,0.04); }
.pr-td-profit { background: rgba(22,163,74,0.04); }
.pr-td-benefit { background: rgba(147,51,234,0.05); }
.pr-col-name { text-align: left !important; min-width: 200px; }
.pr-col-act { width: 34px; }
.pr-dim { color: var(--adm-muted, #cbd5e1); }

.pr-name-cell { display: flex; align-items: center; gap: 4px; }
.pr-name-input { width: 100%; border: none; background: transparent; font-size: 12.5px; font-weight: 500; padding: 2px 4px; border-radius: 4px; }
.pr-name-input:focus { outline: 2px solid rgba(59,130,246,0.4); background: #fff; }
.pr-expand { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; cursor: pointer; color: var(--adm-muted, #64748b); border-radius: 5px; }
.pr-expand:hover { background: rgba(0,0,0,0.05); }
.pr-sales-badge { display: inline-block; margin-left: 26px; font-size: 10.5px; color: var(--adm-muted, #94a3b8); }

.pr-num { width: 100%; min-width: 62px; border: 1px solid transparent; background: transparent; text-align: right; font-size: 12.5px; padding: 3px 5px; border-radius: 5px; font-variant-numeric: tabular-nums; }
.pr-num:hover { border-color: var(--adm-border, #e2e8f0); }
.pr-num:focus { outline: none; border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
.pr-num--narrow { min-width: 52px; }
.pr-num--bold { font-weight: 700; }
.pr-num--profit { color: #15803d; font-weight: 600; }
.pr-num--benefit { color: #7c3aed; font-weight: 600; }

.pr-ovcell { display: flex; align-items: center; gap: 2px; }
.pr-ovcell--ov .pr-num { background: rgba(250,204,21,0.15); border-color: rgba(202,138,4,0.5); }
.pr-reset { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: none; background: none; color: #ca8a04; cursor: pointer; border-radius: 4px; }
.pr-reset:hover { background: rgba(202,138,4,0.15); }

.pr-row-del { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: none; background: none; color: #dc2626; cursor: pointer; border-radius: 5px; }
.pr-row-del:hover { background: rgba(220,38,38,0.1); }

.pr-total-row td { background: var(--adm-soft, #f1f5f9); font-weight: 700; }

/* Детали продаж в редакторе */
.pr-detail-row td { background: #fbfcfe; padding: 0 !important; }
.pr-detail { padding: 10px 14px 14px 40px; }
.pr-detail__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--adm-muted, #475569); }
.pr-detail__empty { font-size: 12px; color: var(--adm-muted, #94a3b8); margin: 0; }
.pr-detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pr-detail-table th, .pr-detail-table td { border: 1px solid var(--adm-border, #e2e8f0); padding: 3px 6px; }
.pr-detail-table th { background: #fff; font-weight: 600; font-size: 11px; color: var(--adm-muted, #64748b); }
.pr-date { min-width: 120px; text-align: left; }
.pr-cust { width: 100%; min-width: 140px; border: 1px solid transparent; background: transparent; font-size: 12px; padding: 3px 5px; border-radius: 5px; }
.pr-cust:hover { border-color: var(--adm-border, #e2e8f0); }
.pr-cust:focus { outline: none; border-color: #3b82f6; background: #fff; }
.pr-detail-sum { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ── A4 превью ── */
.pr-a4-stage { background: #e9edf3; padding: 24px; border-radius: 10px; display: flex; justify-content: center; overflow-x: auto; }
.pr-a4-sheet { width: 297mm; max-width: 100%; min-height: 210mm; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,0.12); padding: 12mm 12mm; box-sizing: border-box; }
.pr-sheet { font-family: Arial, "Segoe UI", sans-serif; color: #1e293b; font-size: 11px; }
.pr-sheet__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #1e293b; padding-bottom: 8px; margin-bottom: 6px; }
.pr-sheet__company { font-size: 13px; font-weight: 700; letter-spacing: 0.3px; }
.pr-sheet__title { font-size: 18px; font-weight: 800; margin: 2px 0 0; }
.pr-sheet__period { text-align: right; font-size: 11px; line-height: 1.5; white-space: nowrap; }
.pr-sheet__plabel { color: #64748b; }
.pr-sheet__note { font-size: 11px; font-style: italic; color: #475569; margin: 4px 0 8px; }

.pr-sheet-table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 6px; }
.pr-sheet-table th, .pr-sheet-table td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: right; vertical-align: top; }
.pr-sheet-table thead th { background: #1e293b; color: #fff; font-weight: 600; text-align: center; font-size: 9.5px; }
.pr-sheet-th-name { text-align: left !important; }
.pr-sheet-sku { color: #94a3b8; font-weight: 400; }
.pr-sheet-pos td { background: #fff; }
.pr-sheet-pos:nth-child(even) td { background: #f8fafc; }
.pr-pos { color: #15803d; font-weight: 700; }
.pr-sheet-total td { background: #e2e8f0 !important; font-weight: 800; font-size: 10.5px; }

.pr-sheet-detail td { background: #fbfcfe; padding: 3px 8px 5px 14px; }
.pr-sheet-detail__wrap { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
.pr-sheet-detail__title { font-weight: 700; color: #475569; font-size: 9.5px; }
.pr-sheet-detail__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; font-size: 9.5px; width: 100%; }
.pr-sheet-detail__list li { display: flex; gap: 10px; color: #334155; }
.pr-sd-date { min-width: 66px; color: #64748b; }
.pr-sd-cust { min-width: 180px; font-weight: 600; }
.pr-sd-qty { min-width: 60px; text-align: right; }
.pr-sd-price { min-width: 90px; }
.pr-sd-sum { font-weight: 600; }

.pr-sheet-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
.pr-sum-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; background: #f8fafc; }
.pr-sum-card__label { font-size: 9.5px; color: #64748b; margin-bottom: 3px; }
.pr-sum-card__value { font-size: 15px; font-weight: 800; }
.pr-sum-card--profit { background: #f0fdf4; border-color: #86efac; }
.pr-sum-card--profit .pr-sum-card__value { color: #15803d; }
.pr-sum-card--benefit { background: #faf5ff; border-color: #d8b4fe; }
.pr-sum-card--benefit .pr-sum-card__value { color: #7c3aed; }

.pr-sheet__foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; }
.pr-sign { display: flex; flex-direction: column; gap: 3px; min-width: 220px; }
.pr-sign__line { border-bottom: 1px solid #1e293b; height: 22px; }
.pr-sign__cap { font-size: 9.5px; color: #64748b; }
.pr-sheet__foot-note { font-size: 9px; color: #94a3b8; }

/* ── Печать ── */
@media print {
  @page { size: A4 landscape; margin: 8mm 8mm; }
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { position: static !important; top: auto !important; left: auto !important; right: auto !important; width: auto !important; max-width: none !important; padding: 0 !important; margin: 0 !important; overflow: visible !important; }
  body > *:not(:has(.pr-print-area)) { display: none !important; }
  .no-print { display: none !important; }
  .admin-sidebar, .admin-mobile-bar, .admin-sidebar-handle, .admin-notify, .admin-plans-shortcut, .admin-requests-shortcut { display: none !important; }
  .admin-shell, .admin-content, .admin-main, .admin-stack, .pr-root, .pr-print-wrap, .pr-print-wrap .admin-card__pad {
    display: block !important; margin: 0 !important; padding: 0 !important; max-width: none !important; width: auto !important; min-height: 0 !important; background: #fff !important; box-shadow: none !important; border: none !important;
  }
  .pr-a4-stage { display: block !important; background: #fff !important; padding: 0 !important; overflow: visible !important; }
  .pr-a4-sheet { width: 100% !important; min-height: 0 !important; padding: 0 !important; box-shadow: none !important; }
  .pr-sheet-table thead { display: table-header-group; }
  .pr-sheet-table tr { break-inside: avoid; }
  .pr-sheet-summary { break-inside: avoid; }
}
`;
