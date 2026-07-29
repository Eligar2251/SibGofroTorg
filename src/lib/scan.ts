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

  // Маркерные сегменты, после которых идёт сам код:
  //  • "scan" — старые QR вида /{adminPath}/scan/{slug};
  //  • "q"    — новые короткие QR вида /q/{slug} (см. src/app/q/[code]).
  const markerIndex = segments.findIndex(
    (segment, index) =>
      ["scan", "q"].includes(segment.toLowerCase()) &&
      index < segments.length - 1
  );
  if (markerIndex >= 0) {
    return safeDecode(segments[markerIndex + 1]);
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

  // ВАЖНО: сравнение схемы регистронезависимое.
  // Новые QR кодируют URL в ВЕРХНЕМ регистре ("HTTPS://SITE/Q/XXXX"),
  // чтобы уложиться в alphanumeric-режим QR и получить символ на
  // одну версию меньше (см. src/lib/qr.ts). Со старой проверкой
  // startsWith("https://") такой payload не распознавался как URL и
  // уходил в поиск целиком — товар не находился.
  if (/^https?:\/\//i.test(trimmed)) {
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

  // Фоллбек для строк без схемы: "site.ru/q/XXXX", "…/scan/XXXX".
  const marker = trimmed.match(/\/(?:scan|q)\/([^/?#]+)/i);
  if (marker?.[1]) return safeDecode(marker[1]);

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
