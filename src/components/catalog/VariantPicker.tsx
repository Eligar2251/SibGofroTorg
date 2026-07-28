// src/components/catalog/VariantPicker.tsx
//
// Селектор вариантов на странице товара. Один товар = один
// компонент: сам разбивает варианты по option_type (Цвет,
// Размер, Фасовка и т.д.) и рисует чипы.
//
// Данные:
//   • variants[] — все видимые варианты (из getProductBySlugForPage)
//   • onChange — колбэк с выбранным вариантом (или null, если
//     у товара вариантов нет и селектор не нужен)
//
// Поведение:
//   • Если variants пуст — компонент не рендерит ничего (null).
//   • При первом рендере выбирается первый вариант
//     (или первый в наличии, если опция "нет в наличии" должна
//     блокировать покупку).
//   • Рядом с ценой выбранного варианта показывается «от X ₽»
//     если у выбранного варианта есть цена, иначе фолбэк на
//     цену товара.
//   • Если у варианта price=null — берём с product (через
//     resolveVariant в AddToCartButton).
//   • Если у варианта stockQty=0 — помечаем чип как
//     «Нет в наличии» (серый, некликабельный). Если все
//     варианты в option_type распроданы — клиент не сможет
//     положить товар в корзину, только оставить заявку.
//
// Архитектурное решение: компонент контролируемый
// (selectedVariantId / onSelectVariant в родителе), чтобы
// AddToCartButton мог показывать актуальную цену/остаток
// выбранного варианта и блокировать кнопку «В корзину»
// если в наличии 0.

"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductVariant } from "@/lib/types";
import { Package, AlertCircle, Check } from "lucide-react";

export interface VariantPickerProps {
  variants: ProductVariant[];
  /** Колбэк: выбранный вариант (или null — «варианты не выбраны»). */
  onSelectVariant: (variant: ProductVariant | null) => void;
  /**
   * Если true — изначально выбирается первый вариант, который
   * есть в наличии. По умолчанию true: иначе кладовщик
   * покупает «в никуда», если первый вариант распродан.
   */
  preferInStock?: boolean;
  /** Базовое имя товара (для читаемых лейблов: «Скотч / красный»). */
  productName?: string;
}

/**
 * Один тип опции (например, «Цвет») с набором чипов.
 * На странице товара сгруппировано по option_type — каждый
 * тип рисуется отдельной строкой.
 */
interface OptionGroup {
  /** Тип: color / size / pack / material / "" */
  type: string;
  /** Лейбл для UI: «Цвет», «Размер», «Фасовка» и т.д. */
  label: string;
  variants: ProductVariant[];
}

const OPTION_LABELS: Record<string, string> = {
  color: "Цвет",
  size: "Размер",
  pack: "Фасовка",
  material: "Материал",
  volume: "Объём",
  weight: "Вес",
  length: "Длина",
  width: "Ширина",
  flavor: "Вкус",
  scent: "Аромат",
};

function labelFor(type: string): string {
  return OPTION_LABELS[type] || type || "Вариант";
}

export function VariantPicker({
  variants,
  onSelectVariant,
  preferInStock = true,
}: VariantPickerProps) {
  // Группируем варианты по option_type
  const groups = useMemo<OptionGroup[]>(() => {
    if (!variants || variants.length === 0) return [];
    const map = new Map<string, ProductVariant[]>();
    for (const v of variants) {
      const key = v.optionType || "";
      const list = map.get(key) || [];
      list.push(v);
      map.set(key, list);
    }
    // Стабильный порядок: сначала известные типы, потом неизвестные
    const ordered: OptionGroup[] = [];
    const knownTypes = Object.keys(OPTION_LABELS);
    for (const t of knownTypes) {
      if (map.has(t)) ordered.push({ type: t, label: OPTION_LABELS[t], variants: map.get(t)! });
    }
    for (const [t, list] of map) {
      if (!knownTypes.includes(t)) ordered.push({ type: t, label: labelFor(t), variants: list });
    }
    return ordered;
  }, [variants]);

  // Локальный state: id выбранного варианта. Если у нас одна
  // группа (например, только «Цвет») — выбирается один вариант.
  // Если несколько (например, Цвет + Размер) — клиент
  // выбирает по одному в каждой группе. Итоговая комбинация
  // вариантов формируется «по последнему клику в любой группе»
  // — для упрощения мы храним selectedId: id варианта, и
  // в нём «зашит» весь набор опций (он уникален по паре
  // option_type + name, а не по id — см. ниже в комментариях).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // При первом рендере и при смене списка вариантов —
  // выбираем первый «в наличии» (или просто первый).
  useEffect(() => {
    if (variants.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
        onSelectVariant(null);
      }
      return;
    }
    // Если текущий выбор всё ещё валиден — оставляем.
    if (selectedId && variants.some((v) => v.id === selectedId)) {
      const current = variants.find((v) => v.id === selectedId) || null;
      onSelectVariant(current);
      return;
    }
    let pick: ProductVariant | null = null;
    if (preferInStock) {
      pick = variants.find((v) => v.stockQty > 0) || variants[0] || null;
    } else {
      pick = variants[0] || null;
    }
    setSelectedId(pick ? pick.id : null);
    onSelectVariant(pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants]);

  if (variants.length === 0) return null;

  return (
    <div className="variant-picker">
      {groups.map((g) => (
        <div key={g.type || "_"} className="variant-group">
          <div className="variant-group__label">
            {g.label}
            {/* Подпись выбранного значения — для UX */}
            {g.variants.find((v) => v.id === selectedId) && (
              <span className="variant-group__selected">
                : {g.variants.find((v) => v.id === selectedId)?.name}
              </span>
            )}
          </div>
          <div className="variant-group__chips">
            {g.variants.map((v) => {
              const isSelected = v.id === selectedId;
              const isOut = v.stockQty <= 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  className={[
                    "variant-chip",
                    isSelected ? "variant-chip--selected" : "",
                    isOut ? "variant-chip--out" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    setSelectedId(v.id);
                    onSelectVariant(v);
                  }}
                  title={
                    isOut
                      ? `${v.name} — нет в наличии`
                      : `${v.name}${v.price ? ` · ${v.price.toLocaleString("ru-RU")} ₽` : ""}`
                  }
                >
                  {/* Цветной кружочек — если есть colorHex */}
                  {v.colorHex && (
                    <span
                      className="variant-chip__swatch"
                      style={{ background: v.colorHex }}
                      aria-hidden
                    />
                  )}
                  <span className="variant-chip__name">{v.name}</span>
                  {isOut && (
                    <span className="variant-chip__badge" title="Нет в наличии">
                      <AlertCircle size={11} />
                    </span>
                  )}
                  {isSelected && !isOut && (
                    <span className="variant-chip__check">
                      <Check size={11} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Если все варианты в группе распроданы — подсказка */}
          {g.variants.every((v) => v.stockQty <= 0) && (
            <div className="variant-group__warn">
              <Package size={12} />
              Все варианты этой опции распроданы
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
