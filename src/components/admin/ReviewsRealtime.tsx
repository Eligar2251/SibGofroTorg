// =========================================================
// FILE: src/components/admin/ReviewsRealtime.tsx
// Автоматическое обновление страницы отзывов в реальном времени.
// =========================================================

"use client";

import { useAdminRealtime } from "@/lib/use-admin-realtime";

export function ReviewsRealtime() {
  useAdminRealtime({
    tables: ["product_reviews"],
    pollIntervalMs: 30_000,
  });

  return null;
}
