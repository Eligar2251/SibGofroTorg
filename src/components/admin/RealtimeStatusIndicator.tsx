// =========================================================
// FILE: src/components/admin/RealtimeStatusIndicator.tsx
// Индикатор «данные живые» — маленькая точка рядом с колокольчиками.
//
//   зелёная  — realtime-канал жив, изменения приходят мгновенно;
//   жёлтая   — канал подключается (обычно первые секунды после входа);
//   красная  — realtime недоступен, данные обновляются по таймеру
//              (страховочный опрос, не чаще раза в минуту).
//
// Если красная висит долго — проблема на стороне Supabase:
//   1) открыт ли сервис Realtime (self-hosted — включён ли realtime);
//   2) применена ли миграция supabase/migration_realtime_admin.sql
//      (таблицы должны быть в публикации supabase_realtime);
//   3) детали — GET /api/admin/events/status (нужна сессия админки)
//      и консоль сервера (строки [realtime-hub]).
//
// Компонент не подписывает данные сам: статус берётся из общего
// SSE-клиента вкладки, поэтому без открытой подписки он честно
// показывает «подключение» и сам не дёргает сервер.
// =========================================================

"use client";

import { useEffect, useState } from "react";
import { subscribeAdminStatus, type ConnectionStatus } from "@/lib/admin-events-client";

const META: Record<
  ConnectionStatus,
  { label: string; dot: string; title: string }
> = {
  live: {
    label: "живые данные",
    dot: "var(--adm-pine, #16a34a)",
    title:
      "Realtime-канал работает: изменения в админке появляются сразу, без перезагрузки.",
  },
  partial: {
    label: "живые заявки",
    dot: "var(--adm-pine, #16a34a)",
    title:
      "Заявки с сайта приходят мгновенно (сервер шлёт их напрямую в этот поток). Канал к базе при этом не поднят, поэтому изменения, сделанные в обход админки (правка в SQL-редакторе, другой сервис), подтянутся опросом в течение минуты. Чтобы включить и их: проверьте, запущен ли сервис Realtime, и примените supabase/migration_realtime_admin.sql.",
  },
  connecting: {
    label: "подключение…",
    dot: "var(--adm-kraft, #d97706)",
    title:
      "Канал realtime подключается. Обычно это первые секунды после входа в админку.",
  },
  offline: {
    label: "обновление по таймеру",
    dot: "var(--adm-rust, #dc2626)",
    title:
      "Поток событий недоступен — данные обновляются по таймеру. Проверьте, отвечает ли /api/admin/events (не режет ли его прокси: нужен отключённый буфер, X-Accel-Buffering: no).",
  },
};

export function RealtimeStatusIndicator() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);

  useEffect(() => subscribeAdminStatus(setStatus), []);

  if (!status) return null;
  const meta = META[status];

  return (
    <div
      className="admin-realtime-status"
      title={meta.title}
      aria-label={`Обновление данных: ${meta.label}`}
      role="status"
    >
      <span
        className={`admin-realtime-status__dot${
          status === "connecting" ? " admin-realtime-status__dot--pulse" : ""
        }`}
        style={{ background: meta.dot }}
        aria-hidden="true"
      />
      <span className="admin-realtime-status__label">{meta.label}</span>
    </div>
  );
}
