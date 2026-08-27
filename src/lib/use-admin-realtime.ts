// =========================================================
// FILE: src/lib/use-admin-realtime.ts
// Хук автообновления админки.
//
// Транспорт — SSE с нашего же сервера (/api/admin/events), который держит
// единственную подписку на Supabase Realtime под service_role.
// Polling остался запасным путём: если сервер сообщил, что канал не поднялся,
// или соединение упало — страница продолжит обновляться по таймеру.
//
// Что изменилось по сравнению с прошлой версией:
//   • подписка реально работает (раньше в браузер не попадал URL Supabase,
//     и хук всегда молча уходил в polling);
//   • обновления коалесцируются: массовый импорт 200 строк даёт один
//     router.refresh(), а не 200;
//   • в фоновой вкладке ничего не перерисовывается, догоняем при возврате.
// =========================================================

"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  subscribeAdminEvents,
  subscribeAdminStatus,
  type AdminChangeEvent,
  type ConnectionStatus,
} from "./admin-events-client";

interface RealtimeOptions {
  /** Таблицы Supabase, за изменениями которых следить */
  tables: string[];
  /** Интервал polling fallback в мс (по умолчанию 30s) */
  pollIntervalMs?: number;
  /** Колбэк при обновлении (вызывается до router.refresh) */
  onUpdate?: (table: string, event: string, payload?: AdminChangeEvent) => void;
  /** Не вызывать router.refresh() — только onUpdate (для точечных обновлений) */
  manual?: boolean;
}

/** Пауза, за которую несколько событий подряд схлопываются в один refresh. */
const COALESCE_MS = 400;

export function useAdminRealtime(options: RealtimeOptions): ConnectionStatus {
  const { pollIntervalMs = 30_000, onUpdate, manual = false } = options;
  const router = useRouter();
  const onUpdateRef = useRef(onUpdate);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const tablesKey = JSON.stringify(options.tables);
  const tables: string[] = useMemo(() => options.tables, [tablesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  // ── Статус соединения ──
  useEffect(() => subscribeAdminStatus(setStatus), []);

  // ── Поток изменений ──
  useEffect(() => {
    if (tables.length === 0) return;
    const watched = new Set(tables);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingWhileHidden = false;

    const flush = () => {
      timer = null;
      if (document.hidden) {
        // В фоновой вкладке не тратим сервер на перерисовку —
        // догоним, когда на неё вернутся.
        pendingWhileHidden = true;
        return;
      }
      if (!manual) refresh();
    };

    const onVisible = () => {
      if (!document.hidden && pendingWhileHidden) {
        pendingWhileHidden = false;
        if (!manual) refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const unsubscribe = subscribeAdminEvents((event) => {
      if (!watched.has(event.table)) return;
      onUpdateRef.current?.(event.table, event.type, event);
      if (manual) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, COALESCE_MS);
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [tables, refresh, manual]);

  // ── Polling-фоллбэк: только когда потока нет ──
  useEffect(() => {
    if (manual || tables.length === 0) return;
    if (status === "live") return;

    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [status, pollIntervalMs, refresh, manual, tables.length]);

  return status;
}
