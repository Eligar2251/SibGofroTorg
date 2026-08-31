// =========================================================
// FILE: src/lib/realtime-hub.ts
// Серверный хаб Supabase Realtime.
//
// ЗАЧЕМ ИМЕННО ТАК, А НЕ ПОДПИСКА ИЗ БРАУЗЕРА
// Прямая подписка админки на postgres_changes через anon-ключ не работает
// и работать не должна:
//   • у рабочих таблиц (customer_deals, bank_payments, salaries,
//     client_requests…) RLS включён и политик для anon НЕТ — события до
//     клиента просто не дойдут;
//   • выдать anon SELECT на зарплаты и платежи нельзя: anon-ключ публичный,
//     он лежит в JS-бандле сайта, и любой посетитель выкачал бы их по REST.
//
// Поэтому подписку держит СЕРВЕР под service_role (обходит RLS), а браузеры
// админки слушают собственный домен через SSE (/api/admin/events) под уже
// существующей admin-session cookie. Плюсы: один WebSocket на весь сайт
// вместо одного на вкладку, ничего не нужно менять в CSP (connect-src 'self'),
// нельзя подслушать снаружи, права проверяются нашим же кодом.
//
// ВАЖНО: таблицы должны быть в публикации supabase_realtime —
// см. supabase/migration_realtime_admin.sql
// =========================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Таблицы, за которыми следим. */
export const REALTIME_TABLES = [
  "orders",
  "wastepaper_requests",
  "client_requests",
  "customer_deals",
  "warehouse_receipts",
  "bank_payments",
  "salaries",
  "cash_collections",
  "products",
  "transports",
  "product_reviews",
  "product_questions",
  "activity_logs",
  "rent_invoices",
  "rent_payments",
  // Отдельный учёт макулатуры — эти таблицы уже добавлены в публикацию
  // миграцией migration_wastepaper_account.sql
  "wp_intakes",
  "wp_shipments",
  "wp_payments",
  "wp_transports",
  "wp_counterparties",
] as const;

export type RealtimeTable = (typeof REALTIME_TABLES)[number];

/**
 * Какие таблицы какая роль имеет право слышать.
 * Та же матрица, что в admin-rbac: юрист — только финансы и перевозки,
 * макулатурщик — только свой модуль.
 */
const ROLE_TABLES: Record<string, readonly string[] | "all"> = {
  admin: "all",
  manager: "all",
  lawyer: [
    "bank_payments",
    "cash_collections",
    "salaries",
    "customer_deals",
    "transports",
    "rent_invoices",
    "rent_payments",
  ],
  wastepaper: [
    "wastepaper_requests",
    "wp_intakes",
    "wp_shipments",
    "wp_payments",
    "wp_transports",
    "wp_counterparties",
  ],
};

export function tablesForRole(role: string): readonly string[] {
  const allowed = ROLE_TABLES[role];
  if (!allowed) return [];
  return allowed === "all" ? REALTIME_TABLES : allowed;
}

export interface RealtimeEvent {
  table: string;
  /** INSERT | UPDATE | DELETE */
  type: string;
  id: string | null;
  at: string;
  /** Безопасный минимум полей — только для тех таблиц, где нужен текст в тосте. */
  preview?: Record<string, unknown>;
}

/**
 * Белый список полей, которые можно положить в событие.
 * Всё остальное не покидает сервер: подписчику достаточно знать,
 * что запись изменилась, детали он запросит своим API с проверкой прав.
 */
const PREVIEW_FIELDS: Record<string, string[]> = {
  orders: ["type", "status", "customer_name", "customer_phone", "total_sum", "created_at"],
  wastepaper_requests: ["status", "name", "phone", "created_at"],
  client_requests: ["status", "customer_name", "customer_phone", "subject", "created_at"],
};

type Listener = (event: RealtimeEvent) => void;
type StatusListener = (status: HubStatus) => void;

export type HubStatus = "idle" | "connecting" | "connected" | "error";

interface Hub {
  client: SupabaseClient | null;
  channel: any;
  listeners: Set<Listener>;
  statusListeners: Set<StatusListener>;
  status: HubStatus;
  lastError: string | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  connectWatchdog: ReturnType<typeof setTimeout> | null;
  /** Когда канал перешёл в "connecting" — для watchdog. */
  connectingSince: number | null;
}

/**
 * Если канал висит в "connecting" дольше этого — рвём и переподключаемся.
 * Защита от «зависшего» WebSocket-handshake (self-hosted Realtime, прокси
 * без поддержки WS и т.п.): без watchdog статус навсегда застревал бы в
 * "connecting", а клиент — в бесконечном polling-фоллбэке.
 */
const CONNECT_WATCHDOG_MS = 20_000;

// Singleton переживает HMR в dev — иначе на каждый пересборке копился бы
// новый WebSocket к Supabase.
const globalRef = globalThis as unknown as { __sgtRealtimeHub?: Hub };

function getHub(): Hub {
  const existing = globalRef.__sgtRealtimeHub;
  if (!existing) {
    globalRef.__sgtRealtimeHub = {
      client: null,
      channel: null,
      listeners: new Set(),
      statusListeners: new Set(),
      status: "idle",
      lastError: null,
      closeTimer: null,
      connectWatchdog: null,
      connectingSince: null,
    };
    return globalRef.__sgtRealtimeHub;
  }
  // Singleton переживает горячую перезагрузку в dev, поэтому объект может
  // быть создан прошлой версией модуля — дополняем недостающие поля.
  if (!existing.listeners) existing.listeners = new Set();
  if (!existing.statusListeners) existing.statusListeners = new Set();
  if (existing.connectWatchdog === undefined) existing.connectWatchdog = null;
  if (existing.connectingSince === undefined) existing.connectingSince = null;
  return existing;
}

function clearWatchdog() {
  const hub = getHub();
  if (hub.connectWatchdog) {
    clearTimeout(hub.connectWatchdog);
    hub.connectWatchdog = null;
  }
  hub.connectingSince = null;
}

function buildPreview(table: string, record: any): Record<string, unknown> | undefined {
  const fields = PREVIEW_FIELDS[table];
  if (!fields || !record) return undefined;
  const preview: Record<string, unknown> = {};
  for (const field of fields) {
    if (record[field] !== undefined) preview[field] = record[field];
  }
  return Object.keys(preview).length ? preview : undefined;
}

function setStatus(next: HubStatus) {
  const hub = getHub();
  if (hub.status === next) return;
  const prev = hub.status;
  hub.status = next;
  if (next !== "connecting") clearWatchdog();
  if (next !== prev) {
    // Лёгкий лог в консоль сервера: на VPS это единственный способ быстро
    // понять, поднялся ли канал, и почему нет, если «реалтайм не работает».
    try {
      if (next === "connected") console.log("[realtime-hub] канал к Supabase подключён");
      else if (next === "error") console.warn("[realtime-hub] канал к Supabase недоступен:", hub.lastError);
    } catch {
      /* ignore */
    }
  }
  for (const listener of hub.statusListeners) {
    try {
      listener(next);
    } catch {
      /* ignore */
    }
  }
}

/** Подписка на статус канала — нужна SSE-маршруту, чтобы сообщить браузеру,
 *  что поток ожил и polling можно выключить. */
export function subscribeToHubStatus(listener: StatusListener): () => void {
  const hub = getHub();
  hub.statusListeners.add(listener);
  return () => {
    getHub().statusListeners.delete(listener);
  };
}

function emit(event: RealtimeEvent) {
  const hub = getHub();
  for (const listener of hub.listeners) {
    try {
      listener(event);
    } catch {
      // один сломанный подписчик не должен ронять остальных
    }
  }
}

function connect() {
  const hub = getHub();
  if (hub.status === "connecting" || hub.status === "connected") return;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    hub.lastError = "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы";
    setStatus("error");
    return;
  }

  hub.lastError = null;
  setStatus("connecting");
  hub.connectingSince = Date.now();
  clearWatchdog();
  hub.connectWatchdog = setTimeout(() => {
    const current = getHub();
    current.connectWatchdog = null;
    if (current.status !== "connecting") return;
    console.warn(
      "[realtime-hub] подключение зависло > " + CONNECT_WATCHDOG_MS / 1000 + "s — переподключаемся"
    );
    teardown();
    if (current.listeners.size > 0) connect();
  }, CONNECT_WATCHDOG_MS);

  try {
    hub.client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });

    const channel = hub.client.channel("sgt-admin-hub", {
      config: { private: false },
    });

    for (const table of REALTIME_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload: any) => {
          const record = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
          emit({
            table,
            type: payload.eventType || "UPDATE",
            id: record?.id != null ? String(record.id) : null,
            at: new Date().toISOString(),
            preview: buildPreview(table, record),
          });
        }
      );
    }

    channel.subscribe((status: string, err?: Error) => {
      if (status === "SUBSCRIBED") {
        hub.lastError = null;
        setStatus("connected");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        hub.lastError = err?.message || status;
        console.warn(`[realtime-hub] ${status}:`, hub.lastError);
        setStatus("error");
        // Переподключение: рвём канал и пробуем заново, если слушатели есть.
        setTimeout(() => {
          const current = getHub();
          if (current.listeners.size > 0 && current.status === "error") {
            teardown();
            connect();
          }
        }, 5_000);
      } else if (status === "CLOSED") {
        setStatus("idle");
      }
    });

    hub.channel = channel;
  } catch (error) {
    hub.lastError = error instanceof Error ? error.message : "unknown";
    setStatus("error");
  }
}

function teardown() {
  const hub = getHub();
  try {
    if (hub.channel && hub.client) hub.client.removeChannel(hub.channel);
  } catch {
    // ignore
  }
  hub.channel = null;
  hub.client = null;
  setStatus("idle");
}

/**
 * Подписаться на поток изменений. Возвращает функцию отписки.
 * Первый подписчик поднимает WebSocket, последний — гасит его (с задержкой,
 * чтобы переход между страницами админки не дёргал соединение).
 */
export function subscribeToChanges(listener: Listener): () => void {
  const hub = getHub();
  if (hub.closeTimer) {
    clearTimeout(hub.closeTimer);
    hub.closeTimer = null;
  }
  hub.listeners.add(listener);
  connect();

  return () => {
    const current = getHub();
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && !current.closeTimer) {
      current.closeTimer = setTimeout(() => {
        const latest = getHub();
        latest.closeTimer = null;
        if (latest.listeners.size === 0) teardown();
      }, 60_000);
    }
  };
}

export function getHubStatus(): { status: string; error: string | null; listeners: number } {
  const hub = getHub();
  return { status: hub.status, error: hub.lastError, listeners: hub.listeners.size };
}
