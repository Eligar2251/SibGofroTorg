// =========================================================
// FILE: src/components/admin/DeliveriesRealtime.tsx
// Автоматическое обновление страницы доставок в реальном времени.
// =========================================================

"use client";

import { useAdminRealtime } from "@/lib/use-admin-realtime";

export function DeliveriesRealtime() {
  useAdminRealtime({
    tables: ["customer_deals"],
    pollIntervalMs: 20_000,
  });

  return null;
}
