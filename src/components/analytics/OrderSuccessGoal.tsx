// =========================================================
// FILE: src/components/analytics/OrderSuccessGoal.tsx
// =========================================================

"use client";

import { useEffect } from "react";
import { ymGoal } from "@/lib/ym";

export function OrderSuccessGoal() {
  useEffect(() => {
    ymGoal("order_success");
  }, []);
  return null;
}