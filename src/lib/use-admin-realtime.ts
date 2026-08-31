// =========================================================
// FILE: src/lib/use-admin-realtime.ts
// Хук автообновления админки.
//
// Транспорт — SSE с нашего же сервера (/api/admin/events), который держит
// единственную подписку на Supabase Realtime под service_role.
//
// Обновления гарантированы в ТРЁХ случаях, а не в одном:
//   1. Живой канал: событие → коалесцированный router.refresh() (сразу).
//   2. Канал упал / Realtime недоступен: polling каждые pollIntervalMs.
//   3. «Тихий» канал — канал подключён (status "live"), но события не
//      приходят (таблицы не добавлены в публикацию supabase_realtime,
//      Realtime-сервис self-hosted не включён, события потерялись).
//      Раньше в этом случае polling полностью отключался, и данные
//      обновлялись ТОЛЬКО после ручного F5. Теперь действует страховочный
//      опрос: если за safetyPollMs (по умолчанию 60 c) ни одно обновление
//      (событийное или страховочное) не произошло — делаем одно. Худший
//      кейс: задержка до 60 c вместо «никогда».
//
// Что изменилось по сравнению с прошлыми версиями:
//   • подписка реально работает (раньше в браузер не попадал URL Supabase,
//     и хук всегда молча уходил в polling);
//   • обновления коалесцируются: массовый импорт 200 строк даёт один
//     router.refresh(), а не 200;
//   • в фоновой вкладке ничего не перерисовывается, догоняем при возврате
//     (включая «данные остыли, пока вкладка была закрыта»).
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
  /** Интервал polling, когда канала НЕТ (по умолчанию 30s) */
  pollIntervalMs?: number;
  /**
   * Страховочный интервал, когда канал ЕСТЬ и «живой» (по умолчанию 60s).
   * Лечит случай «канал подключён, но событий нет» (например, таблицы не
   * в публикации supabase_realtime). Увеличьте, если хотите экономить.
   */
  safetyPollMs?: number;
  /** Колбэк при обновлении (вызывается до router.refresh) */
  onUpdate?: (table: string, event: string, payload?: AdminChangeEvent) => void;
  /** Не вызывать router.refresh() — только onUpdate (для точечных обновлений).
   *  Компоненты в manual-режиме сами реализуют запасной опрос (у них он
   *  есть), поэтому страховочный таймер для них не запускаем. */
  manual?: boolean;
}

/** Пауза, за которую несколько событий подряд схлопываются в один refresh. */
const COALESCE_MS = 400;
/** Как часто «глядим» на страховочный таймер (сам опрос идёт реже). */
const SAFETY_TICK_MS = 10_000;

export function useAdminRealtime(options: RealtimeOptions): ConnectionStatus {
  const { pollIntervalMs = 30_000, safetyPollMs = 60_000, onUpdate, manual = false } = options;
  const router = useRouter();
  const onUpdateRef = useRef(onUpdate);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  /** Момент последнего завершённого обновления (событийного или страховочного).
   *  Инициализируем «сейчас»: страница только что отрендерена свежими данными,
   *  дублирующий refresh в первые секунды не нужен. */
  const lastRefreshRef = useRef<number>(Date.now());

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const tablesKey = JSON.stringify(options.tables);
  const tables: string[] = useMemo(() => options.tables, [tablesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    lastRefreshRef.current = Date.now();
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
      if (document.hidden) return;
      if (!manual) {
        if (pendingWhileHidden || Date.now() - lastRefreshRef.current >= pollIntervalMs) {
          pendingWhileHidden = false;
          refresh();
        }
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
  }, [tables, refresh, manual, pollIntervalMs]);

  // ── Опрос: запасной (нет канала) + страховочный (канал «жив, но молчит») ──
  // Один тикающий интервал; выбор периода зависит от статуса соединения:
  //   live    → safetyPollMs   (обычно 60 c)
  //   иначе   → pollIntervalMs (обычно 30 c)
  // Обновление делаем только если с последнего прошло достаточно времени —
  // событийные refresh сбрасывают счётчик, и «прохладные» данные догоняются.
  useEffect(() => {
    if (manual || tables.length === 0) return;

    const interval = status === "live" ? safetyPollMs : pollIntervalMs;
    const id = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastRefreshRef.current >= interval) refresh();
    }, SAFETY_TICK_MS);
    return () => clearInterval(id);
  }, [status, pollIntervalMs, safetyPollMs, refresh, manual, tables.length]);

  return status;
}
