// =========================================================
// FILE: src/components/analytics/OrderSuccessGoal.tsx
// =========================================================

"use client";

import { useEffect } from "react";
import { ymGoal } from "@/lib/ym";

export function OrderSuccessGoal({ code }: { code?: string } = {}) {
  useEffect(() => {
    ymGoal("order_success", code ? { order_code: code } : undefined);
  }, [code]);
  return null;
}