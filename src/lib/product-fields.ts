export const DEFAULT_PRODUCT_LABEL_COLOR = "#ea580c";
export const DEFAULT_PRODUCT_LABEL_TEXT_COLOR = "#ffffff";

/** Безопасный HEX для inline-стилей и color input. */
export function normalizeProductLabelColor(
  value: unknown,
  fallback: string | null = null,
): string | null {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

/**
 * Объём прямоугольной коробки в литрах.
 * Возвращает null, пока не заполнены все три положительных размера.
 */
export function calculateBoxVolumeLiters(
  length: unknown,
  width: unknown,
  height: unknown,
  unit: unknown = "мм",
): number | null {
  const dimensions = [length, width, height].map((value) => Number(value));
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null;
  }

  const cubicUnits = dimensions[0] * dimensions[1] * dimensions[2];
  const normalizedUnit = String(unit || "мм").trim().toLowerCase();
  let liters: number;

  if (normalizedUnit === "м" || normalizedUnit === "m") {
    liters = cubicUnits * 1000;
  } else if (normalizedUnit === "см" || normalizedUnit === "cm") {
    liters = cubicUnits / 1000;
  } else {
    // Миллиметры — единица по умолчанию.
    liters = cubicUnits / 1_000_000;
  }

  if (!Number.isFinite(liters) || liters <= 0) return null;
  return Math.round(liters * 1000) / 1000;
}
