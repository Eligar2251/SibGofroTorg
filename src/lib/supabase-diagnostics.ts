// =========================================================
// FILE: src/lib/supabase-diagnostics.ts
// Диагностика доступа к базе Supabase из контейнера приложения.
//
// ЗАЧЕМ: при сбое (проект Supabase на паузе, ротация JWT-секрета, отключённые
// legacy-ключи, сетевые блокировки, потерянные переменные окружения) админка
// отдаёт одинаковые «500 Ошибка сервера», а публичный сайт продолжает
// работать из кэша ISR. Отличить один случай от другого по логам браузера
// невозможно, поэтому здесь один HTTP-запрос классифицируется в понятный
// диагноз + действие: что именно нажать в панелях.
//
// Файл не отдаёт наружу секреты: значения ключей не печатаются, сообщения
// Supabase проходят очистку.
// =========================================================

import { adminPathReport } from "@/lib/admin-path";
import {
  adminSessionSecretProblem,
  adminSessionSecretState,
} from "@/lib/admin-session-token";

export type DbStatus =
  | "ok"
  | "missing_env"
  | "bad_url"
  | "invalid_key"
  | "project_paused"
  | "project_missing"
  | "network"
  | "timeout"
  | "schema"
  | "server_error"
  | "unknown";

export type TableCheck = {
  table: string;
  ok: boolean;
  status: "ok" | "missing" | "forbidden" | "error";
  httpStatus?: number;
  message?: string;
};

export type DbDiagnosis = {
  ok: boolean;
  db: "up" | "down" | "unconfigured";
  status: DbStatus;
  /** Ключ или URL потерялись/испорчены. */
  title: string;
  /** Очищенное сообщение Supabase/сети (обрезано). */
  message: string | null;
  /** Что делать — конкретное действие. */
  hint: string;
  httpStatus: number | null;
  code: string | null;
  latencyMs: number;
  host: string | null;
  keyFormat: KeyFormat;
  keySource: string;
  tables?: TableCheck[];
  ts: string;
};

export type KeyFormat =
  | "legacy_jwt"
  | "publishable"
  | "secret"
  | "unknown"
  | "missing";

/** Секреты в отчёте: любые длинные ключи заменяем на маркер. */
export function sanitizeReportText(raw: unknown, limit = 400): string | null {
  if (raw == null) return null;
  let text = typeof raw === "string" ? raw : String(raw);
  text = text
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, "<JWT-ключ>")
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "<новый ключ Supabase>")
    .replace(/(apikey|token|password|secret)=\S+/gi, "$1=<скрыто>")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > limit) text = `${text.slice(0, limit)}…`;
  return text || null;
}

function keyFormatOf(key: string | undefined): KeyFormat {
  if (!key) return "missing";
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("eyJ")) return "legacy_jwt";
  return "unknown";
}

function supabaseHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Разбор сообщения сети/Undici в понятную причину. */
function classifyNetworkError(error: unknown): { status: DbStatus; message: string } {
  const err = error as { name?: string; message?: string; cause?: unknown } | null;
  const name = err?.name || "";
  const message = err?.message || String(error);
  const causeMessage = String(
    (err?.cause as { code?: string; message?: string } | undefined)?.code ||
      (err?.cause as { message?: string } | undefined)?.message ||
      ""
  );
  const combined = `${message} ${causeMessage}`;

  if (name === "TimeoutError" || name === "AbortError" || /timeout|timed out/i.test(combined)) {
    return {
      status: "timeout",
      message: "Превышено время ожидания ответа от Supabase.",
    };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|dns/i.test(combined)) {
    return {
      status: "network",
      message: `DNS не смог разрешить адрес Supabase (${causeMessage || "ENOTFOUND"}).`,
    };
  }
  if (/CERT|self signed|UNABLE_TO_VERIFY|TLS|SSL/i.test(combined)) {
    return {
      status: "network",
      message: `Ошибка TLS/сертификата при обращении к Supabase (${causeMessage || message}).`,
    };
  }
  if (/ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|UND_ERR/i.test(combined)) {
    return {
      status: "network",
      message: `Соединение с Supabase обрывается (${causeMessage || message}).`,
    };
  }
  // Ошибки Supabase — объекты {message, details, hint}; не печатаем «[object Object]».
  const structured = error as { message?: unknown; details?: unknown; hint?: unknown } | null;
  const readable =
    typeof structured?.message === "string" && structured.message
      ? [structured.message, structured.details, structured.hint]
          .filter((part) => typeof part === "string" && part)
          .join(" · ")
      : message;
  return { status: "unknown", message: sanitizeReportText(readable) || "Неизвестная ошибка" };
}

function hintFor(status: DbStatus, httpStatus: number | null): string {
  switch (status) {
    case "missing_env":
      return "В переменных окружения приложения нет SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY. Добавьте их в панели хостинга и перезапустите приложение.";
    case "bad_url":
      return "SUPABASE_URL должен выглядеть как https://xxxxxxxx.supabase.co (без слеша в конце). Исправьте переменную и перезапустите приложение.";
    case "invalid_key":
      return "Supabase не принимает ключ. Скорее всего ротировали JWT-секрет проекта, отключили legacy-ключи или в переменную попал новый публичный ключ (sb_publishable_…) вместо секретного. Откройте Supabase → Project Settings → API Keys, скопируйте Secret key (или legacy service_role) в SUPABASE_SERVICE_ROLE_KEY, а Publishable/anon — в NEXT_PUBLIC_SUPABASE_ANON_KEY, затем перезапустите приложение.";
    case "project_paused":
      return "Проект Supabase на паузе или ограничен (бесплатный тариф приостанавливают за неактивность/лимиты). Supabase Dashboard → выберите проект → Restore/Resume project. После запуска база заработает без правок в коде.";
    case "project_missing":
      return "По адресу SUPABASE_URL проекта нет: он удалён, переименован или ссылка устарела. Возьмите актуальный Project URL в Supabase → Project Settings → Data API.";
    case "network":
      return "Сеть между контейнером и Supabase не работает: чаще всего это блокировка/фильтрация трафика из РФ к *.supabase.co. Проверьте тот же запрос из другого места, повторите позже, при устойчивой блокировке — переезд базы или прокси. Никакие ключи тут не помогут.";
    case "timeout":
      return "Запрос к Supabase не успел ответить за отведённое время. Проверьте нагрузку/размер проекта, временно поднимите SUPABASE_FETCH_TIMEOUT_MS (например, 30000) и перезапустите приложение.";
    case "schema":
      return "База доступна, но в схеме нет нужной таблицы — значит не применена SQL-миграция из папки supabase/. Примените её в Supabase → SQL Editor.";
    case "server_error":
      return `Supabase ответил ошибкой ${httpStatus ?? 5}. Это сбой на стороне сервиса — проверьте статус проекта в Supabase Dashboard (Health/Logs) и повторите через несколько минут.`;
    case "ok":
      return "База доступна — причина сбоя не в подключении к БД. Смотрите страницу диагностики в админке.";
    default:
      return "Не удалось определить причину автоматически. Проверьте логи приложения на хостинге (строки со словом Supabase).";
  }
}

function titleFor(status: DbStatus): string {
  switch (status) {
    case "ok":
      return "База данных доступна";
    case "missing_env":
      return "Не заданы переменные окружения Supabase";
    case "bad_url":
      return "Некорректный SUPABASE_URL";
    case "invalid_key":
      return "Supabase отклонил ключ доступа";
    case "project_paused":
      return "Проект Supabase приостановлен";
    case "project_missing":
      return "Проект Supabase не найден";
    case "network":
      return "Нет связи с Supabase по сети";
    case "timeout":
      return "Supabase не успевает отвечать";
    case "schema":
      return "В базе нет нужной таблицы";
    case "server_error":
      return "Ошибка на стороне Supabase";
    default:
      return "База данных недоступна";
  }
}

/**
 * Проверка доступа к базе напрямую (без supabase-js) — чтобы видеть
 * HTTP-статус и тело ответа и корректно классифицировать сбой.
 */
export async function diagnoseSupabase(options?: {
  deep?: boolean;
  timeoutMs?: number;
}): Promise<DbDiagnosis> {
  const startedAt = Date.now();
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const keyFormat = keyFormatOf(key);
  const host = supabaseHost(url);
  const base = {
    ok: false,
    db: "down" as const,
    httpStatus: null as number | null,
    code: null as string | null,
    host,
    keyFormat,
    keySource: "SUPABASE_SERVICE_ROLE_KEY",
    latencyMs: 0,
    ts: new Date().toISOString(),
  };

  if (!url || !key) {
    const status: DbStatus = "missing_env";
    return {
      ...base,
      status,
      db: "unconfigured",
      title: titleFor(status),
      message: !url
        ? "SUPABASE_URL не задан"
        : "SUPABASE_SERVICE_ROLE_KEY не задан",
      hint: hintFor(status, null),
      latencyMs: Date.now() - startedAt,
    };
  }

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url)) {
    const status: DbStatus = "bad_url";
    return {
      ...base,
      status,
      db: "unconfigured",
      title: titleFor(status),
      message: sanitizeReportText(`SUPABASE_URL = ${url}`),
      hint: hintFor(status, null),
      latencyMs: Date.now() - startedAt,
    };
  }

  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/settings?select=key&limit=1`;
  const timeoutMs = options?.timeoutMs ?? 8000;

  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Date.now() - startedAt;
    const rawBody = await response.text().catch(() => "");
    let postgrestCode: string | null = null;
    let apiMessage: string | null = null;
    try {
      const parsed = JSON.parse(rawBody) as {
        code?: string;
        message?: string;
        hint?: string;
        error?: string;
      };
      postgrestCode = parsed.code || null;
      apiMessage = parsed.message || parsed.hint || parsed.error || null;
    } catch {
      apiMessage = sanitizeReportText(rawBody, 200);
    }
    const message = apiMessage || `HTTP ${response.status}`;

    if (response.ok) {
      const diagnosis: DbDiagnosis = {
        ...base,
        ok: true,
        db: "up",
        status: "ok",
        title: titleFor("ok"),
        message: null,
        hint: hintFor("ok", response.status),
        httpStatus: response.status,
        latencyMs,
      };
      if (options?.deep) {
        diagnosis.tables = await checkTables(url, key, timeoutMs);
        const broken = diagnosis.tables.filter(
          (table) => !table.ok && table.status !== "forbidden"
        );
        if (broken.length > 0) {
          diagnosis.ok = false;
          diagnosis.status = "schema";
          diagnosis.title = titleFor("schema");
          diagnosis.message = `Не найдены таблицы: ${broken
            .map((table) => table.table)
            .join(", ")}`;
          diagnosis.hint = hintFor("schema", response.status);
        }
      }
      return diagnosis;
    }

    // ── Ошибочные ответы ──────────────────────────────────
    let status: DbStatus = "unknown";
    if (response.status === 401 || response.status === 403) {
      status = "invalid_key";
    } else if (response.status === 404) {
      status = /paused|inactive|suspend/i.test(message)
        ? "project_paused"
        : "project_missing";
    } else if (response.status === 400 || response.status === 406) {
      if (postgrestCode === "PGRST205" || /schema cache|does not exist/i.test(message)) {
        status = "schema";
      } else if (/invalid api key|jwt|no api key/i.test(message)) {
        status = "invalid_key";
      } else {
        status = "unknown";
      }
    } else if (response.status === 402) {
      status = "project_paused";
    } else if (response.status === 408 || response.status === 504) {
      status = "timeout";
    } else if (response.status === 503 || response.status === 502) {
      status = /paused|suspend/i.test(message) ? "project_paused" : "server_error";
    } else if (response.status >= 500) {
      status = "server_error";
    }

    return {
      ...base,
      status,
      db: status === "schema" ? "up" : "down",
      title: titleFor(status),
      message: sanitizeReportText(message),
      hint: hintFor(status, response.status),
      httpStatus: response.status,
      code: postgrestCode,
      latencyMs,
    };
  } catch (error) {
    const classified = classifyNetworkError(error);
    const status = classified.status === "unknown" && keyFormat === "publishable"
      ? "invalid_key"
      : classified.status;
    return {
      ...base,
      status,
      title: titleFor(status),
      message: sanitizeReportText(classified.message),
      hint: hintFor(status, null),
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** Проверка набора таблиц, без которых админка не поднимется. */
async function checkTables(
  url: string,
  key: string,
  timeoutMs: number
): Promise<TableCheck[]> {
  const tables = ["settings", "products", "admins", "orders"];
  const base = url.replace(/\/+$/, "");

  return Promise.all(
    tables.map(async (table): Promise<TableCheck> => {
      try {
        const response = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) return { table, ok: true, status: "ok", httpStatus: response.status };

        const body = await response.text().catch(() => "");
        const parsed = (() => {
          try {
            return JSON.parse(body) as { code?: string; message?: string };
          } catch {
            return {} as { code?: string; message?: string };
          }
        })();
        const missing =
          parsed.code === "PGRST205" ||
          parsed.code === "42P01" ||
          /does not exist|schema cache/i.test(parsed.message || "");

        return {
          table,
          ok: false,
          status: missing
            ? "missing"
            : response.status === 401 || response.status === 403
              ? "forbidden"
              : "error",
          httpStatus: response.status,
          message: sanitizeReportText(parsed.message || `HTTP ${response.status}`, 160) || undefined,
        };
      } catch (error) {
        const classified = classifyNetworkError(error);
        return {
          table,
          ok: false,
          status: "error",
          message: sanitizeReportText(classified.message, 160) || undefined,
        };
      }
    })
  );
}

export type EnvCheck = {
  id: string;
  label: string;
  ok: boolean;
  /** Уровень: fail — без этого админка не работает, warn — часть функций. */
  level: "fail" | "warn";
  detail: string;
  hint?: string;
};

function present(name: string): boolean {
  return Boolean(String(process.env[name] || "").trim());
}

/** Проверка переменных окружения — значения наружу не отдаются. */
export function collectEnvChecks(): EnvCheck[] {
  const checks: EnvCheck[] = [];
  const secretState = adminSessionSecretState();
  const pathReport = adminPathReport();

  checks.push({
    id: "supabase-url",
    label: "SUPABASE_URL",
    ok: present("SUPABASE_URL"),
    level: "fail",
    detail: present("SUPABASE_URL")
      ? `задан (${supabaseHost(process.env.SUPABASE_URL) || "некорректный URL"})`
      : "не задан",
    hint: present("SUPABASE_URL")
      ? undefined
      : "Supabase → Project Settings → Data API → Project URL.",
  });

  checks.push({
    id: "supabase-service-key",
    label: "SUPABASE_SERVICE_ROLE_KEY",
    ok: present("SUPABASE_SERVICE_ROLE_KEY"),
    level: "fail",
    detail: present("SUPABASE_SERVICE_ROLE_KEY")
      ? `задан, формат: ${
          {
            legacy_jwt: "legacy JWT (service_role)",
            publishable: "публичный ключ — не подходит для сервера!",
            secret: "новый Secret key",
            unknown: "нераспознанный",
            missing: "не задан",
          }[keyFormatOf(process.env.SUPABASE_SERVICE_ROLE_KEY)]
        }, длина ${process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0}`
      : "не задан",
    hint:
      keyFormatOf(process.env.SUPABASE_SERVICE_ROLE_KEY) === "publishable"
        ? "В переменную попал публичный ключ. Нужен Secret key (или legacy service_role JWT)."
        : present("SUPABASE_SERVICE_ROLE_KEY")
          ? undefined
          : "Supabase → Project Settings → API Keys → Secret key (или legacy service_role).",
  });

  checks.push({
    id: "supabase-anon-key",
    label: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ok: present("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    level: "warn",
    detail: present("NEXT_PUBLIC_SUPABASE_ANON_KEY") ? "задан" : "не задан",
    hint: present("NEXT_PUBLIC_SUPABASE_ANON_KEY")
      ? undefined
      : "Нужен для регистрации/входа клиентов. Возьмите Publishable key (или legacy anon).",
  });

  checks.push({
    id: "admin-session-secret",
    label: "ADMIN_SESSION_SECRET",
    ok: secretState === "ok",
    level: "fail",
    detail:
      secretState === "ok"
        ? `задан, длина ${process.env.ADMIN_SESSION_SECRET?.length}`
        : adminSessionSecretProblem() || "не настроен",
    hint:
      secretState === "ok"
        ? undefined
        : "Строка минимум 32 символа. После смены значения все администраторы входят заново.",
  });

  checks.push({
    id: "admin-path",
    label: "Путь админки",
    ok: !pathReport.mismatch,
    level: "fail",
    detail: pathReport.notice || `работает «/${pathReport.effectivePath}»`,
    hint: pathReport.mismatch
      ? "ADMIN_SECRET_PATH и NEXT_PUBLIC_ADMIN_PATH должны совпадать. Приведите их к одному значению и перезапустите приложение."
      : undefined,
  });

  checks.push({
    id: "user-session-secret",
    label: "USER_SESSION_SECRET",
    ok: present("USER_SESSION_SECRET") || secretState === "ok",
    level: "warn",
    detail: present("USER_SESSION_SECRET")
      ? "задан"
      : "не задан — сессии клиентов подписываются ADMIN_SESSION_SECRET",
    hint: present("USER_SESSION_SECRET")
      ? undefined
      : "Можно оставить как есть, либо задать отдельный секрет ≥32 символов.",
  });

  checks.push({
    id: "site-url",
    label: "NEXT_PUBLIC_SITE_URL",
    ok: present("NEXT_PUBLIC_SITE_URL"),
    level: "warn",
    detail: present("NEXT_PUBLIC_SITE_URL") ? "задан" : "не задан",
    hint: present("NEXT_PUBLIC_SITE_URL")
      ? undefined
      : "Канонический домен для SEO (например, https://sibgofrotorg.ru).",
  });

  checks.push({
    id: "cloudinary",
    label: "Cloudinary (фото товаров)",
    ok: present("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME") && present("CLOUDINARY_API_KEY"),
    level: "warn",
    detail:
      present("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME") && present("CLOUDINARY_API_KEY")
        ? "задан"
        : "не задан — загрузка фото недоступна",
    hint: "Cloudinary → Dashboard: cloud name, API key, API secret.",
  });

  checks.push({
    id: "max-bot",
    label: "MAX-бот (уведомления о заявках)",
    ok: present("MAX_BOT_TOKEN") && present("MAX_ADMIN_CHAT_ID"),
    level: "warn",
    detail:
      present("MAX_BOT_TOKEN") && present("MAX_ADMIN_CHAT_ID")
        ? "задан"
        : "не задан — уведомления только внутри админки",
    hint: "Можно задать в админке: Настройки → Уведомления.",
  });

  checks.push({
    id: "runtime",
    label: "Окружение",
    ok: true,
    level: "warn",
    detail: `NODE_ENV=${process.env.NODE_ENV || "не задан"}, Node ${process.version}, PORT=${
      process.env.PORT || "по умолчанию"
    }`,
  });

  return checks;
}

export type AdminAccountsReport = {
  total: number;
  active: number;
  fullAccess: number;
  usernames: string[];
  error?: string;
};

/**
 * Сколько учётных записей админки есть в базе. Частая причина «не пускает» —
 * пустая таблица admins или единственный деактивированный аккаунт.
 * Пароли (хеши) не читаем и не отдаём.
 */
export async function checkAdminAccounts(
  timeoutMs = 8000
): Promise<AdminAccountsReport | null> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;

  try {
    const response = await fetch(
      `${url.replace(/\/+$/, "")}/rest/v1/admins?select=username,role,is_active&limit=500`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      return {
        total: 0,
        active: 0,
        fullAccess: 0,
        usernames: [],
        error: sanitizeReportText(message, 200) || `HTTP ${response.status}`,
      };
    }

    const rows = (await response.json().catch(() => [])) as Array<{
      username?: string;
      role?: string;
      is_active?: boolean;
    }>;
    const list = Array.isArray(rows) ? rows : [];
    return {
      total: list.length,
      active: list.filter((row) => row.is_active !== false).length,
      fullAccess: list.filter(
        (row) => (row.role === "owner" || row.role === "admin") && row.is_active !== false
      ).length,
      usernames: list.map((row) => String(row.username || "")).filter(Boolean).slice(0, 50),
    };
  } catch (error) {
    return {
      total: 0,
      active: 0,
      fullAccess: 0,
      usernames: [],
      error: sanitizeReportText((error as Error)?.message, 200) || "error",
    };
  }
}
