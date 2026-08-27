// =========================================================
// FILE: src/components/admin/DeliveriesRealtime.tsx
// Автоматическое обновление страницы доставок в реальном времени.
// =========================================================

"use client";

import { useAdminRealtime } from "@/lib/use-admin-realtime";

export function DeliveriesRealtime() {
  useAdminRealtime({
    // transports здесь не хватало: модуль работает с рейсами, а подписка
    // следила только за сделками.
    tables: ["customer_deals", "transports"],
    pollIntervalMs: 30_000,
  });

  return null;
}
