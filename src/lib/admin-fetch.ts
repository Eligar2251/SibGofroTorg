// =========================================================
// FILE: src/lib/admin-fetch.ts
// Запросы из админки с понятной реакцией на истёкшую сессию.
//
// Раньше при истёкшем/отозванном токене (7 дней, смена ADMIN_SESSION_SECRET,
// очистка cookie) админские эндпоинты отвечали 401, а интерфейс показывал
// «Ошибка уведомлений», «Не удалось загрузить меню» и т.п. Администратор
// видел ошибки на каждой вкладке и не понимал, что нужно просто войти заново.
//
// Теперь 401 → автоматический переход на форму входа с пометкой expired=1
// (там показывается «Сессия истекла»), и только один раз, чтобы не было
// цикла редиректов.
// =========================================================

"use client";

let redirecting = false;

/** Путь админки в браузере: первый сегмент текущего URL. */
export function currentAdminPath(): string {
  if (typeof window === "undefined") return "admin";
  const first = window.location.pathname.split("/").filter(Boolean)[0];
  return first || "admin";
}

export function redirectToAdminLogin(reason: "expired" | "unauthorized" = "expired") {
  if (typeof window === "undefined" || redirecting) return;
  const adminPath = currentAdminPath();
  if (window.location.pathname === `/${adminPath}/login`) return;

  redirecting = true;
  const url = new URL(`/${adminPath}/login`, window.location.origin);
  if (reason === "expired") url.searchParams.set("expired", "1");
  window.location.href = url.toString();
}

/**
 * fetch для админских API: та же сигнатура, но 401 обрабатывается сам.
 * Бросает ошибку с человеческим текстом, если сессия истекла.
 */
export async function adminFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, { cache: "no-store", ...init });

  if (response.status === 401) {
    redirectToAdminLogin("expired");
    throw new Error("Сессия истекла — войдите в админку заново");
  }

  return response;
}

/**
 * Текст ошибки из ответа админского API. Учитывает формат
 * {error, detail, hint} который отдают маршруты при сбое базы.
 */
export function adminErrorText(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const data = body as { error?: string; detail?: string; hint?: string };
  const parts = [data.error, data.detail].filter(Boolean);
  if (parts.length === 0) return fallback;
  return parts.join(": ");
}
