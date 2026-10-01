// =========================================================
// FILE: src/lib/product-size.ts
// Размер товара одной строкой — «600×400×400 мм».
//
// Одним местом на весь сайт: карточка каталога, страница товара
// и компактные карточки на главной (в том числе «Распродажа
// остатков») печатают габариты одинаково. Раньше строка
// собиралась копипастой в каждом компоненте, поэтому где-то
// размер просто забывали вывести.
// =========================================================

/** Что нужно, чтобы показать размер: габариты товара и единица. */
export interface ProductSizeSource {
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
}

/**
 * Размер для карточки.
 *
 * `mode`:
 *  - "full" (по умолчанию) — как в каталоге: нужны длина и ширина,
 *    третьим числом добавляется высота. Одного числа мало, чтобы
 *    понять габарит, поэтому такой размер не показываем;
 *  - "any" — показываем всё, что заполнено (у рулона бывает только
 *    ширина, у листа — только длина). Нужен для компактных
 *    карточек, где размер — единственная подсказка о товаре.
 *
 * Пустое значение (нет габаритов) — `null`: вызывающий код просто
 * ничего не печатает.
 */
export function formatProductSize(
  product: ProductSizeSource | null | undefined,
  mode: "full" | "any" = "full"
): string | null {
  if (!product) return null;
  const length = positiveNumber(product.dimensionLength);
  const width = positiveNumber(product.dimensionWidth);
  const height = positiveNumber(product.dimensionHeight);

  const parts =
    mode === "full"
      ? length != null && width != null
        ? [length, width, ...(height != null ? [height] : [])]
        : []
      : [length, width, height].filter((value): value is number => value != null);

  if (parts.length === 0) return null;
  const unit = (product.dimensionUnit || "мм").trim() || "мм";
  return `${parts.join("×")} ${unit}`;
}

/** Вариант товара: у «родителя» габариты часто пустые, а размеры
 *  (600×400×400, XL, пачка 50 шт.) живут в вариантах. */
export interface ProductVariantSizeSource extends ProductSizeSource {
  name?: string | null;
  optionType?: string | null;
}

/**
 * Размеры по вариантам товара — когда у самого товара габариты не
 * заполнены. Берём габариты варианта, а если их нет — название
 * варианта размера («600×400×400», «XL»).
 *
 * Дубликаты убираем, лишнее сворачиваем: в компактной карточке
 * «размеров» может быть десять, а места хватает на строку-две.
 */
export function formatVariantSizes(
  variants: ProductVariantSizeSource[] | null | undefined,
  limit = 3
): string | null {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const variant of Array.isArray(variants) ? variants : []) {
    const fromDims = formatProductSize(variant, "any");
    const fromName =
      (variant.optionType || "").toLowerCase() === "size"
        ? (variant.name || "").trim()
        : "";
    const label = fromDims || fromName;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  if (labels.length === 0) return null;
  if (labels.length <= limit) return labels.join(" · ");
  return `${labels.slice(0, limit).join(" · ")} · …`;
}

function positiveNumber(value: number | null | undefined): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}
