"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Package, RotateCcw, Check, ExternalLink } from "lucide-react";
import {
  findNearestBoxes,
  formatMm,
  type BoxProduct,
  type BoxTarget,
} from "@/lib/box-search";
import { isProductAvailable } from "@/lib/stock-availability";

const TOLERANCES = [10, 20, 30, 40, 50];

function parseDim(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function BoxFinderClient({ products }: { products: BoxProduct[] }) {
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [tolerance, setTolerance] = useState(30);
  const [onlyInStock, setOnlyInStock] = useState(false);

  const target: BoxTarget | null = useMemo(() => {
    const l = parseDim(length);
    const w = parseDim(width);
    const h = parseDim(height);
    if (l == null || w == null || h == null) return null;
    return { length: l, width: w, height: h };
  }, [length, width, height]);

  const filteredProducts = useMemo(() => {
    if (!onlyInStock) return products;
    return products.filter(
      (p) => !p.madeToOrder && isProductAvailable({ inStock: p.inStock, stockQty: p.stockQty })
    );
  }, [products, onlyInStock]);

  const results = useMemo(() => {
    if (!target) return [];
    return findNearestBoxes(filteredProducts, target, tolerance);
  }, [filteredProducts, target, tolerance]);

  const hasInput =
    length !== "" ||
    width !== "" ||
    height !== "" ||
    tolerance !== 30 ||
    onlyInStock;

  function reset() {
    setLength("");
    setWidth("");
    setHeight("");
    setTolerance(30);
    setOnlyInStock(false);
  }

  return (
    <div className="bf">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Подбор коробки</h1>
        </div>
      </div>

      <div className="admin-card bf-panel">
        <div className="admin-card__pad bf-toolbar">
          <div className="bf-dims-inputs">
            <div className="bf-field">
              <label className="bf-label">Длина</label>
              <div className="bf-input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  className="admin-input bf-input"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  placeholder="600"
                />
                <span className="bf-input-unit">мм</span>
              </div>
            </div>

            <span className="bf-sep">×</span>

            <div className="bf-field">
              <label className="bf-label">Ширина</label>
              <div className="bf-input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  className="admin-input bf-input"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  placeholder="400"
                />
                <span className="bf-input-unit">мм</span>
              </div>
            </div>

            <span className="bf-sep">×</span>

            <div className="bf-field">
              <label className="bf-label">Высота</label>
              <div className="bf-input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  className="admin-input bf-input"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder="400"
                />
                <span className="bf-input-unit">мм</span>
              </div>
            </div>
          </div>

          <div className="bf-field">
            <label className="bf-label">Допуск</label>
            <div className="bf-tol-group" role="group" aria-label="Допуск в миллиметрах">
              {TOLERANCES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`bf-tol-btn${tolerance === t ? " bf-tol-btn--active" : ""}`}
                  onClick={() => setTolerance(t)}
                >
                  {t} мм
                </button>
              ))}
            </div>
          </div>

          <div className="bf-actions">
            <button
              type="button"
              className={`bf-stock-toggle${onlyInStock ? " bf-stock-toggle--active" : ""}`}
              aria-pressed={onlyInStock}
              onClick={() => setOnlyInStock((v) => !v)}
            >
              <span className="bf-stock-toggle__box" aria-hidden>
                {onlyInStock && <Check size={12} strokeWidth={3} />}
              </span>
              Только в наличии
            </button>

            {hasInput && (
              <button
                type="button"
                className="admin-btn admin-btn--ghost bf-reset-btn"
                onClick={reset}
              >
                <RotateCcw size={14} /> Сброс
              </button>
            )}
          </div>
        </div>
      </div>

      {target && results.length === 0 ? (
        <div className="admin-empty">
          <div className="admin-empty__icon">
            <Package size={36} />
          </div>
          <p>{onlyInStock ? "Нет подходящих товаров в наличии" : "Ничего не найдено"}</p>
        </div>
      ) : target && results.length > 0 ? (
        <div className="bf-list">
          {results.map((r, idx) => {
            const p = r.product;
            const available =
              !p.madeToOrder &&
              isProductAvailable({ inStock: p.inStock, stockQty: p.stockQty });
            const isExactAll = r.matchedCount === 3 && r.totalDiff === 0;

            return (
              <div
                key={p.id}
                className={`bf-item${
                  isExactAll
                    ? " bf-item--exact"
                    : r.matchedCount === 3
                      ? " bf-item--match"
                      : ""
                }`}
              >
                <div className="bf-item__rank">{idx + 1}</div>

                <div className="bf-item__media">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt=""
                      width={52}
                      height={52}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <Package size={22} />
                  )}
                </div>

                <div className="bf-item__main">
                  <div className="bf-item__top">
                    <Link
                      href={`/catalog/product/${p.slug}`}
                      target="_blank"
                      className="bf-item__name"
                    >
                      {p.name}
                    </Link>
                    {p.sku && <span className="bf-item__sku">Арт. {p.sku}</span>}
                    {p.material && (
                      <span className="bf-item__tag">{p.material}</span>
                    )}
                  </div>

                  <div className="bf-item__dims">
                    {r.diffs.map((d) => {
                      const signed =
                        d.value == null || d.diff == null
                          ? null
                          : Math.round(d.value - d.target);
                      const stateClass =
                        signed === null
                          ? "bf-dim--none"
                          : signed === 0
                            ? "bf-dim--exact"
                            : d.withinTolerance
                              ? "bf-dim--ok"
                              : "bf-dim--bad";

                      const diffText =
                        signed === null
                          ? "—"
                          : signed === 0
                            ? "0 мм"
                            : `${signed > 0 ? "+" : "-"}${formatMm(Math.abs(signed))} мм`;

                      return (
                        <div key={d.dim} className={`bf-dim ${stateClass}`}>
                          <span className="bf-dim__key">{d.dim}</span>
                          <span className="bf-dim__val">
                            {d.value == null
                              ? "—"
                              : `${formatMm(Math.round(d.value))} мм`}
                          </span>
                          <span
                            className={`bf-dim__diff${
                              signed != null && signed > 0
                                ? " bf-dim__diff--plus"
                                : signed != null && signed < 0
                                  ? " bf-dim__diff--minus"
                                  : ""
                            }`}
                          >
                            {diffText}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bf-item__side">
                  <div className="bf-item__meta-top">
                    {p.madeToOrder ? (
                      <span className="bf-stock bf-stock--order">Под заказ</span>
                    ) : available ? (
                      <span className="bf-stock bf-stock--ok">
                        В наличии
                        {p.stockQty != null ? ` · ${formatMm(p.stockQty)} шт` : ""}
                      </span>
                    ) : (
                      <span className="bf-stock bf-stock--out">Нет в наличии</span>
                    )}

                    {p.price != null && (
                      <span className="bf-price">
                        {formatMm(p.price)} <small>₽/шт</small>
                      </span>
                    )}
                  </div>

                  <div className="bf-item__meta-bottom">
                    {p.priceWholesale != null && (
                      <span className="bf-wholesale">
                        опт {formatMm(p.priceWholesale)} ₽
                        {p.minWholesaleQty ? ` от ${formatMm(p.minWholesaleQty)} шт` : ""}
                      </span>
                    )}
                    <span
                      className={`bf-match-pill bf-match-pill--${r.matchedCount}`}
                    >
                      {r.matchedCount}/3
                    </span>
                    <span className="bf-item__total">
                      Δ <b>{formatMm(Math.round(r.totalDiff))} мм</b>
                    </span>
                    <Link
                      href={`/catalog/product/${p.slug}`}
                      target="_blank"
                      className="bf-open-link"
                      aria-label={`Открыть ${p.name}`}
                    >
                      <ExternalLink size={14} />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
