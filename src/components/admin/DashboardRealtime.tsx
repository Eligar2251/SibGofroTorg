// =========================================================
// FILE: src/components/admin/DashboardRealtime.tsx
// Автоматическое обновление дашборда при изменениях заявок.
// Использует более длинный интервал polling (30s) чтобы не
// перегружать агрегатные запросы дашборда.
// =========================================================

"use client";

import { useAdminRealtime } from "@/lib/use-admin-realtime";

export function DashboardRealtime({ limited = false }: { limited?: boolean }) {
  useAdminRealtime({
    tables: limited
      ? ["bank_payments", "salaries", "cash_collections", "customer_deals"]
      : [
          "orders",
          "wastepaper_requests",
          "bank_payments",
          "salaries",
          "cash_collections",
          "customer_deals",
          "warehouse_receipts",
        ],
    pollIntervalMs: 30_000,
  });

  return null;
}
