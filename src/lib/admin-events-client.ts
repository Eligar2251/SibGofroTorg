// =========================================================
// FILE: src/lib/admin-events-client.ts
// Один EventSource на вкладку админки.
//
// Раньше каждый компонент с useAdminRealtime поднимал собственный клиент
// Supabase и собственный канал. Теперь все подписчики делят одно
// SSE-соединение с нашим же сервером (/api/admin/events), а он уже держит
// единственный WebSocket к Supabase.
// =========================================================

"use client";

export interface AdminChangeEvent {
  table: string;
  type: string;
  id: string | null;
  at: string;
  preview?: Record<string, unknown>;
}

export type ConnectionStatus = "connecting" | "live" | "offline";

type ChangeHandler = (event: AdminChangeEvent) => void;
type StatusHandler = (status: ConnectionStatus) => void;

let source: EventSource | null = null;
let status: ConnectionStatus = "connecting";
let retryDelay = 2_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const changeHandlers = new Set<ChangeHandler>();
const statusHandlers = new Set<StatusHandler>();

function setStatus(next: ConnectionStatus) {
  if (status === next) return;
  status = next;
  for (const handler of statusHandlers) {
    try {
      handler(next);
    } catch {
      /* один слушатель не должен ломать остальных */
    }
  }
}

function open() {
  if (source || typeof window === "undefined") return;
  setStatus("connecting");

  try {
    source = new EventSource("/api/admin/events");
  } catch {
    setStatus("offline");
    return;
  }

  source.addEventListener("hello", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data);
      // Сервер честно сообщает, поднялся ли у него канал к Supabase.
      // "connecting"/"idle" — канал ещё поднимается, ждём события status.
      // "error" — Realtime недоступен, оставляем polling включённым.
      setStatus(
        data?.status === "connected"
          ? "live"
          : data?.status === "error"
            ? "offline"
            : "connecting"
      );
    } catch {
      setStatus("connecting");
    }
    retryDelay = 2_000;
  });

  // Канал к Supabase поднимается асинхронно — сервер присылает
  // отдельное событие, когда он ожил (или отвалился).
  source.addEventListener("status", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data);
      setStatus(data?.status === "connected" ? "live" : "offline");
    } catch {
      /* ignore */
    }
  });

  source.addEventListener("change", (event) => {
    let data: AdminChangeEvent | null = null;
    try {
      data = JSON.parse((event as MessageEvent).data);
    } catch {
      return;
    }
    if (!data?.table) return;
    for (const handler of changeHandlers) {
      try {
        handler(data);
      } catch {
        /* игнорируем */
      }
    }
  });

  source.onerror = () => {
    // EventSource умеет переподключаться сам, но при 401/500 он этого не
    // сделает. Закрываем и пробуем сами с нарастающей паузой.
    close();
    setStatus("offline");
    if (changeHandlers.size === 0 && statusHandlers.size === 0) return;
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryDelay = Math.min(retryDelay * 2, 60_000);
      open();
    }, retryDelay);
  };
}

function close() {
  if (source) {
    try {
      source.close();
    } catch {
      /* ignore */
    }
    source = null;
  }
}

function maybeShutdown() {
  if (changeHandlers.size === 0 && statusHandlers.size === 0) {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    close();
    status = "connecting";
  }
}

/** Подписка на поток изменений. Возвращает функцию отписки. */
export function subscribeAdminEvents(handler: ChangeHandler): () => void {
  changeHandlers.add(handler);
  open();
  return () => {
    changeHandlers.delete(handler);
    maybeShutdown();
  };
}

/** Подписка на статус соединения (для индикатора «данные живые»). */
export function subscribeAdminStatus(handler: StatusHandler): () => void {
  statusHandlers.add(handler);
  handler(status);
  open();
  return () => {
    statusHandlers.delete(handler);
    maybeShutdown();
  };
}

export function getAdminEventsStatus(): ConnectionStatus {
  return status;
}
