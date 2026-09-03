// =========================================================
// FILE: src/components/catalog/BoxSizeFinder.tsx
// Подбор коробки по размерам (Д × Ш × В) для ВИТРИНЫ сайта.
// Логика ранжирования та же, что в админке («Подбор коробки»):
// lib/box-search.ts сравнивает каждую из трёх сторон отдельно
// и сортирует от ближайших к менее похожим.
//
// Отличие от админки — подача для покупателя: вместо «±2 мм»
// пишем направление отклонения прямо: «−2 мм» — коробка МЕНЬШЕ
// введённого размера, «+2 мм» — БОЛЬШЕ, «точно» — совпало.
// Рядом сразу видны цена, наличие, кнопка «В корзину» и
// ссылка на карточку товара.
//
// Используется и на главной (плитка «Подбор коробки» в витрине),
// и на отдельной странице /podbor-korobki (для ссылок из акций).
// =========================================================

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Ruler,
  Package,
  RotateCcw,
  ShoppingCart,
  ChevronRight,
  Plus,
  Minus,
} from "lucide-react";
import { useCart } from "@/context/CartContext";
import { EditableQuantityInput } from "@/components/ui/EditableQuantityInput";
import { PriceInquiryButton } from "@/components/catalog/PriceInquiryButton";
import {
  isProductAvailable,
  OUT_OF_STOCK_LABEL,
  RESTOCK_INQUIRY_LABEL,
} from "@/lib/stock-availability";
import { findNearestBoxes, type BoxProduct, type BoxTarget } from "@/lib/box-search";
import { ymGoal } from "@/lib/ym";
import "./box-size-finder.css";

/** Допуск стороны (мм) — такой же, как по умолчанию в админке.
 *  Влияет только на подсветку «близко/далеко», весь список виден всегда. */
const TOLERANCE_MM = 30;

const DEFAULT_VISIBLE = 10;

/** Товар, сериализованный на сервере; размеры уже переведены в мм. */
export interface BoxFinderProduct {
  id: string;
  name: string;
  slug: string;
  sku?: string | null;
  imageUrl?: string | null;
  price: number | null;
  priceWholesale?: number | null;
  minWholesaleQty?: number | null;
  inStock: boolean;
  stockQty?: number | null;
  madeToOrder?: boolean | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
}

function parseDim(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function BoxSizeFinder({
  products,
  visibleCount = DEFAULT_VISIBLE,
  initial,
}: {
  products: BoxFinderProduct[];
  /** Сколько позиций показывать до кнопки «Показать ещё». */
  visibleCount?: number;
  /** Предустановленные размеры (строки, как вводит пользователь) —
   *  удобно для ссылок из акций: /podbor-korobki?l=600&w=400&h=400 */
  initial?: { length?: string; width?: string; height?: string };
}) {
  const { cart, addToCart, updateQty, removeFromCart } = useCart();

  const [length, setLength] = useState(initial?.length ?? "");
  const [width, setWidth] = useState(initial?.width ?? "");
  const [height, setHeight] = useState(initial?.height ?? "");
  const [shown, setShown] = useState(visibleCount);

  const target: BoxTarget | null = useMemo(() => {
    const l = parseDim(length);
    const w = parseDim(width);
    const h = parseDim(height);
    if (l == null || w == null || h == null) return null;
    return { length: l, width: w, height: h };
  }, [length, width, height]);

  // В подбор попадают только позиции с заполненными размерами:
  // безгабаритная сопутствка (скотч, плёнка) здесь не нужна.
  const searchable: BoxProduct[] = useMemo(
    () =>
      products
        .filter((p) => p.lengthMm != null && p.widthMm != null)
        .map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          sku: p.sku ?? null,
          imageUrl: p.imageUrl ?? null,
          lengthMm: p.lengthMm,
          widthMm: p.widthMm,
          heightMm: p.heightMm,
          unit: "мм",
        })),
    [products]
  );

  const byId = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const results = useMemo(() => {
    if (!target) return [];
    return findNearestBoxes(searchable, target, TOLERANCE_MM);
  }, [searchable, target]);

  const visible = results.slice(0, shown);
  const hasInput = length !== "" || width !== "" || height !== "";

  function reset() {
    setLength("");
    setWidth("");
    setHeight("");
    setShown(visibleCount);
  }

  function renderCartControls(p: BoxFinderProduct) {
    const available = isProductAvailable(p);
    const inCart = cart.find((i) => i.productId === p.id && !i.variantId);
    const canBuy = p.price != null && !p.madeToOrder && available;

    if (!canBuy) {
      if (p.madeToOrder || p.price == null) {
        return (
          <PriceInquiryButton
            productName={p.name}
            productSku={p.sku}
            productImageUrl={p.imageUrl}
            className="bsf-inquiry"
            label="Узнать цену"
          />
        );
      }
      return (
        <PriceInquiryButton
          productName={p.name}
          productSku={p.sku}
          productImageUrl={p.imageUrl}
          className="bsf-inquiry"
          label={RESTOCK_INQUIRY_LABEL}
          kind="restock"
        />
      );
    }

    const maxStock = p.stockQty ?? null;

    if (inCart) {
      const atMax = maxStock != null && inCart.quantity >= maxStock;
      return (
        <div className="pcc__stepper bsf-stepper">
          <button
            type="button"
            className="pcc__stepper-btn"
            aria-label="Уменьшить количество"
            onClick={() => {
              if (inCart.quantity <= 1) {
                removeFromCart(p.id);
              } else {
                updateQty(p.id, inCart.quantity - 1);
              }
            }}
          >
            <Minus size={13} />
          </button>
          <EditableQuantityInput
            value={inCart.quantity}
            max={maxStock}
            className="pcc__stepper-input"
            ariaLabel="Количество"
            onCommit={(qty) =>
              updateQty(p.id, maxStock != null ? Math.min(qty, maxStock) : qty)
            }
          />
          <button
            type="button"
            className="pcc__stepper-btn"
            aria-label="Увеличить количество"
            disabled={atMax}
            onClick={() => updateQty(p.id, inCart.quantity + 1)}
          >
            <Plus size={13} />
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        className="bsf-add"
        aria-label={`Добавить в корзину: ${p.name}`}
        onClick={() => {
          addToCart(
            {
              productId: p.id,
              name: p.name,
              sku: p.sku,
              price: p.price as number,
              imageUrl: p.imageUrl,
              maxStock,
            },
            1
          );
          ymGoal("add_to_cart", { product_id: p.id, source: "box_finder" });
        }}
      >
        <ShoppingCart size={14} /> В корзину
      </button>
    );
  }

  return (
    <div className="bsf">
      {/* ── Ввод размеров ─────────────────────────────── */}
      <div className="bsf-form">
        <div className="bsf-inputs" role="group" aria-label="Размеры коробки в миллиметрах">
          <label className="bsf-field">
            <span className="bsf-field__label">Длина</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              className="bsf-input"
              value={length}
              onChange={(e) => {
                setLength(e.target.value);
                setShown(visibleCount);
              }}
              placeholder="600"
            />
          </label>
          <span className="bsf-x" aria-hidden>×</span>
          <label className="bsf-field">
            <span className="bsf-field__label">Ширина</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              className="bsf-input"
              value={width}
              onChange={(e) => {
                setWidth(e.target.value);
                setShown(visibleCount);
              }}
              placeholder="400"
            />
          </label>
          <span className="bsf-x" aria-hidden>×</span>
          <label className="bsf-field">
            <span className="bsf-field__label">Высота</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              className="bsf-input"
              value={height}
              onChange={(e) => {
                setHeight(e.target.value);
                setShown(visibleCount);
              }}
              placeholder="400"
            />
          </label>
          <span className="bsf-unit">мм</span>
        </div>
        {hasInput && (
          <button type="button" className="bsf-reset" onClick={reset}>
            <RotateCcw size={13} /> Сбросить
          </button>
        )}
      </div>
      <p className="bsf-hint">
        <Ruler size={13} />
        Сверху — самые близкие размеры. <b>−2&nbsp;мм</b> — коробка меньше,{" "}
        <b>+2&nbsp;мм</b> — больше нужного.
      </p>

      {/* ── Результаты ────────────────────────────────── */}
      {!target ? (
        <div className="bsf-empty">
          <Package size={34} />
          <p>Введите длину, ширину и высоту — подберём подходящие коробки</p>
        </div>
      ) : results.length === 0 ? (
        <div className="bsf-empty">
          <Package size={34} />
          <p>В каталоге пока нет коробок с указанными размерами</p>
        </div>
      ) : (
        <>
          <ul className="bsf-list">
            {visible.map((r) => {
              const p = byId.get(r.product.id);
              if (!p) return null;
              const available = isProductAvailable(p);
              const exact = r.matchedCount === 3;
              return (
                <li key={p.id} className="bsf-item">
                  <Link
                    href={`/catalog/product/${p.slug}`}
                    className="bsf-item__media"
                    aria-label={`Открыть карточку: ${p.name}`}
                  >
                    {p.imageUrl ? (
                      <Image
                        src={p.imageUrl}
                        alt={p.name}
                        width={64}
                        height={64}
                        loading="lazy"
                        style={{ objectFit: "contain" }}
                      />
                    ) : (
                      <Package size={26} />
                    )}
                  </Link>

                  <div className="bsf-item__main">
                    <div className="bsf-item__top">
                      <Link
                        href={`/catalog/product/${p.slug}`}
                        className="bsf-item__name"
                      >
                        {p.name}
                      </Link>
                      {exact && <span className="bsf-badge">Точное совпадение</span>}
                    </div>

                    <div className="bsf-item__dims">
                      {r.diffs.map((d) => {
                        // Знаковое отклонение: минус — коробка меньше,
                        // плюс — больше введённого размера. Без «±».
                        const signed =
                          d.value == null || d.diff == null
                            ? null
                            : Math.round(d.value - d.target);
                        const tone =
                          d.diff == null
                            ? "none"
                            : d.diff === 0
                              ? "exact"
                              : d.withinTolerance
                                ? "near"
                                : "far";
                        return (
                          <span
                            key={d.dim}
                            className={`bsf-dim bsf-dim--${tone}`}
                            title={`Нужно: ${d.dim} ${fmt(d.target)} мм`}
                          >
                            <b>{d.dim}</b>
                            {d.value == null ? (
                              <span className="bsf-dim__val">—</span>
                            ) : (
                              <>
                                <span className="bsf-dim__val">{fmt(Math.round(d.value))}</span>
                                <span className="bsf-dim__diff">
                                  {signed === null
                                    ? "—"
                                    : signed === 0
                                      ? "точно"
                                      : `${signed > 0 ? "+" : "−"}${fmt(Math.abs(signed))} мм`}
                                </span>
                              </>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <div className="bsf-item__side">
                    <div className="bsf-item__price-row">
                      {p.madeToOrder ? (
                        <span className="bsf-mto">Под заказ</span>
                      ) : p.price != null ? (
                        <span className="bsf-price">
                          {fmt(p.price)} <span className="bsf-price__rub">₽/шт</span>
                        </span>
                      ) : (
                        <span className="bsf-price-muted">Цена по запросу</span>
                      )}
                      <span
                        className={`bsf-stock ${
                          p.madeToOrder
                            ? "bsf-stock--order"
                            : available
                              ? "bsf-stock--ok"
                              : "bsf-stock--out"
                        }`}
                      >
                        {p.madeToOrder
                          ? "Изготовим"
                          : !available
                            ? OUT_OF_STOCK_LABEL
                            : p.stockQty != null
                              ? `В наличии · ${fmt(p.stockQty)} шт`
                              : "В наличии"}
                      </span>
                    </div>
                    <div className="bsf-item__actions">
                      {renderCartControls(p)}
                      <Link
                        href={`/catalog/product/${p.slug}`}
                        className="bsf-open"
                        aria-label={`Перейти в карточку: ${p.name}`}
                        title="Карточка товара"
                      >
                        <ChevronRight size={16} />
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {results.length > visible.length && (
            <div className="bsf-more-wrap">
              <button
                type="button"
                className="bsf-more"
                onClick={() => setShown((s) => s + visibleCount)}
              >
                Показать ещё {Math.min(visibleCount, results.length - visible.length)} из{" "}
                {results.length - visible.length}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
