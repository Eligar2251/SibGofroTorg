// =========================================================
// FILE: src/components/admin/WarehouseRealtime.tsx
// Автоматическое обновление страницы учёта в реальном времени.
// =========================================================

"use client";

import { useAdminRealtime } from "@/lib/use-admin-realtime";

export function WarehouseRealtime() {
  useAdminRealtime({
    tables: [
      "customer_deals",
      "warehouse_receipts",
      "bank_payments",
      "products",
    ],
    pollIntervalMs: 20_000,
  });

  return null;
}
