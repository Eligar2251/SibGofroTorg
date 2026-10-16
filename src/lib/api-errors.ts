// =========================================================
// FILE: src/lib/api-errors.ts
// Единый формат ошибок админских API.
//
// РАНЬШЕ: недоступный Supabase (проект на паузе, ротация ключей, сеть)
// превращался в «500 {error:"Ошибка сервера"}» на десятках маршрутов.
// Браузер показывал только «500» в консоли, а сбой базы выглядел как
// «сломался вход/JWT», хотя причина была в подключении.
//
// ТЕПЕРЬ: маршруты отдают 503 с кодом db_unavailable и человеческим
// объяснением. 401 остаётся только за сессией.
// =========================================================

import { NextResponse } from "next/server";

const DB_FAILURE_MARKERS = [
  "fetch failed",
  "timeout",
  "timed out",
  "aborted",
  "abort",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "socket",
  "UND_ERR",
  "network",
  "supabase",
  "не задан в переменных окружения",
  "не заданы",
  "Invalid API key",
  "JWT",
  "project",
  "PGRST",
  "42P01",
  "schema cache",
];

/** Похоже ли, что упало именно подключение к базе (а не логика модуля). */
export function isDbUnavailable(error: unknown): boolean {
  if (!error) return false;
  const err = error as { message?: string; code?: string; details?: string; hint?: string };
  const text = `${err.message || ""} ${err.details || ""} ${err.hint || ""} ${err.code || ""}`;
  if (!text.trim()) return false;

  // PostgREST отдаёт числовой код PG — это ошибка данных/схемы, не сети.
  if (/^\d{5}$/.test(String(err.code || "")) && !/42P01/.test(String(err.code))) {
    return false;
  }
  return DB_FAILURE_MARKERS.some((marker) =>
    text.toLowerCase().includes(marker.toLowerCase())
  );
}

function sanitize(text: string, limit = 300): string {
  const cleaned = text
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, "<ключ>")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}

/**
 * Текст ошибки одной строкой. Ошибки Supabase — это не Error, а объекты
 * {message, details, hint, code}: раньше такой объект превращался в
 * «[object Object]» и не помогал понять причину.
 */
export function errorText(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message || error.name || "ошибка";
  if (typeof error === "object") {
    const obj = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [obj.message, obj.details, obj.hint, obj.code].filter(
      (part): part is string => typeof part === "string" && part.trim() !== ""
    );
    if (parts.length) return parts.join(" · ");
  }
  return String(error);
}

export function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

/**
 * Ответ на сбой: 503 для недоступной базы (с подсказкой), иначе 500.
 * Логирование остаётся на стороне маршрута.
 */
export function apiErrorResponse(error: unknown, context: string) {
  if (isDbUnavailable(error)) {
    const detail = sanitize(errorText(error) || "нет соединения");
    return noStoreJson(
      {
        error: "База данных недоступна",
        code: "db_unavailable",
        detail,
        hint:
          "Проверьте, работает ли база (сервер базы данных / проект Supabase) и перезапустите её.",
        context,
      },
      503
    );
  }

  return noStoreJson(
    {
      error: "Ошибка сервера",
      code: "internal",
      detail: sanitize(errorText(error)),
      context,
    },
    500
  );
}
