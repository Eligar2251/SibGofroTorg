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
  title: "План по выгоде продаж",
  company: "ООО «СибГофроТорг»",
  periodFrom: "",
  periodTo: "",
  note: "",
  completedOnly: false,
  showDetails: false,
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
    }) + "\u00A0₽"
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

  // Активируем режим печати отчёта на странице для полной изоляции стилей
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("profit-report-mode");
    const onBefore = () => document.body.classList.add("profit-report-mode");
    const onAfter = () => document.body.classList.add("profit-report-mode");
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
      document.body.classList.remove("profit-report-mode");
    };
  }, []);

  function handlePrint() {
    if (typeof document !== "undefined") {
      document.body.classList.add("profit-report-mode");
    }
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
              title="Печать отчёта на формате А4 вертикально"
            >
              <Printer size={15} /> Печать А4 (вертикально)
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
                <colgroup>
                  <col style={{ width: "21%" }} />
                  <col style={{ width: "6%" }} />
                  <col style={{ width: "7.5%" }} />
                  <col style={{ width: "8.5%" }} />
                  <col style={{ width: "7.5%" }} />
                  <col style={{ width: "8.5%" }} />
                  <col style={{ width: "7.5%" }} />
                  <col style={{ width: "8.5%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "34px" }} />
                </colgroup>
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
          <div className="pr-sheet__company">{meta.company || "ООО «СибГофроТорг»"}</div>
          <h2 className="pr-sheet__title">{meta.title || "План по выгоде продаж"}</h2>
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
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "6.5%" }} />
          <col style={{ width: "7.5%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "7.5%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "7.5%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9.5%" }} />
          <col style={{ width: "8.5%" }} />
          <col style={{ width: "4%" }} />
        </colgroup>
        <thead>
          <tr>
            <th className="pr-sheet-th-name">Товар</th>
            <th>
              Кол-во,
              <br />
              шт
            </th>
            <th>
              Цена
              <br />
              прод.
            </th>
            <th>Выручка</th>
            <th>
              Мы: с/с
              <br />1 шт
            </th>
            <th>
              Мы:
              <br />
              сумма
            </th>
            <th>
              Конкур.
              <br />1 шт
            </th>
            <th>
              Конкур.:
              <br />
              сумма
            </th>
            <th>
              Прибыль
              <br />
              (наша)
            </th>
            <th>
              Выгода
              <br />
              произв.
            </th>
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
            <td className="pr-cell-num">{fmtNum(totals.qty)}</td>
            <td className="pr-cell-num pr-dim">—</td>
            <td className="pr-cell-num">{fmtMoney(totals.revenue)}</td>
            <td className="pr-cell-num pr-dim">—</td>
            <td className="pr-cell-num">{fmtMoney(totals.ourCost)}</td>
            <td className="pr-cell-num pr-dim">—</td>
            <td className="pr-cell-num">{fmtMoney(totals.competitorCost)}</td>
            <td
              className={`pr-cell-num ${
                totals.ourProfit >= 0 ? "pr-pos" : "pr-neg"
              }`}
            >
              {fmtMoney(totals.ourProfit)}
            </td>
            <td
              className={`pr-cell-num ${
                totals.benefit >= 0 ? "pr-ben" : "pr-neg"
              }`}
            >
              {fmtMoney(totals.benefit)}
            </td>
            <td className="pr-cell-num">{totals.margin}%</td>
          </tr>
        </tfoot>
      </table>

      {/* Итоговые плашки (видны в превью на экране, скрыты при печати через .pr-sheet-summary { display: none !important }) */}
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
          <div className="pr-sheet-prod-name">{p.name || "—"}</div>
          {p.sku ? <div className="pr-sheet-sku">{p.sku}</div> : null}
        </td>
        <td className="pr-cell-num">{fmtNum(c.qty)}</td>
        <td className="pr-cell-num">{fmtMoney(p.salePrice)}</td>
        <td className="pr-cell-num">{fmtMoney(c.revenue)}</td>
        <td className="pr-cell-num">{fmtMoney(p.productionCost)}</td>
        <td className="pr-cell-num">{fmtMoney(c.ourCost)}</td>
        <td className="pr-cell-num">{fmtMoney(p.competitorPrice)}</td>
        <td className="pr-cell-num">{fmtMoney(c.competitorCost)}</td>
        <td
          className={`pr-cell-num ${c.ourProfit >= 0 ? "pr-pos" : "pr-neg"}`}
        >
          {fmtMoney(c.ourProfit)}
        </td>
        <td
          className={`pr-cell-num ${c.benefit >= 0 ? "pr-ben" : "pr-neg"}`}
        >
          {fmtMoney(c.benefit)}
        </td>
        <td className="pr-cell-num">{c.margin}%</td>
      </tr>
      {showDetails && p.sales.length > 0 && (
        <tr className="pr-sheet-detail">
          <td colSpan={11}>
            <div className="pr-sheet-detail__wrap">
              <span className="pr-sheet-detail__title">Продажи:</span>
              <div className="pr-sheet-detail__list">
                {p.sales.map((s) => (
                  <div key={s.id} className="pr-sheet-detail__item">
                    <span className="pr-sd-date">{fmtDate(s.date)}</span>
                    <span className="pr-sd-cust">{s.customer || "—"}</span>
                    <span className="pr-sd-qty">{fmtNum(s.qty)}&nbsp;шт</span>
                    <span className="pr-sd-price">×&nbsp;{fmtMoney(s.price)}</span>
                    <span className="pr-sd-sum">=&nbsp;{fmtMoney(s.qty * s.price)}</span>
                  </div>
                ))}
              </div>
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
.pr-table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.pr-edit-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1100px; table-layout: fixed; }
.pr-edit-table th, .pr-edit-table td { border: 1px solid var(--adm-border, #e2e8f0); padding: 4px 5px; text-align: center; vertical-align: middle; box-sizing: border-box; }
.pr-edit-table thead th { background: var(--adm-soft, #f8fafc); font-weight: 600; font-size: 11px; color: var(--adm-fg, #334155); position: sticky; top: 0; z-index: 2; line-height: 1.2; }
.pr-th-us { background: rgba(37,99,235,0.08) !important; }
.pr-th-comp { background: rgba(217,119,6,0.09) !important; }
.pr-th-profit { background: rgba(22,163,74,0.09) !important; }
.pr-th-benefit { background: rgba(147,51,234,0.10) !important; }
.pr-td-us { background: rgba(37,99,235,0.03); }
.pr-td-comp { background: rgba(217,119,6,0.04); }
.pr-td-profit { background: rgba(22,163,74,0.04); }
.pr-td-benefit { background: rgba(147,51,234,0.05); }
.pr-col-name { text-align: left !important; min-width: 180px; overflow: hidden; }
.pr-col-act { width: 34px; text-align: center !important; }
.pr-dim { color: var(--adm-muted, #cbd5e1); }

.pr-name-cell { display: flex; align-items: center; gap: 4px; min-width: 0; }
.pr-name-input { width: 100%; min-width: 0; border: none; background: transparent; font-size: 12px; font-weight: 500; padding: 2px 4px; border-radius: 4px; }
.pr-name-input:focus { outline: 2px solid rgba(59,130,246,0.4); background: #fff; }
.pr-expand { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: none; cursor: pointer; color: var(--adm-muted, #64748b); border-radius: 4px; }
.pr-expand:hover { background: rgba(0,0,0,0.05); }
.pr-sales-badge { display: inline-block; margin-left: 24px; font-size: 10px; color: var(--adm-muted, #94a3b8); }

.pr-num { width: 100%; min-width: 0; border: 1px solid transparent; background: transparent; text-align: right; font-size: 12px; padding: 3px 4px; border-radius: 4px; font-variant-numeric: tabular-nums; box-sizing: border-box; }
.pr-num:hover { border-color: var(--adm-border, #e2e8f0); }
.pr-num:focus { outline: none; border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
.pr-num--narrow { min-width: 0; }
.pr-num--bold { font-weight: 700; }
.pr-num--profit { color: #15803d; font-weight: 600; }
.pr-num--benefit { color: #7c3aed; font-weight: 600; }

.pr-ovcell { display: flex; align-items: center; justify-content: flex-end; gap: 2px; width: 100%; min-width: 0; position: relative; }
.pr-ovcell .pr-num { flex: 1 1 auto; min-width: 0; }
.pr-ovcell--ov .pr-num { background: rgba(250,204,21,0.15); border-color: rgba(202,138,4,0.5); }
.pr-reset { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: none; background: none; color: #ca8a04; cursor: pointer; border-radius: 3px; }
.pr-reset:hover { background: rgba(202,138,4,0.15); }

.pr-row-del { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; background: none; color: #dc2626; cursor: pointer; border-radius: 4px; }
.pr-row-del:hover { background: rgba(220,38,38,0.1); }

.pr-total-row td { background: var(--adm-soft, #f1f5f9); font-weight: 700; }

/* Детали продаж в редакторе */
.pr-detail-row td { background: #fbfcfe; padding: 0 !important; }
.pr-detail { padding: 10px 14px 14px 36px; }
.pr-detail__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--adm-muted, #475569); }
.pr-detail__empty { font-size: 12px; color: var(--adm-muted, #94a3b8); margin: 0; }
.pr-detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pr-detail-table th, .pr-detail-table td { border: 1px solid var(--adm-border, #e2e8f0); padding: 3px 6px; }
.pr-detail-table th { background: #fff; font-weight: 600; font-size: 11px; color: var(--adm-muted, #64748b); }
.pr-date { min-width: 110px; text-align: left; }
.pr-cust { width: 100%; min-width: 120px; border: 1px solid transparent; background: transparent; font-size: 12px; padding: 3px 5px; border-radius: 5px; }
.pr-cust:hover { border-color: var(--adm-border, #e2e8f0); }
.pr-cust:focus { outline: none; border-color: #3b82f6; background: #fff; }
.pr-detail-sum { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ── A4 превью (вертикальный лист A4: 210 × 297 мм) ── */
.pr-a4-stage { background: #e9edf3; padding: 24px 16px; border-radius: 10px; display: flex; justify-content: center; overflow-x: auto; }
.pr-a4-sheet { width: 210mm; min-height: 297mm; max-width: 100%; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,0.12); padding: 8mm 7mm; box-sizing: border-box; }
.pr-sheet { font-family: Arial, "Segoe UI", sans-serif; color: #1e293b; font-size: 9.5px; width: 100%; box-sizing: border-box; }
.pr-sheet__head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 6px; }
.pr-sheet__company { font-size: 11px; font-weight: 700; letter-spacing: 0.4px; color: #475569; text-transform: uppercase; }
.pr-sheet__title { font-size: 17px; font-weight: 800; color: #0f172a; margin: 2px 0 0; }
.pr-sheet__period { text-align: right; font-size: 10.5px; line-height: 1.45; white-space: nowrap; color: #334155; }
.pr-sheet__plabel { color: #64748b; }
.pr-sheet__note { font-size: 10px; font-style: italic; color: #475569; margin: 4px 0 6px; }

.pr-sheet-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 9px; margin-top: 6px; }
.pr-sheet-table th, .pr-sheet-table td { border: 1px solid #cbd5e1; padding: 4px 3px; vertical-align: middle; box-sizing: border-box; }
.pr-sheet-table thead th { background: #1e293b; color: #fff; font-weight: 700; text-align: center; font-size: 8.5px; line-height: 1.15; }
.pr-sheet-th-name { text-align: left !important; overflow: hidden; }
.pr-sheet-prod-name { font-weight: 600; line-height: 1.25; word-break: break-word; overflow-wrap: break-word; }
.pr-sheet-sku { font-size: 8px; color: #64748b; font-family: monospace; margin-top: 1px; }
.pr-cell-num { text-align: right !important; font-variant-numeric: tabular-nums !important; white-space: nowrap !important; word-break: keep-all !important; }
.pr-sheet-pos td { background: #fff; }
.pr-sheet-pos:nth-child(even) td { background: #f8fafc; }
.pr-pos { color: #15803d; font-weight: 700; }
.pr-ben { color: #7c3aed; font-weight: 700; }
.pr-neg { color: #dc2626; font-weight: 700; }
.pr-sheet-total td { background: #e2e8f0 !important; font-weight: 800; font-size: 9.5px; border-top: 2px solid #0f172a !important; }

.pr-sheet-detail td { background: #f8fafc; padding: 3px 6px; border-left: 3px solid #3b82f6; }
.pr-sheet-detail__wrap { display: flex; flex-direction: column; gap: 2px; }
.pr-sheet-detail__title { font-weight: 700; color: #475569; font-size: 8.5px; }
.pr-sheet-detail__list { display: flex; flex-direction: column; gap: 2px; }
.pr-sheet-detail__item { display: flex; gap: 8px; align-items: baseline; font-size: 8.5px; color: #334155; flex-wrap: wrap; }
.pr-sd-date { color: #64748b; flex: 0 0 auto; }
.pr-sd-cust { font-weight: 600; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-sd-qty { font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.pr-sd-price { font-variant-numeric: tabular-nums; color: #64748b; flex: 0 0 auto; }
.pr-sd-sum { font-weight: 600; font-variant-numeric: tabular-nums; flex: 0 0 auto; }

.pr-sheet-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px; }
.pr-sum-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 9px; background: #f8fafc; }
.pr-sum-card__label { font-size: 8.5px; color: #64748b; margin-bottom: 2px; }
.pr-sum-card__value { font-size: 13px; font-weight: 800; }
.pr-sum-card--profit { background: #f0fdf4; border-color: #86efac; }
.pr-sum-card--profit .pr-sum-card__value { color: #15803d; }
.pr-sum-card--benefit { background: #faf5ff; border-color: #d8b4fe; }
.pr-sum-card--benefit .pr-sum-card__value { color: #7c3aed; }

.pr-sheet__foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14px; }
.pr-sign { display: flex; flex-direction: column; gap: 2px; min-width: 180px; }
.pr-sign__line { border-bottom: 1px solid #0f172a; height: 18px; }
.pr-sign__cap { font-size: 8.5px; color: #64748b; }
.pr-sheet__foot-note { font-size: 8.5px; color: #94a3b8; }

/* ── Печать на вертикальном формате А4 ── */
@media print {
  @page {
    size: A4 portrait;
    margin: 8mm 6mm;
  }
  html, body {
    background: #fff !important;
    color: #0f172a !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    overflow: visible !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body {
    position: static !important;
    top: auto !important;
    left: auto !important;
    right: auto !important;
    width: auto !important;
    max-width: none !important;
    padding: 0 !important;
    margin: 0 !important;
    overflow: visible !important;
  }

  /* 1. Скрываем абсолютно всё лишнее: кнопки, шапку сайта/админки, сайдбар, фильтры, редактор, плашки */
  .no-print,
  .site-header-wrap,
  .site-header,
  .topbar,
  .site-footer,
  footer,
  nav,
  header:not(.pr-sheet-header),
  .admin-sidebar,
  .admin-sidebar-handle,
  .admin-mobile-bar,
  .admin-bottom-nav,
  .admin-page-head,
  .admin-notify,
  .admin-plans-shortcut,
  .admin-requests-shortcut,
  .realtime-status-pill,
  .mobile-admin-shell > header,
  .mobile-admin-shell > nav,
  .pr-controls,
  .pr-actions,
  .pr-hint,
  .pr-picker-backdrop,
  .pr-picker-modal,
  .pr-table-scroll,
  .pr-edit-table,
  .pr-sheet-summary,
  .admin-card:not(.pr-print-wrap),
  [data-admin="true"] .admin-card:not(.pr-print-wrap),
  [data-admin="true"] .admin-page-head,
  [data-admin="true"] .admin-sidebar,
  [data-admin="true"] .admin-mobile-bar,
  body > *:not(.admin-shell):not(main) {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    max-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    overflow: hidden !important;
  }

  /* 2. Сбрасываем контейнеры админки до обычных блоков */
  .admin-shell,
  .admin-content,
  .admin-main,
  .admin-stack,
  .pr-root,
  .pr-print-wrap,
  .pr-print-wrap .admin-card__pad,
  .pr-a4-stage {
    display: block !important;
    position: static !important;
    width: 100% !important;
    max-width: none !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
    overflow: visible !important;
  }

  /* 3. Печатный лист A4 вертикально */
  .pr-a4-sheet {
    width: 100% !important;
    max-width: none !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
  }

  .pr-sheet {
    width: 100% !important;
    font-family: Arial, "Segoe UI", sans-serif !important;
    color: #0f172a !important;
    font-size: 9px !important;
  }

  .pr-sheet__head {
    display: flex !important;
    justify-content: space-between !important;
    align-items: flex-end !important;
    border-bottom: 2px solid #0f172a !important;
    padding-bottom: 5px !important;
    margin-bottom: 6px !important;
  }

  .pr-sheet__company {
    font-size: 11px !important;
    font-weight: 700 !important;
    letter-spacing: 0.5px !important;
    color: #475569 !important;
    text-transform: uppercase !important;
  }

  .pr-sheet__title {
    font-size: 16px !important;
    font-weight: 800 !important;
    color: #0f172a !important;
    margin: 2px 0 0 !important;
  }

  .pr-sheet__period {
    text-align: right !important;
    font-size: 10px !important;
    line-height: 1.4 !important;
    white-space: nowrap !important;
    color: #334155 !important;
  }

  .pr-sheet__note {
    font-size: 9px !important;
    color: #475569 !important;
    font-style: italic !important;
    margin: 4px 0 6px !important;
  }

  /* 4. Таблица: идеальная фиксация колонок */
  .pr-sheet-table {
    width: 100% !important;
    table-layout: fixed !important;
    border-collapse: collapse !important;
    font-size: 8.5px !important;
    margin: 4px 0 0 !important;
  }

  .pr-sheet-table thead {
    display: table-header-group !important;
  }

  .pr-sheet-table tfoot {
    display: table-footer-group !important;
  }

  .pr-sheet-table tr {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }

  .pr-sheet-table th,
  .pr-sheet-table td {
    border: 1px solid #94a3b8 !important;
    padding: 3px 2.5px !important;
    box-sizing: border-box !important;
    vertical-align: middle !important;
  }

  .pr-sheet-table thead th {
    background: #1e293b !important;
    color: #ffffff !important;
    font-weight: 700 !important;
    font-size: 8px !important;
    line-height: 1.15 !important;
    text-align: center !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .pr-sheet-th-name {
    text-align: left !important;
  }

  .pr-cell-num {
    text-align: right !important;
    font-variant-numeric: tabular-nums !important;
    white-space: nowrap !important;
    word-break: keep-all !important;
  }

  .pr-sheet-pos:nth-child(even) td {
    background: #f8fafc !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .pr-sheet-total td {
    background: #e2e8f0 !important;
    font-weight: 800 !important;
    font-size: 9px !important;
    border-top: 2px solid #0f172a !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .pr-pos {
    color: #15803d !important;
    font-weight: 700 !important;
  }

  .pr-ben {
    color: #7c3aed !important;
    font-weight: 700 !important;
  }

  .pr-neg {
    color: #dc2626 !important;
    font-weight: 700 !important;
  }

  .pr-sheet__foot {
    display: flex !important;
    justify-content: space-between !important;
    align-items: flex-end !important;
    margin-top: 12px !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }

  .pr-sign {
    display: flex !important;
    flex-direction: column !important;
    gap: 2px !important;
    min-width: 180px !important;
  }

  .pr-sign__line {
    border-bottom: 1px solid #0f172a !important;
    height: 16px !important;
  }

  .pr-sign__cap {
    font-size: 8px !important;
    color: #64748b !important;
  }

  .pr-sheet__foot-note {
    font-size: 8px !important;
    color: #94a3b8 !important;
  }
}
`;
