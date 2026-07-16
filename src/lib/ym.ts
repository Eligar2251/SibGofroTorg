// =========================================================
// FILE: src/lib/ym.ts
// Вызывать только в client-компонентах
// =========================================================

const id = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID?.replace(/\D/g, "");

export function ymGoal(goal: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined" || !id) return;
  try {
    window.ym?.(Number(id), "reachGoal", goal, params);
  } catch {
    /* ignore */
  }
}

export function ymHit(url?: string) {
  if (typeof window === "undefined" || !id) return;
  try {
    window.ym?.(Number(id), "hit", url || window.location.href);
  } catch {
    /* ignore */
  }
}