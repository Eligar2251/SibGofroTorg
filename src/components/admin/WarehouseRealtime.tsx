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
      // Зарплаты и инкассации меняются из этого же модуля, но раньше в
      // подписке их не было — календарь зарплат не обновлялся у коллег.
      "salaries",
      "cash_collections",
      "transports",
    ],
    pollIntervalMs: 30_000,
  });

  return null;
}
