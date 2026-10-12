// =========================================================
// FILE: src/components/analytics/PhoneClickTracking.tsx
// =========================================================

"use client";

import { useEffect } from "react";
import { ymGoal } from "@/lib/ym";

export function PhoneClickTracking() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href^="tel:"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      ymGoal("click_call", {
        phone: href.replace(/[^\d+]/g, ""),
      });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
