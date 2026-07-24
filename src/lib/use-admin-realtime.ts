// =========================================================
// FILE: src/lib/use-admin-realtime.ts
// Хук для подписки на изменения Supabase в реальном времени.
// Использует Supabase Realtime (WebSocket) как основной канал
// и polling как fallback, если WebSocket недоступен.
// =========================================================

"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseUrl_pub, getSupabaseAnonKey_pub } from "./supabase";

interface RealtimeOptions {
  /** Таблицы Supabase, за изменениями которых следить */
  tables: string[];
  /** Интервал polling fallback в мс (по умолчанию 30s) */
  pollIntervalMs?: number;
  /** Колбэк при обновлении (вызывается до router.refresh) */
  onUpdate?: (table: string, event: string) => void;
}

/**
 * Подписывается на INSERT/UPDATE/DELETE в указанных таблицах Supabase.
 *
 * - Основной канал: Supabase Realtime (WebSocket через postgres_changes)
 * - Fallback: polling каждые pollIntervalMs мс (если WS не подключился за 5s)
 * - При получении события вызывает router.refresh() для обновления RSC
 *
 * Использование:
 * ```tsx
 * useAdminRealtime({ tables: ["orders", "wastepaper_requests"] });
 * ```
 */
export function useAdminRealtime(options: RealtimeOptions) {
  const { pollIntervalMs = 30_000, onUpdate } = options;
  const router = useRouter();
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Стабильная ссылка на tables — пересоздаётся только при изменении содержимого
  const tablesKey = JSON.stringify(options.tables);
  const tables: string[] = useMemo(() => options.tables, [tablesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Стабильная функция refresh — не пересоздаётся между рендерами
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (tables.length === 0) return;

    let mounted = true;
    let channel: any = null;
    let pollingId: ReturnType<typeof setInterval> | null = null;
    let realtimeConnected = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Polling fallback ──
    function startPolling() {
      if (pollingId || !mounted) return;
      pollingId = setInterval(() => {
        if (mounted) refresh();
      }, pollIntervalMs);
    }

    function stopPolling() {
      if (pollingId) {
        clearInterval(pollingId);
        pollingId = null;
      }
    }

    // ── Supabase Realtime ──
    async function initRealtime() {
      try {
        const url = getSupabaseUrl_pub();
        const key = getSupabaseAnonKey_pub();
        if (!url || !key) {
          startPolling();
          return;
        }

        // Динамический импорт, чтобы не увеличивать initial bundle
        const { createClient } = await import("@supabase/supabase-js");
        const client = createClient(url, key, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        if (!mounted) return;

        // Создаём канал с подписками на все указанные таблицы
        const channelName = `admin-realtime-${tables.join("-")}`;
        channel = client.channel(channelName);

        for (const table of tables) {
          channel.on(
            "postgres_changes",
            {
              event: "*", // INSERT, UPDATE, DELETE
              schema: "public",
              table,
            },
            (payload: any) => {
              if (!mounted) return;
              onUpdateRef.current?.(table, payload.eventType);
              refresh();
            }
          );
        }

        channel.subscribe((status: string) => {
          if (status === "SUBSCRIBED") {
            realtimeConnected = true;
            // Realtime работает — polling не нужен
            stopPolling();
            if (fallbackTimer) {
              clearTimeout(fallbackTimer);
              fallbackTimer = null;
            }
          }
        });

        // Если за 5 секунд Realtime не подключился — запускаем polling
        fallbackTimer = setTimeout(() => {
          if (!realtimeConnected && mounted) {
            startPolling();
          }
        }, 5_000);
      } catch {
        // Realtime недоступен — используем polling
        startPolling();
      }
    }

    initRealtime();

    return () => {
      mounted = false;
      stopPolling();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (channel) {
        try {
          channel.unsubscribe();
        } catch {
          // ignore
        }
      }
    };
  }, [tables, pollIntervalMs, refresh]);
}
