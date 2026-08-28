// =========================================================
// FILE: src/lib/safe-fetch.ts
// Устойчивый клиентский fetch для необязательных данных.
//
// ЗАЧЕМ
// В браузере запрос может упасть не по вине приложения: антивирус с
// проверкой HTTPS (Kaspersky подменяет window.fetch своим), блокировщик
// рекламы, расширение, обрыв Wi-Fi, перезапуск dev-сервера, переход на
// другую страницу во время запроса. Всё это даёт «TypeError: Failed to
// fetch» — и если такой промис попадает в console.error, Next рисует
// красную панель ошибки, хотя чинить в коде нечего.
//
// Здесь такие сбои считаются ожидаемыми: возвращаем null, пишем короткое
// предупреждение (только в разработке) и даём один повтор — этого хватает,
// чтобы пережить разовый обрыв.
// =========================================================

"use client";

/** Сетевой сбой (а не ошибка приложения)? */
function isNetworkError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  // Все браузеры отдают именно TypeError на обрыв/блокировку запроса
  return error instanceof TypeError;
}

export interface SafeFetchOptions extends RequestInit {
  /** Сколько раз повторить при сетевом сбое (по умолчанию 1). */
  retries?: number;
  /** Пауза перед повтором, мс. */
  retryDelayMs?: number;
  /** Подпись для предупреждения в консоли. */
  label?: string;
}

/**
 * Загрузить JSON, не роняя интерфейс.
 * Возвращает null, если данные получить не удалось — вызывающий код
 * должен уметь работать без них.
 */
export async function fetchJsonSafe<T>(
  url: string,
  options: SafeFetchOptions = {}
): Promise<T | null> {
  const { retries = 1, retryDelayMs = 700, label, ...init } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        // 4xx/5xx — это ответ сервера, повторять смысла нет.
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[fetch] ${label || url}: HTTP ${response.status}`);
        }
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      if (init.signal?.aborted) return null;
      if (!isNetworkError(error)) throw error;

      const last = attempt === retries;
      if (!last) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      if (process.env.NODE_ENV !== "production") {
        // Именно warn, а не error: приложение исправно, упала сеть или
        // запрос перехватил антивирус/расширение браузера.
        console.warn(
          `[fetch] ${label || url}: запрос не прошёл (сеть, антивирус или расширение браузера). Интерфейс продолжит работать без этих данных.`
        );
      }
      return null;
    }
  }
  return null;
}
