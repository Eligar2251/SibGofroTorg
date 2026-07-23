// =========================================================
// FILE: src/components/admin/OrdersRealtime.tsx
// Автоматическое обновление страницы заявок в реальном времени.
// Использует Supabase Realtime (WebSocket) с fallback на polling.
// =========================================================

"use client";

import { useAdminRealtime } from "@/lib/use-admin-realtime";

export function OrdersRealtime() {
  useAdminRealtime({
    tables: ["orders", "wastepaper_requests"],
    // Polling fallback каждые 20 сек, если Realtime недоступен
    pollIntervalMs: 20_000,
  });

  return null;
}
