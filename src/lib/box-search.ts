// =========================================================
// FILE: src/lib/box-search.ts
// Поиск ближайшей коробки по габаритам (Д × Ш × В, в миллиметрах).
// Сравнение идёт по каждой из трёх сторон независимо: бокс,
// у которого одна сторона близка (в пределах допуска), а другая
// «уехала» на 10 см и больше, ранжируется заметно ниже.
// =========================================================

export type DimKey = "Д" | "Ш" | "В";

export interface BoxProduct {
  id: string;
  name: string;
  slug: string;
  sku?: string | null;
  imageUrl?: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  /** Оригинальная единица измерения из БД (для подписи) */
  unit: string;
}

export interface BoxDiff {
  dim: DimKey;
  target: number;
  value: number | null;
  diff: number | null;
  withinTolerance: boolean;
}

export interface BoxMatch {
  product: BoxProduct;
  diffs: BoxDiff[];
  matchedCount: number;
  totalDiff: number;
  score: number;
}

/** Переводит размер товара в миллиметры. */
export function toMm(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const u = String(unit || "мм").trim().toLowerCase();
  if (u === "см" || u === "cm") return value * 10;
  if (u === "м" || u === "m") return value * 1000;
  return value; // мм по умолчанию
}

export interface BoxTarget {
  length: number;
  width: number;
  height: number;
}

/**
 * Оценивает «похожесть» коробки на целевые габариты.
 * Допуск toleranceMm (обычно 20–40 мм). Сторона в пределах допуска
 * даёт линейный вклад diff; сторона за пределами допуска — сильный
 * штраф (tolerance + 4×превышение), поэтому бокс с одной «уехавшей»
 * стороной оказывается ниже боксов, где все три стороны близки.
 */
export function scoreBox(product: BoxProduct, target: BoxTarget, toleranceMm: number): BoxMatch {
  const dims: { dim: DimKey; target: number; value: number | null }[] = [
    { dim: "Д", target: target.length, value: product.lengthMm },
    { dim: "Ш", target: target.width, value: product.widthMm },
    { dim: "В", target: target.height, value: product.heightMm },
  ];

  let score = 0;
  let matchedCount = 0;
  let totalDiff = 0;

  const diffs: BoxDiff[] = dims.map(({ dim, target, value }) => {
    if (value == null) {
      // Размер не заполнен — считаем как сильное несовпадение.
      const penalty = toleranceMm + 400;
      score += penalty;
      return { dim, target, value: null, diff: null, withinTolerance: false };
    }
    const diff = Math.abs(target - value);
    totalDiff += diff;
    const within = diff <= toleranceMm;
    if (within) {
      matchedCount++;
      score += diff;
    } else {
      score += toleranceMm + (diff - toleranceMm) * 4;
    }
    return { dim, target, value, diff, withinTolerance: within };
  });

  return { product, diffs, matchedCount, totalDiff, score };
}

/** Сортирует товары по похожести: ближайшие сверху, менее похожие ниже. */
export function findNearestBoxes(
  products: BoxProduct[],
  target: BoxTarget,
  toleranceMm: number,
): BoxMatch[] {
  return products
    .map((p) => scoreBox(p, target, toleranceMm))
    .sort((a, b) => {
      // Сначала по числу совпавших сторон (больше — лучше), затем по score.
      if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
      return a.score - b.score;
    });
}

/** Человекочитаемая оценка совпадения. */
export function matchLabel(matchedCount: number): { text: string; tone: "great" | "good" | "partial" | "none" } {
  if (matchedCount === 3) return { text: "Точное совпадение", tone: "great" };
  if (matchedCount === 2) return { text: "Близкое совпадение", tone: "good" };
  if (matchedCount === 1) return { text: "Частичное совпадение", tone: "partial" };
  return { text: "Не совпадает", tone: "none" };
}

export function formatMm(value: number | null): string {
  return value == null ? "—" : value.toLocaleString("ru-RU");
}
