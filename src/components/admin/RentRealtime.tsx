// =========================================================
// FILE: src/components/admin/RentRealtime.tsx
// Автообновление модуля аренды: счета и платежи арендаторов.
// =========================================================

"use client";

import { useAdminRealtime } from "@/lib/use-admin-realtime";

export function RentRealtime() {
  useAdminRealtime({
    tables: ["rent_invoices", "rent_payments"],
    pollIntervalMs: 60_000,
  });

  return null;
}
