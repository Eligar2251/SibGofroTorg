"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Ruler, Package, RotateCcw, ArrowUpDown } from "lucide-react";
import {
  findNearestBoxes,
  matchLabel,
  formatMm,
  type BoxProduct,
  type BoxTarget,
} from "@/lib/box-search";

const TOLERANCES = [
  { value: 20, label: "± 20 мм (2 см)" },
  { value: 30, label: "± 30 мм (3 см)" },
  { value: 40, label: "± 40 мм (4 см)" },
];

const toneStyles: Record<string, { bg: string; color: string }> = {
  great: { bg: "rgba(22,163,74,0.1)", color: "#15803d" },
  good: { bg: "rgba(59,130,246,0.1)", color: "#1d4ed8" },
  partial: { bg: "rgba(217,119,6,0.1)", color: "#b45309" },
  none: { bg: "rgba(239,68,68,0.08)", color: "#dc2626" },
};

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

  const target: BoxTarget | null = useMemo(() => {
    const l = parseDim(length);
    const w = parseDim(width);
    const h = parseDim(height);
    if (l == null || w == null || h == null) return null;
    return { length: l, width: w, height: h };
  }, [length, width, height]);

  const results = useMemo(() => {
    if (!target) return [];
    return findNearestBoxes(products, target, tolerance);
  }, [products, target, tolerance]);

  function reset() {
    setLength("");
    setWidth("");
    setHeight("");
    setTolerance(30);
  }

  const withDims = products.filter((p) => p.lengthMm != null || p.widthMm != null || p.heightMm != null).length;

  return (
    <div className="bf">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Подбор коробки</h1>
          <p className="admin-sub">
            Введите габариты (Д × Ш × В, в миллиметрах) — покажем ближайшие
            коробки из каталога. Сверху — точные совпадения, ниже — менее
            похожие.
          </p>
        </div>
      </div>

      {/* Панель ввода */}
      <div className="admin-card" style={{ marginBottom: 14 }}>
        <div className="admin-card__pad">
          <div className="bf-form">
            <div className="bf-field">
              <label className="bf-label">Длина, мм</label>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                className="admin-input"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="600"
              />
            </div>
            <span className="bf-sep">×</span>
            <div className="bf-field">
              <label className="bf-label">Ширина, мм</label>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                className="admin-input"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                placeholder="400"
              />
            </div>
            <span className="bf-sep">×</span>
            <div className="bf-field">
              <label className="bf-label">Высота, мм</label>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                className="admin-input"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                placeholder="400"
              />
            </div>

            <div className="bf-field">
              <label className="bf-label">Допуск</label>
              <select
                className="admin-select"
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
              >
                {TOLERANCES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <button type="button" className="admin-btn admin-btn--ghost" onClick={reset}>
              <RotateCcw size={15} /> Сброс
            </button>
          </div>

          <div className="bf-hint">
            <Ruler size={14} /> В каталоге {withDims} товаров с размерами.
            Сравнение идёт отдельно по длине, ширине и высоте.
          </div>
        </div>
      </div>

      {/* Результаты */}
      {!target ? (
        <div className="admin-empty">
          <div className="admin-empty__icon"><Package size={40} /></div>
          <p>Введите длину, ширину и высоту, чтобы найти подходящую коробку</p>
        </div>
      ) : results.length === 0 ? (
        <div className="admin-empty">
          <div className="admin-empty__icon"><Package size={40} /></div>
          <p>Нет товаров с заполненными размерами</p>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, color: "var(--adm-muted)", fontSize: 13 }}>
            <ArrowUpDown size={14} />
            Найдено {results.length}: сверху — ближайшие, ниже — менее похожие.
          </div>

          <div className="bf-list">
            {results.map((r) => {
              const { text, tone } = matchLabel(r.matchedCount);
              const t = toneStyles[tone];
              return (
                <div key={r.product.id} className="bf-item">
                  <div className="bf-item__media">
                    {r.product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.product.imageUrl} alt="" width={48} height={48} loading="lazy" decoding="async" />
                    ) : (
                      <Package size={22} />
                    )}
                  </div>

                  <div className="bf-item__main">
                    <div className="bf-item__top">
                      <Link
                        href={`/catalog/product/${r.product.slug}`}
                        target="_blank"
                        className="bf-item__name"
                      >
                        {r.product.name}
                      </Link>
                      <span className="bf-item__badge" style={{ background: t.bg, color: t.color }}>
                        {text}
                      </span>
                    </div>

                    {r.product.sku && (
                      <div className="bf-item__sku">Арт: {r.product.sku}</div>
                    )}

                    <div className="bf-item__dims">
                      {r.diffs.map((d) => (
                        <span
                          key={d.dim}
                          className={`bf-dim${d.withinTolerance ? " bf-dim--ok" : " bf-dim--bad"}`}
                          title={`Цель ${d.target} мм`}
                        >
                          <b>{d.dim}</b>{" "}
                          {formatMm(d.value)}
                          <span className="bf-dim__diff">
                            {d.diff == null
                              ? "нет"
                              : d.diff === 0
                                ? "точно"
                                : `±${formatMm(d.diff)} мм`}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="bf-item__side">
                    <span className="bf-item__total">
                      Σ отклонение{" "}
                      <b>{formatMm(r.totalDiff)} мм</b>
                    </span>
                    <span className="bf-item__count">
                      {r.matchedCount}/3 совпали
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
