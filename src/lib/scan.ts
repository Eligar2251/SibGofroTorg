// =========================================================
// FILE: src/lib/scan.ts
// Общие утилиты для экрана сканера товара.
// Никаких Node-only импортов — модуль используется и на сервере,
// и в клиентском бандле.
// =========================================================

export type StockTone = "ok" | "low" | "out";
export type StockLabel = { text: string; tone: StockTone };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractCodeFromUrlLike(urlLike: URL, adminPath?: string): string {
  const searchKeys = ["code", "slug", "barcode", "qr"];
  for (const key of searchKeys) {
    const value = urlLike.searchParams.get(key)?.trim();
    if (value) return value;
  }

  const segments = urlLike.pathname
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .map(safeDecode);

  if (segments.length === 0) return "";

  const scanIndex = segments.findIndex(
    (segment, index) => segment.toLowerCase() === "scan" && index < segments.length - 1
  );
  if (scanIndex >= 0) {
    return safeDecode(segments[scanIndex + 1]);
  }

  if (adminPath && segments[0]?.toLowerCase() === adminPath.toLowerCase()) {
    return safeDecode(segments[segments.length - 1]);
  }

  return safeDecode(segments[segments.length - 1]);
}

/**
 * Нормализует строку, пришедшую из камеры или ручного ввода.
 *
 * Поддерживает:
 *  • QR-slug / EAN / SKU / slug как есть;
 *  • полные URL вида https://site.ru/admin/scan/XXXX;
 *  • относительные пути /admin/scan/XXXX;
 *  • старые/сторонние URL карточек товара — берём последний сегмент
 *    пути, чтобы можно было найти товар по slug.
 */
export function normalizeScanCode(rawValue: string, adminPath?: string): string {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      return extractCodeFromUrlLike(new URL(trimmed), adminPath) || trimmed;
    } catch {
      return trimmed;
    }
  }

  if (trimmed.startsWith("/")) {
    try {
      return (
        extractCodeFromUrlLike(new URL(trimmed, "https://scanner.local"), adminPath) || trimmed
      );
    } catch {
      return trimmed;
    }
  }

  if (trimmed.includes("/scan/")) {
    const match = trimmed.match(/\/scan\/([^/?#]+)/i);
    if (match?.[1]) return safeDecode(match[1]);
  }

  return trimmed;
}

export function buildStockLabel(input: {
  stockQty?: number | null;
  inStock?: boolean | null;
}): StockLabel {
  if (input.stockQty != null) {
    if (input.stockQty <= 0) return { text: "Нет в наличии", tone: "out" };
    if (input.stockQty < 10) return { text: `Мало: ${input.stockQty} шт`, tone: "low" };
    return { text: `В наличии: ${input.stockQty} шт`, tone: "ok" };
  }

  return input.inStock
    ? { text: "В наличии", tone: "ok" }
    : { text: "Нет в наличии", tone: "out" };
}
